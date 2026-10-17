// SPDX-License-Identifier: Apache-2.0
//! Aphrody Web extraction and link unfurling for Discord with SSRF protection.

use anyhow::{Context, Result, bail};
use reqwest::Client;
use std::time::Duration;

use crate::types::{Embed, EmbedAuthor, EmbedField, EmbedFooter, EmbedThumbnail};

/// SSRF protection: verify URL is an HTTP/HTTPS endpoint that is not a local name or a
/// loopback/private/link-local/CGNAT literal address. Host names are not resolved, so a public
/// name pointing at a private address is not caught here.
pub fn is_safe_public_url(url_str: &str) -> bool {
    let Ok(url) = reqwest::Url::parse(url_str) else {
        return false;
    };
    is_safe_public_parsed(&url)
}

fn is_safe_public_parsed(url: &reqwest::Url) -> bool {
    if url.scheme() != "http" && url.scheme() != "https" {
        return false;
    }

    let Some(host) = url.host_str() else {
        return false;
    };
    // IPv6 literals keep their brackets in `host_str`.
    let literal = host.strip_prefix('[').and_then(|h| h.strip_suffix(']')).unwrap_or(host);
    match literal.parse::<std::net::IpAddr>() {
        Err(_) => {
            let host_lower = host.to_ascii_lowercase();
            let host_lower = host_lower.trim_end_matches('.');
            !(host_lower == "localhost"
                || host_lower.ends_with(".localhost")
                || host_lower.ends_with(".local")
                || host_lower.ends_with(".internal"))
        },
        Ok(std::net::IpAddr::V4(v4)) => is_public_v4(v4),
        Ok(std::net::IpAddr::V6(v6)) => {
            if let Some(v4) = v6.to_ipv4_mapped() {
                return is_public_v4(v4);
            }
            let first = v6.segments()[0];
            !(v6.is_loopback()
                || v6.is_unspecified()
                || (first & 0xfe00) == 0xfc00 // unique local fc00::/7
                || (first & 0xffc0) == 0xfe80) // link-local fe80::/10
        },
    }
}

fn is_public_v4(v4: std::net::Ipv4Addr) -> bool {
    let [a, b, ..] = v4.octets();
    !(v4.is_loopback()
        || v4.is_private()
        || v4.is_link_local() // includes 169.254.169.254 cloud metadata
        || v4.is_broadcast()
        || v4.is_unspecified()
        || a == 0
        || (a == 100 && (64..128).contains(&b))) // CGNAT 100.64.0.0/10
}

#[derive(Debug, Clone)]
pub struct WebPageSummary {
    pub url: String,
    pub title: String,
    pub description: String,
    pub canonical_url: Option<String>,
    pub markdown_content: String,
    pub image_url: Option<String>,
}

/// Safely fetches and extracts a web page into structured metadata and markdown.
pub async fn fetch_and_extract_web(url: &str) -> Result<WebPageSummary> {
    if !is_safe_public_url(url) {
        bail!("URL rejected by Aphrody SSRF guard: {url}");
    }

    let client = Client::builder()
        .timeout(Duration::from_secs(10))
        .redirect(reqwest::redirect::Policy::custom(|attempt| {
            if attempt.previous().len() >= 5 {
                attempt.error("too many redirects")
            } else if !is_safe_public_parsed(attempt.url()) {
                attempt.error("redirect target rejected by Aphrody SSRF guard")
            } else {
                attempt.follow()
            }
        }))
        .build()?;

    let response = client
        .get(url)
        .header(reqwest::header::USER_AGENT, "AphrodyWebBot/1.0 (+https://aphrody.com)")
        .send()
        .await
        .with_context(|| format!("Failed to fetch URL: {url}"))?;

    let final_url = response.url().to_string();
    let html = response.text().await.context("Failed to read HTML body")?;

    #[cfg(feature = "web-extract")]
    {
        use aphrody_web_extract::{extract_main, extract_metadata, html_to_markdown};

        let parsed_base = reqwest::Url::parse(&final_url).ok();
        let meta = extract_metadata(&html, parsed_base.as_ref());
        let extracted = extract_main(&html, Some(&final_url));

        let title = meta.title.unwrap_or_else(|| {
            if !extracted.title.is_empty() {
                extracted.title.clone()
            } else {
                "Web Page".to_string()
            }
        });

        let description = meta.description.unwrap_or_else(|| {
            if extracted.markdown.len() > 250 {
                format!("{}…", crate::types::clip(&extracted.markdown, 250))
            } else {
                extracted.markdown.clone()
            }
        });

        let markdown = if !extracted.markdown.is_empty() {
            extracted.markdown
        } else {
            html_to_markdown(&html, Some(&final_url))
        };

        Ok(WebPageSummary {
            url: final_url,
            title,
            description,
            canonical_url: meta.canonical_url.map(|u| u.to_string()),
            markdown_content: markdown,
            image_url: None,
        })
    }

    #[cfg(not(feature = "web-extract"))]
    {
        Ok(WebPageSummary {
            url: final_url,
            title: "Web Page".to_string(),
            description: format!("Raw HTML fetched ({} bytes)", html.len()),
            canonical_url: None,
            markdown_content: html,
            image_url: None,
        })
    }
}

/// Builds a rich Discord Embed representing a web page unfurl.
pub fn build_web_embed(summary: &WebPageSummary) -> Embed {
    let excerpt = if summary.markdown_content.len() > 1500 {
        format!("{}… *(truncated)*", crate::types::clip(&summary.markdown_content, 1500))
    } else {
        summary.markdown_content.clone()
    };

    let thumbnail = summary.image_url.as_ref().map(|url| EmbedThumbnail { url: url.clone() });

    let mut fields = Vec::new();
    if let Some(ref canon) = summary.canonical_url {
        fields.push(EmbedField {
            name: "Canonical URL".to_string(),
            value: format!("<{canon}>"),
            inline: false,
        });
    }

    Embed {
        title: Some(summary.title.clone()),
        url: Some(summary.url.clone()),
        description: Some(format!("{}\n\n**Article Summary:**\n{}", summary.description, excerpt)),
        color: Some(0x10B981), // Emerald green
        author: Some(EmbedAuthor {
            name: "Aphrody Web Engine".to_string(),
            url: Some("https://aphrody.com".to_string()),
            icon_url: None,
        }),
        thumbnail,
        fields,
        footer: Some(EmbedFooter {
            text: "Aphrody Obscura Web · SSRF Guarded".to_string(),
            icon_url: None,
        }),
        ..Default::default()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_ssrf_guard() {
        assert!(!is_safe_public_url("http://localhost:8080"));
        assert!(!is_safe_public_url("http://127.0.0.1:3000"));
        assert!(!is_safe_public_url("http://10.200.77.1"));
        assert!(!is_safe_public_url("http://192.168.1.1"));
        assert!(!is_safe_public_url("http://169.254.169.254/latest/meta-data"));
        assert!(!is_safe_public_url("file:///etc/passwd"));
        assert!(!is_safe_public_url("http://[::1]:8080/"));
        assert!(!is_safe_public_url("http://[::ffff:127.0.0.1]/"));
        assert!(!is_safe_public_url("http://[fd00::1]/"));
        assert!(!is_safe_public_url("http://100.64.0.1/"));
        assert!(!is_safe_public_url("http://localhost./"));
        assert!(is_safe_public_url("https://aphrody.com"));
        assert!(is_safe_public_url("https://github.com/aphrody-labs/aphrody"));
    }
}
