// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 aphrody contributors

//! Streamable HTTP transport for MCP servers.

use std::{collections::BTreeMap, time::Duration};

use async_trait::async_trait;
use reqwest::header::{ACCEPT, AUTHORIZATION, HeaderMap, HeaderName, HeaderValue};
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

/// Upper bound for a fire-and-forget notification round trip.
const NOTIFY_TIMEOUT: Duration = Duration::from_secs(30);

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

        let client = reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .map_err(McpClientError::Http)?;

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

#[async_trait]
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
        let text = resp.text().await.map_err(McpClientError::Http)?;

        if !(200..300).contains(&status) {
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
            let text = response.text().await.map_err(McpClientError::Http)?;
            let body = text.chars().take(MAX_ERROR_BODY_CHARS).collect();
            return Err(McpClientError::HttpStatus { status, body });
        }
        Ok(())
    }

    async fn shutdown(&mut self) -> Result<()> {
        Ok(())
    }
}
