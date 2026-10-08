// SPDX-License-Identifier: Apache-2.0
//! Errors of the code graph.

use thiserror::Error;

/// Result alias.
pub type Result<T, E = GraphError> = std::result::Result<T, E>;

/// Failures of graph loading, analysis and export.
#[derive(Debug, Error)]
pub enum GraphError {
    /// Home database failure.
    #[error("store error: {0}")]
    Store(#[from] aphrody_store::StoreError),
    /// SQLite failure.
    #[error("SQLite error: {0}")]
    Sqlite(#[from] rusqlite::Error),
    /// JSON failure.
    #[error("JSON error: {0}")]
    Json(#[from] serde_json::Error),
    /// The named graph source does not exist.
    #[error("unknown graph source `{0}`")]
    UnknownSource(String),
    /// A node reference matched nothing.
    #[error("no node matches `{0}`")]
    NoMatch(String),
    /// A node reference matched several nodes.
    #[error(
        "`{text}` matches {total} nodes; pass an id or `file::symbol`:\n  {}",
        candidates.join("\n  ")
    )]
    Ambiguous {
        /// The reference.
        text: String,
        /// Number of candidates.
        total: usize,
        /// First candidates: `label - file:loc [id ...] (n edges)`.
        candidates: Vec<String>,
    },
}
