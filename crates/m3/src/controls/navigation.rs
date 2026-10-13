// SPDX-License-Identifier: Apache-2.0
//! Primary tabs and the navigation bar.

use aphrody_m3_tokens::component::{
    nav_bar as bar, nav_bar_item_vertical as item, primary_navigation_tab as tab,
};
use serde::{Deserialize, Serialize};

use super::{Control, Event};
use crate::a11y::{AccessRole, Accessible};
use crate::interaction::Interaction;
use crate::keyboard::{Key, Orientation, roving};
use crate::layout::{Flex, LayoutTree};
use crate::visual::{
    FOCUS_ROLE, Glyph, Part, Radii, Rect, Tint, estimate_text_width, focus_ring, pick, state_layer,
    type_style,
};

/// Top corners of the primary tab indicator: Google publishes
/// `md.comp.primary-navigation-tab.active-indicator.shape: 3px 3px 0px 0px`, a per-corner value
/// the typed tables do not carry.
const TAB_INDICATOR_RADIUS: f32 = 3.0;
/// Horizontal padding of a tab (material-web `tabs/internal/_tab.scss`).
const TAB_PADDING: f32 = 16.0;
/// Minimum primary-tab indicator width (material-web `tabs/internal/_tab.scss`).
const TAB_INDICATOR_MIN_WIDTH: f32 = 24.0;
/// Navigation bar label style; the nav-bar token tables do not republish it (Compose
/// `NavigationBarTokens.LabelTextFont` is `LabelMedium`).
const NAV_LABEL_STYLE: &str = "label-medium";
/// Disabled content opacity shared by M3 components (`md.sys.state` disabled content).
const DISABLED_CONTENT_OPACITY: f32 =
    aphrody_m3_tokens::component::radio_button::DISABLED_UNSELECTED_ICON_OPACITY;

fn equal_cells(count: usize, rect: Rect) -> Vec<Rect> {
    let mut tree = LayoutTree::new();
    let leaves: Vec<_> = (0..count)
        .map(|_| tree.sized_leaf(0.0, rect.h, 1.0))
        .collect();
    let root = tree.flex(Flex::row().width(rect.w).height(rect.h), &leaves);
    if tree.compute(root, rect.w, rect.h).is_err() {
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

/// One tab.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Tab {
    /// Label.
    pub label: String,
    /// Material Symbol above the label.
    pub icon: Option<String>,
    /// Whether the tab can be chosen.
    pub enabled: bool,
}

/// Fixed primary tabs (equal widths) with manual activation.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Tabs {
    /// Tabs.
    pub tabs: Vec<Tab>,
    /// Selected tab.
    pub selected: usize,
    /// Tab holding the roving focus.
    pub focused: usize,
    /// Right-to-left.
    pub rtl: bool,
}

impl Tabs {
    /// Enabled tabs with the first selected.
    #[must_use]
    pub fn new(labels: &[&str]) -> Self {
        Self {
            tabs: labels
                .iter()
                .map(|label| Tab {
                    label: (*label).into(),
                    icon: None,
                    enabled: true,
                })
                .collect(),
            selected: 0,
            focused: 0,
            rtl: false,
        }
    }

    fn height(&self) -> f32 {
        let with_icons = self.tabs.iter().any(|tab| tab.icon.is_some());
        if with_icons {
            tab::WITH_ICON_AND_LABEL_TEXT_CONTAINER_HEIGHT
        } else {
            tab::CONTAINER_HEIGHT
        }
    }
}

impl Control for Tabs {
    fn accessible(&self) -> Accessible {
        let mut list = Accessible::new(AccessRole::TabList, "");
        list.focusable = false;
        list.orientation = Some(Orientation::Horizontal);
        list.children = self
            .tabs
            .iter()
            .enumerate()
            .map(|(index, entry)| {
                let mut node = Accessible::new(AccessRole::Tab, &entry.label);
                node.selected = Some(index == self.selected);
                node.focusable = index == self.focused;
                node.disabled = !entry.enabled;
                node
            })
            .collect();
        list
    }

    fn handle_key(&mut self, key: Key) -> Option<Event> {
        if key.activates() {
            let enabled = self
                .tabs
                .get(self.focused)
                .is_some_and(|entry| entry.enabled);
            return (enabled && self.selected != self.focused).then(|| {
                self.selected = self.focused;
                Event::Selected(self.selected)
            });
        }
        let enabled: Vec<bool> = self.tabs.iter().map(|entry| entry.enabled).collect();
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
        let style = tab::LABEL_TEXT_SIZE;
        let widest = self
            .tabs
            .iter()
            .map(|entry| estimate_text_width(&entry.label, style))
            .fold(0.0, f32::max);
        let cell = widest + 2.0 * TAB_PADDING;
        (cell * self.tabs.len() as f32, self.height())
    }

    fn parts(&self, rect: Rect, interaction: Interaction) -> Vec<Part> {
        let height = self.height();
        let bar_rect = Rect::new(rect.x, rect.y, rect.w, height);
        let mut parts = vec![Part::Surface {
            rect: bar_rect,
            radii: Radii::shape(tab::CONTAINER_SHAPE, rect.w, height),
            fill: Some(Tint::solid(tab::CONTAINER_COLOR)),
            outline: None,
            elevation: 0,
        }];
        parts.push(Part::Surface {
            rect: Rect::new(
                rect.x,
                rect.y + height - tab::DIVIDER_HEIGHT,
                rect.w,
                tab::DIVIDER_HEIGHT,
            ),
            radii: Radii::default(),
            fill: Some(Tint::solid(tab::DIVIDER_COLOR)),
            outline: None,
            elevation: 0,
        });
        let style = tab::LABEL_TEXT_SIZE;
        let line = type_style(style).map_or(0.0, |s| s.line_height_dp);
        for (index, cell) in equal_cells(self.tabs.len(), bar_rect)
            .into_iter()
            .enumerate()
        {
            let entry = &self.tabs[index];
            let active = index == self.selected;
            let state = if index == self.focused {
                interaction
            } else {
                Interaction::IDLE
            }
            .with_disabled(!entry.enabled);
            let layer_role = match (active, state.pressed) {
                (true, _) => tab::ACTIVE_HOVER_STATE_LAYER_COLOR,
                (false, true) => tab::INACTIVE_PRESSED_STATE_LAYER_COLOR,
                (false, false) => tab::INACTIVE_HOVER_STATE_LAYER_COLOR,
            };
            parts.extend(state_layer(cell, Radii::default(), layer_role, state));
            let text_role = if active {
                tab::ACTIVE_LABEL_TEXT_COLOR
            } else {
                tab::INACTIVE_LABEL_TEXT_COLOR
            };
            let text_tint = pick(
                state.disabled,
                Tint::solid(text_role),
                Tint::with(text_role, DISABLED_CONTENT_OPACITY),
            );
            let text_w = estimate_text_width(&entry.label, style).min(cell.w);
            let (cx, cy) = cell.center();
            let content_h = line
                + if entry.icon.is_some() {
                    tab::WITH_ICON_ICON_SIZE
                } else {
                    0.0
                };
            let mut top = cy - content_h / 2.0;
            if let Some(icon) = &entry.icon {
                let icon_role = if active {
                    tab::WITH_ICON_ACTIVE_ICON_COLOR
                } else {
                    tab::WITH_ICON_INACTIVE_ICON_COLOR
                };
                let size = tab::WITH_ICON_ICON_SIZE;
                parts.push(Part::Glyph {
                    rect: Rect::new(cx - size / 2.0, top, size, size),
                    glyph: Glyph::Symbol(icon.clone()),
                    tint: pick(
                        state.disabled,
                        Tint::solid(icon_role),
                        Tint::with(icon_role, DISABLED_CONTENT_OPACITY),
                    ),
                });
                top += size;
            }
            parts.push(Part::Label {
                rect: Rect::new(cx - text_w / 2.0, top, text_w, line),
                text: entry.label.clone(),
                style: style.into(),
                tint: text_tint,
            });
            if active {
                let w = text_w.max(TAB_INDICATOR_MIN_WIDTH);
                let h = tab::ACTIVE_INDICATOR_HEIGHT;
                parts.push(Part::Surface {
                    rect: Rect::new(cx - w / 2.0, cell.y + cell.h - h, w, h),
                    radii: Radii {
                        tl: TAB_INDICATOR_RADIUS,
                        tr: TAB_INDICATOR_RADIUS,
                        br: 0.0,
                        bl: 0.0,
                    },
                    fill: Some(Tint::solid(tab::ACTIVE_INDICATOR_COLOR)),
                    outline: None,
                    elevation: 0,
                });
            }
            parts.extend(focus_ring(
                cell,
                Radii::default(),
                tab::FOCUS_INDICATOR_COLOR,
                tab::FOCUS_INDICATOR_OUTLINE_OFFSET,
                state,
            ));
        }
        parts
    }
}

/// One navigation destination.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct NavigationItem {
    /// Label.
    pub label: String,
    /// Material Symbol.
    pub icon: String,
}

/// Navigation bar with vertical items (icon over label).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct NavigationBar {
    /// Destinations.
    pub items: Vec<NavigationItem>,
    /// Current destination.
    pub selected: usize,
    /// Destination holding the roving focus.
    pub focused: usize,
    /// Right-to-left.
    pub rtl: bool,
}

impl NavigationBar {
    /// A bar with the first destination current.
    #[must_use]
    pub fn new(items: &[(&str, &str)]) -> Self {
        Self {
            items: items
                .iter()
                .map(|(label, icon)| NavigationItem {
                    label: (*label).into(),
                    icon: (*icon).into(),
                })
                .collect(),
            selected: 0,
            focused: 0,
            rtl: false,
        }
    }
}

impl Control for NavigationBar {
    fn accessible(&self) -> Accessible {
        let mut nav = Accessible::new(AccessRole::Navigation, "");
        nav.focusable = false;
        nav.children = self
            .items
            .iter()
            .enumerate()
            .map(|(index, entry)| {
                let mut node = Accessible::new(AccessRole::Link, &entry.label);
                node.current = index == self.selected;
                node.focusable = index == self.focused;
                node
            })
            .collect();
        nav
    }

    fn handle_key(&mut self, key: Key) -> Option<Event> {
        if key.activates() {
            self.selected = self.focused;
            return Some(Event::Selected(self.selected));
        }
        let next = roving(
            self.focused,
            &vec![true; self.items.len()],
            key,
            Orientation::Horizontal,
            self.rtl,
        )?;
        self.focused = next;
        Some(Event::Focused(next))
    }

    fn size(&self) -> (f32, f32) {
        (
            item::ACTIVE_INDICATOR_WIDTH * self.items.len() as f32,
            bar::CONTAINER_HEIGHT,
        )
    }

    fn parts(&self, rect: Rect, interaction: Interaction) -> Vec<Part> {
        let bar_rect = Rect::new(rect.x, rect.y, rect.w, bar::CONTAINER_HEIGHT);
        let mut parts = vec![Part::Surface {
            rect: bar_rect,
            radii: Radii::shape(bar::CONTAINER_SHAPE, rect.w, bar_rect.h),
            fill: Some(Tint::solid(bar::CONTAINER_COLOR)),
            outline: None,
            elevation: bar::CONTAINER_ELEVATION,
        }];
        let line = type_style(NAV_LABEL_STYLE).map_or(0.0, |s| s.line_height_dp);
        let content_h =
            item::ACTIVE_INDICATOR_HEIGHT + item::ACTIVE_INDICATOR_ICON_LABEL_SPACE + line;
        for (index, cell) in equal_cells(self.items.len(), bar_rect)
            .into_iter()
            .enumerate()
        {
            let entry = &self.items[index];
            let active = index == self.selected;
            let state = if index == self.focused {
                interaction
            } else {
                Interaction::IDLE
            };
            let (cx, cy) = cell.center();
            let top = cy - content_h / 2.0;
            let indicator = Rect::new(
                cx - item::ACTIVE_INDICATOR_WIDTH / 2.0,
                top,
                item::ACTIVE_INDICATOR_WIDTH,
                item::ACTIVE_INDICATOR_HEIGHT,
            );
            let radii = Radii::shape(bar::ITEM_ACTIVE_INDICATOR_SHAPE, indicator.w, indicator.h);
            if active {
                parts.push(Part::Surface {
                    rect: indicator,
                    radii,
                    fill: Some(Tint::solid(bar::ITEM_ACTIVE_INDICATOR_COLOR)),
                    outline: None,
                    elevation: 0,
                });
            }
            let layer = if active {
                bar::ITEM_ACTIVE_HOVERED_STATE_LAYER_COLOR
            } else {
                bar::ITEM_INACTIVE_HOVERED_STATE_LAYER_COLOR
            };
            parts.extend(state_layer(indicator, radii, layer, state));
            let icon_role = if active {
                bar::ITEM_ACTIVE_ICON_COLOR
            } else {
                bar::ITEM_INACTIVE_ICON_COLOR
            };
            parts.push(Part::Glyph {
                rect: Rect::centered(
                    cx,
                    indicator.y + indicator.h / 2.0,
                    bar::ITEM_ICON_SIZE,
                    bar::ITEM_ICON_SIZE,
                ),
                glyph: Glyph::Symbol(entry.icon.clone()),
                tint: Tint::solid(icon_role),
            });
            let text_w = estimate_text_width(&entry.label, NAV_LABEL_STYLE).min(cell.w);
            let text_role = if active {
                bar::ITEM_ACTIVE_LABEL_TEXT_COLOR
            } else {
                bar::ITEM_INACTIVE_LABEL_TEXT_COLOR
            };
            parts.push(Part::Label {
                rect: Rect::new(
                    cx - text_w / 2.0,
                    indicator.y + indicator.h + item::ACTIVE_INDICATOR_ICON_LABEL_SPACE,
                    text_w,
                    line,
                ),
                text: entry.label.clone(),
                style: NAV_LABEL_STYLE.into(),
                tint: Tint::solid(text_role),
            });
            parts.extend(focus_ring(
                indicator,
                radii,
                FOCUS_ROLE,
                aphrody_m3_tokens::component::focus_indicator::OUTER_OFFSET,
                state,
            ));
        }
        parts
    }
}
