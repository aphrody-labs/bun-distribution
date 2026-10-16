// SPDX-License-Identifier: Apache-2.0
//! Colour harmonisation and M3 custom (extended) colours.
//!
//! Exact port of `blend/blend.ts` (`harmonize`) and `utils/theme_utils.ts` (`customColor`) from
//! [material-color-utilities] (Apache-2.0). Extended roles such as `success` and `warning` are
//! custom colours harmonised toward the scheme source, as M3 recommends.
//!
//! [material-color-utilities]: https://github.com/material-foundation/material-color-utilities

use crate::{
    color_math::{difference_degrees, rotation_direction, sanitize_degrees},
    hct::Hct,
    palette::CorePalette,
};

/// Rotate `design`'s hue up to 15° toward `source`'s hue, keeping its chroma and tone.
#[must_use]
pub fn harmonize(design: u32, source: u32) -> u32 {
    let from = Hct::from_argb(design);
    let to = Hct::from_argb(source);
    let rotation = (difference_degrees(from.hue, to.hue) * 0.5).min(15.0);
    let hue = sanitize_degrees(from.hue + rotation * rotation_direction(from.hue, to.hue));
    Hct::new(hue, from.chroma, from.tone).to_argb()
}

/// The four roles of one custom colour in one mode.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ColorGroup {
    /// `<name>`.
    pub color: u32,
    /// `on-<name>`.
    pub on_color: u32,
    /// `<name>-container`.
    pub color_container: u32,
    /// `on-<name>-container`.
    pub on_color_container: u32,
}

/// A custom colour resolved for light and dark schemes.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct CustomColor {
    /// The colour actually used (harmonised when requested).
    pub value: u32,
    /// Light-scheme roles.
    pub light: ColorGroup,
    /// Dark-scheme roles.
    pub dark: ColorGroup,
}

/// `customColor(source, { value, blend })`: the tone 40/100/90/10 (light) and 80/20/30/90 (dark)
/// roles of `value`'s primary core palette, after harmonising it toward `source` when `blend`.
#[must_use]
pub fn custom_color(source: u32, value: u32, blend: bool) -> CustomColor {
    let value = if blend {
        harmonize(value, source)
    } else {
        value
    };
    let tones = CorePalette::of(value).a1;
    CustomColor {
        value,
        light: ColorGroup {
            color: tones.tone(40.0),
            on_color: tones.tone(100.0),
            color_container: tones.tone(90.0),
            on_color_container: tones.tone(10.0),
        },
        dark: ColorGroup {
            color: tones.tone(80.0),
            on_color: tones.tone(20.0),
            color_container: tones.tone(30.0),
            on_color_container: tones.tone(90.0),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn harmonize_moves_at_most_15_degrees_toward_the_source() {
        let green = 0xFF16_A34A;
        let harmonized = Hct::from_argb(harmonize(green, 0xFF67_50A4));
        let original = Hct::from_argb(green);
        let moved = difference_degrees(harmonized.hue, original.hue);
        assert!(moved > 0.5 && moved <= 15.5, "moved {moved}");
    }

    #[test]
    fn custom_color_uses_accessible_tones() {
        let success = custom_color(0xFF67_50A4, 0xFF16_A34A, true);
        assert!((Hct::from_argb(success.light.color).tone - 40.0).abs() < 1.0);
        assert!((Hct::from_argb(success.dark.color).tone - 80.0).abs() < 1.0);
        assert_eq!(success.light.on_color, 0xFFFF_FFFF);
    }
}
