// SPDX-License-Identifier: Apache-2.0
//! Native vLLM server endpoints. All transport policy stays in the shared HTTP
//! helper, and deadlines enclose both the retry loop and response body.

use std::time::Duration;

use serde::{Deserialize, de::DeserializeOwned};
use serde_json::{Value, json};

use super::{DEFAULT_VLLM_REQUEST_TIMEOUT, ScoreResponse, TokenizeResponse};
use crate::{
    ModelError,
    http::{request_json, rooted, send_request},
    openai_compat::ProviderRuntime,
};

pub(super) fn deadline_error() -> ModelError {
    ModelError::Stream("vLLM request deadline exceeded".into())
}

/// Management and pooling API for vLLM servers.
/// Requests requiring a pooling model may fail on generation-only servers.
#[derive(Clone)]
pub struct VllmApi {
    pub(super) http: reqwest::Client,
    runtime: ProviderRuntime,
    pub(super) request_timeout: Duration,
}

impl VllmApi {
    #[must_use]
    pub fn new(base_url: impl Into<String>, api_key: Option<String>) -> Self {
        let mut runtime = ProviderRuntime::keyless(base_url);
        runtime.bearer_token = api_key;
        Self::from_provider(runtime)
    }

    /// Preserve headers, query parameters, auth and retry policy.
    #[must_use]
    pub fn from_provider(runtime: ProviderRuntime) -> Self {
        Self {
            http: reqwest::Client::new(),
            runtime: rooted(&runtime),
            request_timeout: DEFAULT_VLLM_REQUEST_TIMEOUT,
        }
    }

    #[must_use]
    pub fn with_http_client(mut self, http: reqwest::Client) -> Self {
        self.http = http;
        self
    }

    #[must_use]
    pub fn with_request_timeout(mut self, timeout: Duration) -> Self {
        self.request_timeout = timeout;
        self
    }

    async fn json<T: DeserializeOwned>(
        &self,
        method: reqwest::Method,
        endpoint: &str,
        body: Option<&Value>,
    ) -> Result<T, ModelError> {
        let url = self.runtime.endpoint_path(endpoint);
        tokio::time::timeout(
            self.request_timeout,
            request_json(&self.http, &self.runtime, method, &url, body),
        )
        .await
        .map_err(|_| deadline_error())?
    }

    pub(super) async fn post<T: DeserializeOwned>(
        &self,
        endpoint: &str,
        body: &Value,
    ) -> Result<T, ModelError> {
        self.json(reqwest::Method::POST, endpoint, Some(body)).await
    }

    pub async fn version(&self) -> Result<String, ModelError> {
        #[derive(Deserialize)]
        struct VersionResponse {
            version: String,
        }
        let response: VersionResponse = self.json(reqwest::Method::GET, "version", None).await?;
        Ok(response.version)
    }

    pub async fn models(&self) -> Result<Vec<String>, ModelError> {
        #[derive(Deserialize)]
        struct ModelEntry {
            id: String,
        }
        #[derive(Deserialize)]
        struct ModelsResponse {
            data: Vec<ModelEntry>,
        }
        let response: ModelsResponse = self.json(reqwest::Method::GET, "v1/models", None).await?;
        Ok(response.data.into_iter().map(|model| model.id).collect())
    }

    /// `/health` returns an empty body on success, rather than JSON.
    pub async fn health(&self) -> Result<(), ModelError> {
        let url = self.runtime.endpoint_path("health");
        tokio::time::timeout(self.request_timeout, async {
            let response =
                send_request(&self.http, &self.runtime, reqwest::Method::GET, &url, None, "*/*")
                    .await?;
            response.bytes().await?;
            Ok(())
        })
        .await
        .map_err(|_| deadline_error())?
    }

    /// Prometheus exposition text, kept verbatim.
    pub async fn metrics(&self) -> Result<String, ModelError> {
        let url = self.runtime.endpoint_path("metrics");
        tokio::time::timeout(self.request_timeout, async {
            let response = send_request(
                &self.http,
                &self.runtime,
                reqwest::Method::GET,
                &url,
                None,
                "text/plain",
            )
            .await?;
            Ok(response.text().await?)
        })
        .await
        .map_err(|_| deadline_error())?
    }

    pub async fn tokenize(
        &self,
        model: &str,
        prompt: &str,
    ) -> Result<TokenizeResponse, ModelError> {
        self.tokenize_request(&json!({"model": model, "prompt": prompt})).await
    }

    /// Completion or chat tokenization, preserving template/tools/multimodal
    /// fields from the server's TokenizeRequest without duplicating OpenAI types.
    pub async fn tokenize_request(&self, request: &Value) -> Result<TokenizeResponse, ModelError> {
        let response: TokenizeResponse = self.post("tokenize", request).await?;
        if response.count != response.tokens.len()
            || response.tokens.iter().any(|token| *token > i64::MAX as u64)
            || response.token_strs.as_ref().is_some_and(|strings| strings.len() != response.count)
        {
            return Err(ModelError::Stream("vLLM returned inconsistent tokenization data".into()));
        }
        Ok(response)
    }

    pub async fn detokenize(&self, model: &str, tokens: &[u64]) -> Result<String, ModelError> {
        if tokens.iter().any(|token| *token > i64::MAX as u64) {
            return Err(ModelError::Stream(
                "vLLM token IDs must fit a nonnegative signed 64-bit integer".into(),
            ));
        }
        #[derive(Deserialize)]
        struct DetokenizeResponse {
            prompt: String,
        }
        let response: DetokenizeResponse =
            self.post("detokenize", &json!({"model": model, "tokens": tokens})).await?;
        Ok(response.prompt)
    }

    /// Advanced embeddings request, including token/chat inputs and encoding
    /// options. The returned JSON retains usage, metadata and base64 vectors.
    pub async fn embeddings(&self, request: &Value) -> Result<Value, ModelError> {
        self.post("v1/embeddings", request).await
    }

    /// Advanced native rerank request, preserving multimodal inputs and vLLM
    /// scoring options. Unlike the trait, top_n=0 has native "all" semantics.
    pub async fn rerank_request(&self, request: &Value) -> Result<Value, ModelError> {
        self.post("rerank", request).await
    }

    /// Score text pairs with native `text_1`/`text_2`, `queries`/`documents`,
    /// `queries`/`items` or `data_1`/`data_2` request forms and vLLM extras.
    pub async fn score(&self, request: &Value) -> Result<ScoreResponse, ModelError> {
        let mut response: ScoreResponse = self.post("score", request).await?;
        // All four public request forms pair a single query or N queries
        // with N documents. Multimodal ScoreInput is one JSON object.
        let expected = [
            ("queries", "documents"),
            ("queries", "items"),
            ("data_1", "data_2"),
            ("text_1", "text_2"),
        ]
        .into_iter()
        .find_map(|(first, second)| {
            request.get(first)?;
            let documents = request.get(second)?;
            Some(documents.as_array().map_or(1, Vec::len))
        });
        if expected.is_some_and(|expected| response.data.len() != expected) {
            return Err(ModelError::Stream("vLLM returned an incomplete score result".into()));
        }
        response.data.sort_by_key(|item| item.index);
        if response
            .data
            .iter()
            .enumerate()
            .any(|(index, item)| item.index != index || !item.score.is_finite())
        {
            return Err(ModelError::Stream("vLLM returned invalid score indices or values".into()));
        }
        Ok(response)
    }

    /// JSON pooling response: float vectors, nested token vectors, base64 or
    /// plugin payloads. Binary encodings are not decoded by this JSON method.
    /// Pass the model/input or messages and optional task/encoding parameters.
    pub async fn pooling(&self, request: &Value) -> Result<Value, ModelError> {
        self.post("pooling", request).await
    }

    /// Raw pooling bytes and response headers for binary encodings or plugins.
    /// The caller interprets dtype, endianness and shape from its request and
    /// the server response headers; this method does not guess vector layout.
    pub async fn pooling_bytes(&self, request: &Value) -> Result<super::PoolingBytes, ModelError> {
        let url = self.runtime.endpoint_path("pooling");
        tokio::time::timeout(self.request_timeout, async {
            let response = send_request(
                &self.http,
                &self.runtime,
                reqwest::Method::POST,
                &url,
                Some(request),
                "*/*",
            )
            .await?;
            let headers = response.headers().clone();
            let data = response.bytes().await?;
            Ok(super::PoolingBytes { headers, data })
        })
        .await
        .map_err(|_| deadline_error())?
    }
}
