// SPDX-License-Identifier: Apache-2.0
//! Downscale, frame change detection and JPEG encoding of BGRA frames.

use anyhow::{Context, Result, bail};
use jpeg_encoder::{ColorType, Encoder};

/// Dimensions after integer downscale by `scale` (1..=4); never zero.
pub fn scaled_dims(width: u32, height: u32, scale: u8) -> (u32, u32) {
    let s = u32::from(scale.clamp(1, 4));
    ((width / s).max(1), (height / s).max(1))
}

/// Box-filter downscale of a tightly packed BGRA buffer.
pub fn downscale_bgra(src: &[u8], width: u32, height: u32, scale: u8) -> (Vec<u8>, u32, u32) {
    let s = u32::from(scale.clamp(1, 4));
    if s == 1 || width < s || height < s {
        return (src.to_vec(), width, height);
    }
    let (ow, oh) = scaled_dims(width, height, scale);
    let mut out = vec![0u8; ow as usize * oh as usize * 4];
    let stride = width as usize * 4;
    let su = s as usize;
    let area = (su * su) as u32;
    for oy in 0..oh as usize {
        for ox in 0..ow as usize {
            let mut acc = [0u32; 4];
            for dy in 0..su {
                let row = (oy * su + dy) * stride + ox * su * 4;
                for dx in 0..su {
                    let p = row + dx * 4;
                    for (c, a) in acc.iter_mut().enumerate() {
                        *a += u32::from(src[p + c]);
                    }
                }
            }
            let o = (oy * ow as usize + ox) * 4;
            for (c, a) in acc.iter().enumerate() {
                out[o + c] = (*a / area) as u8;
            }
        }
    }
    (out, ow, oh)
}

/// Cheap 64-bit checksum over every 8-byte word (change detection only).
pub fn frame_hash(data: &[u8]) -> u64 {
    const K: u64 = 0x9E37_79B9_7F4A_7C15;
    let mut h: u64 = data.len() as u64;
    let (words, rest) = data.as_chunks::<8>();
    for c in words {
        let w = u64::from_le_bytes(*c);
        h = (h.rotate_left(5) ^ w).wrapping_mul(K);
    }
    for &b in rest {
        h = (h.rotate_left(5) ^ u64::from(b)).wrapping_mul(K);
    }
    h
}

/// Encode a BGRA frame as JPEG with optional integer downscale.
pub fn encode_jpeg(
    bgra: &[u8],
    width: u32,
    height: u32,
    quality: u8,
    scale: u8,
) -> Result<Vec<u8>> {
    if bgra.len() != width as usize * height as usize * 4 {
        bail!("BGRA buffer does not match {width}x{height}");
    }
    let (buf, w, h) = downscale_bgra(bgra, width, height, scale);
    let w16 = u16::try_from(w).context("frame wider than 65535 px")?;
    let h16 = u16::try_from(h).context("frame taller than 65535 px")?;
    let mut out = Vec::with_capacity(buf.len() / 8);
    Encoder::new(&mut out, quality.clamp(1, 100))
        .encode(&buf, w16, h16, ColorType::Bgra)
        .context("JPEG encode failed")?;
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dims() {
        assert_eq!(scaled_dims(1920, 1080, 1), (1920, 1080));
        assert_eq!(scaled_dims(1920, 1080, 2), (960, 540));
        assert_eq!(scaled_dims(1921, 1081, 4), (480, 270));
        assert_eq!(scaled_dims(2, 2, 4), (1, 1));
        assert_eq!(scaled_dims(100, 100, 0), (100, 100));
    }

    #[test]
    fn box_filter_averages() {
        let a = [0u8, 100, 200, 255];
        let b = [100u8, 200, 0, 255];
        let mut img = Vec::new();
        img.extend_from_slice(&a);
        img.extend_from_slice(&a);
        img.extend_from_slice(&b);
        img.extend_from_slice(&b);
        let (out, w, h) = downscale_bgra(&img, 2, 2, 2);
        assert_eq!((w, h), (1, 1));
        assert_eq!(out, vec![50, 150, 100, 255]);
    }

    #[test]
    fn hash_detects_change() {
        let mut f = vec![7u8; 64 * 64 * 4 + 3];
        let h0 = frame_hash(&f);
        assert_eq!(h0, frame_hash(&f));
        let n = f.len();
        f[n - 1] ^= 1;
        assert_ne!(h0, frame_hash(&f));
        f[n - 1] ^= 1;
        f[1234] ^= 0x10;
        assert_ne!(h0, frame_hash(&f));
    }

    #[test]
    fn jpeg_header() {
        let img = vec![128u8; 32 * 16 * 4];
        let j = encode_jpeg(&img, 32, 16, 70, 2).unwrap();
        assert_eq!(&j[..2], &[0xFF, 0xD8]);
        assert!(encode_jpeg(&img[..10], 32, 16, 70, 1).is_err());
    }
}
