// SPDX-License-Identifier: Apache-2.0
//! Antigravity CLI (`agy`) transcripts.
//!
//! Layout below the root (`~/.gemini/antigravity-cli`):
//!
//! * `brain/<conversation id>/.system_generated/logs/transcript.jsonl` — one step per line:
//!   `{step_index, source, type, status, created_at, content?, thinking?, tool_calls?, error?}`.
//!   `source` is `USER_EXPLICIT`, `MODEL` or `SYSTEM`; a `MODEL` step of type `GENERIC` is a tool's
//!   output, `PLANNER_RESPONSE` is the model's own turn.
//! * `cache/last_conversations.json` — `{ "<workspace dir>": "<conversation id>" }`: the current
//!   conversation of each workspace.
//! * `history.jsonl` — prompt history, `{display, timestamp, workspace, conversationId?}`; names
//!   the workspace of older conversations.
//! * `cache/conversation_metadata.json` — `{conversations: {<id>: {summary: {Title,
//!   WorkspaceURIs}}}}`.

use std::{collections::HashMap, path::Path};

use serde_json::Value;

use super::{
    AgentKind, Role, SessionSource, SyncIssue,
    common::{
        Draft, LineContext, file_uri_to_path, file_with_mtime, parse_ts, push, read_aux_json,
        read_aux_jsonl, read_dir_or_issue, render_args, str_field,
    },
};

const AGENT: AgentKind = AgentKind::Agy;

/// Transcript of conversation `id` below `root`.
pub(super) fn transcript_path(root: &Path, id: &str) -> std::path::PathBuf {
    root.join("brain")
        .join(id)
        .join(".system_generated")
        .join("logs")
        .join("transcript.jsonl")
}

pub(super) fn discover(root: &Path, issues: &mut Vec<SyncIssue>) -> Vec<SessionSource> {
    let entries = read_dir_or_issue(&root.join("brain"), AGENT, issues);
    if entries.is_empty() {
        return Vec::new();
    }

    // conversation id -> workspace, from the most to the least authoritative.
    let mut current: HashMap<String, String> = HashMap::new();
    if let Some(Value::Object(map)) = read_aux_json(
        &root.join("cache").join("last_conversations.json"),
        AGENT,
        issues,
    ) {
        let mut pairs: Vec<(&String, &Value)> = map.iter().collect();
        // Deterministic when one conversation is current for two directories.
        pairs.sort_by(|a, b| a.0.cmp(b.0));
        for (workspace, id) in pairs {
            if let Some(id) = id.as_str() {
                current
                    .entry(id.to_owned())
                    .or_insert_with(|| workspace.clone());
            }
        }
    }
    let mut history: HashMap<String, String> = HashMap::new();
    for entry in read_aux_jsonl(&root.join("history.jsonl"), AGENT, issues) {
        if let (Some(id), Some(workspace)) = (
            str_field(&entry, "conversationId"),
            str_field(&entry, "workspace"),
        ) {
            // Later prompts win: the latest directory a conversation ran in.
            history.insert(id.to_owned(), workspace.to_owned());
        }
    }
    let mut metadata: HashMap<String, (Option<String>, Option<String>)> = HashMap::new();
    if let Some(value) = read_aux_json(
        &root.join("cache").join("conversation_metadata.json"),
        AGENT,
        issues,
    ) && let Some(Value::Object(conversations)) = value.get("conversations")
    {
        for (id, entry) in conversations {
            let summary = entry.get("summary").unwrap_or(entry);
            let title = str_field(summary, "Title")
                .map(str::to_owned)
                .filter(|t| !t.is_empty());
            let workspace = summary
                .get("WorkspaceURIs")
                .and_then(Value::as_array)
                .and_then(|uris| uris.iter().find_map(Value::as_str))
                .and_then(file_uri_to_path);
            metadata.insert(id.clone(), (title, workspace));
        }
    }

    let mut sources = Vec::new();
    for entry in entries {
        if !entry.file_type().is_ok_and(|kind| kind.is_dir()) {
            continue;
        }
        let Some(id) = entry.file_name().to_str().map(str::to_owned) else {
            continue;
        };
        let Some((path, modified)) = file_with_mtime(transcript_path(root, &id)) else {
            continue;
        };
        let (title, meta_workspace) = metadata.get(&id).cloned().unwrap_or_default();
        let workspace = current
            .get(&id)
            .cloned()
            .or_else(|| history.get(&id).cloned())
            .or(meta_workspace);
        sources.push(SessionSource {
            agent: AGENT,
            path,
            current: current.contains_key(&id),
            session_id: id,
            workspace,
            title,
            modified,
        });
    }
    sources
}

pub(super) fn parse_line(value: &Value, _ctx: &mut LineContext) -> Vec<Draft> {
    let ts = parse_ts(value.get("created_at"));
    let source = str_field(value, "source").unwrap_or_default();
    let kind = str_field(value, "type").unwrap_or_default();
    let content = str_field(value, "content").unwrap_or_default();
    let error = str_field(value, "error").unwrap_or_default();
    let content_or_error = if content.trim().is_empty() {
        error
    } else {
        content
    };

    let mut out = Vec::new();
    if kind == "USER_INPUT" || source.starts_with("USER") {
        push(&mut out, Role::User, content, ts);
    } else if source == "SYSTEM" {
        push(&mut out, Role::System, content_or_error, ts);
    } else if kind == "GENERIC" {
        // A MODEL step of type GENERIC is what a tool returned.
        push(&mut out, Role::ToolResult, content_or_error, ts);
    } else {
        if let Some(thinking) = str_field(value, "thinking") {
            push(&mut out, Role::Reasoning, thinking, ts);
        }
        push(&mut out, Role::Assistant, content, ts);
        if let Some(calls) = value.get("tool_calls").and_then(Value::as_array) {
            for call in calls {
                let name = str_field(call, "name").unwrap_or("tool");
                let args = render_args(call.get("args"));
                push(
                    &mut out,
                    Role::ToolCall,
                    format!("{name} {args}").trim_end().to_owned(),
                    ts,
                );
            }
        }
        if content.trim().is_empty() && !error.trim().is_empty() {
            push(&mut out, Role::System, format!("error: {error}"), ts);
        }
    }
    out
}
