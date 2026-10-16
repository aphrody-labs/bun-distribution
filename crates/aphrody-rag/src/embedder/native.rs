// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 aphrody contributors

//! In-process, pure-Rust CPU embeddings over `aphrody-embed`'s `native` engine.
//!
//! Unlike [`super::OrtEmbedder`] (fastembed/ONNX Runtime behind a `Mutex`), the
//! native encoder is `Send + Sync` and owns a private thread pool, so one shared
//! instance serves concurrent callers with no lock and the model is loaded once
//! per process, never per query. Query/passage prefixes (E5 `query: `, BGE
//! instruction) come from the pinned model manifest, not from this adapter.

use std::{path::Path, sync::Arc};

use aphrody_embed::native::{
    EmbedOptions, Embedder as NativeEngine, ModelFiles as _, TextKind, ensure_model, find_model,
    require_installed,
};
use async_trait::async_trait;

use super::Embedder;
use crate::error::{RagError, Result};

/// Lock-free async adapter around the native BERT-family embedder.
#[derive(Clone)]
pub struct NativeEmbedder {
    engine: Arc<NativeEngine>,
    model_id: String,
}

impl NativeEmbedder {
    /// Load an already-installed manifest model (no network I/O).
    ///
    /// # Errors
    /// Typed RAG error when the model id is unknown, not installed, or fails to load.
    pub fn load(model: &str) -> Result<Self> {
        Self::load_inner(model, false)
    }

    /// Load a manifest model, downloading it (sha256-verified) first if missing.
    ///
    /// # Errors
    /// Typed RAG error on unknown model, download, or load failure.
    pub fn load_or_install(model: &str) -> Result<Self> {
        Self::load_inner(model, true)
    }

    fn load_inner(model: &str, install: bool) -> Result<Self> {
        let spec = find_model(model)
            .ok_or_else(|| RagError::EmbeddingFailed(format!("unknown native model `{model}`")))?;
        let dir = spec.default_dir();
        let dir = if install { ensure_model(&spec, &dir) } else { require_installed(&spec, &dir) }
            .map_err(|error| RagError::EmbeddingFailed(error.to_string()))?;
        Self::from_dir(&dir, &spec)
    }

    fn from_dir(dir: &Path, spec: &aphrody_embed::native::ModelSpec) -> Result<Self> {
        let engine = NativeEngine::load(dir, spec, EmbedOptions::default())
            .map_err(|error| RagError::EmbeddingFailed(error.to_string()))?;
        Ok(Self { engine: Arc::new(engine), model_id: format!("native:{}", spec.versioned_id()) })
    }
}

#[async_trait]
impl Embedder for NativeEmbedder {
    fn model_id(&self) -> &str {
        &self.model_id
    }

    fn dimension(&self) -> usize {
        self.engine.dim()
    }

    async fn embed(&self, texts: &[String], is_query: bool) -> Result<Vec<Vec<f32>>> {
        if texts.is_empty() {
            return Ok(Vec::new());
        }
        let engine = Arc::clone(&self.engine);
        let texts = texts.to_vec();
        let kind = if is_query { TextKind::Query } else { TextKind::Passage };
        tokio::task::spawn_blocking(move || {
            let refs: Vec<&str> = texts.iter().map(String::as_str).collect();
            engine
                .embed_batch(&refs, kind)
                .map_err(|error| RagError::EmbeddingFailed(error.to_string()))
        })
        .await
        .map_err(|error| RagError::EmbeddingFailed(format!("embedding worker failed: {error}")))?
    }
}
