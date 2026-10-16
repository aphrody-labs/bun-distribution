// SPDX-License-Identifier: Apache-2.0
//! Tolerant JSON repair for weak-model output.
//!
//! [`repair_json`] and [`repair_json_with_report`] turn the malformed JSON
//! that small open-source models routinely emit into a real
//! [`serde_json::Value`]: markdown code fences and surrounding prose, trailing
//! commas, single-quoted strings, unquoted object keys, Python literals
//! (`True`/`False`/`None`), unescaped control characters and backslashes
//! inside strings, truncated (stream-cut) objects/arrays/strings, and a
//! top-level double-encoded JSON string.
//!
//! The repair path only ever runs when a direct [`serde_json::from_str`] call
//! fails, so `repair_json` is the identity on already-valid JSON:
//! `repair_json(valid) == serde_json::from_str(valid)`.

use std::{fmt::Write as _, sync::LazyLock};

use regex::Regex;
use serde_json::Value;

/// One kind of textual repair applied while recovering a value.
///
/// Exposed so callers can log telemetry on what a given model needed fixed.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum RepairKind {
    /// Prose (and/or a markdown code fence) surrounded the JSON value; it was
    /// dropped.
    StrippedSurroundingText,
    /// A ` ``` ` code fence marker was present around the value.
    MarkdownFence,
    /// A trailing comma before a closing `}`/`]` was removed.
    TrailingComma,
    /// A single-quoted string was normalised to a double-quoted one.
    SingleQuotedString,
    /// An unquoted object key was wrapped in double quotes.
    UnquotedKey,
    /// An unquoted bare-word value was wrapped in double quotes.
    UnquotedString,
    /// A Python literal (`True`/`False`/`None`) was mapped to its JSON
    /// equivalent.
    PythonLiteral,
    /// A raw control character (newline, tab, ...) inside a string was
    /// escaped.
    UnescapedControlChar,
    /// A backslash that did not start a valid JSON escape was escaped.
    UnescapedBackslash,
    /// A string was cut off mid-stream and closed.
    TruncatedString,
    /// An object or array was cut off mid-stream and closed.
    TruncatedContainer,
    /// A JSON string whose content was itself JSON was decoded one more
    /// level.
    DoubleEncodedString,
}

/// Errors surfaced when a value cannot be recovered at all.
#[derive(Debug, Clone, thiserror::Error)]
pub enum RepairError {
    /// The input was empty (or all whitespace).
    #[error("input is empty")]
    Empty,
    /// No plausible JSON value (object, array, string, number, bool, null)
    /// could be located in the input.
    #[error("no JSON value found in input")]
    NoJsonFound,
    /// A JSON value was located but even the tolerant rewrite failed to
    /// produce something `serde_json` accepts.
    #[error("could not repair input into valid JSON: {message}")]
    Invalid {
        /// The underlying `serde_json` parse error message.
        message: String,
    },
}

/// A repaired value plus the list of repairs that were applied to recover it.
#[derive(Debug, Clone, PartialEq)]
pub struct RepairReport {
    /// The recovered value.
    pub value: Value,
    /// Repairs applied, in the order they were encountered. Empty when the
    /// input was already valid JSON.
    pub repairs: Vec<RepairKind>,
}

/// Recover a [`serde_json::Value`] from possibly-malformed model output.
///
/// # Errors
/// Returns [`RepairError`] when no value can be recovered at all.
pub fn repair_json(input: &str) -> Result<Value, RepairError> {
    repair_json_with_report(input).map(|report| report.value)
}

/// Like [`repair_json`], but also reports which repairs were applied.
///
/// # Errors
/// Returns [`RepairError`] when no value can be recovered at all.
pub fn repair_json_with_report(input: &str) -> Result<RepairReport, RepairError> {
    if input.trim().is_empty() {
        return Err(RepairError::Empty);
    }

    // Fast path: already valid JSON. This is what makes `repair_json` the
    // identity on valid input -- the tolerant rewrite below never runs.
    if let Ok(value) = serde_json::from_str::<Value>(input) {
        return Ok(RepairReport {
            value,
            repairs: Vec::new(),
        });
    }

    let chars: Vec<char> = input.chars().collect();
    let bracket_start = chars.iter().position(|&c| c == '{' || c == '[');
    let structured = bracket_start.is_some();

    let mut repairs = Vec::new();
    let rewritten: Option<String> = match bracket_start {
        Some(start) => Some(rewrite_structured(&chars, start, &mut repairs)),
        None => rewrite_scalar(&chars, &mut repairs),
    };

    let Some(rewritten) = rewritten else {
        return Err(RepairError::NoJsonFound);
    };

    match serde_json::from_str::<Value>(rewritten.as_str()) {
        Ok(mut value) => {
            unwrap_double_encoded(&mut value, &mut repairs);
            Ok(RepairReport { value, repairs })
        }
        Err(err) => {
            if structured {
                Err(RepairError::Invalid {
                    message: err.to_string(),
                })
            } else {
                Err(RepairError::NoJsonFound)
            }
        }
    }
}

/// Regex matching a complete, valid JSON number token.
static NUMBER_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^-?(0|[1-9][0-9]*)(\.[0-9]+)?([eE][+-]?[0-9]+)?$").unwrap());

/// Rewrite the region starting at the first `{`/`[` into valid JSON text,
/// dropping any leading/trailing prose or markdown fences.
fn rewrite_structured(chars: &[char], start: usize, repairs: &mut Vec<RepairKind>) -> String {
    note_surrounding_text(&chars[..start], repairs);
    let (text, end) = scan_value(chars, start, repairs);
    note_surrounding_text(&chars[end..], repairs);
    text
}

/// Rewrite a bare scalar (no `{`/`[` anywhere): a quoted string, a bare word
/// (`true`/`false`/`null`/a Python literal/a number), possibly still wrapped
/// in prose or a code fence.
fn rewrite_scalar(chars: &[char], repairs: &mut Vec<RepairKind>) -> Option<String> {
    let start = chars.iter().position(|c| !c.is_whitespace())?;
    if !matches!(chars[start], '"' | '\'') {
        let (word, _) = consume_word(chars, start);
        if !matches!(
            word.as_str(),
            "true" | "false" | "null" | "True" | "False" | "None"
        ) && !NUMBER_RE.is_match(&word)
        {
            return None;
        }
    }
    note_surrounding_text(&chars[..start], repairs);
    let (text, end) = scan_value(chars, start, repairs);
    note_surrounding_text(&chars[end..], repairs);
    Some(text)
}

/// Record [`RepairKind::StrippedSurroundingText`] / [`RepairKind::MarkdownFence`]
/// for a discarded region, if it holds anything but whitespace.
fn note_surrounding_text(region: &[char], repairs: &mut Vec<RepairKind>) {
    if region.iter().any(|c| !c.is_whitespace()) {
        repairs.push(RepairKind::StrippedSurroundingText);
        let text: String = region.iter().collect();
        if text.contains("```") {
            repairs.push(RepairKind::MarkdownFence);
        }
    }
}

/// Scan a single top-level JSON value (object, array, string, or bare word)
/// starting at `start`, returning the rewritten JSON text and the index just
/// past the consumed input.
fn scan_value(chars: &[char], start: usize, repairs: &mut Vec<RepairKind>) -> (String, usize) {
    let mut pos = start;
    let mut out = String::new();
    let mut stack: Vec<char> = Vec::new();

    loop {
        if pos >= chars.len() {
            let out = finalize_eof(out, &stack, repairs);
            return (out, pos);
        }
        let c = chars[pos];

        if c == '{' || c == '[' {
            stack.push(c);
            out.push(c);
            pos += 1;
            continue;
        }

        if c == '}' || c == ']' {
            strip_trailing_comma(&mut out, repairs);
            stack.pop();
            out.push(c);
            pos += 1;
            if stack.is_empty() {
                return (out, pos);
            }
            continue;
        }

        if c == '"' || c == '\'' {
            let (new_pos, truncated) = consume_string(chars, pos, &mut out, repairs);
            pos = new_pos;
            if truncated {
                repairs.push(RepairKind::TruncatedString);
                let out = finalize_eof(out, &stack, repairs);
                return (out, pos);
            }
            if stack.is_empty() {
                return (out, pos);
            }
            continue;
        }

        if c.is_whitespace() || c == ',' || c == ':' {
            out.push(c);
            pos += 1;
            continue;
        }

        if is_word_char(c) {
            let (word, new_pos) = consume_word(chars, pos);
            pos = new_pos;
            let mut lookahead = pos;
            while lookahead < chars.len() && chars[lookahead].is_whitespace() {
                lookahead += 1;
            }
            let is_key_position = lookahead < chars.len() && chars[lookahead] == ':';
            push_word_token(&word, is_key_position, &mut out, repairs);
            if stack.is_empty() {
                return (out, pos);
            }
            continue;
        }

        // Unrecognised character in a structural position: best-effort
        // pass-through rather than aborting the whole recovery.
        out.push(c);
        pos += 1;
    }
}

/// Whether `c` can start (or continue) a bare word: an identifier, a number,
/// or a Python literal.
fn is_word_char(c: char) -> bool {
    c.is_alphanumeric() || c == '_' || c == '$' || c == '-' || c == '+' || c == '.'
}

/// Consume a maximal run of [`is_word_char`] characters starting at `pos`.
fn consume_word(chars: &[char], pos: usize) -> (String, usize) {
    let mut i = pos;
    while i < chars.len() && is_word_char(chars[i]) {
        i += 1;
    }
    (chars[pos..i].iter().collect(), i)
}

/// Classify and emit a bare word token: a JSON/Python literal, a number, or
/// an unquoted key/string that needs quoting.
fn push_word_token(
    word: &str,
    is_key_position: bool,
    out: &mut String,
    repairs: &mut Vec<RepairKind>,
) {
    match word {
        "True" => {
            out.push_str("true");
            repairs.push(RepairKind::PythonLiteral);
        }
        "False" => {
            out.push_str("false");
            repairs.push(RepairKind::PythonLiteral);
        }
        "None" => {
            out.push_str("null");
            repairs.push(RepairKind::PythonLiteral);
        }
        "true" | "false" | "null" => out.push_str(word),
        _ if NUMBER_RE.is_match(word) => out.push_str(word),
        _ => {
            out.push('"');
            for ch in word.chars() {
                match ch {
                    '"' => out.push_str("\\\""),
                    '\\' => out.push_str("\\\\"),
                    _ => out.push(ch),
                }
            }
            out.push('"');
            repairs.push(if is_key_position {
                RepairKind::UnquotedKey
            } else {
                RepairKind::UnquotedString
            });
        }
    }
}

/// Consume a quoted string (single- or double-quoted) starting at `pos`
/// (which must point at the opening quote), normalising it to a double-quoted
/// JSON string in `out`. Returns the index just past the string and whether
/// the string was truncated (ran off the end of input before closing).
fn consume_string(
    chars: &[char],
    pos: usize,
    out: &mut String,
    repairs: &mut Vec<RepairKind>,
) -> (usize, bool) {
    let quote = chars[pos];
    if quote == '\'' {
        repairs.push(RepairKind::SingleQuotedString);
    }
    out.push('"');
    let mut i = pos + 1;
    while i < chars.len() {
        let ch = chars[i];
        if ch == '\\' {
            let Some(&next) = chars.get(i + 1) else {
                out.push_str("\\\\");
                i += 1;
                continue;
            };
            if next == '"'
                || next == '\\'
                || next == '/'
                || matches!(next, 'b' | 'f' | 'n' | 'r' | 't')
            {
                out.push('\\');
                out.push(next);
                i += 2;
            } else if next == 'u' {
                out.push('\\');
                out.push('u');
                i += 2;
                let mut copied = 0;
                while copied < 4 && i < chars.len() && chars[i].is_ascii_hexdigit() {
                    out.push(chars[i]);
                    i += 1;
                    copied += 1;
                }
            } else if next == '\'' {
                out.push('\'');
                i += 2;
            } else {
                out.push_str("\\\\");
                out.push(next);
                i += 2;
                repairs.push(RepairKind::UnescapedBackslash);
            }
            continue;
        }
        if ch == quote {
            out.push('"');
            return (i + 1, false);
        }
        if quote == '\'' && ch == '"' {
            out.push_str("\\\"");
            i += 1;
            continue;
        }
        match ch {
            '\n' => {
                out.push_str("\\n");
                repairs.push(RepairKind::UnescapedControlChar);
            }
            '\r' => {
                out.push_str("\\r");
                repairs.push(RepairKind::UnescapedControlChar);
            }
            '\t' => {
                out.push_str("\\t");
                repairs.push(RepairKind::UnescapedControlChar);
            }
            _ if (ch as u32) < 0x20 => {
                let _ = write!(out, "\\u{:04x}", ch as u32);
                repairs.push(RepairKind::UnescapedControlChar);
            }
            _ => out.push(ch),
        }
        i += 1;
    }
    out.push('"');
    (i, true)
}

/// Remove a trailing comma (and nothing else) from the end of `out`, if one
/// is present after trimming trailing whitespace.
fn strip_trailing_comma(out: &mut String, repairs: &mut Vec<RepairKind>) {
    strip_trailing_comma_silent(out, Some(repairs));
}

/// Internal comma-stripper. `repairs` is `None` during finalize-on-EOF
/// backtracking, so a single truncation is reported once by the caller
/// rather than once per backtrack step.
fn strip_trailing_comma_silent(out: &mut String, repairs: Option<&mut Vec<RepairKind>>) {
    let trimmed_len = out.trim_end().len();
    if trimmed_len == 0 {
        return;
    }
    if out.as_bytes()[trimmed_len - 1] == b',' {
        out.truncate(trimmed_len - 1);
        if let Some(repairs) = repairs {
            repairs.push(RepairKind::TrailingComma);
        }
    }
}

/// Close every still-open container in `stack`, backtracking a character at
/// a time from `out` until the result parses as valid JSON (this always
/// terminates: popping back to just after a bracket's own opening character
/// leaves `{}`/`[]`, which is always valid).
fn finalize_eof(mut out: String, stack: &[char], repairs: &mut Vec<RepairKind>) -> String {
    if stack.is_empty() {
        return out;
    }
    repairs.push(RepairKind::TruncatedContainer);
    strip_trailing_comma_silent(&mut out, None);
    loop {
        let mut candidate = out.clone();
        if candidate.trim_end().ends_with(':') {
            candidate.push_str(" null");
        }
        for top in stack.iter().rev() {
            candidate.push(if *top == '{' { '}' } else { ']' });
        }
        if serde_json::from_str::<Value>(&candidate).is_ok() {
            return candidate;
        }
        if out.pop().is_none() {
            return candidate;
        }
        strip_trailing_comma_silent(&mut out, None);
    }
}

/// Unwrap a top-level (or, recursively, nested) JSON string whose content is
/// itself a JSON object/array, up to a small bounded depth. Only reached on
/// the tolerant-repair path -- never on already-valid JSON, which preserves
/// [`repair_json`]'s identity guarantee.
fn unwrap_double_encoded(value: &mut Value, repairs: &mut Vec<RepairKind>) {
    match value {
        Value::Object(map) => {
            for v in map.values_mut() {
                unwrap_double_encoded(v, repairs);
            }
        }
        Value::Array(items) => {
            for v in items.iter_mut() {
                unwrap_double_encoded(v, repairs);
            }
        }
        Value::String(_) => unwrap_double_encoded_scalar(value, repairs),
        _ => {}
    }
}

/// The scalar half of [`unwrap_double_encoded`]: repeatedly decode a string
/// that looks like a JSON object/array, up to three levels deep.
fn unwrap_double_encoded_scalar(value: &mut Value, repairs: &mut Vec<RepairKind>) {
    for _ in 0..3 {
        let Value::String(s) = &value else { break };
        let trimmed = s.trim();
        let looks_json = (trimmed.starts_with('{') && trimmed.ends_with('}'))
            || (trimmed.starts_with('[') && trimmed.ends_with(']'));
        if !looks_json {
            break;
        }
        match repair_json(trimmed) {
            Ok(inner) if inner.is_object() || inner.is_array() => {
                *value = inner;
                repairs.push(RepairKind::DoubleEncodedString);
            }
            _ => break,
        }
    }
}

#[cfg(test)]
#[path = "repair_tests.rs"]
mod tests;
