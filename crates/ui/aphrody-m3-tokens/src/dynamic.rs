// SPDX-License-Identifier: Apache-2.0
//! Dynamic colour shortcuts: the 13-stop tonal palette of a seed.
//!
//! The colour science lives in [`crate::hct`] (HCT and its solver), [`crate::palette`] (tonal
//! palettes) and [`crate::scheme`] (every M3 role of a scheme); this module keeps the original
//! seed-to-palette entry points on top of them.
//!
//! ```rust
//! use aphrody_m3_tokens::dynamic::{TONE_VALUES, seed_to_palette};
//! let palette = seed_to_palette(0xFF67_50A4);
//! assert_eq!(palette.len(), TONE_VALUES.len());
//! assert_eq!(palette[0].0, 0xFF00_0000); // tone 0 is black
//! assert_eq!(palette[12].0, 0xFFFF_FFFF); // tone 100 is white
//! ```

pub use crate::hct::Hct;
use crate::palette::TonalPalette;

/// An opaque ARGB colour with channel accessors.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Argb(pub u32);

impl Argb {
    /// Red channel.
    #[inline]
    #[must_use]
    pub fn red(self) -> u8 {
        crate::color_math::red(self.0)
    }

    /// Green channel.
    #[inline]
    #[must_use]
    pub fn green(self) -> u8 {
        crate::color_math::green(self.0)
    }

    /// Blue channel.
    #[inline]
    #[must_use]
    pub fn blue(self) -> u8 {
        crate::color_math::blue(self.0)
    }

    /// Alpha channel.
    #[inline]
    #[must_use]
    pub fn alpha(self) -> u8 {
        (self.0 >> 24) as u8
    }
}

/// The 13 tones of an M3 tonal palette.
pub const TONE_VALUES: [u8; 13] = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 95, 99, 100];

/// The [`TONE_VALUES`] of the palette with `hct`'s hue and chroma.
#[must_use]
pub fn tones(hct: &Hct) -> [Argb; 13] {
    let palette = TonalPalette::from_hct(*hct);
    core::array::from_fn(|i| Argb(palette.tone(f64::from(TONE_VALUES[i]))))
}

/// The [`TONE_VALUES`] of a seed colour's palette.
#[must_use]
pub fn seed_to_palette(seed_argb: u32) -> [Argb; 13] {
    tones(&Hct::from_argb(seed_argb))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tones_are_opaque_and_ordered_by_lightness() {
        let palette = seed_to_palette(0xFF1A_73E8);
        let mut previous = -1.0;
        for argb in palette {
            assert_eq!(argb.alpha(), 0xFF);
            let tone = Hct::from_argb(argb.0).tone;
            assert!(tone > previous, "tones must increase");
            previous = tone;
        }
    }

    #[test]
    fn tone_40_of_the_seed_palette_is_close_to_the_seed() {
        let seed = 0xFF67_50A4;
        let tone_40 = Hct::from_argb(seed_to_palette(seed)[4].0);
        let original = Hct::from_argb(seed);
        assert!((tone_40.hue - original.hue).abs() < 1.0);
        assert!((tone_40.tone - 40.0).abs() < 0.5);
    }
}
