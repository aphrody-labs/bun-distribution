// SPDX-License-Identifier: Apache-2.0
//! Turn execution, steering, and interruption types.

use serde::{Deserialize, Serialize};

use super::{
    common::{AskForApproval, ReasoningEffort, SandboxMode},
    item::ThreadItem,
};

/// Execution status of a turn.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TurnStatus {
    #[default]
    InProgress,
    Completed,
    Interrupted,
    Failed,
}

/// A text or multimodal input element from the user.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum UserInput {
    Text { text: String },
    Image { url: String },
}

impl UserInput {
    /// Create a plain text input.
    #[must_use]
    pub fn text(s: impl Into<String>) -> Self {
        Self::Text { text: s.into() }
    }
}

/// Full turn representation.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Turn {
    /// Turn identifier (UUIDv7 string).
    pub id: String,
    /// Parent thread identifier.
    pub thread_id: String,
    /// Turn status.
    pub status: TurnStatus,
    /// Items generated during this turn (user message, agent message, tool calls).
    #[serde(default)]
    pub items: Vec<ThreadItem>,
    /// Optional error description if the turn failed.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

/// Parameters for `turn/start`.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TurnStartParams {
    pub thread_id: String,
    pub input: Vec<UserInput>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cwd: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub approval_policy: Option<AskForApproval>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sandbox: Option<SandboxMode>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub effort: Option<ReasoningEffort>,
}

/// Response returned by `turn/start`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TurnStartResponse {
    pub turn: Turn,
}

/// Parameters for `turn/steer`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TurnSteerParams {
    pub thread_id: String,
    pub turn_id: String,
    pub input: Vec<UserInput>,
}

/// Response returned by `turn/steer`.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TurnSteerResponse {
    pub steered: bool,
}

/// Parameters for `turn/interrupt`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TurnInterruptParams {
    pub thread_id: String,
    pub turn_id: String,
}

/// Response returned by `turn/interrupt`.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TurnInterruptResponse {
    pub interrupted: bool,
}
