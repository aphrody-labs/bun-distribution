// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 aphrody contributors

use std::time::Duration;

use async_trait::async_trait;
use reqwest::header::{AUTHORIZATION, CONTENT_TYPE, HeaderMap, HeaderValue};
use serde::{Deserialize, Serialize};

use super::Reranker;
use crate::{
    error::{RagError, Result},
    store::ScoredChunk,
};

/// Cross-encoder reranker calling an OpenAI-compatible or llama.cpp `/v1/rerank` endpoint.
#[derive(Debug, Clone)]
pub struct LlamaServerReranker {
    endpoint_url: String,
    model_id: String,
    client: reqwest::Client,
    api_key: Option<String>,
}

impl LlamaServerReranker {
    /// Create a new reranker against the given endpoint.
    ///
    /// Accepts either a base URL (e.g. `http://127.0.0.1:8080`) or a full endpoint
    /// (e.g. `http://127.0.0.1:8080/v1/rerank`).
    pub fn new(base_or_endpoint: impl Into<String>, model_id: impl Into<String>) -> Self {
        let raw = base_or_endpoint.into();
        let endpoint_url = if raw.ends_with("/rerank") {
            raw
        } else {
            format!("{}/v1/rerank", raw.trim_end_matches('/'))
        };

        let client =
            reqwest::Client::builder().timeout(Duration::from_secs(60)).build().unwrap_or_default();

        Self { endpoint_url, model_id: model_id.into(), client, api_key: None }
    }

    /// Set an optional API key / bearer token.
    pub fn with_api_key(mut self, api_key: impl Into<String>) -> Self {
        self.api_key = Some(api_key.into());
        self
    }

    /// Set a custom HTTP client (e.g. with custom proxy, timeouts, etc.).
    pub fn with_client(mut self, client: reqwest::Client) -> Self {
        self.client = client;
        self
    }
}

#[derive(Debug, Serialize)]
struct RerankRequest<'a> {
    model: &'a str,
    query: &'a str,
    documents: &'a [String],
    top_n: Option<usize>,
}

#[derive(Debug, Deserialize)]
struct RerankItem {
    index: usize,
    #[serde(alias = "score")]
    relevance_score: f64,
}

#[derive(Debug, Deserialize)]
struct RerankResponse {
    results: Vec<RerankItem>,
}

#[async_trait]
impl Reranker for LlamaServerReranker {
    fn model_id(&self) -> &str {
        &self.model_id
    }

    async fn rerank(&self, query: &str, candidates: &mut [ScoredChunk]) -> Result<()> {
        if candidates.is_empty() {
            return Ok(());
        }

        let documents: Vec<String> = candidates.iter().map(|c| c.chunk.content.clone()).collect();

        let request_payload = RerankRequest {
            model: &self.model_id,
            query,
            documents: &documents,
            top_n: Some(candidates.len()),
        };

        let mut headers = HeaderMap::new();
        headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));
        if let Some(ref key) = self.api_key
            && let Ok(val) = HeaderValue::from_str(&format!("Bearer {}", key))
        {
            headers.insert(AUTHORIZATION, val);
        }

        let resp = self
            .client
            .post(&self.endpoint_url)
            .headers(headers)
            .json(&request_payload)
            .send()
            .await
            .map_err(|err| RagError::RerankFailed(format!("HTTP request failed: {err}")))?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_else(|_| "<unreadable body>".to_string());
            return Err(RagError::RerankFailed(format!(
                "Reranker endpoint error {status}: {body}"
            )));
        }

        let parsed: RerankResponse = resp.json().await.map_err(|err| {
            RagError::RerankFailed(format!("Failed to parse rerank response: {err}"))
        })?;

        // Map scores back to original indices.
        let mut scored_map: std::collections::HashMap<usize, f64> =
            std::collections::HashMap::new();
        for item in parsed.results {
            scored_map.insert(item.index, item.relevance_score);
        }

        for (idx, candidate) in candidates.iter_mut().enumerate() {
            if let Some(&new_score) = scored_map.get(&idx) {
                candidate.score = new_score;
            }
        }

        // Sort descending by new score
        candidates.sort_by(|a, b| b.score.total_cmp(&a.score));

        Ok(())
    }
}
