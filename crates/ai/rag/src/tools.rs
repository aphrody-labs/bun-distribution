// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 aphrody contributors

//! Agent-facing RAG toolcall implementations (`rag_search`, `rag_context` and
//! `web_ingest`).

use std::{net::IpAddr, sync::Arc, time::Duration};

use aphrody_toolcall::{
    JsonSchema, ToolDefinition, ToolError, ToolExecutor, ToolExposure, ToolOutput, ToolRegistry,
};
use async_trait::async_trait;
use serde::Deserialize;
use serde_json::Value as JsonValue;

use crate::{
    indexer::{IndexOptions, RagIndexer},
    search::{RagSearcher, SearchMode, SearchOptions},
};

/// Tool allowing coding agents to execute hybrid lexical + vector searches.
pub struct RagSearchTool {
    definition: ToolDefinition,
    searcher: Arc<RagSearcher>,
}

impl RagSearchTool {
    /// Create a new `rag_search` tool instance.
    pub fn new(searcher: Arc<RagSearcher>) -> Self {
        let schema = JsonSchema::object(
            [
                (
                    "query".to_string(),
                    JsonSchema::string(Some(
                        "Search query (code terms, symbols, concepts, or natural language \
                         question)."
                            .to_string(),
                    )),
                ),
                (
                    "limit".to_string(),
                    JsonSchema::integer(Some(
                        "Maximum number of matching snippets to return (default: 5, max: 25)."
                            .to_string(),
                    )),
                ),
                (
                    "mode".to_string(),
                    JsonSchema::string(Some(
                        "Retrieval strategy: 'hybrid' (default, RRF fusion), 'lexical' (FTS5 \
                         BM25), or 'vector' (dense embeddings)."
                            .to_string(),
                    )),
                ),
                (
                    "path_prefix".to_string(),
                    JsonSchema::string(Some(
                        "Restrict results to file paths starting with this prefix (e.g. \
                         'crates/cli/')."
                            .to_string(),
                    )),
                ),
                (
                    "rerank".to_string(),
                    JsonSchema::boolean(Some(
                        "Whether to apply cross-encoder reranking if available (default: true)."
                            .to_string(),
                    )),
                ),
            ]
            .into_iter()
            .collect(),
            Some(vec!["query".to_string()]),
            None,
        );

        let definition = ToolDefinition::new(
            "rag_search",
            "Search indexed codebase files and documentation using hybrid retrieval (FTS5 BM25 + \
             dense vector scan + RRF fusion).",
            schema,
        )
        .with_exposure(ToolExposure::Direct);

        Self { definition, searcher }
    }
}

#[async_trait]
impl ToolExecutor for RagSearchTool {
    fn definition(&self) -> &ToolDefinition {
        &self.definition
    }

    async fn handle(&self, arguments: JsonValue) -> Result<ToolOutput, ToolError> {
        let query = arguments.get("query").and_then(JsonValue::as_str).ok_or_else(|| {
            ToolError::InvalidArguments {
                tool: "rag_search".to_string(),
                message: "missing required argument `query` (string)".to_string(),
            }
        })?;

        let limit = arguments
            .get("limit")
            .and_then(JsonValue::as_u64)
            .map(|n| (n as usize).clamp(1, 25))
            .unwrap_or(5);

        let mode = arguments
            .get("mode")
            .and_then(JsonValue::as_str)
            .map(|m| match m {
                "lexical" => SearchMode::Lexical,
                "vector" => SearchMode::Vector,
                _ => SearchMode::Hybrid,
            })
            .unwrap_or(SearchMode::Hybrid);

        let path_prefix =
            arguments.get("path_prefix").and_then(JsonValue::as_str).map(|s| s.to_string());

        let rerank = arguments.get("rerank").and_then(JsonValue::as_bool).unwrap_or(true);

        let opts = SearchOptions {
            limit,
            mode,
            rerank,
            rerank_top_n: limit * 3,
            path_prefix,
            rrf_k: 60.0,
        };

        let result = self.searcher.search(query, &opts).await.map_err(|err| {
            ToolError::Execution { tool: "rag_search".to_string(), message: err.to_string() }
        })?;

        if result.hits.is_empty() {
            return Ok(ToolOutput::ok(format!(
                "No matching content found for `{query}` (served via {:?}, {} candidates \
                 examined).",
                result.mode_served, result.total_candidates
            )));
        }

        let mut out = String::new();
        out.push_str(&format!("### RAG Search Results for `{}`\n", result.query));
        out.push_str(&format!(
            "*Served via {:?} in {}ms ({} total candidates)*\n\n",
            result.mode_served, result.elapsed_ms, result.total_candidates
        ));

        for (i, hit) in result.hits.iter().enumerate() {
            let symbol_hdr = hit
                .chunk
                .symbol
                .as_ref()
                .map(|s| format!(" > `{s}`"))
                .or_else(|| hit.chunk.heading.as_ref().map(|h| format!(" > #{h}")))
                .unwrap_or_default();

            out.push_str(&format!(
                "#### {}. `{}`:L{}-L{}{}\n",
                i + 1,
                hit.chunk.path,
                hit.chunk.start_line,
                hit.chunk.end_line,
                symbol_hdr
            ));
            out.push_str(&format!("*Channel: {} | Score: {:.4}*\n\n", hit.channel, hit.score));
            out.push_str("```\n");
            out.push_str(&hit.chunk.content);
            if !hit.chunk.content.ends_with('\n') {
                out.push('\n');
            }
            out.push_str("```\n\n");
        }

        Ok(ToolOutput::ok(out))
    }
}

/// Tool retrieving a concise `<retrieved_context>` XML/markdown block bounded by a token budget.
pub struct RagContextTool {
    definition: ToolDefinition,
    searcher: Arc<RagSearcher>,
}

impl RagContextTool {
    /// Create a new `rag_context` tool instance.
    pub fn new(searcher: Arc<RagSearcher>) -> Self {
        let schema = JsonSchema::object(
            [
                (
                    "query".to_string(),
                    JsonSchema::string(Some(
                        "Task or question requiring background codebase context.".to_string(),
                    )),
                ),
                (
                    "token_budget".to_string(),
                    JsonSchema::integer(Some(
                        "Maximum token budget for the assembled context block (default: 2000)."
                            .to_string(),
                    )),
                ),
                (
                    "path_prefix".to_string(),
                    JsonSchema::string(Some(
                        "Optional path prefix filter to focus context (e.g. 'crates/')."
                            .to_string(),
                    )),
                ),
                (
                    "mode".to_string(),
                    JsonSchema::string(Some(
                        "Retrieval strategy: 'hybrid' (default), 'lexical', or 'vector'."
                            .to_string(),
                    )),
                ),
                (
                    "rerank".to_string(),
                    JsonSchema::boolean(Some(
                        "Whether to apply the configured reranker (default: true).".to_string(),
                    )),
                ),
                (
                    "rerank_top_n".to_string(),
                    JsonSchema::integer(Some(
                        "Maximum candidates passed to the reranker (default: 15).".to_string(),
                    )),
                ),
            ]
            .into_iter()
            .collect(),
            Some(vec!["query".to_string()]),
            None,
        );

        let definition = ToolDefinition::new(
            "rag_context",
            "Assemble a prompt-ready <retrieved_context> block bounded by token budget for direct \
             model ingestion.",
            schema,
        )
        .with_exposure(ToolExposure::Direct);

        Self { definition, searcher }
    }
}

#[async_trait]
impl ToolExecutor for RagContextTool {
    fn definition(&self) -> &ToolDefinition {
        &self.definition
    }

    async fn handle(&self, arguments: JsonValue) -> Result<ToolOutput, ToolError> {
        let query = arguments.get("query").and_then(JsonValue::as_str).ok_or_else(|| {
            ToolError::InvalidArguments {
                tool: "rag_context".to_string(),
                message: "missing required argument `query` (string)".to_string(),
            }
        })?;

        let token_budget = arguments
            .get("token_budget")
            .and_then(JsonValue::as_u64)
            .map(|n| n as usize)
            .unwrap_or(2000);

        let path_prefix =
            arguments.get("path_prefix").and_then(JsonValue::as_str).map(|s| s.to_string());

        let mode = arguments
            .get("mode")
            .and_then(JsonValue::as_str)
            .map(|mode| match mode {
                "lexical" => SearchMode::Lexical,
                "vector" => SearchMode::Vector,
                _ => SearchMode::Hybrid,
            })
            .unwrap_or(SearchMode::Hybrid);
        let rerank = arguments.get("rerank").and_then(JsonValue::as_bool).unwrap_or(true);
        let rerank_top_n = arguments
            .get("rerank_top_n")
            .and_then(JsonValue::as_u64)
            .map(|value| value.clamp(1, 100) as usize)
            .unwrap_or(15);

        let opts =
            SearchOptions { limit: 15, mode, rerank, rerank_top_n, path_prefix, rrf_k: 60.0 };

        let result = self.searcher.search(query, &opts).await.map_err(|err| {
            ToolError::Execution { tool: "rag_context".to_string(), message: err.to_string() }
        })?;

        let mut accumulated_tokens = 0usize;
        let mut context_block = String::new();
        context_block.push_str("<retrieved_context>\n");

        for hit in result.hits {
            let chunk_tokens = hit.chunk.token_count.max(1);
            if chunk_tokens > token_budget.saturating_sub(accumulated_tokens) {
                continue;
            }

            context_block.push_str(&format!(
                "<file path=\"{}\" lines=\"{}-{}\" channel=\"{}\">\n",
                escape_context(&hit.chunk.path),
                hit.chunk.start_line,
                hit.chunk.end_line,
                escape_context(&hit.channel)
            ));
            context_block.push_str(&escape_context(&hit.chunk.content));
            if !hit.chunk.content.ends_with('\n') {
                context_block.push('\n');
            }
            context_block.push_str("</file>\n");

            accumulated_tokens += chunk_tokens;
        }

        context_block.push_str("</retrieved_context>");

        Ok(ToolOutput::ok(context_block))
    }
}

/// Keep indexed text as data, including literal context delimiters in sources.
fn escape_context(text: &str) -> String {
    text.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;")
}

/// Register both `rag_search` and `rag_context` tools into an agent's [`ToolRegistry`].
pub fn register_rag_tools(registry: &mut ToolRegistry, searcher: Arc<RagSearcher>) {
    let search_tool = Arc::new(RagSearchTool::new(searcher.clone()));
    let _ = registry.register(search_tool);

    let context_tool = Arc::new(RagContextTool::new(searcher));
    let _ = registry.register(context_tool);
}

/// Register the BXC-to-RAG ingestion tool (`web_ingest`).
///
/// Kept separate from [`register_rag_tools`] because writing to the index needs
/// an indexer, which a read-only search surface does not carry.
pub fn register_web_ingest_tool(registry: &mut ToolRegistry, indexer: Arc<RagIndexer>) {
    let _ = registry.register(Arc::new(WebIngestTool::new(indexer)));
}

// ----------------------------------------------------------------------------
// web_ingest — Aphrody OS scrape into the sovereign RAG index
// ----------------------------------------------------------------------------

const WEB_API_URL_ENV: &str = "APHRODY_WEB_API_URL";
const WEB_API_TOKEN_ENV: &str = "APHRODY_WEB_API_TOKEN";
const WEB_API_DEFAULT_URL: &str = "http://127.0.0.1:3007";
const WEB_API_MAX_RESPONSE_BYTES: usize = 8 * 1024 * 1024;

struct WebApiConfig {
    base_url: reqwest::Url,
    token: String,
}

#[derive(Deserialize)]
struct WebPageResponse {
    success: bool,
    data: Option<WebPageData>,
}

#[derive(Deserialize)]
struct WebPageData {
    status: u16,
    markdown: String,
}

fn web_api_config(
    configured_url: Option<String>,
    configured_token: Option<String>,
) -> Result<WebApiConfig, String> {
    let token = configured_token.filter(|token| !token.trim().is_empty()).ok_or_else(|| {
        format!("{WEB_API_TOKEN_ENV} is required to ingest through Aphrody OS Web API")
    })?;
    let base_url = reqwest::Url::parse(configured_url.as_deref().unwrap_or(WEB_API_DEFAULT_URL))
        .map_err(|_| format!("{WEB_API_URL_ENV} must be a loopback HTTP origin"))?;
    let loopback = base_url
        .host_str()
        .and_then(|host| host.parse::<IpAddr>().ok())
        .is_some_and(|address| address.is_loopback());
    if base_url.scheme() != "http"
        || !loopback
        || base_url.path() != "/"
        || base_url.query().is_some()
        || base_url.fragment().is_some()
        || !base_url.username().is_empty()
        || base_url.password().is_some()
    {
        return Err(format!("{WEB_API_URL_ENV} must be a loopback HTTP origin"));
    }
    Ok(WebApiConfig { base_url, token })
}

async fn fetch_os_web_markdown(
    config: WebApiConfig,
    url: &str,
    force: bool,
    budget: Duration,
) -> Result<String, String> {
    let _ = rustls::crypto::ring::default_provider().install_default();
    let mut endpoint = config
        .base_url
        .join("api/v1/page")
        .map_err(|_| "invalid Aphrody OS Web API origin".to_string())?;
    {
        let mut query = endpoint.query_pairs_mut();
        query.append_pair("url", url);
        if force {
            query.append_pair("force", "true");
        }
    }
    let client = reqwest::Client::builder()
        .timeout(budget)
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|_| "could not initialize Aphrody OS Web API client".to_string())?;
    let mut response = client
        .get(endpoint)
        .bearer_auth(config.token)
        .send()
        .await
        .map_err(|_| "Aphrody OS Web API request failed".to_string())?;
    if !response.status().is_success() {
        return Err(format!("Aphrody OS Web API returned HTTP {}", response.status()));
    }
    let mut body = Vec::new();
    while let Some(chunk) =
        response.chunk().await.map_err(|_| "Aphrody OS Web API response failed".to_string())?
    {
        if chunk.len() > WEB_API_MAX_RESPONSE_BYTES.saturating_sub(body.len()) {
            return Err("Aphrody OS Web API page exceeds response limit".to_string());
        }
        body.extend_from_slice(&chunk);
    }
    let page: WebPageResponse = serde_json::from_slice(&body)
        .map_err(|_| "Aphrody OS Web API returned an invalid page".to_string())?;
    let data = page
        .data
        .filter(|data| page.success && (200..300).contains(&data.status))
        .ok_or_else(|| "Aphrody OS Web API did not return a successful page".to_string())?;
    if data.markdown.trim().is_empty() {
        return Err("Aphrody OS Web API returned empty Markdown".to_string());
    }
    Ok(data.markdown)
}

/// Fetch Markdown from the authenticated OS Web API for either AI RAG store.
pub async fn scrape_web_markdown(
    url: &str,
    force: bool,
    budget: Duration,
) -> Result<String, String> {
    let config =
        web_api_config(std::env::var(WEB_API_URL_ENV).ok(), std::env::var(WEB_API_TOKEN_ENV).ok())?;
    fetch_os_web_markdown(config, url, force, budget).await
}

/// Tool that retrieves a URL from OS Web and indexes it into the AI RAG store.
///
/// OS Web owns retrieval and its page index. [`RagIndexer`] owns chunking
/// and embedding. The URL is the document key, so re-ingesting the same page
/// replaces its chunks instead of duplicating them.
pub struct WebIngestTool {
    definition: ToolDefinition,
    indexer: Arc<RagIndexer>,
    budget: Duration,
}

impl WebIngestTool {
    /// Create a new `web_ingest` tool instance.
    #[must_use]
    pub fn new(indexer: Arc<RagIndexer>) -> Self {
        let schema = JsonSchema::object(
            [
                (
                    "url".to_string(),
                    JsonSchema::string(Some("Absolute URL of the page to ingest.".to_string())),
                ),
                (
                    "force".to_string(),
                    JsonSchema::boolean(Some(
                        "Re-index even when the page content is unchanged.".to_string(),
                    )),
                ),
            ]
            .into_iter()
            .collect(),
            Some(vec!["url".to_string()]),
            Some(false.into()),
        );

        let definition = ToolDefinition::new(
            "web_ingest",
            "Retrieve a web page through Aphrody OS and index it into the local RAG store so \
             later rag_search/rag_context calls can retrieve it.",
            schema,
        );

        Self { definition, indexer, budget: Duration::from_secs(90) }
    }
}

#[async_trait]
impl ToolExecutor for WebIngestTool {
    fn definition(&self) -> &ToolDefinition {
        &self.definition
    }

    async fn handle(&self, arguments: JsonValue) -> Result<ToolOutput, ToolError> {
        let url = arguments.get("url").and_then(JsonValue::as_str).ok_or_else(|| {
            ToolError::InvalidArguments {
                tool: "web_ingest".to_string(),
                message: "`url` is required".to_string(),
            }
        })?;
        let force = arguments.get("force").and_then(JsonValue::as_bool).unwrap_or(false);
        let markdown = match scrape_web_markdown(url, force, self.budget).await {
            Ok(markdown) => markdown,
            Err(error) => return Ok(ToolOutput::error(format!("web_ingest: {error}"))),
        };

        let size = i64::try_from(markdown.len()).unwrap_or(i64::MAX);
        let now_ms = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_or(0, |elapsed| i64::try_from(elapsed.as_millis()).unwrap_or(i64::MAX));
        let opts = IndexOptions { force_reindex: force, ..IndexOptions::default() };

        match self.indexer.index_document(url, &markdown, size, now_ms, &opts).await {
            Ok(Some((chunks, vectors))) => Ok(ToolOutput::ok(format!(
                "Indexed {url}: {chunks} chunk(s), {vectors} vector(s), {size} byte(s) of \
                 markdown."
            ))),
            Ok(None) => Ok(ToolOutput::ok(format!(
                "{url} is already indexed with identical content; pass force=true to re-index."
            ))),
            Err(error) => Ok(ToolOutput::error(format!("web_ingest: indexing failed: {error}"))),
        }
    }
}

#[cfg(test)]
mod web_api_tests {
    use std::{
        io::{Read, Write},
        net::TcpListener,
        time::Duration,
    };

    use super::{WebApiConfig, fetch_os_web_markdown, web_api_config};

    #[test]
    fn web_api_requires_token_for_every_store_and_rejects_non_loopback() {
        assert!(web_api_config(None, None).is_err());
        assert!(web_api_config(Some("http://127.0.0.1:3007".into()), None).is_err());
        for url in
            ["http://example.com:3007", "https://127.0.0.1:3007", "http://127.0.0.1:3007/path"]
        {
            assert!(web_api_config(Some(url.into()), Some("secret".into())).is_err());
        }
    }

    async fn request_mock_page(response_json: &str) -> Result<String, String> {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let body = response_json.to_owned();
        let server = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut request = [0_u8; 4096];
            let count = stream.read(&mut request).unwrap();
            let request = String::from_utf8_lossy(&request[..count]);
            assert!(request.starts_with(
                "GET /api/v1/page?url=https%3A%2F%2Fexample.com%2Farticle&force=true HTTP/1.1"
            ));
            assert!(request.to_ascii_lowercase().contains("authorization: bearer test-token\r\n"));
            let reply = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: \
                 {}\r\nConnection: close\r\n\r\n{body}",
                body.len()
            );
            stream.write_all(reply.as_bytes()).unwrap();
        });
        let config = WebApiConfig {
            base_url: format!("http://127.0.0.1:{port}").parse().unwrap(),
            token: "test-token".into(),
        };
        let result = fetch_os_web_markdown(
            config,
            "https://example.com/article",
            true,
            Duration::from_secs(3),
        )
        .await;
        server.join().unwrap();
        result
    }

    #[tokio::test]
    async fn web_api_fetches_os_markdown_and_rejects_failure_body() {
        let markdown = request_mock_page(
            r##"{"success":true,"data":{"status":200,"markdown":"# Real page"}}"##,
        )
        .await
        .unwrap();
        assert_eq!(markdown, "# Real page");
        let error = request_mock_page(r#"{"success":false,"error":"Failed to scrape page"}"#)
            .await
            .unwrap_err();
        assert!(error.contains("did not return a successful page"));
        let error =
            request_mock_page(r#"{"success":true,"data":{"status":500,"markdown":"error"}}"#)
                .await
                .unwrap_err();
        assert!(error.contains("did not return a successful page"));
        let error = request_mock_page(r#"{"success":true,"data":{"status":200,"markdown":" "}}"#)
            .await
            .unwrap_err();
        assert!(error.contains("empty Markdown"));
    }
}
