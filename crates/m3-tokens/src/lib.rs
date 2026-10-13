// SPDX-License-Identifier: Apache-2.0
//! Material Design 3 baseline design tokens.
//!
//! Provides compile-time constants for color roles, typography scale,
//! elevation levels, and motion parameters drawn from the canonical M3
//! specification. The crate supports `no_std` with default features disabled;
//! the `std` feature (enabled by default) gates allocating helpers such as [`export_css`].
//!
//! `facade` (`std` only) is the unified integration surface for native, Tauri/CEF, WASM and FFI
//! consumers (layout contract, accessibility, icon policy, theme); it re-exports the modules
//! below and owns no token table of its own.
//!
//! # Feature flags
//!
//! | Flag  | Default | Effect |
//! |-------|---------|--------|
//! | `std` | yes     | Enables [`export_css`] and the [`alloc`] prelude. |
//!
//! # Quick start
//!
//! ```rust
//! use aphrody_m3_tokens::color::BASELINE;
//! // primary color role — 0xFF6750A4
//! assert_eq!(BASELINE.primary, 0xFF6750A4);
//! ```

#![cfg_attr(not(feature = "std"), no_std)]
#![forbid(unsafe_code)]
#![deny(missing_docs)]

#[cfg(feature = "std")]
extern crate std;

/// Adaptive layout — M3 breakpoints (window size classes), pane counts, and
/// recommended navigation/action/dialog component swaps.
pub mod adaptive;
#[cfg(feature = "std")]
pub mod blend;
#[cfg(feature = "std")]
pub mod cam16;
pub mod color;
#[cfg(feature = "std")]
pub mod color_math;
/// Material 3 component tokens (`md.comp.*`) mirrored from the pinned Google token sets.
#[cfg(feature = "std")]
pub mod component;
#[cfg(feature = "std")]
pub mod contrast;
/// Dynamic color — HCT seed → 13-tone tonal palette generation (the M3
/// `material-color-utilities` algorithm). Derive a tonal palette from an
/// arbitrary brand seed at runtime via [`dynamic::seed_to_palette`].
#[cfg(feature = "std")]
pub mod dynamic;
pub mod elevation;
#[cfg(feature = "std")]
pub mod facade;
pub mod gemini_brand;
/// Canonical framework font descriptors and existing embedded font API.
pub mod google_sans_code;
/// Canonical framework font descriptors and existing embedded font API.
pub mod google_sans_flex;
#[cfg(feature = "std")]
pub mod hct;
/// `sourceColorFromImage`/`sourceColorFromImageBytes`: the color most suitable for a UI theme
/// from a decoded image's pixels. `image` feature adds PNG/JPEG decode.
#[cfg(feature = "std")]
pub mod image;
pub mod motion;
#[cfg(feature = "std")]
pub mod palette;
/// Image color quantization (`QuantizerCelebi`): [`quantize_wu`] seeds [`quantize_wsmeans`].
#[cfg(feature = "std")]
pub mod quantize;
/// `QuantizerMap`: counts opaque pixels by ARGB color.
#[cfg(feature = "std")]
pub mod quantize_map;
/// `QuantizerWsmeans` (weighted square means K-Means) and its `LabPointProvider`.
#[cfg(feature = "std")]
pub mod quantize_wsmeans;
/// `QuantizerWu`: the Wu color quantizer.
#[cfg(feature = "std")]
pub mod quantize_wu;
/// Material semantic role names shared by no_std and dynamic-scheme consumers.
pub mod role;
#[cfg(feature = "std")]
pub mod scheme;
/// `Score.score`: ranks quantized colors by suitability for a UI theme.
#[cfg(feature = "std")]
pub mod score;
pub mod shape;
#[cfg(feature = "std")]
pub mod sheets;
/// SpaceUI → M3 fusion: the SpaceUI semantic vocabulary mapped onto M3 roles and state layers,
/// and its seven themes as M3 dynamic-scheme seeds.
pub mod spaceui;
pub mod state;
/// Validated, versioned native/Bun/WASM theme exports over the canonical color engine.
#[cfg(feature = "std")]
pub mod theme;
pub mod tonal;
pub mod typography;

// Re-export the CSS exporter at crate root when std is available.
#[cfg(feature = "std")]
pub use color::export_css;
// Re-export the Aphrody brand CSS exporter for product and component hosts.
#[cfg(feature = "std")]
pub use gemini_brand::export_aphrody_brand_css;

// ── Top-level integration tests ──────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use crate::typography::ALL as TYPE_SCALE;

    /// Enforce that the canonical type scale has exactly 15 entries.
    #[test]
    fn type_scale_count_is_15() {
        assert_eq!(
            TYPE_SCALE.len(),
            15,
            "M3 type scale must contain exactly 15 type styles"
        );
    }

    /// Enforce that the CSS export declares the primary color variable.
    #[cfg(feature = "std")]
    #[test]
    fn css_export_contains_primary() {
        use crate::color::{BASELINE, export_css};
        let css = export_css(&BASELINE);
        assert!(
            css.contains("--md-sys-color-primary:"),
            "export_css must emit --md-sys-color-primary"
        );
    }
}
