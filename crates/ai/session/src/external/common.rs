// SPDX-License-Identifier: Apache-2.0
//! Helpers shared by the three transcript parsers.

use std::{
    fs, io,
    path::{Path, PathBuf},
};

use chrono::{DateTime, TimeZone, Utc};
use serde_json::Value;

use super::{AgentKind, Role, SyncIssue};

/// A record before it is bound to its session and source position.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct Draft {
    pub(super) role: Role,
    pub(super) text: String,
    pub(super) ts: Option<DateTime<Utc>>,
}

/// Per-source context a parser may learn from the transcript itself.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub(super) struct LineContext {
    /// The session's working directory; parsers fill it once, from the first
    /// line that names it.
    pub(super) workspace: Option<String>,
}

impl LineContext {
    pub(super) fn learn_workspace(&mut self, candidate: Option<&str>) {
        if self.workspace.is_none()
            && let Some(candidate) = candidate.map(str::trim).filter(|value| !value.is_empty())
        {
            self.workspace = Some(candidate.to_owned());
        }
    }
}

/// Push a draft unless its text is blank.
pub(super) fn push(
    out: &mut Vec<Draft>,
    role: Role,
    text: impl Into<String>,
    ts: Option<DateTime<Utc>>,
) {
    let text = text.into();
    if !text.trim().is_empty() {
        out.push(Draft { role, text, ts });
    }
}

/// A string field of `value`, if present and a string.
pub(super) fn str_field<'a>(value: &'a Value, key: &str) -> Option<&'a str> {
    value.get(key).and_then(Value::as_str)
}

/// A timestamp: RFC 3339 text, or a number of seconds / milliseconds since
/// the epoch.
pub(super) fn parse_ts(value: Option<&Value>) -> Option<DateTime<Utc>> {
    match value? {
        Value::String(text) => {
            DateTime::parse_from_rfc3339(text.trim()).ok().map(|ts| ts.with_timezone(&Utc))
        },
        Value::Number(number) => {
            let raw = number.as_f64()?;
            if !raw.is_finite() || raw < 0.0 {
                return None;
            }
            // Heuristic shared by every JSON log format: values past 10^11
            // cannot be seconds (year 5138), so they are milliseconds.
            let millis = if raw > 1e11 { raw } else { raw * 1000.0 };
            Utc.timestamp_millis_opt(millis as i64).single()
        },
        _ => None,
    }
}

/// Text of a message `content`: a plain string, or an array of parts whose
/// `text` fields are joined by newlines (image / encrypted parts carry no
/// `text` and are skipped).
pub(super) fn content_text(content: Option<&Value>) -> String {
    match content {
        Some(Value::String(text)) => text.clone(),
        Some(Value::Array(parts)) => parts
            .iter()
            .filter_map(|part| match part {
                Value::String(text) => Some(text.as_str()),
                other => str_field(other, "text"),
            })
            .filter(|text| !text.trim().is_empty())
            .collect::<Vec<_>>()
            .join("\n"),
        Some(Value::Object(object)) => object
            .get("text")
            .or_else(|| object.get("content"))
            .map_or_else(String::new, |inner| content_text(Some(inner))),
        _ => String::new(),
    }
}

/// Compact JSON rendering of tool arguments; a JSON-encoded string is kept as
/// the string it encodes.
pub(super) fn render_args(args: Option<&Value>) -> String {
    match args {
        None | Some(Value::Null) => String::new(),
        Some(Value::String(text)) => text.clone(),
        Some(other) => other.to_string(),
    }
}

/// Entries of `dir`; a missing directory is empty, any other failure is an
/// issue.
pub(super) fn read_dir_or_issue(
    dir: &Path,
    agent: AgentKind,
    issues: &mut Vec<SyncIssue>,
) -> Vec<fs::DirEntry> {
    match fs::read_dir(dir) {
        Ok(entries) => entries.filter_map(Result::ok).collect(),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Vec::new(),
        Err(error) => {
            issues.push(SyncIssue::new(Some(agent), Some(dir), format!("cannot list: {error}")));
            Vec::new()
        },
    }
}

/// Read an optional auxiliary JSON file; missing is `None`, unreadable or
/// invalid is an issue and `None`.
pub(super) fn read_aux_json(
    path: &Path,
    agent: AgentKind,
    issues: &mut Vec<SyncIssue>,
) -> Option<Value> {
    let raw = match fs::read(path) {
        Ok(raw) => raw,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return None,
        Err(error) => {
            issues.push(SyncIssue::new(Some(agent), Some(path), format!("cannot read: {error}")));
            return None;
        },
    };
    match serde_json::from_slice(&raw) {
        Ok(value) => Some(value),
        Err(error) => {
            issues.push(SyncIssue::new(Some(agent), Some(path), format!("invalid JSON: {error}")));
            None
        },
    }
}

/// Every complete, valid JSON line of an optional auxiliary JSONL file.
pub(super) fn read_aux_jsonl(
    path: &Path,
    agent: AgentKind,
    issues: &mut Vec<SyncIssue>,
) -> Vec<Value> {
    let raw = match fs::read(path) {
        Ok(raw) => raw,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Vec::new(),
        Err(error) => {
            issues.push(SyncIssue::new(Some(agent), Some(path), format!("cannot read: {error}")));
            return Vec::new();
        },
    };
    raw.split(|byte| *byte == b'\n')
        .filter(|line| !line.trim_ascii().is_empty())
        .filter_map(|line| serde_json::from_slice(line.trim_ascii()).ok())
        .collect()
}

/// A path to a regular file with its modification time, or `None`.
pub(super) fn file_with_mtime(path: PathBuf) -> Option<(PathBuf, Option<std::time::SystemTime>)> {
    let meta = fs::metadata(&path).ok()?;
    meta.is_file().then(|| (path, meta.modified().ok()))
}

/// Cut `text` to at most `max` bytes on a character boundary. `max == 0`
/// disables the cap. Returns whether anything was cut.
pub(super) fn truncate_text(mut text: String, max: usize) -> (String, bool) {
    if max == 0 || text.len() <= max {
        return (text, false);
    }
    let mut cut = max;
    while cut > 0 && !text.is_char_boundary(cut) {
        cut -= 1;
    }
    text.truncate(cut);
    (text, true)
}

/// Canonical form of a workspace path for comparisons: `/` separators, no
/// trailing separator, no Windows verbatim prefix, case-folded on Windows
/// where the filesystem is case-insensitive.
pub(super) fn normalize_workspace(raw: &str) -> String {
    let mut path = raw.trim().replace('\\', "/");
    if let Some(stripped) = path.strip_prefix("//?/") {
        path = stripped.to_owned();
    }
    while path.len() > 1 && path.ends_with('/') {
        path.pop();
    }
    if cfg!(windows) { path.to_lowercase() } else { path }
}

/// A `file://` URI as a local path (`file:///c%3A/Users/x` -> `%USERPROFILE%` on
/// Windows, `file:///home/x` -> `/home/x` elsewhere). `None` for other
/// schemes.
pub(super) fn file_uri_to_path(uri: &str) -> Option<String> {
    let rest = uri.strip_prefix("file://")?;
    let decoded = percent_decode(rest);
    let bytes = decoded.as_bytes();
    // `/c:/Users` -> `c:/Users`: a drive letter behind the authority slash.
    let local = if bytes.len() >= 3
        && bytes[0] == b'/'
        && bytes[1].is_ascii_alphabetic()
        && bytes[2] == b':'
    {
        let mut drive = decoded[1..].to_owned();
        drive[..1].make_ascii_uppercase();
        if cfg!(windows) { drive.replace('/', "\\") } else { drive }
    } else {
        decoded
    };
    (!local.is_empty()).then_some(local)
}

fn percent_decode(raw: &str) -> String {
    let bytes = raw.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%'
            && index + 2 < bytes.len()
            && let (Some(high), Some(low)) =
                (hex_value(bytes[index + 1]), hex_value(bytes[index + 2]))
        {
            out.push(high << 4 | low);
            index += 3;
            continue;
        }
        out.push(bytes[index]);
        index += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn hex_value(byte: u8) -> Option<u8> {
    match byte {
        b'0'..=b'9' => Some(byte - b'0'),
        b'a'..=b'f' => Some(byte - b'a' + 10),
        b'A'..=b'F' => Some(byte - b'A' + 10),
        _ => None,
    }
}
