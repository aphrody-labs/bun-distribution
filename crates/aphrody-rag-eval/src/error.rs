// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 aphrody contributors

//! Typed errors for the RAG evaluation harness.

use thiserror::Error;

/// Result type alias for evaluation operations.
pub type Result<T, E = EvalError> = std::result::Result<T, E>;

/// Errors encountered during benchmark runs.
#[derive(Debug, Error)]
pub enum EvalError {
    /// HTTP communication error with target endpoint.
    #[error("HTTP error: {0}")]
    Http(#[from] reqwest::Error),

    /// File I/O error reading gold sets or storing reports.
    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),

    /// JSON serialization or deserialization error.
    #[error("JSON error: {0}")]
    Serde(#[from] serde_json::Error),

    /// Error within the local RAG engine.
    #[error("local RAG error: {0}")]
    Rag(#[from] aphrody_rag::error::RagError),

    /// Circuit breaker tripped after repeated server errors or rate limiting.
    #[error(
        "circuit breaker tripped after {consecutive_failures} consecutive errors (last HTTP \
         {last_status}): {message}"
    )]
    CircuitBreaker {
        /// Number of consecutive failures encountered.
        consecutive_failures: usize,
        /// Last observed HTTP status code.
        last_status: u16,
        /// Error explanation.
        message: String,
    },

    /// Quality gate failure: observed metric falls below required threshold.
    #[error(
        "eval quality gate failed on `{metric}`: observed {observed:.4} < threshold {threshold:.4}"
    )]
    GateFailed {
        /// Evaluated metric name (e.g. `recall@5`).
        metric: String,
        /// Observed metric value.
        observed: f64,
        /// Minimum acceptable threshold.
        threshold: f64,
    },

    /// Evaluation condition mismatch (e.g. mixed modes served when not permitted).
    #[error("condition mismatch: expected uniform mode `{expected}`, but encountered `{observed}`")]
    ConditionMismatch {
        /// Dominant or expected mode.
        expected: String,
        /// Divergent mode observed on a query.
        observed: String,
    },

    /// Gold set contained no valid test cases.
    #[error("empty gold set: no test cases were provided or parsed")]
    EmptyGoldSet,

    /// General pipeline error.
    #[error("eval error: {0}")]
    Other(String),
}
