// SPDX-License-Identifier: Apache-2.0
//! `web_fetch` — HTTP GET/POST a URL and return body + headers.
//!
//! Rust port of `packages/gemini-cli/packages/core/src/tools/web-fetch.ts`.
//! Backed by [`reqwest`] (workspace pin: rustls + no provider — install one
//! globally via `rustls::crypto::ring::default_provider().install_default()`
//! before invoking, as `crates/cli/src/main.rs` already does).
//!
//! Differences vs the TS surface:
//! * No private-IP allow-list yet (SSRF guard belongs in the caller's `aphrody-permissions` policy,
//!   not here).
//! * Body is truncated to `max_bytes` (default 256 KiB).
//! * Returns the raw bytes as UTF-8 when valid, else a base64-encoded payload tagged `binary`.
//!
//! ## Client reuse
//!
//! [`WebFetchTool`] uses a process-wide [`crate::builtin::scraping::ScrapingClient`]
//! initialised on first use via [`std::sync::OnceLock`].  This avoids
//! creating a new TCP + TLS stack per call (minimal-latency project goal).
//! The singleton is constructed with a generous pool limit and TCP keep-alive;
//! per-request timeouts are enforced at the request level.

use std::{collections::HashMap, sync::OnceLock, time::Duration};

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use super::scraping::ScrapingClient;
use crate::{Permission, PermissionDescriptor, Tool, ToolDescriptor, ToolError};

/// Canonical tool name.
pub const NAME: &str = "web_fetch";

/// Default request timeout (matches the gemini-cli 10 s budget).
pub const DEFAULT_TIMEOUT_MS: u64 = 10_000;

/// Default cap on the returned response body (256 KiB).
pub const DEFAULT_MAX_BYTES: usize = 256 * 1024;

/// Default User-Agent header.
///
/// Mirrors Chrome 146 on Windows 11 x64 (see
/// [`crate::builtin::scraping::CHROME146_USER_AGENT`]).  Using a realistic
/// browser UA avoids bot-detection gates that reject CLI-style strings.
pub const DEFAULT_USER_AGENT: &str = super::scraping::CHROME146_USER_AGENT;

/// Process-wide shared scraping client.
///
/// Initialised on first access.  Panics at process start if the rustls
/// provider was not installed before the first `web_fetch` call (same
/// contract as before — `crates/cli/src/main.rs` installs it at boot).
fn shared_client() -> &'static ScrapingClient {
    static CLIENT: OnceLock<ScrapingClient> = OnceLock::new();
    CLIENT.get_or_init(|| {
        ScrapingClient::new(Duration::from_millis(DEFAULT_TIMEOUT_MS)).expect(
            "web_fetch: failed to build shared ScrapingClient — ensure rustls provider is \
             installed",
        )
    })
}

/// Parsed arguments for the `web_fetch` tool.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WebFetchArgs {
    /// URL to fetch. Must be `http(s)://`.
    pub url: String,
    /// HTTP method. Defaults to `GET`. Supported: `GET`, `POST`.
    #[serde(default)]
    pub method: Option<String>,
    /// Optional body (JSON-encoded string for POST). When set, content-type
    /// defaults to `application/json` unless overridden via `headers`.
    #[serde(default)]
    pub body: Option<String>,
    /// Extra headers to send.
    #[serde(default)]
    pub headers: HashMap<String, String>,
    /// Per-request timeout in milliseconds. Defaults to
    /// [`DEFAULT_TIMEOUT_MS`].
    #[serde(default)]
    pub timeout_ms: Option<u64>,
    /// Max bytes to return. Defaults to [`DEFAULT_MAX_BYTES`].
    #[serde(default)]
    pub max_bytes: Option<usize>,
    /// Convert an HTML response to Markdown before returning it.
    ///
    /// Off by default, deliberately. `web_fetch` is a general HTTP verb — its
    /// `body` has always been the bytes the server sent, and POST/API callers
    /// depend on that. Turning conversion on for everyone would quietly change
    /// what an existing caller receives.
    ///
    /// When on, the conversion runs in this process through the canonical
    /// Rust `aphrody-web-extract` library. The `rendering` field identifies the
    /// result so callers can distinguish Markdown from raw HTML.
    #[serde(default)]
    pub markdown: Option<bool>,
}

/// Descriptor for the `web_fetch` tool.
#[must_use]
pub fn descriptor() -> ToolDescriptor {
    ToolDescriptor::new(
        NAME,
        "Fetch an HTTP(S) URL. Defaults to GET; POST with `body` is supported. Returns status, \
         response headers and either a UTF-8 body (truncated to `max_bytes`, default 256 KiB) or \
         a base64-encoded payload for binary responses.",
        json!({
            "type": "object",
            "properties": {
                "url":         {"type": "string"},
                "method":      {"type": "string", "enum": ["GET", "POST"]},
                "body":        {"type": "string"},
                "headers":     {"type": "object"},
                "timeout_ms":  {"type": "integer", "minimum": 1},
                "max_bytes":   {"type": "integer", "minimum": 1},
                "markdown":    {"type": "boolean"}
            },
            "required": ["url"],
            "additionalProperties": false
        }),
    )
    .expect("web_fetch name is valid")
    .dangerous()
    .with_tag("net")
    .with_tag("fetch")
}

/// Implementation handle.
#[derive(Debug, Default, Clone, Copy)]
pub struct WebFetchTool;

#[async_trait]
impl Tool for WebFetchTool {
    fn descriptor(&self) -> ToolDescriptor {
        descriptor()
    }

    fn permission(&self) -> PermissionDescriptor {
        PermissionDescriptor {
            tool_name: NAME.into(),
            scopes: vec!["net:fetch".into()],
            default_permission: Permission::Ask,
        }
    }

    async fn invoke(&self, args: Value) -> Result<Value, ToolError> {
        let parsed: WebFetchArgs =
            serde_json::from_value(args).map_err(|e| ToolError::InvalidArgs(e.to_string()))?;
        if !(parsed.url.starts_with("http://") || parsed.url.starts_with("https://")) {
            return Err(ToolError::InvalidArgs(format!("url must be http(s)://: {}", parsed.url)));
        }
        let method = parsed.method.as_deref().unwrap_or("GET").to_ascii_uppercase();
        if method != "GET" && method != "POST" {
            return Err(ToolError::InvalidArgs(format!("unsupported method: {method}")));
        }
        let timeout = Duration::from_millis(parsed.timeout_ms.unwrap_or(DEFAULT_TIMEOUT_MS));
        let max_bytes = parsed.max_bytes.unwrap_or(DEFAULT_MAX_BYTES);

        // Reuse the process-wide client (shared connection pool).
        // Per-request timeout is applied at the request level via
        // `reqwest::RequestBuilder::timeout`, overriding the client-level
        // default for this call only.
        let client = shared_client().inner();

        let mut req = match method.as_str() {
            "GET" => client.get(&parsed.url).timeout(timeout),
            "POST" => {
                let mut r = client.post(&parsed.url).timeout(timeout);
                if let Some(body) = parsed.body.as_deref() {
                    let has_content_type =
                        parsed.headers.keys().any(|k| k.eq_ignore_ascii_case("content-type"));
                    if !has_content_type {
                        r = r.header("content-type", "application/json");
                    }
                    r = r.body(body.to_string());
                }
                r
            },
            _ => unreachable!("method validated above"),
        };
        for (k, v) in &parsed.headers {
            req = req.header(k.as_str(), v.as_str());
        }

        let resp = req.send().await.map_err(|e| ToolError::Network(e.to_string()))?;
        let status = resp.status().as_u16();
        let mut headers_map = serde_json::Map::new();
        for (k, v) in resp.headers().iter() {
            headers_map.insert(
                k.as_str().to_string(),
                Value::String(v.to_str().unwrap_or("<non-utf8>").to_string()),
            );
        }
        let final_url = resp.url().to_string();
        let bytes = resp.bytes().await.map_err(|e| ToolError::Network(e.to_string()))?;
        let truncated = bytes.len() > max_bytes;
        let slice = if truncated { &bytes[..max_bytes] } else { &bytes[..] };
        let (body_repr, encoding) = match std::str::from_utf8(slice) {
            Ok(s) => (Value::String(s.to_string()), "utf-8"),
            Err(_) => {
                use base64::Engine;
                let b64 = base64::engine::general_purpose::STANDARD.encode(slice);
                (Value::String(b64), "base64")
            },
        };

        let content_type = headers_map.get("content-type").and_then(Value::as_str).unwrap_or("");
        let (body_repr, rendering) =
            render_body(body_repr, encoding, content_type, parsed.markdown.unwrap_or(false));

        Ok(json!({
            "url":        final_url,
            "status":     status,
            "headers":    Value::Object(headers_map),
            "encoding":   encoding,
            "body":       body_repr,
            "bytes":      bytes.len(),
            "truncated":  truncated,
            "rendering":  rendering,
        }))
    }
}

/// Decide what `body` holds, and say so.
///
/// Convert HTML through the canonical Rust extractor in this process. The
/// legacy `via` marker remains stable for existing callers; `backend` records
/// the current implementation.
///
/// The returned `rendering` object is not decoration. A caller handed a `body`
/// with no label cannot tell Markdown from HTML that failed to convert, and a
/// model in that position quotes `<div>` at the user. So every branch names
/// itself, and the failing branch also carries the fix.
fn render_body(
    body: Value,
    encoding: &str,
    content_type: &str,
    want_markdown: bool,
) -> (Value, Value) {
    let lower = content_type.to_ascii_lowercase();
    let is_html = lower.contains("text/html") || lower.contains("application/xhtml");

    if !is_html || encoding != "utf-8" {
        return (
            body,
            json!({
                "kind": "verbatim",
                "reason": "response is not UTF-8 HTML",
            }),
        );
    }
    if !want_markdown {
        // HTML that the caller did not ask to convert. Saying that conversion
        // is available is what stops the next reader assuming it is not.
        return (
            body,
            json!({
                "kind": "raw-html",
                "reason": "pass `markdown: true` to convert in-process",
            }),
        );
    }

    let Some(html) = body.as_str() else {
        return (body, json!({"kind": "verbatim", "reason": "body is not a string"}));
    };
    let markdown = aphrody_web_extract::html_to_markdown(html, None);
    (
        Value::String(markdown),
        json!({
            "kind": "markdown",
            "via": "bxc_rust_bridge:bxc_html_to_markdown",
            "backend": "aphrody-web-extract",
        }),
    )
}

#[cfg(test)]
mod tests {
    use std::sync::Once;

    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    use super::*;

    /// Install the rustls ring crypto provider exactly once. Required at
    /// runtime because the workspace pin uses `rustls-no-provider`.
    /// In production, `crates/cli/src/main.rs` does this at boot; tests
    /// must do it themselves.
    fn ensure_rustls_provider() {
        static INSTALL: Once = Once::new();
        INSTALL.call_once(|| {
            let _ = rustls::crypto::ring::default_provider().install_default();
        });
    }

    /// Bind a TCP listener on 127.0.0.1:0 and respond to one incoming HTTP
    /// request with the supplied raw response payload. Returns the bound
    /// port. Suitable for offline-only `web_fetch` smoke tests — no TLS,
    /// no axum, no reqwest provider dance.
    async fn spawn_oneshot_http(response: &'static [u8]) -> std::io::Result<u16> {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await?;
        let port = listener.local_addr()?.port();
        tokio::spawn(async move {
            if let Ok((mut sock, _)) = listener.accept().await {
                let mut buf = [0u8; 4096];
                // Consume the request line + headers (best-effort).
                let _ = sock.read(&mut buf).await;
                let _ = sock.write_all(response).await;
                let _ = sock.shutdown().await;
            }
        });
        Ok(port)
    }

    #[tokio::test]
    async fn invoke_get_returns_body() {
        ensure_rustls_provider();
        let port = spawn_oneshot_http(
            b"HTTP/1.1 200 OK\r\nContent-Length: 5\r\nContent-Type: text/plain\r\n\r\nhello",
        )
        .await
        .unwrap();
        let tool = WebFetchTool;
        let v = tool
            .invoke(json!({
                "url": format!("http://127.0.0.1:{port}/x"),
                "timeout_ms": 3000
            }))
            .await
            .unwrap();
        assert_eq!(v.get("status").and_then(Value::as_u64), Some(200));
        assert_eq!(v.get("body").and_then(Value::as_str), Some("hello"));
        assert_eq!(v.get("encoding").and_then(Value::as_str), Some("utf-8"));
    }

    /// Serve one HTML page and return the tool result.
    async fn fetch_html(markdown: bool) -> Value {
        ensure_rustls_provider();
        const HTML: &str = "<html><head><title>T</title><style>b{color:red}</style></\
                            head><body><h1>Heading</h1><p>Prose.</p></body></html>";
        let response = format!(
            "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nContent-Type: text/html; \
             charset=utf-8\r\n\r\n{HTML}",
            HTML.len()
        );
        let leaked: &'static [u8] = Box::leak(response.into_bytes().into());
        let port = spawn_oneshot_http(leaked).await.unwrap();
        WebFetchTool
            .invoke(json!({
                "url": format!("http://127.0.0.1:{port}/page"),
                "timeout_ms": 3000,
                "markdown": markdown,
            }))
            .await
            .expect("the fetch itself must succeed")
    }

    /// The default is unchanged: `body` is still the bytes the server sent.
    /// Silently converting for every existing caller would be a contract
    /// change nobody asked for — but the result must still *say* that HTML is
    /// what came back, and that conversion is on offer.
    #[tokio::test]
    async fn html_is_returned_verbatim_unless_markdown_is_requested() {
        let v = fetch_html(false).await;
        assert!(
            v.get("body").and_then(Value::as_str).is_some_and(|b| b.contains("<h1>")),
            "the default must not convert: {v:?}"
        );
        let rendering = v.get("rendering").expect("every response is labelled");
        assert_eq!(rendering.get("kind").and_then(Value::as_str), Some("raw-html"));
        assert!(
            rendering.get("reason").and_then(Value::as_str).is_some_and(|r| r.contains("markdown")),
            "the label must mention that conversion exists: {rendering:?}"
        );
    }

    /// With conversion asked for, the canonical Rust extractor runs in process.
    #[tokio::test]
    async fn requested_markdown_is_produced_in_process() {
        let v = fetch_html(true).await;
        let rendering = v.get("rendering").expect("every response is labelled");
        let body = v.get("body").and_then(Value::as_str).unwrap_or_default();
        assert!(!body.contains("<h1>"), "raw markup survived: {body}");
        assert!(body.contains("Heading"), "content was lost: {body}");
        assert_eq!(rendering.get("kind").and_then(Value::as_str), Some("markdown"));
        assert_eq!(rendering.get("backend").and_then(Value::as_str), Some("aphrody-web-extract"));
        assert_eq!(
            rendering.get("via").and_then(Value::as_str),
            Some("bxc_rust_bridge:bxc_html_to_markdown"),
            "the compatibility operation must stay stable: {rendering:?}"
        );
    }

    /// A non-HTML response must never be run through an HTML converter.
    #[tokio::test]
    async fn non_html_is_labelled_verbatim_even_when_markdown_is_asked_for() {
        let (body, rendering) =
            render_body(Value::String("{\"ok\":true}".into()), "utf-8", "application/json", true);
        assert_eq!(body.as_str(), Some("{\"ok\":true}"));
        assert_eq!(rendering.get("kind").and_then(Value::as_str), Some("verbatim"));
    }

    /// Base64 bodies are bytes, not documents.
    #[tokio::test]
    async fn binary_bodies_are_never_treated_as_html() {
        let (_, rendering) = render_body(Value::String("AAAA".into()), "base64", "text/html", true);
        assert_eq!(rendering.get("kind").and_then(Value::as_str), Some("verbatim"));
    }

    #[tokio::test]
    async fn invoke_rejects_non_http_url() {
        let tool = WebFetchTool;
        let err = tool.invoke(json!({"url": "ftp://example.com/x"})).await.expect_err("must fail");
        assert!(matches!(err, ToolError::InvalidArgs(_)));
    }

    #[tokio::test]
    async fn invoke_rejects_unsupported_method() {
        let tool = WebFetchTool;
        let err = tool
            .invoke(json!({
                "url": "http://127.0.0.1:9/none",
                "method": "DELETE"
            }))
            .await
            .expect_err("must fail");
        assert!(matches!(err, ToolError::InvalidArgs(_)));
    }

    #[tokio::test]
    async fn invoke_truncates_long_body() {
        ensure_rustls_provider();
        // 16 KiB body, cap = 1 KiB.
        let body = "a".repeat(16 * 1024);
        let response = format!(
            "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nContent-Type: text/plain\r\n\r\n{}",
            body.len(),
            body
        );
        // Leak to get a 'static slice for the spawn helper.
        let leaked: &'static [u8] = Box::leak(response.into_bytes().into());
        let port = spawn_oneshot_http(leaked).await.unwrap();
        let tool = WebFetchTool;
        let v = tool
            .invoke(json!({
                "url": format!("http://127.0.0.1:{port}/"),
                "max_bytes": 1024,
                "timeout_ms": 3000
            }))
            .await
            .unwrap();
        assert_eq!(v.get("truncated").and_then(Value::as_bool), Some(true));
        let body_str = v.get("body").and_then(Value::as_str).unwrap();
        assert_eq!(body_str.len(), 1024);
    }
}
