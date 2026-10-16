// SPDX-License-Identifier: Apache-2.0
//! SpaceUI → Material Design 3 fusion.
//!
//! [SpaceUI](https://github.com/spacedriveapp/spaceui) (vendored under
//! `packages/aphrody-spaceui`) styles its components with a flat semantic
//! vocabulary: `app-*` surfaces, `ink-*` text, `sidebar-*`, `menu-*`, one
//! `accent` and four `status-*` colors, shipped as seven hand-tuned HSL themes.
//! This module maps that vocabulary onto the M3 system: every SpaceUI token
//! becomes either an M3 color role or an M3 state layer (content role at a
//! state opacity over a container role), and every SpaceUI theme becomes a
//! seed (accent + neutral hue/chroma) for an M3 dynamic scheme.
//!
//! The same tables are mirrored by `m3/packages/m3-theme/generate-fusion.ts`,
//! which renders them to `spaceui.css`; `m3/packages/m3-theme/test/spaceui.test.ts`
//! fails when the two copies drift. See `docs/design/SPACEUI-M3-FUSION.md`.

use crate::state;

/// How a SpaceUI token resolves against the M3 system colors.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Source {
    /// A plain M3 color role (the suffix after `--md-sys-color-`).
    Role(&'static str),
    /// An M3 state layer: `content` at `opacity` composited over `base`.
    Layer {
        /// Role whose color tints the layer (the element's `on-*` color).
        content: &'static str,
        /// State-layer opacity, one of the [`crate::state`] values.
        opacity: f32,
        /// Container role the layer sits on.
        base: &'static str,
    },
    /// An M3 extended (custom) color role, emitted as `--md-ext-color-*`.
    Extended(&'static str),
}

const fn role(name: &'static str) -> Source {
    Source::Role(name)
}

const fn hover(base: &'static str) -> Source {
    Source::Layer {
        content: "on-surface",
        opacity: state::HOVER.opacity,
        base,
    }
}

const fn pressed(base: &'static str) -> Source {
    Source::Layer {
        content: "on-surface",
        opacity: state::PRESSED.opacity,
        base,
    }
}

/// Every SpaceUI color token (the suffix after `--color-`) and its M3 source.
///
/// Rules applied:
/// - text: `ink` → `on-surface`, `ink-dull` → `on-surface-variant`, `ink-faint` → `outline`;
/// - surfaces follow the M3 container ladder (`app` = `surface`, boxes = containers, inputs =
///   `surface-container-highest` like a filled text field, overlays = `surface-container-high`,
///   menus = `surface-container`, sidebar = `surface-container-low` like a navigation drawer);
/// - separators are `outline-variant`, shades are `shadow`;
/// - selection is `secondary-container` (M3 active indicator), hover and active are state layers of
///   `on-surface` over the container they sit on;
/// - `accent` is `primary`; its faint/deep variants are the hover/pressed state layers of
///   `on-primary` over `primary`;
/// - `status-error` is `error`, `status-info` is `primary`, success and warning are M3 extended
///   colors harmonized with the scheme source.
pub const ALIAS_MAP: &[(&str, Source)] = &[
    // Accent
    ("accent", role("primary")),
    (
        "accent-faint",
        Source::Layer {
            content: "on-primary",
            opacity: state::HOVER.opacity,
            base: "primary",
        },
    ),
    (
        "accent-deep",
        Source::Layer {
            content: "on-primary",
            opacity: state::PRESSED.opacity,
            base: "primary",
        },
    ),
    // Text
    ("ink", role("on-surface")),
    ("ink-dull", role("on-surface-variant")),
    ("ink-faint", role("outline")),
    // App surfaces
    ("app", role("surface")),
    ("app-box", role("surface-container")),
    ("app-dark-box", role("surface-container-low")),
    ("app-darker-box", role("surface-container-lowest")),
    ("app-light-box", role("surface-container-highest")),
    ("app-overlay", role("surface-container-high")),
    ("app-overlay-shade", role("surface-container-highest")),
    ("app-input", role("surface-container-highest")),
    ("app-focus", role("surface-container-lowest")),
    ("app-line", role("outline-variant")),
    ("app-divider", role("outline-variant")),
    ("app-button", role("surface-container-high")),
    ("app-selected", role("secondary-container")),
    ("app-selected-item", pressed("surface-container")),
    ("app-hover", hover("surface-container")),
    ("app-active", pressed("surface-container")),
    ("app-shade", role("shadow")),
    ("app-frame", role("outline-variant")),
    ("app-slider", role("surface-container-highest")),
    ("app-explorer-scrollbar", role("outline-variant")),
    // Sidebar (M3 navigation drawer)
    ("sidebar", role("surface-container-low")),
    ("sidebar-box", role("surface-container")),
    ("sidebar-line", role("outline-variant")),
    ("sidebar-ink", role("on-surface")),
    ("sidebar-ink-dull", role("on-surface-variant")),
    ("sidebar-ink-faint", role("outline")),
    ("sidebar-divider", role("outline-variant")),
    ("sidebar-button", role("surface-container-high")),
    ("sidebar-selected", role("secondary-container")),
    ("sidebar-shade", role("shadow")),
    // Menu (M3 menu)
    ("menu", role("surface-container")),
    ("menu-line", role("outline-variant")),
    ("menu-ink", role("on-surface")),
    ("menu-faint", role("on-surface-variant")),
    ("menu-hover", hover("surface-container")),
    ("menu-selected", role("secondary-container")),
    ("menu-shade", role("shadow")),
    // Status
    ("status-success", Source::Extended("success")),
    ("status-warning", Source::Extended("warning")),
    ("status-error", role("error")),
    ("status-info", role("primary")),
];

/// SpaceUI shape tokens (the suffix after `--radius-`) and the M3 corner they alias.
pub const RADIUS_MAP: &[(&str, &str)] = &[
    ("window", "medium"),
    ("lg", "small"),
    ("md", "small"),
    ("sm", "extra-small"),
];

/// One SpaceUI theme expressed as an M3 dynamic-scheme seed.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Theme {
    /// SpaceUI theme name.
    pub name: &'static str,
    /// CSS selectors the upstream theme is applied with.
    pub selectors: &'static [&'static str],
    /// Whether the theme resolves the dark scheme.
    pub dark: bool,
    /// Scheme source and primary key color (the SpaceUI `accent`), ARGB.
    pub accent: u32,
    /// Neutral key color (the SpaceUI `app` surface), ARGB: its hue and chroma seed the M3
    /// neutral and neutral-variant palettes.
    pub neutral: u32,
}

/// SpaceUI accent, `hsl(208 100% 57%)`.
pub const ACCENT: u32 = 0xFF24_99FF;

/// The seven SpaceUI themes, in upstream order. The first one is the default.
pub const THEMES: &[Theme] = &[
    // hsl(235 15% 13%)
    Theme {
        name: "dark",
        selectors: &[":root", ".dark"],
        dark: true,
        accent: ACCENT,
        neutral: 0xFF1C_1D26,
    },
    // hsl(235 5% 100%): the light surface is white, keep the 235° hue at a low chroma.
    Theme {
        name: "light",
        selectors: &[".light", ".vanilla-theme"],
        dark: false,
        accent: ACCENT,
        neutral: 0xFFF2_F2F4,
    },
    // hsl(240 25% 8%)
    Theme {
        name: "midnight",
        selectors: &[".midnight-theme"],
        dark: true,
        accent: ACCENT,
        neutral: 0xFF0F_0F1A,
    },
    // hsl(0 0% 3%)
    Theme {
        name: "noir",
        selectors: &[".noir-theme"],
        dark: true,
        accent: ACCENT,
        neutral: 0xFF08_0808,
    },
    // hsl(220 8% 9%)
    Theme {
        name: "slate",
        selectors: &[".slate-theme"],
        dark: true,
        accent: ACCENT,
        neutral: 0xFF15_1619,
    },
    // hsl(220 18% 12%)
    Theme {
        name: "nord",
        selectors: &[".nord-theme"],
        dark: true,
        accent: ACCENT,
        neutral: 0xFF19_1D24,
    },
    // hsl(25 18% 10%)
    Theme {
        name: "mocha",
        selectors: &[".mocha-theme"],
        dark: true,
        accent: ACCENT,
        neutral: 0xFF1E_1915,
    },
];

/// Seed colors of the M3 extended roles SpaceUI needs (`success`, `warning`), ARGB. They are
/// harmonized toward each scheme's source color when rendered.
pub const EXTENDED: &[(&str, u32)] = &[("success", 0xFF16_A34A), ("warning", 0xFFF5_9E0B)];

/// CSS value of a [`Source`].
#[cfg(feature = "std")]
#[must_use]
pub fn css_value(source: &Source) -> std::string::String {
    match source {
        Source::Role(name) => std::format!("var(--md-sys-color-{name})"),
        Source::Layer {
            content,
            opacity,
            base,
        } => std::format!(
            "color-mix(in srgb, var(--md-sys-color-{content}) {}%, var(--md-sys-color-{base}))",
            percent(*opacity)
        ),
        Source::Extended(name) => std::format!("var(--md-ext-color-{name})"),
    }
}

#[cfg(feature = "std")]
fn percent(opacity: f32) -> u32 {
    // State opacities are exact hundredths (0.08, 0.10, ...).
    (opacity * 100.0).round() as u32
}

/// Emits the Tailwind v4 `@theme inline` block that makes every SpaceUI utility
/// (`bg-app-box`, `text-ink-dull`, `rounded-window`, ...) resolve to the live M3 system.
#[cfg(feature = "std")]
#[must_use]
pub fn export_tailwind_theme() -> std::string::String {
    let mut out = std::string::String::from("@theme inline {\n");
    for (name, source) in ALIAS_MAP {
        out.push_str(&std::format!("  --color-{name}: {};\n", css_value(source)));
    }
    for (name, corner) in RADIUS_MAP {
        out.push_str(&std::format!(
            "  --radius-{name}: var(--md-sys-shape-corner-{corner});\n"
        ));
    }
    out.push('}');
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::color::color_vars;

    fn known_roles() -> std::vec::Vec<&'static str> {
        color_vars(&crate::color::BASELINE)
            .into_iter()
            .map(|(name, _)| name)
            .collect()
    }

    #[test]
    fn every_alias_points_at_an_m3_role() {
        let roles = known_roles();
        for (name, source) in ALIAS_MAP {
            let used: &[&str] = match source {
                Source::Role(r) => &[r],
                Source::Layer { content, base, .. } => &[content, base],
                Source::Extended(e) => {
                    assert!(
                        EXTENDED.iter().any(|(n, _)| n == e),
                        "{name}: unknown extended {e}"
                    );
                    &[]
                }
            };
            for r in used {
                assert!(roles.contains(r), "{name}: `{r}` is not an M3 color role");
            }
        }
    }

    #[test]
    fn covers_every_upstream_token() {
        // Token names extracted from the excluded SpaceUI source package, plus the light-only alias.
        let upstream = include_str!("../tests/fixtures/spaceui-color-token-names.txt");
        for line in upstream.lines() {
            assert!(
                ALIAS_MAP.iter().any(|(n, _)| *n == line),
                "unmapped SpaceUI token `{line}`"
            );
        }
    }

    #[test]
    fn state_layers_use_m3_opacities() {
        for (_, source) in ALIAS_MAP {
            if let Source::Layer { opacity, .. } = source {
                assert!(
                    state::ALL
                        .iter()
                        .any(|s| (s.opacity - opacity).abs() < f32::EPSILON),
                    "{opacity} is not an M3 state-layer opacity"
                );
            }
        }
    }

    #[test]
    fn seven_themes_default_dark() {
        assert_eq!(THEMES.len(), 7);
        assert_eq!(THEMES[0].name, "dark");
        assert!(THEMES[0].selectors.contains(&":root"));
        assert_eq!(THEMES.iter().filter(|t| !t.dark).count(), 1);
    }

    #[cfg(feature = "std")]
    #[test]
    fn tailwind_theme_renders_layers_and_roles() {
        let css = export_tailwind_theme();
        assert!(css.starts_with("@theme inline {"));
        assert!(css.contains("--color-ink: var(--md-sys-color-on-surface);"));
        assert!(css.contains(
            "--color-app-hover: color-mix(in srgb, var(--md-sys-color-on-surface) 8%, \
             var(--md-sys-color-surface-container));"
        ));
        assert!(css.contains("--color-status-success: var(--md-ext-color-success);"));
        assert!(css.contains("--radius-window: var(--md-sys-shape-corner-medium);"));
    }
}
