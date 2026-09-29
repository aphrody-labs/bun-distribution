// SPDX-License-Identifier: Apache-2.0
//! Server-to-client approval request and user input elicitation types.

use serde::{Deserialize, Serialize};

/// Decision returned by the client for a command approval request.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ApprovalDecision {
    /// Approved for this execution.
    #[default]
    Accept,
    /// Approved for the duration of this session.
    AcceptForSession,
    /// Denied; the model should replan or continue without running the command.
    Decline,
    /// Denied and the entire turn is canceled.
    Cancel,
}

/// Parameters for `item/commandExecution/requestApproval`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandExecutionRequestApprovalParams {
    pub thread_id: String,
    pub turn_id: String,
    pub item_id: String,
    pub command: String,
    pub cwd: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

/// Response for `item/commandExecution/requestApproval`.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandExecutionRequestApprovalResponse {
    pub decision: ApprovalDecision,
}

/// Parameters for `item/fileChange/requestApproval`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileChangeRequestApprovalParams {
    pub thread_id: String,
    pub turn_id: String,
    pub item_id: String,
    pub path: String,
    pub diff: String,
}

/// Response for `item/fileChange/requestApproval`.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileChangeRequestApprovalResponse {
    pub decision: ApprovalDecision,
}

/// Parameters for `item/permissions/requestApproval`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PermissionsRequestApprovalParams {
    pub thread_id: String,
    pub turn_id: String,
    pub requested_permissions: Vec<String>,
}

/// Response for `item/permissions/requestApproval`.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PermissionsRequestApprovalResponse {
    pub granted: bool,
}

/// Parameters for `item/tool/requestUserInput`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolRequestUserInputParams {
    pub thread_id: String,
    pub turn_id: String,
    pub item_id: String,
    pub message: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub choices: Option<Vec<String>>,
}

/// Response for `item/tool/requestUserInput`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolRequestUserInputResponse {
    pub answer: String,
}
