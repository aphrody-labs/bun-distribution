// SPDX-License-Identifier: Apache-2.0
//! Claude Code transcripts.
//!
//! Layout below the root (`$CLAUDE_CONFIG_DIR`, else `~/.claude`):
//! `projects/<slug>/<session id>.jsonl`, where `<slug>` is the working
//! directory with separators replaced (`%USERPROFILE%\src` -> `C--Users-x-src`,
//! lossy, so the real directory is read from each line's `cwd`). One event per
//! line: `{type, sessionId, cwd, timestamp, message?, isMeta?, ...}`. `type`
//! `user` / `assistant` carry an Anthropic Messages `message` whose `content`
//! is a string or an array of `text` / `thinking` / `tool_use` /
//! `tool_result` blocks; `system` and `summary` lines carry plain text; every
//! other type (attachments, permission / mode changes, queue operations) is
//! harness bookkeeping and skipped.

use std::path::Path;

use serde_json::Value;

use super::{
    AgentKind, Role, SessionSource, SyncIssue,
    common::{
        Draft, LineContext, content_text, file_with_mtime, parse_ts, push, read_dir_or_issue,
        render_args, str_field,
    },
};

const AGENT: AgentKind = AgentKind::Claude;

pub(super) fn discover(root: &Path, issues: &mut Vec<SyncIssue>) -> Vec<SessionSource> {
    let mut sources = Vec::new();
    for project in read_dir_or_issue(&root.join("projects"), AGENT, issues) {
        if !project.file_type().is_ok_and(|kind| kind.is_dir()) {
            continue;
        }
        for entry in read_dir_or_issue(&project.path(), AGENT, issues) {
            let path = entry.path();
            if path.extension().and_then(|ext| ext.to_str()) != Some("jsonl") {
                continue;
            }
            let Some(session_id) =
                path.file_stem().and_then(|stem| stem.to_str()).map(str::to_owned)
            else {
                continue;
            };
            let Some((path, modified)) = file_with_mtime(path) else { continue };
            sources.push(SessionSource {
                agent: AGENT,
                path,
                session_id,
                workspace: None,
                title: None,
                current: false,
                modified,
            });
        }
    }
    sources
}

pub(super) fn parse_line(value: &Value, ctx: &mut LineContext) -> Vec<Draft> {
    ctx.learn_workspace(str_field(value, "cwd"));
    let ts = parse_ts(value.get("timestamp"));
    let mut out = Vec::new();
    match str_field(value, "type").unwrap_or_default() {
        kind @ ("user" | "assistant") => {
            let Some(message) = value.get("message") else { return out };
            let is_meta = value.get("isMeta").and_then(Value::as_bool).unwrap_or(false);
            let role = if is_meta {
                Role::System
            } else {
                Role::from_message_role(str_field(message, "role").unwrap_or(kind))
            };
            match message.get("content") {
                Some(Value::Array(blocks)) => {
                    for block in blocks {
                        parse_block(block, role, ts, &mut out);
                    }
                },
                content => push(&mut out, role, content_text(content), ts),
            }
        },
        "system" => push(&mut out, Role::System, content_text(value.get("content")), ts),
        "summary" => push(&mut out, Role::System, content_text(value.get("summary")), ts),
        _ => {},
    }
    out
}

fn parse_block(
    block: &Value,
    role: Role,
    ts: Option<chrono::DateTime<chrono::Utc>>,
    out: &mut Vec<Draft>,
) {
    match str_field(block, "type").unwrap_or_default() {
        "text" => push(out, role, str_field(block, "text").unwrap_or_default(), ts),
        "thinking" => {
            push(out, Role::Reasoning, str_field(block, "thinking").unwrap_or_default(), ts)
        },
        "tool_use" | "server_tool_use" => {
            let name = str_field(block, "name").unwrap_or("tool");
            push(out, Role::ToolCall, format!("{name} {}", render_args(block.get("input"))), ts);
        },
        "tool_result" => {
            let text = content_text(block.get("content"));
            let is_error = block.get("is_error").and_then(Value::as_bool).unwrap_or(false);
            let text = if is_error { format!("error: {text}") } else { text };
            push(out, Role::ToolResult, text, ts);
        },
        // image, document, redacted_thinking: no text to mirror.
        _ => {},
    }
}
