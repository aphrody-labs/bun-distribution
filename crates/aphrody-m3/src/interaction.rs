// SPDX-License-Identifier: Apache-2.0
//! Interaction state (hover, focus, pressed, dragged, disabled) and the M3 state layer it
//! resolves to. Opacities come from `aphrody_m3_tokens::state`.

use aphrody_m3_tokens::state;
use serde::{Deserialize, Serialize};

/// Which M3 state layer is shown.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum StateLayer {
    /// Pointer hover (`md.sys.state.hover.state-layer-opacity`).
    Hover,
    /// Focus (`md.sys.state.focus.state-layer-opacity`).
    Focus,
    /// Pressed (`md.sys.state.pressed.state-layer-opacity`).
    Pressed,
    /// Dragged (`md.sys.state.dragged.state-layer-opacity`).
    Dragged,
}

impl StateLayer {
    /// Overlay opacity of this layer.
    #[must_use]
    pub const fn opacity(self) -> f32 {
        match self {
            Self::Hover => state::HOVER.opacity,
            Self::Focus => state::FOCUS.opacity,
            Self::Pressed => state::PRESSED.opacity,
            Self::Dragged => state::DRAGGED.opacity,
        }
    }
}

/// Pointer and keyboard state of one interactive element.
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
pub struct Interaction {
    /// Pointer is over the element.
    pub hovered: bool,
    /// Element has focus.
    pub focused: bool,
    /// Focus came from the keyboard (`:focus-visible`), so the focus ring is drawn.
    pub focus_visible: bool,
    /// Pointer or key is held down.
    pub pressed: bool,
    /// Element is being dragged.
    pub dragged: bool,
    /// Element is disabled: no state layer, no focus ring, no activation.
    pub disabled: bool,
}

impl Interaction {
    /// Idle, enabled.
    pub const IDLE: Self = Self {
        hovered: false,
        focused: false,
        focus_visible: false,
        pressed: false,
        dragged: false,
        disabled: false,
    };

    /// Pointer hover.
    pub const HOVERED: Self = Self {
        hovered: true,
        ..Self::IDLE
    };
    /// Keyboard focus (focus-visible).
    pub const FOCUSED: Self = Self {
        focused: true,
        focus_visible: true,
        ..Self::IDLE
    };
    /// Pressed under the pointer.
    pub const PRESSED: Self = Self {
        hovered: true,
        pressed: true,
        ..Self::IDLE
    };
    /// Disabled.
    pub const DISABLED: Self = Self {
        disabled: true,
        ..Self::IDLE
    };

    /// The state layer to draw; the strongest state wins (dragged > pressed > focus > hover).
    #[must_use]
    pub const fn state_layer(self) -> Option<StateLayer> {
        if self.disabled {
            None
        } else if self.dragged {
            Some(StateLayer::Dragged)
        } else if self.pressed {
            Some(StateLayer::Pressed)
        } else if self.focused {
            Some(StateLayer::Focus)
        } else if self.hovered {
            Some(StateLayer::Hover)
        } else {
            None
        }
    }

    /// Whether the focus indicator is drawn.
    #[must_use]
    pub const fn focus_ring(self) -> bool {
        !self.disabled && self.focused && self.focus_visible
    }

    /// Copy with `disabled` set.
    #[must_use]
    pub const fn with_disabled(self, disabled: bool) -> Self {
        Self { disabled, ..self }
    }
}

#[cfg(test)]
mod tests {
    use super::{Interaction, StateLayer};

    #[test]
    fn strongest_state_wins_and_disabled_suppresses_layers() {
        assert_eq!(Interaction::IDLE.state_layer(), None);
        assert_eq!(Interaction::HOVERED.state_layer(), Some(StateLayer::Hover));
        assert_eq!(
            Interaction::PRESSED.state_layer(),
            Some(StateLayer::Pressed)
        );
        let focused_hover = Interaction {
            hovered: true,
            ..Interaction::FOCUSED
        };
        assert_eq!(focused_hover.state_layer(), Some(StateLayer::Focus));
        let drag = Interaction {
            dragged: true,
            ..Interaction::PRESSED
        };
        assert_eq!(drag.state_layer(), Some(StateLayer::Dragged));
        assert_eq!(Interaction::PRESSED.with_disabled(true).state_layer(), None);
        assert!(!Interaction::FOCUSED.with_disabled(true).focus_ring());
        assert!(Interaction::FOCUSED.focus_ring());
        assert!(
            !Interaction {
                focused: true,
                ..Interaction::IDLE
            }
            .focus_ring()
        );
    }

    #[test]
    fn opacities_are_the_system_tokens() {
        assert_eq!(StateLayer::Hover.opacity(), 0.08);
        assert_eq!(StateLayer::Focus.opacity(), 0.10);
        assert_eq!(StateLayer::Pressed.opacity(), 0.10);
        assert_eq!(StateLayer::Dragged.opacity(), 0.16);
    }
}
