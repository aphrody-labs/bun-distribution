// SPDX-License-Identifier: Apache-2.0

/// An error parsing a `-c key=value` command-line override.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum OverrideError {
    /// The raw string had no `=` separating key and value.
    #[error("override `{0}` is missing '='")]
    MissingEquals(String),
    /// The key portion (before `=`) was empty.
    #[error("override `{0}` has an empty key")]
    EmptyKey(String),
    /// A quoted path segment (`"..."`) was never closed.
    #[error("override `{0}` has an unterminated quoted path segment")]
    UnterminatedQuote(String),
    /// A path segment (quoted or not) was empty, e.g. `a..b=1` or `""=1`.
    #[error("override `{0}` has an empty path segment")]
    EmptyPathSegment(String),
}

/// Splits a dotted override path into its segments, honouring double-quoted
/// segments so a literal `.` can appear inside a provider id, e.g.
/// `model_providers."my.id".base_url` addresses the `base_url` field of the
/// provider named `my.id`, not three levels ending in `id`.
fn split_dotted_path(path: &str) -> Result<Vec<String>, OverrideError> {
    let mut segments = Vec::new();
    let mut current = String::new();
    let mut in_quotes = false;
    let mut segment_was_quoted = false;

    for c in path.chars() {
        match c {
            '"' if !in_quotes => {
                in_quotes = true;
                segment_was_quoted = true;
            }
            '"' if in_quotes => {
                in_quotes = false;
            }
            '.' if !in_quotes => {
                if current.is_empty() && !segment_was_quoted {
                    return Err(OverrideError::EmptyPathSegment(path.to_string()));
                }
                segments.push(std::mem::take(&mut current));
                segment_was_quoted = false;
            }
            other => current.push(other),
        }
    }

    if in_quotes {
        return Err(OverrideError::UnterminatedQuote(path.to_string()));
    }
    if current.is_empty() && !segment_was_quoted {
        return Err(OverrideError::EmptyPathSegment(path.to_string()));
    }
    segments.push(current);

    Ok(segments)
}

/// Parses a TOML value fragment the way Codex's `-c` flag does: wrap it as
/// the right-hand side of a sentinel key and let the `toml` parser decide
/// its type. Falls back to a bare string on failure so `-c model=o3` works
/// without quotes.
fn parse_value_fragment(raw: &str) -> toml::Value {
    let wrapped = format!("_aphrody_override_ = {raw}");
    if let Ok(toml::Value::Table(mut table)) = toml::from_str::<toml::Value>(&wrapped) {
        table
            .remove("_aphrody_override_")
            .unwrap_or_else(|| toml::Value::String(raw.to_string()))
    } else {
        let unquoted = raw.trim().trim_matches(|c| c == '"' || c == '\'');
        toml::Value::String(unquoted.to_string())
    }
}

/// Parses a single `-c key=value` (or `--config key=value`) override.
///
/// The key is split on `.` into path segments, honouring double-quoted
/// segments (see [`split_dotted_path`]). The value is first attempted as a
/// TOML fragment (so `-c model_context_window=128000` yields an integer and
/// `-c sandbox_workspace_write.network_access=true` yields a boolean); on
/// parse failure it is treated as a literal string, allowing the convenient
/// unquoted form `-c model=gpt-oss:20b`.
///
/// # Errors
///
/// Returns [`OverrideError`] when `raw` has no `=`, an empty key, an empty
/// path segment, or an unterminated quoted segment.
pub fn parse_override(raw: &str) -> Result<(Vec<String>, toml::Value), OverrideError> {
    let mut parts = raw.splitn(2, '=');
    let key = parts.next().unwrap_or_default();
    let Some(value_str) = parts.next() else {
        return Err(OverrideError::MissingEquals(raw.to_string()));
    };
    if key.trim().is_empty() {
        return Err(OverrideError::EmptyKey(raw.to_string()));
    }

    let path = split_dotted_path(key.trim())?;
    let value = parse_value_fragment(value_str.trim());
    Ok((path, value))
}

/// Applies a single parsed override onto a mutable TOML value tree, creating
/// intermediate tables as needed. If an intermediate segment already names a
/// non-table value, it is replaced by a fresh table (later overrides win, as
/// documented on [`crate::layer::merge_toml_values`]).
pub fn apply_override(root: &mut toml::Value, path: &[String], value: toml::Value) {
    let Some((last, ancestors)) = path.split_last() else {
        return;
    };

    let mut current = root;
    for segment in ancestors {
        if !matches!(current, toml::Value::Table(_)) {
            *current = toml::Value::Table(toml::value::Table::new());
        }
        let toml::Value::Table(table) = current else {
            unreachable!("just normalized to a table")
        };
        current = table
            .entry(segment.clone())
            .or_insert_with(|| toml::Value::Table(toml::value::Table::new()));
    }

    if !matches!(current, toml::Value::Table(_)) {
        *current = toml::Value::Table(toml::value::Table::new());
    }
    let toml::Value::Table(table) = current else {
        unreachable!("just normalized to a table")
    };
    table.insert(last.clone(), value);
}

#[cfg(test)]
#[path = "overrides_tests.rs"]
mod overrides_tests;
