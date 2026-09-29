// SPDX-License-Identifier: Apache-2.0
//! A [`ThemePlan`]: the seed color and dynamic-scheme choice a [`crate::ReproductionPlan`] builds
//! its token sheet from, plus the rationale for that choice.

use aphrody_m3_tokens::{color_math, scheme::Variant};
use serde::{Deserialize, Serialize};

/// A seed color and dynamic-scheme choice, with the CSS token sheet it renders to.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThemePlan {
    /// The seed color, opaque ARGB.
    pub seed_argb: u32,
    /// The seed color, `#rrggbb`.
    pub seed_hex: String,
    /// The dynamic-scheme variant chosen (see [`aphrody_m3_tokens::scheme::Variant`]).
    pub variant: String,
    /// `true` for a dark scheme, `false` for light. Reproductions default to light: most sites
    /// are authored light-first, and [`crate::crawl`] does not yet infer a page's preferred
    /// color scheme from `prefers-color-scheme` media queries or `<meta name="color-scheme">`.
    pub dark: bool,
    /// WCAG contrast level, `-1.0..=1.0`. `0.0` is the M3 default.
    pub contrast: f64,
    /// Why this seed and variant were chosen, for the plan's human-readable record.
    pub rationale: String,
    /// The rendered token sheet (`sheets::tokens_css`), ready to write to `tokens.css`.
    pub tokens_css: String,
}

/// A theme from an explicit seed color, defaulting to the M3 reference variant (tonal-spot) at
/// the default contrast.
#[must_use]
pub fn theme_from_seed(seed_argb: u32, rationale: impl Into<String>) -> ThemePlan {
    theme_from_seed_with(seed_argb, Variant::TonalSpot, false, 0.0, rationale)
}

/// As [`theme_from_seed`], with an explicit variant, brightness and contrast.
#[must_use]
pub fn theme_from_seed_with(
    seed_argb: u32,
    variant: Variant,
    dark: bool,
    contrast: f64,
    rationale: impl Into<String>,
) -> ThemePlan {
    let tokens_css = aphrody_m3_tokens::sheets::tokens_css(seed_argb, variant, contrast);
    ThemePlan {
        seed_argb,
        seed_hex: color_math::hex_from_argb(seed_argb),
        variant: format!("{variant:?}"),
        dark,
        contrast,
        rationale: rationale.into(),
        tokens_css,
    }
}

/// A theme seeded by the color most suitable for a UI theme in `png_or_jpeg_bytes` (the reference
/// `sourceColorFromImage` algorithm — quantize to 128 colors, then rank by suitability).
/// `image` feature.
///
/// # Errors
///
/// Returns [`crate::Error::Image`] if `png_or_jpeg_bytes` cannot be decoded.
#[cfg(feature = "image")]
pub fn theme_from_image_bytes(png_or_jpeg_bytes: &[u8]) -> crate::Result<ThemePlan> {
    let seed_argb = aphrody_m3_tokens::image::source_color_from_image_bytes(png_or_jpeg_bytes)?;
    Ok(theme_from_seed(
        seed_argb,
        "dominant color from the capture, ranked by aphrody-m3-tokens::score (proportion + chroma)",
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn theme_from_seed_renders_a_token_sheet() {
        let theme = theme_from_seed(0xFF67_50A4, "test seed");
        assert_eq!(theme.seed_hex, "#6750a4");
        assert!(theme.tokens_css.contains("--md-sys-color-primary"));
    }
}
