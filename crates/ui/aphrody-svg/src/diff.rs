// SPDX-License-Identifier: Apache-2.0

//! Pixel comparison: the check behind "pixel-perfect" claims (icon parity against Google's
//! exports, Toriyama redraws against a plate, visual regression of generated SVGs).

use crate::{
    Error, Result,
    raster::{RenderOptions, render},
};

/// Result of a comparison.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct DiffReport {
    pub width: u32,
    pub height: u32,
    /// Pixels whose largest channel delta exceeds the tolerance.
    pub mismatched_pixels: u64,
    /// `mismatched_pixels` as a percentage of all pixels.
    pub mismatched_pct: f64,
    /// Largest channel delta seen (0..=255).
    pub max_delta: u8,
    /// Mean absolute channel delta over all channels.
    pub mean_delta: f64,
}

impl DiffReport {
    /// `true` when no pixel exceeds the tolerance.
    #[must_use]
    pub fn is_match(&self) -> bool {
        self.mismatched_pixels == 0
    }
}

/// Compares two straight RGBA buffers of the same size.
///
/// # Errors
/// [`Error::Invalid`] when a buffer does not hold `width * height * 4` bytes.
pub fn diff_rgba(a: &[u8], b: &[u8], width: u32, height: u32, tolerance: u8) -> Result<DiffReport> {
    let expected = (width as usize) * (height as usize) * 4;
    if a.len() != expected || b.len() != expected {
        return Err(Error::Invalid(format!(
            "buffers must be {expected} bytes ({width}x{height} RGBA)"
        )));
    }
    let (mut mismatched, mut max_delta, mut sum) = (0u64, 0u8, 0u64);
    for (pa, pb) in a.as_chunks::<4>().0.iter().zip(b.as_chunks::<4>().0) {
        let mut worst = 0u8;
        for (ca, cb) in pa.iter().zip(pb) {
            let d = ca.abs_diff(*cb);
            sum += u64::from(d);
            worst = worst.max(d);
        }
        max_delta = max_delta.max(worst);
        if worst > tolerance {
            mismatched += 1;
        }
    }
    let pixels = u64::from(width) * u64::from(height);
    #[expect(clippy::cast_precision_loss, reason = "statistics")]
    let (pct, mean) = if pixels == 0 {
        (0.0, 0.0)
    } else {
        (mismatched as f64 * 100.0 / pixels as f64, sum as f64 / (pixels * 4) as f64)
    };
    Ok(DiffReport {
        width,
        height,
        mismatched_pixels: mismatched,
        mismatched_pct: pct,
        max_delta,
        mean_delta: mean,
    })
}

/// Renders both SVGs at `size` x `size` px and compares them.
///
/// # Errors
/// Rendering failures.
pub fn diff_svg(a: &str, b: &str, size: u32, tolerance: u8) -> Result<DiffReport> {
    let ra = render(a, RenderOptions::square(size))?;
    let rb = render(b, RenderOptions::square(size))?;
    diff_rgba(&ra.rgba, &rb.rgba, size, size, tolerance)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn identical_and_different() {
        let a = r#"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 2 2"><rect width="2" height="2"/></svg>"#;
        let b = r#"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 2 2"><rect width="1" height="2"/></svg>"#;
        assert!(diff_svg(a, a, 16, 0).expect("ok").is_match());
        let d = diff_svg(a, b, 16, 0).expect("ok");
        assert!((d.mismatched_pct - 50.0).abs() < 1e-9, "{d:?}");
        assert_eq!(d.max_delta, 255);
        assert!(diff_rgba(&[0; 4], &[0; 8], 1, 1, 0).is_err());
    }
}
