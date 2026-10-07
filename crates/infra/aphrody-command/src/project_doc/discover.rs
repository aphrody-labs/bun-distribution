// SPDX-License-Identifier: Apache-2.0
use std::{
    fs, io,
    path::{Path, PathBuf},
};

use crate::project_doc::{
    ProjectDoc, ProjectDocError, ProjectDocOptions, ProjectDocPart, Scope, SkipReason, io_error,
};

/// Preferred local override for `AGENTS.md` instructions, checked before
/// [`DEFAULT_AGENTS_MD_FILENAME`] in every directory (including the global
/// scope). Mirrors `openai/codex` `codex-rs/core/src/agents_md.rs`
/// `LOCAL_AGENTS_MD_FILENAME`.
pub const LOCAL_AGENTS_MD_FILENAME: &str = "AGENTS.override.md";

/// Default filename scanned for project instructions. Mirrors upstream
/// `DEFAULT_AGENTS_MD_FILENAME`.
pub const DEFAULT_AGENTS_MD_FILENAME: &str = "AGENTS.md";

/// Default total byte budget across every discovered part. Mirrors upstream
/// `codex-rs/config/src/config_toml.rs` `DEFAULT_PROJECT_DOC_MAX_BYTES`.
pub const DEFAULT_PROJECT_DOC_MAX_BYTES: usize = 32 * 1024;

/// Separator inserted exactly once, at the transition from the global part
/// to the first project part. Mirrors upstream's `AGENTS_MD_SEPARATOR`.
pub const AGENTS_MD_SEPARATOR: &str = "\n\n--- project-doc ---\n\n";

/// Discovers and assembles every applicable `AGENTS.md`-family document for
/// `cwd`, honouring `options`. See the crate-level documentation for the
/// full algorithm.
///
/// # Errors
///
/// Returns [`ProjectDocError::Io`] for filesystem failures other than "not
/// found" while probing or reading a candidate file. A missing candidate is
/// normal, not an error; an unreadable, empty, non-UTF-8, or budget-dropped
/// one is reported in [`ProjectDoc::skipped`], not returned as an error.
pub fn discover(cwd: &Path, options: &ProjectDocOptions) -> Result<ProjectDoc, ProjectDocError> {
    let mut doc = ProjectDoc::default();
    if options.max_bytes == 0 {
        return Ok(doc);
    }
    let mut remaining = options.max_bytes;

    if let Some(global_dir) = &options.global_dir {
        let global_candidates = [LOCAL_AGENTS_MD_FILENAME, DEFAULT_AGENTS_MD_FILENAME];
        if let Some((path, content)) =
            select_candidate(global_dir, &global_candidates, &mut doc.skipped)?
        {
            push_part(&mut doc, &mut remaining, path, Scope::Global, content);
        }
    }

    let root = find_project_root(cwd)?;
    let directories = directories_from_root_to_cwd(&root, cwd);

    let mut candidate_names: Vec<&str> = vec![LOCAL_AGENTS_MD_FILENAME, DEFAULT_AGENTS_MD_FILENAME];
    for fallback in &options.fallback_filenames {
        let name = fallback.as_str();
        if !name.is_empty() && !candidate_names.contains(&name) {
            candidate_names.push(name);
        }
    }

    for directory in directories {
        if let Some((path, content)) =
            select_candidate(&directory, &candidate_names, &mut doc.skipped)?
        {
            push_part(&mut doc, &mut remaining, path, Scope::Project, content);
        }
    }

    Ok(doc)
}

/// Picks the first candidate name in `names` that resolves to a regular
/// file in `dir`, reads it, and validates it. Non-file candidates are
/// recorded and skipped over (the *next* name in `names` is tried); once a
/// regular file is found it is final for this directory even if its
/// contents turn out empty or non-UTF-8 (those are recorded, not
/// substituted with the next candidate).
fn select_candidate(
    dir: &Path,
    names: &[&str],
    skipped: &mut Vec<(PathBuf, SkipReason)>,
) -> Result<Option<(PathBuf, String)>, ProjectDocError> {
    for name in names {
        let candidate = dir.join(name);
        let metadata = match fs::metadata(&candidate) {
            Ok(metadata) => metadata,
            Err(err) if err.kind() == io::ErrorKind::NotFound => continue,
            Err(err) => return Err(io_error(&candidate, err)),
        };
        if !metadata.is_file() {
            skipped.push((candidate, SkipReason::NotAFile));
            continue;
        }

        let bytes = match fs::read(&candidate) {
            Ok(bytes) => bytes,
            Err(err) if err.kind() == io::ErrorKind::NotFound => continue,
            Err(err) => return Err(io_error(&candidate, err)),
        };

        return Ok(if let Ok(text) = String::from_utf8(bytes) {
            let trimmed = text.trim();
            if trimmed.is_empty() {
                skipped.push((candidate, SkipReason::Empty));
                None
            } else {
                Some((candidate, trimmed.to_string()))
            }
        } else {
            skipped.push((candidate, SkipReason::NotUtf8));
            None
        });
    }
    Ok(None)
}

/// Applies the remaining byte budget to a newly discovered part, truncating
/// on a UTF-8 character boundary or dropping it entirely, and updates
/// `doc.truncated` / `doc.skipped` accordingly.
fn push_part(
    doc: &mut ProjectDoc,
    remaining: &mut usize,
    path: PathBuf,
    scope: Scope,
    content: String,
) {
    if *remaining == 0 {
        doc.truncated = true;
        doc.skipped.push((path, SkipReason::BudgetExhausted));
        return;
    }
    if content.len() <= *remaining {
        *remaining -= content.len();
        doc.parts.push(ProjectDocPart { path, scope, content, truncated: false });
    } else {
        let truncated_content = truncate_at_char_boundary(&content, *remaining);
        *remaining = 0;
        doc.truncated = true;
        doc.parts.push(ProjectDocPart { path, scope, content: truncated_content, truncated: true });
    }
}

/// Truncates `s` to at most `max_bytes` bytes, backing off to the nearest
/// earlier UTF-8 character boundary so the result is always valid `str`.
fn truncate_at_char_boundary(s: &str, max_bytes: usize) -> String {
    let mut end = max_bytes.min(s.len());
    while end > 0 && !s.is_char_boundary(end) {
        end -= 1;
    }
    s[..end].to_string()
}

/// Walks up from `cwd` to the first ancestor (inclusive) containing a
/// `.git` entry, file or directory. Returns `cwd` itself when no ancestor
/// has one.
fn find_project_root(cwd: &Path) -> Result<PathBuf, ProjectDocError> {
    let mut current = cwd;
    loop {
        let marker = current.join(".git");
        match fs::metadata(&marker) {
            Ok(_) => return Ok(current.to_path_buf()),
            Err(err) if err.kind() == io::ErrorKind::NotFound => {},
            Err(err) => return Err(io_error(&marker, err)),
        }
        match current.parent() {
            Some(parent) => current = parent,
            None => return Ok(cwd.to_path_buf()),
        }
    }
}

/// Builds the ordered directory list from `root` down to `cwd`, inclusive.
fn directories_from_root_to_cwd(root: &Path, cwd: &Path) -> Vec<PathBuf> {
    let mut directories = vec![cwd.to_path_buf()];
    let mut cursor = cwd.to_path_buf();
    while cursor != root {
        match cursor.parent() {
            Some(parent) => {
                cursor = parent.to_path_buf();
                directories.push(cursor.clone());
            },
            None => break,
        }
    }
    directories.reverse();
    directories
}

#[cfg(test)]
#[path = "discover_tests.rs"]
mod discover_tests;
