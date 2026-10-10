// SPDX-License-Identifier: Apache-2.0
//! vLLM HTTP client. Chat reuses the shared OpenAI wire; native routes use the
//! server root even when the configured URL ends in `/v1`.
//!
//! Serving capabilities depend on the loaded model and frontend. This client
//! does not start an engine or assume that a chat model also supports pooling.

mod api;
mod protocol;
#[cfg(test)]
mod tests;

pub use api::VllmApi;
pub use protocol::{PoolingBytes, ScoreResponse, ScoreResult, TokenizeResponse};

use std::time::Duration;

use async_trait::async_trait;
use serde::Deserialize;
use serde_json::json;

use crate::{
    ChatTurn, EmbedClient, ModelCapabilities, ModelClient, ModelError, ModelStream,
    OpenAiCompatClient, OpenAiWire,
    http::{refine_api_error, server_root},
    openai_compat::ProviderRuntime,
    rerank::{RerankClient, RerankHit},
};

/// Default endpoint for a local vLLM server.
pub const DEFAULT_VLLM_URL: &str = "http://localhost:8000";
/// Deadline for a native JSON/text request, including retries and body reading.
pub const DEFAULT_VLLM_REQUEST_TIMEOUT: Duration = Duration::from_secs(300);

/// Configuration for connecting to a vLLM instance.
#[derive(Clone)]
pub struct VllmConfig {
    pub base_url: String,
    pub model: String,
    pub api_key: Option<String>,
}

impl std::fmt::Debug for VllmConfig {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("VllmConfig")
            .field("base_url", &self.base_url)
            .field("model", &self.model)
            .field("api_key", &self.api_key.as_ref().map(|_| "[redacted]"))
            .finish()
    }
}

impl VllmConfig {
    #[must_use]
    pub fn new(model: impl Into<String>) -> Self {
        Self { base_url: DEFAULT_VLLM_URL.into(), model: model.into(), api_key: None }
    }

    #[must_use]
    pub fn with_base_url(mut self, url: impl Into<String>) -> Self {
        self.base_url = url.into();
        self
    }

    #[must_use]
    pub fn with_api_key(mut self, key: impl Into<String>) -> Self {
        self.api_key = Some(key.into());
        self
    }
}

/// Client for vLLM supporting Chat, Embeddings, and Reranking.
#[derive(Clone)]
pub struct VllmClient {
    config: VllmConfig,
    compat_client: OpenAiCompatClient,
    api: VllmApi,
}

impl VllmClient {
    /// Create a new vLLM client from `VllmConfig`.
    #[must_use]
    pub fn new(config: VllmConfig) -> Self {
        let mut runtime = ProviderRuntime::keyless(&config.base_url);
        runtime.bearer_token = config.api_key.clone();
        let mut client = Self::from_provider(runtime, &config.model);
        client.config = config;
        client
    }

    /// Keep the shared provider's headers, queries, retries, idle deadline,
    /// capabilities and default decoding options. Root and `/v1` URLs work.
    #[must_use]
    pub fn from_provider(mut runtime: ProviderRuntime, model: impl Into<String>) -> Self {
        let model = model.into();
        let config = VllmConfig {
            base_url: runtime.base_url.clone(),
            model: model.clone(),
            api_key: runtime.bearer_token.clone(),
        };
        runtime.base_url = format!("{}/v1", server_root(&runtime.base_url));
        let api = VllmApi::from_provider(runtime.clone());
        let compat_client = OpenAiCompatClient::from_provider(runtime, OpenAiWire::Chat, model)
            .with_http_client(api.http.clone());
        Self { config, compat_client, api }
    }

    /// Use one caller-configured connection pool for chat and native routes.
    /// Set connect/read timeouts on its builder; a total HTTP timeout also
    /// limits SSE generation, so use the provider's idle timeout for long turns.
    #[must_use]
    pub fn with_http_client(mut self, http: reqwest::Client) -> Self {
        self.compat_client = self.compat_client.with_http_client(http.clone());
        self.api = self.api.with_http_client(http);
        self
    }

    /// Set the total native request deadline and chat response-header deadline.
    /// The SSE body retains the provider's separate stream idle deadline.
    #[must_use]
    pub fn with_request_timeout(mut self, timeout: Duration) -> Self {
        self.api = self.api.with_request_timeout(timeout);
        self
    }

    #[must_use]
    pub fn base_url(&self) -> &str {
        &self.config.base_url
    }

    #[must_use]
    pub fn model(&self) -> &str {
        &self.config.model
    }

    /// Native server endpoints, sharing this client's HTTP and provider policy.
    #[must_use]
    pub fn api(&self) -> &VllmApi {
        &self.api
    }
}

#[async_trait]
impl ModelClient for VllmClient {
    fn model_id(&self) -> &str {
        self.compat_client.model_id()
    }

    fn capabilities(&self) -> ModelCapabilities {
        self.compat_client.capabilities()
    }

    async fn stream(&self, turn: ChatTurn) -> Result<ModelStream, ModelError> {
        tokio::time::timeout(self.api.request_timeout, self.compat_client.stream(turn))
            .await
            .map_err(|_| api::deadline_error())?
            .map_err(refine_api_error)
    }
}

#[derive(Debug, Deserialize)]
struct VllmRerankResultItem {
    index: usize,
    relevance_score: f32,
}

#[derive(Debug, Deserialize)]
struct VllmRerankResponse {
    results: Vec<VllmRerankResultItem>,
}

#[async_trait]
impl RerankClient for VllmClient {
    fn rerank_model_id(&self) -> &str {
        &self.config.model
    }

    async fn rerank(
        &self,
        query: &str,
        documents: &[&str],
        top_n: Option<usize>,
    ) -> Result<Vec<RerankHit>, ModelError> {
        // vLLM treats top_n=0 as "all"; our trait requires at most zero hits.
        if documents.is_empty() || top_n == Some(0) {
            return Ok(Vec::new());
        }
        let mut body = json!({ "model": self.model(), "query": query, "documents": documents });
        if let Some(n) = top_n {
            body["top_n"] = json!(n);
        }
        let resp: VllmRerankResponse = self.api.post("rerank", &body).await?;
        let expected = top_n.unwrap_or(documents.len()).min(documents.len());
        if resp.results.len() != expected {
            return Err(ModelError::Stream("vLLM returned an incomplete rerank result".into()));
        }
        let mut seen = vec![false; documents.len()];
        let mut hits = Vec::with_capacity(resp.results.len());
        for result in resp.results {
            if result.index >= documents.len()
                || seen[result.index]
                || !result.relevance_score.is_finite()
            {
                return Err(ModelError::Stream(
                    "vLLM returned invalid rerank indices or scores".into(),
                ));
            }
            seen[result.index] = true;
            hits.push(RerankHit { index: result.index, score: result.relevance_score });
        }
        hits.sort_by(|a, b| b.score.total_cmp(&a.score));
        Ok(hits)
    }
}

#[derive(Debug, Deserialize)]
struct VllmEmbeddingItem {
    embedding: Vec<f32>,
    index: usize,
}

#[derive(Debug, Deserialize)]
struct VllmEmbeddingResponse {
    data: Vec<VllmEmbeddingItem>,
}

#[async_trait]
impl EmbedClient for VllmClient {
    fn embed_model_id(&self) -> &str {
        &self.config.model
    }

    async fn embed(&self, texts: &[&str]) -> Result<Vec<Vec<f32>>, ModelError> {
        if texts.is_empty() {
            return Ok(Vec::new());
        }
        let body = json!({ "model": self.model(), "input": texts, "encoding_format": "float" });
        let mut resp: VllmEmbeddingResponse = self.api.post("v1/embeddings", &body).await?;
        resp.data.sort_by_key(|item| item.index);
        if resp.data.len() != texts.len()
            || resp.data.iter().enumerate().any(|(i, item)| item.index != i)
        {
            return Err(ModelError::Stream(
                "vLLM returned incomplete or invalid embedding indices".into(),
            ));
        }
        let dimension = resp.data[0].embedding.len();
        if dimension == 0
            || resp.data.iter().any(|item| {
                item.embedding.len() != dimension
                    || item.embedding.iter().any(|value| !value.is_finite())
            })
        {
            return Err(ModelError::Stream("vLLM returned invalid embedding vectors".into()));
        }
        Ok(resp.data.into_iter().map(|item| item.embedding).collect())
    }
}
