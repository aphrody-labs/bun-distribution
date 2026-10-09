// SPDX-License-Identifier: Apache-2.0
//! Theme selection over the canonical Aphrody token implementation.

use serde::{Deserialize, Serialize};

/// Theme preferences carried between native and browser surfaces.
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ThemeMode {
    /// Follow the host operating system.
    #[default]
    System,
    /// Force the light palette.
    Light,
    /// Force the dark palette.
    Dark,
    /// Force high-contrast output.
    HighContrast,
}

impl From<ThemeMode> for crate::facade::platform::ThemeMode {
    fn from(value: ThemeMode) -> Self {
        match value {
            ThemeMode::System => Self::System,
            ThemeMode::Light => Self::Light,
            ThemeMode::Dark => Self::Dark,
            ThemeMode::HighContrast => Self::HighContrast,
        }
    }
}

/// Theme context shared by components and rendering adapters.
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
pub struct Theme {
    /// User or system theme preference.
    pub mode: ThemeMode,
}

impl Theme {
    /// Produce the baseline M3 CSS variables from the shared token crate.
    #[cfg(feature = "native-render")]
    #[must_use]
    pub fn baseline_css() -> String {
        aphrody_m3_tokens::color::export_css(&aphrody_m3_tokens::color::BASELINE)
    }
}

#[cfg(test)]
mod tests {
    use super::{Theme, ThemeMode};

    #[test]
    fn theme_mode_maps_to_the_canonical_token_facade() {
        let mode: crate::facade::platform::ThemeMode = ThemeMode::Dark.into();
        assert_eq!(mode, crate::facade::platform::ThemeMode::Dark);
    }

    #[cfg(feature = "native-render")]
    #[test]
    fn baseline_css_comes_from_canonical_tokens() {
        assert!(Theme::baseline_css().contains("--md-sys-color-primary:"));
    }
}
