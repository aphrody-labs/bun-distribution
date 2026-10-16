// SPDX-License-Identifier: Apache-2.0
//! Checkbox, switch and radio group.

use aphrody_m3_tokens::component::{checkbox as cb, radio_button as rb, switch as sw};
use aphrody_m3_tokens::scheme::Role;
use serde::{Deserialize, Serialize};

use super::{Control, Event};
use crate::a11y::{AccessRole, Accessible, Checked};
use crate::interaction::{Interaction, StateLayer};
use crate::keyboard::{Key, Orientation, roving};
use crate::layout::{Flex, LayoutTree};
use crate::visual::{Glyph, Part, Radii, Rect, Tint, focus_ring, pick, state_layer};

/// Checkbox state.
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CheckState {
    /// Not checked.
    #[default]
    Unchecked,
    /// Checked.
    Checked,
    /// Indeterminate (`aria-checked="mixed"`).
    Indeterminate,
}

/// Checkbox.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Checkbox {
    /// Accessible name.
    pub label: String,
    /// State.
    pub state: CheckState,
    /// Whether the checkbox accepts input.
    pub enabled: bool,
}

impl Checkbox {
    /// An enabled, unchecked checkbox.
    #[must_use]
    pub fn new(label: impl Into<String>) -> Self {
        Self {
            label: label.into(),
            state: CheckState::Unchecked,
            enabled: true,
        }
    }

    /// Toggle; indeterminate becomes checked.
    pub fn toggle(&mut self) -> CheckState {
        self.state = match self.state {
            CheckState::Checked => CheckState::Unchecked,
            CheckState::Unchecked | CheckState::Indeterminate => CheckState::Checked,
        };
        self.state
    }
}

impl Control for Checkbox {
    fn accessible(&self) -> Accessible {
        let mut node = Accessible::new(AccessRole::Checkbox, &self.label);
        node.checked = Some(match self.state {
            CheckState::Unchecked => Checked::False,
            CheckState::Checked => Checked::True,
            CheckState::Indeterminate => Checked::Mixed,
        });
        node.disabled = !self.enabled;
        node
    }

    fn handle_key(&mut self, key: Key) -> Option<Event> {
        (self.enabled && key == Key::Space).then(|| Event::Checked(self.toggle()))
    }

    fn size(&self) -> (f32, f32) {
        (cb::CONTAINER_SIZE, cb::CONTAINER_SIZE)
    }

    fn parts(&self, rect: Rect, interaction: Interaction) -> Vec<Part> {
        let interaction = interaction.with_disabled(interaction.disabled || !self.enabled);
        let disabled = interaction.disabled;
        let (cx, cy) = rect.center();
        let container = Rect::centered(cx, cy, cb::CONTAINER_SIZE, cb::CONTAINER_SIZE);
        let radii = Radii::all(cb::CONTAINER_SHAPE);
        let selected = self.state != CheckState::Unchecked;
        let layer = Rect::centered(cx, cy, cb::STATE_LAYER_SIZE, cb::STATE_LAYER_SIZE);
        let layer_role = match (selected, interaction.state_layer()) {
            (true, Some(StateLayer::Pressed)) => cb::SELECTED_PRESSED_STATE_LAYER_COLOR,
            (true, Some(StateLayer::Focus)) => cb::SELECTED_FOCUS_STATE_LAYER_COLOR,
            (true, _) => cb::SELECTED_HOVER_STATE_LAYER_COLOR,
            (false, Some(StateLayer::Pressed)) => cb::UNSELECTED_PRESSED_STATE_LAYER_COLOR,
            (false, Some(StateLayer::Focus)) => cb::UNSELECTED_FOCUS_STATE_LAYER_COLOR,
            (false, _) => cb::UNSELECTED_HOVER_STATE_LAYER_COLOR,
        };
        let mut parts: Vec<Part> = state_layer(
            layer,
            Radii::shape(cb::STATE_LAYER_SHAPE, layer.w, layer.h),
            layer_role,
            interaction,
        )
        .into_iter()
        .collect();
        if selected {
            parts.push(Part::Surface {
                rect: container,
                radii,
                fill: Some(pick(
                    disabled,
                    Tint::solid(cb::SELECTED_CONTAINER_COLOR),
                    Tint::with(
                        cb::SELECTED_DISABLED_CONTAINER_COLOR,
                        cb::SELECTED_DISABLED_CONTAINER_OPACITY,
                    ),
                )),
                outline: None,
                elevation: 0,
            });
            parts.push(Part::Glyph {
                rect: Rect::centered(cx, cy, cb::ICON_SIZE, cb::ICON_SIZE),
                glyph: if self.state == CheckState::Checked {
                    Glyph::Check
                } else {
                    Glyph::Indeterminate
                },
                tint: pick(
                    disabled,
                    Tint::solid(cb::SELECTED_ICON_COLOR),
                    Tint::solid(cb::SELECTED_DISABLED_ICON_COLOR),
                ),
            });
        } else {
            let outline = if disabled {
                Tint::with(
                    cb::UNSELECTED_DISABLED_OUTLINE_COLOR,
                    cb::UNSELECTED_DISABLED_CONTAINER_OPACITY,
                )
            } else if interaction.hovered {
                Tint::solid(cb::UNSELECTED_HOVER_OUTLINE_COLOR)
            } else {
                Tint::solid(cb::UNSELECTED_OUTLINE_COLOR)
            };
            parts.push(Part::Surface {
                rect: container,
                radii,
                fill: None,
                outline: Some((outline, cb::UNSELECTED_OUTLINE_WIDTH)),
                elevation: 0,
            });
        }
        parts.extend(focus_ring(
            container,
            radii,
            cb::FOCUS_INDICATOR_COLOR,
            cb::FOCUS_INDICATOR_OUTLINE_OFFSET,
            interaction,
        ));
        parts
    }
}

/// Switch.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Switch {
    /// Accessible name.
    pub label: String,
    /// On / off.
    pub selected: bool,
    /// Whether the switch accepts input.
    pub enabled: bool,
    /// Show the check / close icons in the handle.
    pub icons: bool,
}

impl Switch {
    /// An enabled switch, off, without icons.
    #[must_use]
    pub fn new(label: impl Into<String>) -> Self {
        Self {
            label: label.into(),
            selected: false,
            enabled: true,
            icons: false,
        }
    }
}

impl Control for Switch {
    fn accessible(&self) -> Accessible {
        let mut node = Accessible::new(AccessRole::Switch, &self.label);
        node.checked = Some(if self.selected {
            Checked::True
        } else {
            Checked::False
        });
        node.disabled = !self.enabled;
        node
    }

    fn handle_key(&mut self, key: Key) -> Option<Event> {
        (self.enabled && key.activates()).then(|| {
            self.selected = !self.selected;
            Event::Toggled(self.selected)
        })
    }

    fn size(&self) -> (f32, f32) {
        (sw::TRACK_WIDTH, sw::TRACK_HEIGHT)
    }

    fn parts(&self, rect: Rect, interaction: Interaction) -> Vec<Part> {
        let interaction = interaction.with_disabled(interaction.disabled || !self.enabled);
        let disabled = interaction.disabled;
        let (cx, cy) = rect.center();
        let track = Rect::centered(cx, cy, sw::TRACK_WIDTH, sw::TRACK_HEIGHT);
        let track_radii = Radii::shape(sw::TRACK_SHAPE, track.w, track.h);
        let active = interaction.hovered || interaction.focused || interaction.pressed;
        let (fill, outline, handle_tint, layer_role) = if self.selected {
            (
                pick(
                    disabled,
                    Tint::solid(sw::SELECTED_TRACK_COLOR),
                    Tint::with(
                        sw::DISABLED_SELECTED_TRACK_COLOR,
                        sw::DISABLED_TRACK_OPACITY,
                    ),
                ),
                None,
                if disabled {
                    Tint::with(
                        sw::DISABLED_SELECTED_HANDLE_COLOR,
                        sw::DISABLED_SELECTED_HANDLE_OPACITY,
                    )
                } else if interaction.pressed {
                    Tint::solid(sw::SELECTED_PRESSED_HANDLE_COLOR)
                } else if active {
                    Tint::solid(sw::SELECTED_HOVER_HANDLE_COLOR)
                } else {
                    Tint::solid(sw::SELECTED_HANDLE_COLOR)
                },
                sw::SELECTED_HOVER_STATE_LAYER_COLOR,
            )
        } else {
            (
                pick(
                    disabled,
                    Tint::solid(sw::UNSELECTED_TRACK_COLOR),
                    Tint::with(
                        sw::DISABLED_UNSELECTED_TRACK_COLOR,
                        sw::DISABLED_TRACK_OPACITY,
                    ),
                ),
                Some((
                    pick(
                        disabled,
                        Tint::solid(sw::UNSELECTED_TRACK_OUTLINE_COLOR),
                        Tint::with(
                            sw::DISABLED_UNSELECTED_TRACK_OUTLINE_COLOR,
                            sw::DISABLED_TRACK_OPACITY,
                        ),
                    ),
                    sw::TRACK_OUTLINE_WIDTH,
                )),
                if disabled {
                    Tint::with(
                        sw::DISABLED_UNSELECTED_HANDLE_COLOR,
                        sw::DISABLED_UNSELECTED_HANDLE_OPACITY,
                    )
                } else if active {
                    Tint::solid(sw::UNSELECTED_HOVER_HANDLE_COLOR)
                } else {
                    Tint::solid(sw::UNSELECTED_HANDLE_COLOR)
                },
                sw::UNSELECTED_HOVER_STATE_LAYER_COLOR,
            )
        };
        let handle_size = if interaction.pressed && !disabled {
            sw::PRESSED_HANDLE_WIDTH
        } else if self.selected {
            sw::SELECTED_HANDLE_WIDTH
        } else if self.icons {
            sw::WITH_ICON_HANDLE_WIDTH
        } else {
            sw::UNSELECTED_HANDLE_WIDTH
        };
        let handle_cx = if self.selected {
            track.x + track.w - track.h / 2.0
        } else {
            track.x + track.h / 2.0
        };
        let mut parts = vec![Part::Surface {
            rect: track,
            radii: track_radii,
            fill: Some(fill),
            outline,
            elevation: 0,
        }];
        let layer = Rect::centered(handle_cx, cy, sw::STATE_LAYER_SIZE, sw::STATE_LAYER_SIZE);
        parts.extend(state_layer(
            layer,
            Radii::shape(sw::STATE_LAYER_SHAPE, layer.w, layer.h),
            layer_role,
            interaction,
        ));
        let handle = Rect::centered(handle_cx, cy, handle_size, handle_size);
        parts.push(Part::Surface {
            rect: handle,
            radii: Radii::shape(sw::HANDLE_SHAPE, handle_size, handle_size),
            fill: Some(handle_tint),
            outline: None,
            elevation: if disabled { 0 } else { sw::HANDLE_ELEVATION },
        });
        if self.icons {
            let (name, role) = if self.selected {
                ("check", sw::SELECTED_ICON_COLOR)
            } else {
                ("close", sw::UNSELECTED_ICON_COLOR)
            };
            parts.push(Part::Glyph {
                rect: Rect::centered(
                    handle_cx,
                    cy,
                    sw::SELECTED_ICON_SIZE,
                    sw::SELECTED_ICON_SIZE,
                ),
                glyph: Glyph::Symbol(name.into()),
                tint: pick(
                    disabled,
                    Tint::solid(role),
                    Tint::with(Role::OnSurface, sw::DISABLED_UNSELECTED_HANDLE_OPACITY),
                ),
            });
        }
        parts.extend(focus_ring(
            track,
            track_radii,
            sw::FOCUS_INDICATOR_COLOR,
            sw::FOCUS_INDICATOR_OFFSET,
            interaction,
        ));
        parts
    }
}

/// One radio option.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct RadioOption {
    /// Accessible name.
    pub label: String,
    /// Whether the option can be chosen.
    pub enabled: bool,
}

/// Radio group (single selection, roving focus).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct RadioGroup {
    /// Group name.
    pub label: String,
    /// Options.
    pub options: Vec<RadioOption>,
    /// Selected option.
    pub selected: Option<usize>,
    /// Option holding the roving focus.
    pub focused: usize,
    /// Right-to-left layout (mirrors Left/Right).
    pub rtl: bool,
}

/// Material-web radio geometry (`md-radio` SVG, 20x20 view box): the ring is the annulus between
/// r=8 and r=10, the selected dot has r=5. Geometry, not tokens.
const RADIO_RING_WIDTH: f32 = 2.0;
const RADIO_DOT_DIAMETER: f32 = 10.0;

impl RadioGroup {
    /// A group over enabled options, nothing selected.
    #[must_use]
    pub fn new(label: impl Into<String>, options: &[&str]) -> Self {
        Self {
            label: label.into(),
            options: options
                .iter()
                .map(|label| RadioOption {
                    label: (*label).into(),
                    enabled: true,
                })
                .collect(),
            selected: None,
            focused: 0,
            rtl: false,
        }
    }

    fn enabled(&self) -> Vec<bool> {
        self.options.iter().map(|option| option.enabled).collect()
    }

    /// Paint one option in `rect` (its touch target).
    #[must_use]
    pub fn item_parts(&self, index: usize, rect: Rect, interaction: Interaction) -> Vec<Part> {
        let enabled = self.options.get(index).is_some_and(|option| option.enabled);
        let interaction = interaction.with_disabled(interaction.disabled || !enabled);
        let disabled = interaction.disabled;
        let selected = self.selected == Some(index);
        let (cx, cy) = rect.center();
        let tint = match (selected, disabled) {
            (true, false) => Tint::solid(rb::SELECTED_ICON_COLOR),
            (true, true) => Tint::with(
                rb::DISABLED_SELECTED_ICON_COLOR,
                rb::DISABLED_SELECTED_ICON_OPACITY,
            ),
            (false, true) => Tint::with(
                rb::DISABLED_UNSELECTED_ICON_COLOR,
                rb::DISABLED_UNSELECTED_ICON_OPACITY,
            ),
            (false, false) if interaction.hovered || interaction.pressed || interaction.focused => {
                Tint::solid(rb::UNSELECTED_HOVER_ICON_COLOR)
            }
            (false, false) => Tint::solid(rb::UNSELECTED_ICON_COLOR),
        };
        let layer_role = match (selected, interaction.state_layer()) {
            (true, Some(StateLayer::Pressed)) => rb::SELECTED_PRESSED_STATE_LAYER_COLOR,
            (true, _) => rb::SELECTED_HOVER_STATE_LAYER_COLOR,
            (false, Some(StateLayer::Pressed)) => rb::UNSELECTED_PRESSED_STATE_LAYER_COLOR,
            (false, _) => rb::UNSELECTED_HOVER_STATE_LAYER_COLOR,
        };
        let layer = Rect::centered(cx, cy, rb::STATE_LAYER_SIZE, rb::STATE_LAYER_SIZE);
        let mut parts: Vec<Part> = state_layer(
            layer,
            Radii::all(rb::STATE_LAYER_SIZE / 2.0),
            layer_role,
            interaction,
        )
        .into_iter()
        .collect();
        let icon = Rect::centered(cx, cy, rb::ICON_SIZE, rb::ICON_SIZE);
        let icon_radii = Radii::all(rb::ICON_SIZE / 2.0);
        parts.push(Part::Surface {
            rect: icon,
            radii: icon_radii,
            fill: None,
            outline: Some((tint, RADIO_RING_WIDTH)),
            elevation: 0,
        });
        if selected {
            parts.push(Part::Surface {
                rect: Rect::centered(cx, cy, RADIO_DOT_DIAMETER, RADIO_DOT_DIAMETER),
                radii: Radii::all(RADIO_DOT_DIAMETER / 2.0),
                fill: Some(tint),
                outline: None,
                elevation: 0,
            });
        }
        parts.extend(focus_ring(
            icon,
            icon_radii,
            aphrody_m3_tokens::component::checkbox::FOCUS_INDICATOR_COLOR,
            aphrody_m3_tokens::component::focus_indicator::OUTER_OFFSET,
            interaction,
        ));
        parts
    }
}

impl Control for RadioGroup {
    fn accessible(&self) -> Accessible {
        let tab_stop = self.selected.unwrap_or(self.focused);
        let mut group = Accessible::new(AccessRole::RadioGroup, &self.label);
        group.focusable = false;
        group.children = self
            .options
            .iter()
            .enumerate()
            .map(|(index, option)| {
                let mut radio = Accessible::new(AccessRole::Radio, &option.label);
                radio.checked = Some(if self.selected == Some(index) {
                    Checked::True
                } else {
                    Checked::False
                });
                radio.disabled = !option.enabled;
                radio.focusable = index == tab_stop;
                radio
            })
            .collect();
        group
    }

    fn handle_key(&mut self, key: Key) -> Option<Event> {
        if key == Key::Space {
            let enabled = self
                .options
                .get(self.focused)
                .is_some_and(|option| option.enabled);
            return enabled.then(|| {
                self.selected = Some(self.focused);
                Event::Selected(self.focused)
            });
        }
        let next = roving(
            self.focused,
            &self.enabled(),
            key,
            Orientation::Both,
            self.rtl,
        )?;
        self.focused = next;
        self.selected = Some(next);
        Some(Event::Selected(next))
    }

    fn size(&self) -> (f32, f32) {
        let target = crate::accessibility::MIN_TARGET_DP as f32;
        (target, target * self.options.len() as f32)
    }

    fn parts(&self, rect: Rect, interaction: Interaction) -> Vec<Part> {
        let target = crate::accessibility::MIN_TARGET_DP as f32;
        let mut tree = LayoutTree::new();
        let leaves: Vec<_> = self
            .options
            .iter()
            .map(|_| tree.leaf(target, target))
            .collect();
        let root = tree.flex(Flex::column().width(rect.w), &leaves);
        if tree.compute(root, rect.w, rect.h).is_err() {
            return Vec::new();
        }
        leaves
            .iter()
            .enumerate()
            .flat_map(|(index, &leaf)| {
                let mut solved: Rect = tree.absolute(leaf).map(Rect::from).unwrap_or_default();
                solved.x += rect.x;
                solved.y += rect.y;
                let item = if index == self.focused {
                    interaction
                } else {
                    Interaction::IDLE.with_disabled(interaction.disabled)
                };
                self.item_parts(index, solved, item)
            })
            .collect()
    }
}
