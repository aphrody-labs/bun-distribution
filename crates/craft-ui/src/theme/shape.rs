// SPDX-License-Identifier: Apache-2.0
//! Canonical M3 corner roles for Craft application chrome.

use egui::CornerRadius;

/// Small M3 corner for interactive controls.
pub const CONTROL: CornerRadius = CornerRadius::same(aphrody_m3_tokens::shape::SMALL.dp as u8);
/// Extra-small M3 corner for menus and compact popovers.
pub const MENU: CornerRadius = CornerRadius::same(aphrody_m3_tokens::shape::EXTRA_SMALL.dp as u8);
/// Medium M3 corner for application windows and dialogs.
pub const WINDOW: CornerRadius = CornerRadius::same(aphrody_m3_tokens::shape::MEDIUM.dp as u8);
