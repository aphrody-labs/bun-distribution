// SPDX-License-Identifier: Apache-2.0

use aphrody_m3_tokens::component as tokens;
use aphrody_m3_tokens::scheme::Role;

use super::*;
use crate::a11y::AccessRole;
use crate::interaction::StateLayer;
use crate::visual::{Glyph, Radii, Tint};

fn surfaces(parts: &[Part]) -> Vec<(Rect, Radii, Option<Tint>, u8)> {
    parts
        .iter()
        .filter_map(|part| match part {
            Part::Surface {
                rect,
                radii,
                fill,
                elevation,
                ..
            } => Some((*rect, *radii, *fill, *elevation)),
            _ => None,
        })
        .collect()
}

fn has_focus_ring(parts: &[Part]) -> bool {
    parts.iter().any(|part| matches!(part, Part::FocusRing { thickness, .. } if *thickness == tokens::focus_indicator::THICKNESS))
}

fn layer(parts: &[Part]) -> Option<(Role, StateLayer)> {
    parts.iter().find_map(|part| match part {
        Part::StateLayer { role, layer, .. } => Some((*role, *layer)),
        _ => None,
    })
}

fn every_control() -> Vec<Box<dyn Control>> {
    let mut chip_input = Chip::new(ChipKind::Input, "Ada");
    chip_input.selected = true;
    let mut group = ButtonGroup::new(
        ButtonGroupKind::Connected,
        "View",
        &["Day", "Week", "Month"],
    );
    group.single_select = true;
    vec![
        Box::new(Checkbox::new("Accept")),
        Box::new(Switch::new("Wi-Fi")),
        Box::new(RadioGroup::new("Size", &["S", "M", "L"])),
        Box::new(Chip::new(ChipKind::Assist, "Directions")),
        Box::new(Chip::new(ChipKind::Filter, "Open now")),
        Box::new(chip_input),
        Box::new(Chip::new(ChipKind::Suggestion, "Reply")),
        Box::new(Card::new(CardKind::Outlined, "Trip")),
        Box::new(IconButton::new(
            IconButtonKind::Tonal,
            "favorite",
            "Favourite",
        )),
        Box::new(Fab::new("edit", "Compose")),
        Box::new(Slider::new("Volume", 0.0, 10.0, 4.0)),
        Box::new(Tabs::new(&["Flights", "Hotels"])),
        Box::new(NavigationBar::new(&[
            ("Home", "home"),
            ("Search", "search"),
        ])),
        Box::new(Dialog::new(
            "Discard draft?",
            "The draft will be lost.",
            &["Cancel", "Discard"],
        )),
        Box::new(Menu::new("More", &["Copy", "Cut", "Paste"])),
        Box::new(group),
        Box::new(SplitButton::new("Send", "More send options")),
        Box::new(LoadingIndicator::new("Loading")),
    ]
}

#[test]
fn every_control_exposes_a_valid_accessibility_tree() {
    for control in every_control() {
        let node = control.accessible();
        assert_eq!(node.validate(), Ok(()), "{node:?}");
        assert!(
            node.aria_attributes()
                .iter()
                .any(|(name, _)| *name == "role")
        );
    }
}

#[test]
fn interactive_targets_meet_the_minimum_size() {
    let min = crate::accessibility::MIN_TARGET_DP as f32;
    for control in every_control() {
        let role = control.accessible().role;
        if matches!(
            role,
            AccessRole::Checkbox | AccessRole::Switch | AccessRole::Button
        ) {
            let (w, h) = control.target();
            assert!(w >= min && h >= min, "{role:?} target {w}x{h}");
        }
    }
}

#[test]
fn disabled_controls_draw_no_state_layer_and_ignore_keys() {
    let mut checkbox = Checkbox::new("Accept");
    checkbox.enabled = false;
    assert_eq!(checkbox.handle_key(Key::Space), None);
    let parts = checkbox.parts(Rect::new(0.0, 0.0, 48.0, 48.0), Interaction::HOVERED);
    assert!(layer(&parts).is_none());
    assert_eq!(
        checkbox.accessible().aria_attributes().last(),
        Some(&("tabindex", "-1".into()))
    );
}

#[test]
fn checkbox_cycles_and_paints_tokens() {
    let mut checkbox = Checkbox::new("Accept");
    checkbox.state = CheckState::Indeterminate;
    assert_eq!(
        checkbox.handle_key(Key::Space),
        Some(Event::Checked(CheckState::Checked))
    );
    assert_eq!(checkbox.handle_key(Key::Enter), None);
    let parts = checkbox.parts(Rect::new(0.0, 0.0, 48.0, 48.0), Interaction::FOCUSED);
    let (rect, radii, fill, _) = surfaces(&parts)[0];
    assert_eq!(
        (rect.w, radii.tl),
        (
            tokens::checkbox::CONTAINER_SIZE,
            tokens::checkbox::CONTAINER_SHAPE
        )
    );
    assert_eq!(fill, Some(Tint::solid(Role::Primary)));
    assert!(parts.iter().any(|part| matches!(part, Part::Glyph { glyph: Glyph::Check, tint, .. } if tint.role == Role::OnPrimary)));
    assert_eq!(
        layer(&parts),
        Some((
            tokens::checkbox::SELECTED_FOCUS_STATE_LAYER_COLOR,
            StateLayer::Focus
        ))
    );
    assert!(has_focus_ring(&parts));
    checkbox.state = CheckState::Unchecked;
    let pressed = checkbox.parts(Rect::new(0.0, 0.0, 48.0, 48.0), Interaction::PRESSED);
    assert_eq!(layer(&pressed), Some((Role::Primary, StateLayer::Pressed)));
}

#[test]
fn switch_handle_grows_with_state() {
    let mut toggle = Switch::new("Wi-Fi");
    let rect = Rect::new(0.0, 0.0, 52.0, 32.0);
    let handle = |toggle: &Switch, interaction| {
        surfaces(&toggle.parts(rect, interaction))
            .last()
            .unwrap()
            .0
            .w
    };
    assert_eq!(
        handle(&toggle, Interaction::IDLE),
        tokens::switch::UNSELECTED_HANDLE_WIDTH
    );
    assert_eq!(toggle.handle_key(Key::Enter), Some(Event::Toggled(true)));
    assert_eq!(
        handle(&toggle, Interaction::IDLE),
        tokens::switch::SELECTED_HANDLE_WIDTH
    );
    assert_eq!(
        handle(&toggle, Interaction::PRESSED),
        tokens::switch::PRESSED_HANDLE_WIDTH
    );
    assert_eq!(
        surfaces(&toggle.parts(rect, Interaction::IDLE))
            .last()
            .unwrap()
            .3,
        tokens::switch::HANDLE_ELEVATION
    );
}

#[test]
fn radio_group_arrows_move_selection_and_skip_disabled() {
    let mut group = RadioGroup::new("Size", &["S", "M", "L"]);
    group.options[1].enabled = false;
    assert_eq!(group.handle_key(Key::ArrowDown), Some(Event::Selected(2)));
    assert_eq!(group.handle_key(Key::ArrowRight), Some(Event::Selected(0)));
    let node = group.accessible();
    assert_eq!(
        node.children.iter().filter(|child| child.focusable).count(),
        1
    );
    let parts = group.parts(Rect::new(0.0, 0.0, 48.0, 144.0), Interaction::IDLE);
    let dots: Vec<_> = surfaces(&parts)
        .into_iter()
        .filter(|(_, _, fill, _)| fill.is_some())
        .collect();
    assert_eq!(dots.len(), 1);
    assert_eq!(dots[0].0.center(), (24.0, 24.0));
}

#[test]
fn chips_follow_their_family() {
    let mut filter = Chip::new(ChipKind::Filter, "Open now");
    assert_eq!(filter.handle_key(Key::Space), Some(Event::Toggled(true)));
    let parts = filter.parts(Rect::new(0.0, 0.0, 120.0, 48.0), Interaction::IDLE);
    let (rect, radii, fill, _) = surfaces(&parts)[0];
    assert_eq!(rect.h, tokens::filter_chip::CONTAINER_HEIGHT);
    assert_eq!(radii.tl, f32::from(tokens::filter_chip::CONTAINER_SHAPE.dp));
    assert_eq!(fill, Some(Tint::solid(Role::SecondaryContainer)));
    assert!(parts.iter().any(|part| matches!(
        part,
        Part::Glyph {
            glyph: Glyph::Check,
            ..
        }
    )));
    let mut input = Chip::new(ChipKind::Input, "Ada");
    assert_eq!(input.handle_key(Key::Backspace), Some(Event::Removed));
    let mut assist = Chip::new(ChipKind::Assist, "Directions");
    assist.elevated = true;
    let hovered =
        surfaces(&assist.parts(Rect::new(0.0, 0.0, 0.0, 32.0), Interaction::HOVERED))[0].3;
    assert_eq!(
        hovered,
        tokens::assist_chip::ELEVATED_HOVER_CONTAINER_ELEVATION
    );
}

#[test]
fn cards_raise_on_hover_only_when_interactive() {
    let mut card = Card::new(CardKind::Elevated, "Trip");
    let rect = Rect::new(0.0, 0.0, 200.0, 120.0);
    assert_eq!(
        surfaces(&card.parts(rect, Interaction::HOVERED))[0].3,
        tokens::elevated_card::CONTAINER_ELEVATION
    );
    assert_eq!(card.handle_key(Key::Enter), None);
    card.interactive = true;
    assert_eq!(
        surfaces(&card.parts(rect, Interaction::HOVERED))[0].3,
        tokens::elevated_card::HOVER_CONTAINER_ELEVATION
    );
    assert_eq!(card.handle_key(Key::Enter), Some(Event::Activated));
    assert_eq!(card.accessible().role, AccessRole::Button);
}

#[test]
fn icon_button_morphs_shape_and_toggles() {
    let mut button = IconButton::new(IconButtonKind::Filled, "favorite", "Favourite");
    button.toggle = Some(false);
    let rect = Rect::new(0.0, 0.0, 48.0, 48.0);
    let first = |button: &IconButton, i| surfaces(&button.parts(rect, i))[0];
    assert_eq!(first(&button, Interaction::IDLE).1.tl, 20.0);
    assert_eq!(
        first(&button, Interaction::IDLE).2,
        Some(Tint::solid(
            tokens::icon_button_filled::UNSELECTED_CONTAINER_COLOR
        ))
    );
    assert_eq!(
        first(&button, Interaction::PRESSED).1.tl,
        f32::from(tokens::icon_button_small::PRESSED_CONTAINER_SHAPE.dp)
    );
    assert_eq!(button.handle_key(Key::Space), Some(Event::Toggled(true)));
    assert_eq!(
        first(&button, Interaction::IDLE).1.tl,
        f32::from(tokens::icon_button_small::SELECTED_CONTAINER_SHAPE_ROUND.dp)
    );
    assert_eq!(button.accessible().pressed, Some(true));
    let hovered = button.parts(rect, Interaction::HOVERED);
    assert_eq!(
        layer(&hovered),
        Some((
            tokens::icon_button_filled::SELECTED_ICON_COLOR,
            StateLayer::Hover
        ))
    );
}

#[test]
fn fab_elevation_tracks_hover() {
    let fab = Fab {
        size: FabSize::Large,
        ..Fab::new("edit", "Compose")
    };
    assert_eq!(
        fab.size(),
        (
            tokens::fab_large::CONTAINER_WIDTH,
            tokens::fab_large::CONTAINER_HEIGHT
        )
    );
    let rect = Rect::new(0.0, 0.0, 96.0, 96.0);
    assert_eq!(
        surfaces(&fab.parts(rect, Interaction::IDLE))[0].3,
        tokens::fab_primary_container::CONTAINER_ELEVATION
    );
    assert_eq!(
        surfaces(&fab.parts(rect, Interaction::HOVERED))[0].3,
        tokens::fab_primary_container::HOVERED_CONTAINER_ELEVATION
    );
}

#[test]
fn slider_keyboard_follows_the_aria_pattern() {
    let mut slider = Slider::new("Volume", 0.0, 10.0, 4.0);
    slider.step = Some(1.0);
    assert_eq!(
        slider.handle_key(Key::ArrowRight),
        Some(Event::ValueChanged(5.0))
    );
    assert_eq!(
        slider.handle_key(Key::PageUp),
        Some(Event::ValueChanged(10.0))
    );
    assert_eq!(slider.handle_key(Key::ArrowUp), None);
    assert_eq!(slider.handle_key(Key::Home), Some(Event::ValueChanged(0.0)));
    slider.rtl = true;
    assert_eq!(
        slider.handle_key(Key::ArrowLeft),
        Some(Event::ValueChanged(1.0))
    );
    slider.value = 5.0;
    slider.rtl = false;
    let rect = Rect::new(0.0, 0.0, 200.0, 44.0);
    let handle_w = |i| {
        surfaces(&slider.parts(rect, i))
            .into_iter()
            .find(|s| s.0.h == tokens::slider::HANDLE_HEIGHT)
            .unwrap()
            .0
            .w
    };
    assert_eq!(handle_w(Interaction::IDLE), tokens::slider::HANDLE_WIDTH);
    assert_eq!(
        handle_w(Interaction::PRESSED),
        tokens::slider::PRESSED_HANDLE_WIDTH
    );
    let tracks = surfaces(&slider.parts(rect, Interaction::IDLE));
    assert_eq!(
        tracks[0].0.w,
        100.0 - tokens::slider::ACTIVE_HANDLE_PADDING - tokens::slider::HANDLE_WIDTH / 2.0
    );
    assert_eq!(
        tracks[0].2,
        Some(Tint::solid(tokens::slider::ACTIVE_TRACK_COLOR))
    );
}

#[test]
fn tabs_use_manual_activation_and_equal_cells() {
    let mut tabs = Tabs::new(&["Flights", "Hotels", "Cars"]);
    assert_eq!(tabs.handle_key(Key::ArrowRight), Some(Event::Focused(1)));
    assert_eq!(tabs.accessible().children[0].selected, Some(true));
    assert_eq!(tabs.handle_key(Key::Enter), Some(Event::Selected(1)));
    let parts = tabs.parts(Rect::new(0.0, 0.0, 300.0, 48.0), Interaction::IDLE);
    let indicator = surfaces(&parts)
        .into_iter()
        .find(|s| s.0.h == tokens::primary_navigation_tab::ACTIVE_INDICATOR_HEIGHT)
        .unwrap();
    assert_eq!(indicator.0.center().0, 150.0);
}

#[test]
fn navigation_bar_marks_the_current_destination() {
    let mut bar = NavigationBar::new(&[("Home", "home"), ("Search", "search")]);
    assert_eq!(bar.handle_key(Key::End), Some(Event::Focused(1)));
    assert_eq!(bar.handle_key(Key::Space), Some(Event::Selected(1)));
    assert!(bar.accessible().children[1].current);
    let parts = bar.parts(Rect::new(0.0, 0.0, 200.0, 64.0), Interaction::IDLE);
    let indicator = surfaces(&parts)
        .into_iter()
        .find(|s| s.2 == Some(Tint::solid(tokens::nav_bar::ITEM_ACTIVE_INDICATOR_COLOR)))
        .unwrap();
    assert_eq!(
        (indicator.0.w, indicator.0.center().0),
        (tokens::nav_bar_item_vertical::ACTIVE_INDICATOR_WIDTH, 150.0)
    );
}

#[test]
fn dialog_traps_focus_and_closes_on_escape() {
    let mut dialog = Dialog::new(
        "Discard draft?",
        "The draft will be lost.",
        &["Cancel", "Discard"],
    );
    assert_eq!(dialog.focused(), Some(0));
    assert_eq!(dialog.handle_key(Key::Tab), Some(Event::Focused(1)));
    assert_eq!(dialog.handle_key(Key::Tab), Some(Event::Focused(0)));
    assert!(dialog.accessible().modal);
    let (w, h) = dialog.size();
    let parts = dialog.parts(Rect::new(0.0, 0.0, 800.0, 600.0), Interaction::FOCUSED);
    let (rect, radii, _, elevation) = surfaces(&parts)[0];
    assert_eq!((rect.w, rect.h, rect.center()), (w, h, (400.0, 300.0)));
    assert_eq!(
        (radii.tl, elevation),
        (
            f32::from(tokens::dialog::CONTAINER_SHAPE.dp),
            tokens::dialog::CONTAINER_ELEVATION
        )
    );
    let labels: Vec<Rect> = parts
        .iter()
        .filter_map(|p| match p {
            Part::Label { rect, .. } => Some(*rect),
            _ => None,
        })
        .collect();
    assert!(
        labels[0].y < labels[1].y && labels[1].y < labels[2].y,
        "headline, supporting, actions stack"
    );
    assert!(labels[3].x > labels[2].x, "actions are laid out in a row");
    assert!(has_focus_ring(&parts));
    assert_eq!(dialog.handle_key(Key::Escape), Some(Event::Dismissed));
    assert!(
        dialog
            .parts(Rect::new(0.0, 0.0, 800.0, 600.0), Interaction::IDLE)
            .is_empty()
    );
}

#[test]
fn menu_supports_arrows_type_ahead_and_escape() {
    let mut menu = Menu::new("More", &["Copy", "Cut", "Paste"]);
    menu.items[1].enabled = false;
    assert_eq!(menu.handle_key(Key::ArrowDown), Some(Event::Opened));
    assert_eq!(menu.focused, Some(0));
    assert_eq!(menu.trigger().expanded, Some(true));
    assert_eq!(menu.handle_key(Key::ArrowDown), Some(Event::Focused(2)));
    assert_eq!(menu.handle_key(Key::Char('c')), Some(Event::Focused(0)));
    assert_eq!(menu.handle_key(Key::Enter), Some(Event::Action(0)));
    assert!(!menu.open);
    menu.handle_key(Key::Enter);
    let parts = menu.parts(Rect::new(0.0, 0.0, 0.0, 0.0), Interaction::FOCUSED);
    assert_eq!(surfaces(&parts)[0].3, tokens::menu::CONTAINER_ELEVATION);
    assert_eq!(menu.handle_key(Key::Escape), Some(Event::Dismissed));
}

#[test]
fn connected_button_group_shapes_inner_corners() {
    let mut group = ButtonGroup::new(
        ButtonGroupKind::Connected,
        "View",
        &["Day", "Week", "Month"],
    );
    let outer = tokens::button_group_connected_small::CONTAINER_HEIGHT / 2.0;
    let inner = f32::from(tokens::button_group_connected_small::INNER_CORNER_SIZE.dp);
    assert_eq!(group.radii(0), Radii::leading(outer, inner));
    assert_eq!(group.radii(1), Radii::all(inner));
    assert_eq!(group.radii(2), Radii::trailing(outer, inner));
    group.single_select = true;
    group.focused = 1;
    assert_eq!(group.handle_key(Key::Space), Some(Event::Selected(1)));
    assert_eq!(group.radii(1), Radii::all(outer));
    let rects = group.item_rects(Rect::new(0.0, 0.0, 400.0, 40.0));
    assert_eq!(
        rects[1].x - (rects[0].x + rects[0].w),
        tokens::button_group_connected_small::BETWEEN_SPACE
    );
}

#[test]
fn standard_button_group_widens_the_pressed_item() {
    let mut group = ButtonGroup::new(
        ButtonGroupKind::Standard,
        "Edit",
        &["Bold", "Italic", "Underline"],
    );
    let before = group.widths();
    group.pressed = Some(1);
    let after = group.widths();
    let grow =
        before[1] * tokens::button_group_standard_small::PRESSED_ITEM_WIDTH_MULTIPLIER / 100.0;
    assert!((after[1] - before[1] - grow).abs() < 1e-4);
    assert!((after.iter().sum::<f32>() - before.iter().sum::<f32>()).abs() < 1e-3);
}

#[test]
fn split_button_opens_its_menu_from_the_trailing_segment() {
    let mut split = SplitButton::new("Send", "More send options");
    assert_eq!(split.handle_key(Key::Enter), Some(Event::Activated));
    split.trailing_focused = true;
    assert_eq!(split.handle_key(Key::ArrowDown), Some(Event::Opened));
    assert_eq!(split.accessible().children[1].expanded, Some(true));
    let height = tokens::split_button_small::CONTAINER_HEIGHT;
    assert_eq!(split.inner_radius(true, Interaction::IDLE), height / 2.0);
    assert_eq!(
        split.inner_radius(false, Interaction::HOVERED),
        f32::from(tokens::split_button_small::INNER_CORNER_HOVERED_SIZE.dp)
    );
    assert_eq!(split.handle_key(Key::Escape), Some(Event::Dismissed));
}

#[test]
fn loading_indicator_is_a_busy_progressbar() {
    let indicator = LoadingIndicator {
        contained: true,
        ..LoadingIndicator::new("Loading")
    };
    let node = indicator.accessible();
    assert!(node.busy && !node.focusable);
    let parts = indicator.parts(Rect::new(0.0, 0.0, 48.0, 48.0), Interaction::IDLE);
    let found = surfaces(&parts);
    assert_eq!(
        found[0].2,
        Some(Tint::solid(
            tokens::loading_indicator::CONTAINED_CONTAINER_COLOR
        ))
    );
    assert_eq!(
        found[1].0.w,
        tokens::loading_indicator::ACTIVE_INDICATOR_SIZE
    );
}
