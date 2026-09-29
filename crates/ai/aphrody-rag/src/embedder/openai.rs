// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 aphrody contributors

//! Embedder implementation calling an OpenAI-compatible remote `/v1/embeddings` endpoint.

use async_trait::async_trait;
use serde::Deserialize;
use serde_json::json;

use super::Embedder;
use crate::error::{RagError, Result};

#[derive(Deserialize)]
struct EmbeddingItem {
    embedding: Vec<f32>,
}

#[derive(Deserialize)]
struct EmbeddingResponse {
    data: Vec<EmbeddingItem>,
}

/// Embedder delegating to an external OpenAI-compatible service.
pub struct OpenAiCompatEmbedder {
    endpoint: String,
    model_id: String,
    dimension: usize,
    api_key: Option<String>,
    client: reqwest::Client,
}

impl OpenAiCompatEmbedder {
    /// Create an OpenAI-compatible embedder.
    pub fn new(
        endpoint: impl Into<String>,
        model_id: impl Into<String>,
        dimension: usize,
        api_key: Option<String>,
    ) -> Self {
        Self {
            endpoint: endpoint.into(),
            model_id: model_id.into(),
            dimension,
            api_key,
            client: reqwest::Client::new(),
        }
    }
}

#[async_trait]
impl Embedder for OpenAiCompatEmbedder {
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

        let mut req = self.client.post(&self.endpoint);
        if let Some(key) = &self.api_key {
            req = req.header("Authorization", format!("Bearer {key}"));
        }

        let inputs: Vec<String> = texts
            .iter()
            .map(|t| super::format_query_or_passage(&self.model_id, t, is_query))
            .collect();

        let body = json!({
            "input": inputs,
            "model": self.model_id,
        });

        let resp = req.json(&body).send().await.map_err(RagError::Http)?;
        if !resp.status().is_success() {
            let status = resp.status();
            let err_text = resp.text().await.unwrap_or_default();
            return Err(RagError::EmbeddingFailed(format!(
                "remote embedder returned HTTP {status}: {err_text}"
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
