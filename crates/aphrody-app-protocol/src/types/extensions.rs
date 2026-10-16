// SPDX-License-Identifier: Apache-2.0
//! Aphrody protocol extensions (`aphrody/*`).
//!
//! Available when the client declares `capabilities.aphrody = true` during `initialize`.

use serde::{Deserialize, Serialize};

/// Parameters for `aphrody/rag/search`.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RagSearchParams {
    pub query: String,
    #[serde(default = "default_top_k")]
    pub top_k: usize,
}

const fn default_top_k() -> usize {
    5
}

/// A retrieved RAG chunk.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RagSearchResult {
    pub chunk_id: String,
    pub path: String,
    pub content: String,
    pub score: f32,
}

/// Response returned by `aphrody/rag/search`.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RagSearchResponse {
    pub results: Vec<RagSearchResult>,
}

/// Parameters for `aphrody/rag/context`.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RagContextParams {
    pub query: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_tokens: Option<usize>,
}

/// Response returned by `aphrody/rag/context`.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RagContextResponse {
    pub prompt_context: String,
    pub sources: Vec<String>,
}

/// Parameters for `aphrody/rag/status`.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RagStatusParams {}

/// Response returned by `aphrody/rag/status`.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RagStatusResponse {
    pub indexed_documents: usize,
    pub total_chunks: usize,
    pub database_path: String,
    pub embed_model: String,
}

/// Parameters for `aphrody/status`.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AphrodyStatusParams {}

/// Feature flags reported by `aphrody/status`.
///
/// A plain wire DTO mirroring the JSON shape `aphrody-ai`'s app-server already
/// returns (`crates/aphrody-app-server/src/lib.rs`); each field is an
/// independent on/off flag, not branching control flow, so a state machine or
/// enum split would not simplify it.
#[allow(clippy::struct_excessive_bools)]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AphrodyStatusCapabilities {
    pub threads: bool,
    pub turns: bool,
    pub local_models: bool,
    pub interrupt: bool,
    pub steer: bool,
    pub events: bool,
    pub rag: bool,
}

/// Response returned by `aphrody/status` (aliased `system/status` on the wire).
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AphrodyStatusResponse {
    pub service: String,
    pub version: String,
    pub initialized: bool,
    pub threads: usize,
    pub home: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub profile: Option<String>,
    pub capabilities: AphrodyStatusCapabilities,
}

/// Parameters for `aphrody/llama/status`.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LlamaStatusParams {}

/// Response returned by `aphrody/llama/status`.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LlamaStatusResponse {
    pub running: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pid: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub port: Option<u16>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub active_model: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub vram_usage_mib: Option<u64>,
}

/// Parameters for `aphrody/train/status`.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrainStatusParams {}

/// Response returned by `aphrody/train/status`.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrainStatusResponse {
    pub active: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub job_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub step: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub total_steps: Option<u64>,
}

/// Parameters for `notifications/drain` (canonical name; `aphrody-ai`'s
/// dispatcher accepts the alias `aphrody/notifications` via raw-string
/// normalization, the same pattern as the `model/list`/`models/list` alias —
/// there is no separate enum variant for the alias).
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NotificationsDrainParams {}

/// Response returned by `notifications/drain`.
///
/// `notifications` is `serde_json::Value` rather than `Vec<ServerNotification>`
/// on purpose: `aphrody-ai`'s dispatcher drains its internal notification
/// queue as opaque, already-serialized JSON (`self.drain_notifications()`),
/// not as typed `ServerNotification` values, so typing this field more
/// strictly would claim a guarantee the implementation does not provide.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NotificationsDrainResponse {
    pub notifications: Vec<serde_json::Value>,
}

/// Parameters for `shutdown`.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShutdownParams {}

/// Response returned by `shutdown`.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShutdownResponse {
    pub ok: bool,
}

/// Parameters for `tools/list`.
///
/// Same shape as [`super::config::ConfigReadParams`]: `aphrody-ai` resolves
/// `tools/list` through the same profile/config resolution path
/// (`config::resolve_with_profile`) as `config/read`, keyed by an optional
/// thread id.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolsListParams {
    /// Optional thread id to layer thread-scoped configuration.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub thread_id: Option<String>,
}

/// Response returned by `tools/list`.
///
/// `data` stays `serde_json::Value` rather than a typed tool-schema struct:
/// it is the OpenAI-function-shaped array produced by
/// `aphrody_agent_runtime`'s tool registry (`tools.openai_functions()`), a
/// large, evolving shape owned by that crate, not by this contract.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolsListResponse {
    pub data: serde_json::Value,
}

/// Parameters for `turn/events`.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TurnEventsParams {
    pub thread_id: String,
}

/// Response returned by `turn/events`.
///
/// `data` and `notifications` stay `serde_json::Value`: the underlying event
/// stream (`aphrody-agent-proto::Event`) is `snake_case` by the documented,
/// deliberate exception in `docs/API.md` §1 (mirrors the upstream Codex CLI
/// wire protocol this crate is compatible with) — re-typing it camelCase
/// here would misrepresent what is actually on the wire.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TurnEventsResponse {
    pub thread_id: String,
    pub data: serde_json::Value,
    pub completed: bool,
    pub notifications: serde_json::Value,
}
