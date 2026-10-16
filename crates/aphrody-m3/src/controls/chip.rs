// SPDX-License-Identifier: Apache-2.0
//! Assist, filter, input and suggestion chips.

use aphrody_m3_tokens::component::{
    assist_chip as assist, filter_chip as filter, input_chip as input,
    suggestion_chip as suggestion,
};
use aphrody_m3_tokens::scheme::Role;
use serde::{Deserialize, Serialize};

use super::{Control, Event};
use crate::a11y::{AccessRole, Accessible};
use crate::interaction::Interaction;
use crate::keyboard::Key;
use crate::visual::{
    Glyph, Part, Radii, Rect, Tint, estimate_text_width, focus_ring, label, pick, state_layer,
};

/// material-web chip insets (`chips/internal/_shared.scss`): 16 dp beside a bare label, 8 dp
/// beside an icon, 8 dp between icon and label. Geometry, not tokens.
const LABEL_INSET: f32 = 16.0;
const ICON_INSET: f32 = 8.0;
const ICON_LABEL_SPACE: f32 = 8.0;

/// Chip family.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ChipKind {
    /// Assist chip (action).
    Assist,
    /// Filter chip (toggle).
    Filter,
    /// Input chip (removable entity).
    Input,
    /// Suggestion chip.
    Suggestion,
}

/// Chip.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Chip {
    /// Family.
    pub kind: ChipKind,
    /// Label text.
    pub label: String,
    /// Leading Material Symbol, if any.
    pub icon: Option<String>,
    /// Selected (filter and input chips).
    pub selected: bool,
    /// Elevated container instead of an outline (assist chips).
    pub elevated: bool,
    /// Whether the chip accepts input.
    pub enabled: bool,
    /// Measured label width in dp; `None` uses [`estimate_text_width`].
    pub label_width: Option<f32>,
}

impl Chip {
    /// An enabled, flat, unselected chip.
    #[must_use]
    pub fn new(kind: ChipKind, label: impl Into<String>) -> Self {
        Self {
            kind,
            label: label.into(),
            icon: None,
            selected: false,
            elevated: false,
            enabled: true,
            label_width: None,
        }
    }

    fn leading_icon(&self) -> Option<Glyph> {
        if self.kind == ChipKind::Filter && self.selected {
            return Some(Glyph::Check);
        }
        self.icon.clone().map(Glyph::Symbol)
    }

    fn label_style(&self) -> &'static str {
        match self.kind {
            ChipKind::Assist => assist::LABEL_TEXT_SIZE,
            ChipKind::Filter => filter::LABEL_TEXT_SIZE,
            ChipKind::Input => input::LABEL_TEXT_SIZE,
            ChipKind::Suggestion => suggestion::LABEL_TEXT_SIZE,
        }
    }

    fn icon_size(&self) -> f32 {
        match self.kind {
            ChipKind::Filter => filter::WITH_ICON_ICON_SIZE,
            ChipKind::Input => input::WITH_TRAILING_ICON_TRAILING_ICON_SIZE,
            ChipKind::Assist | ChipKind::Suggestion => assist::WITH_ICON_ICON_SIZE,
        }
    }

    /// Container colour, outline and elevation for the current state.
    fn container(&self, disabled: bool, hovered: bool) -> (Option<Tint>, Option<(Tint, f32)>, u8) {
        let outline = |role: Role, width: f32, disabled_role: Role, disabled_opacity: f32| {
            (width > 0.0).then(|| {
                (
                    pick(
                        disabled,
                        Tint::solid(role),
                        Tint::with(disabled_role, disabled_opacity),
                    ),
                    width,
                )
            })
        };
        match self.kind {
            ChipKind::Assist if self.elevated => (
                Some(pick(
                    disabled,
                    Tint::solid(assist::ELEVATED_CONTAINER_COLOR),
                    Tint::with(
                        assist::ELEVATED_DISABLED_CONTAINER_COLOR,
                        assist::ELEVATED_DISABLED_CONTAINER_OPACITY,
                    ),
                )),
                None,
                match (disabled, hovered) {
                    (true, _) => 0,
                    (false, true) => assist::ELEVATED_HOVER_CONTAINER_ELEVATION,
                    (false, false) => assist::ELEVATED_CONTAINER_ELEVATION,
                },
            ),
            ChipKind::Assist => (
                None,
                outline(
                    assist::FLAT_OUTLINE_COLOR,
                    assist::FLAT_OUTLINE_WIDTH,
                    assist::FLAT_DISABLED_OUTLINE_COLOR,
                    assist::FLAT_DISABLED_OUTLINE_OPACITY,
                ),
                0,
            ),
            ChipKind::Suggestion => (
                None,
                outline(
                    suggestion::FLAT_OUTLINE_COLOR,
                    suggestion::FLAT_OUTLINE_WIDTH,
                    suggestion::FLAT_DISABLED_OUTLINE_COLOR,
                    suggestion::FLAT_DISABLED_OUTLINE_OPACITY,
                ),
                0,
            ),
            ChipKind::Filter if self.selected => (
                Some(pick(
                    disabled,
                    Tint::solid(filter::FLAT_SELECTED_CONTAINER_COLOR),
                    Tint::with(
                        filter::FLAT_DISABLED_SELECTED_CONTAINER_COLOR,
                        filter::FLAT_DISABLED_SELECTED_CONTAINER_OPACITY,
                    ),
                )),
                None,
                0,
            ),
            ChipKind::Filter => (
                None,
                outline(
                    filter::FLAT_UNSELECTED_OUTLINE_COLOR,
                    filter::FLAT_UNSELECTED_OUTLINE_WIDTH,
                    filter::FLAT_DISABLED_UNSELECTED_OUTLINE_COLOR,
                    filter::FLAT_DISABLED_UNSELECTED_OUTLINE_OPACITY,
                ),
                0,
            ),
            ChipKind::Input if self.selected => (
                Some(pick(
                    disabled,
                    Tint::solid(input::SELECTED_CONTAINER_COLOR),
                    Tint::with(
                        input::DISABLED_SELECTED_CONTAINER_COLOR,
                        input::DISABLED_SELECTED_CONTAINER_OPACITY,
                    ),
                )),
                None,
                0,
            ),
            ChipKind::Input => (
                None,
                outline(
                    input::UNSELECTED_OUTLINE_COLOR,
                    input::UNSELECTED_OUTLINE_WIDTH,
                    input::DISABLED_UNSELECTED_OUTLINE_COLOR,
                    input::DISABLED_UNSELECTED_OUTLINE_OPACITY,
                ),
                0,
            ),
        }
    }

    /// Label colour, icon colour and state-layer role.
    fn content(&self, disabled: bool) -> (Tint, Tint, Role) {
        let (label_role, icon_role, layer, disabled_role, disabled_opacity) = match self.kind {
            ChipKind::Assist => (
                assist::LABEL_TEXT_COLOR,
                assist::WITH_ICON_ICON_COLOR,
                assist::HOVER_STATE_LAYER_COLOR,
                assist::DISABLED_LABEL_TEXT_COLOR,
                assist::DISABLED_LABEL_TEXT_OPACITY,
            ),
            ChipKind::Suggestion => (
                suggestion::LABEL_TEXT_COLOR,
                suggestion::LABEL_TEXT_COLOR,
                suggestion::HOVER_STATE_LAYER_COLOR,
                suggestion::DISABLED_LABEL_TEXT_COLOR,
                suggestion::DISABLED_LABEL_TEXT_OPACITY,
            ),
            ChipKind::Filter if self.selected => (
                filter::SELECTED_LABEL_TEXT_COLOR,
                filter::WITH_ICON_SELECTED_ICON_COLOR,
                filter::SELECTED_HOVER_STATE_LAYER_COLOR,
                filter::DISABLED_LABEL_TEXT_COLOR,
                filter::DISABLED_LABEL_TEXT_OPACITY,
            ),
            ChipKind::Filter => (
                filter::UNSELECTED_LABEL_TEXT_COLOR,
                filter::WITH_ICON_UNSELECTED_ICON_COLOR,
                filter::UNSELECTED_HOVER_STATE_LAYER_COLOR,
                filter::DISABLED_LABEL_TEXT_COLOR,
                filter::DISABLED_LABEL_TEXT_OPACITY,
            ),
            ChipKind::Input if self.selected => (
                input::SELECTED_LABEL_TEXT_COLOR,
                input::SELECTED_LABEL_TEXT_COLOR,
                input::SELECTED_LABEL_TEXT_COLOR,
                input::DISABLED_LABEL_TEXT_COLOR,
                input::DISABLED_LABEL_TEXT_OPACITY,
            ),
            ChipKind::Input => (
                input::LABEL_TEXT_COLOR,
                input::LABEL_TEXT_COLOR,
                input::HOVER_STATE_LAYER_COLOR,
                input::DISABLED_LABEL_TEXT_COLOR,
                input::DISABLED_LABEL_TEXT_OPACITY,
            ),
        };
        let disabled_tint = Tint::with(disabled_role, disabled_opacity);
        (
            pick(disabled, Tint::solid(label_role), disabled_tint),
            pick(disabled, Tint::solid(icon_role), disabled_tint),
            layer,
        )
    }
}

impl Control for Chip {
    fn accessible(&self) -> Accessible {
        let mut node = Accessible::new(AccessRole::Button, &self.label);
        node.disabled = !self.enabled;
        if self.kind == ChipKind::Filter {
            node.pressed = Some(self.selected);
        }
        if self.kind == ChipKind::Input {
            node.description = Some("Backspace or Delete removes".into());
        }
        node
    }

    fn handle_key(&mut self, key: Key) -> Option<Event> {
        if !self.enabled {
            return None;
        }
        match (self.kind, key) {
            (ChipKind::Filter, key) if key.activates() => {
                self.selected = !self.selected;
                Some(Event::Toggled(self.selected))
            }
            (ChipKind::Input, Key::Backspace | Key::Delete) => Some(Event::Removed),
            (_, key) if key.activates() => Some(Event::Activated),
            _ => None,
        }
    }

    fn size(&self) -> (f32, f32) {
        let text = self
            .label_width
            .unwrap_or_else(|| estimate_text_width(&self.label, self.label_style()));
        let leading = if self.leading_icon().is_some() {
            ICON_INSET + self.icon_size() + ICON_LABEL_SPACE
        } else {
            LABEL_INSET
        };
        let trailing = if self.kind == ChipKind::Input {
            ICON_LABEL_SPACE + self.icon_size() + ICON_INSET
        } else {
            LABEL_INSET
        };
        (leading + text + trailing, assist::CONTAINER_HEIGHT)
    }

    fn parts(&self, rect: Rect, interaction: Interaction) -> Vec<Part> {
        let interaction = interaction.with_disabled(interaction.disabled || !self.enabled);
        let disabled = interaction.disabled;
        let (_, cy) = rect.center();
        let (w, h) = self.size();
        let chip = Rect::new(rect.x, cy - h / 2.0, w.max(rect.w), h);
        let radii = Radii::shape(assist::CONTAINER_SHAPE, chip.w, chip.h);
        let (fill, outline, elevation) = self.container(disabled, interaction.hovered);
        let (text_tint, icon_tint, layer_role) = self.content(disabled);
        let mut parts = vec![Part::Surface {
            rect: chip,
            radii,
            fill,
            outline,
            elevation,
        }];
        parts.extend(state_layer(chip, radii, layer_role, interaction));
        let icon_size = self.icon_size();
        let mut x = chip.x + LABEL_INSET;
        if let Some(glyph) = self.leading_icon() {
            parts.push(Part::Glyph {
                rect: Rect::new(
                    chip.x + ICON_INSET,
                    cy - icon_size / 2.0,
                    icon_size,
                    icon_size,
                ),
                glyph,
                tint: icon_tint,
            });
            x = chip.x + ICON_INSET + icon_size + ICON_LABEL_SPACE;
        }
        parts.push(label(chip, x, &self.label, self.label_style(), text_tint));
        if self.kind == ChipKind::Input {
            parts.push(Part::Glyph {
                rect: Rect::new(
                    chip.x + chip.w - ICON_INSET - icon_size,
                    cy - icon_size / 2.0,
                    icon_size,
                    icon_size,
                ),
                glyph: Glyph::Symbol("close".into()),
                tint: icon_tint,
            });
        }
        parts.extend(focus_ring(
            chip,
            radii,
            assist::FOCUS_INDICATOR_COLOR,
            aphrody_m3_tokens::component::focus_indicator::OUTER_OFFSET,
            interaction,
        ));
        parts
    }
}
