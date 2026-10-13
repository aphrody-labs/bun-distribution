// SPDX-License-Identifier: Apache-2.0
//! M3 dynamic colour schemes: every colour role of a theme, derived from a source colour.
//!
//! Exact port of the 2021 colour specification of [material-color-utilities] (Apache-2.0):
//! `dynamiccolor/dynamic_scheme.ts` (palettes), `dynamiccolor/color_spec_2021.ts` (role tones,
//! backgrounds, contrast curves, tone-delta pairs) and the 2021 `getTone` of
//! `dynamiccolor/dynamic_color.ts`. It is the specification `@material/material-color-utilities`
//! and Material Theme Builder apply by default, so role colours match them bit for bit.
//!
//! The Content and Fidelity variants keep the source colour's chroma and tone in the primary
//! container and derive the tertiary palette from the temperature (analogous or complement) and
//! dislike analyses of the private `temperature` module.
//!
//! ```rust
//! use aphrody_m3_tokens::scheme::{DynamicScheme, Role, Variant};
//! let light = DynamicScheme::from_argb(0xFF67_50A4, Variant::TonalSpot, false, 0.0);
//! let dark = DynamicScheme::from_argb(0xFF67_50A4, Variant::TonalSpot, true, 0.0);
//! assert_ne!(light.argb(Role::Primary), dark.argb(Role::Primary));
//! assert_eq!(Role::ALL.len(), 49);
//! ```
//!
//! [material-color-utilities]: https://github.com/material-foundation/material-color-utilities

mod temperature;

use temperature::{TemperatureCache, fix_if_disliked};

use crate::{
    color_math::{clamp_double, js_round, lerp, sanitize_degrees},
    contrast::{darker, darker_unsafe, lighter, lighter_unsafe, ratio_of_tones},
    hct::Hct,
    palette::TonalPalette,
};

/// How a scheme spreads the source colour over its palettes.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Variant {
    /// Greys only.
    Monochrome,
    /// Near-grey, a hint of the source hue.
    Neutral,
    /// The M3 default: calm primary, muted secondary, tertiary 60° away.
    TonalSpot,
    /// Maximum primary chroma, rotated secondary and tertiary.
    Vibrant,
    /// Primary hue rotated 240°, playful accents.
    Expressive,
    /// Tonal spot with a stronger primary and grey neutrals.
    Rainbow,
    /// Primary and secondary rotated -50°.
    FruitSalad,
    /// The source colour as primary container, tertiary from its analogous temperature.
    Content,
    /// The source colour as primary container, tertiary its temperature complement.
    Fidelity,
}

impl Variant {
    /// Every provided variant.
    pub const ALL: [Self; 9] = [
        Self::Monochrome,
        Self::Neutral,
        Self::TonalSpot,
        Self::Vibrant,
        Self::Expressive,
        Self::Rainbow,
        Self::FruitSalad,
        Self::Content,
        Self::Fidelity,
    ];

    /// Kebab-case name (`tonal-spot`).
    #[must_use]
    pub const fn name(self) -> &'static str {
        match self {
            Self::Monochrome => "monochrome",
            Self::Neutral => "neutral",
            Self::TonalSpot => "tonal-spot",
            Self::Vibrant => "vibrant",
            Self::Expressive => "expressive",
            Self::Rainbow => "rainbow",
            Self::FruitSalad => "fruit-salad",
            Self::Content => "content",
            Self::Fidelity => "fidelity",
        }
    }

    /// Parse a kebab-case or snake-case name.
    #[must_use]
    pub fn from_name(name: &str) -> Option<Self> {
        let name = name.replace('_', "-");
        Self::ALL.into_iter().find(|variant| variant.name() == name)
    }
}

pub use crate::role::Role;

/// The six palettes of a scheme.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Palettes {
    /// Primary.
    pub primary: TonalPalette,
    /// Secondary.
    pub secondary: TonalPalette,
    /// Tertiary.
    pub tertiary: TonalPalette,
    /// Neutral (surfaces, text).
    pub neutral: TonalPalette,
    /// Neutral variant (outlines, variant surfaces).
    pub neutral_variant: TonalPalette,
    /// Error.
    pub error: TonalPalette,
}

impl Palettes {
    /// The 2021 palettes of `variant` for `source`.
    #[must_use]
    pub fn of(variant: Variant, source: &Hct) -> Self {
        let palette = TonalPalette::from_hue_and_chroma;
        let (hue, chroma) = (source.hue, source.chroma);
        let tertiary = match variant {
            Variant::Content => {
                let (analogous, _) = TemperatureCache::new(*source).analogous(3, 6);
                TonalPalette::from_hct(fix_if_disliked(analogous[2]))
            }
            Variant::Fidelity => {
                TonalPalette::from_hct(fix_if_disliked(TemperatureCache::new(*source).complement()))
            }
            _ => return Self::from_hue(variant, hue),
        };
        Self {
            primary: palette(hue, chroma),
            secondary: palette(hue, (chroma - 32.0).max(chroma * 0.5)),
            tertiary,
            neutral: palette(hue, chroma / 8.0),
            neutral_variant: palette(hue, chroma / 8.0 + 4.0),
            error: palette(25.0, 84.0),
        }
    }

    /// The 2021 palettes of `variant` for a source hue. Content and Fidelity need the whole
    /// source colour (use [`Palettes::of`]); here they stand for a mid-tone, mid-chroma source.
    #[must_use]
    pub fn from_hue(variant: Variant, hue: f64) -> Self {
        if matches!(variant, Variant::Content | Variant::Fidelity) {
            return Self::of(variant, &Hct::new(hue, 36.0, 50.0));
        }
        let palette = TonalPalette::from_hue_and_chroma;
        let (primary, secondary, tertiary, neutral, neutral_variant) = match variant {
            Variant::Monochrome => (
                palette(hue, 0.0),
                palette(hue, 0.0),
                palette(hue, 0.0),
                palette(hue, 0.0),
                palette(hue, 0.0),
            ),
            Variant::Neutral => (
                palette(hue, 12.0),
                palette(hue, 8.0),
                palette(hue, 16.0),
                palette(hue, 2.0),
                palette(hue, 2.0),
            ),
            Variant::TonalSpot => (
                palette(hue, 36.0),
                palette(hue, 16.0),
                palette(sanitize_degrees(hue + 60.0), 24.0),
                palette(hue, 6.0),
                palette(hue, 8.0),
            ),
            Variant::Vibrant => {
                const BREAKPOINTS: [f64; 9] =
                    [0.0, 41.0, 61.0, 101.0, 131.0, 181.0, 251.0, 301.0, 360.0];
                (
                    palette(hue, 200.0),
                    palette(
                        rotated_hue(
                            hue,
                            &BREAKPOINTS,
                            &[18.0, 15.0, 10.0, 12.0, 15.0, 18.0, 15.0, 12.0, 12.0],
                        ),
                        24.0,
                    ),
                    palette(
                        rotated_hue(
                            hue,
                            &BREAKPOINTS,
                            &[35.0, 30.0, 20.0, 25.0, 30.0, 35.0, 30.0, 25.0, 25.0],
                        ),
                        32.0,
                    ),
                    palette(hue, 10.0),
                    palette(hue, 12.0),
                )
            }
            Variant::Expressive => {
                const BREAKPOINTS: [f64; 9] =
                    [0.0, 21.0, 51.0, 121.0, 151.0, 191.0, 271.0, 321.0, 360.0];
                (
                    palette(sanitize_degrees(hue + 240.0), 40.0),
                    palette(
                        rotated_hue(
                            hue,
                            &BREAKPOINTS,
                            &[45.0, 95.0, 45.0, 20.0, 45.0, 90.0, 45.0, 45.0, 45.0],
                        ),
                        24.0,
                    ),
                    palette(
                        rotated_hue(
                            hue,
                            &BREAKPOINTS,
                            &[120.0, 120.0, 20.0, 45.0, 20.0, 15.0, 20.0, 120.0, 120.0],
                        ),
                        32.0,
                    ),
                    palette(sanitize_degrees(hue + 15.0), 8.0),
                    palette(sanitize_degrees(hue + 15.0), 12.0),
                )
            }
            Variant::Rainbow => (
                palette(hue, 48.0),
                palette(hue, 16.0),
                palette(sanitize_degrees(hue + 60.0), 24.0),
                palette(hue, 0.0),
                palette(hue, 0.0),
            ),
            Variant::Content | Variant::Fidelity => unreachable!("handled above"),
            Variant::FruitSalad => (
                palette(sanitize_degrees(hue - 50.0), 48.0),
                palette(sanitize_degrees(hue - 50.0), 36.0),
                palette(hue, 36.0),
                palette(hue, 10.0),
                palette(hue, 16.0),
            ),
        };
        Self {
            primary,
            secondary,
            tertiary,
            neutral,
            neutral_variant,
            error: palette(25.0, 84.0),
        }
    }
}

/// `DynamicScheme.getPiecewiseHue`: the entry of `hues` for the band of `breakpoints` holding
/// `source_hue`, or `source_hue` itself outside every band.
fn piecewise_hue(source_hue: f64, breakpoints: &[f64], hues: &[f64]) -> f64 {
    let size = (breakpoints.len() - 1).min(hues.len());
    (0..size)
        .find(|&i| source_hue >= breakpoints[i] && source_hue < breakpoints[i + 1])
        .map_or(source_hue, |i| sanitize_degrees(hues[i]))
}

/// `findDesiredChromaByTone` of the 2021 spec: the tone nearest `tone`, in the given direction,
/// where `hue` reaches `chroma`.
fn find_desired_chroma_by_tone(hue: f64, chroma: f64, tone: f64, by_decreasing_tone: bool) -> f64 {
    let mut answer = tone;
    let mut closest = Hct::new(hue, chroma, tone);
    if closest.chroma < chroma {
        let mut chroma_peak = closest.chroma;
        while closest.chroma < chroma {
            answer += if by_decreasing_tone { -1.0 } else { 1.0 };
            let potential = Hct::new(hue, chroma, answer);
            if chroma_peak > potential.chroma {
                break;
            }
            if (potential.chroma - chroma).abs() < 0.4 {
                break;
            }
            if (potential.chroma - chroma).abs() < (closest.chroma - chroma).abs() {
                closest = potential;
            }
            chroma_peak = chroma_peak.max(potential.chroma);
        }
    }
    answer
}

/// `DynamicScheme.getRotatedHue`.
fn rotated_hue(source_hue: f64, breakpoints: &[f64], rotations: &[f64]) -> f64 {
    let rotation = if (breakpoints.len() - 1).min(rotations.len()) == 0 {
        0.0
    } else {
        piecewise_hue(source_hue, breakpoints, rotations)
    };
    sanitize_degrees(source_hue + rotation)
}

/// A colour scheme: palettes plus mode and contrast, resolving every [`Role`].
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct DynamicScheme {
    /// Source colour.
    pub source: Hct,
    /// Variant (only the role tones of [`Variant::Monochrome`] differ from the others).
    pub variant: Variant,
    /// Dark mode.
    pub is_dark: bool,
    /// Contrast level: -1 (reduced), 0 (standard), 0.5 (medium), 1 (high).
    pub contrast_level: f64,
    /// Palettes the roles draw from.
    pub palettes: Palettes,
}

#[derive(Clone, Copy)]
enum PaletteId {
    Primary,
    Secondary,
    Tertiary,
    Neutral,
    NeutralVariant,
    Error,
}

#[derive(Clone, Copy)]
struct ContrastCurve([f64; 4]);

impl ContrastCurve {
    fn get(self, level: f64) -> f64 {
        let [low, normal, medium, high] = self.0;
        if level <= -1.0 {
            low
        } else if level < 0.0 {
            lerp(low, normal, level + 1.0)
        } else if level < 0.5 {
            lerp(normal, medium, level / 0.5)
        } else if level < 1.0 {
            lerp(medium, high, (level - 0.5) / 0.5)
        } else {
            high
        }
    }
}

#[derive(Clone, Copy, PartialEq)]
enum Polarity {
    Nearer,
    Lighter,
}

#[derive(Clone, Copy)]
struct ToneDeltaPair {
    role_a: Role,
    role_b: Role,
    delta: f64,
    polarity: Polarity,
    stay_together: bool,
}

const CONTAINER_CURVE: ContrastCurve = ContrastCurve([1.0, 1.0, 3.0, 4.5]);
const ACCENT_CURVE: ContrastCurve = ContrastCurve([3.0, 4.5, 7.0, 7.0]);
const ON_ACCENT_CURVE: ContrastCurve = ContrastCurve([4.5, 7.0, 11.0, 21.0]);
const ON_CONTAINER_CURVE: ContrastCurve = ContrastCurve([3.0, 4.5, 7.0, 11.0]);

impl DynamicScheme {
    /// A scheme of `variant` for `source`, with the 2021 palettes of that variant.
    #[must_use]
    pub fn new(source: Hct, variant: Variant, is_dark: bool, contrast_level: f64) -> Self {
        Self::with_palettes(
            source,
            variant,
            is_dark,
            contrast_level,
            Palettes::of(variant, &source),
        )
    }

    /// [`DynamicScheme::new`] for an ARGB source colour.
    #[must_use]
    pub fn from_argb(source: u32, variant: Variant, is_dark: bool, contrast_level: f64) -> Self {
        Self::new(Hct::from_argb(source), variant, is_dark, contrast_level)
    }

    /// A scheme over caller-provided palettes (the role tones still follow `variant`).
    #[must_use]
    pub const fn with_palettes(
        source: Hct,
        variant: Variant,
        is_dark: bool,
        contrast_level: f64,
        palettes: Palettes,
    ) -> Self {
        Self {
            source,
            variant,
            is_dark,
            contrast_level,
            palettes,
        }
    }

    /// ARGB of `role`.
    #[must_use]
    pub fn argb(&self, role: Role) -> u32 {
        self.palette(role).tone(self.tone(role))
    }

    /// HCT of `role`.
    #[must_use]
    pub fn hct(&self, role: Role) -> Hct {
        Hct::from_argb(self.argb(role))
    }

    /// `(role, argb)` for the 49 system roles, in [`Role::ALL`] order.
    pub fn roles(&self) -> impl Iterator<Item = (Role, u32)> + '_ {
        Role::ALL.into_iter().map(|role| (role, self.argb(role)))
    }

    fn palette(&self, role: Role) -> &TonalPalette {
        let p = &self.palettes;
        match palette_id(role) {
            PaletteId::Primary => &p.primary,
            PaletteId::Secondary => &p.secondary,
            PaletteId::Tertiary => &p.tertiary,
            PaletteId::Neutral => &p.neutral,
            PaletteId::NeutralVariant => &p.neutral_variant,
            PaletteId::Error => &p.error,
        }
    }

    fn monochrome(&self) -> bool {
        self.variant == Variant::Monochrome
    }

    fn fidelity(&self) -> bool {
        matches!(self.variant, Variant::Content | Variant::Fidelity)
    }

    /// The tone the role's definition asks for, before any contrast adjustment.
    fn base_tone(&self, role: Role) -> f64 {
        let mono = self.monochrome();
        let level = self.contrast_level;
        let curve = |values: [f64; 4]| ContrastCurve(values).get(level);
        if self.fidelity() {
            match role {
                Role::PrimaryContainer => return self.source.tone,
                Role::OnPrimaryContainer => {
                    return foreground_tone(self.base_tone(Role::PrimaryContainer), 4.5);
                }
                Role::SecondaryContainer => {
                    let secondary = &self.palettes.secondary;
                    let initial = if self.is_dark { 30.0 } else { 90.0 };
                    return find_desired_chroma_by_tone(
                        secondary.hue,
                        secondary.chroma,
                        initial,
                        !self.is_dark,
                    );
                }
                Role::OnSecondaryContainer => {
                    return foreground_tone(self.base_tone(Role::SecondaryContainer), 4.5);
                }
                Role::TertiaryContainer => {
                    let proposed = self.palettes.tertiary.hct(self.source.tone);
                    return fix_if_disliked(proposed).tone;
                }
                Role::OnTertiaryContainer => {
                    return foreground_tone(self.base_tone(Role::TertiaryContainer), 4.5);
                }
                _ => {}
            }
        }
        // (dark, light) per role; fixed roles use the same tone in both modes.
        let (dark, light) = match role {
            Role::PrimaryPaletteKeyColor => return self.palettes.primary.key_color.tone,
            Role::SecondaryPaletteKeyColor => return self.palettes.secondary.key_color.tone,
            Role::TertiaryPaletteKeyColor => return self.palettes.tertiary.key_color.tone,
            Role::NeutralPaletteKeyColor => return self.palettes.neutral.key_color.tone,
            Role::NeutralVariantPaletteKeyColor => {
                return self.palettes.neutral_variant.key_color.tone;
            }
            Role::ErrorPaletteKeyColor => return self.palettes.error.key_color.tone,
            Role::Background | Role::Surface => (6.0, 98.0),
            Role::OnBackground | Role::OnSurface => (90.0, 10.0),
            Role::SurfaceDim => (6.0, curve([87.0, 87.0, 80.0, 75.0])),
            Role::SurfaceBright => (curve([24.0, 24.0, 29.0, 34.0]), 98.0),
            Role::SurfaceContainerLowest => (curve([4.0, 4.0, 2.0, 0.0]), 100.0),
            Role::SurfaceContainerLow => (
                curve([10.0, 10.0, 11.0, 12.0]),
                curve([96.0, 96.0, 96.0, 95.0]),
            ),
            Role::SurfaceContainer => (
                curve([12.0, 12.0, 16.0, 20.0]),
                curve([94.0, 94.0, 92.0, 90.0]),
            ),
            Role::SurfaceContainerHigh => (
                curve([17.0, 17.0, 21.0, 25.0]),
                curve([92.0, 92.0, 88.0, 85.0]),
            ),
            Role::SurfaceContainerHighest => (
                curve([22.0, 22.0, 26.0, 30.0]),
                curve([90.0, 90.0, 84.0, 80.0]),
            ),
            Role::SurfaceVariant => (30.0, 90.0),
            Role::OnSurfaceVariant => (80.0, 30.0),
            Role::InverseSurface => (90.0, 20.0),
            Role::InverseOnSurface => (20.0, 95.0),
            Role::Outline => (60.0, 50.0),
            Role::OutlineVariant => (30.0, 80.0),
            Role::Shadow | Role::Scrim => (0.0, 0.0),
            Role::SurfaceTint | Role::Secondary | Role::Error => (80.0, 40.0),
            Role::Primary => {
                if mono {
                    (100.0, 0.0)
                } else {
                    (80.0, 40.0)
                }
            }
            Role::OnPrimary | Role::OnTertiary => {
                if mono {
                    (10.0, 90.0)
                } else {
                    (20.0, 100.0)
                }
            }
            Role::PrimaryContainer => {
                if mono {
                    (85.0, 25.0)
                } else {
                    (30.0, 90.0)
                }
            }
            Role::OnPrimaryContainer | Role::OnTertiaryContainer => {
                if mono {
                    (0.0, 100.0)
                } else {
                    (90.0, 30.0)
                }
            }
            Role::InversePrimary => (40.0, 80.0),
            Role::OnSecondary => {
                if mono {
                    (10.0, 100.0)
                } else {
                    (20.0, 100.0)
                }
            }
            Role::SecondaryContainer => {
                if mono {
                    (30.0, 85.0)
                } else {
                    (30.0, 90.0)
                }
            }
            Role::OnSecondaryContainer | Role::OnErrorContainer => {
                if mono {
                    (90.0, 10.0)
                } else {
                    (90.0, 30.0)
                }
            }
            Role::Tertiary => {
                if mono {
                    (90.0, 25.0)
                } else {
                    (80.0, 40.0)
                }
            }
            Role::TertiaryContainer => {
                if mono {
                    (60.0, 49.0)
                } else {
                    (30.0, 90.0)
                }
            }
            Role::OnError => (20.0, 100.0),
            Role::ErrorContainer => (30.0, 90.0),
            Role::PrimaryFixed | Role::TertiaryFixed => {
                if mono {
                    (40.0, 40.0)
                } else {
                    (90.0, 90.0)
                }
            }
            Role::PrimaryFixedDim | Role::TertiaryFixedDim => {
                if mono {
                    (30.0, 30.0)
                } else {
                    (80.0, 80.0)
                }
            }
            Role::OnPrimaryFixed | Role::OnTertiaryFixed => {
                if mono {
                    (100.0, 100.0)
                } else {
                    (10.0, 10.0)
                }
            }
            Role::OnPrimaryFixedVariant | Role::OnTertiaryFixedVariant => {
                if mono {
                    (90.0, 90.0)
                } else {
                    (30.0, 30.0)
                }
            }
            Role::SecondaryFixed => {
                if mono {
                    (80.0, 80.0)
                } else {
                    (90.0, 90.0)
                }
            }
            Role::SecondaryFixedDim => {
                if mono {
                    (70.0, 70.0)
                } else {
                    (80.0, 80.0)
                }
            }
            Role::OnSecondaryFixed => (10.0, 10.0),
            Role::OnSecondaryFixedVariant => {
                if mono {
                    (25.0, 25.0)
                } else {
                    (30.0, 30.0)
                }
            }
        };
        if self.is_dark { dark } else { light }
    }

    fn highest_surface(&self) -> Role {
        if self.is_dark {
            Role::SurfaceBright
        } else {
            Role::SurfaceDim
        }
    }

    fn background(&self, role: Role) -> Option<Role> {
        match role {
            Role::OnBackground => Some(Role::Background),
            Role::OnSurface
            | Role::OnSurfaceVariant
            | Role::Outline
            | Role::OutlineVariant
            | Role::Primary
            | Role::PrimaryContainer
            | Role::Secondary
            | Role::SecondaryContainer
            | Role::Tertiary
            | Role::TertiaryContainer
            | Role::Error
            | Role::ErrorContainer
            | Role::PrimaryFixed
            | Role::PrimaryFixedDim
            | Role::SecondaryFixed
            | Role::SecondaryFixedDim
            | Role::TertiaryFixed
            | Role::TertiaryFixedDim => Some(self.highest_surface()),
            Role::InverseOnSurface | Role::InversePrimary => Some(Role::InverseSurface),
            Role::OnPrimary => Some(Role::Primary),
            Role::OnPrimaryContainer => Some(Role::PrimaryContainer),
            Role::OnSecondary => Some(Role::Secondary),
            Role::OnSecondaryContainer => Some(Role::SecondaryContainer),
            Role::OnTertiary => Some(Role::Tertiary),
            Role::OnTertiaryContainer => Some(Role::TertiaryContainer),
            Role::OnError => Some(Role::Error),
            Role::OnErrorContainer => Some(Role::ErrorContainer),
            Role::OnPrimaryFixed | Role::OnPrimaryFixedVariant => Some(Role::PrimaryFixedDim),
            Role::OnSecondaryFixed | Role::OnSecondaryFixedVariant => Some(Role::SecondaryFixedDim),
            Role::OnTertiaryFixed | Role::OnTertiaryFixedVariant => Some(Role::TertiaryFixedDim),
            _ => None,
        }
    }

    /// Tone of `role` after contrast and tone-delta constraints (the 2021 `getTone`).
    #[must_use]
    pub fn tone(&self, role: Role) -> f64 {
        let level = self.contrast_level;
        let decreasing_contrast = level < 0.0;
        if let Some(pair) = tone_delta_pair(role) {
            let a_is_nearer = pair.polarity == Polarity::Nearer || !self.is_dark;
            let (nearer, farther) = if a_is_nearer {
                (pair.role_a, pair.role_b)
            } else {
                (pair.role_b, pair.role_a)
            };
            let am_nearer = role == nearer;
            let expansion_dir = if self.is_dark { 1.0 } else { -1.0 };
            let delta = pair.delta;
            let mut n_tone = self.base_tone(nearer);
            let mut f_tone = self.base_tone(farther);
            if let (Some(bg), Some(n_curve), Some(f_curve)) = (
                self.background(role),
                contrast_curve(nearer),
                contrast_curve(farther),
            ) {
                let bg_tone = self.tone(bg);
                let n_contrast = n_curve.get(level);
                let f_contrast = f_curve.get(level);
                if ratio_of_tones(bg_tone, n_tone) < n_contrast {
                    n_tone = foreground_tone(bg_tone, n_contrast);
                }
                if ratio_of_tones(bg_tone, f_tone) < f_contrast {
                    f_tone = foreground_tone(bg_tone, f_contrast);
                }
                if decreasing_contrast {
                    n_tone = foreground_tone(bg_tone, n_contrast);
                    f_tone = foreground_tone(bg_tone, f_contrast);
                }
            }
            if (f_tone - n_tone) * expansion_dir < delta {
                f_tone = clamp_double(0.0, 100.0, n_tone + delta * expansion_dir);
                if (f_tone - n_tone) * expansion_dir < delta {
                    n_tone = clamp_double(0.0, 100.0, f_tone - delta * expansion_dir);
                }
            }
            let move_out_of_the_awkward_zone = |n_tone: &mut f64, f_tone: &mut f64| {
                if expansion_dir > 0.0 {
                    *n_tone = 60.0;
                    *f_tone = f_tone.max(*n_tone + delta * expansion_dir);
                } else {
                    *n_tone = 49.0;
                    *f_tone = f_tone.min(*n_tone + delta * expansion_dir);
                }
            };
            if (50.0..60.0).contains(&n_tone) {
                move_out_of_the_awkward_zone(&mut n_tone, &mut f_tone);
            } else if (50.0..60.0).contains(&f_tone) {
                if pair.stay_together {
                    move_out_of_the_awkward_zone(&mut n_tone, &mut f_tone);
                } else {
                    f_tone = if expansion_dir > 0.0 { 60.0 } else { 49.0 };
                }
            }
            return if am_nearer { n_tone } else { f_tone };
        }

        let mut answer = self.base_tone(role);
        let (Some(bg), Some(curve)) = (self.background(role), contrast_curve(role)) else {
            return answer;
        };
        let bg_tone = self.tone(bg);
        let desired_ratio = curve.get(level);
        if ratio_of_tones(bg_tone, answer) < desired_ratio || decreasing_contrast {
            answer = foreground_tone(bg_tone, desired_ratio);
        }
        if is_background(role) && (50.0..60.0).contains(&answer) {
            answer = if ratio_of_tones(49.0, bg_tone) >= desired_ratio {
                49.0
            } else {
                60.0
            };
        }
        let Some(second) = second_background(role) else {
            return answer;
        };
        let (bg_tone1, bg_tone2) = (bg_tone, self.tone(second));
        let (upper, lower) = (bg_tone1.max(bg_tone2), bg_tone1.min(bg_tone2));
        if ratio_of_tones(upper, answer) >= desired_ratio
            && ratio_of_tones(lower, answer) >= desired_ratio
        {
            return answer;
        }
        let light_option = lighter(upper, desired_ratio);
        let dark_option = darker(lower, desired_ratio);
        if tone_prefers_light_foreground(bg_tone1) || tone_prefers_light_foreground(bg_tone2) {
            return if light_option < 0.0 {
                100.0
            } else {
                light_option
            };
        }
        match (light_option != -1.0, dark_option != -1.0) {
            (true, false) => light_option,
            (false, true) => dark_option,
            _ => {
                if dark_option < 0.0 {
                    0.0
                } else {
                    dark_option
                }
            }
        }
    }
}

const fn palette_id(role: Role) -> PaletteId {
    match role {
        Role::PrimaryPaletteKeyColor
        | Role::SurfaceTint
        | Role::Primary
        | Role::OnPrimary
        | Role::PrimaryContainer
        | Role::OnPrimaryContainer
        | Role::InversePrimary
        | Role::PrimaryFixed
        | Role::PrimaryFixedDim
        | Role::OnPrimaryFixed
        | Role::OnPrimaryFixedVariant => PaletteId::Primary,
        Role::SecondaryPaletteKeyColor
        | Role::Secondary
        | Role::OnSecondary
        | Role::SecondaryContainer
        | Role::OnSecondaryContainer
        | Role::SecondaryFixed
        | Role::SecondaryFixedDim
        | Role::OnSecondaryFixed
        | Role::OnSecondaryFixedVariant => PaletteId::Secondary,
        Role::TertiaryPaletteKeyColor
        | Role::Tertiary
        | Role::OnTertiary
        | Role::TertiaryContainer
        | Role::OnTertiaryContainer
        | Role::TertiaryFixed
        | Role::TertiaryFixedDim
        | Role::OnTertiaryFixed
        | Role::OnTertiaryFixedVariant => PaletteId::Tertiary,
        Role::NeutralVariantPaletteKeyColor
        | Role::SurfaceVariant
        | Role::OnSurfaceVariant
        | Role::Outline
        | Role::OutlineVariant => PaletteId::NeutralVariant,
        Role::ErrorPaletteKeyColor
        | Role::Error
        | Role::OnError
        | Role::ErrorContainer
        | Role::OnErrorContainer => PaletteId::Error,
        Role::NeutralPaletteKeyColor
        | Role::Background
        | Role::OnBackground
        | Role::Surface
        | Role::OnSurface
        | Role::SurfaceDim
        | Role::SurfaceBright
        | Role::SurfaceContainerLowest
        | Role::SurfaceContainerLow
        | Role::SurfaceContainer
        | Role::SurfaceContainerHigh
        | Role::SurfaceContainerHighest
        | Role::InverseSurface
        | Role::InverseOnSurface
        | Role::Shadow
        | Role::Scrim => PaletteId::Neutral,
    }
}

const fn is_background(role: Role) -> bool {
    matches!(
        role,
        Role::Background
            | Role::Surface
            | Role::SurfaceDim
            | Role::SurfaceBright
            | Role::SurfaceContainerLowest
            | Role::SurfaceContainerLow
            | Role::SurfaceContainer
            | Role::SurfaceContainerHigh
            | Role::SurfaceContainerHighest
            | Role::SurfaceVariant
            | Role::InverseSurface
            | Role::SurfaceTint
            | Role::Primary
            | Role::PrimaryContainer
            | Role::Secondary
            | Role::SecondaryContainer
            | Role::Tertiary
            | Role::TertiaryContainer
            | Role::Error
            | Role::ErrorContainer
            | Role::PrimaryFixed
            | Role::PrimaryFixedDim
            | Role::SecondaryFixed
            | Role::SecondaryFixedDim
            | Role::TertiaryFixed
            | Role::TertiaryFixedDim
    )
}

const fn second_background(role: Role) -> Option<Role> {
    match role {
        Role::OnPrimaryFixed | Role::OnPrimaryFixedVariant => Some(Role::PrimaryFixed),
        Role::OnSecondaryFixed | Role::OnSecondaryFixedVariant => Some(Role::SecondaryFixed),
        Role::OnTertiaryFixed | Role::OnTertiaryFixedVariant => Some(Role::TertiaryFixed),
        _ => None,
    }
}

const fn contrast_curve(role: Role) -> Option<ContrastCurve> {
    Some(match role {
        Role::OnBackground => ContrastCurve([3.0, 3.0, 4.5, 7.0]),
        Role::OnSurface | Role::InverseOnSurface => ON_ACCENT_CURVE,
        Role::OnSurfaceVariant => ON_CONTAINER_CURVE,
        Role::Outline => ContrastCurve([1.5, 3.0, 4.5, 7.0]),
        Role::OutlineVariant => CONTAINER_CURVE,
        Role::Primary | Role::Secondary | Role::Tertiary | Role::Error | Role::InversePrimary => {
            ACCENT_CURVE
        }
        Role::OnPrimary
        | Role::OnSecondary
        | Role::OnTertiary
        | Role::OnError
        | Role::OnPrimaryFixed
        | Role::OnSecondaryFixed
        | Role::OnTertiaryFixed => ON_ACCENT_CURVE,
        Role::PrimaryContainer
        | Role::SecondaryContainer
        | Role::TertiaryContainer
        | Role::ErrorContainer
        | Role::PrimaryFixed
        | Role::PrimaryFixedDim
        | Role::SecondaryFixed
        | Role::SecondaryFixedDim
        | Role::TertiaryFixed
        | Role::TertiaryFixedDim => CONTAINER_CURVE,
        Role::OnPrimaryContainer
        | Role::OnSecondaryContainer
        | Role::OnTertiaryContainer
        | Role::OnErrorContainer
        | Role::OnPrimaryFixedVariant
        | Role::OnSecondaryFixedVariant
        | Role::OnTertiaryFixedVariant => ON_CONTAINER_CURVE,
        _ => return None,
    })
}

fn tone_delta_pair(role: Role) -> Option<ToneDeltaPair> {
    let accent = |container: Role, accent: Role| ToneDeltaPair {
        role_a: container,
        role_b: accent,
        delta: 10.0,
        polarity: Polarity::Nearer,
        stay_together: false,
    };
    let fixed = |fixed: Role, dim: Role| ToneDeltaPair {
        role_a: fixed,
        role_b: dim,
        delta: 10.0,
        polarity: Polarity::Lighter,
        stay_together: true,
    };
    Some(match role {
        Role::Primary | Role::PrimaryContainer => accent(Role::PrimaryContainer, Role::Primary),
        Role::Secondary | Role::SecondaryContainer => {
            accent(Role::SecondaryContainer, Role::Secondary)
        }
        Role::Tertiary | Role::TertiaryContainer => accent(Role::TertiaryContainer, Role::Tertiary),
        Role::Error | Role::ErrorContainer => accent(Role::ErrorContainer, Role::Error),
        Role::PrimaryFixed | Role::PrimaryFixedDim => {
            fixed(Role::PrimaryFixed, Role::PrimaryFixedDim)
        }
        Role::SecondaryFixed | Role::SecondaryFixedDim => {
            fixed(Role::SecondaryFixed, Role::SecondaryFixedDim)
        }
        Role::TertiaryFixed | Role::TertiaryFixedDim => {
            fixed(Role::TertiaryFixed, Role::TertiaryFixedDim)
        }
        _ => return None,
    })
}

/// A foreground tone reaching `ratio` against `bg_tone` (`DynamicColor.foregroundTone`).
#[must_use]
pub fn foreground_tone(bg_tone: f64, ratio: f64) -> f64 {
    let lighter_tone = lighter_unsafe(bg_tone, ratio);
    let darker_tone = darker_unsafe(bg_tone, ratio);
    let lighter_ratio = ratio_of_tones(lighter_tone, bg_tone);
    let darker_ratio = ratio_of_tones(darker_tone, bg_tone);
    if tone_prefers_light_foreground(bg_tone) {
        let negligible_difference = (lighter_ratio - darker_ratio).abs() < 0.1
            && lighter_ratio < ratio
            && darker_ratio < ratio;
        if lighter_ratio >= ratio || lighter_ratio >= darker_ratio || negligible_difference {
            lighter_tone
        } else {
            darker_tone
        }
    } else if darker_ratio >= ratio || darker_ratio >= lighter_ratio {
        darker_tone
    } else {
        lighter_tone
    }
}

/// Backgrounds below tone 60 (rounded) prefer a light foreground.
#[must_use]
pub fn tone_prefers_light_foreground(tone: f64) -> bool {
    js_round(tone) < 60.0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn role_names_round_trip() {
        for role in Role::ALL {
            assert_eq!(Role::from_name(role.name()), Some(role));
            assert_eq!(Role::from_name(role.camel_name()), Some(role));
        }
        assert_eq!(Role::from_name("nope"), None);
        assert_eq!(Variant::from_name("tonal_spot"), Some(Variant::TonalSpot));
    }

    #[test]
    fn accent_and_container_keep_their_distance() {
        for dark in [false, true] {
            let scheme = DynamicScheme::from_argb(0xFF67_50A4, Variant::TonalSpot, dark, 0.0);
            let gap = (scheme.tone(Role::Primary) - scheme.tone(Role::PrimaryContainer)).abs();
            assert!(gap >= 10.0 - 1e-9, "dark={dark} gap={gap}");
        }
    }

    #[test]
    fn text_on_the_highest_surface_is_readable() {
        // The standard curve asks 7:1; higher levels ask more than the palette can give, and the
        // reference then keeps the best tone it finds (10.66:1 at level 1 in light mode).
        for dark in [false, true] {
            for level in [0.0, 0.5, 1.0] {
                let scheme = DynamicScheme::from_argb(0xFF1A_73E8, Variant::TonalSpot, dark, level);
                let ratio = ratio_of_tones(
                    scheme.tone(Role::OnSurface),
                    scheme.tone(scheme.highest_surface()),
                );
                assert!(ratio >= 7.0, "dark={dark} level={level} ratio={ratio}");
            }
        }
    }

    #[test]
    fn monochrome_is_grey() {
        let scheme = DynamicScheme::from_argb(0xFFE9_1E63, Variant::Monochrome, false, 0.0);
        // The error palette keeps its hue in every variant.
        for (role, argb) in scheme
            .roles()
            .filter(|(role, _)| !role.name().contains("error"))
        {
            let [r, g, b] = [argb >> 16 & 0xFF, argb >> 8 & 0xFF, argb & 0xFF];
            assert!(r == g && g == b, "{} is {argb:#010x}", role.name());
        }
    }
}
