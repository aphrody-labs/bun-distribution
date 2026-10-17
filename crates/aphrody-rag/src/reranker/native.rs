// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 aphrody contributors

//! In-process cross-encoder reranking over `aphrody-embed`'s `native` engine
//! (no HTTP hop, no llama-server, model loaded once and shared lock-free).

use std::sync::Arc;

use aphrody_embed::native::{
    EmbedOptions, ModelFiles as _, Reranker as NativeEngine, ensure_model, find_reranker,
    require_installed,
};
use async_trait::async_trait;

use super::Reranker;
use crate::{
    error::{RagError, Result},
    store::ScoredChunk,
};

/// Lock-free async adapter around the native cross-encoder.
#[derive(Clone)]
pub struct NativeReranker {
    engine: Arc<NativeEngine>,
    model_id: String,
}

impl NativeReranker {
    /// Load an already-installed manifest reranker (no network I/O).
    ///
    /// # Errors
    /// Typed RAG error when unknown, not installed, or fails to load.
    pub fn load(model: &str) -> Result<Self> {
        Self::load_inner(model, false)
    }

    /// Load a manifest reranker, downloading it (sha256-verified) first if missing.
    ///
    /// # Errors
    /// Typed RAG error on unknown model, download, or load failure.
    pub fn load_or_install(model: &str) -> Result<Self> {
        Self::load_inner(model, true)
    }

    fn load_inner(model: &str, install: bool) -> Result<Self> {
        let spec = find_reranker(model)
            .ok_or_else(|| RagError::RerankFailed(format!("unknown native reranker `{model}`")))?;
        let dir = spec.default_dir();
        let dir = if install {
            ensure_model(&spec, &dir)
        } else {
            require_installed(&spec, &dir)
        }
        .map_err(|error| RagError::RerankFailed(error.to_string()))?;
        let engine = NativeEngine::load(&dir, &spec, EmbedOptions::default())
            .map_err(|error| RagError::RerankFailed(error.to_string()))?;
        Ok(Self {
            engine: Arc::new(engine),
            model_id: format!("native:{}", spec.versioned_id()),
        })
    }
}

#[async_trait]
impl Reranker for NativeReranker {
    fn model_id(&self) -> &str {
        &self.model_id
    }

    async fn rerank(&self, query: &str, candidates: &mut [ScoredChunk]) -> Result<()> {
        if candidates.is_empty() {
            return Ok(());
        }
        let engine = Arc::clone(&self.engine);
        let query = query.to_owned();
        let passages: Vec<String> = candidates.iter().map(|c| c.chunk.content.clone()).collect();
        let scores = tokio::task::spawn_blocking(move || {
            let refs: Vec<&str> = passages.iter().map(String::as_str).collect();
            engine.score(&query, &refs)
        })
        .await
        .map_err(|error| RagError::RerankFailed(format!("rerank worker failed: {error}")))?
        .map_err(|error| RagError::RerankFailed(error.to_string()))?;
        if scores.len() != candidates.len() {
            return Err(RagError::RerankFailed(
                "score count differs from candidates".into(),
            ));
        }
        for (candidate, score) in candidates.iter_mut().zip(scores) {
            candidate.score = f64::from(score);
        }
        candidates.sort_by(|a, b| b.score.total_cmp(&a.score));
        Ok(())
    }
}
