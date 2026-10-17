// SPDX-License-Identifier: Apache-2.0
//! [`ReproductionPlan`]: the serializable artifact this crate produces from a capture or a crawl.

use serde::{Deserialize, Serialize};

use crate::theme::{self, ThemePlan};

/// Where a [`ReproductionPlan`] came from.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum ReproductionSource {
    /// A decoded screenshot or capture (PNG/JPEG bytes).
    Image {
        /// Byte length of the source image, for the record (bytes themselves are not embedded).
        byte_len: usize,
    },
    /// A crawled page.
    Url {
        /// The page's URL.
        url: String,
    },
    /// Already-fetched HTML, with no known source URL.
    Html,
}

/// A node in the reproduced component tree: a detected layout landmark mapped onto an M3
/// component, with any content extracted for it and its children in document order.
#[derive(Clone, Debug, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ComponentNode {
    /// The M3 component this landmark maps to (e.g. `"top-app-bar"`, `"navigation-rail"`,
    /// `"card"`, `"text-field"`, `"button"`, `"fab"`). See [`crate::crawl::LANDMARK_TO_M3`] for
    /// the mapping table (`crawl` feature).
    pub component: String,
    /// The source tag or class hint this was detected from (e.g. `"header"`, `".hero"`).
    pub source_hint: String,
    /// Text content extracted for the node (trimmed, collapsed whitespace), if any.
    pub text: Option<String>,
    /// Children, in document order.
    pub children: Vec<ComponentNode>,
}

/// An asset (image, font, icon) the reproduction references.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AssetRef {
    /// Original URL or path.
    pub url: String,
    /// Best-effort role guess (`"logo"`, `"hero-image"`, `"icon"`, `"font"`, `"other"`).
    pub role: String,
}

/// The full plan to reproduce a site in M3: theme, detected fonts, shape tokens, component tree
/// and referenced assets.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReproductionPlan {
    /// Where this plan came from.
    pub source: ReproductionSource,
    /// The seed color and dynamic scheme.
    pub theme: ThemePlan,
    /// Font-family stacks detected, most-used first (`crawl` feature; empty for image-only
    /// plans, which have no markup to read fonts from).
    pub font_stacks: Vec<String>,
    /// Nearest M3 shape-token corner radius detected, in dp (`crawl` feature).
    pub corner_radius_dp: Option<f64>,
    /// The reproduced component tree, root first (`crawl` feature).
    pub components: Vec<ComponentNode>,
    /// Assets referenced by the page (`crawl` feature).
    pub assets: Vec<AssetRef>,
}

impl ReproductionPlan {
    /// A plan from a decoded screenshot alone: seed color only, no markup to read components,
    /// fonts or assets from. `image` feature.
    ///
    /// # Errors
    ///
    /// Returns [`crate::Error::Image`] if `png_or_jpeg_bytes` cannot be decoded.
    #[cfg(feature = "image")]
    pub fn from_image_bytes(png_or_jpeg_bytes: &[u8]) -> crate::Result<Self> {
        let theme = theme::theme_from_image_bytes(png_or_jpeg_bytes)?;
        Ok(Self {
            source: ReproductionSource::Image {
                byte_len: png_or_jpeg_bytes.len(),
            },
            theme,
            font_stacks: Vec::new(),
            corner_radius_dp: None,
            components: Vec::new(),
            assets: Vec::new(),
        })
    }

    /// A plan from already-fetched HTML: seed color, fonts, shape and a flat landmark list, all
    /// via [`crate::crawl`]. `crawl` feature.
    #[cfg(feature = "crawl")]
    #[must_use]
    pub fn from_html(html: &str, source: ReproductionSource) -> Self {
        let seed = crate::crawl::seed_color(html);
        let theme = theme::theme_from_seed(
            seed,
            "most-suitable color among declared theme-color/CSS colors, ranked by \
             aphrody-m3-tokens::score",
        );
        Self {
            source,
            theme,
            font_stacks: crate::crawl::extract_font_stacks(html),
            corner_radius_dp: crate::crawl::extract_corner_radius(html),
            components: crate::crawl::extract_landmarks(html),
            assets: crate::crawl::extract_assets(html),
        }
    }

    /// Serializes the plan as pretty-printed JSON.
    ///
    /// # Errors
    ///
    /// Returns [`crate::Error::Json`] on a serialization failure (should not happen: every field
    /// is a plain, serializable type).
    pub fn to_json(&self) -> crate::Result<String> {
        Ok(serde_json::to_string_pretty(self)?)
    }
}
