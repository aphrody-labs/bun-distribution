// SPDX-License-Identifier: Apache-2.0
//! Deterministic conversation compaction for long-running agent sessions.
//!
//! Compaction deliberately does not ask a model to invent a prose summary.
//! It replaces the oldest history with a machine-identifiable structural
//! checkpoint and keeps a recent suffix verbatim. The checkpoint states what
//! was removed, carries a stable fingerprint, and includes bounded previews;
//! omitted source text is therefore explicit rather than silently discarded.

use aphrody_model_client::{ChatMessage, Part, Role, ToolDecl};

/// Marker at the start of every deterministic compaction checkpoint.
pub const COMPACTION_MARKER: &str = "[APHRODY_CONTEXT_COMPACTION_V1]";

/// Conservative fallback for clients that do not advertise a context window.
pub const DEFAULT_CONTEXT_WINDOW_TOKENS: u64 = 32_768;

const AUTO_TRIGGER_PERCENT: u64 = 80;
const TARGET_PERCENT: u64 = 60;
const MAX_RECENT_MESSAGES: usize = 8;
const MIN_RECENT_MESSAGES: usize = 2;
const MAX_PREVIEW_ENTRIES: usize = 12;
const MAX_PREVIEW_CHARS: usize = 160;

/// Observable result of one structural compaction.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CompactionReport {
    /// Number of source messages replaced by the checkpoint.
    pub compacted_messages: usize,
    /// Number of recent messages preserved byte-for-byte.
    pub retained_messages: usize,
    /// Estimated history tokens before compaction.
    pub tokens_before: u64,
    /// Estimated history tokens after compaction.
    pub tokens_after: u64,
    /// Stable FNV-1a fingerprint of the removed serialized messages.
    pub source_fingerprint: String,
    /// Whether the compacted history fits the requested target. A very large
    /// recent message may make this false because recent messages are never
    /// silently truncated.
    pub within_target: bool,
}

/// Estimate the prompt tokens consumed by system text and tool declarations.
///
/// This uses the same conservative UTF-8 byte heuristic as history accounting
/// and lets the session reserve room for non-history request fields.
#[must_use]
pub(crate) fn estimate_prompt_overhead(system: Option<&str>, tools: &[ToolDecl]) -> u64 {
    let system = system.map_or(0, estimate_text_tokens);
    let tools = serde_json::to_vec(tools).map_or(0, |bytes| estimate_bytes_tokens(bytes.len()));
    system.saturating_add(tools).saturating_add(32)
}

/// Estimate the token footprint of a conversation history.
#[must_use]
pub fn estimate_history_tokens(history: &[ChatMessage]) -> u64 {
    history.iter().map(estimate_message_tokens).fold(0, u64::saturating_add)
}

/// Return true when `message` is a structural checkpoint emitted here.
#[must_use]
pub fn is_compaction_checkpoint(message: &ChatMessage) -> bool {
    message.role == Role::User
        && matches!(message.parts.first(), Some(Part::Text(text)) if text.starts_with(COMPACTION_MARKER))
}

/// Compact `history` when it exceeds its trigger, or unconditionally when
/// `force` is true. Recent messages are retained verbatim.
pub(crate) fn compact_history(
    history: &mut Vec<ChatMessage>,
    context_window: Option<u64>,
    configured_trigger: Option<u64>,
    reserved_tokens: u64,
    force: bool,
) -> Option<CompactionReport> {
    if history.len() <= MIN_RECENT_MESSAGES {
        return None;
    }

    let context_window = context_window.unwrap_or(DEFAULT_CONTEXT_WINDOW_TOKENS).max(256);
    let safe_ceiling = context_window.saturating_mul(90) / 100;
    let trigger = configured_trigger
        .filter(|limit| *limit > 0)
        .unwrap_or_else(|| context_window.saturating_mul(AUTO_TRIGGER_PERCENT) / 100)
        .min(safe_ceiling)
        .max(128);
    let tokens_before = estimate_history_tokens(history);
    let total_before = tokens_before.saturating_add(reserved_tokens);
    if !force && total_before <= trigger {
        return None;
    }

    let total_target = context_window.saturating_mul(TARGET_PERCENT) / 100;
    let history_target = total_target.saturating_sub(reserved_tokens).max(64);
    let retain_from = recent_suffix_start(history, history_target);
    if retain_from == 0 {
        return None;
    }

    let removed = history[..retain_from].to_vec();
    let retained = history[retain_from..].to_vec();
    let fingerprint = fingerprint_messages(&removed);
    let removed_tokens = estimate_history_tokens(&removed);
    let summary = structural_summary(&removed, retained.len(), removed_tokens, &fingerprint);
    let mut replacement = Vec::with_capacity(retained.len() + 1);
    replacement.push(ChatMessage { role: Role::User, parts: vec![Part::Text(summary)] });
    replacement.extend(retained);
    let tokens_after = estimate_history_tokens(&replacement);
    if tokens_after >= tokens_before {
        return None;
    }
    *history = replacement;
    Some(CompactionReport {
        compacted_messages: removed.len(),
        retained_messages: history.len().saturating_sub(1),
        tokens_before,
        tokens_after,
        source_fingerprint: fingerprint,
        within_target: tokens_after.saturating_add(reserved_tokens) <= total_target,
    })
}

fn recent_suffix_start(history: &[ChatMessage], target_tokens: u64) -> usize {
    let mut start = history.len();
    let mut retained_tokens = 0_u64;
    while start > 0 && history.len() - start < MAX_RECENT_MESSAGES {
        let candidate = estimate_message_tokens(&history[start - 1]);
        if history.len() - start >= MIN_RECENT_MESSAGES
            && retained_tokens.saturating_add(candidate) > target_tokens
        {
            break;
        }
        start -= 1;
        retained_tokens = retained_tokens.saturating_add(candidate);
    }

    // A tool response must stay paired with the immediately preceding model
    // function call even if that pair exceeds the target.
    while start > 0 && history[start].role == Role::Tool {
        start -= 1;
    }
    start
}

fn estimate_message_tokens(message: &ChatMessage) -> u64 {
    let parts = message.parts.iter().map(estimate_part_tokens).fold(0, u64::saturating_add);
    parts.saturating_add(8)
}

fn estimate_part_tokens(part: &Part) -> u64 {
    match part {
        Part::Text(text) => estimate_text_tokens(text),
        Part::Image(image) => estimate_text_tokens(&image.to_url()),
        Part::Reasoning { text, opaque } => {
            estimate_text_tokens(text).saturating_add(estimate_text_tokens(&opaque.to_string()))
        },
        Part::FunctionCall { id, name, args } => estimate_text_tokens(id)
            .saturating_add(estimate_text_tokens(name))
            .saturating_add(estimate_text_tokens(&args.to_string())),
        Part::FunctionResponse { id, name, response, images } => {
            let images = images
                .iter()
                .map(|image| estimate_text_tokens(&image.to_url()))
                .fold(0, u64::saturating_add);
            estimate_text_tokens(id)
                .saturating_add(estimate_text_tokens(name))
                .saturating_add(estimate_text_tokens(&response.to_string()))
                .saturating_add(images)
        },
    }
}

fn estimate_text_tokens(text: &str) -> u64 {
    estimate_bytes_tokens(text.len())
}

fn estimate_bytes_tokens(bytes: usize) -> u64 {
    u64::try_from(bytes).unwrap_or(u64::MAX).saturating_add(2) / 3
}

fn fingerprint_messages(messages: &[ChatMessage]) -> String {
    const OFFSET: u64 = 0xcbf2_9ce4_8422_2325;
    const PRIME: u64 = 0x0000_0100_0000_01b3;
    let serialized = serde_json::to_vec(messages).unwrap_or_default();
    let hash = serialized.iter().fold(OFFSET, |mut hash, byte| {
        hash ^= u64::from(*byte);
        hash.wrapping_mul(PRIME)
    });
    format!("fnv1a64:{hash:016x}")
}

fn structural_summary(
    removed: &[ChatMessage],
    retained_messages: usize,
    source_tokens: u64,
    fingerprint: &str,
) -> String {
    let mut role_counts = [0_usize; 3];
    for message in removed {
        match message.role {
            Role::User => role_counts[0] += 1,
            Role::Model => role_counts[1] += 1,
            Role::Tool => role_counts[2] += 1,
        }
    }

    let preview_start = removed.len().saturating_sub(MAX_PREVIEW_ENTRIES);
    let mut lines = vec![
        COMPACTION_MARKER.to_string(),
        "mode=deterministic_structural; no model-generated claims".to_string(),
        format!(
            "removed_messages={}; retained_recent_messages={retained_messages}; \
             removed_estimated_tokens={source_tokens}; source_fingerprint={fingerprint}",
            removed.len()
        ),
        format!(
            "removed_roles: user={}; model={}; tool={}",
            role_counts[0], role_counts[1], role_counts[2]
        ),
        "Exact removed content is absent from the active model context. It may be recovered from \
         the pre-checkpoint rollout when recording is enabled. Previews below are truncated and \
         must not be treated as complete source text."
            .to_string(),
    ];
    if preview_start > 0 {
        lines.push(format!("preview_entries_omitted={preview_start}"));
    }
    for (index, message) in removed.iter().enumerate().skip(preview_start) {
        lines.push(format!(
            "message[{index}] role={}: {}",
            role_name(message.role),
            preview(message)
        ));
    }
    lines.push("[/APHRODY_CONTEXT_COMPACTION_V1]".to_string());
    lines.join("\n")
}

fn role_name(role: Role) -> &'static str {
    match role {
        Role::User => "user",
        Role::Model => "model",
        Role::Tool => "tool",
    }
}

fn preview(message: &ChatMessage) -> String {
    let mut rendered = message
        .parts
        .iter()
        .map(|part| match part {
            Part::Text(text) => format!("text={text}"),
            Part::Image(_) => "image=<omitted>".to_string(),
            Part::Reasoning { text, .. } => format!("reasoning={text}"),
            Part::FunctionCall { id, name, args } => {
                format!("function_call id={id} name={name} args={args}")
            },
            Part::FunctionResponse { id, name, response, images } => format!(
                "function_response id={id} name={name} response={response} images={}",
                images.len()
            ),
        })
        .collect::<Vec<_>>()
        .join(" | ")
        .replace(['\r', '\n'], " ");
    if rendered.chars().count() > MAX_PREVIEW_CHARS {
        rendered = rendered.chars().take(MAX_PREVIEW_CHARS).collect::<String>();
        rendered.push_str("…<truncated>");
    }
    rendered
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn recent_suffix_keeps_model_call_with_consecutive_tool_responses() {
        let history = vec![
            ChatMessage { role: Role::User, parts: vec![Part::Text("old request".repeat(100))] },
            ChatMessage {
                role: Role::Model,
                parts: vec![
                    Part::function_call("call-1", "first", json!({})),
                    Part::function_call("call-2", "second", json!({})),
                ],
            },
            ChatMessage {
                role: Role::Tool,
                parts: vec![Part::function_response("call-1", "first", json!({"ok": true}))],
            },
            ChatMessage {
                role: Role::Tool,
                parts: vec![Part::function_response("call-2", "second", json!({"ok": true}))],
            },
        ];

        assert_eq!(recent_suffix_start(&history, 1), 1);
    }

    #[test]
    fn forced_compaction_never_expands_a_short_history() {
        let mut history = vec![
            ChatMessage { role: Role::User, parts: vec![Part::Text("one".into())] },
            ChatMessage { role: Role::Model, parts: vec![Part::Text("two".into())] },
            ChatMessage { role: Role::User, parts: vec![Part::Text("three".into())] },
        ];
        let original = history.clone();

        assert!(compact_history(&mut history, Some(4_096), None, 0, true).is_none());
        assert_eq!(history, original);
    }
}
