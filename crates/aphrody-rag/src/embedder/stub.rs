// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 aphrody contributors

//! Deterministic offline stub embedder for hermetic testing.

use aphrody_rag_core::fusion::l2_normalize;
use async_trait::async_trait;

use super::Embedder;
use crate::error::Result;

/// A lightweight, deterministic embedding generator that requires no local model weights or
/// network.
///
/// Hashes input text into pseudo-semantic normalized 384-dimensional vectors.
#[derive(Debug, Clone)]
pub struct StubEmbedder {
    model_name: String,
    dimension: usize,
}

impl Default for StubEmbedder {
    fn default() -> Self {
        Self {
            model_name: "stub-384".to_string(),
            dimension: 384,
        }
    }
}

impl StubEmbedder {
    /// Create a new stub embedder with default model name `stub-384` and dimension 384.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Create with a custom model name.
    #[must_use]
    pub fn with_model(model_name: impl Into<String>) -> Self {
        Self {
            model_name: model_name.into(),
            dimension: 384,
        }
    }

    /// Create with a custom model name and dimension (e.g. 512, 1024).
    #[must_use]
    pub fn with_model_and_dim(model_name: impl Into<String>, dimension: usize) -> Self {
        Self {
            model_name: model_name.into(),
            dimension,
        }
    }

    /// Deterministically hash a single string into a unit vector of specified dimension.
    pub fn embed_one_dim(text: &str, dim: usize) -> Vec<f32> {
        let mut out = Vec::with_capacity(dim);
        let mut state = blake3::hash(text.as_bytes());

        let chunks_needed = dim.div_ceil(8);
        for i in 0..chunks_needed {
            let bytes = state.as_bytes();
            for chunk in bytes.as_chunks::<4>().0.iter() {
                if out.len() >= dim {
                    break;
                }
                let u = u32::from_le_bytes(*chunk);
                // Map to -1.0 .. 1.0:
                let f = ((u as f64 / u32::MAX as f64) * 2.0 - 1.0) as f32;
                out.push(f);
            }
            // Chain state for subsequent dimensions:
            state = blake3::hash(&[bytes.as_slice(), &(i as u32).to_le_bytes()].concat());
        }

        out.truncate(dim);
        l2_normalize(&mut out);
        out
    }

    /// Deterministically hash a single string into a 384-d unit vector.
    pub fn embed_one(text: &str) -> Vec<f32> {
        Self::embed_one_dim(text, 384)
    }
}

#[async_trait]
impl Embedder for StubEmbedder {
    fn model_id(&self) -> &str {
        &self.model_name
    }

    fn dimension(&self) -> usize {
        self.dimension
    }

    async fn embed(&self, texts: &[String], is_query: bool) -> Result<Vec<Vec<f32>>> {
        let results = texts
            .iter()
            .map(|t| {
                let formatted = super::format_query_or_passage(&self.model_name, t, is_query);
                Self::embed_one_dim(&formatted, self.dimension)
            })
            .collect();
        Ok(results)
    }
}

#[cfg(test)]
mod tests {
    use aphrody_rag_core::fusion::cosine;

    use super::*;

    #[tokio::test]
    async fn test_stub_embedder_deterministic_and_normalized() {
        let embedder = StubEmbedder::new();
        let texts = vec![
            "Hello world".to_string(),
            "Aphrody autonomous agent".to_string(),
        ];

        let res = embedder.embed(&texts, false).await.expect("embed ok");
        assert_eq!(res.len(), 2);
        assert_eq!(res[0].len(), 384);
        assert_eq!(res[1].len(), 384);

        // Self cosine similarity must be ~1.0:
        let sim = cosine(&res[0], &res[0]);
        assert!((sim - 1.0).abs() < 1e-5);

        // Distinct strings should have distinct vectors:
        let cross = cosine(&res[0], &res[1]);
        assert!(cross < 0.9);
    }
}
