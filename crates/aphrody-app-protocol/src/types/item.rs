// SPDX-License-Identifier: Apache-2.0
//! Granular thread items generated during turns.

use serde::{Deserialize, Serialize};

use super::turn::UserInput;

/// Status of a command execution item.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum CommandExecutionStatus {
    #[default]
    Pending,
    InProgress,
    Completed,
    Failed,
    Declined,
}

/// Status of an apply_patch / file modification item.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PatchApplyStatus {
    #[default]
    Pending,
    Completed,
    Failed,
    Declined,
}

/// A single step or artifact produced during a turn.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum ThreadItem {
    #[serde(rename_all = "camelCase")]
    UserMessage { id: String, content: Vec<UserInput> },
    #[serde(rename_all = "camelCase")]
    AgentMessage { id: String, text: String },
    #[serde(rename_all = "camelCase")]
    ContextCompaction { id: String },
    #[serde(rename_all = "camelCase")]
    FunctionCallOutput {
        id: String,
        name: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        namespace: Option<String>,
        output: serde_json::Value,
    },
    #[serde(rename_all = "camelCase")]
    Plan { id: String, text: String },
    #[serde(rename_all = "camelCase")]
    Reasoning {
        id: String,
        #[serde(default)]
        summary: Vec<String>,
        #[serde(default)]
        content: Vec<String>,
    },
    #[serde(rename_all = "camelCase")]
    CommandExecution {
        id: String,
        command: String,
        cwd: String,
        status: CommandExecutionStatus,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        aggregated_output: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        exit_code: Option<i32>,
    },
    #[serde(rename_all = "camelCase")]
    FileChange {
        id: String,
        path: String,
        diff: String,
        status: PatchApplyStatus,
    },
    #[serde(rename_all = "camelCase")]
    McpToolCall {
        id: String,
        server_name: String,
        tool_name: String,
        arguments: serde_json::Value,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        result: Option<serde_json::Value>,
    },
    #[serde(rename_all = "camelCase")]
    WebSearch {
        id: String,
        query: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        result: Option<serde_json::Value>,
    },
}
