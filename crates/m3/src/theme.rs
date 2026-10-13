// SPDX-License-Identifier: Apache-2.0
//! Theme selection over the canonical Aphrody token implementation.

use serde::{Deserialize, Serialize};

pub use crate::facade::platform::ThemeMode;
use aphrody_m3_tokens::scheme::DynamicScheme;
pub use aphrody_m3_tokens::theme::{ThemeExport, ThemeRequest};

/// Theme context shared by components and rendering adapters.
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
pub struct Theme {
    /// User or system theme preference.
    pub mode: ThemeMode,
}

impl Theme {
    /// Build the product default from the canonical identity owner's measured
    /// pet seed. The generic token engine retains its own M3 baseline default.
    #[must_use]
    pub fn aphrody_request() -> ThemeRequest {
        ThemeRequest::parse(Some(aphrody_identity::design::pet_seed_hex()), None, None)
            .expect("canonical pet seed is an opaque hex color")
    }

    /// Apply the user's contrast preference to an already validated request.
    #[must_use]
    pub const fn request(self, request: ThemeRequest) -> ThemeRequest {
        match self.mode {
            ThemeMode::HighContrast => request.high_contrast(),
            _ => request,
        }
    }

    /// Resolve host darkness and user preference without introducing another
    /// role table. High contrast follows host darkness at MCU contrast level 1.
    #[must_use]
    pub fn scheme(self, request: ThemeRequest, system_dark: bool) -> DynamicScheme {
        let dark = match self.mode {
            ThemeMode::Light => false,
            ThemeMode::Dark => true,
            ThemeMode::System | ThemeMode::HighContrast => system_dark,
        };
        self.request(request).scheme(dark)
    }

    /// Export both modes for Bun, browser, native and OS consumers, applying
    /// the user's high-contrast preference when selected.
    #[must_use]
    pub fn export(self, request: ThemeRequest) -> ThemeExport {
        self.request(request).export()
    }

    /// Produce the baseline M3 CSS variables from the shared token crate.
    #[must_use]
    pub fn baseline_css() -> String {
        aphrody_m3_tokens::color::export_css(&aphrody_m3_tokens::color::BASELINE)
    }
}

#[cfg(test)]
mod tests {
    use super::{Theme, ThemeMode};

    #[test]
    fn theme_mode_uses_the_canonical_token_facade() {
        let mode: crate::facade::platform::ThemeMode = ThemeMode::Dark;
        assert_eq!(mode, crate::facade::platform::ThemeMode::Dark);
    }

    #[test]
    fn baseline_css_comes_from_canonical_tokens() {
        assert!(Theme::baseline_css().contains("--md-sys-color-primary:"));
    }

    #[test]
    fn aphrody_theme_reads_the_identity_seed() {
        let request = Theme::aphrody_request();
        assert_eq!(
            request.export().seed,
            aphrody_identity::design::pet_seed_hex()
        );
        assert_ne!(request.seed(), aphrody_m3_tokens::sheets::BASELINE_SEED);
    }

    #[test]
    fn forced_modes_and_system_preference_resolve_the_same_request() {
        let request = Theme::aphrody_request();
        assert!(
            !Theme {
                mode: ThemeMode::Light
            }
            .scheme(request, true)
            .is_dark
        );
        assert!(
            Theme {
                mode: ThemeMode::Dark
            }
            .scheme(request, false)
            .is_dark
        );
        assert!(Theme::default().scheme(request, true).is_dark);
        assert!(!Theme::default().scheme(request, false).is_dark);
    }

    #[test]
    fn high_contrast_preserves_seed_variant_and_host_mode() {
        let request = Theme::aphrody_request();
        let theme = Theme {
            mode: ThemeMode::HighContrast,
        };
        let scheme = theme.scheme(request, true);
        assert!(scheme.is_dark);
        assert_eq!(scheme.contrast_level, 1.0);
        assert_eq!(scheme.variant, request.variant());
        let exported = theme.export(request);
        assert_eq!(exported.seed, request.export().seed);
        assert_eq!(exported.contrast_level, 1.0);
    }
}
