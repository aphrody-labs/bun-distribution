// SPDX-License-Identifier: Apache-2.0
//! COSMIC-style theme building over Material 3 roles.
//!
//! cosmic-theme (libcosmic, MPL-2.0) builds a theme from an accent, a neutral tint and three
//! nested containers (background, primary, secondary), each with a component palette (base,
//! hover, pressed, selected, focus, disabled, divider, border). Bun OS keeps that model because it
//! maps nesting depth to surfaces predictably, but every value comes from the M3 dynamic scheme
//! and the M3 state-layer opacities: nothing here runs a second colour algorithm, so the console
//! shell, the COSMIC Desktop export (`crate::cosmic`) and the web share one source.
//!
//! | COSMIC              | M3 role (container base / component base)                  |
//! |---------------------|------------------------------------------------------------|
//! | `background`        | `surface` / `surface-container`                            |
//! | `primary`           | `surface-container-low` / `surface-container-high`         |
//! | `secondary`         | `surface-container-high` / `surface-container-highest`     |
//! | `accent`            | `primary` / `on-primary`, selected = `secondary-container`  |
//! | `destructive`       | `error` / `on-error`                                       |
//! | neutral tint        | the scheme's neutral palette (surface roles)               |
//! | success / warning   | M3 custom colours harmonised to the seed ([`custom`])      |

use crate::{Color, Role, Theme};

fn opacity(value: f32) -> u8 {
    (value * 255.0 + 0.5) as u8
}

/// One interactive palette (COSMIC `Component`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ComponentColors {
    pub base: Color,
    pub on: Color,
    pub hover: Color,
    pub pressed: Color,
    pub focus: Color,
    pub selected: Color,
    pub selected_text: Color,
    pub disabled: Color,
    pub on_disabled: Color,
    pub divider: Color,
    pub border: Color,
}

impl ComponentColors {
    /// Derive the interaction palette of a `base`/`on` pair with the M3 state layers.
    pub fn derive(theme: Theme, base: Color, on: Color) -> Self {
        let scheme = theme.colors;
        let layer = |l: m3_tokens::state::StateLayer| base.overlay(on, opacity(l.opacity));
        Self {
            base,
            on,
            hover: layer(m3_tokens::state::HOVER),
            pressed: layer(m3_tokens::state::PRESSED),
            focus: scheme.get(Role::Primary),
            selected: scheme.get(Role::SecondaryContainer),
            selected_text: scheme.get(Role::OnSecondaryContainer),
            disabled: Color::TRANSPARENT.overlay(
                scheme.get(Role::OnSurface),
                opacity(m3_tokens::state::DISABLED_CONTAINER.opacity),
            ),
            on_disabled: Color::TRANSPARENT.overlay(
                scheme.get(Role::OnSurface),
                opacity(m3_tokens::state::DISABLED_CONTENT.opacity),
            ),
            divider: scheme.get(Role::OutlineVariant),
            border: scheme.get(Role::Outline),
        }
    }
}

/// One nesting level (COSMIC `Container`): its surface, its text and the controls placed on it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Container {
    pub base: Color,
    pub on: Color,
    pub divider: Color,
    pub component: ComponentColors,
}

/// Nesting depth of a surface, as COSMIC names it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum Depth {
    #[default]
    Background,
    Primary,
    Secondary,
}

/// The full COSMIC-shaped palette of one M3 theme.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Containers {
    pub background: Container,
    pub primary: Container,
    pub secondary: Container,
    pub accent: ComponentColors,
    pub destructive: ComponentColors,
    /// Focus ring / window hint (COSMIC `active_hint` colour).
    pub active_hint: Color,
    pub is_dark: bool,
}

impl Containers {
    pub fn from_theme(theme: Theme) -> Self {
        let s = theme.colors;
        let container = |base: Role, component: Role| Container {
            base: s.get(base),
            on: s.get(Role::OnSurface),
            divider: s.get(Role::OutlineVariant),
            component: ComponentColors::derive(theme, s.get(component), s.get(Role::OnSurface)),
        };
        Self {
            background: container(Role::Surface, Role::SurfaceContainer),
            primary: container(Role::SurfaceContainerLow, Role::SurfaceContainerHigh),
            secondary: container(Role::SurfaceContainerHigh, Role::SurfaceContainerHighest),
            accent: ComponentColors::derive(theme, s.get(Role::Primary), s.get(Role::OnPrimary)),
            destructive: ComponentColors::derive(theme, s.get(Role::Error), s.get(Role::OnError)),
            active_hint: s.get(Role::Primary),
            is_dark: theme.mode == crate::ThemeMode::Dark,
        }
    }

    pub fn get(&self, depth: Depth) -> &Container {
        match depth {
            Depth::Background => &self.background,
            Depth::Primary => &self.primary,
            Depth::Secondary => &self.secondary,
        }
    }

    /// The level a surface placed on `depth` uses (panels on the background are primary, cards
    /// in a panel are secondary; deeper nesting stays secondary).
    pub const fn next(depth: Depth) -> Depth {
        match depth {
            Depth::Background => Depth::Primary,
            Depth::Primary | Depth::Secondary => Depth::Secondary,
        }
    }
}

/// A status colour outside the M3 role set (COSMIC `success` / `warning`), resolved the M3 way:
/// the design colour harmonised toward the theme seed, tone 40/100/90/10 (light) or 80/20/30/90
/// (dark). The design colour comes from the theme file, never from this crate.
#[cfg(feature = "std")]
pub fn custom(theme: Theme, seed: u32, design: u32) -> ComponentColors {
    let roles = m3_tokens::blend::custom_color(seed, design, true);
    let group = if theme.mode == crate::ThemeMode::Dark {
        roles.dark
    } else {
        roles.light
    };
    ComponentColors::derive(theme, Color(group.color), Color(group.on_color))
}
