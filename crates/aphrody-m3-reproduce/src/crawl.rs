// SPDX-License-Identifier: Apache-2.0
//! Regex-based extraction of theme colors, fonts, shape and layout landmarks from an
//! already-fetched HTML string. `crawl` feature.
//!
//! This is deliberately light: no DOM tree, no CSS cascade, no rendering — a handful of regular
//! expressions over the raw markup (inline `style="..."` attributes, `<style>` blocks, `<meta
//! name="theme-color">`, tag names and `class` attributes). That is enough to seed a plausible M3
//! theme and a flat list of detected landmarks for most hand-authored sites, but it will miss
//! colors and fonts that only exist in external stylesheets not embedded inline, and it does not
//! reconstruct the page's actual DOM nesting (every [`crate::ComponentNode`] this module returns
//! is a sibling in one flat, document-order list — nesting the tree faithfully needs a real
//! parser, e.g. `obscura-dom`, and is left to a follow-up; see `docs/design/M3-REPRODUCE.md`).

use std::sync::LazyLock;

use aphrody_m3_tokens::{
    color_math,
    quantize::celebi_quantize,
    score::{ScoreOptions, score},
};
use regex::Regex;

use crate::plan::{AssetRef, ComponentNode};

/// Tag name or `class`/`id` substring to the M3 component it most plausibly maps to. Checked in
/// order; the first match wins.
pub const LANDMARK_TO_M3: &[(&str, &str)] = &[
    ("header", "top-app-bar"),
    ("nav", "navigation-bar"),
    ("aside", "navigation-rail"),
    ("footer", "footer"),
    ("form", "text-field"),
    ("hero", "hero"),
    ("card", "card"),
    ("modal", "dialog"),
    ("dialog", "dialog"),
    ("fab", "fab"),
    ("btn", "button"),
    ("button", "button"),
    ("list", "list"),
    ("table", "data-table"),
    ("main", "content-area"),
];

static HEX_COLOR: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b").expect("valid regex"));
static THEME_COLOR_META: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r#"(?is)<meta[^>]+name=["']theme-color["'][^>]+content=["']([^"']+)["']"#)
        .expect("valid regex")
});
// Stops at `;` or `}` (end of declaration/rule); quotes are left in the capture since
// `font-family: "Google Sans", sans-serif` legitimately contains them, then trimmed off in
// `extract_font_stacks` for the (less common) unterminated-inline-style-attribute case.
static FONT_FAMILY: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)font-family\s*:\s*([^;}]+)").expect("valid regex"));
static BORDER_RADIUS: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)border-radius\s*:\s*([\d.]+)px").expect("valid regex"));
static IMG_SRC: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r#"(?is)<img[^>]+src=["']([^"']+)["']"#).expect("valid regex"));
static TAG_OR_CLASS: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r#"(?is)<(header|nav|aside|footer|form|main)\b|class=["']([^"']*)["']"#)
        .expect("valid regex")
});
static TAG_INNER_TEXT: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?is)<[^>]+>").expect("valid regex"));

fn expand_short_hex(hex: &str) -> String {
    if hex.len() == 3 { hex.chars().flat_map(|c| [c, c]).collect() } else { hex.to_owned() }
}

/// Every `#rrggbb`/`#rgb` color literal found (inline styles, `<style>` blocks, `theme-color`
/// meta), each with the number of times it occurs — the frequency [`crate::theme`] weighs a seed
/// choice by.
#[must_use]
pub fn extract_colors(html: &str) -> Vec<(u32, u32)> {
    let mut counts = std::collections::HashMap::<u32, u32>::new();
    for caps in HEX_COLOR.captures_iter(html) {
        if let Some(argb) = color_math::argb_from_hex(&expand_short_hex(&caps[1])) {
            *counts.entry(argb).or_insert(0) += 1;
        }
    }
    // `<meta name="theme-color">` is an explicit brand signal: weight it heavily.
    for caps in THEME_COLOR_META.captures_iter(html) {
        if let Some(argb) = color_math::argb_from_hex(caps[1].trim()) {
            *counts.entry(argb).or_insert(0) += 50;
        }
    }
    counts.into_iter().collect()
}

/// The seed color for a page: the colors [`extract_colors`] finds, quantized and ranked the same
/// way a screenshot's pixels would be (`aphrody-m3-tokens`'s `score`/`quantize` port), so image-
/// and crawl-derived plans pick a seed the same way.
#[must_use]
pub fn seed_color(html: &str) -> u32 {
    let colors = extract_colors(html);
    if colors.is_empty() {
        return score(&[], ScoreOptions::default())[0]; // the reference's Google Blue fallback.
    }
    // Expand each distinct color into `population` ARGB pixels so the existing pixel-based
    // quantizer/scorer (built for images) can rank a handful of declared colors the same way.
    let pixels: Vec<u32> = colors
        .iter()
        .flat_map(|&(argb, population)| std::iter::repeat_n(argb, population as usize))
        .collect();
    let quantized = celebi_quantize(&pixels, 32.min(colors.len().max(1)));
    score(&quantized, ScoreOptions::default())[0]
}

/// Font-family stacks declared inline or in `<style>` blocks, most-declared first, deduplicated.
#[must_use]
pub fn extract_font_stacks(html: &str) -> Vec<String> {
    let mut counts: Vec<(String, u32)> = Vec::new();
    for caps in FONT_FAMILY.captures_iter(html) {
        let stack = caps[1].trim().trim_end_matches(['"', '\'', '>']).trim().to_owned();
        if stack.is_empty() {
            continue;
        }
        if let Some(entry) = counts.iter_mut().find(|(s, _)| *s == stack) {
            entry.1 += 1;
        } else {
            counts.push((stack, 1));
        }
    }
    counts.sort_by_key(|a| std::cmp::Reverse(a.1));
    counts.into_iter().map(|(s, _)| s).collect()
}

/// The median declared `border-radius`, in dp (CSS `px` treated 1:1 with dp, the common case at
/// the reference 1x density) — the nearest M3 shape token is a UI-layer decision left to the
/// caller ([`aphrody_m3_tokens::shape::ALL`] lists the canonical corner radii to snap to).
#[must_use]
pub fn extract_corner_radius(html: &str) -> Option<f64> {
    let mut radii: Vec<f64> =
        BORDER_RADIUS.captures_iter(html).filter_map(|c| c[1].parse().ok()).collect();
    if radii.is_empty() {
        return None;
    }
    radii.sort_by(f64::total_cmp);
    Some(radii[radii.len() / 2])
}

/// `<img src="...">` references, tagged with a coarse role guess.
#[must_use]
pub fn extract_assets(html: &str) -> Vec<AssetRef> {
    IMG_SRC
        .captures_iter(html)
        .map(|c| {
            let url = c[1].to_owned();
            let role = if url.to_ascii_lowercase().contains("logo") {
                "logo"
            } else if url.to_ascii_lowercase().contains("hero") {
                "hero-image"
            } else if url.to_ascii_lowercase().contains("icon") {
                "icon"
            } else {
                "other"
            };
            AssetRef { url, role: role.to_owned() }
        })
        .collect()
}

/// A flat, document-order list of detected layout landmarks mapped onto M3 components (see
/// [`LANDMARK_TO_M3`]). Not a real DOM tree — see the module doc for why.
#[must_use]
pub fn extract_landmarks(html: &str) -> Vec<ComponentNode> {
    let mut nodes = Vec::new();
    for caps in TAG_OR_CLASS.captures_iter(html) {
        let hint = if let Some(tag) = caps.get(1) {
            tag.as_str().to_ascii_lowercase()
        } else if let Some(class_attr) = caps.get(2) {
            class_attr.as_str().to_ascii_lowercase()
        } else {
            continue;
        };
        if let Some((needle, component)) =
            LANDMARK_TO_M3.iter().find(|(needle, _)| hint.contains(needle))
        {
            nodes.push(ComponentNode {
                component: (*component).to_owned(),
                source_hint: (*needle).to_owned(),
                text: None,
                children: Vec::new(),
            });
        }
    }
    nodes
}

/// Strips tags for a rough plain-text preview (used when a landmark's text is worth recording;
/// not a substitute for real text-content extraction — see `aphrody-web-extract::extract_main`
/// for that).
#[must_use]
pub fn strip_tags(html_fragment: &str) -> String {
    let no_tags = TAG_INNER_TEXT.replace_all(html_fragment, " ");
    no_tags.split_whitespace().collect::<Vec<_>>().join(" ")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_theme_color_meta_with_high_weight() {
        let html = r##"<meta name="theme-color" content="#6750a4">"##;
        let colors = extract_colors(html);
        // Counted twice: once as a generic `#rrggbb` literal (weight 1), once for the explicit
        // `theme-color` signal (weight 50) — both are real, independent findings.
        assert_eq!(colors, vec![(0xFF67_50A4, 51)]);
    }

    #[test]
    fn extracts_and_ranks_font_stacks() {
        let html = r#"<style>body{font-family: "Google Sans", sans-serif} h1{font-family: "Google Sans", sans-serif} p{font-family: monospace}</style>"#;
        let stacks = extract_font_stacks(html);
        assert_eq!(stacks[0], "\"Google Sans\", sans-serif");
    }

    #[test]
    fn extracts_median_corner_radius() {
        let html = r#"<style>.a{border-radius: 8px} .b{border-radius: 16px} .c{border-radius: 24px}</style>"#;
        assert_eq!(extract_corner_radius(html), Some(16.0));
    }

    #[test]
    fn detects_landmarks_in_document_order() {
        let html = r#"<header>Top</header><nav>Menu</nav><div class="hero-banner">Hi</div><div class="card">A</div>"#;
        let landmarks = extract_landmarks(html);
        let components: Vec<&str> = landmarks.iter().map(|n| n.component.as_str()).collect();
        assert_eq!(components, vec!["top-app-bar", "navigation-bar", "hero", "card"]);
    }

    #[test]
    fn seed_color_falls_back_to_google_blue_without_any_colors() {
        assert_eq!(seed_color("<p>no colors here</p>"), 0xFF42_85F4);
    }

    #[test]
    fn seed_color_picks_the_declared_brand_color() {
        let html = r##"<meta name="theme-color" content="#6750a4">"##;
        assert_eq!(seed_color(html), 0xFF67_50A4);
    }
}
