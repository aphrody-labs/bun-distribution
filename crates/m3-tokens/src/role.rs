// SPDX-License-Identifier: Apache-2.0
//! Canonical Material semantic role names, available without std or allocation.
//! Extracted unchanged from the native dynamic-scheme owner.

macro_rules! roles {
    ($($variant:ident => $kebab:literal, $camel:literal;)*) => {
        /// An M3 colour role (`--md-sys-color-<name>`).
        #[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
        pub enum Role {
            $(
                #[doc = concat!("`", $kebab, "`")]
                $variant,
            )*
        }

        impl Role {
            /// Kebab-case name, the CSS custom property suffix (`on-primary-container`).
            #[must_use]
            pub const fn name(self) -> &'static str {
                match self { $(Self::$variant => $kebab,)* }
            }

            /// Camel-case name, as in `MaterialDynamicColors` (`onPrimaryContainer`).
            #[must_use]
            pub const fn camel_name(self) -> &'static str {
                match self { $(Self::$variant => $camel,)* }
            }

            /// Parse a kebab-case or camel-case role name.
            #[must_use]
            pub fn from_name(name: &str) -> Option<Self> {
                [$(Self::$variant,)*]
                    .into_iter()
                    .find(|role| role.name() == name || role.camel_name() == name)
            }
        }
    };
}

roles! {
    Primary => "primary", "primary";
    OnPrimary => "on-primary", "onPrimary";
    PrimaryContainer => "primary-container", "primaryContainer";
    OnPrimaryContainer => "on-primary-container", "onPrimaryContainer";
    InversePrimary => "inverse-primary", "inversePrimary";
    Secondary => "secondary", "secondary";
    OnSecondary => "on-secondary", "onSecondary";
    SecondaryContainer => "secondary-container", "secondaryContainer";
    OnSecondaryContainer => "on-secondary-container", "onSecondaryContainer";
    Tertiary => "tertiary", "tertiary";
    OnTertiary => "on-tertiary", "onTertiary";
    TertiaryContainer => "tertiary-container", "tertiaryContainer";
    OnTertiaryContainer => "on-tertiary-container", "onTertiaryContainer";
    Error => "error", "error";
    OnError => "on-error", "onError";
    ErrorContainer => "error-container", "errorContainer";
    OnErrorContainer => "on-error-container", "onErrorContainer";
    Background => "background", "background";
    OnBackground => "on-background", "onBackground";
    Surface => "surface", "surface";
    OnSurface => "on-surface", "onSurface";
    SurfaceVariant => "surface-variant", "surfaceVariant";
    OnSurfaceVariant => "on-surface-variant", "onSurfaceVariant";
    SurfaceDim => "surface-dim", "surfaceDim";
    SurfaceBright => "surface-bright", "surfaceBright";
    SurfaceContainerLowest => "surface-container-lowest", "surfaceContainerLowest";
    SurfaceContainerLow => "surface-container-low", "surfaceContainerLow";
    SurfaceContainer => "surface-container", "surfaceContainer";
    SurfaceContainerHigh => "surface-container-high", "surfaceContainerHigh";
    SurfaceContainerHighest => "surface-container-highest", "surfaceContainerHighest";
    SurfaceTint => "surface-tint", "surfaceTint";
    Outline => "outline", "outline";
    OutlineVariant => "outline-variant", "outlineVariant";
    InverseSurface => "inverse-surface", "inverseSurface";
    InverseOnSurface => "inverse-on-surface", "inverseOnSurface";
    Shadow => "shadow", "shadow";
    Scrim => "scrim", "scrim";
    PrimaryFixed => "primary-fixed", "primaryFixed";
    PrimaryFixedDim => "primary-fixed-dim", "primaryFixedDim";
    OnPrimaryFixed => "on-primary-fixed", "onPrimaryFixed";
    OnPrimaryFixedVariant => "on-primary-fixed-variant", "onPrimaryFixedVariant";
    SecondaryFixed => "secondary-fixed", "secondaryFixed";
    SecondaryFixedDim => "secondary-fixed-dim", "secondaryFixedDim";
    OnSecondaryFixed => "on-secondary-fixed", "onSecondaryFixed";
    OnSecondaryFixedVariant => "on-secondary-fixed-variant", "onSecondaryFixedVariant";
    TertiaryFixed => "tertiary-fixed", "tertiaryFixed";
    TertiaryFixedDim => "tertiary-fixed-dim", "tertiaryFixedDim";
    OnTertiaryFixed => "on-tertiary-fixed", "onTertiaryFixed";
    OnTertiaryFixedVariant => "on-tertiary-fixed-variant", "onTertiaryFixedVariant";
    PrimaryPaletteKeyColor => "primary-palette-key-color", "primaryPaletteKeyColor";
    SecondaryPaletteKeyColor => "secondary-palette-key-color", "secondaryPaletteKeyColor";
    TertiaryPaletteKeyColor => "tertiary-palette-key-color", "tertiaryPaletteKeyColor";
    NeutralPaletteKeyColor => "neutral-palette-key-color", "neutralPaletteKeyColor";
    NeutralVariantPaletteKeyColor => "neutral-variant-palette-key-color", "neutralVariantPaletteKeyColor";
    ErrorPaletteKeyColor => "error-palette-key-color", "errorPaletteKeyColor";
}

impl Role {
    /// The 49 system colour roles, in the order the CSS sheets list them (palette key colours are
    /// not system roles).
    pub const ALL: [Self; 49] = [
        Self::Primary,
        Self::OnPrimary,
        Self::PrimaryContainer,
        Self::OnPrimaryContainer,
        Self::InversePrimary,
        Self::Secondary,
        Self::OnSecondary,
        Self::SecondaryContainer,
        Self::OnSecondaryContainer,
        Self::Tertiary,
        Self::OnTertiary,
        Self::TertiaryContainer,
        Self::OnTertiaryContainer,
        Self::Error,
        Self::OnError,
        Self::ErrorContainer,
        Self::OnErrorContainer,
        Self::Background,
        Self::OnBackground,
        Self::Surface,
        Self::OnSurface,
        Self::SurfaceVariant,
        Self::OnSurfaceVariant,
        Self::SurfaceDim,
        Self::SurfaceBright,
        Self::SurfaceContainerLowest,
        Self::SurfaceContainerLow,
        Self::SurfaceContainer,
        Self::SurfaceContainerHigh,
        Self::SurfaceContainerHighest,
        Self::SurfaceTint,
        Self::Outline,
        Self::OutlineVariant,
        Self::InverseSurface,
        Self::InverseOnSurface,
        Self::Shadow,
        Self::Scrim,
        Self::PrimaryFixed,
        Self::PrimaryFixedDim,
        Self::OnPrimaryFixed,
        Self::OnPrimaryFixedVariant,
        Self::SecondaryFixed,
        Self::SecondaryFixedDim,
        Self::OnSecondaryFixed,
        Self::OnSecondaryFixedVariant,
        Self::TertiaryFixed,
        Self::TertiaryFixedDim,
        Self::OnTertiaryFixed,
        Self::OnTertiaryFixedVariant,
    ];
}
