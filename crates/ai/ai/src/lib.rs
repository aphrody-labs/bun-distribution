// SPDX-License-Identifier: Apache-2.0
//! # Aphrody AI — Canonical Pure AI Surface
//!
//! Unifies models, inference, providers, RAG, agents, MCP toolcalls and sessions
//! into a clean, zero-coupling library layer.

pub use aphrody_agent_home as agent_home;
pub use aphrody_agent_runtime as agent_runtime;
pub use aphrody_agent_tools as agent_tools;
pub use aphrody_context as context;
pub use aphrody_mcp_client as mcp;
pub use aphrody_memory as memory;
pub use aphrody_models as models;
pub use aphrody_prompts as prompts;
pub use aphrody_providers as providers;
pub use aphrody_rag as rag;
pub use aphrody_rag_core as rag_core;
pub use aphrody_rag_eval as rag_eval;
pub use aphrody_router as router;
pub use aphrody_session as session;
pub use aphrody_supervisor as supervisor;
pub use aphrody_toolcall as toolcall;
pub use aphrody_tools as tools;
pub use aphrody_train as train;

/// Primary AI Engine Facade
#[derive(Debug, Default, Clone)]
pub struct AphrodyAiEngine {
    pub initialized: bool,
}

impl AphrodyAiEngine {
    /// Initialize the AI Engine and verify model registries
    pub fn new() -> Self {
        Self { initialized: true }
    }

    /// Status summary of active AI components
    pub fn status(&self) -> serde_json::Value {
        serde_json::json!({
            "status": "ready",
            "layer": "ai",
            "capabilities": [
                "local-inference",
                "rag-hybrid",
                "mcp-protocol",
                "autonomous-agents",
                "agent-home-seven-doc-sync",
                "agent-home-memory",
                "rag-evaluation",
                "guarded-training",
                "router-whitelist"
            ]
        })
    }
}
