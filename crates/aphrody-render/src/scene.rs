// SPDX-License-Identifier: Apache-2.0
//! Retained M3 scene model.
//!
//! A [`Scene`] is a flat, ordered list of [`Node`]s painted back to front onto
//! a fixed-size physical-pixel canvas. Every colour is either a fixed RGBA
//! value or an M3 [`Role`], resolved against a [`DynamicScheme`] at render
//! time so the same scene renders correctly in light or dark mode without
//! rebuilding the tree.
//!
//! The model is deliberately backend-independent: [`crate::raster`] (CPU) and
//! [`crate::gpu`] (feature `gpu`) both consume the same [`Scene`] and must
//! agree pixel-for-pixel within the tolerance documented in
//! `docs/design/M3-RENDER.md`.

use aphrody_m3_tokens::facade::color::{DynamicScheme, Role, Variant};
use serde::{Deserialize, Deserializer, Serialize, Serializer};

/// Serialize a [`Variant`] by its kebab-case name.
pub(crate) fn serialize_variant<S: Serializer>(
    variant: &Variant,
    serializer: S,
) -> Result<S::Ok, S::Error> {
    serializer.serialize_str(variant.name())
}

/// Deserialize a [`Variant`] from its kebab-case or snake_case name.
pub(crate) fn deserialize_variant<'de, D: Deserializer<'de>>(
    deserializer: D,
) -> Result<Variant, D::Error> {
    let name = String::deserialize(deserializer)?;
    Variant::from_name(&name)
        .ok_or_else(|| serde::de::Error::custom(format!("unknown scheme variant: {name}")))
}

/// An axis-aligned rectangle in physical pixels.
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub struct Rect {
    /// Left edge, in pixels.
    pub x: f32,
    /// Top edge, in pixels.
    pub y: f32,
    /// Width, in pixels.
    pub w: f32,
    /// Height, in pixels.
    pub h: f32,
}

impl Rect {
    /// Build a rectangle from its edges.
    #[must_use]
    pub const fn new(x: f32, y: f32, w: f32, h: f32) -> Self {
        Self { x, y, w, h }
    }

    /// Return `true` when the rectangle has zero or negative area.
    #[must_use]
    pub fn is_empty(self) -> bool {
        self.w <= 0.0 || self.h <= 0.0
    }
}

/// Independent corner radii, matching the M3 shape scale's asymmetric shapes
/// (e.g. a top sheet with square bottom corners).
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub struct Corners {
    /// Top-left radius, in pixels.
    pub tl: f32,
    /// Top-right radius, in pixels.
    pub tr: f32,
    /// Bottom-right radius, in pixels.
    pub br: f32,
    /// Bottom-left radius, in pixels.
    pub bl: f32,
}

impl Corners {
    /// All four corners sharing the same radius.
    #[must_use]
    pub const fn uniform(radius: f32) -> Self {
        Self { tl: radius, tr: radius, br: radius, bl: radius }
    }

    /// No rounding.
    pub const NONE: Self = Self::uniform(0.0);

    /// Build corners from an [`aphrody_m3_tokens::shape::CornerRadius`] token
    /// applied uniformly to all four corners, at the given `dp`-to-pixel scale.
    #[must_use]
    pub fn from_shape_token(
        token: aphrody_m3_tokens::facade::motion::CornerRadius,
        scale: f32,
    ) -> Self {
        // The `full`/pill sentinel (9999dp) is clamped by callers against the
        // shape's own half-extent; here we only convert dp to pixels.
        Self::uniform(f32::from(token.dp) * scale)
    }

    /// Clamp every corner so the four radii never overlap for a `w`x`h` box.
    #[must_use]
    pub fn clamped(self, w: f32, h: f32) -> Self {
        let max_radius = (w.min(h) / 2.0).max(0.0);
        Self {
            tl: self.tl.clamp(0.0, max_radius),
            tr: self.tr.clamp(0.0, max_radius),
            br: self.br.clamp(0.0, max_radius),
            bl: self.bl.clamp(0.0, max_radius),
        }
    }
}

/// An 8-bit-per-channel, straight (non-premultiplied) RGBA colour.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Rgba8 {
    /// Red channel.
    pub r: u8,
    /// Green channel.
    pub g: u8,
    /// Blue channel.
    pub b: u8,
    /// Alpha channel.
    pub a: u8,
}

impl Rgba8 {
    /// Fully opaque black.
    pub const BLACK: Self = Self { r: 0, g: 0, b: 0, a: 255 };
    /// Fully transparent.
    pub const TRANSPARENT: Self = Self { r: 0, g: 0, b: 0, a: 0 };

    /// Build a colour from a packed `0xAARRGGBB` value, as returned by
    /// [`DynamicScheme::argb`].
    #[must_use]
    pub const fn from_argb(argb: u32) -> Self {
        Self { a: (argb >> 24) as u8, r: (argb >> 16) as u8, g: (argb >> 8) as u8, b: argb as u8 }
    }

    /// Multiply the alpha channel by `factor` (clamped to `[0, 1]`).
    #[must_use]
    pub fn with_alpha_factor(self, factor: f32) -> Self {
        let factor = factor.clamp(0.0, 1.0);
        Self { a: (f32::from(self.a) * factor).round() as u8, ..self }
    }
}

/// A colour that is either fixed or resolved from the active [`DynamicScheme`].
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Paint {
    /// An M3 colour role, resolved against the scene's scheme.
    Role(Role),
    /// A fixed, scheme-independent colour.
    Fixed(Rgba8),
}

/// Serde wire representation of [`Paint`].
///
/// `aphrody_m3_tokens::scheme::Role` does not derive `serde` (it lives in a
/// `no_std`-friendly crate), so `Paint` implements `Serialize`/`Deserialize`
/// by hand through this shadow enum instead of relying on derive helpers
/// (`tag`/`content` do not compose with per-field `deserialize_with` for
/// externally-owned types).
#[derive(Serialize, Deserialize)]
#[serde(tag = "kind", content = "value", rename_all = "snake_case")]
enum PaintWire {
    Role(String),
    Fixed(Rgba8),
}

impl Serialize for Paint {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let wire = match *self {
            Self::Role(role) => PaintWire::Role(role.name().to_string()),
            Self::Fixed(rgba) => PaintWire::Fixed(rgba),
        };
        wire.serialize(serializer)
    }
}

impl<'de> Deserialize<'de> for Paint {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        match PaintWire::deserialize(deserializer)? {
            PaintWire::Role(name) => Role::from_name(&name)
                .map(Self::Role)
                .ok_or_else(|| serde::de::Error::custom(format!("unknown role: {name}"))),
            PaintWire::Fixed(rgba) => Ok(Self::Fixed(rgba)),
        }
    }
}

impl Paint {
    /// Resolve this paint to a concrete colour using `scheme`.
    #[must_use]
    pub fn resolve(self, scheme: &DynamicScheme) -> Rgba8 {
        match self {
            Self::Role(role) => Rgba8::from_argb(scheme.argb(role)),
            Self::Fixed(rgba) => rgba,
        }
    }
}

/// M3 interaction state layers (`aphrody_m3_tokens::state`).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum StateKind {
    /// Pointer hover.
    Hover,
    /// Keyboard/programmatic focus.
    Focus,
    /// Pressed / active.
    Pressed,
    /// Being dragged.
    Dragged,
}

impl StateKind {
    /// The M3 opacity token for this state.
    #[must_use]
    pub const fn opacity(self) -> f32 {
        match self {
            Self::Hover => aphrody_m3_tokens::facade::motion::HOVER.opacity,
            Self::Focus => aphrody_m3_tokens::facade::motion::FOCUS.opacity,
            Self::Pressed => aphrody_m3_tokens::facade::motion::PRESSED.opacity,
            Self::Dragged => aphrody_m3_tokens::facade::motion::DRAGGED.opacity,
        }
    }
}

/// A 1dp-scaled outline stroke.
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub struct Outline {
    /// Stroke colour.
    pub color: Paint,
    /// Stroke width, in pixels.
    pub width: f32,
}

/// The 15 canonical M3 type styles, naming the constants in
/// `aphrody_m3_tokens::facade::typography`.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
#[allow(missing_docs, reason = "self-documenting M3 type-scale names")]
pub enum TypeStyleName {
    DisplayLarge,
    DisplayMedium,
    DisplaySmall,
    HeadlineLarge,
    HeadlineMedium,
    HeadlineSmall,
    TitleLarge,
    TitleMedium,
    TitleSmall,
    BodyLarge,
    BodyMedium,
    BodySmall,
    LabelLarge,
    LabelMedium,
    LabelSmall,
}

impl TypeStyleName {
    /// Resolve to the canonical `aphrody_m3_tokens::typography` constant.
    #[must_use]
    pub const fn style(self) -> aphrody_m3_tokens::facade::typography::TypeStyle {
        use aphrody_m3_tokens::facade::typography::{
            BODY_LARGE, BODY_MEDIUM, BODY_SMALL, DISPLAY_LARGE, DISPLAY_MEDIUM, DISPLAY_SMALL,
            HEADLINE_LARGE, HEADLINE_MEDIUM, HEADLINE_SMALL, LABEL_LARGE, LABEL_MEDIUM,
            LABEL_SMALL, TITLE_LARGE, TITLE_MEDIUM, TITLE_SMALL,
        };
        match self {
            Self::DisplayLarge => DISPLAY_LARGE,
            Self::DisplayMedium => DISPLAY_MEDIUM,
            Self::DisplaySmall => DISPLAY_SMALL,
            Self::HeadlineLarge => HEADLINE_LARGE,
            Self::HeadlineMedium => HEADLINE_MEDIUM,
            Self::HeadlineSmall => HEADLINE_SMALL,
            Self::TitleLarge => TITLE_LARGE,
            Self::TitleMedium => TITLE_MEDIUM,
            Self::TitleSmall => TITLE_SMALL,
            Self::BodyLarge => BODY_LARGE,
            Self::BodyMedium => BODY_MEDIUM,
            Self::BodySmall => BODY_SMALL,
            Self::LabelLarge => LABEL_LARGE,
            Self::LabelMedium => LABEL_MEDIUM,
            Self::LabelSmall => LABEL_SMALL,
        }
    }
}

/// A single paintable element of a [`Scene`].
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "node", rename_all = "snake_case")]
pub enum Node {
    /// A tonal-fill rounded rectangle, optionally elevated (M3 key + ambient
    /// shadow) and optionally outlined.
    Surface {
        /// Bounds.
        rect: Rect,
        /// Corner radii.
        corners: Corners,
        /// Fill colour.
        fill: Paint,
        /// M3 elevation level (`0..=5`); `0` paints no shadow.
        elevation: u8,
        /// Optional outline stroke.
        #[serde(default)]
        outline: Option<Outline>,
    },
    /// A semi-transparent state-layer overlay tinted by a content role.
    StateLayer {
        /// Bounds.
        rect: Rect,
        /// Corner radii.
        corners: Corners,
        /// Content colour role the overlay is tinted from (e.g. `on-primary`).
        content: Paint,
        /// Which interaction state this layer represents.
        state: StateKind,
    },
    /// An expanding circular ripple.
    Ripple {
        /// Centre X, in pixels.
        cx: f32,
        /// Centre Y, in pixels.
        cy: f32,
        /// Radius, in pixels.
        radius: f32,
        /// Ripple colour.
        color: Paint,
        /// Overall alpha multiplier in `[0, 1]` (progress fade-out).
        alpha: f32,
    },
    /// A run of shaped, rasterized text.
    Text {
        /// Baseline-anchored bounds; text is laid out left-to-top within it.
        rect: Rect,
        /// UTF-8 text content.
        text: String,
        /// M3 type style.
        style: TypeStyleName,
        /// Text colour.
        color: Paint,
    },
    /// A filled icon, given as one or more SVG path `d` strings (nonzero fill).
    Icon {
        /// Bounds the icon's viewBox is scaled into (assumes a 24x24 source
        /// viewBox per Material Symbols convention).
        rect: Rect,
        /// SVG path data (`d` attribute contents).
        path: String,
        /// Icon colour.
        color: Paint,
    },
    /// A pre-decoded RGBA8 raster image, nearest-scaled into `rect`.
    Image {
        /// Destination bounds.
        rect: Rect,
        /// Source pixel width.
        width: u32,
        /// Source pixel height.
        height: u32,
        /// Straight (non-premultiplied) RGBA8 pixels, `width * height * 4` bytes.
        rgba: Vec<u8>,
    },
}

/// A retained, backend-independent M3 scene.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(bound(deserialize = ""))]
pub struct Scene {
    /// Canvas width, in physical pixels.
    pub width: u32,
    /// Canvas height, in physical pixels.
    pub height: u32,
    /// Packed ARGB seed colour (`0xAARRGGBB`) used to derive the scheme.
    pub seed_argb: u32,
    /// Colour scheme variant.
    #[serde(
        default = "default_variant",
        serialize_with = "serialize_variant",
        deserialize_with = "deserialize_variant"
    )]
    pub variant: Variant,
    /// Whether to resolve the dark scheme.
    #[serde(default)]
    pub is_dark: bool,
    /// M3 contrast level in `[-1, 1]`.
    #[serde(default)]
    pub contrast_level: f64,
    /// Background fill painted before any node (`None` leaves it transparent).
    #[serde(default)]
    pub background: Option<Paint>,
    /// Nodes painted back to front.
    pub nodes: Vec<Node>,
}

pub(crate) fn default_variant() -> Variant {
    Variant::TonalSpot
}

impl Scene {
    /// Build the [`DynamicScheme`] this scene resolves colours against.
    #[must_use]
    pub fn scheme(&self) -> DynamicScheme {
        DynamicScheme::from_argb(self.seed_argb, self.variant, self.is_dark, self.contrast_level)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn corners_clamp_to_half_extent() {
        let corners = Corners::uniform(200.0).clamped(100.0, 40.0);
        assert_eq!(corners.tl, 20.0);
        assert_eq!(corners.br, 20.0);
    }

    #[test]
    fn rgba8_round_trips_argb() {
        let rgba = Rgba8::from_argb(0xFF67_50A4);
        assert_eq!(rgba, Rgba8 { r: 0x67, g: 0x50, b: 0xA4, a: 0xFF });
    }

    #[test]
    fn paint_resolves_role_against_scheme() {
        let scheme = DynamicScheme::from_argb(
            0xFF67_50A4,
            aphrody_m3_tokens::facade::color::Variant::TonalSpot,
            false,
            0.0,
        );
        let resolved = Paint::Role(Role::Primary).resolve(&scheme);
        assert_eq!(resolved, Rgba8::from_argb(scheme.argb(Role::Primary)));
    }

    #[test]
    fn scene_round_trips_through_json() {
        let scene = Scene {
            width: 10,
            height: 10,
            seed_argb: 0xFF67_50A4,
            variant: aphrody_m3_tokens::facade::color::Variant::TonalSpot,
            is_dark: false,
            contrast_level: 0.0,
            background: Some(Paint::Role(Role::Surface)),
            nodes: vec![Node::Surface {
                rect: Rect::new(0.0, 0.0, 10.0, 10.0),
                corners: Corners::uniform(4.0),
                fill: Paint::Role(Role::Primary),
                elevation: 1,
                outline: None,
            }],
        };
        let json = serde_json::to_string(&scene).expect("serialize");
        let back: Scene = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(scene, back);
    }
}
