// SPDX-License-Identifier: Apache-2.0
//! WCAG contrast between tones.
//!
//! Exact port of `contrast/contrast.ts` from [material-color-utilities] (Apache-2.0). Tones are
//! L*, so the ratio only needs their luminance.
//!
//! [material-color-utilities]: https://github.com/material-foundation/material-color-utilities

use crate::color_math::{clamp_double, lstar_from_y, y_from_lstar};

/// Contrast ratio (1..=21) between two tones.
#[must_use]
pub fn ratio_of_tones(tone_a: f64, tone_b: f64) -> f64 {
    ratio_of_ys(
        y_from_lstar(clamp_double(0.0, 100.0, tone_a)),
        y_from_lstar(clamp_double(0.0, 100.0, tone_b)),
    )
}

fn ratio_of_ys(y1: f64, y2: f64) -> f64 {
    let lighter = if y1 > y2 { y1 } else { y2 };
    let darker = if lighter == y2 { y1 } else { y2 };
    (lighter + 5.0) / (darker + 5.0)
}

/// A tone at least `ratio` lighter than `tone`, or `-1.0` when none exists.
#[must_use]
pub fn lighter(tone: f64, ratio: f64) -> f64 {
    if !(0.0..=100.0).contains(&tone) {
        return -1.0;
    }
    let dark_y = y_from_lstar(tone);
    let light_y = ratio * (dark_y + 5.0) - 5.0;
    let real_contrast = ratio_of_ys(light_y, dark_y);
    let delta = (real_contrast - ratio).abs();
    if real_contrast < ratio && delta > 0.04 {
        return -1.0;
    }
    let value = lstar_from_y(light_y) + 0.4;
    if (0.0..=100.0).contains(&value) {
        value
    } else {
        -1.0
    }
}

/// A tone at least `ratio` darker than `tone`, or `-1.0` when none exists.
#[must_use]
pub fn darker(tone: f64, ratio: f64) -> f64 {
    if !(0.0..=100.0).contains(&tone) {
        return -1.0;
    }
    let light_y = y_from_lstar(tone);
    let dark_y = (light_y + 5.0) / ratio - 5.0;
    let real_contrast = ratio_of_ys(light_y, dark_y);
    let delta = (real_contrast - ratio).abs();
    if real_contrast < ratio && delta > 0.04 {
        return -1.0;
    }
    let value = lstar_from_y(dark_y) - 0.4;
    if (0.0..=100.0).contains(&value) {
        value
    } else {
        -1.0
    }
}

/// [`lighter`], or white (100) when no tone is light enough.
#[must_use]
pub fn lighter_unsafe(tone: f64, ratio: f64) -> f64 {
    let safe = lighter(tone, ratio);
    if safe < 0.0 { 100.0 } else { safe }
}

/// [`darker`], or black (0) when no tone is dark enough.
#[must_use]
pub fn darker_unsafe(tone: f64, ratio: f64) -> f64 {
    let safe = darker(tone, ratio);
    if safe < 0.0 { 0.0 } else { safe }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn black_on_white_is_21() {
        assert!((ratio_of_tones(0.0, 100.0) - 21.0).abs() < 1e-9);
        assert!((ratio_of_tones(40.0, 40.0) - 1.0).abs() < 1e-12);
    }

    #[test]
    fn lighter_and_darker_reach_the_ratio() {
        let light = lighter(40.0, 4.5);
        assert!(light > 40.0 && ratio_of_tones(40.0, light) >= 4.5 - 0.04);
        let dark = darker(90.0, 7.0);
        assert!(dark < 90.0 && ratio_of_tones(90.0, dark) >= 7.0 - 0.04);
        assert_eq!(lighter(95.0, 21.0), -1.0);
        assert_eq!(darker_unsafe(5.0, 21.0), 0.0);
    }
}
