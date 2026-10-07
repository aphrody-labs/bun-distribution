//! # aphrody-web-extract
//!
//! Pure, dependency-light content processing for Aphrody Web:
//!
//! - [`extract_main`]: main-content extraction (text-density, link-density and DOM-distance
//!   scoring, Readability / trafilatura class) with title, byline, publication date, language,
//!   canonical URL, Markdown and structural blocks.
//! - [`html_to_markdown`]: whole-document HTML → GitHub-flavoured Markdown, the single canonical
//!   converter shared with [`extract_main`].
//! - [`chunk_blocks`]: structure-aware chunking with heading paths.
//! - [`simhash64`], [`hamming_distance`], [`is_near_duplicate`]: 64-bit Charikar SimHash
//!   near-duplicate detection.
//! - [`resolve_canonical`]: `<link rel=canonical>` / `og:url` resolution.
//! - [`media`]: transport-independent media candidate extraction, HLS playlist parsing, packer
//!   unpacking and embed resolution (formerly the `aphrody-web-media` crate).
//!
//! Every public function accepts arbitrary input (NUL bytes, broken markup,
//! huge documents) and never panics: HTML is parsed by html5ever through
//! `obscura-dom`, all tree walks are iterative, and the top-level entry points
//! additionally contain any unexpected panic and return an empty result.

// The source workspace allows these style lints. Keep the imported algorithm
// files byte-identical while applying the target workspace's strict gate.
#![allow(
    clippy::collapsible_if,
    clippy::collapsible_match,
    clippy::if_same_then_else,
    clippy::manual_next_back,
    clippy::needless_range_loop
)]

mod canonical;
mod chunk;
mod date;
mod dom;
pub mod dragon_ball;
mod extract;
pub mod media;
mod meta;
mod patterns;
mod render;
mod simhash;
mod types;
mod url_metadata;

use std::panic::{AssertUnwindSafe, catch_unwind};

pub use canonical::resolve_canonical;
pub use chunk::chunk_blocks;
pub use date::normalize_date;
pub use extract::ExtractOptions;
pub use simhash::{
    DEFAULT_NEAR_DUPLICATE_BITS, hamming_distance, is_near_duplicate, normalize_text_for_hash,
    simhash64, stable_hash64,
};
pub use types::{Block, BlockKind, Chunk, Extracted};
pub use url_metadata::{
    PageMetadata, UrlNormalizationError, UrlNormalizationOptions, extract_metadata,
    normalize_page_url,
};

/// Extracts the main content of an HTML page with default options
/// (comments dropped, images dropped from Markdown, links kept).
///
/// `page_url` is used to resolve relative links and the canonical URL.
pub fn extract_main(html: &str, page_url: Option<&str>) -> Extracted {
    extract_main_with_options(html, page_url, &ExtractOptions::default())
}

/// [`extract_main`] with explicit [`ExtractOptions`].
pub fn extract_main_with_options(
    html: &str,
    page_url: Option<&str>,
    options: &ExtractOptions,
) -> Extracted {
    catch_unwind(AssertUnwindSafe(|| extract::extract(html, page_url, options)))
        .unwrap_or_else(|_| Extracted { simhash: format!("{:016x}", 0), ..Extracted::default() })
}

/// Serializes [`extract_main`] as JSON (the FFI entry point).
pub fn extract_main_json(html: &str, page_url: Option<&str>) -> String {
    let extracted = extract_main(html, page_url);
    serde_json::to_string(&extracted).unwrap_or_else(|_| "{}".to_string())
}

/// Converts a whole HTML document to GitHub-flavoured Markdown.
///
/// No main-content selection is performed; only `script`, `style`, `noscript`,
/// `template`, `svg`, `head`, `iframe` (and other non-rendered embeds) are
/// dropped. Links and images are resolved against `base_url` (and
/// `<base href>`), `javascript:` links keep only their text, tables are
/// emitted as unpadded GFM tables, and whitespace is collapsed outside `<pre>`.
pub fn html_to_markdown(html: &str, base_url: Option<&str>) -> String {
    catch_unwind(AssertUnwindSafe(|| {
        let arena = dom::Arena::from_html(html);
        let base_href = arena
            .nodes
            .iter()
            .position(|n| n.kind == dom::Kind::Element && n.tag == dom::Tag::Base)
            .and_then(|i| arena.attr_string(i as u32, "href"));
        let page = base_url.and_then(|u| url::Url::parse(u.trim()).ok());
        let base = match (&page, base_href.as_deref()) {
            (Some(p), Some(b)) => p.join(b.trim()).ok().or_else(|| page.clone()),
            (None, Some(b)) => url::Url::parse(b.trim()).ok(),
            (p, None) => p.clone(),
        };
        let excluded = vec![false; arena.nodes.len()];
        let root = if arena.body != dom::NONE { arena.body } else { 0 };
        let rendered = render::render(
            &arena,
            &[root],
            &excluded,
            base.as_ref(),
            render::RenderOptions { images: true, fragment_links: true, links: true },
        );
        rendered.markdown
    }))
    .unwrap_or_default()
}

#[cfg(feature = "profiling")]
pub use extract::debug_trace;
