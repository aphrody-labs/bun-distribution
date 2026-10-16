// SPDX-License-Identifier: Apache-2.0
//! Thread management and lifecycle types.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};

use super::{
    common::{AskForApproval, ReasoningEffort, SandboxMode},
    turn::Turn,
};

/// Runtime status of a thread.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ThreadStatus {
    /// Thread is active and ready for turns.
    #[default]
    Active,
    /// Thread is currently executing a turn.
    Running,
    /// Thread has been archived.
    Archived,
    /// Thread has encountered a terminal error.
    Error,
}

/// History storage mode for a thread.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ThreadHistoryMode {
    #[default]
    Legacy,
    Paginated,
}

/// Origin of a thread session.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SessionSource {
    Cli,
    #[serde(rename = "vscode")]
    #[default]
    VsCode,
    Exec,
    AppServer,
    Custom(String),
}

/// Git metadata captured when a thread is created.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitInfo {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sha: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub branch: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub origin_url: Option<String>,
}

/// Full thread descriptor.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Thread {
    /// Unique thread identifier (UUIDv7 string).
    pub id: String,
    /// Shared session identifier.
    pub session_id: String,
    /// Preview of thread goal or first user turn.
    #[serde(default)]
    pub preview: String,
    /// Whether the thread is ephemeral (in-memory only).
    #[serde(default)]
    pub ephemeral: bool,
    /// Active model provider (e.g. "llama", "antigravity", "openai").
    pub model_provider: String,
    /// Active model name.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    /// Working directory for the thread.
    pub cwd: String,
    /// Timestamp created (epoch seconds).
    pub created_at: i64,
    /// Timestamp last updated (epoch seconds).
    pub updated_at: i64,
    /// Runtime thread status.
    pub status: ThreadStatus,
    /// Thread session origin.
    #[serde(default)]
    pub source: SessionSource,
    /// Associated turns when requested (e.g. on resume/read).
    #[serde(default)]
    pub turns: Vec<Turn>,
    /// Optional Git repository state.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub git_info: Option<GitInfo>,
    /// Optional user-assigned thread name.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
}

impl Thread {
    /// Convenience constructor for thread descriptors.
    #[must_use]
    pub fn new(id: impl Into<String>, created_at: i64) -> Self {
        let id_str = id.into();
        Self {
            id: id_str.clone(),
            session_id: format!("sess_{id_str}"),
            preview: String::new(),
            ephemeral: false,
            model_provider: "llama".to_string(),
            model: None,
            cwd: ".".to_string(),
            created_at,
            updated_at: created_at,
            status: ThreadStatus::Active,
            source: SessionSource::Exec,
            turns: Vec::new(),
            git_info: None,
            name: None,
        }
    }
}

/// Parameters for `thread/start`.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThreadStartParams {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model_provider: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cwd: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub approval_policy: Option<AskForApproval>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sandbox: Option<SandboxMode>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub runtime_workspace_roots: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub config: Option<HashMap<String, serde_json::Value>>,
}

/// Response returned by `thread/start`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThreadStartResponse {
    pub thread: Thread,
    pub model: String,
    pub model_provider: String,
    pub cwd: String,
    pub approval_policy: AskForApproval,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reasoning_effort: Option<ReasoningEffort>,
}

/// Parameters for `thread/resume`.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThreadResumeParams {
    pub thread_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cwd: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub approval_policy: Option<AskForApproval>,
}

/// Response returned by `thread/resume`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThreadResumeResponse {
    pub thread: Thread,
    pub model: String,
    pub model_provider: String,
}

/// Parameters for `thread/fork`.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThreadForkParams {
    pub thread_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cwd: Option<String>,
}

/// Response returned by `thread/fork`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThreadForkResponse {
    pub thread: Thread,
    pub model: String,
    pub model_provider: String,
}

/// Parameters for `thread/list`.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThreadListParams {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cursor: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub limit: Option<u32>,
    #[serde(default)]
    pub archived: bool,
}

/// Response returned by `thread/list`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThreadListResponse {
    pub threads: Vec<Thread>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub next_cursor: Option<String>,
}

/// Parameters for `thread/read`.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThreadReadParams {
    pub thread_id: String,
    #[serde(default)]
    pub include_turns: bool,
}

/// Response returned by `thread/read`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThreadReadResponse {
    pub thread: Thread,
}

/// Parameters for `thread/archive`.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThreadArchiveParams {
    pub thread_id: String,
}

/// Response returned by `thread/archive`.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThreadArchiveResponse {
    pub archived: bool,
}

/// Parameters for `thread/unarchive`.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThreadUnarchiveParams {
    pub thread_id: String,
}

/// Response returned by `thread/unarchive`.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThreadUnarchiveResponse {
    pub archived: bool,
}

/// Parameters for `thread/close`.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThreadCloseParams {
    pub thread_id: String,
}

/// Response returned by `thread/close`.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThreadCloseResponse {
    pub thread_id: String,
    pub status: String,
}

/// Parameters for `thread/compact/start`.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThreadCompactStartParams {
    pub thread_id: String,
}

/// Response returned by `thread/compact/start`.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThreadCompactStartResponse {}
