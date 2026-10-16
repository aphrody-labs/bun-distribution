// SPDX-License-Identifier: Apache-2.0
//! `sourceColorFromImage` / `sourceColorFromImageBytes`: exact port of
//! `utils/image_utils.ts` from [material-color-utilities] 0.4.0 (Apache-2.0) — the color most
//! suitable for building a UI theme from a decoded image's pixels.
//!
//! The reference reads pixels via a `<canvas>` element; this port takes an already-decoded RGBA8
//! byte buffer ([`source_color_from_rgba8`], no `cfg` gate) or, with the `image` feature, decodes
//! PNG/JPEG bytes first ([`source_color_from_image_bytes`]).
//!
//! [material-color-utilities]: https://github.com/material-foundation/material-color-utilities

use crate::{color_math, quantize, score};

/// Quantizes pixels to at most 128 colors, then picks the single best one — the same two
/// constants (`128`, [`score::ScoreOptions::default`]) the reference hardcodes.
const IMAGE_QUANTIZE_COLORS: usize = 128;

/// The color most suitable for a UI theme from raw, tightly packed `RGBA8` pixels (four bytes per
/// pixel, row-major, no padding — the layout `CanvasRenderingContext2D.getImageData` produces).
/// Pixels with alpha `< 255` are ignored, matching the reference.
///
/// # Panics
///
/// Never panics; an empty or fully-transparent `rgba8` returns the reference's fallback color
/// (Google Blue, `0xFF4285F4`) since [`score::score`] always returns at least one color.
#[must_use]
pub fn source_color_from_rgba8(rgba8: &[u8]) -> u32 {
    let mut pixels = Vec::with_capacity(rgba8.len() / 4);
    for chunk in rgba8.as_chunks::<4>().0 {
        let [r, g, b, a] = [chunk[0], chunk[1], chunk[2], chunk[3]];
        if a < 255 {
            continue;
        }
        pixels.push(color_math::argb_from_rgb(r, g, b));
    }
    let result = quantize::celebi_quantize(&pixels, IMAGE_QUANTIZE_COLORS);
    let ranked = score::score(&result, score::ScoreOptions::default());
    ranked[0]
}

/// Decoded dimensions and RGBA8 pixels of an image, the input [`source_color_from_rgba8`] and
/// the `aphrody-m3-reproduce` capture pipeline both consume.
#[cfg(feature = "image")]
#[derive(Clone, Debug)]
pub struct DecodedImage {
    /// Pixel width.
    pub width: u32,
    /// Pixel height.
    pub height: u32,
    /// Tightly packed `RGBA8` pixels, row-major.
    pub rgba8: Vec<u8>,
}

/// Decodes `bytes` (PNG or JPEG, auto-detected by content) into RGBA8, `image` crate feature.
///
/// # Errors
///
/// Returns the underlying [`image::ImageError`] on malformed input or an unsupported format.
#[cfg(feature = "image")]
pub fn decode_image(bytes: &[u8]) -> Result<DecodedImage, ::image::ImageError> {
    let decoded = ::image::load_from_memory(bytes)?;
    let rgba = decoded.to_rgba8();
    let (width, height) = (rgba.width(), rgba.height());
    Ok(DecodedImage {
        width,
        height,
        rgba8: rgba.into_raw(),
    })
}

/// Decodes `bytes` (PNG or JPEG) and returns the color most suitable for a UI theme, `image`
/// crate feature. Equivalent of `sourceColorFromImageBytes` preceded by the reference's
/// `<canvas>` decode step.
///
/// # Errors
///
/// Returns the underlying [`image::ImageError`] on malformed input or an unsupported format.
#[cfg(feature = "image")]
pub fn source_color_from_image_bytes(bytes: &[u8]) -> Result<u32, ::image::ImageError> {
    let decoded = decode_image(bytes)?;
    Ok(source_color_from_rgba8(&decoded.rgba8))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_pixels_return_fallback() {
        assert_eq!(source_color_from_rgba8(&[]), 0xFF42_85F4);
    }

    #[test]
    fn fully_transparent_pixels_return_fallback() {
        let rgba8 = [255u8, 0, 0, 0, 0, 255, 0, 0];
        assert_eq!(source_color_from_rgba8(&rgba8), 0xFF42_85F4);
    }

    #[test]
    fn solid_saturated_color_is_the_source_color() {
        // A single opaque, saturated color: quantization yields one cluster, score keeps it.
        let mut rgba8 = Vec::new();
        for _ in 0..64 {
            rgba8.extend_from_slice(&[0xFFu8, 0x00, 0x00, 0xFF]); // opaque red
        }
        let source = source_color_from_rgba8(&rgba8);
        assert_eq!(color_math::alpha(source), 0xFF);
        // Hue-preserving: red in, a color whose hue matches pure red comes out.
        let hct = crate::hct::Hct::from_argb(source);
        let reference = crate::hct::Hct::from_argb(0xFFFF_0000);
        assert!((hct.hue - reference.hue).abs() < 1.0);
    }
}
