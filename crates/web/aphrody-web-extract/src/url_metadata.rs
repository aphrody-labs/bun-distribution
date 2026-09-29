// SPDX-License-Identifier: Apache-2.0
//! URL and metadata API retained from the first local Rust extraction slice.

use thiserror::Error;
use url::{ParseError, Url};

use crate::{canonical, dom, meta};

/// Options for normalizing a URL before it is stored or deduplicated.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct UrlNormalizationOptions {
    /// Remove the query string. Leave false when query parameters may change
    /// the resource representation.
    pub drop_query: bool,
    /// Remove trailing path slashes, except for the origin root.
    pub trim_trailing_slash: bool,
}

/// A URL that could not be normalized for a crawl or page record.
#[derive(Debug, Error)]
pub enum UrlNormalizationError {
    /// A relative reference needs a base URL.
    #[error("relative URL reference requires a base URL")]
    MissingBase,
    /// The reference or its base could not be parsed or resolved.
    #[error("invalid URL: {0}")]
    Invalid(#[from] ParseError),
    /// Crawled page URLs must use HTTP or HTTPS.
    #[error("unsupported URL scheme `{0}`; only http and https are accepted")]
    UnsupportedScheme(String),
    /// URLs containing credentials are not followed or stored.
    #[error("URLs containing user information are not accepted")]
    UserInformation,
}

/// Resolves and normalizes an HTTP(S) URL using the WHATWG URL behavior of
/// [`url::Url`]. Fragments are always removed. Query strings and trailing
/// slashes are preserved unless explicitly disabled through `options`.
pub fn normalize_page_url(
    reference: &str,
    base: Option<&Url>,
    options: UrlNormalizationOptions,
) -> Result<Url, UrlNormalizationError> {
    let reference = reference.trim();
    let mut url = match Url::parse(reference) {
        Ok(url) => url,
        Err(ParseError::RelativeUrlWithoutBase) => {
            let base = base.ok_or(UrlNormalizationError::MissingBase)?;
            base.join(reference)?
        },
        Err(error) => return Err(error.into()),
    };

    if !matches!(url.scheme(), "http" | "https") {
        return Err(UrlNormalizationError::UnsupportedScheme(url.scheme().to_owned()));
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err(UrlNormalizationError::UserInformation);
    }

    url.set_fragment(None);
    if options.drop_query {
        url.set_query(None);
    }
    if options.trim_trailing_slash && url.path() != "/" && url.path().ends_with('/') {
        let trimmed_path = url.path().trim_end_matches('/').to_owned();
        url.set_path(&trimmed_path);
    }

    Ok(url)
}

/// Metadata extracted from a static HTML document.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct PageMetadata {
    /// The document title, with Open Graph and first heading fallbacks.
    pub title: Option<String>,
    /// The standard meta description, with Open Graph fallback.
    pub description: Option<String>,
    /// The resolved canonical link, when it is a valid HTTP(S) URL.
    pub canonical_url: Option<Url>,
}

/// Extracts title, description, and canonical URL metadata from HTML.
///
/// A relative canonical link is resolved against `base_url`. The same
/// Obscura DOM and metadata collector used by the full extractor owns parsing.
#[must_use]
pub fn extract_metadata(html: &str, base_url: Option<&Url>) -> PageMetadata {
    let arena = dom::Arena::from_html(html);
    let metadata = meta::collect(&arena);
    let title =
        metadata.title_tag.clone().or_else(|| metadata.get("og:title").map(str::to_owned)).or_else(
            || {
                arena.nodes.iter().enumerate().find_map(|(index, node)| {
                    if node.kind == dom::Kind::Element && node.tag == dom::Tag::H(1) {
                        clean_text(arena.raw_text(index as u32))
                    } else {
                        None
                    }
                })
            },
        );
    let description = metadata
        .get("description")
        .or_else(|| metadata.get("og:description"))
        .map(str::to_owned)
        .and_then(clean_text);
    let canonical_url =
        canonical::from_meta(&metadata, base_url.map(Url::as_str)).and_then(|href| {
            normalize_page_url(&href, base_url, UrlNormalizationOptions::default()).ok()
        });

    PageMetadata { title, description, canonical_url }
}

fn clean_text(value: String) -> Option<String> {
    let text = value.split_whitespace().collect::<Vec<_>>().join(" ");
    (!text.is_empty()).then_some(text)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_absolute_url_and_removes_default_port_and_fragment() {
        let url = normalize_page_url(
            "HTTPS://Example.COM:443/Foo#section",
            None,
            UrlNormalizationOptions::default(),
        )
        .unwrap();

        assert_eq!(url.as_str(), "https://example.com/Foo");
    }

    #[test]
    fn resolves_and_normalizes_relative_reference_with_explicit_options() {
        let base = Url::parse("https://example.com/guide/index.html").unwrap();
        let url = normalize_page_url(
            " ../api/v2/?utm_source=docs#intro ",
            Some(&base),
            UrlNormalizationOptions { drop_query: true, trim_trailing_slash: true },
        )
        .unwrap();

        assert_eq!(url.as_str(), "https://example.com/api/v2");
    }

    #[test]
    fn preserves_query_and_root_slash_by_default() {
        let url = normalize_page_url(
            "http://example.com/?page=2#top",
            None,
            UrlNormalizationOptions::default(),
        )
        .unwrap();

        assert_eq!(url.as_str(), "http://example.com/?page=2");
    }

    #[test]
    fn rejects_relative_without_base_credentials_and_non_http_schemes() {
        assert!(matches!(
            normalize_page_url("/relative", None, UrlNormalizationOptions::default()),
            Err(UrlNormalizationError::MissingBase)
        ));
        assert!(matches!(
            normalize_page_url(
                "https://user:secret@example.com/",
                None,
                UrlNormalizationOptions::default()
            ),
            Err(UrlNormalizationError::UserInformation)
        ));
        assert!(matches!(
            normalize_page_url("javascript:alert(1)", None, UrlNormalizationOptions::default()),
            Err(UrlNormalizationError::UnsupportedScheme(_))
        ));
    }

    #[test]
    fn extracts_metadata_and_resolves_canonical_link() {
        let base = Url::parse("https://example.com/catalog/item").unwrap();
        let metadata = extract_metadata(
            r#"<html><head>
                <title>  Example   item </title>
                <meta name="description" content=" A useful &amp; concise description ">
                <link rel="alternate canonical" href="../item?sku=4#details">
            </head><body><h1>Fallback title</h1></body></html>"#,
            Some(&base),
        );

        assert_eq!(metadata.title.as_deref(), Some("Example item"));
        assert_eq!(metadata.description.as_deref(), Some("A useful & concise description"));
        assert_eq!(metadata.canonical_url.unwrap().as_str(), "https://example.com/item?sku=4");
    }

    #[test]
    fn falls_back_to_open_graph_and_heading_metadata() {
        let metadata = extract_metadata(
            r#"<meta property="og:title" content="Social title">
               <meta property="og:description" content="Summary">
               <h1>Heading title</h1>"#,
            None,
        );

        assert_eq!(metadata.title.as_deref(), Some("Social title"));
        assert_eq!(metadata.description.as_deref(), Some("Summary"));
        assert_eq!(metadata.canonical_url, None);
    }
}
