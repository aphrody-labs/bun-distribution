//! Material 3 dark theme for the shell, resolved from the canonical token engine
//! (`aphrody-m3-tokens`, baseline seed #6750A4, tonal spot: the same values as
//! `packages/m3-theme/tokens.css` and design-system/bun-os-play/MASTER.md), plus the type scale,
//! shape and spacing tokens in 1080p design units (`UiScale` maps them to the window).

use aphrody_m3_tokens::scheme::Role;
use aphrody_m3_tokens::theme::ThemeRequest;
use bevy::prelude::*;

#[derive(Resource, Clone, Debug)]
pub struct Theme {
    pub primary: Color,
    pub on_primary: Color,
    pub primary_container: Color,
    pub on_primary_container: Color,
    pub secondary_container: Color,
    pub on_secondary_container: Color,
    pub tertiary: Color,
    pub tertiary_container: Color,
    pub on_tertiary_container: Color,
    pub surface: Color,
    pub surface_dim: Color,
    pub on_surface: Color,
    pub on_surface_variant: Color,
    pub surface_container_lowest: Color,
    pub surface_container_low: Color,
    pub surface_container: Color,
    pub surface_container_high: Color,
    pub surface_container_highest: Color,
    pub outline: Color,
    pub outline_variant: Color,
    pub error: Color,
    pub scrim: Color,
}

fn color(argb: u32) -> Color {
    Color::srgba_u8(
        (argb >> 16) as u8,
        (argb >> 8) as u8,
        argb as u8,
        (argb >> 24) as u8,
    )
}

impl Default for Theme {
    fn default() -> Self {
        let scheme = ThemeRequest::default().scheme(true);
        let c = |role| color(scheme.argb(role));
        Self {
            primary: c(Role::Primary),
            on_primary: c(Role::OnPrimary),
            primary_container: c(Role::PrimaryContainer),
            on_primary_container: c(Role::OnPrimaryContainer),
            secondary_container: c(Role::SecondaryContainer),
            on_secondary_container: c(Role::OnSecondaryContainer),
            tertiary: c(Role::Tertiary),
            tertiary_container: c(Role::TertiaryContainer),
            on_tertiary_container: c(Role::OnTertiaryContainer),
            surface: c(Role::Surface),
            surface_dim: c(Role::SurfaceDim),
            on_surface: c(Role::OnSurface),
            on_surface_variant: c(Role::OnSurfaceVariant),
            surface_container_lowest: c(Role::SurfaceContainerLowest),
            surface_container_low: c(Role::SurfaceContainerLow),
            surface_container: c(Role::SurfaceContainer),
            surface_container_high: c(Role::SurfaceContainerHigh),
            surface_container_highest: c(Role::SurfaceContainerHighest),
            outline: c(Role::Outline),
            outline_variant: c(Role::OutlineVariant),
            error: c(Role::Error),
            scrim: c(Role::Scrim),
        }
    }
}

/// M3 type scale (size, weight) at 10-foot scale: the spec sizes x1.25 for a 1080p TV.
pub mod typescale {
    use aphrody_m3_tokens::typography::{self as t, TypeStyle};

    const TV: f32 = 1.25;

    #[derive(Clone, Copy)]
    pub struct Style {
        pub size: f32,
        pub weight: u16,
    }

    const fn of(style: TypeStyle) -> Style {
        Style {
            size: style.size_dp * TV,
            weight: style.weight,
        }
    }

    pub const DISPLAY: Style = of(t::DISPLAY_MEDIUM);
    pub const HEADLINE: Style = of(t::HEADLINE_MEDIUM);
    pub const HEADLINE_SMALL: Style = of(t::HEADLINE_SMALL);
    pub const TITLE: Style = of(t::TITLE_LARGE);
    pub const TITLE_MEDIUM: Style = of(t::TITLE_MEDIUM);
    pub const BODY: Style = of(t::BODY_LARGE);
    pub const BODY_MEDIUM: Style = of(t::BODY_MEDIUM);
    pub const LABEL: Style = of(t::LABEL_LARGE);
    pub const LABEL_SMALL: Style = of(t::LABEL_MEDIUM);
}

/// Shape tokens (`--md-sys-shape-corner-*`) in design pixels.
pub mod shape {
    pub const SMALL: f32 = 8.0;
    pub const MEDIUM: f32 = 12.0;
    pub const LARGE: f32 = 16.0;
    pub const EXTRA_LARGE: f32 = 28.0;
    pub const FULL: f32 = 999.0;
}

/// Spacing tokens of MASTER.md in design pixels.
pub mod space {
    pub const XS: f32 = 4.0;
    pub const SM: f32 = 8.0;
    pub const MD: f32 = 16.0;
    pub const LG: f32 = 24.0;
    pub const XL: f32 = 32.0;
    pub const XXL: f32 = 48.0;
    pub const XXXL: f32 = 64.0;
}

pub fn with_alpha(color: Color, alpha: f32) -> Color {
    color.with_alpha(alpha)
}
