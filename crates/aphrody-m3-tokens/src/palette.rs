// SPDX-License-Identifier: Apache-2.0
//! Tonal palettes: one hue and chroma, every tone from 0 to 100.
//!
//! Exact port of `palettes/tonal_palette.ts` and `palettes/core_palette.ts` from
//! [material-color-utilities] (Apache-2.0), including the key-colour search and the yellow
//! tone-99 special case.
//!
//! [material-color-utilities]: https://github.com/material-foundation/material-color-utilities

use crate::{color_math::js_round, hct::Hct};

/// A hue and chroma, and the colours they produce at every tone.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct TonalPalette {
    /// Hue in degrees.
    pub hue: f64,
    /// Requested chroma; a tone may render with less when the gamut is narrower.
    pub chroma: f64,
    /// The colour of this palette closest to tone 50 that reaches the requested chroma.
    pub key_color: Hct,
}

impl TonalPalette {
    /// The palette of an ARGB colour's hue and chroma, keyed on that colour.
    #[must_use]
    pub fn from_argb(argb: u32) -> Self {
        Self::from_hct(Hct::from_argb(argb))
    }

    /// The palette of an HCT colour's hue and chroma, keyed on that colour.
    #[must_use]
    pub fn from_hct(hct: Hct) -> Self {
        Self {
            hue: hct.hue,
            chroma: hct.chroma,
            key_color: hct,
        }
    }

    /// The palette of `hue` and `chroma`, with its key colour searched for.
    #[must_use]
    pub fn from_hue_and_chroma(hue: f64, chroma: f64) -> Self {
        Self {
            hue,
            chroma,
            key_color: key_color(hue, chroma),
        }
    }

    /// ARGB at `tone` (0..=100).
    #[must_use]
    pub fn tone(&self, tone: f64) -> u32 {
        if tone == 99.0 && Hct::is_yellow(self.hue) {
            average_argb(self.tone(98.0), self.tone(100.0))
        } else {
            Hct::new(self.hue, self.chroma, tone).to_argb()
        }
    }

    /// HCT at `tone`.
    #[must_use]
    pub fn hct(&self, tone: f64) -> Hct {
        Hct::from_argb(self.tone(tone))
    }
}

fn average_argb(argb1: u32, argb2: u32) -> u32 {
    let channel = |shift: u32| {
        let a = f64::from((argb1 >> shift) & 0xFF);
        let b = f64::from((argb2 >> shift) & 0xFF);
        // A mean of two bytes, rounded, is a byte.
        js_round((a + b) / 2.0) as u32 & 0xFF
    };
    0xFF00_0000 | channel(16) << 16 | channel(8) << 8 | channel(0)
}

/// Binary search for the tone closest to 50 that reaches `requested_chroma` (`KeyColor.create`).
fn key_color(hue: f64, requested_chroma: f64) -> Hct {
    const PIVOT_TONE: i32 = 50;
    const EPSILON: f64 = 0.01;
    const MAX_CHROMA: f64 = 200.0;
    let mut cache = [f64::NAN; 102];
    let mut max_chroma = |tone: i32| {
        let slot = &mut cache[tone as usize];
        if slot.is_nan() {
            *slot = Hct::new(hue, MAX_CHROMA, f64::from(tone)).chroma;
        }
        *slot
    };
    let mut lower_tone = 0;
    let mut upper_tone = 100;
    while lower_tone < upper_tone {
        let mid_tone = (lower_tone + upper_tone) / 2;
        let is_ascending = max_chroma(mid_tone) < max_chroma(mid_tone + 1);
        let sufficient_chroma = max_chroma(mid_tone) >= requested_chroma - EPSILON;
        if sufficient_chroma {
            if (lower_tone - PIVOT_TONE).abs() < (upper_tone - PIVOT_TONE).abs() {
                upper_tone = mid_tone;
            } else {
                if lower_tone == mid_tone {
                    return Hct::new(hue, requested_chroma, f64::from(lower_tone));
                }
                lower_tone = mid_tone;
            }
        } else if is_ascending {
            lower_tone = mid_tone + 1;
        } else {
            upper_tone = mid_tone;
        }
    }
    Hct::new(hue, requested_chroma, f64::from(lower_tone))
}

/// The legacy five-palette set of a source colour (`CorePalette.of`), used by custom colours
/// and the published M3 baseline.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct CorePalette {
    /// Primary: the source hue at chroma `max(48, source chroma)`.
    pub a1: TonalPalette,
    /// Secondary: the source hue at chroma 16.
    pub a2: TonalPalette,
    /// Tertiary: the source hue + 60° at chroma 24.
    pub a3: TonalPalette,
    /// Neutral: the source hue at chroma 4.
    pub n1: TonalPalette,
    /// Neutral variant: the source hue at chroma 8.
    pub n2: TonalPalette,
    /// Error: hue 25, chroma 84.
    pub error: TonalPalette,
}

impl CorePalette {
    /// The core palette of an ARGB colour.
    #[must_use]
    pub fn of(argb: u32) -> Self {
        let hct = Hct::from_argb(argb);
        let (hue, chroma) = (hct.hue, hct.chroma);
        Self {
            a1: TonalPalette::from_hue_and_chroma(hue, chroma.max(48.0)),
            a2: TonalPalette::from_hue_and_chroma(hue, 16.0),
            a3: TonalPalette::from_hue_and_chroma(hue + 60.0, 24.0),
            n1: TonalPalette::from_hue_and_chroma(hue, 4.0),
            n2: TonalPalette::from_hue_and_chroma(hue, 8.0),
            error: TonalPalette::from_hue_and_chroma(25.0, 84.0),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extreme_tones() {
        let palette = TonalPalette::from_hue_and_chroma(270.0, 36.0);
        assert_eq!(palette.tone(0.0), 0xFF00_0000);
        assert_eq!(palette.tone(100.0), 0xFFFF_FFFF);
    }

    #[test]
    fn key_color_reaches_the_requested_chroma_near_tone_50() {
        let palette = TonalPalette::from_hue_and_chroma(50.0, 16.0);
        assert!((palette.key_color.chroma - 16.0).abs() < 0.5);
        assert!((palette.key_color.tone - 50.0).abs() < 10.0);
    }

    #[test]
    fn yellow_tone_99_averages_98_and_100() {
        let palette = TonalPalette::from_hue_and_chroma(110.0, 60.0);
        assert_eq!(
            palette.tone(99.0),
            average_argb(palette.tone(98.0), palette.tone(100.0))
        );
    }
}
