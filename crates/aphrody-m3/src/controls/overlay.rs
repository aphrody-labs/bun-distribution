// SPDX-License-Identifier: Apache-2.0
//! Dialog (modal, focus-trapped) and menu (roving focus, type-ahead).

use aphrody_m3_tokens::component::{
    button_small as small, dialog as dg, focus_indicator, menu as mn,
};
use serde::{Deserialize, Serialize};

use super::{Control, Event};
use crate::a11y::{AccessRole, Accessible};
use crate::focus::{FocusMove, FocusScope};
use crate::interaction::Interaction;
use crate::keyboard::{Key, Orientation, roving, type_ahead};
use crate::layout::{Align, Flex, Justify, LayoutTree, Padding};
use crate::visual::{
    FOCUS_ROLE, Glyph, Part, Radii, Rect, Tint, estimate_text_width, focus_ring, label, pick,
    state_layer, type_style,
};

/// material-web dialog geometry (`dialog/internal/_dialog.scss`): 280-560 dp wide, 24 dp
/// padding, 16 dp between sections, 8 dp between actions. Geometry, not tokens.
const DIALOG_MIN_WIDTH: f32 = 280.0;
const DIALOG_MAX_WIDTH: f32 = 560.0;
const DIALOG_PADDING: f32 = 24.0;
const DIALOG_SECTION_GAP: f32 = 16.0;
const DIALOG_ACTION_GAP: f32 = 8.0;
/// material-web menu geometry (`menu/internal/_menu.scss`, `_menu-item.scss`): 112-280 dp
/// wide, 8 dp vertical padding, 12 dp item insets, 12 dp icon-label space.
const MENU_MIN_WIDTH: f32 = 112.0;
const MENU_MAX_WIDTH: f32 = 280.0;
const MENU_PADDING: f32 = 8.0;
const MENU_ITEM_INSET: f32 = 12.0;

/// Modal dialog with text actions.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Dialog {
    /// Headline (accessible name).
    pub headline: String,
    /// Supporting text (accessible description).
    pub supporting: String,
    /// Hero icon above the headline.
    pub icon: Option<String>,
    /// Action labels, in reading order.
    pub actions: Vec<String>,
    /// `alertdialog` instead of `dialog`.
    pub alert: bool,
    /// Whether the dialog is shown.
    pub open: bool,
    #[serde(skip)]
    focus: FocusScope,
}

impl Dialog {
    /// An open dialog; focus starts on the first action.
    #[must_use]
    pub fn new(
        headline: impl Into<String>,
        supporting: impl Into<String>,
        actions: &[&str],
    ) -> Self {
        let mut focus = FocusScope::new(vec![true; actions.len()], true);
        focus.focus_first();
        Self {
            headline: headline.into(),
            supporting: supporting.into(),
            icon: None,
            actions: actions.iter().map(|action| (*action).into()).collect(),
            alert: false,
            open: true,
            focus,
        }
    }

    /// Focused action.
    #[must_use]
    pub fn focused(&self) -> Option<usize> {
        self.focus.current()
    }

    fn width(&self) -> f32 {
        let actions: f32 = self
            .actions
            .iter()
            .map(|action| action_width(action))
            .sum::<f32>()
            + DIALOG_ACTION_GAP * self.actions.len().saturating_sub(1) as f32;
        let headline = estimate_text_width(&self.headline, dg::HEADLINE_SIZE);
        (actions.max(headline) + 2.0 * DIALOG_PADDING).clamp(DIALOG_MIN_WIDTH, DIALOG_MAX_WIDTH)
    }

    /// Solved boxes `(icon, headline, supporting, actions)` for a dialog whose top-left is `origin`.
    fn layout(&self, origin: (f32, f32)) -> (Option<Rect>, Rect, Rect, Vec<Rect>, (f32, f32)) {
        let width = self.width();
        let inner = width - 2.0 * DIALOG_PADDING;
        let line = |style: &str| type_style(style).map_or(0.0, |s| s.line_height_dp);
        let lines =
            |text: &str, style: &str| (estimate_text_width(text, style) / inner).ceil().max(1.0);
        let mut tree = LayoutTree::new();
        let icon = self
            .icon
            .as_ref()
            .map(|_| tree.leaf(dg::WITH_ICON_ICON_SIZE, dg::WITH_ICON_ICON_SIZE));
        let headline = tree.leaf(
            inner,
            line(dg::HEADLINE_SIZE) * lines(&self.headline, dg::HEADLINE_SIZE),
        );
        let supporting = tree.leaf(
            inner,
            line(dg::SUPPORTING_TEXT_SIZE) * lines(&self.supporting, dg::SUPPORTING_TEXT_SIZE),
        );
        let buttons: Vec<_> = self
            .actions
            .iter()
            .map(|action| tree.leaf(action_width(action), small::CONTAINER_HEIGHT))
            .collect();
        let row = tree.flex(
            Flex::row()
                .gap(DIALOG_ACTION_GAP)
                .justify(Justify::End)
                .width(inner),
            &buttons,
        );
        let mut children: Vec<_> = icon.into_iter().collect();
        children.extend([headline, supporting, row]);
        let align = if self.icon.is_some() {
            Align::Center
        } else {
            Align::Start
        };
        let root = tree.flex(
            Flex::column()
                .gap(DIALOG_SECTION_GAP)
                .padding(Padding::all(DIALOG_PADDING))
                .align(align)
                .width(width),
            &children,
        );
        let Ok(size) = tree.compute(root, width, f32::MAX) else {
            return (
                None,
                Rect::default(),
                Rect::default(),
                Vec::new(),
                (width, 0.0),
            );
        };
        let place = |node| {
            let solved = tree.absolute(node).map(Rect::from).unwrap_or_default();
            Rect::new(origin.0 + solved.x, origin.1 + solved.y, solved.w, solved.h)
        };
        (
            icon.map(place),
            place(headline),
            place(supporting),
            buttons.into_iter().map(place).collect(),
            (size.width, size.height),
        )
    }
}

fn action_width(action: &str) -> f32 {
    small::LEADING_SPACE
        + estimate_text_width(action, dg::ACTION_LABEL_TEXT_SIZE)
        + small::TRAILING_SPACE
}

impl Control for Dialog {
    fn accessible(&self) -> Accessible {
        let mut node = Accessible::new(
            if self.alert {
                AccessRole::AlertDialog
            } else {
                AccessRole::Dialog
            },
            &self.headline,
        );
        node.description = (!self.supporting.is_empty()).then(|| self.supporting.clone());
        node.modal = true;
        node.focusable = false;
        node.children = self
            .actions
            .iter()
            .enumerate()
            .map(|(index, action)| {
                let mut button = Accessible::new(AccessRole::Button, action);
                button.focusable = self.focus.current() == Some(index);
                button
            })
            .collect();
        node
    }

    fn handle_key(&mut self, key: Key) -> Option<Event> {
        if !self.open {
            return None;
        }
        match key {
            Key::Escape => {
                self.open = false;
                Some(Event::Dismissed)
            }
            Key::Tab | Key::BackTab => match self.focus.handle_key(key)? {
                FocusMove::Moved(index) => Some(Event::Focused(index)),
                FocusMove::ExitForward | FocusMove::ExitBackward => None,
            },
            key if key.activates() => {
                let index = self.focus.current()?;
                self.open = false;
                Some(Event::Action(index))
            }
            _ => None,
        }
    }

    fn size(&self) -> (f32, f32) {
        self.layout((0.0, 0.0)).4
    }

    fn parts(&self, rect: Rect, interaction: Interaction) -> Vec<Part> {
        if !self.open {
            return Vec::new();
        }
        let (icon, headline, supporting, actions, (w, h)) = self.layout((0.0, 0.0));
        let origin = rect.center();
        let shift =
            |r: Rect| Rect::new(r.x + origin.0 - w / 2.0, r.y + origin.1 - h / 2.0, r.w, r.h);
        let container = shift(Rect::new(0.0, 0.0, w, h));
        let mut parts = vec![Part::Surface {
            rect: container,
            radii: Radii::shape(dg::CONTAINER_SHAPE, w, h),
            fill: Some(Tint::solid(dg::CONTAINER_COLOR)),
            outline: None,
            elevation: dg::CONTAINER_ELEVATION,
        }];
        if let (Some(name), Some(icon)) = (&self.icon, icon) {
            parts.push(Part::Glyph {
                rect: shift(icon),
                glyph: Glyph::Symbol(name.clone()),
                tint: Tint::solid(dg::WITH_ICON_ICON_COLOR),
            });
        }
        let headline = shift(headline);
        parts.push(Part::Label {
            rect: headline,
            text: self.headline.clone(),
            style: dg::HEADLINE_SIZE.into(),
            tint: Tint::solid(dg::HEADLINE_COLOR),
        });
        let supporting = shift(supporting);
        parts.push(Part::Label {
            rect: supporting,
            text: self.supporting.clone(),
            style: dg::SUPPORTING_TEXT_SIZE.into(),
            tint: Tint::solid(dg::SUPPORTING_TEXT_COLOR),
        });
        for (index, button) in actions.into_iter().map(shift).enumerate() {
            let state = if self.focus.current() == Some(index) {
                interaction
            } else {
                Interaction::IDLE
            };
            let radii = Radii::shape(small::CONTAINER_SHAPE_ROUND, button.w, button.h);
            parts.extend(state_layer(
                button,
                radii,
                dg::ACTION_LABEL_TEXT_COLOR,
                state,
            ));
            parts.push(label(
                button,
                button.x + small::LEADING_SPACE,
                &self.actions[index],
                dg::ACTION_LABEL_TEXT_SIZE,
                Tint::solid(dg::ACTION_LABEL_TEXT_COLOR),
            ));
            parts.extend(focus_ring(
                button,
                radii,
                FOCUS_ROLE,
                focus_indicator::OUTER_OFFSET,
                state,
            ));
        }
        parts
    }
}

/// One menu entry.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct MenuItem {
    /// Label.
    pub label: String,
    /// Leading Material Symbol.
    pub icon: Option<String>,
    /// Whether the item can be activated.
    pub enabled: bool,
    /// Selected (single-select menus).
    pub selected: bool,
}

/// Menu attached to a trigger button.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Menu {
    /// Accessible name of the trigger.
    pub label: String,
    /// Entries.
    pub items: Vec<MenuItem>,
    /// Whether the menu is open.
    pub open: bool,
    /// Focused entry while open.
    pub focused: Option<usize>,
}

impl Menu {
    /// A closed menu over enabled entries.
    #[must_use]
    pub fn new(label: impl Into<String>, items: &[&str]) -> Self {
        Self {
            label: label.into(),
            items: items
                .iter()
                .map(|label| MenuItem {
                    label: (*label).into(),
                    icon: None,
                    enabled: true,
                    selected: false,
                })
                .collect(),
            open: false,
            focused: None,
        }
    }

    fn enabled(&self) -> Vec<bool> {
        self.items.iter().map(|entry| entry.enabled).collect()
    }

    fn close(&mut self) -> Option<Event> {
        self.open = false;
        self.focused = None;
        Some(Event::Dismissed)
    }

    /// Accessible node of the trigger button.
    #[must_use]
    pub fn trigger(&self) -> Accessible {
        let mut node = Accessible::new(AccessRole::Button, &self.label);
        node.has_popup = Some("menu".into());
        node.expanded = Some(self.open);
        node
    }
}

impl Control for Menu {
    fn accessible(&self) -> Accessible {
        let mut menu = Accessible::new(AccessRole::Menu, &self.label);
        menu.focusable = false;
        menu.orientation = Some(Orientation::Vertical);
        menu.children = self
            .items
            .iter()
            .enumerate()
            .map(|(index, entry)| {
                let mut node = Accessible::new(AccessRole::MenuItem, &entry.label);
                node.disabled = !entry.enabled;
                node.focusable = self.focused == Some(index);
                node
            })
            .collect();
        menu
    }

    fn handle_key(&mut self, key: Key) -> Option<Event> {
        let enabled = self.enabled();
        if !self.open {
            return matches!(key, Key::ArrowDown | Key::ArrowUp | Key::Enter | Key::Space).then(
                || {
                    self.open = true;
                    self.focused = if key == Key::ArrowUp {
                        enabled.iter().rposition(|&on| on)
                    } else {
                        enabled.iter().position(|&on| on)
                    };
                    Event::Opened
                },
            );
        }
        let current = self.focused.unwrap_or(0);
        match key {
            Key::Escape | Key::Tab | Key::BackTab => self.close(),
            key if key.activates() => {
                let index = self.focused.filter(|&index| enabled[index])?;
                self.close();
                Some(Event::Action(index))
            }
            Key::Char(ch) => {
                let next = type_ahead(
                    current,
                    self.items
                        .iter()
                        .map(|entry| (entry.label.as_str(), entry.enabled)),
                    ch,
                )?;
                self.focused = Some(next);
                Some(Event::Focused(next))
            }
            key => {
                let next = roving(current, &enabled, key, Orientation::Vertical, false)?;
                self.focused = Some(next);
                Some(Event::Focused(next))
            }
        }
    }

    fn size(&self) -> (f32, f32) {
        let widest = self
            .items
            .iter()
            .map(|entry| {
                let icon = if entry.icon.is_some() {
                    mn::LIST_ITEM_LEADING_ICON_SIZE + MENU_ITEM_INSET
                } else {
                    0.0
                };
                icon + estimate_text_width(&entry.label, mn::LIST_ITEM_LABEL_TEXT_SIZE)
            })
            .fold(0.0, f32::max);
        let width = (widest + 2.0 * MENU_ITEM_INSET).clamp(MENU_MIN_WIDTH, MENU_MAX_WIDTH);
        (
            width,
            mn::LIST_ITEM_CONTAINER_HEIGHT * self.items.len() as f32 + 2.0 * MENU_PADDING,
        )
    }

    fn parts(&self, rect: Rect, interaction: Interaction) -> Vec<Part> {
        if !self.open {
            return Vec::new();
        }
        let (w, h) = self.size();
        let container = Rect::new(rect.x, rect.y, w, h);
        let mut parts = vec![Part::Surface {
            rect: container,
            radii: Radii::shape(mn::CONTAINER_SHAPE, w, h),
            fill: Some(Tint::solid(mn::CONTAINER_COLOR)),
            outline: None,
            elevation: mn::CONTAINER_ELEVATION,
        }];
        let mut tree = LayoutTree::new();
        let rows: Vec<_> = self
            .items
            .iter()
            .map(|_| tree.leaf(w, mn::LIST_ITEM_CONTAINER_HEIGHT))
            .collect();
        let root = tree.flex(
            Flex::column()
                .padding(Padding::symmetric(0.0, MENU_PADDING))
                .width(w),
            &rows,
        );
        if tree.compute(root, w, h).is_err() {
            return parts;
        }
        for (index, node) in rows.into_iter().enumerate() {
            let entry = &self.items[index];
            let solved = tree.absolute(node).map(Rect::from).unwrap_or_default();
            let row = Rect::new(
                container.x + solved.x,
                container.y + solved.y,
                solved.w,
                solved.h,
            );
            let state = if self.focused == Some(index) {
                interaction
            } else {
                Interaction::IDLE
            }
            .with_disabled(!entry.enabled);
            if entry.selected {
                parts.push(Part::Surface {
                    rect: row,
                    radii: Radii::default(),
                    fill: Some(Tint::solid(mn::LIST_ITEM_SELECTED_CONTAINER_COLOR)),
                    outline: None,
                    elevation: 0,
                });
            }
            parts.extend(state_layer(
                row,
                Radii::default(),
                mn::LIST_ITEM_HOVER_STATE_LAYER_COLOR,
                state,
            ));
            let text_role = if entry.selected {
                mn::LIST_ITEM_SELECTED_LABEL_TEXT_COLOR
            } else {
                mn::LIST_ITEM_LABEL_TEXT_COLOR
            };
            let text = pick(
                state.disabled,
                Tint::solid(text_role),
                Tint::with(
                    mn::LIST_ITEM_DISABLED_LABEL_TEXT_COLOR,
                    mn::LIST_ITEM_DISABLED_LABEL_TEXT_OPACITY,
                ),
            );
            let mut x = row.x + MENU_ITEM_INSET;
            if let Some(icon) = &entry.icon {
                let size = mn::LIST_ITEM_LEADING_ICON_SIZE;
                let (_, cy) = row.center();
                parts.push(Part::Glyph {
                    rect: Rect::new(x, cy - size / 2.0, size, size),
                    glyph: Glyph::Symbol(icon.clone()),
                    tint: pick(
                        state.disabled,
                        Tint::solid(mn::LIST_ITEM_LEADING_ICON_COLOR),
                        Tint::with(
                            mn::LIST_ITEM_WITH_LEADING_ICON_DISABLED_LEADING_ICON_COLOR,
                            mn::LIST_ITEM_DISABLED_LABEL_TEXT_OPACITY,
                        ),
                    ),
                });
                x += size + MENU_ITEM_INSET;
            }
            parts.push(label(
                row,
                x,
                &entry.label,
                mn::LIST_ITEM_LABEL_TEXT_SIZE,
                text,
            ));
            parts.extend(focus_ring(
                row,
                Radii::default(),
                FOCUS_ROLE,
                mn::FOCUS_INDICATOR_OUTLINE_OFFSET,
                state,
            ));
        }
        parts
    }
}
