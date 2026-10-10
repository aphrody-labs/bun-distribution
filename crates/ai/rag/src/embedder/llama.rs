// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 aphrody contributors

//! Embedder implementation calling a local `llama-server` instance.

use async_trait::async_trait;
use serde::Deserialize;
use serde_json::json;

use super::Embedder;
use crate::error::{RagError, Result};

#[derive(Deserialize)]
struct EmbeddingResponseItem {
    embedding: Vec<f32>,
}

#[derive(Deserialize)]
struct EmbeddingResponse {
    data: Vec<EmbeddingResponseItem>,
}

/// Embedder delegating to a supervised local `llama-server` process over HTTP.
pub struct LlamaServerEmbedder {
    endpoint: String,
    model_id: String,
    dimension: usize,
    client: reqwest::Client,
}

impl LlamaServerEmbedder {
    /// Create an embedder targeting `http://{host}:{port}/v1/embeddings`.
    pub fn new(endpoint: impl Into<String>, model_id: impl Into<String>, dimension: usize) -> Self {
        Self {
            endpoint: endpoint.into(),
            model_id: model_id.into(),
            dimension,
            client: reqwest::Client::new(),
        }
    }
}

#[async_trait]
impl Embedder for LlamaServerEmbedder {
    fn model_id(&self) -> &str {
        &self.model_id
    }

    fn dimension(&self) -> usize {
        self.dimension
    }

    async fn embed(&self, texts: &[String], is_query: bool) -> Result<Vec<Vec<f32>>> {
        if texts.is_empty() {
            return Ok(Vec::new());
        }

        // Apply model-specific task prefixes (Qwen3-Embedding asymmetric prompt or E5 query/passage):
        let inputs: Vec<String> = texts
            .iter()
            .map(|t| super::format_query_or_passage(&self.model_id, t, is_query))
            .collect();

        let body = json!({
            "input": inputs,
            "model": self.model_id,
        });

        let resp =
            self.client.post(&self.endpoint).json(&body).send().await.map_err(RagError::Http)?;

        if !resp.status().is_success() {
            let status = resp.status();
            let err_text = resp.text().await.unwrap_or_default();
            return Err(RagError::EmbeddingFailed(format!(
                "llama-server returned HTTP {status}: {err_text}"
            )));
        }

        let parsed: EmbeddingResponse = resp.json().await.map_err(RagError::Http)?;
        let mut out: Vec<Vec<f32>> = parsed.data.into_iter().map(|item| item.embedding).collect();

        for vec in &mut out {
            // Apply Matryoshka truncation and L2 re-normalization if target dimension is smaller:
            if self.dimension < vec.len() {
                super::truncate_and_normalize_mrl(vec, self.dimension);
            }

            if vec.len() != self.dimension {
                return Err(RagError::DimensionMismatch {
                    expected: self.dimension,
                    found: vec.len(),
                });
            }
        }

        Ok(out)
    }
}
