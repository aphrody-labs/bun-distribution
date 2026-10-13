// SPDX-License-Identifier: Apache-2.0
//! Icon buttons, FABs and the M3 Expressive button group and split button.

use aphrody_m3_tokens::component::{
    button_filled as filled, button_group_connected_small as connected,
    button_group_standard_small as standard, button_small as small, fab as fab_regular, fab_large,
    fab_primary_container as fab_color, fab_small, focus_indicator,
    icon_button_filled as ib_filled, icon_button_outlined as ib_outlined, icon_button_small as ib,
    icon_button_standard as ib_standard, icon_button_tonal as ib_tonal,
    split_button_small as split,
};
use aphrody_m3_tokens::shape::CornerRadius;
use serde::{Deserialize, Serialize};

use super::{Control, Event};
use crate::a11y::{AccessRole, Accessible};
use crate::interaction::Interaction;
use crate::keyboard::{Key, Orientation, roving};
use crate::layout::{Align, Flex, LayoutTree};
use crate::visual::{
    FOCUS_ROLE, Glyph, Part, Radii, Rect, Tint, estimate_text_width, focus_ring, label, pick,
    state_layer,
};

/// Icon button style.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum IconButtonKind {
    /// No container.
    Standard,
    /// Filled container.
    Filled,
    /// Tonal container.
    Tonal,
    /// Outlined.
    Outlined,
}

/// Resting container shape of an M3 Expressive icon button.
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum IconShape {
    /// Round (morphs to square when selected).
    #[default]
    Round,
    /// Square (morphs to round when selected).
    Square,
}

impl IconShape {
    fn radius(self, selected: bool, pressed: bool) -> CornerRadius {
        match (pressed, selected, self) {
            (true, _, _) => ib::PRESSED_CONTAINER_SHAPE,
            (false, true, Self::Round) => ib::SELECTED_CONTAINER_SHAPE_ROUND,
            (false, true, Self::Square) => ib::SELECTED_CONTAINER_SHAPE_SQUARE,
            (false, false, Self::Round) => ib::CONTAINER_SHAPE_ROUND,
            (false, false, Self::Square) => ib::CONTAINER_SHAPE_SQUARE,
        }
    }
}

/// Icon button (small size), optionally a toggle.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct IconButton {
    /// Style.
    pub kind: IconButtonKind,
    /// Material Symbol name.
    pub icon: String,
    /// Accessible name (icon buttons have no visible label).
    pub label: String,
    /// Container shape.
    pub shape: IconShape,
    /// `Some(selected)` for a toggle button.
    pub toggle: Option<bool>,
    /// Whether the button accepts input.
    pub enabled: bool,
}

impl IconButton {
    /// An enabled, round, non-toggle icon button.
    #[must_use]
    pub fn new(kind: IconButtonKind, icon: impl Into<String>, label: impl Into<String>) -> Self {
        Self {
            kind,
            icon: icon.into(),
            label: label.into(),
            shape: IconShape::Round,
            toggle: None,
            enabled: true,
        }
    }

    /// Container fill, outline, icon colour (state layers take the icon colour).
    fn colors(&self, disabled: bool) -> (Option<Tint>, Option<(Tint, f32)>, Tint) {
        let selected = self.toggle.unwrap_or(false);
        let unselected_toggle = self.toggle == Some(false);
        match self.kind {
            IconButtonKind::Standard => (
                None,
                None,
                pick(
                    disabled,
                    Tint::solid(if selected {
                        ib_standard::SELECTED_ICON_COLOR
                    } else {
                        ib_standard::ICON_COLOR
                    }),
                    Tint::with(
                        ib_standard::DISABLED_ICON_COLOR,
                        ib_standard::DISABLED_ICON_OPACITY,
                    ),
                ),
            ),
            IconButtonKind::Filled => {
                let (container, icon) = if unselected_toggle {
                    (
                        ib_filled::UNSELECTED_CONTAINER_COLOR,
                        ib_filled::UNSELECTED_ICON_COLOR,
                    )
                } else if selected {
                    (
                        ib_filled::SELECTED_CONTAINER_COLOR,
                        ib_filled::SELECTED_ICON_COLOR,
                    )
                } else {
                    (ib_filled::CONTAINER_COLOR, ib_filled::ICON_COLOR)
                };
                (
                    Some(pick(
                        disabled,
                        Tint::solid(container),
                        Tint::with(
                            ib_filled::DISABLED_CONTAINER_COLOR,
                            ib_filled::DISABLED_CONTAINER_OPACITY,
                        ),
                    )),
                    None,
                    pick(
                        disabled,
                        Tint::solid(icon),
                        Tint::with(
                            ib_filled::DISABLED_ICON_COLOR,
                            ib_filled::DISABLED_ICON_OPACITY,
                        ),
                    ),
                )
            }
            IconButtonKind::Tonal => {
                let (container, icon) = if selected {
                    (
                        ib_tonal::SELECTED_CONTAINER_COLOR,
                        ib_tonal::SELECTED_ICON_COLOR,
                    )
                } else {
                    (ib_tonal::CONTAINER_COLOR, ib_tonal::ICON_COLOR)
                };
                (
                    Some(pick(
                        disabled,
                        Tint::solid(container),
                        Tint::with(
                            ib_tonal::DISABLED_CONTAINER_COLOR,
                            ib_tonal::DISABLED_CONTAINER_OPACITY,
                        ),
                    )),
                    None,
                    pick(
                        disabled,
                        Tint::solid(icon),
                        Tint::with(
                            ib_tonal::DISABLED_ICON_COLOR,
                            ib_tonal::DISABLED_ICON_OPACITY,
                        ),
                    ),
                )
            }
            IconButtonKind::Outlined if selected => (
                Some(pick(
                    disabled,
                    Tint::solid(ib_outlined::SELECTED_CONTAINER_COLOR),
                    Tint::with(
                        ib_filled::DISABLED_CONTAINER_COLOR,
                        ib_filled::DISABLED_CONTAINER_OPACITY,
                    ),
                )),
                None,
                pick(
                    disabled,
                    Tint::solid(ib_outlined::SELECTED_ICON_COLOR),
                    Tint::with(
                        ib_outlined::DISABLED_ICON_COLOR,
                        ib_outlined::DISABLED_ICON_OPACITY,
                    ),
                ),
            ),
            IconButtonKind::Outlined => (
                None,
                Some((
                    pick(
                        disabled,
                        Tint::solid(ib_outlined::OUTLINE_COLOR),
                        Tint::solid(ib_outlined::DISABLED_OUTLINE_COLOR),
                    ),
                    ib::OUTLINED_OUTLINE_WIDTH,
                )),
                pick(
                    disabled,
                    Tint::solid(ib_outlined::ICON_COLOR),
                    Tint::with(
                        ib_outlined::DISABLED_ICON_COLOR,
                        ib_outlined::DISABLED_ICON_OPACITY,
                    ),
                ),
            ),
        }
    }
}

impl Control for IconButton {
    fn accessible(&self) -> Accessible {
        let mut node = Accessible::new(AccessRole::Button, &self.label);
        node.pressed = self.toggle;
        node.disabled = !self.enabled;
        node
    }

    fn handle_key(&mut self, key: Key) -> Option<Event> {
        if !(self.enabled && key.activates()) {
            return None;
        }
        Some(match &mut self.toggle {
            Some(selected) => {
                *selected = !*selected;
                Event::Toggled(*selected)
            }
            None => Event::Activated,
        })
    }

    fn size(&self) -> (f32, f32) {
        (
            ib::DEFAULT_LEADING_SPACE + ib::ICON_SIZE + ib::DEFAULT_TRAILING_SPACE,
            ib::CONTAINER_HEIGHT,
        )
    }

    fn parts(&self, rect: Rect, interaction: Interaction) -> Vec<Part> {
        let interaction = interaction.with_disabled(interaction.disabled || !self.enabled);
        let disabled = interaction.disabled;
        let (cx, cy) = rect.center();
        let (w, h) = self.size();
        let container = Rect::centered(cx, cy, w, h);
        let shape = self.shape.radius(
            self.toggle.unwrap_or(false),
            interaction.pressed && !disabled,
        );
        let radii = Radii::shape(shape, w, h);
        let (fill, outline, icon) = self.colors(disabled);
        let mut parts = Vec::new();
        if fill.is_some() || outline.is_some() {
            parts.push(Part::Surface {
                rect: container,
                radii,
                fill,
                outline,
                elevation: 0,
            });
        }
        parts.extend(state_layer(container, radii, icon.role, interaction));
        parts.push(Part::Glyph {
            rect: Rect::centered(cx, cy, ib::ICON_SIZE, ib::ICON_SIZE),
            glyph: Glyph::Symbol(self.icon.clone()),
            tint: icon,
        });
        parts.extend(focus_ring(
            container,
            radii,
            FOCUS_ROLE,
            focus_indicator::OUTER_OFFSET,
            interaction,
        ));
        parts
    }
}

/// FAB size.
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FabSize {
    /// 40 dp.
    Small,
    /// 56 dp.
    #[default]
    Regular,
    /// 96 dp.
    Large,
}

/// Floating action button in the primary-container colour set. M3 FABs have no disabled state.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Fab {
    /// Size.
    pub size: FabSize,
    /// Material Symbol name.
    pub icon: String,
    /// Accessible name.
    pub label: String,
}

impl Fab {
    /// A regular FAB.
    #[must_use]
    pub fn new(icon: impl Into<String>, label: impl Into<String>) -> Self {
        Self {
            size: FabSize::Regular,
            icon: icon.into(),
            label: label.into(),
        }
    }

    fn metrics(&self) -> (f32, f32, f32, CornerRadius) {
        match self.size {
            FabSize::Small => (
                fab_small::CONTAINER_WIDTH,
                fab_small::CONTAINER_HEIGHT,
                fab_small::ICON_SIZE,
                fab_small::CONTAINER_SHAPE,
            ),
            FabSize::Regular => (
                fab_regular::CONTAINER_WIDTH,
                fab_regular::CONTAINER_HEIGHT,
                fab_regular::ICON_SIZE,
                fab_regular::CONTAINER_SHAPE,
            ),
            FabSize::Large => (
                fab_large::CONTAINER_WIDTH,
                fab_large::CONTAINER_HEIGHT,
                fab_large::ICON_SIZE,
                fab_large::CONTAINER_SHAPE,
            ),
        }
    }
}

impl Control for Fab {
    fn accessible(&self) -> Accessible {
        Accessible::new(AccessRole::Button, &self.label)
    }

    fn handle_key(&mut self, key: Key) -> Option<Event> {
        key.activates().then_some(Event::Activated)
    }

    fn size(&self) -> (f32, f32) {
        let (w, h, _, _) = self.metrics();
        (w, h)
    }

    fn parts(&self, rect: Rect, interaction: Interaction) -> Vec<Part> {
        let (w, h, icon, shape) = self.metrics();
        let (cx, cy) = rect.center();
        let container = Rect::centered(cx, cy, w, h);
        let radii = Radii::shape(shape, w, h);
        let elevation = if interaction.pressed {
            fab_color::PRESSED_CONTAINER_ELEVATION
        } else if interaction.hovered {
            fab_color::HOVERED_CONTAINER_ELEVATION
        } else {
            fab_color::CONTAINER_ELEVATION
        };
        let mut parts = vec![Part::Surface {
            rect: container,
            radii,
            fill: Some(Tint::solid(fab_color::CONTAINER_COLOR)),
            outline: None,
            elevation,
        }];
        let layer = if interaction.pressed {
            fab_color::PRESSED_STATE_LAYER_COLOR
        } else {
            fab_color::HOVERED_STATE_LAYER_COLOR
        };
        parts.extend(state_layer(container, radii, layer, interaction));
        parts.push(Part::Glyph {
            rect: Rect::centered(cx, cy, icon, icon),
            glyph: Glyph::Symbol(self.icon.clone()),
            tint: Tint::solid(fab_color::ICON_COLOR),
        });
        parts.extend(focus_ring(
            container,
            radii,
            FOCUS_ROLE,
            focus_indicator::OUTER_OFFSET,
            interaction,
        ));
        parts
    }
}

/// Button group layout.
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ButtonGroupKind {
    /// Separate buttons; the pressed one widens.
    #[default]
    Standard,
    /// Connected segments with small inner corners.
    Connected,
}

/// One toggle button of a [`ButtonGroup`].
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct GroupButton {
    /// Label.
    pub label: String,
    /// Leading Material Symbol.
    pub icon: Option<String>,
    /// Selected.
    pub selected: bool,
    /// Whether the button accepts input.
    pub enabled: bool,
    /// Measured label width; `None` estimates it.
    pub label_width: Option<f32>,
}

impl GroupButton {
    /// Enabled, unselected button.
    #[must_use]
    pub fn new(label: impl Into<String>) -> Self {
        Self {
            label: label.into(),
            icon: None,
            selected: false,
            enabled: true,
            label_width: None,
        }
    }

    fn width(&self) -> f32 {
        let text = self
            .label_width
            .unwrap_or_else(|| estimate_text_width(&self.label, LABEL_STYLE));
        let icon = if self.icon.is_some() {
            small::ICON_SIZE + small::ICON_LABEL_SPACE
        } else {
            0.0
        };
        small::LEADING_SPACE + icon + text + small::TRAILING_SPACE
    }

    fn colors(&self, disabled: bool) -> (Tint, Tint) {
        let (container, content) = if self.selected {
            (
                filled::SELECTED_CONTAINER_COLOR,
                filled::SELECTED_LABEL_TEXT_COLOR,
            )
        } else {
            (
                filled::UNSELECTED_CONTAINER_COLOR,
                filled::UNSELECTED_LABEL_TEXT_COLOR,
            )
        };
        (
            pick(
                disabled,
                Tint::solid(container),
                Tint::with(
                    filled::DISABLED_CONTAINER_COLOR,
                    filled::DISABLED_CONTAINER_OPACITY,
                ),
            ),
            pick(
                disabled,
                Tint::solid(content),
                Tint::with(
                    filled::DISABLED_LABEL_TEXT_COLOR,
                    filled::DISABLED_LABEL_TEXT_OPACITY,
                ),
            ),
        )
    }
}

/// Button label type style (`md.comp.button.label-text`; the small-button tables do not republish it).
const LABEL_STYLE: &str = "label-large";

/// M3 Expressive button group of toggle buttons with roving focus.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct ButtonGroup {
    /// Layout.
    pub kind: ButtonGroupKind,
    /// Group name.
    pub label: String,
    /// Buttons.
    pub buttons: Vec<GroupButton>,
    /// Exactly one button selected (segmented) instead of independent toggles.
    pub single_select: bool,
    /// Button holding the roving focus.
    pub focused: usize,
    /// Button currently pressed by pointer or key.
    pub pressed: Option<usize>,
    /// Right-to-left.
    pub rtl: bool,
}

impl ButtonGroup {
    /// A group over enabled, unselected buttons.
    #[must_use]
    pub fn new(kind: ButtonGroupKind, label: impl Into<String>, buttons: &[&str]) -> Self {
        Self {
            kind,
            label: label.into(),
            buttons: buttons
                .iter()
                .map(|label| GroupButton::new(*label))
                .collect(),
            single_select: false,
            focused: 0,
            pressed: None,
            rtl: false,
        }
    }

    fn gap(&self) -> f32 {
        match self.kind {
            ButtonGroupKind::Standard => standard::BETWEEN_SPACE,
            ButtonGroupKind::Connected => connected::BETWEEN_SPACE,
        }
    }

    fn height(&self) -> f32 {
        match self.kind {
            ButtonGroupKind::Standard => standard::CONTAINER_HEIGHT,
            ButtonGroupKind::Connected => connected::CONTAINER_HEIGHT,
        }
    }

    /// Item widths after the Expressive press interaction: in a standard group the pressed item
    /// widens by `pressed-item-width-multiplier` and its neighbours give the space back.
    #[must_use]
    pub fn widths(&self) -> Vec<f32> {
        let mut widths: Vec<f32> = self.buttons.iter().map(GroupButton::width).collect();
        if let (ButtonGroupKind::Standard, Some(index)) = (self.kind, self.pressed)
            && index < widths.len()
        {
            let grow = widths[index] * standard::PRESSED_ITEM_WIDTH_MULTIPLIER / 100.0;
            let neighbours: Vec<usize> = [index.checked_sub(1), Some(index + 1)]
                .into_iter()
                .flatten()
                .filter(|&n| n < widths.len())
                .collect();
            if !neighbours.is_empty() {
                widths[index] += grow;
                for n in &neighbours {
                    widths[*n] -= grow / neighbours.len() as f32;
                }
            }
        }
        widths
    }

    /// Corner radii of item `index`.
    #[must_use]
    pub fn radii(&self, index: usize) -> Radii {
        let height = self.height();
        let Some(button) = self.buttons.get(index) else {
            return Radii::default();
        };
        let pressed = self.pressed == Some(index);
        match self.kind {
            ButtonGroupKind::Standard => {
                let shape = if pressed {
                    small::PRESSED_CONTAINER_SHAPE
                } else if button.selected {
                    small::SELECTED_CONTAINER_SHAPE_ROUND
                } else {
                    small::CONTAINER_SHAPE_ROUND
                };
                Radii::shape(shape, f32::INFINITY, height)
            }
            ButtonGroupKind::Connected => {
                let outer = Radii::shape(connected::CONTAINER_SHAPE, f32::INFINITY, height).tl;
                let inner = if button.selected {
                    height * connected::SELECTED_INNER_CORNER_SIZE / 100.0
                } else if pressed {
                    f32::from(connected::PRESSED_INNER_CORNER_SIZE.dp)
                } else {
                    f32::from(connected::INNER_CORNER_SIZE.dp)
                }
                .min(outer);
                let last = self.buttons.len() - 1;
                match (index == 0, index == last) {
                    (true, true) => Radii::all(outer),
                    (true, false) => Radii::leading(outer, inner),
                    (false, true) => Radii::trailing(outer, inner),
                    (false, false) => Radii::all(inner),
                }
            }
        }
    }

    /// Item rectangles solved by Taffy in a row of `rect`.
    #[must_use]
    pub fn item_rects(&self, rect: Rect) -> Vec<Rect> {
        let height = self.height();
        let mut tree = LayoutTree::new();
        let leaves: Vec<_> = self
            .widths()
            .into_iter()
            .map(|w| tree.leaf(w, height))
            .collect();
        let root = tree.flex(
            Flex::row()
                .gap(self.gap())
                .align(Align::Center)
                .height(rect.h.max(height)),
            &leaves,
        );
        if tree.compute(root, rect.w, rect.h.max(height)).is_err() {
            return Vec::new();
        }
        leaves
            .iter()
            .map(|&leaf| {
                let solved = tree.absolute(leaf).map(Rect::from).unwrap_or_default();
                Rect::new(rect.x + solved.x, rect.y + solved.y, solved.w, solved.h)
            })
            .collect()
    }
}

impl Control for ButtonGroup {
    fn accessible(&self) -> Accessible {
        let mut group = Accessible::new(AccessRole::Toolbar, &self.label);
        group.focusable = false;
        group.orientation = Some(Orientation::Horizontal);
        group.children = self
            .buttons
            .iter()
            .enumerate()
            .map(|(index, button)| {
                let mut node = Accessible::new(AccessRole::Button, &button.label);
                node.pressed = Some(button.selected);
                node.disabled = !button.enabled;
                node.focusable = index == self.focused;
                node
            })
            .collect();
        group
    }

    fn handle_key(&mut self, key: Key) -> Option<Event> {
        let enabled: Vec<bool> = self.buttons.iter().map(|button| button.enabled).collect();
        if key.activates() {
            let index = self.focused;
            if !enabled.get(index).copied().unwrap_or(false) {
                return None;
            }
            if self.single_select {
                for (i, button) in self.buttons.iter_mut().enumerate() {
                    button.selected = i == index;
                }
                return Some(Event::Selected(index));
            }
            let button = &mut self.buttons[index];
            button.selected = !button.selected;
            return Some(Event::Toggled(button.selected));
        }
        let next = roving(
            self.focused,
            &enabled,
            key,
            Orientation::Horizontal,
            self.rtl,
        )?;
        self.focused = next;
        Some(Event::Focused(next))
    }

    fn size(&self) -> (f32, f32) {
        let widths = self.widths();
        let gaps = self.gap() * widths.len().saturating_sub(1) as f32;
        (widths.iter().sum::<f32>() + gaps, self.height())
    }

    fn parts(&self, rect: Rect, interaction: Interaction) -> Vec<Part> {
        let mut parts = Vec::new();
        for (index, item) in self.item_rects(rect).into_iter().enumerate() {
            let button = &self.buttons[index];
            let state = if index == self.focused {
                interaction
            } else {
                Interaction::IDLE
            };
            let state = Interaction {
                pressed: state.pressed || self.pressed == Some(index),
                ..state
            }
            .with_disabled(interaction.disabled || !button.enabled);
            let radii = self.radii(index);
            let (container, content) = button.colors(state.disabled);
            parts.push(Part::Surface {
                rect: item,
                radii,
                fill: Some(container),
                outline: None,
                elevation: filled::CONTAINER_ELEVATION,
            });
            parts.extend(state_layer(item, radii, content.role, state));
            let mut x = item.x + small::LEADING_SPACE;
            if let Some(icon) = &button.icon {
                let (_, cy) = item.center();
                parts.push(Part::Glyph {
                    rect: Rect::new(
                        x,
                        cy - small::ICON_SIZE / 2.0,
                        small::ICON_SIZE,
                        small::ICON_SIZE,
                    ),
                    glyph: Glyph::Symbol(icon.clone()),
                    tint: content,
                });
                x += small::ICON_SIZE + small::ICON_LABEL_SPACE;
            }
            parts.push(label(item, x, &button.label, LABEL_STYLE, content));
            parts.extend(focus_ring(
                item,
                radii,
                FOCUS_ROLE,
                focus_indicator::OUTER_OFFSET,
                state,
            ));
        }
        parts
    }
}

/// M3 Expressive split button: a primary action and a menu trigger.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct SplitButton {
    /// Primary action label.
    pub label: String,
    /// Leading Material Symbol of the primary action.
    pub icon: Option<String>,
    /// Accessible name of the menu trigger.
    pub menu_label: String,
    /// Whether the menu is open (trailing button selected).
    pub expanded: bool,
    /// Whether keyboard focus is on the trailing button.
    pub trailing_focused: bool,
    /// Whether the control accepts input.
    pub enabled: bool,
    /// Measured label width; `None` estimates it.
    pub label_width: Option<f32>,
}

impl SplitButton {
    /// An enabled split button with a closed menu.
    #[must_use]
    pub fn new(label: impl Into<String>, menu_label: impl Into<String>) -> Self {
        Self {
            label: label.into(),
            icon: None,
            menu_label: menu_label.into(),
            expanded: false,
            trailing_focused: false,
            enabled: true,
            label_width: None,
        }
    }

    fn leading_width(&self) -> f32 {
        let text = self
            .label_width
            .unwrap_or_else(|| estimate_text_width(&self.label, LABEL_STYLE));
        let icon = if self.icon.is_some() {
            small::ICON_SIZE + small::ICON_LABEL_SPACE
        } else {
            0.0
        };
        split::LEADING_BUTTON_LEADING_SPACE + icon + text + split::LEADING_BUTTON_TRAILING_SPACE
    }

    fn trailing_width() -> f32 {
        split::TRAILING_BUTTON_LEADING_SPACE
            + split::TRAILING_BUTTON_ICON_SIZE
            + split::TRAILING_BUTTON_TRAILING_SPACE
    }

    /// Inner corner radius for a segment in `interaction`.
    #[must_use]
    pub fn inner_radius(&self, trailing: bool, interaction: Interaction) -> f32 {
        let height = split::CONTAINER_HEIGHT;
        if trailing && self.expanded {
            return height * split::TRAILING_BUTTON_INNER_CORNER_SELECTED_SIZE / 100.0;
        }
        let shape = if interaction.pressed {
            split::INNER_CORNER_PRESSED_SIZE
        } else if interaction.hovered {
            split::INNER_CORNER_HOVERED_SIZE
        } else {
            split::INNER_CORNER_SIZE
        };
        f32::from(shape.dp).min(height / 2.0)
    }
}

impl Control for SplitButton {
    fn accessible(&self) -> Accessible {
        let mut group = Accessible::new(AccessRole::Group, &self.label);
        group.focusable = false;
        let mut action = Accessible::new(AccessRole::Button, &self.label);
        action.disabled = !self.enabled;
        let mut trigger = Accessible::new(AccessRole::Button, &self.menu_label);
        trigger.disabled = !self.enabled;
        trigger.has_popup = Some("menu".into());
        trigger.expanded = Some(self.expanded);
        group.children = vec![action, trigger];
        group
    }

    fn handle_key(&mut self, key: Key) -> Option<Event> {
        if !self.enabled {
            return None;
        }
        match key {
            Key::Escape if self.expanded => {
                self.expanded = false;
                Some(Event::Dismissed)
            }
            Key::ArrowDown if self.trailing_focused && !self.expanded => {
                self.expanded = true;
                Some(Event::Opened)
            }
            key if key.activates() && self.trailing_focused => {
                self.expanded = !self.expanded;
                Some(if self.expanded {
                    Event::Opened
                } else {
                    Event::Dismissed
                })
            }
            key if key.activates() => Some(Event::Activated),
            _ => None,
        }
    }

    fn size(&self) -> (f32, f32) {
        (
            self.leading_width() + split::BETWEEN_SPACE + Self::trailing_width(),
            split::CONTAINER_HEIGHT,
        )
    }

    fn parts(&self, rect: Rect, interaction: Interaction) -> Vec<Part> {
        let height = split::CONTAINER_HEIGHT;
        let mut tree = LayoutTree::new();
        let lead = tree.leaf(self.leading_width(), height);
        let trail = tree.leaf(Self::trailing_width(), height);
        let root = tree.flex(
            Flex::row().gap(split::BETWEEN_SPACE).align(Align::Center),
            &[lead, trail],
        );
        if tree.compute(root, rect.w, rect.h.max(height)).is_err() {
            return Vec::new();
        }
        let outer = Radii::shape(split::CONTAINER_SHAPE, f32::INFINITY, height).tl;
        let disabled = interaction.disabled || !self.enabled;
        let mut parts = Vec::new();
        for (trailing, node) in [(false, lead), (true, trail)] {
            let solved = tree.absolute(node).map(Rect::from).unwrap_or_default();
            let segment = Rect::new(
                rect.x + solved.x,
                rect.y + (rect.h - height) / 2.0,
                solved.w,
                height,
            );
            let state = if trailing == self.trailing_focused {
                interaction
            } else {
                Interaction::IDLE
            }
            .with_disabled(disabled);
            let inner = self.inner_radius(trailing, state);
            let radii = if trailing {
                Radii::trailing(outer, inner)
            } else {
                Radii::leading(outer, inner)
            };
            let container = pick(
                disabled,
                Tint::solid(filled::CONTAINER_COLOR),
                Tint::with(
                    filled::DISABLED_CONTAINER_COLOR,
                    filled::DISABLED_CONTAINER_OPACITY,
                ),
            );
            let content = pick(
                disabled,
                Tint::solid(filled::LABEL_TEXT_COLOR),
                Tint::with(
                    filled::DISABLED_LABEL_TEXT_COLOR,
                    filled::DISABLED_LABEL_TEXT_OPACITY,
                ),
            );
            parts.push(Part::Surface {
                rect: segment,
                radii,
                fill: Some(container),
                outline: None,
                elevation: filled::CONTAINER_ELEVATION,
            });
            parts.extend(state_layer(segment, radii, content.role, state));
            let (cx, cy) = segment.center();
            if trailing {
                let size = split::TRAILING_BUTTON_ICON_SIZE;
                let icon = if self.expanded {
                    "keyboard_arrow_up"
                } else {
                    "keyboard_arrow_down"
                };
                parts.push(Part::Glyph {
                    rect: Rect::centered(cx, cy, size, size),
                    glyph: Glyph::Symbol(icon.into()),
                    tint: content,
                });
            } else {
                let mut x = segment.x + split::LEADING_BUTTON_LEADING_SPACE;
                if let Some(icon) = &self.icon {
                    parts.push(Part::Glyph {
                        rect: Rect::new(
                            x,
                            cy - small::ICON_SIZE / 2.0,
                            small::ICON_SIZE,
                            small::ICON_SIZE,
                        ),
                        glyph: Glyph::Symbol(icon.clone()),
                        tint: content,
                    });
                    x += small::ICON_SIZE + small::ICON_LABEL_SPACE;
                }
                parts.push(label(segment, x, &self.label, LABEL_STYLE, content));
            }
            parts.extend(focus_ring(
                segment,
                radii,
                FOCUS_ROLE,
                focus_indicator::OUTER_OFFSET,
                state,
            ));
        }
        parts
    }
}
