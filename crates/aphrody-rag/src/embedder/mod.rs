// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 aphrody contributors

//! Text embedding abstraction and concrete backends.

pub mod llama;
#[cfg(feature = "native")]
pub mod native;
pub mod openai;
#[cfg(feature = "ort")]
pub mod ort;
pub mod stub;

use async_trait::async_trait;
pub use llama::LlamaServerEmbedder;
#[cfg(feature = "native")]
pub use native::NativeEmbedder;
pub use openai::OpenAiCompatEmbedder;
#[cfg(feature = "ort")]
pub use ort::OrtEmbedder;
pub use stub::StubEmbedder;

use crate::error::{RagError, Result};

/// Default instruction prefix for Qwen3-Embedding asymmetric retrieval queries.
pub const QWEN3_QUERY_INSTRUCTION: &str =
    "Instruct: Given a web search query, retrieve relevant passages that answer the query\nQuery: ";

/// Standard Matryoshka (MRL) dimension for compact vector storage (512 dims).
pub const MATRYOSHKA_512_DIM: usize = 512;

/// Format text according to asymmetric model requirements:
/// - Qwen3-Embedding: asymmetric query prompt `Instruct: Given a web search query, retrieve relevant passages that answer the query\nQuery: {query}`, raw passages for documents.
/// - E5: `query: {query}` vs `passage: {doc}`.
/// - Other models: unchanged raw text.
#[must_use]
pub fn format_query_or_passage(model_id: &str, text: &str, is_query: bool) -> String {
    let lower = model_id.to_ascii_lowercase();
    if lower.contains("qwen3") && lower.contains("embed") {
        if is_query { format!("{QWEN3_QUERY_INSTRUCTION}{text}") } else { text.to_string() }
    } else if lower.contains("e5") {
        let prefix = if is_query { "query: " } else { "passage: " };
        format!("{prefix}{text}")
    } else {
        text.to_string()
    }
}

/// Truncate a dense embedding vector to `target_dim` (Matryoshka Representation Learning)
/// and re-normalise via L2 norm.
///
/// If `v.len() <= target_dim`, the vector is simply L2-renormalised in place.
pub fn truncate_and_normalize_mrl(v: &mut Vec<f32>, target_dim: usize) {
    if v.len() > target_dim {
        v.truncate(target_dim);
    }
    aphrody_rag_core::fusion::l2_normalize(v);
}

/// Pluggable dense text embedding generator.
#[async_trait]
pub trait Embedder: Send + Sync {
    /// Identifier of the model in use (e.g. `multilingual-e5-small`, `stub-384`, `qwen3-embedding-0.6b`).
    fn model_id(&self) -> &str;

    /// Dimensionality of the produced vectors (e.g. 384, 512, 768, 1024, 1536).
    fn dimension(&self) -> usize;

    /// Generate embeddings for a batch of strings.
    ///
    /// When `is_query` is true, models that expect prefixes (e.g. Qwen3's `Instruct:...` or E5's `query:`)
    /// automatically format the inputs accordingly.
    async fn embed(&self, texts: &[String], is_query: bool) -> Result<Vec<Vec<f32>>>;

    /// Convenience helper to embed a single query string.
    async fn embed_query(&self, query: &str) -> Result<Vec<f32>> {
        let res = self.embed(&[query.to_string()], true).await?;
        res.into_iter().next().ok_or_else(|| {
            RagError::EmbeddingFailed("empty embedding response for query".to_string())
        })
    }

    /// Convenience helper to embed a batch of documents/passages.
    async fn embed_batch(&self, texts: &[String]) -> Result<Vec<Vec<f32>>> {
        self.embed(texts, false).await
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use aphrody_rag_core::fusion::dot;

    #[test]
    fn test_format_query_or_passage_qwen3() {
        let q = "how to run hybrid rag";
        let formatted_q = format_query_or_passage("qwen3-embedding-0.6b", q, true);
        assert_eq!(
            formatted_q,
            "Instruct: Given a web search query, retrieve relevant passages that answer the query\nQuery: how to run hybrid rag"
        );

        let doc = "hybrid rag combines bm25 and vector search";
        let formatted_doc = format_query_or_passage("qwen3-embedding-0.6b", doc, false);
        assert_eq!(formatted_doc, doc);
    }

    #[test]
    fn test_format_query_or_passage_e5() {
        let q = "search query";
        assert_eq!(
            format_query_or_passage("multilingual-e5-small", q, true),
            "query: search query"
        );
        let doc = "doc body";
        assert_eq!(
            format_query_or_passage("multilingual-e5-small", doc, false),
            "passage: doc body"
        );
    }

    #[test]
    fn test_truncate_and_normalize_mrl() {
        let mut vec = vec![1.0_f32; 1024];
        truncate_and_normalize_mrl(&mut vec, 512);
        assert_eq!(vec.len(), 512);
        let norm_sq = dot(&vec, &vec);
        assert!((norm_sq - 1.0).abs() < 1e-5);
    }
}
