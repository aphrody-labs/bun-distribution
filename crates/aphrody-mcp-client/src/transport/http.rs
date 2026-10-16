// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 aphrody contributors

//! Streamable HTTP transport for MCP servers.

use std::{collections::BTreeMap, time::Duration};

use async_trait::async_trait;
use futures_util::StreamExt;
use reqwest::header::{ACCEPT, AUTHORIZATION, CONTENT_TYPE, HeaderMap, HeaderName, HeaderValue};
use serde_json::Value as JsonValue;

use super::Transport;
use crate::{
    error::{McpClientError, Result},
    protocol::{jsonrpc_notification, jsonrpc_request, parse_response, parse_server_info},
};

/// `Accept` value mandated by the streamable HTTP transport: the server answers with either a
/// single JSON body or an event stream, and spec-compliant servers reject a request that does not
/// list both.
const ACCEPT_VALUE: &str = "application/json, text/event-stream";

/// Longest response body kept in an [`McpClientError::HttpStatus`] message.
const MAX_ERROR_BODY_CHARS: usize = 1024;

/// Bound decoded JSON/SSE bytes, including heartbeats and unrelated events.
const MAX_RESPONSE_BYTES: usize = 32 * 1024 * 1024;

/// Upper bound for a fire-and-forget notification round trip.
const NOTIFY_TIMEOUT: Duration = Duration::from_secs(30);

/// HTTP framing only: JSON-RPC validation stays in the shared protocol owner.
#[derive(Default)]
struct SseResponse {
    line: Vec<u8>,
    data: String,
    has_data: bool,
    skip_lf: bool,
    started: bool,
}

impl SseResponse {
    fn push(&mut self, chunk: &[u8], expected_id: u64) -> Result<Option<String>> {
        for &byte in chunk {
            if self.skip_lf {
                self.skip_lf = false;
                if byte == b'\n' {
                    continue;
                }
            }
            if byte != b'\r' && byte != b'\n' {
                self.line.push(byte);
                continue;
            }
            self.skip_lf = byte == b'\r';
            let line = std::mem::take(&mut self.line);
            let line = std::str::from_utf8(&line)
                .map_err(|_| McpClientError::Malformed("MCP SSE is not UTF-8".to_owned()))?;
            let line = if self.started {
                line
            } else {
                self.started = true;
                line.strip_prefix('\u{feff}').unwrap_or(line)
            };
            if line.is_empty() {
                self.has_data = false;
                let data = std::mem::take(&mut self.data);
                if data.trim().is_empty() {
                    continue;
                }
                let message: JsonValue = serde_json::from_str(&data).map_err(|_| {
                    McpClientError::Malformed("invalid JSON in MCP SSE event".to_owned())
                })?;
                if message.get("id") == Some(&JsonValue::from(expected_id)) {
                    return Ok(Some(data));
                }
            } else if let Some(data) =
                line.strip_prefix("data:").or_else(|| (line == "data").then_some(""))
            {
                if self.has_data {
                    self.data.push('\n');
                }
                self.has_data = true;
                self.data.push_str(data.strip_prefix(' ').unwrap_or(data));
            }
        }
        Ok(None)
    }
}

async fn response_text(response: reqwest::Response, expected_id: Option<u64>) -> Result<String> {
    if response.content_length().is_some_and(|bytes| bytes > MAX_RESPONSE_BYTES as u64) {
        return Err(McpClientError::Malformed(
            "MCP HTTP response exceeds its byte limit".to_owned(),
        ));
    }
    let sse_id = expected_id.filter(|_| {
        response
            .headers()
            .get(CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .and_then(|value| value.split(';').next())
            .is_some_and(|value| value.trim().eq_ignore_ascii_case("text/event-stream"))
    });
    let stream = response.bytes_stream();
    futures_util::pin_mut!(stream);
    let mut received = 0_usize;
    let mut body = Vec::new();
    let mut sse = SseResponse::default();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(McpClientError::Http)?;
        received = received.checked_add(chunk.len()).ok_or_else(|| {
            McpClientError::Malformed("MCP HTTP response exceeds its byte limit".to_owned())
        })?;
        if received > MAX_RESPONSE_BYTES {
            return Err(McpClientError::Malformed(
                "MCP HTTP response exceeds its byte limit".to_owned(),
            ));
        }
        if let Some(id) = sse_id {
            if let Some(frame) = sse.push(&chunk, id)? {
                return Ok(frame);
            }
        } else {
            body.extend_from_slice(&chunk);
        }
    }
    if sse_id.is_some() {
        return Err(McpClientError::Malformed(
            "MCP SSE ended before the matching response".to_owned(),
        ));
    }
    String::from_utf8(body)
        .map_err(|_| McpClientError::Malformed("MCP HTTP response is not UTF-8".to_owned()))
}

/// HTTP transport for streamable MCP endpoints.
pub struct HttpTransport {
    client: reqwest::Client,
    url: String,
    /// Headers sent with every request: `Accept`, then the caller's headers, then `Authorization`
    /// when a bearer token is configured (the explicit token wins over a same-named header).
    headers: HeaderMap,
    /// Negotiated only by a successful initialize response; never logged as a public value.
    session_id: Option<HeaderValue>,
    next_id: u64,
}

impl HttpTransport {
    /// Create a new HTTP transport to `url`.
    ///
    /// Redirects are never followed: the headers carry credentials, and a redirected POST would
    /// replay them (or silently downgrade to a GET) against a host the operator did not configure.
    ///
    /// # Errors
    ///
    /// - [`McpClientError::InvalidHeader`] when a header name or value, or the bearer token, cannot
    ///   be sent. The offending value is never part of the error.
    /// - [`McpClientError::Http`] when the HTTP client cannot be built.
    pub fn new(
        url: impl Into<String>,
        bearer: Option<String>,
        headers: Option<&BTreeMap<String, String>>,
    ) -> Result<Self> {
        let mut extra_headers = HeaderMap::new();
        extra_headers.insert(ACCEPT, HeaderValue::from_static(ACCEPT_VALUE));
        if let Some(h) = headers {
            for (k, v) in h {
                let name = HeaderName::from_bytes(k.as_bytes())
                    .map_err(|_| McpClientError::InvalidHeader { name: k.clone() })?;
                let value = HeaderValue::from_str(v)
                    .map_err(|_| McpClientError::InvalidHeader { name: k.clone() })?;
                extra_headers.insert(name, value);
            }
        }
        if let Some(token) = bearer {
            let mut value = HeaderValue::from_str(&format!("Bearer {token}"))
                .map_err(|_| McpClientError::InvalidHeader { name: "Authorization".to_owned() })?;
            value.set_sensitive(true);
            extra_headers.insert(AUTHORIZATION, value);
        }

        // The browser `fetch` owns redirects on wasm32 and strips `Authorization` on a
        // cross-origin redirect; reqwest exposes no redirect policy there.
        let builder = reqwest::Client::builder();
        #[cfg(not(target_arch = "wasm32"))]
        let builder = builder.redirect(reqwest::redirect::Policy::none());
        let client = builder.build().map_err(McpClientError::Http)?;

        Ok(Self { client, url: url.into(), headers: extra_headers, session_id: None, next_id: 1 })
    }

    fn next_id(&mut self) -> u64 {
        let id = self.next_id;
        self.next_id = self.next_id.wrapping_add(1);
        id
    }

    fn request_headers(&self) -> HeaderMap {
        let mut headers = self.headers.clone();
        if let Some(session_id) = &self.session_id {
            headers.insert("mcp-session-id", session_id.clone());
        }
        headers
    }
}

#[cfg_attr(target_arch = "wasm32", async_trait(?Send))]
#[cfg_attr(not(target_arch = "wasm32"), async_trait)]
impl Transport for HttpTransport {
    async fn call(
        &mut self,
        method: &str,
        params: JsonValue,
        timeout_dur: Duration,
    ) -> Result<JsonValue> {
        let id = self.next_id();
        let frame = jsonrpc_request(id, method, params);

        let resp = self
            .client
            .post(&self.url)
            .timeout(timeout_dur)
            .header("Content-Type", "application/json")
            .headers(self.request_headers())
            .body(frame)
            .send()
            .await
            .map_err(McpClientError::Http)?;
        let status = resp.status().as_u16();
        let session_id = resp.headers().get("mcp-session-id").cloned();
        let successful = (200..300).contains(&status);
        let text = response_text(resp, successful.then_some(id)).await?;

        if !successful {
            let body: String = text.chars().take(MAX_ERROR_BODY_CHARS).collect();
            return Err(McpClientError::HttpStatus { status, body });
        }

        let result = parse_response(&text)?;
        if method == "initialize" {
            // Use the client's existing handshake validator before accepting any session state.
            parse_server_info(&result)?;
            let session_id = session_id
                .map(|mut value| {
                    if value.as_bytes().is_empty()
                        || !value.as_bytes().iter().all(|byte| (0x21..=0x7e).contains(byte))
                    {
                        return Err(McpClientError::Malformed("invalid MCP session id".to_owned()));
                    }
                    value.set_sensitive(true);
                    Ok(value)
                })
                .transpose()?;
            self.session_id = session_id;
        }
        Ok(result)
    }

    async fn notify(&mut self, method: &str, params: JsonValue) -> Result<()> {
        let frame = jsonrpc_notification(method, params);

        // Notifications normally receive an empty 202, but rejection is still a transport error.
        let response = self
            .client
            .post(&self.url)
            .timeout(NOTIFY_TIMEOUT)
            .header("Content-Type", "application/json")
            .headers(self.request_headers())
            .body(frame)
            .send()
            .await
            .map_err(McpClientError::Http)?;
        let status = response.status().as_u16();
        if !(200..300).contains(&status) {
            let text = response_text(response, None).await?;
            let body = text.chars().take(MAX_ERROR_BODY_CHARS).collect();
            return Err(McpClientError::HttpStatus { status, body });
        }
        Ok(())
    }

    async fn shutdown(&mut self) -> Result<()> {
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sse_frames_preserve_utf8_and_multiline_data_across_every_chunk_boundary() {
        let input = concat!(
            "\u{feff}: heartbeat\r\nid: 0\r\nretry: 3000\r\ndata\r\n\r\n",
            "data: {\"jsonrpc\":\"2.0\",\"method\":\"notifications/progress\"}\r\n\r\n",
            "data: {\"id\":99,\"result\":{}}\r\n\r\n",
            "event: message\r\ndata: {\"jsonrpc\":\"2.0\",\"id\":7,\r\n",
            "data: \"result\":{\"name\":\"épisode\"}}\r\n\r\n"
        );
        for input in [input.to_owned(), input.replace("\r\n", "\r"), input.replace("\r\n", "\n")] {
            let mut parser = SseResponse::default();
            let mut response = None;
            for byte in input.bytes() {
                if let Some(frame) = parser.push(&[byte], 7).unwrap() {
                    assert!(response.replace(frame).is_none());
                }
            }
            let result = parse_response(&response.expect("matching response")).unwrap();
            assert_eq!(result["name"], "épisode");
        }
    }

    #[test]
    fn malformed_sse_diagnostics_do_not_include_payloads() {
        let mut parser = SseResponse::default();
        let error = parser.push(b"data: private-invalid-payload\n\n", 1).unwrap_err();
        assert!(!error.to_string().contains("private-invalid-payload"));
    }
}
