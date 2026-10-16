// SPDX-License-Identifier: Apache-2.0
use crate::{
    ColorScheme,
    tokens::{Motion, SHAPES, Shapes, TYPOGRAPHY, Typography},
};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ThemeMode {
    Light,
    Dark,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Density {
    Touch,
    Desktop,
    Compact,
}

impl Density {
    pub const fn target_height(self) -> u16 {
        match self {
            Self::Touch => 48,
            Self::Desktop => 40,
            Self::Compact => 32,
        }
    }
    pub const fn gap(self) -> u16 {
        match self {
            Self::Touch => 16,
            Self::Desktop => 12,
            Self::Compact => 8,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Theme {
    pub mode: ThemeMode,
    pub colors: ColorScheme,
    pub typography: Typography,
    pub shapes: Shapes,
    pub density: Density,
    pub motion: Motion,
}

impl Theme {
    #[cfg(feature = "std")]
    pub fn light() -> Self {
        Self::from_request(ThemeMode::Light, m3_tokens::theme::ThemeRequest::default())
    }
    #[cfg(feature = "std")]
    pub fn dark() -> Self {
        Self::from_request(ThemeMode::Dark, m3_tokens::theme::ThemeRequest::default())
    }
    #[cfg(feature = "std")]
    pub fn from_request(mode: ThemeMode, request: m3_tokens::theme::ThemeRequest) -> Self {
        Self::new(
            mode,
            ColorScheme::from_dynamic(&request.scheme(mode == ThemeMode::Dark)),
        )
    }
    /// Use the native owner's seed, nine variants and validated contrast contract.
    #[cfg(feature = "std")]
    pub fn from_seed(
        mode: ThemeMode,
        seed: u32,
        variant: m3_tokens::scheme::Variant,
        contrast: f64,
    ) -> Result<Self, std::string::String> {
        Ok(Self::from_request(
            mode,
            m3_tokens::theme::ThemeRequest::new(seed, variant, contrast)?,
        ))
    }
    pub const fn new(mode: ThemeMode, colors: ColorScheme) -> Self {
        Self {
            mode,
            colors,
            typography: TYPOGRAPHY,
            shapes: SHAPES,
            density: Density::Desktop,
            motion: Motion::Standard,
        }
    }
    pub const fn performance(mut self) -> Self {
        self.motion = Motion::Reduced;
        self.density = Density::Compact;
        self
    }
}

#[cfg(feature = "std")]
impl Default for Theme {
    fn default() -> Self {
        Self::light()
    }
}
