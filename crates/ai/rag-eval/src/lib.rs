// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 aphrody contributors

//! RAG retrieval evaluation harness and quality gate benchmark.
//!
//! Evaluates local or remote search endpoints (HTTP, MCP, local in-process) against
//! gold retrieval test suites, enforcing strict quality gates (Recall@k, MRR, nDCG@10)
//! and condition consistency rules.

pub mod cli;
pub mod error;
pub mod harness;
pub mod target;

pub use aphrody_rag_core::eval::{
    Aggregate, CaseResult, Gate, GoldCase, LatencyStats, Report, RetrievedHit, parse_gold,
};
pub use cli::cli_main;
pub use error::{EvalError, Result};
pub use harness::{EvalOptions, EvalSummary, run_eval};
pub use target::{EvalTarget, HttpTarget, LocalIndexTarget, McpTarget, TargetResponse};
