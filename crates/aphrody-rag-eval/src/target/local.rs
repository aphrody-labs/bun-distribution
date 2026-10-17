// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 aphrody contributors

//! Local in-process retrieval target querying `aphrody-rag` directly without network overhead.

use std::sync::Arc;

use aphrody_rag::{RagSearcher, SearchMode, SearchOptions};
use aphrody_rag_core::eval::RetrievedHit;
use async_trait::async_trait;

use super::{EvalTarget, TargetResponse};
use crate::error::Result;

/// Local in-process retrieval target wrapping a [`RagSearcher`].
pub struct LocalIndexTarget {
    name: String,
    searcher: Arc<RagSearcher>,
    mode: SearchMode,
    rerank: bool,
    path_prefix: Option<String>,
}

impl LocalIndexTarget {
    /// Create a new local target using `searcher`.
    pub fn new(searcher: Arc<RagSearcher>) -> Self {
        Self {
            name: "local:in-process".to_string(),
            searcher,
            mode: SearchMode::Hybrid,
            rerank: true,
            path_prefix: None,
        }
    }

    /// Set the retrieval mode (Lexical, Vector, or Hybrid).
    pub fn with_mode(mut self, mode: SearchMode) -> Self {
        self.mode = mode;
        self
    }

    /// Enable or disable cross-encoder reranking.
    pub fn with_rerank(mut self, rerank: bool) -> Self {
        self.rerank = rerank;
        self
    }

    /// Restrict retrieval to paths starting with `prefix`.
    pub fn with_path_prefix(mut self, prefix: impl Into<String>) -> Self {
        self.path_prefix = Some(prefix.into());
        self
    }
}

#[async_trait]
impl EvalTarget for LocalIndexTarget {
    fn name(&self) -> &str {
        &self.name
    }

    async fn query(&self, query_str: &str, limit: usize) -> Result<TargetResponse> {
        let opts = SearchOptions {
            limit,
            mode: self.mode,
            rerank: self.rerank,
            rerank_top_n: limit * 2,
            path_prefix: self.path_prefix.clone(),
            rrf_k: 60.0,
        };

        let result = self.searcher.search(query_str, &opts).await?;

        let hits = result
            .hits
            .into_iter()
            .map(|sc| {
                let title = sc
                    .chunk
                    .heading
                    .or(sc.chunk.symbol)
                    .unwrap_or_else(|| sc.chunk.path.clone());

                RetrievedHit {
                    rowid: Some(sc.chunk.id),
                    kind: Some("chunk".to_string()),
                    title,
                    url: sc.chunk.path,
                    snippet: sc.chunk.content,
                    source_id: None,
                    lang: None,
                    score: sc.score,
                }
            })
            .collect();

        let mode_str = format!("{:?}", result.mode_served).to_lowercase();

        Ok(TargetResponse {
            hits,
            mode_served: mode_str,
            latency_ms: result.elapsed_ms,
        })
    }
}
