// SPDX-License-Identifier: Apache-2.0
use super::{MediaCandidate, MediaKind, absolute, peel_layers, unescape_urls};
use regex::{Regex, RegexBuilder};
use std::collections::HashMap;

pub fn classify_media(url: &str) -> MediaKind {
    let path = url.split(['?', '#']).next().unwrap_or(url).to_ascii_lowercase();
    if path.ends_with(".m3u8") {
        MediaKind::Hls
    } else if path.ends_with(".mpd") {
        MediaKind::Dash
    } else if [".mp4", ".m4v", ".mov"].iter().any(|ext| path.ends_with(ext)) {
        MediaKind::Mp4
    } else {
        MediaKind::Unknown
    }
}

fn clean_url(raw: &str, base: &str) -> Option<String> {
    let cleaned = unescape_urls(raw).replace("&amp;", "&");
    let cleaned = cleaned.trim();
    if cleaned.is_empty() || cleaned.len() > 2048 {
        return None;
    }
    absolute(cleaned, base)
}

fn pattern(expression: &str) -> Regex {
    RegexBuilder::new(expression).case_insensitive(true).build().expect("static media pattern")
}

fn declared_sources(text: &str, base: &str, layer: usize) -> Vec<MediaCandidate> {
    let mut result = Vec::new();
    let starts = pattern(r"\bsources?\s*:\s*\[");
    let entries = pattern(r"\{[^{}]*\}");
    let file = pattern(r#"\b(?:file|src|url)\s*:\s*['"]([^'"]+)['"]"#);
    let label = pattern(r#"\blabel\s*:\s*['"]([^'"]+)['"]"#);
    for start in starts.find_iter(text) {
        let open = start.end() - 1;
        let mut depth = 0usize;
        let mut end = None;
        for (relative, ch) in text[open..].char_indices() {
            match ch {
                '[' => depth += 1,
                ']' => {
                    depth -= 1;
                    if depth == 0 {
                        end = Some(open + relative + 1);
                        break;
                    }
                },
                _ => {},
            }
        }
        let Some(end) = end else { continue };
        let block = &text[open..end];
        for entry in entries.find_iter(block) {
            let Some(caps) = file.captures(entry.as_str()) else { continue };
            let Some(url) = clean_url(&caps[1], base) else { continue };
            result.push(MediaCandidate {
                kind: classify_media(&url),
                url,
                rule: "jwplayer.sources".to_string(),
                confidence: (0.95_f64 - layer as f64 * 0.05).max(0.1),
                offset: open + entry.start(),
                layer,
                label: label.captures(entry.as_str()).map(|caps| caps[1].to_string()),
            });
        }
    }
    result
}

const RULES: &[(&str, f64, &str, usize)] = &[
    (
        "player.file",
        0.85,
        r#"['"]?file['"]?\s*[:=]\s*['"]([^'"]+\.(?:m3u8|mpd|mp4|m4v|mov)[^'"]*)['"]"#,
        1,
    ),
    (
        "player.src",
        0.80,
        r#"['"]?src['"]?\s*[:=]\s*['"]([^'"]+\.(?:m3u8|mpd|mp4|m4v|mov)[^'"]*)['"]"#,
        1,
    ),
    (
        "player.hls",
        0.75,
        r#"['"]?(?:hls|source|url|stream)['"]?\s*[:=]\s*['"]([^'"]+\.(?:m3u8|mpd|mp4|m4v|mov)[^'"]*)['"]"#,
        1,
    ),
    (
        "html.source",
        0.70,
        r#"<(?:source|video)[^>]+(?:data-)?src\s*=\s*['"]([^'"]+\.(?:m3u8|mpd|mp4|m4v|mov)[^'"]*)['"]"#,
        1,
    ),
    ("sibnet.relative", 0.70, r"(/v/[A-Za-z0-9_%-]+/\d+\.mp4)", 1),
    ("bare.url", 0.45, r#"https?://[^\s'"<>\\|]+\.(?:m3u8|mpd|mp4|m4v|mov)[^\s'"<>\\|]*"#, 0),
];

pub fn extract_media_candidates(source: &str, base_url: &str) -> Vec<MediaCandidate> {
    let mut best = HashMap::<String, MediaCandidate>::new();
    for raw_layer in peel_layers(source, 4) {
        let text = unescape_urls(&raw_layer.text);
        for candidate in declared_sources(&text, base_url, raw_layer.depth) {
            keep(&mut best, candidate);
        }
        for (name, confidence, expression, group) in RULES {
            let regex = pattern(expression);
            for caps in regex.captures_iter(&text) {
                let Some(capture) = caps.get(*group) else { continue };
                let Some(url) = clean_url(capture.as_str(), base_url) else { continue };
                let offset = caps.get(0).map(|whole| whole.start()).unwrap_or_default();
                let candidate = MediaCandidate {
                    kind: classify_media(&url),
                    url,
                    rule: (*name).to_string(),
                    confidence: (*confidence - raw_layer.depth as f64 * 0.05).max(0.1),
                    offset,
                    layer: raw_layer.depth,
                    label: None,
                };
                keep(&mut best, candidate);
            }
        }
    }
    let mut result: Vec<_> = best.into_values().collect();
    result.sort_by(|a, b| {
        b.confidence
            .total_cmp(&a.confidence)
            .then_with(|| a.layer.cmp(&b.layer))
            .then_with(|| a.offset.cmp(&b.offset))
    });
    result
}

fn keep(best: &mut HashMap<String, MediaCandidate>, candidate: MediaCandidate) {
    if best.get(&candidate.url).is_none_or(|previous| candidate.confidence > previous.confidence) {
        best.insert(candidate.url.clone(), candidate);
    }
}

pub fn extract_poster(source: &str, base_url: &str) -> Option<String> {
    let patterns = [
        r#"\bimage\s*:\s*['"]([^'"]+\.(?:jpe?g|png|webp)[^'"]*)['"]"#,
        r#"\bposter\s*[:=]\s*['"]([^'"]+\.(?:jpe?g|png|webp)[^'"]*)['"]"#,
        r#"<meta[^>]+property=['"]og:image['"][^>]+content=['"]([^'"]+)['"]"#,
    ];
    for layer in peel_layers(source, 4) {
        let text = unescape_urls(&layer.text);
        for expression in patterns {
            if let Some(caps) = pattern(expression).captures(&text)
                && let Some(url) = clean_url(&caps[1], base_url)
            {
                return Some(url);
            }
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classifies_and_ranks_candidates() {
        assert_eq!(classify_media("https://c.test/x.mpd?q=1"), MediaKind::Dash);
        assert_eq!(classify_media("https://c.test/x.mp4#t=1"), MediaKind::Mp4);
        let page = r#"<a href="https://ads.test/a.mp4">ad</a><script>setup({sources:[{file:"https://cdn.test/720.m3u8",label:"720p"},{file:"https://cdn.test/480.mp4",label:"480p"}]})</script>"#;
        let candidates = extract_media_candidates(page, "https://embed.test/e");
        assert_eq!(candidates.len(), 3);
        assert_eq!(candidates[0].rule, "jwplayer.sources");
        assert_eq!(candidates[0].label.as_deref(), Some("720p"));
        assert_eq!(candidates[2].rule, "bare.url");
    }

    #[test]
    fn finds_relative_media_and_poster() {
        let candidates = extract_media_candidates(
            r#"player.src([{src: "/v/ab/42.mp4"}]);"#,
            "https://video.sibnet.ru/shell.php",
        );
        assert_eq!(candidates[0].url, "https://video.sibnet.ru/v/ab/42.mp4");
        assert_eq!(
            extract_poster(
                r#"<meta property="og:image" content="/cover.png">"#,
                "https://embed.test/e"
            ),
            Some("https://embed.test/cover.png".to_string())
        );
    }
}
