// SPDX-License-Identifier: Apache-2.0
//! Codex CLI rollouts.
//!
//! Layout below the root (`$CODEX_HOME`, else `~/.codex`):
//!
//! * `sessions/YYYY/MM/DD/rollout-<timestamp>-<thread id>.jsonl` — one item per line, `{timestamp,
//!   type, payload}`. `type` is `session_meta` (carries `cwd`), `turn_context`, `response_item`
//!   (the conversation: `message`, `function_call`, `function_call_output`,
//!   `custom_tool_call[_output]`, `reasoning`, ...), `event_msg` (UI events that duplicate the
//!   response items — skipped) or `compacted`. Rollouts written by older Codex releases put the
//!   response item itself on the line, without the `payload` wrapper; both shapes are read.
//! * `session_index.jsonl` — `{id, thread_name, updated_at}`: thread titles, latest entry wins.
//!
//! `archived_sessions/` is deliberately not scanned: Codex moves a rollout there on archive, and
//! reading it under its new path would ingest the same lines twice.

use std::{collections::HashMap, path::Path};

use serde_json::Value;

use super::{
    AgentKind, Role, SessionSource, SyncIssue,
    common::{
        Draft, LineContext, content_text, file_with_mtime, parse_ts, push, read_aux_jsonl,
        read_dir_or_issue, render_args, str_field,
    },
};

const AGENT: AgentKind = AgentKind::Codex;

/// `sessions/YYYY/MM/DD` is three levels deep; allow some slack for layouts
/// that nest one level more without walking an unbounded tree.
const MAX_DEPTH: usize = 6;

/// Response item types a legacy (unwrapped) rollout line can carry.
const RESPONSE_ITEM_TYPES: &[&str] = &[
    "message",
    "reasoning",
    "function_call",
    "function_call_output",
    "custom_tool_call",
    "custom_tool_call_output",
    "local_shell_call",
    "web_search_call",
    "agent_message",
];

pub(super) fn discover(root: &Path, issues: &mut Vec<SyncIssue>) -> Vec<SessionSource> {
    let mut files = Vec::new();
    collect_rollouts(&root.join("sessions"), 0, &mut files, issues);
    if files.is_empty() {
        return Vec::new();
    }

    let mut titles: HashMap<String, String> = HashMap::new();
    for entry in read_aux_jsonl(&root.join("session_index.jsonl"), AGENT, issues) {
        if let (Some(id), Some(name)) = (str_field(&entry, "id"), str_field(&entry, "thread_name"))
            && !name.trim().is_empty()
        {
            titles.insert(id.to_owned(), name.to_owned());
        }
    }

    files
        .into_iter()
        .filter_map(|path| {
            let session_id = session_id_from_file_name(&path)?;
            let (path, modified) = file_with_mtime(path)?;
            Some(SessionSource {
                agent: AGENT,
                title: titles.get(&session_id).cloned(),
                path,
                session_id,
                workspace: None,
                current: false,
                modified,
            })
        })
        .collect()
}

fn collect_rollouts(
    dir: &Path,
    depth: usize,
    out: &mut Vec<std::path::PathBuf>,
    issues: &mut Vec<SyncIssue>,
) {
    if depth > MAX_DEPTH {
        return;
    }
    for entry in read_dir_or_issue(dir, AGENT, issues) {
        let Ok(kind) = entry.file_type() else {
            continue;
        };
        let path = entry.path();
        if kind.is_dir() {
            collect_rollouts(&path, depth + 1, out, issues);
        } else if kind.is_file()
            && entry
                .file_name()
                .to_str()
                .is_some_and(|name| name.starts_with("rollout-") && name.ends_with(".jsonl"))
        {
            out.push(path);
        }
    }
}

/// The thread id of a rollout: the trailing UUID of
/// `rollout-<timestamp>-<uuid>.jsonl`, else the stem without its `rollout-`
/// prefix (so a mirror name can never look like an aphrody rollout).
pub(super) fn session_id_from_file_name(path: &Path) -> Option<String> {
    let stem = path.file_stem()?.to_str()?;
    let body = stem.strip_prefix("rollout-").unwrap_or(stem);
    if body.len() >= 36 {
        let tail = &body[body.len() - 36..];
        if is_uuid(tail) {
            return Some(tail.to_ascii_lowercase());
        }
    }
    (!body.is_empty()).then(|| body.to_owned())
}

fn is_uuid(candidate: &str) -> bool {
    let bytes = candidate.as_bytes();
    bytes.len() == 36
        && bytes.iter().enumerate().all(|(index, byte)| match index {
            8 | 13 | 18 | 23 => *byte == b'-',
            _ => byte.is_ascii_hexdigit(),
        })
}

pub(super) fn parse_line(value: &Value, ctx: &mut LineContext) -> Vec<Draft> {
    let ts = parse_ts(value.get("timestamp"));
    let mut out = Vec::new();
    let item = match str_field(value, "type") {
        Some("session_meta" | "turn_context") => {
            let payload = value.get("payload").unwrap_or(value);
            ctx.learn_workspace(str_field(payload, "cwd"));
            return out;
        }
        Some("response_item") => match value.get("payload") {
            Some(payload) => payload,
            None => return out,
        },
        Some("compacted") => {
            let payload = value.get("payload").unwrap_or(value);
            if let Some(message) = str_field(payload, "message") {
                push(&mut out, Role::System, format!("[compacted] {message}"), ts);
            }
            return out;
        }
        Some(kind) if RESPONSE_ITEM_TYPES.contains(&kind) && value.get("payload").is_none() => {
            value
        }
        _ => return out,
    };
    parse_response_item(item, ts, &mut out);
    out
}

fn parse_response_item(
    item: &Value,
    ts: Option<chrono::DateTime<chrono::Utc>>,
    out: &mut Vec<Draft>,
) {
    match str_field(item, "type").unwrap_or_default() {
        "message" => {
            let mut role = Role::from_message_role(str_field(item, "role").unwrap_or_default());
            // Native Codex writes injected AGENTS/environment context as a user
            // message. Only its explicit item-kind metadata distinguishes that
            // bootstrap from an actual, possibly untagged, conversational turn.
            if role == Role::User
                && item
                    .pointer("/internal_chat_message_metadata_passthrough/content_item_kinds")
                    .and_then(Value::as_array)
                    .is_some_and(|kinds| {
                        !kinds.is_empty()
                            && kinds.iter().all(|kind| {
                                matches!(
                                    kind.as_str(),
                                    Some(
                                        "agents_md.instructions"
                                            | "environments.environment_context"
                                    )
                                )
                            })
                    })
            {
                role = Role::System;
            }
            push(out, role, content_text(item.get("content")), ts);
        }
        "reasoning" => {
            // Only reasoning stored in clear text; `encrypted_content` stays out.
            let mut parts = Vec::new();
            for key in ["summary", "content"] {
                let text = content_text(item.get(key));
                if !text.trim().is_empty() {
                    parts.push(text);
                }
            }
            push(out, Role::Reasoning, parts.join("\n"), ts);
        }
        "function_call" => {
            let name = str_field(item, "name").unwrap_or("function");
            let name = match str_field(item, "namespace") {
                Some(namespace) if !namespace.is_empty() => format!("{namespace}.{name}"),
                _ => name.to_owned(),
            };
            push(
                out,
                Role::ToolCall,
                format!("{name} {}", render_args(item.get("arguments"))),
                ts,
            );
        }
        "custom_tool_call" => {
            let name = str_field(item, "name").unwrap_or("tool");
            push(
                out,
                Role::ToolCall,
                format!("{name} {}", render_args(item.get("input"))),
                ts,
            );
        }
        "local_shell_call" => {
            let command = item
                .get("action")
                .and_then(|action| action.get("command"))
                .map(|command| match command {
                    Value::Array(words) => words
                        .iter()
                        .filter_map(Value::as_str)
                        .collect::<Vec<_>>()
                        .join(" "),
                    other => render_args(Some(other)),
                })
                .unwrap_or_default();
            push(out, Role::ToolCall, format!("shell {command}"), ts);
        }
        "web_search_call" => {
            let query = item
                .get("action")
                .and_then(|action| str_field(action, "query"))
                .unwrap_or_default();
            push(out, Role::ToolCall, format!("web_search {query}"), ts);
        }
        "function_call_output" | "custom_tool_call_output" | "local_shell_call_output" => {
            push(out, Role::ToolResult, output_text(item.get("output")), ts);
        }
        "agent_message" => {
            let author = str_field(item, "author").unwrap_or("?");
            let recipient = str_field(item, "recipient").unwrap_or("?");
            let text = content_text(item.get("content"));
            if !text.trim().is_empty() {
                push(
                    out,
                    Role::System,
                    format!("[{author} -> {recipient}] {text}"),
                    ts,
                );
            }
        }
        _ => {}
    }
}

/// A tool output: a string, an array of text parts, or an object carrying
/// `content` / `output`.
fn output_text(output: Option<&Value>) -> String {
    match output {
        Some(Value::Object(object)) => object
            .get("content")
            .or_else(|| object.get("output"))
            .map_or_else(
                || Value::Object(object.clone()).to_string(),
                |inner| content_text(Some(inner)),
            ),
        other => content_text(other),
    }
}

#[cfg(test)]
mod domain_bootstrap_tests {
    use super::*;

    #[test]
    fn only_explicit_native_context_metadata_changes_user_role() {
        for (kinds, expected) in [
            (
                serde_json::json!(["agents_md.instructions", "environments.environment_context"]),
                Role::System,
            ),
            (serde_json::json!(["user.text"]), Role::User),
            (
                serde_json::json!(["agents_md.instructions", "user.text"]),
                Role::User,
            ),
            (serde_json::json!([]), Role::User),
            (serde_json::Value::Null, Role::User),
        ] {
            let value = serde_json::json!({"type":"response_item", "payload": {
                "type":"message", "role":"user", "content":[{"type":"input_text", "text":"# AGENTS.md instructions"}],
                "internal_chat_message_metadata_passthrough":{"content_item_kinds":kinds}
            }});
            let drafts = parse_line(&value, &mut LineContext { workspace: None });
            assert_eq!(drafts[0].role, expected);
        }
    }
}
