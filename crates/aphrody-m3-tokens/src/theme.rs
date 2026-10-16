// SPDX-License-Identifier: Apache-2.0
//! Shared, versioned exports of canonical color and design token tables.
//!
//! Color generation stays in [`crate::scheme`]. This module validates the
//! request once and provides the same 49 roles to native, Bun, WASM and OS
//! consumers. The implemented specification is explicitly 2021; an export is
//! not a claim of parity with the newer 2025 or 2026 specifications.

use std::collections::BTreeMap;

use crate::{
    color_math::{hex_from_argb, lstar_from_argb},
    contrast::ratio_of_tones,
    scheme::{DynamicScheme, Role, Variant},
    sheets::{self, SheetRequest},
};

/// Version of the serialized theme contract.
pub const SCHEMA_VERSION: u8 = 1;
/// Google color specification implemented by the canonical engine.
pub const SPEC_VERSION: &str = "2021";

/// A validated source color, variant and contrast shared by both theme modes.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct ThemeRequest {
    seed: u32,
    variant: Variant,
    contrast_level: f64,
}

impl Default for ThemeRequest {
    fn default() -> Self {
        Self {
            seed: sheets::BASELINE_SEED,
            variant: Variant::TonalSpot,
            contrast_level: 0.0,
        }
    }
}

impl ThemeRequest {
    /// Validate an opaque ARGB seed and the MCU contrast range.
    ///
    /// # Errors
    /// Rejects transparent seeds, non-finite contrast and values outside -1..=1.
    pub fn new(seed: u32, variant: Variant, contrast_level: f64) -> Result<Self, String> {
        if seed >> 24 != 0xFF {
            return Err("theme seed must be opaque ARGB".to_owned());
        }
        if !(-1.0..=1.0).contains(&contrast_level) {
            return Err(format!("contrast {contrast_level} outside -1..=1"));
        }
        Ok(Self {
            seed,
            variant,
            contrast_level,
        })
    }

    /// Parse the same hex seed, variant and contrast accepted by CSS generation.
    ///
    /// Omitted values use the M3 baseline. Product hosts supply their identity
    /// owner's seed rather than embedding a brand color in the token engine.
    ///
    /// # Errors
    /// Unknown variant, invalid hex seed or contrast outside -1..=1.
    pub fn parse(
        seed: Option<&str>,
        variant: Option<&str>,
        contrast_level: Option<f64>,
    ) -> Result<Self, String> {
        let request = SheetRequest::parse("tokens", seed, variant, None, contrast_level)?;
        Self::new(request.seed, request.variant, request.contrast)
    }

    /// Opaque source color in ARGB form.
    #[must_use]
    pub const fn seed(self) -> u32 {
        self.seed
    }

    /// Selected palette variant.
    #[must_use]
    pub const fn variant(self) -> Variant {
        self.variant
    }

    /// Validated MCU contrast level (-1 reduced, 0 standard, 1 high).
    #[must_use]
    pub const fn contrast_level(self) -> f64 {
        self.contrast_level
    }

    /// Resolve one mode through the canonical dynamic scheme.
    #[must_use]
    pub fn scheme(self, dark: bool) -> DynamicScheme {
        DynamicScheme::from_argb(self.seed, self.variant, dark, self.contrast_level)
    }

    /// Raise this request to the canonical maximum-contrast scheme.
    #[must_use]
    pub const fn high_contrast(self) -> Self {
        Self {
            contrast_level: 1.0,
            ..self
        }
    }

    /// All semantic roles in light and dark modes with explicit provenance.
    #[must_use]
    pub fn export(self) -> ThemeExport {
        ThemeExport {
            schema_version: SCHEMA_VERSION,
            spec_version: SPEC_VERSION.to_owned(),
            seed: hex_from_argb(self.seed),
            variant: self.variant.name().to_owned(),
            contrast_level: self.contrast_level,
            light: role_map(&self.scheme(false)),
            dark: role_map(&self.scheme(true)),
        }
    }

    /// Generate light/dark CSS and the existing fusion aliases without copying
    /// the CSS emitter or its role mappings.
    #[must_use]
    pub fn css(self) -> String {
        sheets::tokens_css(self.seed, self.variant, self.contrast_level)
    }

    /// Measure a semantic foreground/background pair using the actual sRGB
    /// colors emitted by the engine, including 8-bit quantization.
    #[must_use]
    pub fn contrast(self, dark: bool, foreground: Role, background: Role) -> f64 {
        let scheme = self.scheme(dark);
        ratio_of_tones(
            lstar_from_argb(scheme.argb(foreground)),
            lstar_from_argb(scheme.argb(background)),
        )
    }
}

fn role_map(scheme: &DynamicScheme) -> BTreeMap<String, String> {
    scheme
        .roles()
        .map(|(role, argb)| (role.camel_name().to_owned(), hex_from_argb(argb)))
        .collect()
}

/// Portable generated theme. Role keys use Google's camel-case names and
/// values are opaque `#rrggbb` colors, with deterministic key ordering.
#[derive(Clone, Debug, PartialEq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize))]
pub struct ThemeExport {
    /// Serialized contract version, independent of the color specification.
    pub schema_version: u8,
    /// Color specification used to generate these roles.
    pub spec_version: String,
    /// Opaque source color as `#rrggbb`.
    pub seed: String,
    /// Canonical kebab-case variant name.
    pub variant: String,
    /// MCU contrast level used for both modes.
    pub contrast_level: f64,
    /// All 49 light semantic roles; palette key colors are not system roles.
    pub light: BTreeMap<String, String>,
    /// All 49 dark semantic roles.
    pub dark: BTreeMap<String, String>,
}

/// Canonical, ordered design token tables for native and UI consumers.
///
/// This snapshots the existing Rust tables without recomputing their values.
/// The color specification in [`ThemeExport`] does not date these separately
/// sourced typography, shape, motion and elevation tables.
#[derive(Clone, Debug, PartialEq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize))]
pub struct TokenTablesExport {
    /// Version of this serialized token table contract.
    pub schema_version: u8,
    /// All ten Material corner-radius tokens, in canonical scale order.
    pub shape: [ShapeTokenExport; 10],
    /// All fifteen standard type styles, in canonical scale order.
    pub typography: [TypeStyleExport; 15],
    /// All fifteen emphasized styles, paired with the standard scale.
    pub typography_emphasized: [TypeStyleExport; 15],
    /// Existing motion curves, durations and web spring fits.
    pub motion: MotionTablesExport,
    /// All six elevation levels, ordered from zero through five.
    pub elevation: [ElevationTokenExport; 6],
}

/// Named density-independent corner radius.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize))]
pub struct ShapeTokenExport {
    /// Canonical kebab-case token name.
    pub name: &'static str,
    /// Corner radius in density-independent pixels.
    pub dp: u16,
}

/// Named type style, preserving all fields of the existing Rust token.
#[derive(Clone, Copy, Debug, PartialEq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize))]
pub struct TypeStyleExport {
    /// Canonical kebab-case type scale name.
    pub name: &'static str,
    /// Font family declared by the source token.
    pub font: &'static str,
    /// OpenType font weight.
    pub weight: u16,
    /// Font size in density-independent pixels.
    pub size_dp: f32,
    /// Line height in density-independent pixels.
    pub line_height_dp: f32,
    /// Letter spacing in density-independent pixels.
    pub letter_spacing_dp: f32,
}

impl TypeStyleExport {
    fn from_token(name: &'static str, token: crate::typography::TypeStyle) -> Self {
        Self {
            name,
            font: token.font,
            weight: token.weight,
            size_dp: token.size_dp,
            line_height_dp: token.line_height_dp,
            letter_spacing_dp: token.letter_spacing_dp,
        }
    }
}

/// Canonical motion tables; web curves are the existing fitted values.
#[derive(Clone, Debug, PartialEq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize))]
pub struct MotionTablesExport {
    /// All seven Material easing curves, excluding the separate legacy scale.
    pub easings: [EasingTokenExport; 7],
    /// All sixteen named duration tokens.
    pub durations: [DurationTokenExport; 16],
    /// All twelve existing expressive and standard web spring fits.
    pub web_springs: [WebSpringExport; 12],
}

/// Named CSS easing curve.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize))]
pub struct EasingTokenExport {
    /// Canonical easing name.
    pub name: &'static str,
    /// Existing CSS cubic-bezier representation.
    pub cubic_bezier: &'static str,
}

/// Named motion duration.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize))]
pub struct DurationTokenExport {
    /// Canonical duration name.
    pub name: &'static str,
    /// Duration in milliseconds.
    pub ms: u16,
}

/// Existing web representation of a native motion spring.
#[derive(Clone, Copy, Debug, PartialEq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize))]
pub struct WebSpringExport {
    /// Canonical spring token name, including scheme, speed and family.
    pub name: &'static str,
    /// Existing cubic-bezier control points in x1, y1, x2, y2 order.
    pub curve: [f32; 4],
    /// Existing fitted duration in milliseconds.
    pub ms: u16,
}

/// Named elevation level and its existing CSS shadow recipe.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize))]
pub struct ElevationTokenExport {
    /// Canonical zero-based elevation level.
    pub level: usize,
    /// Elevation in density-independent pixels.
    pub dp: u8,
    /// Existing CSS box-shadow value.
    pub shadow: &'static str,
}

/// Export every entry of the existing canonical design token tables.
///
/// Array order, names, units and values come directly from the source tables.
/// This does not evaluate a spring, fit a curve or generate a second token set.
#[must_use]
pub fn export_token_tables() -> TokenTablesExport {
    use crate::{elevation, motion, shape, typography};

    TokenTablesExport {
        schema_version: SCHEMA_VERSION,
        shape: std::array::from_fn(|index| ShapeTokenExport {
            name: shape::NAMES[index],
            dp: shape::ALL[index].dp,
        }),
        typography: std::array::from_fn(|index| {
            TypeStyleExport::from_token(typography::NAMES[index], typography::ALL[index])
        }),
        typography_emphasized: std::array::from_fn(|index| {
            TypeStyleExport::from_token(typography::NAMES[index], typography::ALL_EMPHASIZED[index])
        }),
        motion: MotionTablesExport {
            easings: motion::ALL_EASINGS.map(|token| EasingTokenExport {
                name: token.name,
                cubic_bezier: token.cubic_bezier,
            }),
            durations: motion::ALL_DURATIONS.map(|token| DurationTokenExport {
                name: token.name,
                ms: token.ms,
            }),
            web_springs: motion::WEB_SPRINGS.map(|token| WebSpringExport {
                name: token.name,
                curve: [
                    token.curve.x1,
                    token.curve.y1,
                    token.curve.x2,
                    token.curve.y2,
                ],
                ms: token.ms,
            }),
        },
        elevation: std::array::from_fn(|level| ElevationTokenExport {
            level,
            dp: elevation::LEVELS[level].0,
            shadow: elevation::LEVELS[level].1,
        }),
    }
}
