//! Canonical URL resolution (`<link rel="canonical">`, then `og:url`).

use url::Url;

use crate::{
    dom::Arena,
    meta::{self, PageMeta},
};

/// Resolves `raw` against `base` and validates it as a canonical candidate.
pub(crate) fn resolve_candidate(raw: &str, base: Option<&Url>) -> Option<String> {
    let raw = raw.trim_matches(|c: char| c.is_whitespace() || c == '\u{0}');
    if raw.is_empty() || raw.len() > 4096 {
        return None;
    }
    // Unrendered template placeholders are garbage, not URLs.
    if ["{{", "}}", "${", "<%", "%>", "[[", "]]"].iter().any(|m| raw.contains(m))
        || raw.chars().any(|c| c.is_control() || c == '\u{FFFD}')
    {
        return None;
    }
    let parsed = match Url::parse(raw) {
        Ok(u) => u,
        Err(url::ParseError::RelativeUrlWithoutBase) => base?.join(raw).ok()?,
        Err(_) => return None,
    };
    if !matches!(parsed.scheme(), "http" | "https") {
        return None;
    }
    let host = parsed.host_str()?;
    if host.is_empty() {
        return None;
    }
    let mut u = parsed;
    u.set_fragment(None);
    Some(u.to_string())
}

pub(crate) fn from_meta(meta: &PageMeta, page_url: Option<&str>) -> Option<String> {
    let page = page_url.and_then(|p| Url::parse(p.trim()).ok());
    // A `<base href>` changes the resolution base for relative canonicals.
    let base = match (&page, meta.base_href.as_deref()) {
        (Some(p), Some(b)) => p.join(b.trim()).ok().or_else(|| page.clone()),
        (None, Some(b)) => Url::parse(b.trim()).ok(),
        (p, None) => p.clone(),
    };
    for href in &meta.canonical_links {
        if let Some(u) = resolve_candidate(href, base.as_ref()) {
            return Some(u);
        }
    }
    for key in ["og:url", "twitter:url"] {
        for (k, v) in &meta.metas {
            if k == key {
                if let Some(u) = resolve_candidate(v, base.as_ref()) {
                    return Some(u);
                }
            }
        }
    }
    None
}

/// Case-insensitive ASCII search for `needle` in `hay`.
fn find_ascii_ci(hay: &str, needle: &str) -> Option<usize> {
    let h = hay.as_bytes();
    let n = needle.as_bytes();
    if n.is_empty() || h.len() < n.len() {
        return None;
    }
    (0..=h.len() - n.len()).find(|&i| h[i..i + n.len()].eq_ignore_ascii_case(n))
}

/// Returns the canonical URL of a page: `<link rel="canonical">` (rel is a
/// case-insensitive token list), then `og:url`, resolved against `page_url`
/// (and `<base href>`), with the fragment stripped. Non-http(s) schemes,
/// template placeholders and host-less URLs are rejected.
pub fn resolve_canonical(html: &str, page_url: Option<&str>) -> Option<String> {
    // Fast path: canonical links live in <head>. Parse only the head when a
    // closing tag is present; fall back to the whole document otherwise.
    if let Some(end) = find_ascii_ci(html, "</head>") {
        let head = &html[..end + "</head>".len()];
        let arena = Arena::from_html(head);
        let m = meta::collect(&arena);
        if let Some(u) = from_meta(&m, page_url) {
            return Some(u);
        }
        if find_ascii_ci(&html[end..], "canonical").is_none()
            && find_ascii_ci(&html[end..], "og:url").is_none()
        {
            return None;
        }
    }
    let arena = Arena::from_html(html);
    let m = meta::collect(&arena);
    from_meta(&m, page_url)
}

#[cfg(test)]
mod tests {
    use super::resolve_canonical;

    #[test]
    fn link_rel_canonical_relative() {
        let html = r#"<html><head><LINK REL="Canonical Alternate" href="/news/story-1#top"></head><body></body></html>"#;
        assert_eq!(
            resolve_canonical(html, Some("https://example.com/news/story-1?utm_source=x"))
                .as_deref(),
            Some("https://example.com/news/story-1")
        );
    }

    #[test]
    fn og_url_fallback() {
        let html = r#"<head><meta property="og:url" content="https://example.org/a/b"></head>"#;
        assert_eq!(resolve_canonical(html, None).as_deref(), Some("https://example.org/a/b"));
    }

    #[test]
    fn link_wins_over_og() {
        let html = r#"<head><meta property="og:url" content="https://example.org/og"><link rel="canonical" href="https://example.org/link"></head>"#;
        assert_eq!(resolve_canonical(html, None).as_deref(), Some("https://example.org/link"));
    }

    #[test]
    fn rejects_garbage() {
        for bad in [
            r#"<link rel="canonical" href="javascript:alert(1)">"#,
            r#"<link rel="canonical" href="mailto:a@b.c">"#,
            r#"<link rel="canonical" href="{{ canonical_url }}">"#,
            r#"<link rel="canonical" href="data:text/html,hi">"#,
            r#"<link rel="canonical" href="">"#,
            r#"<link rel="canonical" href="/relative/without/base">"#,
        ] {
            assert_eq!(resolve_canonical(bad, None), None, "{bad}");
        }
        // Garbage canonical falls through to a valid og:url.
        let html = r#"<head><link rel="canonical" href="ftp://x/y"><meta property="og:url" content="/ok"></head>"#;
        assert_eq!(
            resolve_canonical(html, Some("http://site.test/p")).as_deref(),
            Some("http://site.test/ok")
        );
    }

    #[test]
    fn canonical_in_body_and_base_href() {
        let html = r#"<html><head><base href="https://cdn.example.net/root/"></head><body><link rel="canonical" href="page.html"></body></html>"#;
        assert_eq!(
            resolve_canonical(html, Some("https://example.net/x")).as_deref(),
            Some("https://cdn.example.net/root/page.html")
        );
    }

    #[test]
    fn empty_and_nul_input() {
        assert_eq!(resolve_canonical("", None), None);
        assert_eq!(
            resolve_canonical("\u{0}\u{0}<link rel=canonical href=\u{0}>", Some("https://a.b/")),
            None
        );
    }
}
