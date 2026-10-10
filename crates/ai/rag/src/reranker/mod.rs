// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 aphrody contributors

//! Cross-encoder reranking abstraction and concrete implementations.

pub mod llama;
#[cfg(feature = "native")]
pub mod native;
pub mod noop;

use async_trait::async_trait;
pub use llama::LlamaServerReranker;
#[cfg(feature = "native")]
pub use native::NativeReranker;
pub use noop::NoopReranker;

use crate::{error::Result, store::ScoredChunk};

/// A cross-encoder or neural reranker scoring (query, chunk) pairs.
#[async_trait]
pub trait Reranker: Send + Sync {
    /// Reranker model identifier (e.g. `qwen3-reranker-0.6b-q8`).
    fn model_id(&self) -> &str;

    /// Rerank the supplied `candidates` in place according to relevance to `query`.
    async fn rerank(&self, query: &str, candidates: &mut [ScoredChunk]) -> Result<()>;
}
