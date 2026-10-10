// SPDX-License-Identifier: Apache-2.0
//! Reproduce a site in Material 3 from a screenshot or a crawl.
//!
//! [`ReproductionPlan`] is the single artifact this crate produces: a seed color and dynamic
//! scheme choice (via [`aphrody_m3_tokens`]'s exact `material-color-utilities` port), the fonts
//! and shape tokens a page's markup declares, and a coarse component tree mapping detected layout
//! landmarks (header, nav, hero, cards, forms, footer) onto M3 components. [`scaffold`] turns a
//! plan into a runnable `@aphrody/m3` app skeleton.
//!
//! # Feature flags
//!
//! | Flag      | Adds |
//! |-----------|------|
//! | `image`   | (default) [`theme::theme_from_image_bytes`] — PNG/JPEG capture bytes to a seed color, via `aphrody-m3-tokens`'s `sourceColorFromImage` port. |
//! | `crawl`   | [`crawl`] — regex-based color/font/landmark extraction from an already-fetched HTML string. No network, no DOM/CSS engine: light by design. |
//! | `network` | [`fetch`] — fetches a URL's HTML before crawling it (`reqwest` blocking). |
//! | `cli`     | [`cli::cli_main`] — the `aphrody m3-reproduce` entry point (`--url`, `--image`, `--out`, `--json`). |
//!
//! Only [`theme`] and [`plan`] are unconditionally compiled; every network-adjacent
//! piece is feature-gated so the core stays a light, deterministic library.

pub mod plan;
pub mod scaffold;
pub mod theme;

#[cfg(feature = "cli")]
pub mod cli;
#[cfg(feature = "crawl")]
pub mod crawl;
// `reqwest` has no blocking client on wasm32, so the fetcher exists on native targets only.
#[cfg(all(feature = "network", not(target_arch = "wasm32")))]
pub mod fetch;

pub use plan::{AssetRef, ComponentNode, ReproductionPlan, ReproductionSource};
pub use theme::ThemePlan;

#[cfg(feature = "cli")]
pub use cli::cli_main;

/// Errors this crate's public functions return.
#[derive(Debug, thiserror::Error)]
pub enum Error {
    /// Image decode or quantization failed (`image` feature).
    #[cfg(feature = "image")]
    #[error("image decode failed: {0}")]
    Image(#[from] ::image::ImageError),
    /// Fetching a URL failed (`network` feature).
    #[cfg(feature = "network")]
    #[error("fetch failed: {0}")]
    Fetch(#[from] reqwest::Error),
    /// Writing the scaffold to disk failed.
    #[error("scaffold write failed: {0}")]
    Io(#[from] std::io::Error),
    /// Serializing the plan to JSON failed.
    #[error("plan serialization failed: {0}")]
    Json(#[from] serde_json::Error),
}

/// Convenience alias for this crate's `Result`.
pub type Result<T> = std::result::Result<T, Error>;
