// SPDX-License-Identifier: Apache-2.0
//! Host-neutral visual description of a component: surfaces, state layers, focus rings,
//! glyphs and labels, all coloured by M3 roles. Native hosts turn [`Part`]s into
//! `aphrody_render` scene nodes ([`crate::paint`]); other hosts can draw them directly.

use aphrody_m3_tokens::{
    component::focus_indicator,
    scheme::Role,
    shape::CornerRadius,
    typography::{self, TypeStyle},
};
use serde::{Deserialize, Serialize};

use crate::interaction::{Interaction, StateLayer};

/// A rectangle in dp.
#[derive(Clone, Copy, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct Rect {
    /// Left edge.
    pub x: f32,
    /// Top edge.
    pub y: f32,
    /// Width.
    pub w: f32,
    /// Height.
    pub h: f32,
}

impl Rect {
    /// Build a rectangle.
    #[must_use]
    pub const fn new(x: f32, y: f32, w: f32, h: f32) -> Self {
        Self { x, y, w, h }
    }

    /// A `w`x`h` rectangle centred on `(cx, cy)`.
    #[must_use]
    pub fn centered(cx: f32, cy: f32, w: f32, h: f32) -> Self {
        Self {
            x: cx - w / 2.0,
            y: cy - h / 2.0,
            w,
            h,
        }
    }

    /// Centre point.
    #[must_use]
    pub fn center(self) -> (f32, f32) {
        (self.x + self.w / 2.0, self.y + self.h / 2.0)
    }

    /// Grow (positive) or shrink (negative) every side by `by`.
    #[must_use]
    pub fn inflate(self, by: f32) -> Self {
        Self {
            x: self.x - by,
            y: self.y - by,
            w: self.w + 2.0 * by,
            h: self.h + 2.0 * by,
        }
    }

    /// Whether `(x, y)` lies inside.
    #[must_use]
    pub fn contains(self, x: f32, y: f32) -> bool {
        x >= self.x && y >= self.y && x < self.x + self.w && y < self.y + self.h
    }
}

impl From<crate::layout::LayoutBox> for Rect {
    fn from(solved: crate::layout::LayoutBox) -> Self {
        Self {
            x: solved.x,
            y: solved.y,
            w: solved.width,
            h: solved.height,
        }
    }
}

/// Per-corner radii in dp.
#[derive(Clone, Copy, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct Radii {
    /// Top-left.
    pub tl: f32,
    /// Top-right.
    pub tr: f32,
    /// Bottom-right.
    pub br: f32,
    /// Bottom-left.
    pub bl: f32,
}

impl Radii {
    /// Same radius on every corner.
    #[must_use]
    pub const fn all(radius: f32) -> Self {
        Self {
            tl: radius,
            tr: radius,
            br: radius,
            bl: radius,
        }
    }

    /// Radius of a shape token on a `w`x`h` box; `full` (and any oversize value) becomes a pill.
    #[must_use]
    pub fn shape(token: CornerRadius, w: f32, h: f32) -> Self {
        Self::all(f32::from(token.dp).min(w.min(h) / 2.0))
    }

    /// Leading corners `outer`, trailing corners `inner` (a group's first item).
    #[must_use]
    pub const fn leading(outer: f32, inner: f32) -> Self {
        Self {
            tl: outer,
            bl: outer,
            tr: inner,
            br: inner,
        }
    }

    /// Leading corners `inner`, trailing corners `outer` (a group's last item).
    #[must_use]
    pub const fn trailing(outer: f32, inner: f32) -> Self {
        Self {
            tl: inner,
            bl: inner,
            tr: outer,
            br: outer,
        }
    }

    /// Grow every radius by `by` (a ring drawn outside the shape).
    #[must_use]
    pub fn grow(self, by: f32) -> Self {
        Self {
            tl: self.tl + by,
            tr: self.tr + by,
            br: self.br + by,
            bl: self.bl + by,
        }
    }
}

/// A role at an opacity.
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub struct Tint {
    /// Colour role (serialised by its kebab-case name).
    #[serde(with = "role_name")]
    pub role: Role,
    /// Opacity in `[0, 1]`.
    pub opacity: f32,
}

impl Tint {
    /// Opaque role.
    #[must_use]
    pub const fn solid(role: Role) -> Self {
        Self { role, opacity: 1.0 }
    }

    /// Role at an opacity.
    #[must_use]
    pub const fn with(role: Role, opacity: f32) -> Self {
        Self { role, opacity }
    }
}

mod role_name {
    use aphrody_m3_tokens::scheme::Role;
    use serde::{Deserialize, Deserializer, Serializer};

    pub fn serialize<S: Serializer>(role: &Role, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(role.name())
    }

    pub fn deserialize<'de, D: Deserializer<'de>>(deserializer: D) -> Result<Role, D::Error> {
        let name = String::deserialize(deserializer)?;
        Role::from_name(&name)
            .ok_or_else(|| serde::de::Error::custom(format!("unknown role {name}")))
    }
}

/// Glyphs drawn by the components themselves (as opposed to user icons).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Glyph {
    /// Checkbox / selected filter-chip check mark.
    Check,
    /// Indeterminate checkbox bar.
    Indeterminate,
    /// A Material Symbols icon by ligature name, resolved by the host.
    Symbol(String),
}

/// One paint primitive, back to front.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "part", rename_all = "snake_case")]
pub enum Part {
    /// A filled and/or outlined, optionally elevated, rounded rectangle.
    Surface {
        /// Bounds.
        rect: Rect,
        /// Corner radii.
        radii: Radii,
        /// Fill.
        fill: Option<Tint>,
        /// Outline colour and width (dp), drawn inside the bounds.
        outline: Option<(Tint, f32)>,
        /// Elevation level `0..=5`.
        elevation: u8,
    },
    /// An interaction overlay tinted by a content role.
    StateLayer {
        /// Bounds.
        rect: Rect,
        /// Corner radii.
        radii: Radii,
        /// Tint role (serialised by name).
        #[serde(with = "role_name")]
        role: Role,
        /// Interaction state (sets the opacity).
        layer: StateLayer,
    },
    /// Keyboard focus indicator.
    FocusRing {
        /// Outer bounds of the ring.
        rect: Rect,
        /// Outer corner radii.
        radii: Radii,
        /// Ring colour role.
        #[serde(with = "role_name")]
        role: Role,
        /// Ring thickness in dp.
        thickness: f32,
    },
    /// A glyph scaled into `rect` (24x24 source view box).
    Glyph {
        /// Bounds.
        rect: Rect,
        /// Glyph.
        glyph: Glyph,
        /// Colour.
        tint: Tint,
    },
    /// A text run.
    Label {
        /// Bounds.
        rect: Rect,
        /// Text.
        text: String,
        /// Type-scale style name (`label-large`, …).
        style: String,
        /// Colour.
        tint: Tint,
    },
}

/// The state layer for `interaction` over `rect`, tinted by `role`.
#[must_use]
pub fn state_layer(rect: Rect, radii: Radii, role: Role, interaction: Interaction) -> Option<Part> {
    interaction.state_layer().map(|layer| Part::StateLayer {
        rect,
        radii,
        role,
        layer,
    })
}

/// The focus ring around a shape: `offset` dp from its edge (negative: inside), token thickness.
#[must_use]
pub fn focus_ring(
    rect: Rect,
    radii: Radii,
    role: Role,
    offset: f32,
    interaction: Interaction,
) -> Option<Part> {
    interaction.focus_ring().then(|| {
        let grow = offset + focus_indicator::THICKNESS;
        Part::FocusRing {
            rect: rect.inflate(grow),
            radii: radii.grow(grow),
            role,
            thickness: focus_indicator::THICKNESS,
        }
    })
}

/// Focus ring colour. Every mirrored Google component table that publishes
/// `focus-indicator-color` (checkbox, switch, chips, cards, tabs) maps it to the same role.
pub const FOCUS_ROLE: Role = aphrody_m3_tokens::component::checkbox::FOCUS_INDICATOR_COLOR;

/// System type style by kebab-case name (`label-large`, …).
#[must_use]
pub fn type_style(name: &str) -> Option<TypeStyle> {
    typography::NAMES
        .iter()
        .position(|candidate| *candidate == name)
        .map(|index| typography::ALL[index])
}

/// Average advance of a Google Sans Flex glyph, in em, used only to estimate label widths when
/// the host has not shaped the text yet.
const AVERAGE_ADVANCE_EM: f32 = 0.55;

/// Estimated width of `text` in a system type style; hosts with a shaper should pass measured widths.
#[must_use]
pub fn estimate_text_width(text: &str, style: &str) -> f32 {
    let Some(style) = type_style(style) else {
        return 0.0;
    };
    let glyphs = text.chars().count() as f32;
    glyphs * (style.size_dp * AVERAGE_ADVANCE_EM + style.letter_spacing_dp)
}

/// A label starting at `x`, vertically centred in `rect`, one line high in `style`.
#[must_use]
pub fn label(rect: Rect, x: f32, text: &str, style: &str, tint: Tint) -> Part {
    let line = type_style(style).map_or(rect.h, |style| style.line_height_dp);
    let (_, cy) = rect.center();
    Part::Label {
        rect: Rect::new(x, cy - line / 2.0, (rect.x + rect.w - x).max(0.0), line),
        text: text.to_owned(),
        style: style.to_owned(),
        tint,
    }
}

/// Pick the disabled or enabled tint.
#[must_use]
pub const fn pick(disabled: bool, enabled: Tint, disabled_tint: Tint) -> Tint {
    if disabled { disabled_tint } else { enabled }
}

#[cfg(test)]
mod tests {
    use aphrody_m3_tokens::{scheme::Role, shape};

    use super::{Part, Radii, Rect, focus_ring};
    use crate::interaction::Interaction;

    #[test]
    fn full_shape_becomes_a_pill() {
        assert_eq!(Radii::shape(shape::FULL, 52.0, 32.0), Radii::all(16.0));
        assert_eq!(Radii::shape(shape::MEDIUM, 52.0, 32.0), Radii::all(12.0));
    }

    #[test]
    fn focus_ring_sits_outside_with_token_thickness() {
        let rect = Rect::new(10.0, 10.0, 40.0, 40.0);
        let ring = focus_ring(
            rect,
            Radii::all(20.0),
            Role::Secondary,
            2.0,
            Interaction::FOCUSED,
        );
        let Some(Part::FocusRing {
            rect: ring_rect,
            thickness,
            ..
        }) = ring
        else {
            panic!()
        };
        assert_eq!(thickness, 3.0);
        assert_eq!(ring_rect, Rect::new(5.0, 5.0, 50.0, 50.0));
        assert!(
            focus_ring(
                rect,
                Radii::all(0.0),
                Role::Secondary,
                2.0,
                Interaction::HOVERED
            )
            .is_none()
        );
    }
}
