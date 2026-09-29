// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 aphrody contributors

//! Retrieval targets evaluated by the benchmark harness.

pub mod http;
pub mod local;
pub mod mcp;

use aphrody_rag_core::eval::RetrievedHit;
use async_trait::async_trait;
pub use http::HttpTarget;
pub use local::LocalIndexTarget;
pub use mcp::McpTarget;
use serde::{Deserialize, Serialize};

use crate::error::Result;

/// Response payload from an evaluation target.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TargetResponse {
    /// Retrieved candidate chunks / documents in rank order.
    pub hits: Vec<RetrievedHit>,
    /// Actual mode served ("lexical", "hybrid", "hybrid+rerank", etc.).
    pub mode_served: String,
    /// Measured query latency in milliseconds.
    pub latency_ms: u64,
}

/// Abstract target capable of responding to retrieval queries.
#[async_trait]
pub trait EvalTarget: Send + Sync {
    /// Human-readable name or URL identifying this target.
    fn name(&self) -> &str;

    /// Execute a search for `query` with maximum rank `limit`.
    async fn query(&self, query: &str, limit: usize) -> Result<TargetResponse>;
}
