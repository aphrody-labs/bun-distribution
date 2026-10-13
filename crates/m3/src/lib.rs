// SPDX-License-Identifier: Apache-2.0
//! Rust-native Material 3 contracts shared by Aphrody's native and web hosts.
//!
//! This crate is the Rust counterpart to the TypeScript M3 packages. It reuses
//! the canonical token tables, Taffy layout engine and native renderer instead
//! of defining parallel design values. Browser hosts can compile the contracts
//! with `--no-default-features --features wasm`; that feature is a target marker
//! and does not pull native rendering into a WASM client.

#![deny(missing_docs)]

/// Accessibility tree, WAI-ARIA roles and states.
pub mod a11y;
/// Semantic component contracts and validation rules.
pub mod components;
/// Material 3 components with state, keyboard, accessibility and token-driven visuals.
pub mod controls;
/// Tab order and modal focus traps.
pub mod focus;
/// Form field contracts and validation.
pub mod forms;
/// Icon selection and variable-font settings.
pub mod icons;
/// Hover, focus, pressed, dragged and disabled states with their state layers.
pub mod interaction;
/// Logical keys, roving focus and type-ahead.
pub mod keyboard;
/// Taffy-backed layout utilities.
pub mod layout;
/// Motion curves and spring state from the canonical M3 token crate.
pub mod motion;
/// Part-to-scene conversion for the native renderers.
#[cfg(feature = "native-render")]
pub mod paint;
/// The canonical design-token and theme contract.
pub mod theme;
/// Host-neutral paint parts (surfaces, state layers, focus rings, glyphs, labels).
pub mod visual;

pub use aphrody_m3_tokens::facade;
/// CPU/native rendering primitives shared with Aphrody render hosts.
#[cfg(feature = "native-render")]
pub use aphrody_render as native_renderer;

/// Accessibility constants shared by component hosts.
pub mod accessibility {
    /// Minimum pointer target size in density-independent pixels.
    pub const MIN_TARGET_DP: u32 = crate::facade::accessibility::MIN_TOUCH_TARGET_DP;
    /// Minimum contrast ratio for ordinary text under WCAG AA.
    pub const CONTRAST_AA: f32 = crate::facade::accessibility::WCAG_AA_NORMAL_TEXT;
}

#[cfg(test)]
mod tests {
    use super::{accessibility, components::Button, layout::LayoutTree, theme::Theme};

    #[test]
    fn component_contract_has_accessible_defaults() {
        let button = Button::new("Save");
        assert!(button.enabled);
        assert_eq!(button.min_target_dp, accessibility::MIN_TARGET_DP);
    }

    #[test]
    fn layout_tree_uses_taffy() {
        let mut tree = LayoutTree::new();
        let first = tree.leaf(80.0, 24.0);
        let second = tree.leaf(120.0, 32.0);
        let root = tree.column(vec![first, second]);
        let result = tree.compute(root, 320.0, 240.0).unwrap();
        assert_eq!(result.width, 120.0);
        assert_eq!(result.height, 56.0);
        assert_eq!(
            Theme::default().mode,
            crate::facade::platform::ThemeMode::System
        );
    }
}
