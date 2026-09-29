// SPDX-License-Identifier: Apache-2.0
//! Top-level JSONL thread events emitted by `aphrody exec --experimental-json`.
//!
//! This matches the exact contract expected by the OpenAI Codex TypeScript SDK.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};
use serde_json::Value as JsonValue;

/// Top-level JSONL events emitted by aphrody exec.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type")]
pub enum ThreadEvent {
    /// Emitted when a new thread is started as the first event.
    #[serde(rename = "thread.started")]
    ThreadStarted(ThreadStartedEvent),
    /// Emitted when a turn is started by sending a new prompt to the model.
    #[serde(rename = "turn.started")]
    TurnStarted(TurnStartedEvent),
    /// Emitted when a turn is completed, carrying token usage.
    #[serde(rename = "turn.completed")]
    TurnCompleted(TurnCompletedEvent),
    /// Indicates that a turn failed with an error.
    #[serde(rename = "turn.failed")]
    TurnFailed(TurnFailedEvent),
    /// Emitted when a new item is added to the thread.
    #[serde(rename = "item.started")]
    ItemStarted(ItemStartedEvent),
    /// Emitted when an item is updated.
    #[serde(rename = "item.updated")]
    ItemUpdated(ItemUpdatedEvent),
    /// Signals that an item has reached a terminal state (success or failure).
    #[serde(rename = "item.completed")]
    ItemCompleted(ItemCompletedEvent),
    /// Unrecoverable stream-level error.
    #[serde(rename = "error")]
    Error(ThreadErrorEvent),
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ThreadStartedEvent {
    /// Unique identifier for the started thread.
    pub thread_id: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct TurnStartedEvent {}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TurnCompletedEvent {
    pub usage: Usage,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TurnFailedEvent {
    pub error: ThreadErrorEvent,
}

/// Token usage reported for a turn.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct Usage {
    pub input_tokens: i64,
    pub cached_input_tokens: i64,
    #[serde(default)]
    pub cache_write_input_tokens: i64,
    pub output_tokens: i64,
    pub reasoning_output_tokens: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ItemStartedEvent {
    pub item: ThreadItem,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ItemUpdatedEvent {
    pub item: ThreadItem,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ItemCompletedEvent {
    pub item: ThreadItem,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ThreadErrorEvent {
    pub message: String,
}

/// Canonical representation of a thread item in the stream.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ThreadItem {
    pub id: String,
    #[serde(flatten)]
    pub details: ThreadItemDetails,
}

/// Specific payload variants for thread items.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ThreadItemDetails {
    AgentMessage(AgentMessageItem),
    Reasoning(ReasoningItem),
    CommandExecution(CommandExecutionItem),
    FileChange(FileChangeItem),
    McpToolCall(McpToolCallItem),
    CollabToolCall(CollabToolCallItem),
    WebSearch(WebSearchItem),
    TodoList(TodoListItem),
    Error(ErrorItem),
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AgentMessageItem {
    pub text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ReasoningItem {
    pub text: String,
}

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum CommandExecutionStatus {
    #[default]
    InProgress,
    Completed,
    Failed,
    Declined,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct CommandExecutionItem {
    pub command: String,
    pub aggregated_output: String,
    pub exit_code: Option<i32>,
    pub status: CommandExecutionStatus,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum PatchChangeKind {
    Add,
    Delete,
    Update,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct FileUpdateChange {
    pub path: String,
    pub kind: PatchChangeKind,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum PatchApplyStatus {
    InProgress,
    Completed,
    Failed,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct FileChangeItem {
    pub changes: Vec<FileUpdateChange>,
    pub status: PatchApplyStatus,
}

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum McpToolCallStatus {
    #[default]
    InProgress,
    Completed,
    Failed,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct McpToolCallItemResult {
    pub content: Vec<JsonValue>,
    #[serde(rename = "_meta", skip_serializing_if = "Option::is_none")]
    pub meta: Option<JsonValue>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub structured_content: Option<JsonValue>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct McpToolCallItemError {
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct McpToolCallItem {
    pub server: String,
    pub tool: String,
    #[serde(default)]
    pub arguments: JsonValue,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<McpToolCallItemResult>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<McpToolCallItemError>,
    pub status: McpToolCallStatus,
}

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum CollabToolCallStatus {
    #[default]
    InProgress,
    Completed,
    Failed,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum CollabTool {
    SpawnAgent,
    SendInput,
    Wait,
    CloseAgent,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum CollabAgentStatus {
    PendingInit,
    Running,
    Interrupted,
    Completed,
    Errored,
    Shutdown,
    NotFound,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct CollabAgentState {
    pub status: CollabAgentStatus,
    pub message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct CollabToolCallItem {
    pub tool: CollabTool,
    pub sender_thread_id: String,
    pub receiver_thread_ids: Vec<String>,
    pub prompt: Option<String>,
    pub agents_states: HashMap<String, CollabAgentState>,
    pub status: CollabToolCallStatus,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum WebSearchAction {
    Search {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        query: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        queries: Option<Vec<String>>,
    },
    OpenPage {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        url: Option<String>,
    },
    FindInPage {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        query: Option<String>,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct WebSearchItem {
    pub id: String,
    pub query: String,
    pub action: WebSearchAction,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub results: Option<Vec<JsonValue>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ErrorItem {
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TodoItem {
    pub text: String,
    pub completed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TodoListItem {
    pub items: Vec<TodoItem>,
}
