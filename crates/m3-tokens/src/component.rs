// SPDX-License-Identifier: Apache-2.0
//! Material 3 component tokens (`md.comp.*`).
//!
//! Each submodule mirrors one Google token set of `material-web` v2.5.0
//! (`tokens/versions/latest/sass/_md-comp-<name>.scss`, design system Google Material 3
//! 34.0.21, audience 3p, platform web). Values are typed against the system tables of this
//! crate: colours are [`Role`]s, shapes are [`shape`] tokens, state-layer opacities come from
//! [`state`], elevations are level indices of [`crate::elevation::LEVELS`] and springs come
//! from [`motion`]. Literal sizes are in dp.
//!
//! A table holds the tokens the native components consume, not every token Google
//! publishes for the component: `tests/google_components.rs` compares each declared token
//! to the pinned Google file (`tests/fixtures/google/PROVENANCE.json`) and reports the
//! declared/published coverage per component. Error-state, typography line-height/weight
//! and per-state duplicate tokens are not mirrored.

use crate::{motion, scheme::Role, shape, shape::CornerRadius, state};

/// A typed component token value.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum TokenValue {
    /// A length in dp.
    Dp(f32),
    /// A colour role.
    Role(Role),
    /// An opacity in `[0, 1]`.
    Opacity(f32),
    /// A named corner token of the system shape scale.
    Shape(CornerRadius),
    /// An elevation level index (`0..=5`).
    Elevation(u8),
    /// A unitless number (spring damping ratio or stiffness).
    Number(f32),
    /// A percentage (`50.0` is `50%`).
    Percent(f32),
    /// A system type style, by its kebab-case name in [`crate::typography::NAMES`].
    Type(&'static str),
}

/// One named component token.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct ComponentToken {
    /// Token name after `md.comp.<component>.` (kebab-case, as in the Google file).
    pub name: &'static str,
    /// Typed value.
    pub value: TokenValue,
}

/// The mirrored tokens of one Google component token set.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct ComponentTokens {
    /// Google component name (`md.comp.<component>`), e.g. `"checkbox"`.
    pub component: &'static str,
    /// Whether the token set belongs to the M3 Expressive additions.
    pub expressive: bool,
    /// Mirrored tokens, in declaration order.
    pub tokens: &'static [ComponentToken],
}

impl ComponentTokens {
    /// Look up a mirrored token by name.
    #[must_use]
    pub fn get(&self, name: &str) -> Option<TokenValue> {
        self.tokens
            .iter()
            .find(|token| token.name == name)
            .map(|token| token.value)
    }
}

/// `md.sys.state.focus-indicator` (`_md-sys-state-focus-indicator.scss`).
pub mod focus_indicator {
    /// Focus ring stroke thickness in dp.
    pub const THICKNESS: f32 = 3.0;
    /// Offset of a focus ring drawn outside the component, in dp.
    pub const OUTER_OFFSET: f32 = 2.0;
    /// Offset of a focus ring drawn inside the component (negative: inset), in dp.
    pub const INNER_OFFSET: f32 = -3.0;
}

macro_rules! component_tokens {
    (@ty Dp) => { f32 };
    (@ty Role) => { Role };
    (@ty Opacity) => { f32 };
    (@ty Shape) => { CornerRadius };
    (@ty Elevation) => { u8 };
    (@ty Number) => { f32 };
    (@ty Percent) => { f32 };
    (@ty Type) => { &'static str };
    (
        $(#[$doc:meta])*
        $module:ident = $google:literal, expressive: $expressive:literal {
            $( $konst:ident = $name:literal : $kind:ident ( $value:expr ) ; )*
        }
    ) => {
        $(#[$doc])*
        pub mod $module {
            #[allow(unused_imports, reason = "each table uses a subset of the shared imports")]
            use super::{CornerRadius, Role, focus_indicator, motion, shape, state};
            use super::{ComponentToken, ComponentTokens, TokenValue};
            $(
                #[doc = concat!("`md.comp.", $google, ".", $name, "`.")]
                pub const $konst: component_tokens!(@ty $kind) = $value;
            )*
            /// Every mirrored token of this set, in declaration order.
            pub const TABLE: ComponentTokens = ComponentTokens {
                component: $google,
                expressive: $expressive,
                tokens: &[$(ComponentToken { name: $name, value: TokenValue::$kind($konst) },)*],
            };
        }
    };
}

component_tokens! {
    /// Checkbox.
    checkbox = "checkbox", expressive: false {
        CONTAINER_SIZE = "container-size": Dp(18.0);
        CONTAINER_SHAPE = "container-shape": Dp(2.0);
        ICON_SIZE = "icon-size": Dp(18.0);
        STATE_LAYER_SIZE = "state-layer-size": Dp(40.0);
        STATE_LAYER_SHAPE = "state-layer-shape": Shape(shape::FULL);
        UNSELECTED_OUTLINE_WIDTH = "unselected-outline-width": Dp(2.0);
        UNSELECTED_OUTLINE_COLOR = "unselected-outline-color": Role(Role::OnSurfaceVariant);
        UNSELECTED_HOVER_OUTLINE_COLOR = "unselected-hover-outline-color": Role(Role::OnSurface);
        UNSELECTED_DISABLED_OUTLINE_COLOR = "unselected-disabled-outline-color": Role(Role::OnSurface);
        UNSELECTED_DISABLED_CONTAINER_OPACITY = "unselected-disabled-container-opacity": Opacity(0.38);
        UNSELECTED_HOVER_STATE_LAYER_COLOR = "unselected-hover-state-layer-color": Role(Role::OnSurface);
        UNSELECTED_HOVER_STATE_LAYER_OPACITY = "unselected-hover-state-layer-opacity": Opacity(state::HOVER.opacity);
        UNSELECTED_FOCUS_STATE_LAYER_COLOR = "unselected-focus-state-layer-color": Role(Role::OnSurface);
        UNSELECTED_FOCUS_STATE_LAYER_OPACITY = "unselected-focus-state-layer-opacity": Opacity(state::FOCUS.opacity);
        UNSELECTED_PRESSED_STATE_LAYER_COLOR = "unselected-pressed-state-layer-color": Role(Role::Primary);
        UNSELECTED_PRESSED_STATE_LAYER_OPACITY = "unselected-pressed-state-layer-opacity": Opacity(state::PRESSED.opacity);
        SELECTED_OUTLINE_WIDTH = "selected-outline-width": Dp(0.0);
        SELECTED_CONTAINER_COLOR = "selected-container-color": Role(Role::Primary);
        SELECTED_ICON_COLOR = "selected-icon-color": Role(Role::OnPrimary);
        SELECTED_HOVER_STATE_LAYER_COLOR = "selected-hover-state-layer-color": Role(Role::Primary);
        SELECTED_HOVER_STATE_LAYER_OPACITY = "selected-hover-state-layer-opacity": Opacity(state::HOVER.opacity);
        SELECTED_FOCUS_STATE_LAYER_COLOR = "selected-focus-state-layer-color": Role(Role::Primary);
        SELECTED_PRESSED_STATE_LAYER_COLOR = "selected-pressed-state-layer-color": Role(Role::OnSurface);
        SELECTED_PRESSED_STATE_LAYER_OPACITY = "selected-pressed-state-layer-opacity": Opacity(state::PRESSED.opacity);
        SELECTED_DISABLED_CONTAINER_COLOR = "selected-disabled-container-color": Role(Role::OnSurface);
        SELECTED_DISABLED_CONTAINER_OPACITY = "selected-disabled-container-opacity": Opacity(0.38);
        SELECTED_DISABLED_ICON_COLOR = "selected-disabled-icon-color": Role(Role::Surface);
        FOCUS_INDICATOR_COLOR = "focus-indicator-color": Role(Role::Secondary);
        FOCUS_INDICATOR_THICKNESS = "focus-indicator-thickness": Dp(focus_indicator::THICKNESS);
        FOCUS_INDICATOR_OUTLINE_OFFSET = "focus-indicator-outline-offset": Dp(focus_indicator::OUTER_OFFSET);
    }
}

component_tokens! {
    /// Switch.
    switch = "switch", expressive: false {
        TRACK_WIDTH = "track-width": Dp(52.0);
        TRACK_HEIGHT = "track-height": Dp(32.0);
        TRACK_OUTLINE_WIDTH = "track-outline-width": Dp(2.0);
        TRACK_SHAPE = "track-shape": Shape(shape::FULL);
        HANDLE_SHAPE = "handle-shape": Shape(shape::FULL);
        UNSELECTED_HANDLE_WIDTH = "unselected-handle-width": Dp(16.0);
        UNSELECTED_HANDLE_HEIGHT = "unselected-handle-height": Dp(16.0);
        SELECTED_HANDLE_WIDTH = "selected-handle-width": Dp(24.0);
        SELECTED_HANDLE_HEIGHT = "selected-handle-height": Dp(24.0);
        WITH_ICON_HANDLE_WIDTH = "with-icon-handle-width": Dp(24.0);
        PRESSED_HANDLE_WIDTH = "pressed-handle-width": Dp(28.0);
        PRESSED_HANDLE_HEIGHT = "pressed-handle-height": Dp(28.0);
        SELECTED_ICON_SIZE = "selected-icon-size": Dp(16.0);
        STATE_LAYER_SIZE = "state-layer-size": Dp(40.0);
        STATE_LAYER_SHAPE = "state-layer-shape": Shape(shape::FULL);
        HANDLE_ELEVATION = "handle-elevation": Elevation(1);
        SELECTED_TRACK_COLOR = "selected-track-color": Role(Role::Primary);
        SELECTED_HANDLE_COLOR = "selected-handle-color": Role(Role::OnPrimary);
        SELECTED_HOVER_HANDLE_COLOR = "selected-hover-handle-color": Role(Role::PrimaryContainer);
        SELECTED_PRESSED_HANDLE_COLOR = "selected-pressed-handle-color": Role(Role::PrimaryContainer);
        SELECTED_ICON_COLOR = "selected-icon-color": Role(Role::Primary);
        SELECTED_HOVER_STATE_LAYER_COLOR = "selected-hover-state-layer-color": Role(Role::Primary);
        UNSELECTED_TRACK_COLOR = "unselected-track-color": Role(Role::SurfaceContainerHighest);
        UNSELECTED_TRACK_OUTLINE_COLOR = "unselected-track-outline-color": Role(Role::Outline);
        UNSELECTED_HANDLE_COLOR = "unselected-handle-color": Role(Role::Outline);
        UNSELECTED_HOVER_HANDLE_COLOR = "unselected-hover-handle-color": Role(Role::OnSurfaceVariant);
        UNSELECTED_ICON_COLOR = "unselected-icon-color": Role(Role::SurfaceContainerHighest);
        UNSELECTED_HOVER_STATE_LAYER_COLOR = "unselected-hover-state-layer-color": Role(Role::OnSurface);
        DISABLED_TRACK_OPACITY = "disabled-track-opacity": Opacity(0.12);
        DISABLED_SELECTED_TRACK_COLOR = "disabled-selected-track-color": Role(Role::OnSurface);
        DISABLED_UNSELECTED_TRACK_COLOR = "disabled-unselected-track-color": Role(Role::SurfaceContainerHighest);
        DISABLED_UNSELECTED_TRACK_OUTLINE_COLOR = "disabled-unselected-track-outline-color": Role(Role::OnSurface);
        DISABLED_SELECTED_HANDLE_COLOR = "disabled-selected-handle-color": Role(Role::Surface);
        DISABLED_SELECTED_HANDLE_OPACITY = "disabled-selected-handle-opacity": Opacity(1.0);
        DISABLED_UNSELECTED_HANDLE_COLOR = "disabled-unselected-handle-color": Role(Role::OnSurface);
        DISABLED_UNSELECTED_HANDLE_OPACITY = "disabled-unselected-handle-opacity": Opacity(0.38);
        FOCUS_INDICATOR_COLOR = "focus-indicator-color": Role(Role::Secondary);
        FOCUS_INDICATOR_THICKNESS = "focus-indicator-thickness": Dp(focus_indicator::THICKNESS);
        FOCUS_INDICATOR_OFFSET = "focus-indicator-offset": Dp(focus_indicator::OUTER_OFFSET);
    }
}

component_tokens! {
    /// Radio button.
    radio_button = "radio-button", expressive: false {
        ICON_SIZE = "icon-size": Dp(20.0);
        STATE_LAYER_SIZE = "state-layer-size": Dp(40.0);
        SELECTED_ICON_COLOR = "selected-icon-color": Role(Role::Primary);
        UNSELECTED_ICON_COLOR = "unselected-icon-color": Role(Role::OnSurfaceVariant);
        UNSELECTED_HOVER_ICON_COLOR = "unselected-hover-icon-color": Role(Role::OnSurface);
        SELECTED_HOVER_STATE_LAYER_COLOR = "selected-hover-state-layer-color": Role(Role::Primary);
        UNSELECTED_HOVER_STATE_LAYER_COLOR = "unselected-hover-state-layer-color": Role(Role::OnSurface);
        SELECTED_PRESSED_STATE_LAYER_COLOR = "selected-pressed-state-layer-color": Role(Role::OnSurface);
        UNSELECTED_PRESSED_STATE_LAYER_COLOR = "unselected-pressed-state-layer-color": Role(Role::Primary);
        DISABLED_SELECTED_ICON_COLOR = "disabled-selected-icon-color": Role(Role::OnSurface);
        DISABLED_SELECTED_ICON_OPACITY = "disabled-selected-icon-opacity": Opacity(0.38);
        DISABLED_UNSELECTED_ICON_COLOR = "disabled-unselected-icon-color": Role(Role::OnSurface);
        DISABLED_UNSELECTED_ICON_OPACITY = "disabled-unselected-icon-opacity": Opacity(0.38);
    }
}

component_tokens! {
    /// Assist chip.
    assist_chip = "assist-chip", expressive: false {
        CONTAINER_HEIGHT = "container-height": Dp(32.0);
        CONTAINER_SHAPE = "container-shape": Shape(shape::SMALL);
        FLAT_OUTLINE_WIDTH = "flat-outline-width": Dp(1.0);
        FLAT_OUTLINE_COLOR = "flat-outline-color": Role(Role::OutlineVariant);
        FLAT_DISABLED_OUTLINE_OPACITY = "flat-disabled-outline-opacity": Opacity(0.12);
        ELEVATED_CONTAINER_COLOR = "elevated-container-color": Role(Role::SurfaceContainerLow);
        ELEVATED_CONTAINER_ELEVATION = "elevated-container-elevation": Elevation(1);
        ELEVATED_HOVER_CONTAINER_ELEVATION = "elevated-hover-container-elevation": Elevation(2);
        LABEL_TEXT_COLOR = "label-text-color": Role(Role::OnSurface);
        LABEL_TEXT_SIZE = "label-text-size": Type("label-large");
        DISABLED_LABEL_TEXT_OPACITY = "disabled-label-text-opacity": Opacity(0.38);
        WITH_ICON_ICON_SIZE = "with-icon-icon-size": Dp(18.0);
        WITH_ICON_ICON_COLOR = "with-icon-icon-color": Role(Role::Primary);
        HOVER_STATE_LAYER_COLOR = "hover-state-layer-color": Role(Role::OnSurface);
        PRESSED_STATE_LAYER_COLOR = "pressed-state-layer-color": Role(Role::OnSurface);
        FOCUS_INDICATOR_COLOR = "focus-indicator-color": Role(Role::Secondary);
        DISABLED_LABEL_TEXT_COLOR = "disabled-label-text-color": Role(Role::OnSurface);
        FLAT_DISABLED_OUTLINE_COLOR = "flat-disabled-outline-color": Role(Role::OnSurface);
        ELEVATED_DISABLED_CONTAINER_COLOR = "elevated-disabled-container-color": Role(Role::OnSurface);
        ELEVATED_DISABLED_CONTAINER_OPACITY = "elevated-disabled-container-opacity": Opacity(0.12);
        WITH_ICON_DISABLED_ICON_COLOR = "with-icon-disabled-icon-color": Role(Role::OnSurface);
        WITH_ICON_DISABLED_ICON_OPACITY = "with-icon-disabled-icon-opacity": Opacity(0.38);
    }
}

component_tokens! {
    /// Filter chip.
    filter_chip = "filter-chip", expressive: false {
        CONTAINER_HEIGHT = "container-height": Dp(32.0);
        CONTAINER_SHAPE = "container-shape": Shape(shape::SMALL);
        FLAT_UNSELECTED_OUTLINE_WIDTH = "flat-unselected-outline-width": Dp(1.0);
        FLAT_SELECTED_OUTLINE_WIDTH = "flat-selected-outline-width": Dp(0.0);
        FLAT_UNSELECTED_OUTLINE_COLOR = "flat-unselected-outline-color": Role(Role::OutlineVariant);
        FLAT_SELECTED_CONTAINER_COLOR = "flat-selected-container-color": Role(Role::SecondaryContainer);
        SELECTED_LABEL_TEXT_COLOR = "selected-label-text-color": Role(Role::OnSecondaryContainer);
        UNSELECTED_LABEL_TEXT_COLOR = "unselected-label-text-color": Role(Role::OnSurfaceVariant);
        LABEL_TEXT_SIZE = "label-text-size": Type("label-large");
        SELECTED_HOVER_STATE_LAYER_COLOR = "selected-hover-state-layer-color": Role(Role::OnSecondaryContainer);
        UNSELECTED_HOVER_STATE_LAYER_COLOR = "unselected-hover-state-layer-color": Role(Role::OnSurfaceVariant);
        WITH_ICON_ICON_SIZE = "with-icon-icon-size": Dp(18.0);
        WITH_ICON_SELECTED_ICON_COLOR = "with-icon-selected-icon-color": Role(Role::OnSecondaryContainer);
        WITH_ICON_UNSELECTED_ICON_COLOR = "with-icon-unselected-icon-color": Role(Role::OnSurfaceVariant);
        FLAT_DISABLED_SELECTED_CONTAINER_OPACITY = "flat-disabled-selected-container-opacity": Opacity(0.12);
        DISABLED_LABEL_TEXT_OPACITY = "disabled-label-text-opacity": Opacity(0.38);
        FOCUS_INDICATOR_COLOR = "focus-indicator-color": Role(Role::Secondary);
        DISABLED_LABEL_TEXT_COLOR = "disabled-label-text-color": Role(Role::OnSurface);
        FLAT_DISABLED_SELECTED_CONTAINER_COLOR = "flat-disabled-selected-container-color": Role(Role::OnSurface);
        FLAT_DISABLED_UNSELECTED_OUTLINE_COLOR = "flat-disabled-unselected-outline-color": Role(Role::OnSurface);
        FLAT_DISABLED_UNSELECTED_OUTLINE_OPACITY = "flat-disabled-unselected-outline-opacity": Opacity(0.12);
    }
}

component_tokens! {
    /// Input chip.
    input_chip = "input-chip", expressive: false {
        CONTAINER_HEIGHT = "container-height": Dp(32.0);
        CONTAINER_SHAPE = "container-shape": Shape(shape::SMALL);
        UNSELECTED_OUTLINE_WIDTH = "unselected-outline-width": Dp(1.0);
        SELECTED_OUTLINE_WIDTH = "selected-outline-width": Dp(0.0);
        OUTLINE_COLOR = "outline-color": Role(Role::Outline);
        LABEL_TEXT_COLOR = "label-text-color": Role(Role::OnSurfaceVariant);
        HOVER_STATE_LAYER_COLOR = "hover-state-layer-color": Role(Role::OnSurfaceVariant);
        UNSELECTED_OUTLINE_COLOR = "unselected-outline-color": Role(Role::OutlineVariant);
        SELECTED_CONTAINER_COLOR = "selected-container-color": Role(Role::SecondaryContainer);
        SELECTED_LABEL_TEXT_COLOR = "selected-label-text-color": Role(Role::OnSecondaryContainer);
        LABEL_TEXT_SIZE = "label-text-size": Type("label-large");
        WITH_TRAILING_ICON_TRAILING_ICON_SIZE = "with-trailing-icon-trailing-icon-size": Dp(18.0);
        DISABLED_LABEL_TEXT_COLOR = "disabled-label-text-color": Role(Role::OnSurface);
        DISABLED_LABEL_TEXT_OPACITY = "disabled-label-text-opacity": Opacity(0.38);
        DISABLED_UNSELECTED_OUTLINE_COLOR = "disabled-unselected-outline-color": Role(Role::OnSurface);
        DISABLED_UNSELECTED_OUTLINE_OPACITY = "disabled-unselected-outline-opacity": Opacity(0.12);
        DISABLED_SELECTED_CONTAINER_COLOR = "disabled-selected-container-color": Role(Role::OnSurface);
        DISABLED_SELECTED_CONTAINER_OPACITY = "disabled-selected-container-opacity": Opacity(0.12);
    }
}

component_tokens! {
    /// Suggestion chip.
    suggestion_chip = "suggestion-chip", expressive: false {
        CONTAINER_HEIGHT = "container-height": Dp(32.0);
        CONTAINER_SHAPE = "container-shape": Shape(shape::SMALL);
        FLAT_OUTLINE_WIDTH = "flat-outline-width": Dp(1.0);
        FLAT_OUTLINE_COLOR = "flat-outline-color": Role(Role::OutlineVariant);
        LABEL_TEXT_COLOR = "label-text-color": Role(Role::OnSurfaceVariant);
        HOVER_STATE_LAYER_COLOR = "hover-state-layer-color": Role(Role::OnSurfaceVariant);
        LABEL_TEXT_SIZE = "label-text-size": Type("label-large");
        DISABLED_LABEL_TEXT_COLOR = "disabled-label-text-color": Role(Role::OnSurface);
        DISABLED_LABEL_TEXT_OPACITY = "disabled-label-text-opacity": Opacity(0.38);
        FLAT_DISABLED_OUTLINE_COLOR = "flat-disabled-outline-color": Role(Role::OnSurface);
        FLAT_DISABLED_OUTLINE_OPACITY = "flat-disabled-outline-opacity": Opacity(0.12);
    }
}

component_tokens! {
    /// Elevated card.
    elevated_card = "elevated-card", expressive: false {
        CONTAINER_COLOR = "container-color": Role(Role::SurfaceContainerLow);
        CONTAINER_ELEVATION = "container-elevation": Elevation(1);
        CONTAINER_SHAPE = "container-shape": Shape(shape::MEDIUM);
        HOVER_CONTAINER_ELEVATION = "hover-container-elevation": Elevation(2);
        HOVER_STATE_LAYER_COLOR = "hover-state-layer-color": Role(Role::OnSurface);
        PRESSED_STATE_LAYER_COLOR = "pressed-state-layer-color": Role(Role::OnSurface);
        DISABLED_CONTAINER_COLOR = "disabled-container-color": Role(Role::Surface);
        DISABLED_CONTAINER_OPACITY = "disabled-container-opacity": Opacity(0.38);
        ICON_SIZE = "icon-size": Dp(24.0);
        ICON_COLOR = "icon-color": Role(Role::Primary);
        FOCUS_INDICATOR_COLOR = "focus-indicator-color": Role(Role::Secondary);
    }
}

component_tokens! {
    /// Filled card.
    filled_card = "filled-card", expressive: false {
        CONTAINER_COLOR = "container-color": Role(Role::SurfaceContainerHighest);
        CONTAINER_ELEVATION = "container-elevation": Elevation(0);
        CONTAINER_SHAPE = "container-shape": Shape(shape::MEDIUM);
        HOVER_CONTAINER_ELEVATION = "hover-container-elevation": Elevation(1);
        HOVER_STATE_LAYER_COLOR = "hover-state-layer-color": Role(Role::OnSurface);
        DISABLED_CONTAINER_COLOR = "disabled-container-color": Role(Role::SurfaceVariant);
        DISABLED_CONTAINER_OPACITY = "disabled-container-opacity": Opacity(0.38);
    }
}

component_tokens! {
    /// Outlined card.
    outlined_card = "outlined-card", expressive: false {
        CONTAINER_COLOR = "container-color": Role(Role::Surface);
        CONTAINER_ELEVATION = "container-elevation": Elevation(0);
        CONTAINER_SHAPE = "container-shape": Shape(shape::MEDIUM);
        OUTLINE_WIDTH = "outline-width": Dp(1.0);
        OUTLINE_COLOR = "outline-color": Role(Role::OutlineVariant);
        FOCUS_OUTLINE_COLOR = "focus-outline-color": Role(Role::OnSurface);
        DISABLED_OUTLINE_COLOR = "disabled-outline-color": Role(Role::Outline);
        DISABLED_OUTLINE_OPACITY = "disabled-outline-opacity": Opacity(0.12);
        HOVER_CONTAINER_ELEVATION = "hover-container-elevation": Elevation(1);
        HOVER_STATE_LAYER_COLOR = "hover-state-layer-color": Role(Role::OnSurface);
    }
}

component_tokens! {
    /// Icon button geometry, small (default) size.
    icon_button_small = "icon-button-small", expressive: true {
        CONTAINER_HEIGHT = "container-height": Dp(40.0);
        ICON_SIZE = "icon-size": Dp(24.0);
        DEFAULT_LEADING_SPACE = "default-leading-space": Dp(8.0);
        DEFAULT_TRAILING_SPACE = "default-trailing-space": Dp(8.0);
        OUTLINED_OUTLINE_WIDTH = "outlined-outline-width": Dp(1.0);
        CONTAINER_SHAPE_ROUND = "container-shape-round": Shape(shape::FULL);
        CONTAINER_SHAPE_SQUARE = "container-shape-square": Shape(shape::MEDIUM);
        PRESSED_CONTAINER_SHAPE = "pressed-container-shape": Shape(shape::SMALL);
        SELECTED_CONTAINER_SHAPE_ROUND = "selected-container-shape-round": Shape(shape::MEDIUM);
        SELECTED_CONTAINER_SHAPE_SQUARE = "selected-container-shape-square": Shape(shape::FULL);
        PRESSED_SHAPE_SPRING_DAMPING = "pressed-container-corner-size-motion-spring-damping": Number(motion::STANDARD_FAST_SPATIAL.damping);
        PRESSED_SHAPE_SPRING_STIFFNESS = "pressed-container-corner-size-motion-spring-stiffness": Number(motion::STANDARD_FAST_SPATIAL.stiffness);
    }
}

component_tokens! {
    /// Standard icon button colours.
    icon_button_standard = "icon-button-standard", expressive: false {
        ICON_COLOR = "icon-color": Role(Role::OnSurfaceVariant);
        SELECTED_ICON_COLOR = "selected-icon-color": Role(Role::Primary);
        HOVERED_STATE_LAYER_COLOR = "hovered-state-layer-color": Role(Role::OnSurfaceVariant);
        SELECTED_HOVERED_STATE_LAYER_COLOR = "selected-hovered-state-layer-color": Role(Role::Primary);
        DISABLED_ICON_COLOR = "disabled-icon-color": Role(Role::OnSurface);
        DISABLED_ICON_OPACITY = "disabled-icon-opacity": Opacity(0.38);
    }
}

component_tokens! {
    /// Filled icon button colours.
    icon_button_filled = "icon-button-filled", expressive: false {
        CONTAINER_COLOR = "container-color": Role(Role::Primary);
        ICON_COLOR = "icon-color": Role(Role::OnPrimary);
        UNSELECTED_CONTAINER_COLOR = "unselected-container-color": Role(Role::SurfaceContainer);
        UNSELECTED_ICON_COLOR = "unselected-icon-color": Role(Role::OnSurfaceVariant);
        HOVERED_STATE_LAYER_COLOR = "hovered-state-layer-color": Role(Role::OnPrimary);
        DISABLED_CONTAINER_COLOR = "disabled-container-color": Role(Role::OnSurface);
        DISABLED_CONTAINER_OPACITY = "disabled-container-opacity": Opacity(0.1);
        DISABLED_ICON_COLOR = "disabled-icon-color": Role(Role::OnSurface);
        DISABLED_ICON_OPACITY = "disabled-icon-opacity": Opacity(0.38);
        SELECTED_CONTAINER_COLOR = "selected-container-color": Role(Role::Primary);
        SELECTED_ICON_COLOR = "selected-icon-color": Role(Role::OnPrimary);
    }
}

component_tokens! {
    /// Tonal icon button colours.
    icon_button_tonal = "icon-button-tonal", expressive: false {
        CONTAINER_COLOR = "container-color": Role(Role::SecondaryContainer);
        ICON_COLOR = "icon-color": Role(Role::OnSecondaryContainer);
        SELECTED_CONTAINER_COLOR = "selected-container-color": Role(Role::Secondary);
        HOVERED_STATE_LAYER_COLOR = "hovered-state-layer-color": Role(Role::OnSecondaryContainer);
        DISABLED_CONTAINER_COLOR = "disabled-container-color": Role(Role::OnSurface);
        DISABLED_CONTAINER_OPACITY = "disabled-container-opacity": Opacity(0.1);
        DISABLED_ICON_COLOR = "disabled-icon-color": Role(Role::OnSurface);
        DISABLED_ICON_OPACITY = "disabled-icon-opacity": Opacity(0.38);
        SELECTED_ICON_COLOR = "selected-icon-color": Role(Role::OnSecondary);
    }
}

component_tokens! {
    /// Outlined icon button colours.
    icon_button_outlined = "icon-button-outlined", expressive: false {
        OUTLINE_COLOR = "outline-color": Role(Role::OutlineVariant);
        ICON_COLOR = "icon-color": Role(Role::OnSurfaceVariant);
        SELECTED_CONTAINER_COLOR = "selected-container-color": Role(Role::InverseSurface);
        HOVERED_STATE_LAYER_COLOR = "hovered-state-layer-color": Role(Role::OnSurfaceVariant);
        DISABLED_ICON_COLOR = "disabled-icon-color": Role(Role::OnSurface);
        DISABLED_ICON_OPACITY = "disabled-icon-opacity": Opacity(0.38);
        SELECTED_ICON_COLOR = "selected-icon-color": Role(Role::InverseOnSurface);
        DISABLED_OUTLINE_COLOR = "disabled-outline-color": Role(Role::OutlineVariant);
    }
}

component_tokens! {
    /// FAB geometry, default size.
    fab = "fab", expressive: false {
        CONTAINER_WIDTH = "container-width": Dp(56.0);
        CONTAINER_HEIGHT = "container-height": Dp(56.0);
        ICON_SIZE = "icon-size": Dp(24.0);
        CONTAINER_SHAPE = "container-shape": Shape(shape::LARGE);
    }
}

component_tokens! {
    /// FAB geometry, small size.
    fab_small = "fab-small", expressive: false {
        CONTAINER_WIDTH = "container-width": Dp(40.0);
        CONTAINER_HEIGHT = "container-height": Dp(40.0);
        ICON_SIZE = "icon-size": Dp(24.0);
        CONTAINER_SHAPE = "container-shape": Shape(shape::MEDIUM);
    }
}

component_tokens! {
    /// FAB geometry, large size.
    fab_large = "fab-large", expressive: false {
        CONTAINER_WIDTH = "container-width": Dp(96.0);
        CONTAINER_HEIGHT = "container-height": Dp(96.0);
        ICON_SIZE = "icon-size": Dp(36.0);
        CONTAINER_SHAPE = "container-shape": Shape(shape::EXTRA_LARGE);
    }
}

component_tokens! {
    /// Primary-container FAB colours and elevation.
    fab_primary_container = "fab-primary-container", expressive: true {
        CONTAINER_COLOR = "container-color": Role(Role::PrimaryContainer);
        ICON_COLOR = "icon-color": Role(Role::OnPrimaryContainer);
        CONTAINER_ELEVATION = "container-elevation": Elevation(3);
        HOVERED_CONTAINER_ELEVATION = "hovered-container-elevation": Elevation(4);
        PRESSED_CONTAINER_ELEVATION = "pressed-container-elevation": Elevation(3);
        HOVERED_STATE_LAYER_COLOR = "hovered-state-layer-color": Role(Role::OnPrimaryContainer);
        PRESSED_STATE_LAYER_COLOR = "pressed-state-layer-color": Role(Role::OnPrimaryContainer);
    }
}

component_tokens! {
    /// Slider (Expressive track and handle).
    slider = "slider", expressive: true {
        ACTIVE_TRACK_HEIGHT = "active-track-height": Dp(16.0);
        INACTIVE_TRACK_HEIGHT = "inactive-track-height": Dp(16.0);
        ACTIVE_TRACK_SHAPE = "active-track-shape": Shape(shape::FULL);
        HANDLE_WIDTH = "handle-width": Dp(4.0);
        HANDLE_HEIGHT = "handle-height": Dp(44.0);
        FOCUS_HANDLE_WIDTH = "focus-handle-width": Dp(2.0);
        PRESSED_HANDLE_WIDTH = "pressed-handle-width": Dp(2.0);
        ACTIVE_HANDLE_PADDING = "active-handle-padding": Dp(6.0);
        STOP_INDICATOR_SIZE = "stop-indicator-size": Dp(4.0);
        STATE_LAYER_SIZE = "state-layer-size": Dp(40.0);
        LABEL_CONTAINER_HEIGHT = "label-container-height": Dp(28.0);
        ACTIVE_TRACK_COLOR = "active-track-color": Role(Role::Primary);
        INACTIVE_TRACK_COLOR = "inactive-track-color": Role(Role::SecondaryContainer);
        HANDLE_COLOR = "handle-color": Role(Role::Primary);
        STOP_INDICATOR_COLOR = "stop-indicator-color": Role(Role::OnSecondaryContainer);
        STOP_INDICATOR_COLOR_SELECTED = "stop-indicator-color-selected": Role(Role::OnPrimary);
        DISABLED_ACTIVE_TRACK_COLOR = "disabled-active-track-color": Role(Role::OnSurface);
        DISABLED_ACTIVE_TRACK_OPACITY = "disabled-active-track-opacity": Opacity(0.38);
        DISABLED_INACTIVE_TRACK_COLOR = "disabled-inactive-track-color": Role(Role::OnSurface);
        DISABLED_INACTIVE_TRACK_OPACITY = "disabled-inactive-track-opacity": Opacity(0.12);
        DISABLED_HANDLE_COLOR = "disabled-handle-color": Role(Role::OnSurface);
        DISABLED_HANDLE_OPACITY = "disabled-handle-opacity": Opacity(0.38);
        HANDLE_SHAPE = "handle-shape": Shape(shape::FULL);
        INACTIVE_TRACK_SHAPE = "inactive-track-shape": Shape(shape::FULL);
        STOP_INDICATOR_TRAILING_SPACE = "stop-indicator-trailing-space": Dp(4.0);
        DISABLED_STOP_INDICATOR_COLOR = "disabled-stop-indicator-color": Role(Role::OnSurface);
        DISABLED_STOP_INDICATOR_COLOR_SELECTED = "disabled-stop-indicator-color-selected": Role(Role::InverseOnSurface);
    }
}

component_tokens! {
    /// Primary navigation tab.
    primary_navigation_tab = "primary-navigation-tab", expressive: false {
        CONTAINER_HEIGHT = "container-height": Dp(48.0);
        WITH_ICON_AND_LABEL_TEXT_CONTAINER_HEIGHT = "with-icon-and-label-text-container-height": Dp(64.0);
        CONTAINER_COLOR = "container-color": Role(Role::Surface);
        CONTAINER_SHAPE = "container-shape": Shape(shape::NONE);
        ACTIVE_INDICATOR_HEIGHT = "active-indicator-height": Dp(3.0);
        ACTIVE_INDICATOR_COLOR = "active-indicator-color": Role(Role::Primary);
        DIVIDER_HEIGHT = "divider-height": Dp(1.0);
        DIVIDER_COLOR = "divider-color": Role(Role::SurfaceVariant);
        WITH_ICON_ICON_SIZE = "with-icon-icon-size": Dp(24.0);
        WITH_ICON_ACTIVE_ICON_COLOR = "with-icon-active-icon-color": Role(Role::Primary);
        WITH_ICON_INACTIVE_ICON_COLOR = "with-icon-inactive-icon-color": Role(Role::OnSurfaceVariant);
        ACTIVE_LABEL_TEXT_COLOR = "with-label-text-active-label-text-color": Role(Role::Primary);
        INACTIVE_LABEL_TEXT_COLOR = "with-label-text-inactive-label-text-color": Role(Role::OnSurfaceVariant);
        LABEL_TEXT_SIZE = "with-label-text-label-text-size": Type("title-small");
        ACTIVE_HOVER_STATE_LAYER_COLOR = "active-hover-state-layer-color": Role(Role::Primary);
        INACTIVE_HOVER_STATE_LAYER_COLOR = "inactive-hover-state-layer-color": Role(Role::OnSurface);
        INACTIVE_PRESSED_STATE_LAYER_COLOR = "inactive-pressed-state-layer-color": Role(Role::Primary);
        FOCUS_INDICATOR_COLOR = "focus-indicator-color": Role(Role::Secondary);
        FOCUS_INDICATOR_OUTLINE_OFFSET = "focus-indicator-outline-offset": Dp(focus_indicator::INNER_OFFSET);
    }
}

component_tokens! {
    /// Navigation bar (Expressive, 64 dp).
    nav_bar = "nav-bar", expressive: true {
        CONTAINER_HEIGHT = "container-height": Dp(64.0);
        CONTAINER_COLOR = "container-color": Role(Role::SurfaceContainer);
        CONTAINER_ELEVATION = "container-elevation": Elevation(2);
        CONTAINER_SHAPE = "container-shape": Shape(shape::NONE);
        ITEM_ICON_SIZE = "item-icon-size": Dp(24.0);
        ITEM_BETWEEN_SPACE = "item-between-space": Dp(0.0);
        ITEM_ACTIVE_INDICATOR_SHAPE = "item-active-indicator-shape": Shape(shape::FULL);
        ITEM_ACTIVE_INDICATOR_COLOR = "item-active-indicator-color": Role(Role::SecondaryContainer);
        ITEM_ACTIVE_ICON_COLOR = "item-active-icon-color": Role(Role::OnSecondaryContainer);
        ITEM_ACTIVE_LABEL_TEXT_COLOR = "item-active-label-text-color": Role(Role::Secondary);
        ITEM_INACTIVE_ICON_COLOR = "item-inactive-icon-color": Role(Role::OnSurfaceVariant);
        ITEM_INACTIVE_LABEL_TEXT_COLOR = "item-inactive-label-text-color": Role(Role::OnSurfaceVariant);
        ITEM_ACTIVE_HOVERED_STATE_LAYER_COLOR = "item-active-hovered-state-layer-color": Role(Role::OnSecondaryContainer);
        ITEM_INACTIVE_HOVERED_STATE_LAYER_COLOR = "item-inactive-hovered-state-layer-color": Role(Role::OnSecondaryContainer);
    }
}

component_tokens! {
    /// Navigation bar item, vertical (icon over label) layout.
    nav_bar_item_vertical = "nav-bar-item-vertical", expressive: true {
        ACTIVE_INDICATOR_WIDTH = "active-indicator-width": Dp(56.0);
        ACTIVE_INDICATOR_HEIGHT = "active-indicator-height": Dp(32.0);
        ACTIVE_INDICATOR_ICON_LABEL_SPACE = "active-indicator-icon-label-space": Dp(4.0);
        CONTAINER_BETWEEN_SPACE = "container-between-space": Dp(6.0);
    }
}

component_tokens! {
    /// Basic dialog.
    dialog = "dialog", expressive: false {
        CONTAINER_COLOR = "container-color": Role(Role::SurfaceContainerHigh);
        CONTAINER_ELEVATION = "container-elevation": Elevation(3);
        CONTAINER_SHAPE = "container-shape": Shape(shape::EXTRA_LARGE);
        HEADLINE_COLOR = "headline-color": Role(Role::OnSurface);
        HEADLINE_SIZE = "headline-size": Type("headline-small");
        SUPPORTING_TEXT_COLOR = "supporting-text-color": Role(Role::OnSurfaceVariant);
        SUPPORTING_TEXT_SIZE = "supporting-text-size": Type("body-medium");
        ACTION_LABEL_TEXT_COLOR = "action-label-text-color": Role(Role::Primary);
        ACTION_LABEL_TEXT_SIZE = "action-label-text-size": Type("label-large");
        WITH_ICON_ICON_SIZE = "with-icon-icon-size": Dp(24.0);
        WITH_ICON_ICON_COLOR = "with-icon-icon-color": Role(Role::Secondary);
    }
}

component_tokens! {
    /// Menu (baseline list menu).
    menu = "menu", expressive: false {
        CONTAINER_COLOR = "container-color": Role(Role::SurfaceContainer);
        CONTAINER_ELEVATION = "container-elevation": Elevation(2);
        CONTAINER_SHAPE = "container-shape": Shape(shape::EXTRA_SMALL);
        LIST_ITEM_CONTAINER_HEIGHT = "list-item-container-height": Dp(48.0);
        LIST_ITEM_LABEL_TEXT_COLOR = "list-item-label-text-color": Role(Role::OnSurface);
        LIST_ITEM_LABEL_TEXT_SIZE = "list-item-label-text-size": Type("label-large");
        LIST_ITEM_HOVER_STATE_LAYER_COLOR = "list-item-hover-state-layer-color": Role(Role::OnSurface);
        LIST_ITEM_SELECTED_CONTAINER_COLOR = "list-item-selected-container-color": Role(Role::SecondaryContainer);
        LIST_ITEM_SELECTED_LABEL_TEXT_COLOR = "list-item-selected-label-text-color": Role(Role::OnSecondaryContainer);
        LIST_ITEM_DISABLED_LABEL_TEXT_COLOR = "list-item-disabled-label-text-color": Role(Role::OnSurface);
        LIST_ITEM_DISABLED_LABEL_TEXT_OPACITY = "list-item-disabled-label-text-opacity": Opacity(0.38);
        LIST_ITEM_LEADING_ICON_SIZE = "list-item-with-leading-icon-leading-icon-size": Dp(24.0);
        LIST_ITEM_LEADING_ICON_COLOR = "list-item-with-leading-icon-leading-icon-color": Role(Role::OnSurfaceVariant);
        DIVIDER_HEIGHT = "divider-height": Dp(1.0);
        FOCUS_INDICATOR_OUTLINE_OFFSET = "focus-indicator-outline-offset": Dp(focus_indicator::INNER_OFFSET);
        LIST_ITEM_WITH_LEADING_ICON_DISABLED_LEADING_ICON_COLOR = "list-item-with-leading-icon-disabled-leading-icon-color": Role(Role::OnSurface);
    }
}

component_tokens! {
    /// Common button geometry, small (default) size, with the Expressive shape morph.
    button_small = "button-small", expressive: true {
        CONTAINER_HEIGHT = "container-height": Dp(40.0);
        ICON_SIZE = "icon-size": Dp(20.0);
        ICON_LABEL_SPACE = "icon-label-space": Dp(8.0);
        LEADING_SPACE = "leading-space": Dp(16.0);
        TRAILING_SPACE = "trailing-space": Dp(16.0);
        OUTLINED_OUTLINE_WIDTH = "outlined-outline-width": Dp(1.0);
        CONTAINER_SHAPE_ROUND = "container-shape-round": Shape(shape::FULL);
        CONTAINER_SHAPE_SQUARE = "container-shape-square": Shape(shape::MEDIUM);
        PRESSED_CONTAINER_SHAPE = "pressed-container-shape": Shape(shape::SMALL);
        SELECTED_CONTAINER_SHAPE_ROUND = "selected-container-shape-round": Shape(shape::MEDIUM);
        SELECTED_CONTAINER_SHAPE_SQUARE = "selected-container-shape-square": Shape(shape::FULL);
        PRESSED_SHAPE_SPRING_DAMPING = "pressed-container-corner-size-motion-spring-damping": Number(motion::STANDARD_FAST_SPATIAL.damping);
        PRESSED_SHAPE_SPRING_STIFFNESS = "pressed-container-corner-size-motion-spring-stiffness": Number(motion::STANDARD_FAST_SPATIAL.stiffness);
    }
}

component_tokens! {
    /// Filled button colours.
    button_filled = "button-filled", expressive: true {
        CONTAINER_COLOR = "container-color": Role(Role::Primary);
        CONTAINER_ELEVATION = "container-elevation": Elevation(0);
        LABEL_TEXT_COLOR = "label-text-color": Role(Role::OnPrimary);
        ICON_COLOR = "icon-color": Role(Role::OnPrimary);
        DISABLED_CONTAINER_COLOR = "disabled-container-color": Role(Role::OnSurface);
        DISABLED_CONTAINER_OPACITY = "disabled-container-opacity": Opacity(0.1);
        DISABLED_LABEL_TEXT_COLOR = "disabled-label-text-color": Role(Role::OnSurface);
        DISABLED_LABEL_TEXT_OPACITY = "disabled-label-text-opacity": Opacity(0.38);
        SELECTED_CONTAINER_COLOR = "selected-container-color": Role(Role::Primary);
        SELECTED_LABEL_TEXT_COLOR = "selected-label-text-color": Role(Role::OnPrimary);
        UNSELECTED_CONTAINER_COLOR = "unselected-container-color": Role(Role::SurfaceContainer);
        UNSELECTED_LABEL_TEXT_COLOR = "unselected-label-text-color": Role(Role::OnSurfaceVariant);
        UNSELECTED_ICON_COLOR = "unselected-icon-color": Role(Role::OnSurfaceVariant);
    }
}

component_tokens! {
    /// Standard button group, small size.
    button_group_standard_small = "button-group-standard-small", expressive: true {
        BETWEEN_SPACE = "between-space": Dp(12.0);
        CONTAINER_HEIGHT = "container-height": Dp(40.0);
        PRESSED_ITEM_WIDTH_MULTIPLIER = "pressed-item-width-multiplier": Percent(15.0);
        PRESSED_ITEM_WIDTH_SPRING_DAMPING = "pressed-item-width-motion-spring-dampening": Number(motion::STANDARD_FAST_SPATIAL.damping);
        PRESSED_ITEM_WIDTH_SPRING_STIFFNESS = "pressed-item-width-motion-spring-stiffness": Number(motion::STANDARD_FAST_SPATIAL.stiffness);
    }
}

component_tokens! {
    /// Connected button group, small size.
    button_group_connected_small = "button-group-connected-small", expressive: true {
        BETWEEN_SPACE = "between-space": Dp(2.0);
        CONTAINER_HEIGHT = "container-height": Dp(40.0);
        CONTAINER_SHAPE = "container-shape": Shape(shape::FULL);
        INNER_CORNER_SIZE = "inner-corner-corner-size": Shape(shape::SMALL);
        PRESSED_INNER_CORNER_SIZE = "pressed-inner-corner-corner-size": Shape(shape::EXTRA_SMALL);
        SELECTED_INNER_CORNER_SIZE = "selected-inner-corner-corner-size": Percent(50.0);
    }
}

component_tokens! {
    /// Split button, small size.
    split_button_small = "split-button-small", expressive: true {
        BETWEEN_SPACE = "between-space": Dp(2.0);
        CONTAINER_HEIGHT = "container-height": Dp(40.0);
        CONTAINER_SHAPE = "container-shape": Shape(shape::FULL);
        LEADING_BUTTON_LEADING_SPACE = "leading-button-leading-space": Dp(16.0);
        LEADING_BUTTON_TRAILING_SPACE = "leading-button-trailing-space": Dp(12.0);
        TRAILING_BUTTON_ICON_SIZE = "trailing-button-icon-size": Dp(22.0);
        TRAILING_BUTTON_LEADING_SPACE = "trailing-button-leading-space": Dp(13.0);
        TRAILING_BUTTON_TRAILING_SPACE = "trailing-button-trailing-space": Dp(13.0);
        INNER_CORNER_SIZE = "inner-corner-corner-size": Shape(shape::EXTRA_SMALL);
        INNER_CORNER_HOVERED_SIZE = "inner-corner-hovered-corner-size": Shape(shape::MEDIUM);
        INNER_CORNER_PRESSED_SIZE = "inner-corner-pressed-corner-size": Shape(shape::MEDIUM);
        TRAILING_BUTTON_INNER_CORNER_SELECTED_SIZE = "trailing-button-inner-corner-selected-corner-size": Percent(50.0);
    }
}

component_tokens! {
    /// Loading indicator.
    loading_indicator = "loading-indicator", expressive: true {
        ACTIVE_INDICATOR_SIZE = "active-indicator-size": Dp(38.0);
        CONTAINER_WIDTH = "container-width": Dp(48.0);
        CONTAINER_HEIGHT = "container-height": Dp(48.0);
        CONTAINER_SHAPE = "container-shape": Shape(shape::FULL);
        CONTAINER_COLOR = "container-color": Role(Role::SecondaryContainer);
        ACTIVE_INDICATOR_COLOR = "active-indicator-color": Role(Role::Primary);
        CONTAINED_CONTAINER_COLOR = "contained-container-color": Role(Role::PrimaryContainer);
        CONTAINED_ACTIVE_INDICATOR_COLOR = "contained-active-indicator-color": Role(Role::OnPrimaryContainer);
    }
}

/// Every mirrored component token set, in declaration order.
pub const ALL: [ComponentTokens; 31] = [
    checkbox::TABLE,
    switch::TABLE,
    radio_button::TABLE,
    assist_chip::TABLE,
    filter_chip::TABLE,
    input_chip::TABLE,
    suggestion_chip::TABLE,
    elevated_card::TABLE,
    filled_card::TABLE,
    outlined_card::TABLE,
    icon_button_small::TABLE,
    icon_button_standard::TABLE,
    icon_button_filled::TABLE,
    icon_button_tonal::TABLE,
    icon_button_outlined::TABLE,
    fab::TABLE,
    fab_small::TABLE,
    fab_large::TABLE,
    fab_primary_container::TABLE,
    slider::TABLE,
    primary_navigation_tab::TABLE,
    nav_bar::TABLE,
    nav_bar_item_vertical::TABLE,
    dialog::TABLE,
    menu::TABLE,
    button_small::TABLE,
    button_filled::TABLE,
    button_group_standard_small::TABLE,
    button_group_connected_small::TABLE,
    split_button_small::TABLE,
    loading_indicator::TABLE,
];

/// Format a dp value for CSS (`px`, at most three decimals, no trailing zeros).
fn px(value: f32) -> std::string::String {
    let rounded = (value * 1000.0).round() / 1000.0;
    std::format!("{rounded}px")
}

/// CSS value of one token, referencing the system custom properties where Google does.
#[must_use]
pub fn css_value(value: TokenValue) -> std::string::String {
    match value {
        TokenValue::Dp(dp) => px(dp),
        TokenValue::Role(role) => std::format!("var(--md-sys-color-{})", role.name()),
        TokenValue::Opacity(n) | TokenValue::Number(n) => std::format!("{n}"),
        TokenValue::Shape(corner) => {
            let name = shape::ALL
                .iter()
                .zip(shape::NAMES)
                .find(|(token, _)| **token == corner)
                .map_or("none", |(_, name)| name);
            std::format!("var(--md-sys-shape-corner-{name})")
        }
        TokenValue::Elevation(level) => {
            std::format!("var(--md-sys-elevation-level{level})")
        }
        TokenValue::Percent(p) => std::format!("{p}%"),
        TokenValue::Type(name) => std::format!("var(--md-sys-typescale-{name}-size)"),
    }
}

/// `:root` block declaring every mirrored token as `--md-comp-<component>-<token>`.
#[must_use]
pub fn export_css() -> std::string::String {
    let mut out = std::string::String::from(":root {\n");
    for (name, value) in [
        ("thickness", focus_indicator::THICKNESS),
        ("outer-offset", focus_indicator::OUTER_OFFSET),
        ("inner-offset", focus_indicator::INNER_OFFSET),
    ] {
        out.push_str(&std::format!(
            "  --md-sys-state-focus-indicator-{name}: {};\n",
            px(value)
        ));
    }
    for table in ALL {
        for token in table.tokens {
            out.push_str(&std::format!(
                "  --md-comp-{}-{}: {};\n",
                table.component,
                token.name,
                css_value(token.value)
            ));
        }
    }
    out.push('}');
    out
}

#[cfg(test)]
mod tests {
    use super::{ALL, TokenValue, export_css};

    #[test]
    fn tables_have_unique_components_and_tokens() {
        for (index, table) in ALL.iter().enumerate() {
            assert!(ALL[..index].iter().all(|t| t.component != table.component));
            for (i, token) in table.tokens.iter().enumerate() {
                assert!(
                    table.tokens[..i].iter().all(|t| t.name != token.name),
                    "{} declares {} twice",
                    table.component,
                    token.name
                );
            }
        }
    }

    #[test]
    fn type_tokens_name_system_styles() {
        for table in ALL {
            for token in table.tokens {
                if let TokenValue::Type(name) = token.value {
                    assert!(crate::typography::NAMES.contains(&name), "{name}");
                }
            }
        }
    }

    #[test]
    fn css_references_system_properties() {
        let css = export_css();
        assert!(
            css.contains(
                "--md-comp-checkbox-selected-container-color: var(--md-sys-color-primary);"
            )
        );
        assert!(
            css.contains(
                "--md-comp-dialog-container-shape: var(--md-sys-shape-corner-extra-large);"
            )
        );
        assert!(css.contains("--md-comp-switch-track-width: 52px;"));
        assert!(css.contains("--md-sys-state-focus-indicator-inner-offset: -3px;"));
    }
}
