// SPDX-License-Identifier: Apache-2.0
//! The side channels of a running `llama-server`: health, exact token counts,
//! LoRA hot-swap and server properties. (Inference itself goes through the
//! OpenAI-compatible API with `aphrody-model-client`.)

use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

/// What `/health` says.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Health {
    /// 200: the model is loaded and the server accepts requests.
    Ready,
    /// 503: the process is up and still loading the model.
    Loading,
    /// No usable answer: connection refused, timeout, unexpected status.
    Down(String),
}

/// A LoRA adapter as the server reports it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct LoraStatus {
    /// Index used to address the adapter.
    pub id: u32,
    /// Adapter file.
    pub path: String,
    /// Scale currently applied (0 = inactive).
    pub scale: f32,
}

/// A side-channel call that failed.
#[derive(Debug, thiserror::Error)]
pub enum ClientError {
    /// Transport failure.
    #[error("llama-server request failed: {0}")]
    Http(#[from] reqwest::Error),
    /// The server answered with an error status.
    #[error("llama-server answered {status}: {body}")]
    Status {
        /// HTTP status.
        status: u16,
        /// Response body.
        body: String,
    },
    /// The answer did not have the documented shape.
    #[error("unexpected llama-server response: {0}")]
    Shape(String),
}

/// Client for the non-OpenAI endpoints of one server.
#[derive(Debug, Clone)]
pub struct ServerClient {
    http: reqwest::Client,
    server_url: String,
}

impl ServerClient {
    /// A client for the server rooted at `server_url` (`http://127.0.0.1:PORT`).
    #[must_use]
    pub fn new(server_url: impl Into<String>) -> Self {
        // rustls needs a process-wide provider before the first client
        // (idempotent; harmless for plain-http loopback traffic).
        let _ = rustls::crypto::ring::default_provider().install_default();
        let http = reqwest::Client::builder()
            .connect_timeout(Duration::from_secs(2))
            .no_proxy()
            .build()
            .unwrap_or_default();
        Self { http, server_url: server_url.into().trim_end_matches('/').to_string() }
    }

    fn url(&self, path: &str) -> String {
        format!("{}{path}", self.server_url)
    }

    async fn checked(response: reqwest::Response) -> Result<reqwest::Response, ClientError> {
        let status = response.status();
        if status.is_success() {
            return Ok(response);
        }
        Err(ClientError::Status {
            status: status.as_u16(),
            body: response.text().await.unwrap_or_default(),
        })
    }

    /// Probe `/health`. Never fails: an unreachable server is [`Health::Down`].
    pub async fn health(&self) -> Health {
        let request = self.http.get(self.url("/health")).timeout(Duration::from_secs(3));
        match request.send().await {
            Ok(response) if response.status().is_success() => Health::Ready,
            Ok(response) if response.status() == reqwest::StatusCode::SERVICE_UNAVAILABLE => {
                Health::Loading
            },
            Ok(response) => Health::Down(format!("unexpected status {}", response.status())),
            Err(error) => Health::Down(error.to_string()),
        }
    }

    /// The exact number of tokens `text` takes for the loaded model.
    ///
    /// # Errors
    ///
    /// See [`ClientError`].
    pub async fn count_tokens(&self, text: &str) -> Result<usize, ClientError> {
        let response = self
            .http
            .post(self.url("/tokenize"))
            .timeout(Duration::from_secs(30))
            .json(&json!({ "content": text }))
            .send()
            .await?;
        let body: Value = Self::checked(response).await?.json().await?;
        body.get("tokens")
            .and_then(Value::as_array)
            .map(Vec::len)
            .ok_or_else(|| ClientError::Shape(format!("no `tokens` array in {body}")))
    }

    /// The adapters loaded in the server and their current scales.
    ///
    /// # Errors
    ///
    /// See [`ClientError`].
    pub async fn lora_adapters(&self) -> Result<Vec<LoraStatus>, ClientError> {
        let response = self
            .http
            .get(self.url("/lora-adapters"))
            .timeout(Duration::from_secs(10))
            .send()
            .await?;
        Ok(Self::checked(response).await?.json().await?)
    }

    /// Set adapter scales without restarting the server. Adapters not listed
    /// are disabled (llama-server semantics).
    ///
    /// # Errors
    ///
    /// See [`ClientError`].
    pub async fn set_lora_scales(&self, scales: &[(u32, f32)]) -> Result<(), ClientError> {
        let body: Vec<Value> =
            scales.iter().map(|(id, scale)| json!({ "id": id, "scale": scale })).collect();
        let response = self
            .http
            .post(self.url("/lora-adapters"))
            .timeout(Duration::from_secs(30))
            .json(&body)
            .send()
            .await?;
        Self::checked(response).await.map(|_| ())
    }

    /// `/props`: context size per slot, chat template, modalities, build info.
    ///
    /// # Errors
    ///
    /// See [`ClientError`].
    pub async fn props(&self) -> Result<Value, ClientError> {
        let response =
            self.http.get(self.url("/props")).timeout(Duration::from_secs(10)).send().await?;
        Ok(Self::checked(response).await?.json().await?)
    }
}
