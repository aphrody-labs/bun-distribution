// SPDX-License-Identifier: Apache-2.0
//! Material Design 3 tonal palettes — the foundation of dynamic color.
//!
//! # Role in M3 dynamic color
//!
//! Every M3 color scheme is derived from a set of **tonal palettes**.  A tonal
//! palette is a family of colors sharing the same hue and chroma but spanning
//! the full lightness range via discrete *tone* stops.  The M3 baseline system
//! ships six named palettes:
//!
//! | Palette | Seed / hue |
//! |---------|------------|
//! | Primary | `#6750A4` (purple) |
//! | Secondary | `#625B71` |
//! | Tertiary | `#7D5260` |
//! | Error | hue 25 (`#BA1A1A` at tone 40) |
//! | Neutral | `#6750A4` neutral axis |
//! | Neutral Variant | `#6750A4` neutral-variant axis |
//!
//! Color roles (see [`crate::color`]) are **aliases into these palettes**:
//! e.g. `primary` = Primary tone 40, `primary_container` = Primary tone 90.
//!
//! The 13 canonical tone stops used by M3 are:
//! `0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 95, 99, 100`.
//!
//! Reference: <https://m3.material.io/styles/color/the-color-system/key-colors-tones>
//!
//! # no_std
//!
//! This module is fully `no_std` / `no_alloc`.  The `export_css` helper is
//! gated behind `#[cfg(feature = "std")]`.
//!
//! # Provenance
//!
//! Every tone is `CorePalette.of(#6750A4)` of `material-color-utilities`, reproduced by
//! [`crate::palette::CorePalette`]; the `core_palette_parity` test keeps the constants exact.

// ── Tone stop canonical set ──────────────────────────────────────────────────

/// The 13 canonical M3 tone stops, in ascending order.
///
/// These are the indices into every [`Palette::tones`] array.
pub const TONE_VALUES: [u8; 13] = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 95, 99, 100];

// ── Core types ───────────────────────────────────────────────────────────────

/// A single color at a given tone stop within a tonal palette.
///
/// `argb` is an ARGB `u32` (`0xFFRRGGBB`); the alpha byte is always `0xFF`
/// because tonal palette colors are fully opaque by definition.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Tone {
    /// Tone stop value (one of [`TONE_VALUES`]).
    pub value: u8,
    /// Color encoded as ARGB `u32` (`0xFFRRGGBB`).
    pub argb: u32,
}

/// A complete tonal palette: 13 tone stops covering the full lightness range.
///
/// The `tones` array is indexed in the same order as [`TONE_VALUES`]:
/// index 0 → tone 0 (black), index 12 → tone 100 (white).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Palette {
    /// Human-readable identifier matching the M3 CSS variable stem
    /// (e.g. `"primary"`, `"neutral-variant"`).
    pub name: &'static str,
    /// Color stops, one per entry of [`TONE_VALUES`].
    pub tones: [Tone; 13],
}

// ── Macro helpers (private) ──────────────────────────────────────────────────

/// Build a `Tone` from a bare `u8` tone value and a 6-digit hex RGB literal,
/// inserting the `0xFF` alpha byte automatically.
macro_rules! tone {
    ($v:expr, $rgb:expr) => {
        Tone {
            value: $v,
            argb: 0xFF00_0000 | ($rgb as u32),
        }
    };
}

// ── Primary palette ──────────────────────────────────────────────────────────

/// M3 baseline Primary: hue of `#6750A4`, chroma 48.
///
/// `CorePalette.of(#6750A4)` of material-color-utilities (see the module provenance).
pub const PRIMARY_BASELINE: Palette = Palette {
    name: "primary",
    tones: [
        tone!(0, 0x00_0000),
        tone!(10, 0x22_005D),
        tone!(20, 0x38_1E72),
        tone!(30, 0x4F_378A),
        tone!(40, 0x67_50A4),
        tone!(50, 0x80_69BF),
        tone!(60, 0x9A_83DB),
        tone!(70, 0xB6_9DF8),
        tone!(80, 0xCF_BCFF),
        tone!(90, 0xE9_DDFF),
        tone!(95, 0xF6_EEFF),
        tone!(99, 0xFF_FBFF),
        tone!(100, 0xFF_FFFF),
    ],
};

// ── Secondary palette ─────────────────────────────────────────────────────────

/// M3 baseline Secondary: hue of `#6750A4`, chroma 16.
///
/// `CorePalette.of(#6750A4)` of material-color-utilities (see the module provenance).
pub const SECONDARY_BASELINE: Palette = Palette {
    name: "secondary",
    tones: [
        tone!(0, 0x00_0000),
        tone!(10, 0x1E_192B),
        tone!(20, 0x33_2D41),
        tone!(30, 0x4A_4458),
        tone!(40, 0x62_5B71),
        tone!(50, 0x7B_748A),
        tone!(60, 0x95_8DA4),
        tone!(70, 0xB0_A7C0),
        tone!(80, 0xCB_C2DB),
        tone!(90, 0xE8_DEF8),
        tone!(95, 0xF6_EEFF),
        tone!(99, 0xFF_FBFF),
        tone!(100, 0xFF_FFFF),
    ],
};

// ── Tertiary palette ──────────────────────────────────────────────────────────

/// M3 baseline Tertiary: hue of `#6750A4` + 60°, chroma 24.
///
/// `CorePalette.of(#6750A4)` of material-color-utilities (see the module provenance).
pub const TERTIARY_BASELINE: Palette = Palette {
    name: "tertiary",
    tones: [
        tone!(0, 0x00_0000),
        tone!(10, 0x31_101D),
        tone!(20, 0x4A_2532),
        tone!(30, 0x63_3B48),
        tone!(40, 0x7E_5260),
        tone!(50, 0x99_6A79),
        tone!(60, 0xB5_8392),
        tone!(70, 0xD2_9DAD),
        tone!(80, 0xEF_B8C8),
        tone!(90, 0xFF_D9E3),
        tone!(95, 0xFF_ECF0),
        tone!(99, 0xFF_FBFF),
        tone!(100, 0xFF_FFFF),
    ],
};

// ── Error palette ─────────────────────────────────────────────────────────────

/// M3 baseline Error: hue 25, chroma 84.
///
/// `CorePalette.of(#6750A4)` of material-color-utilities (see the module provenance).
pub const ERROR_BASELINE: Palette = Palette {
    name: "error",
    tones: [
        tone!(0, 0x00_0000),
        tone!(10, 0x41_0002),
        tone!(20, 0x69_0005),
        tone!(30, 0x93_000A),
        tone!(40, 0xBA_1A1A),
        tone!(50, 0xDE_3730),
        tone!(60, 0xFF_5449),
        tone!(70, 0xFF_897D),
        tone!(80, 0xFF_B4AB),
        tone!(90, 0xFF_DAD6),
        tone!(95, 0xFF_EDEA),
        tone!(99, 0xFF_FBFF),
        tone!(100, 0xFF_FFFF),
    ],
};

// ── Neutral palette ───────────────────────────────────────────────────────────

/// M3 baseline Neutral: hue of `#6750A4`, chroma 4.
///
/// `CorePalette.of(#6750A4)` of material-color-utilities (see the module provenance).
pub const NEUTRAL_BASELINE: Palette = Palette {
    name: "neutral",
    tones: [
        tone!(0, 0x00_0000),
        tone!(10, 0x1C_1B1E),
        tone!(20, 0x31_3033),
        tone!(30, 0x48_464A),
        tone!(40, 0x60_5D62),
        tone!(50, 0x79_767A),
        tone!(60, 0x93_8F94),
        tone!(70, 0xAE_AAAE),
        tone!(80, 0xCA_C5CA),
        tone!(90, 0xE6_E1E6),
        tone!(95, 0xF4_EFF4),
        tone!(99, 0xFF_FBFF),
        tone!(100, 0xFF_FFFF),
    ],
};

// ── Neutral Variant palette ───────────────────────────────────────────────────

/// M3 baseline Neutral variant: hue of `#6750A4`, chroma 8.
///
/// `CorePalette.of(#6750A4)` of material-color-utilities (see the module provenance).
pub const NEUTRAL_VARIANT_BASELINE: Palette = Palette {
    name: "neutral-variant",
    tones: [
        tone!(0, 0x00_0000),
        tone!(10, 0x1D_1A22),
        tone!(20, 0x32_2F38),
        tone!(30, 0x49_454E),
        tone!(40, 0x61_5D66),
        tone!(50, 0x7A_757F),
        tone!(60, 0x94_8F99),
        tone!(70, 0xAF_A9B4),
        tone!(80, 0xCA_C4CF),
        tone!(90, 0xE7_E0EB),
        tone!(95, 0xF5_EEFA),
        tone!(99, 0xFF_FBFF),
        tone!(100, 0xFF_FFFF),
    ],
};

// ── Aggregated baseline set ───────────────────────────────────────────────────

/// All six M3 baseline tonal palettes in canonical order:
/// Primary, Secondary, Tertiary, Error, Neutral, Neutral Variant.
pub const ALL_BASELINE: [&Palette; 6] = [
    &PRIMARY_BASELINE,
    &SECONDARY_BASELINE,
    &TERTIARY_BASELINE,
    &ERROR_BASELINE,
    &NEUTRAL_BASELINE,
    &NEUTRAL_VARIANT_BASELINE,
];

// ── CSS export (std only) ─────────────────────────────────────────────────────

/// Emits CSS custom properties for all tones in a palette.
///
/// Each tone is written as:
/// ```css
/// --md-ref-palette-primary40: #6750A4;
/// ```
///
/// The variable naming follows the M3 reference token specification:
/// `--md-ref-palette-<name><tone>`.
///
/// This function is only available when the `std` feature is enabled.
///
/// # Example
///
/// ```rust
/// # #[cfg(feature = "std")]
/// # {
/// use aphrody_m3_tokens::tonal::{PRIMARY_BASELINE, export_css};
/// let css = export_css(&PRIMARY_BASELINE);
/// assert!(css.contains("--md-ref-palette-primary40:"));
/// # }
/// ```
#[cfg(feature = "std")]
pub fn export_css(palette: &Palette) -> std::string::String {
    use std::fmt::Write as _;

    let mut out = std::string::String::new();
    for tone in &palette.tones {
        // Strip the alpha byte; all tones are opaque.
        let rgb = tone.argb & 0x00FF_FFFF;
        let _ = writeln!(
            out,
            "--md-ref-palette-{name}{value}: #{rgb:06X};",
            name = palette.name,
            value = tone.value,
        );
    }
    out
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    /// Every palette must have exactly 13 tone entries.
    #[test]
    fn all_palettes_have_13_tones() {
        for palette in ALL_BASELINE {
            assert_eq!(
                palette.tones.len(),
                13,
                "palette '{}' has {} tones, expected 13",
                palette.name,
                palette.tones.len()
            );
        }
    }

    /// The tone `value` field in every entry must match `TONE_VALUES` at the
    /// same index, in order.
    #[test]
    fn tone_values_match_tone_values_const() {
        for palette in ALL_BASELINE {
            for (i, tone) in palette.tones.iter().enumerate() {
                assert_eq!(
                    tone.value, TONE_VALUES[i],
                    "palette '{}' index {i}: tone.value={} but TONE_VALUES[{i}]={}",
                    palette.name, tone.value, TONE_VALUES[i],
                );
            }
        }
    }

    /// Every tone's ARGB value must have `0xFF` in the high byte (fully opaque).
    #[test]
    fn all_tones_are_opaque() {
        for palette in ALL_BASELINE {
            for tone in &palette.tones {
                assert_eq!(
                    tone.argb >> 24,
                    0xFF,
                    "palette '{}' tone {}: alpha byte is {:#04X}, expected 0xFF",
                    palette.name,
                    tone.value,
                    tone.argb >> 24,
                );
            }
        }
    }

    /// M3 canonical assertion: Primary tone 40 == `#6750A4`.
    #[test]
    fn primary_tone_40_is_m3_canonical_purple() {
        let tone_40 = PRIMARY_BASELINE
            .tones
            .iter()
            .find(|t| t.value == 40)
            .expect("tone 40 must exist in primary palette");
        assert_eq!(
            tone_40.argb, 0xFF6750A4,
            "primary tone 40 should be 0xFF6750A4, got {:#010X}",
            tone_40.argb,
        );
    }

    /// CSS export must contain a variable for each of the 13 tone stops.
    #[cfg(feature = "std")]
    #[test]
    fn css_export_emits_13_variables_per_palette() {
        for palette in ALL_BASELINE {
            let css = export_css(palette);
            let count = css.matches("--md-ref-palette-").count();
            assert_eq!(
                count, 13,
                "export_css for '{}' emitted {count} variables, expected 13",
                palette.name,
            );
        }
    }

    /// Spot-check: Primary tone 40 renders as `#6750A4` in the CSS output.
    #[cfg(feature = "std")]
    #[test]
    fn css_export_primary_tone_40_hex() {
        let css = export_css(&PRIMARY_BASELINE);
        assert!(
            css.contains("--md-ref-palette-primary40: #6750A4;"),
            "expected '--md-ref-palette-primary40: #6750A4;' in CSS, got:\n{css}",
        );
    }
}

#[cfg(test)]
mod core_palette_parity {
    /// The baseline palettes are `CorePalette.of(#6750A4)` of material-color-utilities.
    #[test]
    fn baseline_palettes_are_the_core_palette_of_the_baseline_seed() {
        let core = crate::palette::CorePalette::of(0xFF67_50A4);
        for (palette, konst) in [
            (core.a1, &super::PRIMARY_BASELINE),
            (core.a2, &super::SECONDARY_BASELINE),
            (core.a3, &super::TERTIARY_BASELINE),
            (core.error, &super::ERROR_BASELINE),
            (core.n1, &super::NEUTRAL_BASELINE),
            (core.n2, &super::NEUTRAL_VARIANT_BASELINE),
        ] {
            for tone in konst.tones {
                assert_eq!(
                    palette.tone(f64::from(tone.value)),
                    tone.argb,
                    "{} tone {}",
                    konst.name,
                    tone.value
                );
            }
        }
    }
}
