// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 aphrody contributors

//! In-process open-weight embeddings backed by ONNX Runtime.

use std::{
    path::Path,
    sync::{Arc, Mutex},
};

use aphrody_embed::{Embedder as NativeEmbedder, EmbeddingModelKind, UserDefinedEmbedder};
use async_trait::async_trait;

use super::Embedder;
use crate::error::{RagError, Result};

/// Thread-safe async adapter around aphrody's local fastembed/ORT engine.
#[derive(Clone)]
pub struct OrtEmbedder {
    inner: Arc<Mutex<LocalEngine>>,
    model_id: String,
    dimension: usize,
}

enum LocalEngine {
    Catalog(NativeEmbedder),
    UserDefined(UserDefinedEmbedder),
}

impl OrtEmbedder {
    /// Load a supported open-weight embedding model from the shared model cache.
    ///
    /// # Errors
    ///
    /// Returns a typed RAG error when model resolution, download, or ONNX
    /// initialization fails.
    pub fn load(model: &str) -> Result<Self> {
        let kind = model
            .parse::<EmbeddingModelKind>()
            .map_err(|error| RagError::EmbeddingFailed(error.to_string()))?;
        let dimension = kind.dimension();
        let native = NativeEmbedder::new(kind)
            .map_err(|error| RagError::EmbeddingFailed(error.to_string()))?;
        Ok(Self {
            inner: Arc::new(Mutex::new(LocalEngine::Catalog(native))),
            model_id: format!("ort:{}", kind.as_str()),
            dimension,
        })
    }

    /// Load a locally trained SentenceTransformers ONNX export.
    ///
    /// # Errors
    /// Returns a typed RAG error if model files or ONNX inference are invalid.
    pub fn load_user_defined(onnx: &Path, tokenizer_dir: &Path) -> Result<Self> {
        let mut digest = blake3::Hasher::new();
        for path in [
            onnx.to_path_buf(),
            tokenizer_dir.join("tokenizer.json"),
            tokenizer_dir.join("config.json"),
            tokenizer_dir.join("special_tokens_map.json"),
            tokenizer_dir.join("tokenizer_config.json"),
        ] {
            let bytes = std::fs::read(&path).map_err(|error| {
                RagError::EmbeddingFailed(format!("{}: {error}", path.display()))
            })?;
            digest.update(&(bytes.len() as u64).to_le_bytes());
            digest.update(&bytes);
        }
        let native = UserDefinedEmbedder::load(onnx, tokenizer_dir)
            .map_err(|error| RagError::EmbeddingFailed(error.to_string()))?;
        let dimension = native.dimension();
        Ok(Self {
            inner: Arc::new(Mutex::new(LocalEngine::UserDefined(native))),
            model_id: format!("ort:user:{}", digest.finalize().to_hex()),
            dimension,
        })
    }
}

#[async_trait]
impl Embedder for OrtEmbedder {
    fn model_id(&self) -> &str {
        &self.model_id
    }

    fn dimension(&self) -> usize {
        self.dimension
    }

    async fn embed(&self, texts: &[String], _is_query: bool) -> Result<Vec<Vec<f32>>> {
        if texts.is_empty() {
            return Ok(Vec::new());
        }
        let inner = Arc::clone(&self.inner);
        let texts = texts.to_vec();
        tokio::task::spawn_blocking(move || {
            let mut engine = inner.lock().map_err(|_| {
                RagError::EmbeddingFailed("local ONNX embedding engine lock poisoned".into())
            })?;
            let vectors = match &mut *engine {
                LocalEngine::Catalog(native) => native.embed_batch(&texts, None),
                LocalEngine::UserDefined(native) => native.embed_batch(&texts),
            };
            vectors.map_err(|error| RagError::EmbeddingFailed(error.to_string()))
        })
        .await
        .map_err(|error| RagError::EmbeddingFailed(format!("embedding worker failed: {error}")))?
    }
}

#[cfg(test)]
mod tests {
    use super::OrtEmbedder;

    #[test]
    fn user_defined_loader_requires_local_export_files() {
        let empty = tempfile::tempdir().unwrap();
        let onnx = empty.path().join("onnx/model.onnx");
        let error = OrtEmbedder::load_user_defined(&onnx, empty.path())
            .err()
            .unwrap();
        assert!(error.to_string().contains("model.onnx"));
    }
}
