// SPDX-License-Identifier: Apache-2.0
//! Inline image encoders: Kitty graphics (PNG or raw RGBA, chunked), Sixel
//! (216-color cube, transparent background) and iTerm2 (OSC 1337 `File=`).

use std::fmt::Write as _;

use base64::Engine as _;

use crate::detect::ImageProtocol;

/// Kitty graphics payload chunk size (the protocol maximum).
const KITTY_CHUNK: usize = 4096;

/// Straight-alpha RGBA8 pixels.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Rgba {
    /// Width in pixels.
    pub width: u32,
    /// Height in pixels.
    pub height: u32,
    /// `width * height * 4` bytes, row-major.
    pub pixels: Vec<u8>,
}

/// Errors from decoding or encoding an image.
#[derive(Debug)]
pub enum ImageError {
    /// The file could not be decoded.
    Decode(String),
    /// The pixel buffer does not match its dimensions, or is empty.
    InvalidSize,
    /// Decoding support was compiled out (feature `decode`).
    DecodeUnavailable,
}

impl std::fmt::Display for ImageError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Decode(why) => write!(f, "cannot decode image: {why}"),
            Self::InvalidSize => f.write_str("image buffer does not match its dimensions"),
            Self::DecodeUnavailable => f.write_str("image decoding is not compiled in"),
        }
    }
}

impl std::error::Error for ImageError {}

impl Rgba {
    /// Wraps a pixel buffer after checking its length.
    ///
    /// # Errors
    /// [`ImageError::InvalidSize`] when `pixels.len() != width * height * 4`
    /// or the image is empty.
    pub fn new(width: u32, height: u32, pixels: Vec<u8>) -> Result<Self, ImageError> {
        let expected = (width as usize) * (height as usize) * 4;
        if width == 0 || height == 0 || pixels.len() != expected {
            return Err(ImageError::InvalidSize);
        }
        Ok(Self { width, height, pixels })
    }

    /// Decodes PNG, JPEG, GIF, WebP, BMP, ... into RGBA.
    ///
    /// # Errors
    /// [`ImageError::Decode`] for unreadable data.
    #[cfg(feature = "decode")]
    pub fn decode(bytes: &[u8]) -> Result<Self, ImageError> {
        let image = image::load_from_memory(bytes).map_err(|e| ImageError::Decode(e.to_string()))?;
        let rgba = image.into_rgba8();
        let (width, height) = rgba.dimensions();
        Self::new(width, height, rgba.into_raw())
    }

    /// Decoding is compiled out.
    ///
    /// # Errors
    /// Always [`ImageError::DecodeUnavailable`].
    #[cfg(not(feature = "decode"))]
    pub fn decode(_bytes: &[u8]) -> Result<Self, ImageError> {
        Err(ImageError::DecodeUnavailable)
    }

    /// Downscales (never upscales) to fit `max_width` x `max_height`,
    /// preserving the aspect ratio.
    #[must_use]
    pub fn fit(self, max_width: u32, max_height: u32) -> Self {
        let (max_width, max_height) = (max_width.max(1), max_height.max(1));
        if self.width <= max_width && self.height <= max_height {
            return self;
        }
        let scale = f64::min(
            f64::from(max_width) / f64::from(self.width),
            f64::from(max_height) / f64::from(self.height),
        );
        let width = ((f64::from(self.width) * scale).round() as u32).max(1);
        let height = ((f64::from(self.height) * scale).round() as u32).max(1);
        let mut pixels = vec![0_u8; (width as usize) * (height as usize) * 4];
        // Box filter: average every source pixel that maps into a target pixel.
        for ty in 0..height {
            let sy0 = (u64::from(ty) * u64::from(self.height) / u64::from(height)) as u32;
            let sy1 = ((u64::from(ty + 1) * u64::from(self.height)).div_ceil(u64::from(height))
                as u32)
                .max(sy0 + 1);
            for tx in 0..width {
                let sx0 = (u64::from(tx) * u64::from(self.width) / u64::from(width)) as u32;
                let sx1 = ((u64::from(tx + 1) * u64::from(self.width))
                    .div_ceil(u64::from(width)) as u32)
                    .max(sx0 + 1);
                let mut acc = [0_u64; 4];
                let mut n = 0_u64;
                for sy in sy0..sy1.min(self.height) {
                    for sx in sx0..sx1.min(self.width) {
                        let i = ((sy * self.width + sx) * 4) as usize;
                        for (a, p) in acc.iter_mut().zip(&self.pixels[i..i + 4]) {
                            *a += u64::from(*p);
                        }
                        n += 1;
                    }
                }
                let o = ((ty * width + tx) * 4) as usize;
                for (dst, a) in pixels[o..o + 4].iter_mut().zip(acc) {
                    *dst = (a / n.max(1)) as u8;
                }
            }
        }
        Self { width, height, pixels }
    }
}

/// Encodes `data` (an image file) with `protocol`. Kitty sends PNG files as
/// is and decodes other formats; Sixel always decodes.
///
/// # Errors
/// Decoding errors for formats that need pixels.
pub fn encode_file(
    protocol: ImageProtocol,
    name: &str,
    data: &[u8],
    columns: Option<u16>,
    max_pixels: (u32, u32),
) -> Result<String, ImageError> {
    match protocol {
        ImageProtocol::Kitty if data.starts_with(b"\x89PNG\r\n\x1a\n") => {
            Ok(kitty_png(data, columns))
        },
        ImageProtocol::Kitty => {
            Ok(kitty_rgba(&Rgba::decode(data)?.fit(max_pixels.0, max_pixels.1), columns))
        },
        ImageProtocol::Sixel => Ok(sixel(&Rgba::decode(data)?.fit(max_pixels.0, max_pixels.1))),
        ImageProtocol::ITerm2 => Ok(iterm2(name, data, columns)),
    }
}

fn kitty_chunks(header: &str, payload: &[u8]) -> String {
    let encoded = base64::engine::general_purpose::STANDARD.encode(payload);
    let mut out = String::with_capacity(encoded.len() + encoded.len() / KITTY_CHUNK * 16 + 64);
    let chunks: Vec<&[u8]> = encoded.as_bytes().chunks(KITTY_CHUNK).collect();
    for (i, chunk) in chunks.iter().enumerate() {
        let more = u8::from(i + 1 < chunks.len());
        out.push_str("\x1b_G");
        if i == 0 {
            let _ = write!(out, "{header},m={more}");
        } else {
            let _ = write!(out, "m={more}");
        }
        out.push(';');
        out.push_str(std::str::from_utf8(chunk).unwrap_or_default());
        out.push_str("\x1b\\");
    }
    out
}

/// Kitty graphics: transmit and display a PNG file (`f=100`), quietly.
#[must_use]
pub fn kitty_png(png: &[u8], columns: Option<u16>) -> String {
    let cols = columns.map(|c| format!(",c={c}")).unwrap_or_default();
    kitty_chunks(&format!("a=T,f=100,q=2{cols}"), png)
}

/// Kitty graphics: transmit and display raw RGBA (`f=32`), quietly.
#[must_use]
pub fn kitty_rgba(image: &Rgba, columns: Option<u16>) -> String {
    let cols = columns.map(|c| format!(",c={c}")).unwrap_or_default();
    kitty_chunks(&format!("a=T,f=32,s={},v={},q=2{cols}", image.width, image.height), &image.pixels)
}

/// iTerm2 inline image (`OSC 1337 ; File=inline=1`).
#[must_use]
pub fn iterm2(name: &str, data: &[u8], columns: Option<u16>) -> String {
    let engine = base64::engine::general_purpose::STANDARD;
    let width = columns.map(|c| format!(";width={c}")).unwrap_or_default();
    format!(
        "\x1b]1337;File=inline=1;size={};name={};preserveAspectRatio=1{width}:{}\x07",
        data.len(),
        engine.encode(name.as_bytes()),
        engine.encode(data)
    )
}

/// Index into the 6x6x6 color cube, or `None` for transparent pixels.
fn cube_index(px: &[u8; 4]) -> Option<u8> {
    if px[3] < 128 {
        return None;
    }
    let level = |v: u8| ((u16::from(v) * 5 + 127) / 255) as u8;
    Some(level(px[0]) * 36 + level(px[1]) * 6 + level(px[2]))
}

/// Sixel encoding with a fixed 216-color cube; pixels with alpha < 128 are
/// left transparent (`P2 = 1`).
#[must_use]
pub fn sixel(image: &Rgba) -> String {
    const NONE: u8 = u8::MAX;
    let (w, h) = (image.width as usize, image.height as usize);
    let indices: Vec<u8> = image.pixels.as_chunks::<4>().0.iter().map(|p| cube_index(p).unwrap_or(NONE)).collect();

    let mut used = [false; 216];
    for &i in &indices {
        if i != NONE {
            used[i as usize] = true;
        }
    }
    let mut out = String::with_capacity(w * h / 2 + 4096);
    let _ = write!(out, "\x1bP0;1;0q\"1;1;{w};{h}");
    for (i, _) in used.iter().enumerate().filter(|(_, u)| **u) {
        let (r, g, b) = (i / 36, (i / 6) % 6, i % 6);
        let _ = write!(out, "#{i};2;{};{};{}", r * 20, g * 20, b * 20);
    }

    let mut columns = vec![0_u8; 216 * w];
    let mut band_colors: Vec<u8> = Vec::with_capacity(216);
    for band in (0..h).step_by(6) {
        band_colors.clear();
        for k in 0..6.min(h - band) {
            let row = &indices[(band + k) * w..(band + k + 1) * w];
            for (x, &c) in row.iter().enumerate() {
                if c == NONE {
                    continue;
                }
                let slot = &mut columns[c as usize * w + x];
                if *slot == 0 && !band_colors.contains(&c) {
                    band_colors.push(c);
                }
                *slot |= 1 << k;
            }
        }
        for (n, &c) in band_colors.iter().enumerate() {
            let bits = &mut columns[c as usize * w..(c as usize + 1) * w];
            let last = bits.iter().rposition(|b| *b != 0).map_or(0, |p| p + 1);
            let _ = write!(out, "#{c}");
            let mut x = 0;
            while x < last {
                let v = bits[x];
                let run = bits[x..last].iter().take_while(|b| **b == v).count();
                let ch = (63 + v) as char;
                if run > 3 {
                    let _ = write!(out, "!{run}{ch}");
                } else {
                    for _ in 0..run {
                        out.push(ch);
                    }
                }
                x += run;
            }
            bits.fill(0);
            if n + 1 < band_colors.len() {
                out.push('$');
            }
        }
        if band + 6 < h {
            out.push('-');
        }
    }
    out.push_str("\x1b\\");
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn checker(w: u32, h: u32) -> Rgba {
        let mut px = Vec::new();
        for y in 0..h {
            for x in 0..w {
                if (x + y) % 2 == 0 {
                    px.extend_from_slice(&[255, 0, 0, 255]);
                } else {
                    px.extend_from_slice(&[0, 0, 255, 255]);
                }
            }
        }
        Rgba::new(w, h, px).unwrap()
    }

    #[test]
    fn sixel_has_raster_palette_bands_and_terminator() {
        let s = sixel(&checker(4, 7));
        assert!(s.starts_with("\x1bP0;1;0q\"1;1;4;7"));
        assert!(s.contains("#5;2;0;0;100") && s.contains("#180;2;100;0;0"));
        assert_eq!(s.matches('-').count(), 1, "two bands, one separator: {s:?}");
        assert!(s.ends_with("\x1b\\"));
    }

    #[test]
    fn sixel_run_length_encodes_uniform_rows() {
        let img = Rgba::new(10, 1, [0, 255, 0, 255].repeat(10)).unwrap();
        let s = sixel(&img);
        assert!(s.contains("#30!10@"), "{s:?}");
    }

    #[test]
    fn sixel_skips_transparent_pixels() {
        let img = Rgba::new(2, 1, vec![0, 0, 0, 0, 255, 255, 255, 255]).unwrap();
        let s = sixel(&img);
        assert!(s.contains("#215?@"), "{s:?}");
        assert!(!s.contains("#0;"));
    }

    #[test]
    fn kitty_chunks_large_payloads() {
        let img = Rgba::new(64, 64, vec![7; 64 * 64 * 4]).unwrap();
        let s = kitty_rgba(&img, Some(10));
        assert!(s.starts_with("\x1b_Ga=T,f=32,s=64,v=64,q=2,c=10,m=1;"));
        assert!(s.contains("\x1b_Gm=1;") && s.contains("\x1b_Gm=0;"));
        let chunks = s.matches("\x1b_G").count();
        assert_eq!(chunks, (64 * 64 * 4_usize).div_ceil(3) * 4 / KITTY_CHUNK + 1);
    }

    #[test]
    fn iterm2_carries_size_and_name() {
        let s = iterm2("a.png", b"abc", None);
        assert_eq!(s, "\x1b]1337;File=inline=1;size=3;name=YS5wbmc=;preserveAspectRatio=1:YWJj\x07");
    }

    #[test]
    fn fit_downscales_preserving_aspect() {
        let img = checker(100, 50).fit(10, 10);
        assert_eq!((img.width, img.height), (10, 5));
        assert_eq!(img.pixels.len(), 10 * 5 * 4);
    }

    #[cfg(feature = "decode")]
    #[test]
    fn png_round_trips_through_decode() {
        let mut png = Vec::new();
        {
            let enc = image::codecs::png::PngEncoder::new(&mut png);
            image::ImageEncoder::write_image(
                enc,
                &[255, 0, 0, 255, 0, 255, 0, 255],
                2,
                1,
                image::ExtendedColorType::Rgba8,
            )
            .unwrap();
        }
        let img = Rgba::decode(&png).unwrap();
        assert_eq!((img.width, img.height), (2, 1));
        let encoded = encode_file(ImageProtocol::Kitty, "x.png", &png, None, (100, 100)).unwrap();
        assert!(encoded.contains("f=100"));
        let encoded = encode_file(ImageProtocol::Sixel, "x.png", &png, None, (100, 100)).unwrap();
        assert!(encoded.starts_with("\x1bP0;1;0q\"1;1;2;1"));
    }
}
