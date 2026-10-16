// SPDX-License-Identifier: Apache-2.0
//! Unified Material 3 facade for Aphrody OS (formerly the `aphrody-m3` crate).
//!
//! The sibling modules of this crate remain the implementation and source of truth. `facade` is
//! the stable integration surface for native Aphrody, Tauri/CEF, WASM and FFI consumers; it
//! deliberately contains no duplicate color, typography or breakpoint tables.
//!
//! ```rust
//! use aphrody_m3_tokens::facade::{export_css, layout::Breakpoint, platform::LayoutContract};
//!
//! let layout = LayoutContract::from_width_dp(1280);
//! assert_eq!(layout.breakpoint, Breakpoint::Large);
//! assert!(export_css().contains("--md-sys-color-primary:"));
//! ```

/// Canonical color roles, dynamic schemes (exact material-color-utilities port) and palettes.
pub mod color {
    #![allow(ambiguous_glob_reexports, unused_imports, unreachable_pub)]
    pub use crate::{
        blend::*, color::*, contrast::*, dynamic::*, hct::*, palette::*, scheme::*, tonal::*,
    };
}

/// Generated CSS sheets (tokens, Tailwind v4, SpaceUI, single scheme).
pub mod sheets {
    pub use crate::sheets::*;
}

/// Canonical adaptive breakpoints, panes, navigation and scaffolds.
pub mod layout {
    pub use crate::adaptive::*;
}

/// Canonical typography and Google Sans descriptors.
pub mod typography {
    pub use crate::{google_sans_code::*, google_sans_flex::*, typography::*};
}

/// Canonical motion, elevation, shape and interaction state tokens.
pub mod motion {
    #![allow(ambiguous_glob_reexports, unused_imports, unreachable_pub)]
    pub use crate::{elevation::*, motion::*, shape::*, state::*};
}

/// Aphrody/Gemini brand tokens and SpaceUI compatibility aliases.
pub mod theme {
    pub use crate::theme::{SCHEMA_VERSION, SPEC_VERSION, ThemeExport, ThemeRequest};
    pub use crate::{gemini_brand::*, spaceui::*};
}

/// Accessibility invariants shared by native and web components.
pub mod accessibility {
    /// Minimum interactive hit target in density-independent pixels.
    pub const MIN_TOUCH_TARGET_DP: u32 = 48;
    /// Standard icon glyph size in density-independent pixels.
    pub const ICON_SIZE_DP: u32 = 24;
    /// Focus-ring thickness in dp (`md.sys.state.focus-indicator.thickness`).
    pub const FOCUS_RING_DP: u32 = 3;
    /// Focus-ring offset outside the component in dp (`md.sys.state.focus-indicator.outer-offset`).
    pub const FOCUS_RING_OFFSET_DP: u32 = 2;
    /// WCAG AA minimum contrast ratio for normal text.
    pub const WCAG_AA_NORMAL_TEXT: f32 = 4.5;
    /// WCAG AA minimum contrast ratio for large text.
    pub const WCAG_AA_LARGE_TEXT: f32 = 3.0;
    /// WCAG AAA minimum contrast ratio for normal text.
    pub const WCAG_AAA_NORMAL_TEXT: f32 = 7.0;
}

/// Material Symbols contract. Glyph data stays in the shared asset bundle;
/// this module carries the platform-neutral selection and variation policy.
pub mod icons {
    use super::platform::IconStyle;

    /// Variable axes used by Material Symbols.
    #[derive(Clone, Copy, Debug, PartialEq)]
    pub struct Variation {
        /// Fill axis, from outlined (`0`) to filled (`1`).
        pub fill: f32,
        /// Weight axis, from thin to bold.
        pub weight: u16,
        /// Grade axis, useful for optical compensation.
        pub grade: i16,
        /// Optical-size axis in points.
        pub optical_size: u16,
    }

    impl Default for Variation {
        fn default() -> Self {
            Self {
                fill: 0.0,
                weight: 400,
                grade: 0,
                optical_size: 24,
            }
        }
    }

    /// A validated icon request consumed by web, Tauri and native renderers.
    #[derive(Clone, Copy, Debug, PartialEq)]
    pub struct IconSpec {
        /// Material Symbols snake_case name.
        pub name: &'static str,
        /// Family selected for this surface.
        pub style: IconStyle,
        /// Variable font axes.
        pub variation: Variation,
        /// Accessible label requirement for standalone controls.
        pub requires_label: bool,
    }

    impl IconSpec {
        /// Create a standard outlined icon request.
        #[must_use]
        pub const fn outlined(name: &'static str) -> Self {
            Self {
                name,
                style: IconStyle::Outlined,
                variation: Variation {
                    fill: 0.0,
                    weight: 400,
                    grade: 0,
                    optical_size: 24,
                },
                requires_label: true,
            }
        }
    }
}

/// Stable platform-neutral system contract shared by native and web clients.
pub mod platform {
    use super::layout::Breakpoint;

    /// Theme preference understood by every Aphrody frontend.
    #[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
    #[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
    #[cfg_attr(feature = "serde", serde(rename_all = "snake_case"))]
    pub enum ThemeMode {
        /// Follow the operating system preference.
        #[default]
        System,
        /// Force the light scheme.
        Light,
        /// Force the dark scheme.
        Dark,
        /// Force high-contrast rendering.
        HighContrast,
    }

    /// Material Symbols visual family.
    #[derive(Clone, Copy, Debug, PartialEq, Eq)]
    pub enum IconStyle {
        /// Rounded family for friendly product surfaces.
        Rounded,
        /// Outlined family for dense tooling and navigation.
        Outlined,
        /// Sharp family for compact system controls.
        Sharp,
    }

    /// A complete layout decision that clients can consume without duplicating
    /// breakpoint logic.
    #[derive(Clone, Copy, Debug, PartialEq, Eq)]
    pub struct LayoutContract {
        /// Classified M3 breakpoint.
        pub breakpoint: Breakpoint,
        /// Recommended number of simultaneous panes.
        pub panes: u8,
        /// Recommended content margin in dp.
        pub margin_dp: u32,
        /// Recommended grid columns.
        pub columns: u8,
    }

    impl LayoutContract {
        /// Resolve the canonical contract from an available width in dp.
        #[must_use]
        pub const fn from_width_dp(width_dp: u32) -> Self {
            let breakpoint = Breakpoint::from_width_dp(width_dp);
            Self {
                breakpoint,
                panes: breakpoint.recommended_panes(),
                margin_dp: breakpoint.margin_dp(),
                columns: breakpoint.grid_columns(),
            }
        }
    }
}

/// Stable version of the facade contract.
pub const API_VERSION: &str = "1.0";

/// Export the baseline light M3 color and adaptive tokens as one CSS payload.
pub fn export_css() -> std::string::String {
    let mut css = crate::color::export_css(&crate::color::BASELINE);
    css.push('\n');
    css.push_str(&crate::adaptive::export_breakpoints_css());
    css
}

/// Export the Aphrody brand CSS used by the M3 web/Tauri layer.
pub fn export_brand_css() -> std::string::String {
    crate::export_aphrody_brand_css()
}

#[cfg(test)]
mod tests {
    use super::platform::LayoutContract;

    #[test]
    fn facade_uses_canonical_adaptive_contract() {
        assert_eq!(LayoutContract::from_width_dp(599).panes, 1);
        assert_eq!(LayoutContract::from_width_dp(840).panes, 2);
        assert_eq!(LayoutContract::from_width_dp(1600).panes, 3);
    }

    #[test]
    fn facade_exports_color_and_breakpoints_once() {
        let css = super::export_css();
        assert!(css.contains("--md-sys-color-primary:"));
        assert!(css.contains("--md-sys-breakpoint-medium: 600px;"));
    }

    #[test]
    fn accessibility_and_icons_are_canonical() {
        assert_eq!(super::accessibility::MIN_TOUCH_TARGET_DP, 48);
        let icon = super::icons::IconSpec::outlined("search");
        assert_eq!(icon.name, "search");
        assert!(icon.requires_label);
    }
}
