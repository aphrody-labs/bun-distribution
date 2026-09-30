// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 aphrody contributors

//! Streamable HTTP transport for MCP servers.

use std::{collections::BTreeMap, time::Duration};

use async_trait::async_trait;
use reqwest::header::{HeaderMap, HeaderName, HeaderValue};
use serde_json::Value as JsonValue;

use super::Transport;
use crate::{
    error::{McpClientError, Result},
    protocol::{jsonrpc_notification, jsonrpc_request, parse_response},
};

/// HTTP transport for streamable MCP endpoints.
pub struct HttpTransport {
    client: reqwest::Client,
    url: String,
    bearer: Option<String>,
    extra_headers: HeaderMap,
    next_id: u64,
}

impl HttpTransport {
    /// Create a new HTTP transport to `url`.
    pub fn new(
        url: impl Into<String>,
        bearer: Option<String>,
        headers: Option<&BTreeMap<String, String>>,
    ) -> Result<Self> {
        let mut extra_headers = HeaderMap::new();
        if let Some(h) = headers {
            for (k, v) in h {
                if let (Ok(name), Ok(val)) =
                    (HeaderName::from_bytes(k.as_bytes()), HeaderValue::from_str(v))
                {
                    extra_headers.insert(name, val);
                }
            }
        }

        let client = reqwest::Client::builder().build().map_err(McpClientError::Http)?;

        Ok(Self { client, url: url.into(), bearer, extra_headers, next_id: 1 })
    }

    fn next_id(&mut self) -> u64 {
        let id = self.next_id;
        self.next_id = self.next_id.wrapping_add(1);
        id
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

        let mut req = self
            .client
            .post(&self.url)
            .timeout(timeout_dur)
            .header("Content-Type", "application/json")
            .headers(self.extra_headers.clone());

        if let Some(tok) = &self.bearer {
            req = req.header("Authorization", format!("Bearer {tok}"));
        }

        let resp = req.body(frame).send().await.map_err(McpClientError::Http)?;
        let status = resp.status().as_u16();
        let text = resp.text().await.map_err(McpClientError::Http)?;

        if !(200..300).contains(&status) {
            return Err(McpClientError::HttpStatus { status, body: text });
        }

        parse_response(&text)
    }

    async fn notify(&mut self, method: &str, params: JsonValue) -> Result<()> {
        let frame = jsonrpc_notification(method, params);

        let mut req = self
            .client
            .post(&self.url)
            .header("Content-Type", "application/json")
            .headers(self.extra_headers.clone());

        if let Some(tok) = &self.bearer {
            req = req.header("Authorization", format!("Bearer {tok}"));
        }

        let _ = req.body(frame).send().await.map_err(McpClientError::Http)?;
        Ok(())
    }

    async fn shutdown(&mut self) -> Result<()> {
        Ok(())
    }
}
