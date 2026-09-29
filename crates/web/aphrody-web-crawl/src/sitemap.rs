// SPDX-License-Identifier: Apache-2.0

use chrono::{DateTime, NaiveDate};
use url::Url;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SitemapKind {
    UrlSet,
    Index,
    Unknown,
}

#[derive(Debug, Clone)]
pub struct SitemapEntry {
    pub url: Url,
    pub last_modified_ms: Option<i64>,
    pub priority: Option<f64>,
}

#[derive(Debug, Clone)]
pub struct ParsedSitemap {
    pub kind: SitemapKind,
    pub urls: Vec<SitemapEntry>,
    pub sitemaps: Vec<Url>,
}

/// Parse sitemap indexes, URL sets, and plain-text URL lists without network I/O.
#[must_use]
pub fn parse_sitemap(body: &str, base: &Url) -> ParsedSitemap {
    let mut result =
        ParsedSitemap { kind: SitemapKind::Unknown, urls: Vec::new(), sitemaps: Vec::new() };
    if body.len() > 16 * 1024 * 1024 {
        return result;
    }
    let lower = body.to_ascii_lowercase();
    if lower.contains("<sitemapindex") || lower.contains(":sitemapindex") {
        result.kind = SitemapKind::Index;
        for block in tag_blocks(body, "sitemap") {
            if let Some(loc) = child_text(block, "loc")
                && let Ok(url) = base.join(&loc)
                && matches!(url.scheme(), "http" | "https")
            {
                result.sitemaps.push(url);
            }
        }
    } else if lower.contains("<urlset") || lower.contains(":urlset") {
        result.kind = SitemapKind::UrlSet;
        for block in tag_blocks(body, "url") {
            let Some(loc) = child_text(block, "loc") else { continue };
            let Ok(url) = base.join(&loc) else { continue };
            if !matches!(url.scheme(), "http" | "https") {
                continue;
            }
            let last_modified_ms =
                child_text(block, "lastmod").and_then(|value| parse_date(&value));
            let priority = child_text(block, "priority")
                .and_then(|value| value.parse::<f64>().ok())
                .filter(|value| value.is_finite())
                .map(|value| value.clamp(0.0, 1.0));
            result.urls.push(SitemapEntry { url, last_modified_ms, priority });
        }
    } else {
        for line in body.lines().map(str::trim) {
            if let Ok(url) = Url::parse(line)
                && matches!(url.scheme(), "http" | "https")
            {
                result.urls.push(SitemapEntry { url, last_modified_ms: None, priority: None });
            }
        }
        if !result.urls.is_empty() {
            result.kind = SitemapKind::UrlSet;
        }
    }
    result
}

/// Recency and sitemap priority prior from the source seed ingestion policy.
#[must_use]
pub fn seed_boost(entry: &SitemapEntry, now_ms: i64) -> f64 {
    let recency = entry.last_modified_ms.map_or(0.25, |last| {
        0.5_f64.powf(now_ms.saturating_sub(last).max(0) as f64 / (14.0 * 86_400_000.0))
    });
    recency + entry.priority.unwrap_or(0.5)
}

fn parse_date(value: &str) -> Option<i64> {
    DateTime::parse_from_rfc3339(value)
        .map(|date| date.timestamp_millis())
        .or_else(|_| {
            NaiveDate::parse_from_str(value, "%Y-%m-%d").map(|date| {
                date.and_hms_opt(0, 0, 0).expect("midnight is valid").and_utc().timestamp_millis()
            })
        })
        .ok()
}

fn tag_blocks<'a>(xml: &'a str, local_name: &str) -> Vec<&'a str> {
    let lower = xml.to_ascii_lowercase();
    let mut blocks = Vec::new();
    let mut position = 0;
    while let Some(relative) = lower[position..].find('<') {
        let start = position + relative;
        let Some(close) = lower[start..].find('>') else { break };
        let tag_end = start + close + 1;
        let token = lower[start + 1..tag_end - 1].trim();
        if token.starts_with('/') || token.starts_with('!') || token.starts_with('?') {
            position = tag_end;
            continue;
        }
        let qualified = token
            .split(|ch: char| ch.is_ascii_whitespace() || ch == '/')
            .next()
            .unwrap_or_default();
        if qualified.rsplit(':').next() != Some(local_name) {
            position = tag_end;
            continue;
        }
        let closing = format!("</{qualified}");
        let Some(relative_end) = lower[tag_end..].find(&closing) else { break };
        let content_end = tag_end + relative_end;
        let Some(close_bracket) = lower[content_end..].find('>') else { break };
        blocks.push(&xml[tag_end..content_end]);
        position = content_end + close_bracket + 1;
    }
    blocks
}

fn child_text(xml: &str, local_name: &str) -> Option<String> {
    let block = tag_blocks(xml, local_name).into_iter().next()?;
    let text = if let Some(cdata) = block.strip_prefix("<![CDATA[") {
        cdata.strip_suffix("]]>").unwrap_or(cdata).to_owned()
    } else {
        let mut clean = String::new();
        let mut inside_tag = false;
        for ch in block.chars() {
            match ch {
                '<' => inside_tag = true,
                '>' => inside_tag = false,
                _ if !inside_tag => clean.push(ch),
                _ => {},
            }
        }
        decode_entities(&clean)
    };
    let trimmed = text.trim();
    (!trimmed.is_empty()).then(|| trimmed.to_owned())
}

fn decode_entities(value: &str) -> String {
    let mut result = String::new();
    let mut remaining = value;
    while let Some(start) = remaining.find('&') {
        result.push_str(&remaining[..start]);
        remaining = &remaining[start..];
        let Some(end) = remaining.find(';') else { break };
        let entity = &remaining[1..end];
        let decoded = match entity {
            "amp" => Some('&'),
            "lt" => Some('<'),
            "gt" => Some('>'),
            "quot" => Some('"'),
            "apos" => Some('\''),
            _ if entity.starts_with("#x") => {
                u32::from_str_radix(&entity[2..], 16).ok().and_then(char::from_u32)
            },
            _ if entity.starts_with('#') => {
                entity[1..].parse::<u32>().ok().and_then(char::from_u32)
            },
            _ => None,
        };
        if let Some(ch) = decoded {
            result.push(ch);
        } else {
            result.push_str(&remaining[..=end]);
        }
        remaining = &remaining[end + 1..];
    }
    result.push_str(remaining);
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_namespaced_index_and_cdata_urlset() {
        let base = Url::parse("https://example.test/sitemap.xml").unwrap();
        let index = parse_sitemap(
            "<sm:sitemapindex><sm:sitemap><sm:loc>https://example.test/a.xml</sm:loc></sm:sitemap></sm:sitemapindex>",
            &base,
        );
        assert_eq!(index.kind, SitemapKind::Index);
        assert_eq!(index.sitemaps[0].as_str(), "https://example.test/a.xml");
        let set = parse_sitemap(
            "<urlset><url><loc><![CDATA[https://example.test/a?x=1&y=2]]></loc><lastmod>2026-09-29</lastmod><priority>0.8</priority></url></urlset>",
            &base,
        );
        assert_eq!(set.urls[0].url.as_str(), "https://example.test/a?x=1&y=2");
        assert_eq!(set.urls[0].priority, Some(0.8));
        assert!(set.urls[0].last_modified_ms.is_some());
    }

    #[test]
    fn parses_text_sitemaps_and_entity_urls() {
        let base = Url::parse("https://example.test/sitemap.txt").unwrap();
        let set = parse_sitemap(
            "<urlset><url><loc>https://example.test/a?x=1&amp;y=2</loc></url></urlset>",
            &base,
        );
        assert_eq!(set.urls[0].url.as_str(), "https://example.test/a?x=1&y=2");
        let text = parse_sitemap("https://example.test/a\nhttps://example.test/b", &base);
        assert_eq!(text.urls.len(), 2);
    }
}
