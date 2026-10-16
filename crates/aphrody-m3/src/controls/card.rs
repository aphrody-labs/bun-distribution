// SPDX-License-Identifier: Apache-2.0
//! Elevated, filled and outlined cards.

use aphrody_m3_tokens::component::{
    elevated_card as elevated, filled_card as filled, focus_indicator, outlined_card as outlined,
};
use serde::{Deserialize, Serialize};

use super::{Control, Event};
use crate::a11y::{AccessRole, Accessible};
use crate::interaction::Interaction;
use crate::keyboard::Key;
use crate::visual::{Part, Radii, Rect, Tint, focus_ring, pick, state_layer};

/// Card style.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CardKind {
    /// Elevated card.
    Elevated,
    /// Filled card.
    Filled,
    /// Outlined card.
    Outlined,
}

/// Card container. A non-interactive card is a `group`; an interactive one is a `button`.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Card {
    /// Style.
    pub kind: CardKind,
    /// Accessible name.
    pub label: String,
    /// Whether the whole card is actionable.
    pub interactive: bool,
    /// Whether the card accepts input.
    pub enabled: bool,
    /// Content size in dp, laid out by the host.
    pub content: (f32, f32),
}

impl Card {
    /// An enabled, non-interactive card.
    #[must_use]
    pub fn new(kind: CardKind, label: impl Into<String>) -> Self {
        Self {
            kind,
            label: label.into(),
            interactive: false,
            enabled: true,
            content: (0.0, 0.0),
        }
    }
}

impl Control for Card {
    fn accessible(&self) -> Accessible {
        let mut node = Accessible::new(
            if self.interactive {
                AccessRole::Button
            } else {
                AccessRole::Group
            },
            &self.label,
        );
        node.focusable = self.interactive;
        node.disabled = !self.enabled;
        node
    }

    fn handle_key(&mut self, key: Key) -> Option<Event> {
        (self.interactive && self.enabled && key.activates()).then_some(Event::Activated)
    }

    fn size(&self) -> (f32, f32) {
        self.content
    }

    fn target(&self) -> (f32, f32) {
        self.content
    }

    fn parts(&self, rect: Rect, interaction: Interaction) -> Vec<Part> {
        let interaction = if self.interactive {
            interaction.with_disabled(interaction.disabled || !self.enabled)
        } else {
            Interaction::IDLE.with_disabled(!self.enabled)
        };
        let disabled = interaction.disabled;
        let hovered = interaction.hovered && !disabled;
        let (fill, outline, elevation, layer_role) = match self.kind {
            CardKind::Elevated => (
                pick(
                    disabled,
                    Tint::solid(elevated::CONTAINER_COLOR),
                    Tint::with(
                        elevated::DISABLED_CONTAINER_COLOR,
                        elevated::DISABLED_CONTAINER_OPACITY,
                    ),
                ),
                None,
                if hovered {
                    elevated::HOVER_CONTAINER_ELEVATION
                } else {
                    elevated::CONTAINER_ELEVATION
                },
                elevated::HOVER_STATE_LAYER_COLOR,
            ),
            CardKind::Filled => (
                pick(
                    disabled,
                    Tint::solid(filled::CONTAINER_COLOR),
                    Tint::with(
                        filled::DISABLED_CONTAINER_COLOR,
                        filled::DISABLED_CONTAINER_OPACITY,
                    ),
                ),
                None,
                if hovered {
                    filled::HOVER_CONTAINER_ELEVATION
                } else {
                    filled::CONTAINER_ELEVATION
                },
                filled::HOVER_STATE_LAYER_COLOR,
            ),
            CardKind::Outlined => (
                Tint::solid(outlined::CONTAINER_COLOR),
                Some((
                    if disabled {
                        Tint::with(
                            outlined::DISABLED_OUTLINE_COLOR,
                            outlined::DISABLED_OUTLINE_OPACITY,
                        )
                    } else if interaction.focused {
                        Tint::solid(outlined::FOCUS_OUTLINE_COLOR)
                    } else {
                        Tint::solid(outlined::OUTLINE_COLOR)
                    },
                    outlined::OUTLINE_WIDTH,
                )),
                if hovered {
                    outlined::HOVER_CONTAINER_ELEVATION
                } else {
                    outlined::CONTAINER_ELEVATION
                },
                outlined::HOVER_STATE_LAYER_COLOR,
            ),
        };
        let radii = Radii::shape(elevated::CONTAINER_SHAPE, rect.w, rect.h);
        let mut parts = vec![Part::Surface {
            rect,
            radii,
            fill: Some(fill),
            outline,
            elevation,
        }];
        if self.interactive {
            parts.extend(state_layer(rect, radii, layer_role, interaction));
            parts.extend(focus_ring(
                rect,
                radii,
                elevated::FOCUS_INDICATOR_COLOR,
                focus_indicator::OUTER_OFFSET,
                interaction,
            ));
        }
        parts
    }
}
