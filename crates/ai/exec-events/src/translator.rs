// SPDX-License-Identifier: Apache-2.0
//! Translates app-server v2 server notifications into JSONL ThreadEvent streams.

use std::{
    collections::HashMap,
    sync::atomic::{AtomicU64, Ordering},
};

use aphrody_app_protocol::{
    ServerNotification,
    types::{
        item::{
            CommandExecutionStatus as AppCommandStatus, PatchApplyStatus as AppPatchStatus,
            ThreadItem as AppItem,
        },
        turn::TurnStatus,
    },
};

use crate::events::{
    AgentMessageItem, CommandExecutionItem, CommandExecutionStatus, FileChangeItem,
    FileUpdateChange, ItemCompletedEvent, ItemStartedEvent, McpToolCallItem, McpToolCallStatus,
    PatchApplyStatus, PatchChangeKind, ReasoningItem, ThreadErrorEvent, ThreadEvent,
    ThreadItem as ExecThreadItem, ThreadItemDetails, ThreadStartedEvent, TodoItem, TodoListItem,
    TurnCompletedEvent, TurnFailedEvent, TurnStartedEvent, Usage, WebSearchAction, WebSearchItem,
};

/// Stateful translator converting inbound [`ServerNotification`]s into outbound [`ThreadEvent`]s.
#[derive(Debug, Default)]
pub struct EventTranslator {
    next_item_id: AtomicU64,
    raw_to_exec_item_id: HashMap<String, String>,
    last_usage: Option<Usage>,
}

impl EventTranslator {
    #[must_use]
    pub fn new() -> Self {
        Self {
            next_item_id: AtomicU64::new(0),
            raw_to_exec_item_id: HashMap::new(),
            last_usage: None,
        }
    }

    fn next_id(&self) -> String {
        format!("item_{}", self.next_item_id.fetch_add(1, Ordering::SeqCst))
    }

    /// Process a single server notification and return any corresponding JSONL thread events.
    pub fn translate(&mut self, notification: &ServerNotification) -> Vec<ThreadEvent> {
        match notification {
            ServerNotification::ThreadStarted(ev) => {
                vec![ThreadEvent::ThreadStarted(ThreadStartedEvent {
                    thread_id: ev.thread.id.clone(),
                })]
            },
            ServerNotification::TurnStarted(_) => {
                vec![ThreadEvent::TurnStarted(TurnStartedEvent {})]
            },
            ServerNotification::TurnCompleted(ev) => {
                let usage = self.last_usage.clone().unwrap_or_default();
                match ev.turn.status {
                    TurnStatus::Completed => {
                        vec![ThreadEvent::TurnCompleted(TurnCompletedEvent { usage })]
                    },
                    TurnStatus::Failed => {
                        vec![ThreadEvent::TurnFailed(TurnFailedEvent {
                            error: ThreadErrorEvent {
                                message: ev
                                    .turn
                                    .error
                                    .clone()
                                    .unwrap_or_else(|| "Turn failed".to_string()),
                            },
                        })]
                    },
                    _ => vec![],
                }
            },
            ServerNotification::ItemStarted(ev) => {
                if let Some(item) = self.map_item(&ev.item) {
                    vec![ThreadEvent::ItemStarted(ItemStartedEvent { item })]
                } else {
                    vec![]
                }
            },
            ServerNotification::ItemCompleted(ev) => {
                if let Some(item) = self.map_item(&ev.item) {
                    vec![ThreadEvent::ItemCompleted(ItemCompletedEvent { item })]
                } else {
                    vec![]
                }
            },
            ServerNotification::Error(ev) => {
                vec![ThreadEvent::Error(ThreadErrorEvent { message: ev.message.clone() })]
            },
            _ => vec![],
        }
    }

    /// Format an event into a single-line JSONL string.
    pub fn to_jsonl(event: &ThreadEvent) -> Result<String, serde_json::Error> {
        serde_json::to_string(event)
    }

    fn map_item(&mut self, app_item: &AppItem) -> Option<ExecThreadItem> {
        let (raw_id, details) = match app_item {
            AppItem::AgentMessage { id, text } => (
                id.clone(),
                ThreadItemDetails::AgentMessage(AgentMessageItem { text: text.clone() }),
            ),
            AppItem::Reasoning { id, summary, content } => {
                let text = if summary.is_empty() { content.join("\n") } else { summary.join("\n") };
                if text.trim().is_empty() {
                    return None;
                }
                (id.clone(), ThreadItemDetails::Reasoning(ReasoningItem { text }))
            },
            AppItem::CommandExecution {
                id, command, status, aggregated_output, exit_code, ..
            } => {
                let exec_status = match status {
                    AppCommandStatus::Pending | AppCommandStatus::InProgress => {
                        CommandExecutionStatus::InProgress
                    },
                    AppCommandStatus::Completed => CommandExecutionStatus::Completed,
                    AppCommandStatus::Failed => CommandExecutionStatus::Failed,
                    AppCommandStatus::Declined => CommandExecutionStatus::Declined,
                };
                (
                    id.clone(),
                    ThreadItemDetails::CommandExecution(CommandExecutionItem {
                        command: command.clone(),
                        aggregated_output: aggregated_output.clone().unwrap_or_default(),
                        exit_code: *exit_code,
                        status: exec_status,
                    }),
                )
            },
            AppItem::FileChange { id, path, status, .. } => {
                let exec_status = match status {
                    AppPatchStatus::Pending => PatchApplyStatus::InProgress,
                    AppPatchStatus::Completed => PatchApplyStatus::Completed,
                    AppPatchStatus::Failed | AppPatchStatus::Declined => PatchApplyStatus::Failed,
                };
                (
                    id.clone(),
                    ThreadItemDetails::FileChange(FileChangeItem {
                        changes: vec![FileUpdateChange {
                            path: path.clone(),
                            kind: PatchChangeKind::Update,
                        }],
                        status: exec_status,
                    }),
                )
            },
            AppItem::McpToolCall { id, server_name, tool_name, arguments, result } => (
                id.clone(),
                ThreadItemDetails::McpToolCall(McpToolCallItem {
                    server: server_name.clone(),
                    tool: tool_name.clone(),
                    arguments: arguments.clone(),
                    result: result.clone().map(|v| crate::events::McpToolCallItemResult {
                        content: vec![v],
                        meta: None,
                        structured_content: None,
                    }),
                    error: None,
                    status: if result.is_some() {
                        McpToolCallStatus::Completed
                    } else {
                        McpToolCallStatus::InProgress
                    },
                }),
            ),
            AppItem::WebSearch { id, query, result } => (
                id.clone(),
                ThreadItemDetails::WebSearch(WebSearchItem {
                    id: id.clone(),
                    query: query.clone(),
                    action: WebSearchAction::Search { query: Some(query.clone()), queries: None },
                    results: result.clone().and_then(|v| serde_json::from_value(v).ok()),
                }),
            ),
            AppItem::Plan { id, text } => (
                id.clone(),
                ThreadItemDetails::TodoList(TodoListItem {
                    items: vec![TodoItem { text: text.clone(), completed: false }],
                }),
            ),
            AppItem::UserMessage { .. } | AppItem::FunctionCallOutput { .. } => {
                return None;
            },
        };

        let exec_id = if let Some(id) = self.raw_to_exec_item_id.get(&raw_id) {
            id.clone()
        } else {
            let new_id = self.next_id();
            self.raw_to_exec_item_id.insert(raw_id, new_id.clone());
            new_id
        };

        Some(ExecThreadItem { id: exec_id, details })
    }
}

#[cfg(test)]
mod tests {
    use aphrody_app_protocol::types::{notifications::ThreadStartedNotification, thread::Thread};

    use super::*;

    #[test]
    fn test_thread_started_translation() {
        let mut translator = EventTranslator::new();
        let notif = ServerNotification::ThreadStarted(ThreadStartedNotification {
            thread: Thread::new("th_12345", 100),
        });

        let events = translator.translate(&notif);
        assert_eq!(events.len(), 1);
        match &events[0] {
            ThreadEvent::ThreadStarted(ev) => assert_eq!(ev.thread_id, "th_12345"),
            _ => panic!("Expected ThreadStarted event"),
        }

        let jsonl = EventTranslator::to_jsonl(&events[0]).unwrap();
        assert!(jsonl.contains("\"type\":\"thread.started\""));
        assert!(jsonl.contains("\"thread_id\":\"th_12345\""));
    }
}
