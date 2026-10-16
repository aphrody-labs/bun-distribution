// SPDX-License-Identifier: Apache-2.0
//! Normalise the edit formats weak models emit instead of a Codex-shaped
//! patch: git-style unified diffs, aider-style SEARCH/REPLACE blocks, and
//! whole-file fenced blocks, all converted into the `*** Begin Patch` /
//! `*** Add|Update|Delete File` / `@@` / `*** End Patch` envelope that
//! [`aphrody_patch::parse_patch`](../aphrody_patch/fn.parse_patch.html) (a
//! sibling crate, used only in this crate's tests) accepts.

use std::{collections::HashMap, fmt::Write as _};

use serde::{Deserialize, Serialize};

/// A source edit/patch format.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PatchFormat {
    /// The Codex `*** Begin Patch` envelope itself.
    CodexPatch,
    /// A git-style unified diff (`--- a/x`, `+++ b/x`, `@@ ... @@` hunks).
    UnifiedDiff,
    /// Aider-style `<<<<<<< SEARCH` / `=======` / `>>>>>>> REPLACE` blocks.
    SearchReplace,
    /// A bare path line followed by a fenced code block with the full file.
    WholeFile,
}

/// Errors surfaced while normalising a patch.
#[derive(Debug, Clone, thiserror::Error)]
pub enum PatchNormalizeError {
    /// None of the known formats could be recognised in the input.
    #[error("could not recognise a patch format in the input")]
    UnknownFormat,
    /// The input looked like a unified diff but failed to parse.
    #[error("could not parse unified diff: {message}")]
    UnifiedDiffParse {
        /// Human-readable reason.
        message: String,
    },
    /// The input looked like SEARCH/REPLACE blocks but failed to parse.
    #[error("could not parse SEARCH/REPLACE block: {message}")]
    SearchReplaceParse {
        /// Human-readable reason.
        message: String,
    },
    /// The input looked like a whole-file block but failed to parse.
    #[error("could not parse whole-file block: {message}")]
    WholeFileParse {
        /// Human-readable reason.
        message: String,
    },
    /// A SEARCH/REPLACE block targets an existing file with an empty SEARCH
    /// section (an insertion), but the file has no content to anchor on.
    #[error("SEARCH/REPLACE insertion into `{path}` has no content to anchor on")]
    AmbiguousInsertion {
        /// The target file path.
        path: String,
    },
}

/// Detect which edit format `text` most likely uses.
#[must_use]
pub fn detect_patch_format(text: &str) -> Option<PatchFormat> {
    if text.contains("*** Begin Patch") {
        return Some(PatchFormat::CodexPatch);
    }
    if text.contains("<<<<<<< SEARCH") && text.contains(">>>>>>> REPLACE") {
        return Some(PatchFormat::SearchReplace);
    }
    if looks_like_unified_diff(text) {
        return Some(PatchFormat::UnifiedDiff);
    }
    if looks_like_whole_file(text) {
        return Some(PatchFormat::WholeFile);
    }
    None
}

/// Convert `text` (auto-detecting its format) into a Codex `*** Begin Patch`
/// document. `read_file` supplies the current content of a target path when
/// the source format needs it (SEARCH/REPLACE context, whole-file add-vs-update).
///
/// # Errors
/// Returns [`PatchNormalizeError`] when the format cannot be recognised or a
/// recognised format fails to parse.
pub fn normalize_to_codex_patch(
    text: &str,
    read_file: &dyn Fn(&str) -> Option<String>,
) -> Result<String, PatchNormalizeError> {
    match detect_patch_format(text) {
        Some(PatchFormat::CodexPatch) => Ok(text.trim().to_string()),
        Some(PatchFormat::UnifiedDiff) => normalize_unified_diff(text),
        Some(PatchFormat::SearchReplace) => normalize_search_replace(text, read_file),
        Some(PatchFormat::WholeFile) => normalize_whole_file(text, read_file),
        None => Err(PatchNormalizeError::UnknownFormat),
    }
}

// ---------------------------------------------------------------------------
// Detection heuristics
// ---------------------------------------------------------------------------

fn looks_like_unified_diff(text: &str) -> bool {
    let mut has_old = false;
    let mut has_new = false;
    let mut has_hunk = false;
    for line in text.lines() {
        has_old |= line.starts_with("--- ");
        has_new |= line.starts_with("+++ ");
        has_hunk |= line.starts_with("@@");
    }
    has_old && has_new && has_hunk
}

fn looks_like_whole_file(text: &str) -> bool {
    let lines: Vec<&str> = text.lines().collect();
    for (i, line) in lines.iter().enumerate() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with("```") || !looks_like_path(trimmed) {
            continue;
        }
        let mut j = i + 1;
        while j < lines.len() && lines[j].trim().is_empty() {
            j += 1;
        }
        if j < lines.len() && lines[j].trim_start().starts_with("```") {
            return true;
        }
    }
    false
}

/// Whether `s` (already trimmed, non-empty) plausibly names a file: no
/// spaces, not a comment/list marker, and either a path separator or a short
/// alphanumeric extension.
fn looks_like_path(s: &str) -> bool {
    if s.contains(' ') || s.starts_with(['#', '*', '-', '`']) {
        return false;
    }
    if s.contains('/') || s.contains('\\') {
        return true;
    }
    match s.rfind('.') {
        Some(idx) if idx > 0 => {
            let ext = &s[idx + 1..];
            !ext.is_empty() && ext.len() <= 6 && ext.chars().all(|c| c.is_ascii_alphanumeric())
        }
        _ => false,
    }
}

fn strip_path_decoration(s: &str) -> String {
    let s = s.trim();
    let s = s.strip_prefix("File:").map_or(s, str::trim);
    let s = s.strip_prefix("file:").map_or(s, str::trim);
    s.trim_matches('`').trim().to_string()
}

fn strip_ab_prefix(path: &str) -> &str {
    path.strip_prefix("a/")
        .or_else(|| path.strip_prefix("b/"))
        .unwrap_or(path)
}

// ---------------------------------------------------------------------------
// Unified diff
// ---------------------------------------------------------------------------

struct DiffHunk<'a> {
    trailer: Option<&'a str>,
    lines: Vec<&'a str>,
}

struct DiffFileSection<'a> {
    old_path: &'a str,
    new_path: &'a str,
    hunks: Vec<DiffHunk<'a>>,
}

fn hunk_trailer(line: &str) -> Option<&str> {
    let after_first = line.strip_prefix("@@")?;
    let idx = after_first.find("@@")?;
    let trailer = after_first[idx + 2..].trim();
    if trailer.is_empty() {
        None
    } else {
        Some(trailer)
    }
}

fn parse_unified_diff(text: &str) -> Result<Vec<DiffFileSection<'_>>, PatchNormalizeError> {
    let lines: Vec<&str> = text.lines().collect();
    let mut sections = Vec::new();
    let mut i = 0;
    while i < lines.len() {
        let Some(old_raw) = lines[i].strip_prefix("--- ") else {
            i += 1;
            continue;
        };
        let Some(new_line) = lines.get(i + 1) else {
            return Err(PatchNormalizeError::UnifiedDiffParse {
                message: "'--- ' line not followed by a '+++ ' line".to_string(),
            });
        };
        let Some(new_raw) = new_line.strip_prefix("+++ ") else {
            return Err(PatchNormalizeError::UnifiedDiffParse {
                message: "'--- ' line not followed by a '+++ ' line".to_string(),
            });
        };
        let old_path = strip_ab_prefix(old_raw.trim().split('\t').next().unwrap_or_default());
        let new_path = strip_ab_prefix(new_raw.trim().split('\t').next().unwrap_or_default());
        i += 2;

        let mut hunks = Vec::new();
        while i < lines.len() && !lines[i].starts_with("--- ") {
            if lines[i].starts_with("@@") {
                let trailer = hunk_trailer(lines[i]);
                i += 1;
                let mut body = Vec::new();
                while i < lines.len()
                    && !lines[i].starts_with("--- ")
                    && !lines[i].starts_with("@@")
                {
                    if !lines[i].starts_with("\\ No newline") {
                        body.push(lines[i]);
                    }
                    i += 1;
                }
                hunks.push(DiffHunk {
                    trailer,
                    lines: body,
                });
            } else {
                i += 1;
            }
        }
        sections.push(DiffFileSection {
            old_path,
            new_path,
            hunks,
        });
    }
    if sections.is_empty() {
        return Err(PatchNormalizeError::UnifiedDiffParse {
            message: "no '--- '/'+++ ' file header pair found".to_string(),
        });
    }
    Ok(sections)
}

fn normalize_unified_diff(text: &str) -> Result<String, PatchNormalizeError> {
    let sections = parse_unified_diff(text)?;
    let mut out = String::from("*** Begin Patch\n");
    for section in sections {
        let is_add = section.old_path == "/dev/null";
        let is_delete = section.new_path == "/dev/null";
        if is_add {
            writeln!(out, "*** Add File: {}", section.new_path).unwrap();
            for hunk in &section.hunks {
                for line in &hunk.lines {
                    if let Some(content) = line.strip_prefix('+') {
                        writeln!(out, "+{content}").unwrap();
                    }
                }
            }
        } else if is_delete {
            writeln!(out, "*** Delete File: {}", section.old_path).unwrap();
        } else {
            writeln!(out, "*** Update File: {}", section.old_path).unwrap();
            if section.old_path != section.new_path {
                writeln!(out, "*** Move to: {}", section.new_path).unwrap();
            }
            for hunk in &section.hunks {
                match hunk.trailer {
                    Some(trailer) => writeln!(out, "@@ {trailer}").unwrap(),
                    None => writeln!(out, "@@").unwrap(),
                }
                for line in &hunk.lines {
                    writeln!(out, "{line}").unwrap();
                }
            }
        }
    }
    out.push_str("*** End Patch");
    Ok(out)
}

// ---------------------------------------------------------------------------
// Aider-style SEARCH/REPLACE
// ---------------------------------------------------------------------------

fn parse_search_replace_blocks(
    text: &str,
) -> Result<Vec<(String, String, String)>, PatchNormalizeError> {
    let lines: Vec<&str> = text.lines().collect();
    let mut blocks = Vec::new();
    let mut last_path: Option<String> = None;
    let mut i = 0;
    while i < lines.len() {
        let line = lines[i];
        if line.trim() == "<<<<<<< SEARCH" {
            let Some(path) = last_path.take() else {
                return Err(PatchNormalizeError::SearchReplaceParse {
                    message: "SEARCH block has no preceding file path line".to_string(),
                });
            };
            i += 1;
            let mut old_lines = Vec::new();
            while i < lines.len() && lines[i].trim() != "=======" {
                old_lines.push(lines[i]);
                i += 1;
            }
            if i >= lines.len() {
                return Err(PatchNormalizeError::SearchReplaceParse {
                    message: format!("unterminated SEARCH block for `{path}` (missing '=======')"),
                });
            }
            i += 1;
            let mut new_lines = Vec::new();
            while i < lines.len() && lines[i].trim() != ">>>>>>> REPLACE" {
                new_lines.push(lines[i]);
                i += 1;
            }
            if i >= lines.len() {
                return Err(PatchNormalizeError::SearchReplaceParse {
                    message: format!(
                        "unterminated SEARCH/REPLACE block for `{path}` (missing '>>>>>>> \
                         REPLACE')"
                    ),
                });
            }
            i += 1;
            blocks.push((path, old_lines.join("\n"), new_lines.join("\n")));
            continue;
        }
        let trimmed = line.trim();
        if !trimmed.is_empty() && !trimmed.starts_with("```") {
            last_path = Some(strip_path_decoration(trimmed));
        }
        i += 1;
    }
    if blocks.is_empty() {
        return Err(PatchNormalizeError::SearchReplaceParse {
            message: "no SEARCH/REPLACE blocks found".to_string(),
        });
    }
    Ok(blocks)
}

fn normalize_search_replace(
    text: &str,
    read_file: &dyn Fn(&str) -> Option<String>,
) -> Result<String, PatchNormalizeError> {
    let blocks = parse_search_replace_blocks(text)?;

    let mut order: Vec<String> = Vec::new();
    let mut by_path: HashMap<String, Vec<(String, String)>> = HashMap::new();
    for (path, old, new) in blocks {
        if !by_path.contains_key(&path) {
            order.push(path.clone());
        }
        by_path.entry(path).or_default().push((old, new));
    }

    let mut out = String::from("*** Begin Patch\n");
    for path in order {
        let chunks = &by_path[&path];
        let existing = read_file(&path);
        let is_pure_new_file =
            existing.is_none() && chunks.iter().all(|(old, _)| old.trim().is_empty());

        if is_pure_new_file {
            writeln!(out, "*** Add File: {path}").unwrap();
            for (_, new) in chunks {
                for line in new.split('\n') {
                    writeln!(out, "+{line}").unwrap();
                }
            }
            continue;
        }

        writeln!(out, "*** Update File: {path}").unwrap();
        for (old, new) in chunks {
            if old.trim().is_empty() {
                let anchor = existing
                    .as_deref()
                    .and_then(|content| content.lines().next());
                let Some(first_line) = anchor else {
                    return Err(PatchNormalizeError::AmbiguousInsertion { path });
                };
                writeln!(out, "@@").unwrap();
                for line in new.split('\n') {
                    writeln!(out, "+{line}").unwrap();
                }
                writeln!(out, " {first_line}").unwrap();
            } else {
                writeln!(out, "@@").unwrap();
                for line in old.split('\n') {
                    writeln!(out, "-{line}").unwrap();
                }
                for line in new.split('\n') {
                    writeln!(out, "+{line}").unwrap();
                }
            }
        }
    }
    out.push_str("*** End Patch");
    Ok(out)
}

// ---------------------------------------------------------------------------
// Whole-file fenced blocks
// ---------------------------------------------------------------------------

fn parse_whole_file_blocks(text: &str) -> Result<Vec<(String, String)>, PatchNormalizeError> {
    let lines: Vec<&str> = text.lines().collect();
    let mut blocks = Vec::new();
    let mut i = 0;
    while i < lines.len() {
        let trimmed = lines[i].trim();
        if trimmed.is_empty() || trimmed.starts_with("```") || !looks_like_path(trimmed) {
            i += 1;
            continue;
        }
        let mut j = i + 1;
        while j < lines.len() && lines[j].trim().is_empty() {
            j += 1;
        }
        if j >= lines.len() || !lines[j].trim_start().starts_with("```") {
            i += 1;
            continue;
        }
        let path = strip_path_decoration(trimmed);
        let mut k = j + 1;
        let mut content_lines = Vec::new();
        while k < lines.len() && !lines[k].trim_start().starts_with("```") {
            content_lines.push(lines[k]);
            k += 1;
        }
        if k >= lines.len() {
            return Err(PatchNormalizeError::WholeFileParse {
                message: format!("unterminated code fence for `{path}`"),
            });
        }
        blocks.push((path, content_lines.join("\n")));
        i = k + 1;
    }
    if blocks.is_empty() {
        return Err(PatchNormalizeError::WholeFileParse {
            message: "no path line followed by a fenced code block was found".to_string(),
        });
    }
    Ok(blocks)
}

fn normalize_whole_file(
    text: &str,
    read_file: &dyn Fn(&str) -> Option<String>,
) -> Result<String, PatchNormalizeError> {
    let blocks = parse_whole_file_blocks(text)?;
    let mut out = String::from("*** Begin Patch\n");
    for (path, content) in blocks {
        match read_file(&path) {
            None => {
                writeln!(out, "*** Add File: {path}").unwrap();
                for line in content.split('\n') {
                    writeln!(out, "+{line}").unwrap();
                }
            }
            Some(existing) => {
                writeln!(out, "*** Update File: {path}").unwrap();
                writeln!(out, "@@").unwrap();
                for line in existing.lines() {
                    writeln!(out, "-{line}").unwrap();
                }
                for line in content.split('\n') {
                    writeln!(out, "+{line}").unwrap();
                }
            }
        }
    }
    out.push_str("*** End Patch");
    Ok(out)
}

#[cfg(test)]
#[path = "patch_normalize_tests.rs"]
mod tests;
