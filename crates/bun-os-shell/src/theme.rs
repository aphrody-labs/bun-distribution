//! Material 3 dark schemes for the shell from the canonical token engine (`aphrody-m3-tokens`).
//! The baseline (seed #6750A4, tonal spot) matches `packages/m3-theme/tokens.css` and
//! design-system/bun-os-play/MASTER.md; per DIRECTION.md the live scheme is regenerated from the
//! focused game's art (seed = the art's dominant color through the M3 quantize + score
//! algorithm) and every tinted node follows it. Type scale, shape and spacing tokens are in 1080p
//! design units (`UiScale` maps them to the window).

use aphrody_m3_tokens::motion::CubicBezier;
use aphrody_m3_tokens::scheme::Role;
use bevy::color::Mix;
use bevy::prelude::*;

/// The semantic roles the shell paints with.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum R {
    Primary,
    OnPrimary,
    PrimaryContainer,
    OnPrimaryContainer,
    SecondaryContainer,
    OnSecondaryContainer,
    Tertiary,
    TertiaryContainer,
    OnTertiaryContainer,
    Surface,
    SurfaceDim,
    OnSurface,
    OnSurfaceVariant,
    ContainerLowest,
    ContainerLow,
    Container,
    ContainerHigh,
    ContainerHighest,
    Outline,
    OutlineVariant,
    Scrim,
}

const ROLES: [(R, Role); 21] = [
    (R::Primary, Role::Primary),
    (R::OnPrimary, Role::OnPrimary),
    (R::PrimaryContainer, Role::PrimaryContainer),
    (R::OnPrimaryContainer, Role::OnPrimaryContainer),
    (R::SecondaryContainer, Role::SecondaryContainer),
    (R::OnSecondaryContainer, Role::OnSecondaryContainer),
    (R::Tertiary, Role::Tertiary),
    (R::TertiaryContainer, Role::TertiaryContainer),
    (R::OnTertiaryContainer, Role::OnTertiaryContainer),
    (R::Surface, Role::Surface),
    (R::SurfaceDim, Role::SurfaceDim),
    (R::OnSurface, Role::OnSurface),
    (R::OnSurfaceVariant, Role::OnSurfaceVariant),
    (R::ContainerLowest, Role::SurfaceContainerLowest),
    (R::ContainerLow, Role::SurfaceContainerLow),
    (R::Container, Role::SurfaceContainer),
    (R::ContainerHigh, Role::SurfaceContainerHigh),
    (R::ContainerHighest, Role::SurfaceContainerHighest),
    (R::Outline, Role::Outline),
    (R::OutlineVariant, Role::OutlineVariant),
    (R::Scrim, Role::Scrim),
];

/// The M3 baseline seed (#6750A4).
pub const BASELINE_SEED: u32 = 0xFF67_50A4;

/// One resolved dark scheme.
#[derive(Clone, Debug, PartialEq)]
pub struct Scheme {
    pub seed: u32,
    colors: [Color; 21],
}

fn color(argb: u32) -> Color {
    Color::srgba_u8(
        (argb >> 16) as u8,
        (argb >> 8) as u8,
        argb as u8,
        (argb >> 24) as u8,
    )
}

/// The user's theme file (`usr/etc/bun-os/settings.json` `theme`, `BUN_OS_THEME`, else the
/// baseline of packages/bun-os-platform/themes), resolved by the platform layer: variant,
/// contrast, mode, role overrides and OS high contrast all come from it.
fn platform_theme() -> &'static bun_os_platform::theme::ThemeFile {
    static FILE: std::sync::OnceLock<bun_os_platform::theme::ThemeFile> =
        std::sync::OnceLock::new();
    FILE.get_or_init(|| {
        let paths = bun_os_platform::paths::Paths::discover();
        let settings = bun_os_platform::paths::Settings::read(&paths);
        let id = std::env::var("BUN_OS_THEME").ok().or(settings.theme);
        bun_os_platform::theme::load(&paths, id.as_deref()).unwrap_or_default()
    })
}

/// The theme file's seed (the baseline #6750A4 unless the user's theme sets another).
pub fn theme_seed() -> u32 {
    platform_theme()
        .color
        .seed
        .as_deref()
        .and_then(aphrody_m3_tokens::color_math::argb_from_hex)
        .unwrap_or(BASELINE_SEED)
}

impl Scheme {
    pub fn from_seed(seed: u32) -> Self {
        let file = platform_theme();
        // Art seeds apply only when the theme opts into dynamic color.
        let seed = if file.color.dynamic.as_deref() == Some("none") {
            theme_seed()
        } else {
            seed
        };
        let tokens = bun_os_platform::theme::Tokens::resolve(
            file,
            bun_os_platform::theme::ResolveOptions {
                dark: None,
                high_contrast: bun_os_platform::theme::os_high_contrast(),
                seed: Some(seed | 0xFF00_0000),
                reduced_motion: false,
            },
        );
        let mut colors = [Color::BLACK; 21];
        for (i, (_, role)) in ROLES.iter().enumerate() {
            colors[i] = color(tokens.argb(role.name()));
        }
        Self { seed, colors }
    }

    pub fn get(&self, role: R) -> Color {
        self.colors[ROLES.iter().position(|(r, _)| *r == role).unwrap_or(0)]
    }

    fn mix(&self, other: &Self, t: f32) -> Self {
        let mut colors = self.colors;
        for (c, o) in colors.iter_mut().zip(other.colors) {
            *c = c.mix(&o, t);
        }
        Self {
            seed: other.seed,
            colors,
        }
    }
}

impl Default for Scheme {
    fn default() -> Self {
        Self::from_seed(theme_seed())
    }
}

/// The live scheme: re-tints toward the focused game's scheme in ~300 ms on M3 emphasized easing
/// (an instant swap under reduced motion).
#[derive(Resource, Clone, Debug, Default)]
pub struct Theme {
    pub current: Scheme,
    from: Scheme,
    to: Scheme,
    t: f32,
}

pub const RETINT_SECONDS: f32 = 0.3;

impl Theme {
    pub fn get(&self, role: R) -> Color {
        self.current.get(role)
    }

    pub fn target_seed(&self) -> u32 {
        self.to.seed
    }

    pub fn retint(&mut self, seed: u32, reduced: bool) {
        if self.to.seed == seed {
            return;
        }
        self.from = self.current.clone();
        self.to = Scheme::from_seed(seed);
        self.t = if reduced { 1.0 } else { 0.0 };
        if reduced {
            self.current = self.to.clone();
        }
    }

    /// Advance the re-tint; returns true while it runs.
    pub fn step(&mut self, dt: f32) -> bool {
        if self.t >= 1.0 {
            return false;
        }
        self.t = (self.t + dt / RETINT_SECONDS).min(1.0);
        // `md.sys.motion.easing.emphasized` as its CSS form, cubic-bezier(0.2, 0, 0, 1).
        let curve = CubicBezier {
            x1: 0.2,
            y1: 0.0,
            x2: 0.0,
            y2: 1.0,
        };
        self.current = self.from.mix(&self.to, curve.eval(self.t));
        true
    }

    /// Progress of the current re-tint (0..1), shared by the hero cross-fade.
    pub fn progress(&self) -> f32 {
        self.t
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

    pub const DISPLAY_LARGE: Style = of(t::DISPLAY_LARGE_EMPHASIZED);
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

/// Icon size tokens (Material Symbols optical sizes 20/24/40).
pub mod icon {
    pub const SM: f32 = 20.0;
    pub const MD: f32 = 24.0;
    pub const LG: f32 = 40.0;
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

/// Interaction timing tokens (seconds) and controller feedback.
pub mod timing {
    /// Hold time before a held direction repeats, then the repeat period.
    pub const REPEAT_DELAY: f32 = 0.38;
    pub const REPEAT_RATE: f32 = 0.085;
    /// Toast lifetime.
    pub const TOAST: f32 = 3.5;
    /// Rumble pulses (milliseconds, weak motor, strong motor).
    pub const RUMBLE_NAVIGATE: (u64, f32, f32) = (28, 0.25, 0.0);
    pub const RUMBLE_SELECT: (u64, f32, f32) = (60, 0.5, 0.35);
    pub const RUMBLE_BACK: (u64, f32, f32) = (40, 0.35, 0.0);
    pub const RUMBLE_OPEN: (u64, f32, f32) = (90, 0.0, 0.45);
    /// Analog stick dead zone for navigation.
    pub const STICK_DEAD_ZONE: f32 = 0.5;
}

/// Component sizes in design pixels.
pub mod size {
    /// Rail capsule (Steam `library_600x900` aspect).
    pub const CAPSULE: (f32, f32) = (176.0, 264.0);
    pub const CAPSULE_GAP: f32 = 20.0;
    /// Library grid capsule.
    pub const GRID_CAPSULE: (f32, f32) = (150.0, 225.0);
    pub const GRID_COLUMNS: usize = 9;
    /// Minimum focus target (M3 / pro-rules: 48).
    pub const TARGET: f32 = 56.0;
    pub const BUTTON_HEIGHT: f32 = 64.0;
    pub const CHIP_HEIGHT: f32 = 48.0;
    pub const ROW_HEIGHT: f32 = 72.0;
    pub const ROW_WIDTH: f32 = 820.0;
    pub const QUICK_WIDTH: f32 = 640.0;
    pub const FOCUS_RING: f32 = 3.0;
    pub const FOCUS_OFFSET: f32 = 4.0;
    /// Focused capsule scale (DIRECTION.md: 1.08).
    pub const FOCUS_GROW: f32 = 0.08;
    pub const RAIL_SHOWN: usize = 18;
    /// Hero art opacity over the scheme surface.
    pub const HERO_OPACITY: f32 = 0.9;
}
