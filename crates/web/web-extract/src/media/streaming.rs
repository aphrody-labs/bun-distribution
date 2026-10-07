// SPDX-License-Identifier: Apache-2.0

//! Anime streaming catalog and embed extraction.
//!
//! Replaces legacy BXC TypeScript scrapers (voiranime, animesama) with
//! high-performance native Rust extractors operating directly on DOM and regexes.

use obscura_dom::parse_html;
use regex::Regex;
use serde::{Deserialize, Serialize};
use url::Url;

/// An episode or stream release item.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AnimeEpisode {
    pub episode_number: u32,
    pub title: String,
    pub page_url: String,
    pub player_urls: Vec<String>,
}

/// Anime series metadata extracted from catalog portals.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AnimeSeries {
    pub title: String,
    pub original_title: Option<String>,
    pub synopsis: Option<String>,
    pub poster_url: Option<String>,
    pub episodes: Vec<AnimeEpisode>,
}

/// Extract player / embed URLs from an HTML page (supports AnimeSama, VoirAnime, and standard iframe embeds).
#[must_use]
pub fn extract_streaming_players(html: &str, page_url: Option<&str>) -> Vec<String> {
    let mut players = Vec::new();
    let dom = parse_html(html);

    // 1. Check standard <iframe> tags
    for id in dom.query_selector_all("iframe[src]").unwrap_or_default() {
        let src = dom.with_node(id, |node| node.get_attribute("src").map(str::to_owned)).flatten();
        if let Some(src) = src {
            if let Some(resolved) = resolve_link(&src, page_url) {
                if !players.contains(&resolved) {
                    players.push(resolved);
                }
            }
        }
    }

    // 2. Check data-src or data-player attributes
    for id in dom.query_selector_all("[data-src], [data-player], [data-url]").unwrap_or_default() {
        let candidate = dom
            .with_node(id, |node| {
                node.get_attribute("data-src")
                    .or_else(|| node.get_attribute("data-player"))
                    .or_else(|| node.get_attribute("data-url"))
                    .map(str::to_owned)
            })
            .flatten();

        if let Some(raw) = candidate {
            if let Some(resolved) = resolve_link(&raw, page_url) {
                if !players.contains(&resolved) {
                    players.push(resolved);
                }
            }
        }
    }

    // 3. Regex scan for embedded JavaScript arrays (e.g. AnimeSama eps = ['...'] or players = [...])
    let js_player_re = Regex::new(r#"(?i)["'](https?:\\?/\\?/[^"']*(?:vidmoly|sibnet|sendvid|myvi|vk|streamtape|filemoon|oneupload|ansembed)[^"']*)["']"#).unwrap();
    for cap in js_player_re.captures_iter(html) {
        if let Some(matched) = cap.get(1) {
            let unescaped = matched.as_str().replace(r#"\"#, "");
            if let Some(resolved) = resolve_link(&unescaped, page_url) {
                if !players.contains(&resolved) {
                    players.push(resolved);
                }
            }
        }
    }

    players
}

fn resolve_link(raw: &str, base: Option<&str>) -> Option<String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() || trimmed.starts_with("javascript:") {
        return None;
    }
    if trimmed.starts_with("//") {
        return Some(format!("https:{}", trimmed));
    }
    if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
        return Some(trimmed.to_string());
    }
    if let Some(base_str) = base {
        if let Ok(base_url) = Url::parse(base_str) {
            if let Ok(joined) = base_url.join(trimmed) {
                return Some(joined.to_string());
            }
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_iframe_and_data_players() {
        let html = r#"
            <html>
                <body>
                    <iframe src="https://vidmoly.to/embed-xyz.html"></iframe>
                    <div class="player-btn" data-player="//sendvid.com/embed/12345"></div>
                    <script>
                        var eps = ["https://sibnet.ru/shell.php?videoid=999"];
                    </script>
                </body>
            </html>
        "#;

        let players = extract_streaming_players(html, Some("https://example.com/anime/ep-1"));
        assert_eq!(players.len(), 3);
        assert!(players.contains(&"https://vidmoly.to/embed-xyz.html".to_string()));
        assert!(players.contains(&"https://sendvid.com/embed/12345".to_string()));
        assert!(players.contains(&"https://sibnet.ru/shell.php?videoid=999".to_string()));
    }
}
