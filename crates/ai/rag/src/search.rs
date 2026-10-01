// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 aphrody contributors

//! High-level search pipeline combining FTS5 lexical retrieval, dense vector similarity,
//! RRF (Reciprocal Rank Fusion), and cross-encoder reranking.

use std::{collections::HashMap, sync::Arc, time::Instant};

use aphrody_rag_core::fusion::rrf;
use serde::{Deserialize, Serialize};

use crate::{
    embedder::Embedder,
    error::Result,
    reranker::Reranker,
    store::{RagStore, ScoredChunk},
};

/// Requested search strategy.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SearchMode {
    /// Pure BM25 text match via SQLite FTS5.
    Lexical,
    /// Pure dense vector cosine similarity.
    Vector,
    /// Reciprocal Rank Fusion of Lexical and Vector candidates.
    #[default]
    Hybrid,
}

/// Search configuration parameters.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchOptions {
    /// Maximum number of final results to return.
    pub limit: usize,
    /// Preferred search mode.
    pub mode: SearchMode,
    /// Whether to apply cross-encoder reranking if a reranker is configured.
    pub rerank: bool,
    /// Number of top candidates to pass to the reranker before truncating.
    pub rerank_top_n: usize,
    /// Restrict results to paths starting with this prefix.
    pub path_prefix: Option<String>,
    /// RRF smoothing constant (standard is 60.0).
    pub rrf_k: f64,
}

impl Default for SearchOptions {
    fn default() -> Self {
        Self {
            limit: 10,
            mode: SearchMode::Hybrid,
            rerank: true,
            rerank_top_n: 25,
            path_prefix: None,
            rrf_k: 60.0,
        }
    }
}

/// Result returned by the RAG search pipeline.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchResult {
    /// Original query string.
    pub query: String,
    /// Ordered retrieved chunks with relevance scores and channels.
    pub hits: Vec<ScoredChunk>,
    /// Effective mode served (may differ from requested mode if fallback occurred).
    pub mode_served: SearchMode,
    /// Fallback explanation when honest degrade happened.
    pub fallback_reason: Option<String>,
    /// Pipeline latency in milliseconds.
    pub elapsed_ms: u64,
    /// Total raw candidate count before deduplication and reranking.
    pub total_candidates: usize,
}

/// Unified search coordinator.
pub struct RagSearcher {
    store: Arc<RagStore>,
    embedder: Option<Arc<dyn Embedder>>,
    reranker: Option<Arc<dyn Reranker>>,
}

impl RagSearcher {
    /// Create a searcher wrapping a RAG store.
    pub fn new(store: Arc<RagStore>) -> Self {
        Self { store, embedder: None, reranker: None }
    }

    /// Attach an embedding model.
    pub fn with_embedder(mut self, embedder: Arc<dyn Embedder>) -> Self {
        self.embedder = Some(embedder);
        self
    }

    /// Attach an optional reranker.
    pub fn with_reranker(mut self, reranker: Arc<dyn Reranker>) -> Self {
        self.reranker = Some(reranker);
        self
    }

    /// Execute a search according to `opts`.
    pub async fn search(&self, query: &str, opts: &SearchOptions) -> Result<SearchResult> {
        let start = Instant::now();

        // 1. Determine effective mode (Honest Delivery degrade if embedder missing).
        let (effective_mode, mut fallback_reason) = match opts.mode {
            SearchMode::Lexical => (SearchMode::Lexical, None),
            SearchMode::Vector => {
                if self.embedder.is_some() {
                    (SearchMode::Vector, None)
                } else {
                    (
                        SearchMode::Lexical,
                        Some("No embedder configured; fell back to lexical search".to_string()),
                    )
                }
            },
            SearchMode::Hybrid => {
                if self.embedder.is_some() {
                    (SearchMode::Hybrid, None)
                } else {
                    (
                        SearchMode::Lexical,
                        Some(
                            "No embedder configured for vector branch; fell back to lexical search"
                                .to_string(),
                        ),
                    )
                }
            },
        };

        // 2. Fetch candidates according to effective mode.
        let (mut hits, total_candidates) = match effective_mode {
            SearchMode::Lexical => {
                let fetch_limit = (opts.limit * 3).max(opts.rerank_top_n);
                let raw = self.store.search_lexical(query, fetch_limit).await?;
                let filtered = self.filter_path_prefix(raw, opts.path_prefix.as_deref());
                let total = filtered.len();
                (filtered, total)
            },
            SearchMode::Vector => {
                let emb = self.embedder.as_ref().expect("embedder verified in effective_mode");
                let q_vec = emb.embed_query(query).await?;
                let fetch_limit = (opts.limit * 3).max(opts.rerank_top_n);
                let raw = self.store.search_vector(&q_vec, emb.model_id(), fetch_limit).await?;
                let filtered = self.filter_path_prefix(raw, opts.path_prefix.as_deref());
                let total = filtered.len();
                (filtered, total)
            },
            SearchMode::Hybrid => {
                let fetch_limit = (opts.limit * 3).max(opts.rerank_top_n);

                // Fetch lexical branch
                let lex_raw = self.store.search_lexical(query, fetch_limit).await?;
                let lex_hits = self.filter_path_prefix(lex_raw, opts.path_prefix.as_deref());

                // Fetch vector branch
                let emb = self.embedder.as_ref().expect("embedder verified in effective_mode");
                let q_vec = emb.embed_query(query).await?;
                let vec_raw = self.store.search_vector(&q_vec, emb.model_id(), fetch_limit).await?;
                let vec_hits = self.filter_path_prefix(vec_raw, opts.path_prefix.as_deref());

                let total = lex_hits.len() + vec_hits.len();
                let fused = self.fuse_rrf(lex_hits, vec_hits, opts.rrf_k);
                (fused, total)
            },
        };

        // 3. Optional cross-encoder reranking on top candidates
        if opts.rerank
            && !hits.is_empty()
            && let Some(reranker) = self.reranker.as_ref()
        {
            let rerank_count = opts.rerank_top_n.min(hits.len());
            let mut top_slice = hits[..rerank_count].to_vec();

            match reranker.rerank(query, &mut top_slice).await {
                Ok(()) => {
                    for item in &mut top_slice {
                        item.channel = "rerank".to_string();
                    }
                    // Replace reranked slice in hits
                    hits.splice(..rerank_count, top_slice);
                },
                Err(error) => {
                    let reason = format!(
                        "Reranker `{}` failed; kept retrieval order: {error}",
                        reranker.model_id()
                    );
                    fallback_reason = Some(match fallback_reason {
                        Some(existing) => format!("{existing}; {reason}"),
                        None => reason,
                    });
                },
            }
        }

        // 4. Truncate to final limit
        if hits.len() > opts.limit {
            hits.truncate(opts.limit);
        }

        let elapsed_ms = start.elapsed().as_millis() as u64;

        Ok(SearchResult {
            query: query.to_string(),
            hits,
            mode_served: effective_mode,
            fallback_reason,
            elapsed_ms,
            total_candidates,
        })
    }

    fn filter_path_prefix(
        &self,
        chunks: Vec<ScoredChunk>,
        prefix: Option<&str>,
    ) -> Vec<ScoredChunk> {
        let Some(p) = prefix else {
            return chunks;
        };
        chunks.into_iter().filter(|c| c.chunk.path.starts_with(p)).collect()
    }

    fn fuse_rrf(
        &self,
        lex_hits: Vec<ScoredChunk>,
        vec_hits: Vec<ScoredChunk>,
        k: f64,
    ) -> Vec<ScoredChunk> {
        if lex_hits.is_empty() {
            return vec_hits;
        }
        if vec_hits.is_empty() {
            return lex_hits;
        }

        let mut chunk_map: HashMap<i64, ScoredChunk> = HashMap::new();
        let lex_ids: Vec<i64> = lex_hits
            .into_iter()
            .map(|c| {
                let id = c.chunk.id;
                chunk_map.entry(id).or_insert(c);
                id
            })
            .collect();

        let vec_ids: Vec<i64> = vec_hits
            .into_iter()
            .map(|c| {
                let id = c.chunk.id;
                chunk_map.entry(id).or_insert(c);
                id
            })
            .collect();

        let ranked = rrf(&[&lex_ids, &vec_ids], k);

        let mut out = Vec::with_capacity(ranked.len());
        for (chunk_id, rrf_score) in ranked {
            if let Some(mut item) = chunk_map.remove(&chunk_id) {
                item.score = rrf_score;
                item.channel = "rrf".to_string();
                out.push(item);
            }
        }
        out
    }
}
