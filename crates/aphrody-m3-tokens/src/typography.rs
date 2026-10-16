// SPDX-License-Identifier: Apache-2.0
//! Material Design 3 type scale.
//!
//! Provides the 15 canonical type styles as compile-time constants.
//! Values are taken from the M3 type scale specification:
//! <https://m3.material.io/styles/typography/type-scale-tokens>
//!
//! All sizes and spacings are in density-independent pixels (dp) as specified
//! by M3.  On the web these map 1:1 to `rem` (base 16 px) or `px` at 1×.

/// A single M3 type style.
///
/// Every field is `'static` or a primitive so the struct can live in read-only
/// data without allocation.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct TypeStyle {
    /// Font family name as declared in the M3 spec.
    /// Baseline value is `"Google Sans Flex"` for all 15 styles.
    pub font: &'static str,
    /// CSS / OpenType numeric weight (100–900).
    pub weight: u16,
    /// Type size in dp.
    pub size_dp: f32,
    /// Line height in dp.
    pub line_height_dp: f32,
    /// Letter spacing in dp (negative values tighten tracking).
    pub letter_spacing_dp: f32,
}

// ── Display ─────────────────────────────────────────────────────────────────

/// Display Large — the largest display style, used for short, important text.
pub const DISPLAY_LARGE: TypeStyle = TypeStyle {
    font: "Google Sans Flex",
    weight: 400,
    size_dp: 57.0,
    line_height_dp: 64.0,
    letter_spacing_dp: -0.25,
};

/// Display Medium.
pub const DISPLAY_MEDIUM: TypeStyle = TypeStyle {
    font: "Google Sans Flex",
    weight: 400,
    size_dp: 45.0,
    line_height_dp: 52.0,
    letter_spacing_dp: 0.0,
};

/// Display Small.
pub const DISPLAY_SMALL: TypeStyle = TypeStyle {
    font: "Google Sans Flex",
    weight: 400,
    size_dp: 36.0,
    line_height_dp: 44.0,
    letter_spacing_dp: 0.0,
};

// ── Headline ────────────────────────────────────────────────────────────────

/// Headline Large — high-emphasis, shorter spans (article titles, dialog headers).
pub const HEADLINE_LARGE: TypeStyle = TypeStyle {
    font: "Google Sans Flex",
    weight: 400,
    size_dp: 32.0,
    line_height_dp: 40.0,
    letter_spacing_dp: 0.0,
};

/// Headline Medium.
pub const HEADLINE_MEDIUM: TypeStyle = TypeStyle {
    font: "Google Sans Flex",
    weight: 400,
    size_dp: 28.0,
    line_height_dp: 36.0,
    letter_spacing_dp: 0.0,
};

/// Headline Small.
pub const HEADLINE_SMALL: TypeStyle = TypeStyle {
    font: "Google Sans Flex",
    weight: 400,
    size_dp: 24.0,
    line_height_dp: 32.0,
    letter_spacing_dp: 0.0,
};

// ── Title ───────────────────────────────────────────────────────────────────

/// Title Large — large, semi-bold titles (app bar, dialog title).
pub const TITLE_LARGE: TypeStyle = TypeStyle {
    font: "Google Sans Flex",
    weight: 400,
    size_dp: 22.0,
    line_height_dp: 28.0,
    letter_spacing_dp: 0.0,
};

/// Title Medium — medium emphasis (list item titles, card titles).
pub const TITLE_MEDIUM: TypeStyle = TypeStyle {
    font: "Google Sans Flex",
    weight: 500,
    size_dp: 16.0,
    line_height_dp: 24.0,
    letter_spacing_dp: 0.15,
};

/// Title Small — smaller component labels (tab labels, chip labels).
pub const TITLE_SMALL: TypeStyle = TypeStyle {
    font: "Google Sans Flex",
    weight: 500,
    size_dp: 14.0,
    line_height_dp: 20.0,
    letter_spacing_dp: 0.1,
};

// ── Body ────────────────────────────────────────────────────────────────────

/// Body Large — default body copy, readable at length.
pub const BODY_LARGE: TypeStyle = TypeStyle {
    font: "Google Sans Flex",
    weight: 400,
    size_dp: 16.0,
    line_height_dp: 24.0,
    letter_spacing_dp: 0.5,
};

/// Body Medium — compact body copy (supporting text, captions with detail).
pub const BODY_MEDIUM: TypeStyle = TypeStyle {
    font: "Google Sans Flex",
    weight: 400,
    size_dp: 14.0,
    line_height_dp: 20.0,
    letter_spacing_dp: 0.25,
};

/// Body Small — smallest body copy (captions, helper text).
pub const BODY_SMALL: TypeStyle = TypeStyle {
    font: "Google Sans Flex",
    weight: 400,
    size_dp: 12.0,
    line_height_dp: 16.0,
    letter_spacing_dp: 0.4,
};

// ── Label ───────────────────────────────────────────────────────────────────

/// Label Large — prominent label for actionable elements (buttons).
pub const LABEL_LARGE: TypeStyle = TypeStyle {
    font: "Google Sans Flex",
    weight: 500,
    size_dp: 14.0,
    line_height_dp: 20.0,
    letter_spacing_dp: 0.1,
};

/// Label Medium — for icon labels, tab bar labels.
pub const LABEL_MEDIUM: TypeStyle = TypeStyle {
    font: "Google Sans Flex",
    weight: 500,
    size_dp: 12.0,
    line_height_dp: 16.0,
    letter_spacing_dp: 0.5,
};

/// Label Small — smallest label, used sparingly (badges, annotation).
pub const LABEL_SMALL: TypeStyle = TypeStyle {
    font: "Google Sans Flex",
    weight: 500,
    size_dp: 11.0,
    line_height_dp: 16.0,
    letter_spacing_dp: 0.5,
};

/// All 15 M3 type styles in canonical specification order.
///
/// Order: Display (L/M/S), Headline (L/M/S), Title (L/M/S),
///        Body (L/M/S), Label (L/M/S).
pub const ALL: [TypeStyle; 15] = [
    DISPLAY_LARGE,
    DISPLAY_MEDIUM,
    DISPLAY_SMALL,
    HEADLINE_LARGE,
    HEADLINE_MEDIUM,
    HEADLINE_SMALL,
    TITLE_LARGE,
    TITLE_MEDIUM,
    TITLE_SMALL,
    BODY_LARGE,
    BODY_MEDIUM,
    BODY_SMALL,
    LABEL_LARGE,
    LABEL_MEDIUM,
    LABEL_SMALL,
];

/// Kebab-case names for each token in [`ALL`] order.
pub const NAMES: [&str; 15] = [
    "display-large",
    "display-medium",
    "display-small",
    "headline-large",
    "headline-medium",
    "headline-small",
    "title-large",
    "title-medium",
    "title-small",
    "body-large",
    "body-medium",
    "body-small",
    "label-large",
    "label-medium",
    "label-small",
];

// ── Emphasized (M3 Expressive) ──────────────────────────────────────────────
//
// Compose `TypeScaleTokens` emphasized styles: same size, line height and font as the base style,
// heavier weight. Display, headline and title-large go to 500; title-medium, title-small and all
// label sizes to 700; body styles to 500. Tracking is unchanged except body-large (0.15) and
// body-medium (0.25). Source: m3/docs/research/m3-expressive-gemini-2026.md section 3.

const fn emphasized(base: TypeStyle, weight: u16) -> TypeStyle {
    TypeStyle { weight, ..base }
}

/// display-large emphasized (weight 500); tracking resets to 0 instead of inheriting -0.25.
pub const DISPLAY_LARGE_EMPHASIZED: TypeStyle = TypeStyle {
    letter_spacing_dp: 0.0,
    ..emphasized(DISPLAY_LARGE, 500)
};

/// display-medium emphasized (weight 500).
pub const DISPLAY_MEDIUM_EMPHASIZED: TypeStyle = emphasized(DISPLAY_MEDIUM, 500);

/// display-small emphasized (weight 500).
pub const DISPLAY_SMALL_EMPHASIZED: TypeStyle = emphasized(DISPLAY_SMALL, 500);

/// headline-large emphasized (weight 500).
pub const HEADLINE_LARGE_EMPHASIZED: TypeStyle = emphasized(HEADLINE_LARGE, 500);

/// headline-medium emphasized (weight 500).
pub const HEADLINE_MEDIUM_EMPHASIZED: TypeStyle = emphasized(HEADLINE_MEDIUM, 500);

/// headline-small emphasized (weight 500).
pub const HEADLINE_SMALL_EMPHASIZED: TypeStyle = emphasized(HEADLINE_SMALL, 500);

/// title-large emphasized (weight 500).
pub const TITLE_LARGE_EMPHASIZED: TypeStyle = emphasized(TITLE_LARGE, 500);

/// title-medium emphasized (weight 700).
pub const TITLE_MEDIUM_EMPHASIZED: TypeStyle = emphasized(TITLE_MEDIUM, 700);

/// title-small emphasized (weight 700).
pub const TITLE_SMALL_EMPHASIZED: TypeStyle = emphasized(TITLE_SMALL, 700);

/// body-large emphasized (weight 500).
pub const BODY_LARGE_EMPHASIZED: TypeStyle = TypeStyle {
    letter_spacing_dp: 0.15,
    ..emphasized(BODY_LARGE, 500)
};

/// body-medium emphasized (weight 500).
pub const BODY_MEDIUM_EMPHASIZED: TypeStyle = emphasized(BODY_MEDIUM, 500);

/// body-small emphasized (weight 500).
pub const BODY_SMALL_EMPHASIZED: TypeStyle = emphasized(BODY_SMALL, 500);

/// label-large emphasized (weight 700).
pub const LABEL_LARGE_EMPHASIZED: TypeStyle = emphasized(LABEL_LARGE, 700);

/// label-medium emphasized (weight 700).
pub const LABEL_MEDIUM_EMPHASIZED: TypeStyle = emphasized(LABEL_MEDIUM, 700);

/// label-small emphasized (weight 700).
pub const LABEL_SMALL_EMPHASIZED: TypeStyle = emphasized(LABEL_SMALL, 700);

/// All 15 emphasized styles, in the order of [`ALL`].
pub const ALL_EMPHASIZED: [TypeStyle; 15] = [
    DISPLAY_LARGE_EMPHASIZED,
    DISPLAY_MEDIUM_EMPHASIZED,
    DISPLAY_SMALL_EMPHASIZED,
    HEADLINE_LARGE_EMPHASIZED,
    HEADLINE_MEDIUM_EMPHASIZED,
    HEADLINE_SMALL_EMPHASIZED,
    TITLE_LARGE_EMPHASIZED,
    TITLE_MEDIUM_EMPHASIZED,
    TITLE_SMALL_EMPHASIZED,
    BODY_LARGE_EMPHASIZED,
    BODY_MEDIUM_EMPHASIZED,
    BODY_SMALL_EMPHASIZED,
    LABEL_LARGE_EMPHASIZED,
    LABEL_MEDIUM_EMPHASIZED,
    LABEL_SMALL_EMPHASIZED,
];

/// Gemini web variable weights (GEM, observed 2026-10-02): display-large is served at 280 or 400.
pub const GEMINI_DISPLAY_LARGE_WEIGHT: u16 = 280;

/// Gemini web variable weight of headline-large (350 or 400 served).
pub const GEMINI_HEADLINE_LARGE_WEIGHT: u16 = 350;

impl TypeStyle {
    /// This style with an arbitrary variable-font weight (Google Sans Flex `wght` axis, 1..=1000).
    #[must_use]
    pub const fn with_weight(self, weight: u16) -> Self {
        Self { weight, ..self }
    }

    /// The `wght` and `ROND` axis settings for this style at roundness `rond` (0..=100).
    ///
    /// The optical size follows the style size, as Gemini web does.
    #[must_use]
    pub fn axis_settings(&self, rond: f32) -> crate::google_sans_flex::AxisSettings {
        crate::google_sans_flex::AxisSettings {
            wght: f32::from(self.weight),
            opsz: self.size_dp,
            rond,
            ..crate::google_sans_flex::AxisSettings::DEFAULT
        }
        .clamped()
    }
}

/// Emits a CSS `:root` block declaring all M3 typography custom properties.
#[cfg(feature = "std")]
#[must_use]
pub fn export_css() -> std::string::String {
    let mut out = std::string::String::with_capacity(2048);
    out.push_str(":root {\n");
    for (style, name) in ALL.iter().zip(NAMES.iter()) {
        out.push_str(&std::format!(
            "  --md-sys-typescale-{name}-font-family: '{}';\n\x20 \
             --md-sys-typescale-{name}-font-weight: {weight};\n\x20 \
             --md-sys-typescale-{name}-size: {size}px;\n\x20 \
             --md-sys-typescale-{name}-line-height: {line_height}px;\n\x20 \
             --md-sys-typescale-{name}-letter-spacing: {letter_spacing}px;\n",
            style.font,
            name = name,
            weight = style.weight,
            size = style.size_dp,
            line_height = style.line_height_dp,
            letter_spacing = style.letter_spacing_dp,
        ));
    }
    out.push('}');
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn type_scale_has_exactly_15_styles() {
        assert_eq!(ALL.len(), 15, "M3 type scale must have exactly 15 styles");
    }

    #[test]
    fn display_large_matches_spec() {
        assert_eq!(DISPLAY_LARGE.size_dp, 57.0);
        assert_eq!(DISPLAY_LARGE.line_height_dp, 64.0);
        assert_eq!(DISPLAY_LARGE.weight, 400);
    }

    #[test]
    fn label_large_matches_spec() {
        assert_eq!(LABEL_LARGE.size_dp, 14.0);
        assert_eq!(LABEL_LARGE.weight, 500);
    }

    #[test]
    fn all_fonts_are_google_sans_flex() {
        for style in &ALL {
            assert_eq!(style.font, "Google Sans Flex");
        }
    }

    #[test]
    fn emphasized_styles_follow_compose_weights() {
        assert_eq!(ALL_EMPHASIZED.len(), 15);
        for (base, emph) in ALL.iter().zip(&ALL_EMPHASIZED) {
            assert_eq!(base.size_dp, emph.size_dp);
            assert_eq!(base.line_height_dp, emph.line_height_dp);
            assert!(emph.weight > base.weight);
        }
        assert_eq!(DISPLAY_LARGE_EMPHASIZED.weight, 500);
        assert_eq!(TITLE_LARGE_EMPHASIZED.weight, 500);
        assert_eq!(TITLE_MEDIUM_EMPHASIZED.weight, 700);
        assert_eq!(LABEL_SMALL_EMPHASIZED.weight, 700);
        assert_eq!(BODY_SMALL_EMPHASIZED.weight, 500);
        assert_eq!(DISPLAY_LARGE_EMPHASIZED.letter_spacing_dp, 0.0);
        assert_eq!(BODY_LARGE_EMPHASIZED.letter_spacing_dp, 0.15);
        assert_eq!(BODY_MEDIUM_EMPHASIZED.letter_spacing_dp, 0.25);
    }

    #[test]
    fn variable_weight_and_rond_axes() {
        let style = DISPLAY_LARGE.with_weight(GEMINI_DISPLAY_LARGE_WEIGHT);
        let axes = style.axis_settings(60.0);
        assert_eq!(axes.wght, 280.0);
        assert_eq!(axes.rond, 60.0);
        assert_eq!(axes.opsz, 57.0);
        assert_eq!(style.axis_settings(500.0).rond, 100.0);
    }

    #[test]
    fn all_sizes_are_positive() {
        for style in &ALL {
            assert!(style.size_dp > 0.0);
            assert!(style.line_height_dp > 0.0);
        }
    }
}
