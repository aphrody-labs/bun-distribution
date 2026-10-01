// SPDX-License-Identifier: Apache-2.0
//! MediaWiki full-text search through the same Action API transport as the crawler.

#[path = "wiki_page.rs"]
mod wiki_page;

pub use wiki_page::{
    WikiImage, WikiInfobox, WikiInfoboxValue, WikiPageDossier, WikiPageOptions, WikiPageSection,
    WikiTable, page_dossier, page_markdown, parse_infobox, parse_tables,
};

use obscura_net::ObscuraHttpClient;
use serde_json::Value;
use url::Url;

use crate::mediawiki::{
    MediaWikiError, MediaWikiOptions, api_error, request_json, validate_options,
};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WikiSearchHit {
    pub title: String,
    pub url: Url,
    pub size: Option<u64>,
}

/// Returns at most 100 results with canonical page URLs supplied by MediaWiki.
/// The page-info generator combines search and URL resolution in one request.
pub async fn search_mediawiki(
    client: &ObscuraHttpClient,
    options: &MediaWikiOptions,
    query: &str,
    limit: usize,
) -> Result<Vec<WikiSearchHit>, MediaWikiError> {
    validate_options(options)?;
    if query.trim().is_empty() || limit == 0 {
        return Ok(Vec::new());
    }
    if limit > 100 {
        return Err(MediaWikiError::InvalidOptions("search limit must be at most 100".into()));
    }
    let params = [
        ("action", "query".to_owned()),
        ("format", "json".to_owned()),
        ("formatversion", "2".to_owned()),
        ("generator", "search".to_owned()),
        ("gsrsearch", query.trim().to_owned()),
        ("gsrlimit", limit.to_string()),
        ("gsrnamespace", "0".to_owned()),
        ("prop", "info".to_owned()),
        ("inprop", "url".to_owned()),
    ];
    let response = request_json(client, options, &params, &mut None).await?;
    parse_search_response(&response, limit)
}

fn parse_search_response(
    response: &Value,
    limit: usize,
) -> Result<Vec<WikiSearchHit>, MediaWikiError> {
    if let Some(message) = api_error(response) {
        return Err(MediaWikiError::Api(message));
    }
    let Some(pages) = response.pointer("/query/pages") else {
        if response.get("batchcomplete").and_then(Value::as_bool) == Some(true)
            && response.get("query").is_none()
        {
            return Ok(Vec::new());
        }
        return Err(MediaWikiError::InvalidResponse("search query.pages is missing".into()));
    };
    let pages = pages.as_array().ok_or_else(|| {
        MediaWikiError::InvalidResponse("search query.pages must be an array".into())
    })?;
    let mut ranked = Vec::with_capacity(pages.len());
    for page in pages {
        let title = page
            .get("title")
            .and_then(Value::as_str)
            .filter(|title| !title.is_empty())
            .ok_or_else(|| {
                MediaWikiError::InvalidResponse("search page title is missing".into())
            })?;
        let raw_url = page.get("fullurl").and_then(Value::as_str).ok_or_else(|| {
            MediaWikiError::InvalidResponse("search page fullurl is missing".into())
        })?;
        let url = Url::parse(raw_url).map_err(|error| {
            MediaWikiError::InvalidResponse(format!("search page URL: {error}"))
        })?;
        if !matches!(url.scheme(), "https" | "http")
            || !url.username().is_empty()
            || url.password().is_some()
        {
            return Err(MediaWikiError::InvalidResponse(
                "search page URL must be credential-free HTTP(S)".into(),
            ));
        }
        let rank = page.get("index").and_then(Value::as_u64).unwrap_or(u64::MAX);
        ranked.push((
            rank,
            WikiSearchHit {
                title: title.to_owned(),
                url,
                size: page.get("length").and_then(Value::as_u64),
            },
        ));
    }
    ranked.sort_by_key(|(rank, _)| *rank);
    Ok(ranked.into_iter().take(limit).map(|(_, hit)| hit).collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[tokio::test]
    async fn search_uses_the_shared_http_transport_and_encodes_api_parameters() {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.expect("listener");
        let address = listener.local_addr().expect("address");
        let server = tokio::spawn(async move {
            let (mut stream, _) = listener.accept().await.expect("accept");
            let mut request = Vec::new();
            let mut buffer = [0_u8; 1024];
            while !request.windows(4).any(|window| window == b"\r\n\r\n") {
                let count = stream.read(&mut buffer).await.expect("read request");
                assert!(count > 0 && request.len() < 16_384, "incomplete HTTP request");
                request.extend_from_slice(&buffer[..count]);
            }
            let body = json!({"query":{"pages":[{
                "title":"Goku", "fullurl":"https://wiki.example/w/index.php?title=Goku",
                "length":42, "index":1
            }]}})
            .to_string();
            let response = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                body.len()
            );
            stream.write_all(response.as_bytes()).await.expect("response");
            String::from_utf8(request).expect("request encoding")
        });
        let api = Url::parse(&format!("http://{address}/custom/api.php")).expect("api URL");
        let mut client = ObscuraHttpClient::new();
        client.allow_private_network = true;
        client.timeout = std::time::Duration::from_secs(2);
        let hits = search_mediawiki(&client, &MediaWikiOptions::new(api), "Goku & Vegeta", 2)
            .await
            .expect("search");
        assert_eq!(hits[0].url.as_str(), "https://wiki.example/w/index.php?title=Goku");
        let request = server.await.expect("server");
        let path =
            request.lines().next().expect("request line").split_whitespace().nth(1).expect("path");
        let url = Url::parse(&format!("http://{address}{path}")).expect("request URL");
        assert_eq!(url.path(), "/custom/api.php");
        let params = url.query_pairs().into_owned().collect::<std::collections::HashMap<_, _>>();
        assert_eq!(params.get("gsrsearch").map(String::as_str), Some("Goku & Vegeta"));
        assert_eq!(params.get("gsrlimit").map(String::as_str), Some("2"));
        assert_eq!(params.get("generator").map(String::as_str), Some("search"));
        assert_eq!(params.get("inprop").map(String::as_str), Some("url"));
    }

    #[test]
    fn search_retains_api_ranking_and_real_page_urls() {
        let results = parse_search_response(&json!({"query":{"pages":[
            {"title":"Second","fullurl":"https://wiki.example/index.php?title=Second","length":80,"index":2},
            {"title":"First","fullurl":"https://wiki.example/fr/wiki/First","length":40,"index":1}
        ]}}), 1).expect("search response");
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].title, "First");
        assert_eq!(results[0].url.as_str(), "https://wiki.example/fr/wiki/First");
        assert_eq!(results[0].size, Some(40));
    }

    #[test]
    fn empty_results_require_a_complete_api_response() {
        assert!(
            parse_search_response(&json!({"batchcomplete":true}), 10)
                .expect("empty search")
                .is_empty()
        );
        assert!(parse_search_response(&json!({}), 10).is_err());
        assert!(
            parse_search_response(
                &json!({"error":{"code":"ratelimited","info":"retry later"}}),
                10
            )
            .is_err()
        );
    }

    #[test]
    fn invalid_page_urls_and_missing_titles_are_not_empty_successes() {
        for page in [
            json!({"title":"Bad","fullurl":"file:///tmp/private"}),
            json!({"title":"Bad","fullurl":"https://user:password@wiki.example/wiki/Bad"}),
            json!({"fullurl":"https://wiki.example/wiki/Bad"}),
        ] {
            assert!(parse_search_response(&json!({"query":{"pages":[page]}}), 10).is_err());
        }
    }
}
