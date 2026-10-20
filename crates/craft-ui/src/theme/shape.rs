// SPDX-License-Identifier: Apache-2.0
//! Canonical M3 corner roles for Craft application chrome.

use egui::{CornerRadius, Visuals};

/// Small M3 corner for interactive controls.
pub const CONTROL: CornerRadius = CornerRadius::same(aphrody_m3_tokens::shape::SMALL.dp as u8);
/// Extra-small M3 corner for menus and compact popovers.
pub const MENU: CornerRadius = CornerRadius::same(aphrody_m3_tokens::shape::EXTRA_SMALL.dp as u8);
/// Medium M3 corner for application windows and dialogs.
pub const WINDOW: CornerRadius = CornerRadius::same(aphrody_m3_tokens::shape::MEDIUM.dp as u8);

/// Apply the M3 control corner to every egui widget interaction state.
pub fn apply_control_to_visuals(visuals: &mut Visuals) {
    for widget in [
        &mut visuals.widgets.noninteractive,
        &mut visuals.widgets.inactive,
        &mut visuals.widgets.hovered,
        &mut visuals.widgets.active,
        &mut visuals.widgets.open,
    ] {
        widget.corner_radius = CONTROL;
    }
}
