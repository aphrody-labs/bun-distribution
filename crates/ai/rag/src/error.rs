// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 aphrody contributors

//! Typed errors for the RAG store, embedding, and search pipeline.

use std::path::PathBuf;

use thiserror::Error;

/// Result type alias for RAG operations.
pub type Result<T, E = RagError> = std::result::Result<T, E>;

/// Errors produced by the RAG pipeline.
#[derive(Debug, Error)]
pub enum RagError {
    /// SQLite database error.
    #[error("SQLite database error: {0}")]
    Sqlite(#[from] rusqlite::Error),

    /// I/O error during filesystem indexing or reading.
    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),

    /// HTTP request error (embedder or reranker endpoints).
    #[error("HTTP error: {0}")]
    Http(#[from] reqwest::Error),

    /// JSON serialization/deserialization error.
    #[error("JSON error: {0}")]
    Serde(#[from] serde_json::Error),

    /// Embedding computation failed.
    #[error("embedding generation failed: {0}")]
    EmbeddingFailed(String),

    /// Reranking failed.
    #[error("reranker failed: {0}")]
    RerankFailed(String),

    /// Vector dimension mismatch against active model.
    #[error("vector dimension mismatch: expected {expected}, found {found}")]
    DimensionMismatch {
        /// Expected dimension of the active embedding space.
        expected: usize,
        /// Observed vector dimension.
        found: usize,
    },

    /// Model space mismatch: attempt to mix vectors from different embedding models.
    #[error("embedding model mismatch: database has `{expected}`, query used `{found}`")]
    ModelMismatch {
        /// Active model in index.
        expected: String,
        /// Model requested by caller.
        found: String,
    },

    /// Document not found in store.
    #[error("document not found: `{0}`")]
    DocumentNotFound(String),

    /// Indexing failure for a path.
    #[error("indexing failed for `{path}`: {message}")]
    IndexFailed {
        /// Target path.
        path: PathBuf,
        /// Failure explanation.
        message: String,
    },

    /// Other unexpected pipeline error.
    #[error("RAG error: {0}")]
    Other(String),

    /// An explicit dimension override (`APHRODY_AI_EMBED_DIMENSIONS` or its
    /// alias `APHRODY_RAG_EMBED_DIM`) disagrees with the local catalog's
    /// dimension for the resolved model. Embedding spaces must never mix
    /// (CLAUDE.md §7): this is always an error, never a silent choice of one
    /// value over the other.
    #[error(
        "{env_var} sets the embedding vector width to {env_dim}, but model `{model}` is \
         catalogued at {catalog_dim} dimensions; fix the override or select a different model"
    )]
    EmbedDimensionMismatch {
        /// Canonical or alias environment variable name that supplied `env_dim`.
        env_var: &'static str,
        /// The overridden dimension.
        env_dim: usize,
        /// The model id the override applies to.
        model: String,
        /// The dimension the local catalog declares for `model`.
        catalog_dim: usize,
    },

    /// The resolved embedding model has no catalog entry (a raw reference
    /// such as an unlisted HuggingFace repo) and no dimension override or
    /// `[rag] vector_dim` supplies one either.
    #[error(
        "model `{model}` is not in the local catalog and no vector width is configured; set \
         `rag.vector_dim`, `APHRODY_AI_EMBED_DIMENSIONS`, or use a catalogued model"
    )]
    UnknownEmbedDimension {
        /// The model id that could not be resolved to a dimension.
        model: String,
    },

    /// `APHRODY_AI_EMBED_DIMENSIONS` (or its alias) is not a positive integer.
    #[error("{env_var}={raw:?} is not a positive integer: {source}")]
    InvalidEmbedDimension {
        /// The environment variable that carried the malformed value.
        env_var: &'static str,
        /// The raw value that failed to parse.
        raw: String,
        /// The underlying parse failure.
        #[source]
        source: std::num::ParseIntError,
    },

    /// `embed_backend` needs an HTTP endpoint (`LlamaServer` / `OpenaiCompat`)
    /// but none was resolved from `rag.embed_endpoint`,
    /// `APHRODY_AI_EMBED_BASE_URL`, or its aliases.
    #[error(
        "rag.embed_endpoint (or APHRODY_AI_EMBED_BASE_URL / its aliases) is required for embed_backend={backend:?}"
    )]
    MissingEmbedEndpoint {
        /// The backend that required an endpoint.
        backend: aphrody_config::EmbedBackend,
    },

    /// Reranking was requested but no endpoint was resolved from
    /// `rag.rerank_endpoint`, `APHRODY_AI_RERANK_BASE_URL`, or its aliases.
    #[error(
        "rag.rerank_endpoint (or APHRODY_AI_RERANK_BASE_URL / its aliases) is required when \
         reranking is enabled"
    )]
    MissingRerankEndpoint,
}
