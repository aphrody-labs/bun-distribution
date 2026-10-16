// SPDX-License-Identifier: Apache-2.0
//! Inline tool-call extraction for the textual dialects weak open-source
//! models emit instead of a structured `tool_calls` API field: Hermes
//! (`<tool_call>{...}</tool_call>`), Qwen3-Coder's XML-ish
//! `<tool_call><function=NAME><parameter=KEY>value</parameter></function></tool_call>`,
//! Mistral's `[TOOL_CALLS][{...}]`, and bare top-level JSON.

use std::{ops::Range, sync::LazyLock};

use regex::Regex;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::repair::repair_json;

/// The textual tool-call dialect a model family emits.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ToolDialect {
    /// A structured OpenAI-shaped JSON blob appearing as literal text
    /// (`{"tool_calls": [{"type": "function", "function": {...}}]}` or a
    /// single `{"function": {"name": ..., "arguments": ...}}`).
    OpenAiJson,
    /// `<tool_call>{"name": ..., "arguments": {...}}</tool_call>`, one or
    /// more, `arguments` sometimes itself a JSON-encoded string.
    Hermes,
    /// `<tool_call><function=NAME><parameter=KEY>value</parameter>...</function></tool_call>`.
    Qwen3CoderXml,
    /// `[TOOL_CALLS][{"name": ..., "arguments": {...}}]`.
    MistralToolCalls,
    /// A bare top-level JSON object or array of objects, each with `name`
    /// and `arguments`/`parameters`.
    BareJson,
}

/// A single tool call recovered from free-form model text.
#[derive(Debug, Clone, PartialEq)]
pub struct ExtractedToolCall {
    /// The tool/function name.
    pub name: String,
    /// The decoded arguments (always repaired through [`repair_json`]).
    pub arguments: Value,
    /// The byte range in the original text this call was extracted from.
    pub span: Range<usize>,
}

/// Try every dialect in a stable order, returning the first one that yields
/// at least one call.
#[must_use]
pub fn extract_any(text: &str) -> Vec<ExtractedToolCall> {
    const ORDER: [ToolDialect; 5] = [
        ToolDialect::Hermes,
        ToolDialect::Qwen3CoderXml,
        ToolDialect::MistralToolCalls,
        ToolDialect::OpenAiJson,
        ToolDialect::BareJson,
    ];
    for dialect in ORDER {
        let calls = extract_inline_tool_calls(text, dialect);
        if !calls.is_empty() {
            return calls;
        }
    }
    Vec::new()
}

/// Extract every tool call matching `dialect` from `text`.
#[must_use]
pub fn extract_inline_tool_calls(text: &str, dialect: ToolDialect) -> Vec<ExtractedToolCall> {
    match dialect {
        ToolDialect::Hermes => extract_hermes(text),
        ToolDialect::Qwen3CoderXml => extract_qwen3_xml(text),
        ToolDialect::MistralToolCalls => extract_mistral(text),
        ToolDialect::OpenAiJson => extract_openai_json(text),
        ToolDialect::BareJson => extract_bare_json(text),
    }
}

/// Remove every extracted call's span from `text`, returning the remaining
/// prose (trimmed of the whitespace left behind by the removal).
#[must_use]
pub fn strip_tool_calls(text: &str, calls: &[ExtractedToolCall]) -> String {
    let mut spans: Vec<Range<usize>> = calls.iter().map(|c| c.span.clone()).collect();
    spans.sort_by_key(|r| r.start);
    let mut out = String::with_capacity(text.len());
    let mut cursor = 0usize;
    for span in spans {
        let start = span.start.max(cursor);
        if start > cursor {
            out.push_str(&text[cursor..start]);
        }
        cursor = span.end.max(cursor);
    }
    if cursor < text.len() {
        out.push_str(&text[cursor..]);
    }
    out.trim().to_string()
}

// ---------------------------------------------------------------------------
// Hermes: <tool_call>{...}</tool_call>
// ---------------------------------------------------------------------------

static HERMES_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?s)<tool_call>(.*?)</tool_call>").unwrap());

fn extract_hermes(text: &str) -> Vec<ExtractedToolCall> {
    let mut out = Vec::new();
    let mut last_end = 0usize;
    for m in HERMES_RE.captures_iter(text) {
        let whole = m.get(0).unwrap();
        last_end = whole.end();
        let inner = m.get(1).unwrap().as_str();
        let Ok(value) = repair_json(inner) else {
            continue;
        };
        let Some(mut call) = tool_call_from_value(&value, whole.range()) else {
            continue;
        };
        decode_string_arguments(&mut call.arguments);
        out.push(call);
    }
    // A stream cut off before the closing tag ever arrived: repair whatever
    // JSON body follows the last unterminated `<tool_call>`.
    if let Some((start, tail)) =
        find_unterminated_tail(text, last_end, "<tool_call>", "</tool_call>")
        && let Ok(value) = repair_json(tail)
        && let Some(mut call) = tool_call_from_value(&value, start..text.len())
    {
        decode_string_arguments(&mut call.arguments);
        out.push(call);
    }
    out
}

/// If `arguments` is a JSON-encoded string, decode it in place.
fn decode_string_arguments(arguments: &mut Value) {
    if let Value::String(s) = arguments
        && let Ok(decoded) = repair_json(s)
    {
        *arguments = decoded;
    }
}

/// Locate an opening `open_tag` after `search_from` that has no matching
/// `close_tag` before the end of `text` -- a dialect tag cut off mid-stream.
/// Returns the tag's start offset and everything after it.
fn find_unterminated_tail<'a>(
    text: &'a str,
    search_from: usize,
    open_tag: &str,
    close_tag: &str,
) -> Option<(usize, &'a str)> {
    let open_idx = text[search_from..].find(open_tag)?;
    let start = search_from + open_idx;
    let inner_start = start + open_tag.len();
    if text[inner_start..].contains(close_tag) {
        return None;
    }
    Some((start, &text[inner_start..]))
}

// ---------------------------------------------------------------------------
// Qwen3-Coder: <tool_call><function=NAME><parameter=KEY>value</parameter>...</function></tool_call>
// ---------------------------------------------------------------------------

static QWEN3_OUTER_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?s)<tool_call>\s*<function=([^>]+)>(.*?)</function>\s*</tool_call>").unwrap()
});
static QWEN3_PARAM_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?s)<parameter=([^>]+)>(.*?)</parameter>").unwrap());
static QWEN3_OPEN_FUNCTION_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^\s*<function=([^>]+)>").unwrap());

fn extract_qwen3_xml(text: &str) -> Vec<ExtractedToolCall> {
    let mut out = Vec::new();
    let mut last_end = 0usize;
    for m in QWEN3_OUTER_RE.captures_iter(text) {
        let whole = m.get(0).unwrap();
        last_end = whole.end();
        let name = m.get(1).unwrap().as_str().trim().to_string();
        let body = m.get(2).unwrap().as_str();
        out.push(ExtractedToolCall {
            name,
            arguments: Value::Object(qwen3_params(body)),
            span: whole.range(),
        });
    }
    // A stream cut off mid-function-call: no closing tags at all, but the
    // opening `<function=NAME>` and zero or more complete `<parameter>`
    // blocks are still there.
    if let Some((start, tail)) =
        find_unterminated_tail(text, last_end, "<tool_call>", "</tool_call>")
        && let Some(name_m) = QWEN3_OPEN_FUNCTION_RE.captures(tail)
    {
        let name = name_m.get(1).unwrap().as_str().trim().to_string();
        let body = &tail[name_m.get(0).unwrap().end()..];
        let args = qwen3_params(body);
        if !args.is_empty() {
            out.push(ExtractedToolCall {
                name,
                arguments: Value::Object(args),
                span: start..text.len(),
            });
        }
    }
    out
}

/// Every complete `<parameter=KEY>value</parameter>` block in `body`.
fn qwen3_params(body: &str) -> serde_json::Map<String, Value> {
    let mut args = serde_json::Map::new();
    for param in QWEN3_PARAM_RE.captures_iter(body) {
        let key = param.get(1).unwrap().as_str().trim().to_string();
        let raw = param.get(2).unwrap().as_str();
        let value = trim_one_edge_newline(raw);
        args.insert(key, coerce_qwen3_value(value));
    }
    args
}

/// Strip exactly one leading and one trailing newline (the format
/// conventionally wraps a parameter value in its own line), preserving any
/// further internal structure/whitespace.
fn trim_one_edge_newline(raw: &str) -> &str {
    let raw = raw.strip_prefix('\n').unwrap_or(raw);
    raw.strip_suffix('\n').unwrap_or(raw)
}

/// Coerce a Qwen3-Coder XML parameter's raw text value: numbers and booleans
/// become their JSON type, a JSON-looking value is decoded, everything else
/// stays a string (multiline values preserved verbatim).
fn coerce_qwen3_value(raw: &str) -> Value {
    let trimmed = raw.trim();
    match trimmed {
        "true" => return Value::Bool(true),
        "false" => return Value::Bool(false),
        "null" => return Value::Null,
        _ => {}
    }
    if let Ok(n) = trimmed.parse::<i64>() {
        return Value::Number(n.into());
    }
    if let Ok(n) = trimmed.parse::<f64>()
        && let Some(num) = serde_json::Number::from_f64(n)
    {
        return Value::Number(num);
    }
    let looks_json = (trimmed.starts_with('{') && trimmed.ends_with('}'))
        || (trimmed.starts_with('[') && trimmed.ends_with(']'));
    if looks_json && let Ok(v) = repair_json(trimmed) {
        return v;
    }
    Value::String(raw.to_string())
}

// ---------------------------------------------------------------------------
// Mistral: [TOOL_CALLS][{...}]
// ---------------------------------------------------------------------------

const MISTRAL_MARKER: &str = "[TOOL_CALLS]";

fn extract_mistral(text: &str) -> Vec<ExtractedToolCall> {
    let mut out = Vec::new();
    let mut search_from = 0usize;
    while let Some(marker_offset) = text[search_from..].find(MISTRAL_MARKER) {
        let marker_start = search_from + marker_offset;
        let json_start = marker_start + MISTRAL_MARKER.len();
        let Some(blob) = find_balanced_json_span(text, json_start) else {
            break;
        };
        if let Ok(value) = repair_json(&text[blob.clone()]) {
            let calls = tool_calls_from_value_or_array(&value, blob.clone());
            out.extend(calls);
        }
        search_from = blob.end.max(json_start + 1);
    }
    out
}

// ---------------------------------------------------------------------------
// OpenAI-shaped inline JSON: {"tool_calls": [{"type": "function", "function": {...}}]}
// ---------------------------------------------------------------------------

fn extract_openai_json(text: &str) -> Vec<ExtractedToolCall> {
    let mut out = Vec::new();
    for blob in find_all_balanced_json_spans(text) {
        let Ok(value) = repair_json(&text[blob.clone()]) else {
            continue;
        };
        let Some(tool_calls) = value.get("tool_calls").and_then(Value::as_array) else {
            continue;
        };
        for entry in tool_calls {
            let func = entry.get("function").unwrap_or(entry);
            let Some(name) = func.get("name").and_then(Value::as_str) else {
                continue;
            };
            let arguments = decode_arguments_field(func);
            out.push(ExtractedToolCall {
                name: name.to_string(),
                arguments,
                span: blob.clone(),
            });
        }
    }
    out
}

// ---------------------------------------------------------------------------
// Bare JSON: a top-level object or array of {name, arguments|parameters}.
// ---------------------------------------------------------------------------

fn extract_bare_json(text: &str) -> Vec<ExtractedToolCall> {
    let mut out = Vec::new();
    for blob in find_all_balanced_json_spans(text) {
        let Ok(value) = repair_json(&text[blob.clone()]) else {
            continue;
        };
        out.extend(tool_calls_from_value_or_array(&value, blob));
    }
    out
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/// Build one [`ExtractedToolCall`] from a `{name, arguments|parameters}`
/// object, if it looks like one.
fn tool_call_from_value(value: &Value, span: Range<usize>) -> Option<ExtractedToolCall> {
    let name = value.get("name").and_then(Value::as_str)?.to_string();
    let arguments = decode_arguments_field(value);
    Some(ExtractedToolCall {
        name,
        arguments,
        span,
    })
}

/// A single call object, or an array of call objects, sharing one span.
fn tool_calls_from_value_or_array(value: &Value, span: Range<usize>) -> Vec<ExtractedToolCall> {
    match value {
        Value::Array(items) => items
            .iter()
            .filter_map(|item| tool_call_from_value(item, span.clone()))
            .collect(),
        Value::Object(_) => tool_call_from_value(value, span).into_iter().collect(),
        _ => Vec::new(),
    }
}

/// Read `arguments` (or `parameters`), decoding it through [`repair_json`]
/// again if it arrived as a JSON-encoded string.
fn decode_arguments_field(value: &Value) -> Value {
    let raw = value.get("arguments").or_else(|| value.get("parameters"));
    match raw {
        Some(Value::String(s)) => repair_json(s).unwrap_or_else(|_| Value::String(s.clone())),
        Some(other) => other.clone(),
        None => Value::Object(serde_json::Map::new()),
    }
}

/// Find the byte span of the first balanced `{...}`/`[...]` value starting
/// at or after `from`, tracking string/escape state so brackets inside
/// string literals are ignored. An unterminated trailing value spans to the
/// end of `text`.
fn find_balanced_json_span(text: &str, from: usize) -> Option<Range<usize>> {
    let bytes = text.as_bytes();
    let mut i = from;
    while i < bytes.len() && bytes[i].is_ascii_whitespace() {
        i += 1;
    }
    let start = i;
    if start >= bytes.len() || (bytes[start] != b'{' && bytes[start] != b'[') {
        return None;
    }
    let mut depth = 0i32;
    let mut in_string = false;
    let mut escape = false;
    while i < bytes.len() {
        let b = bytes[i];
        if in_string {
            if escape {
                escape = false;
            } else if b == b'\\' {
                escape = true;
            } else if b == b'"' {
                in_string = false;
            }
        } else {
            match b {
                b'"' => in_string = true,
                b'{' | b'[' => depth += 1,
                b'}' | b']' => {
                    depth -= 1;
                    if depth == 0 {
                        return Some(start..i + 1);
                    }
                }
                _ => {}
            }
        }
        i += 1;
    }
    Some(start..bytes.len())
}

/// Find every top-level balanced JSON span in `text`, scanning left to
/// right and continuing after each match.
fn find_all_balanced_json_spans(text: &str) -> Vec<Range<usize>> {
    let mut spans = Vec::new();
    let mut from = 0usize;
    let bytes = text.as_bytes();
    while from < bytes.len() {
        let Some(next_bracket) = text[from..].find(['{', '[']) else {
            break;
        };
        let start = from + next_bracket;
        let Some(span) = find_balanced_json_span(text, start) else {
            break;
        };
        let end = span.end;
        spans.push(span);
        from = end.max(start + 1);
    }
    spans
}

#[cfg(test)]
#[path = "extract_tests.rs"]
mod tests;
