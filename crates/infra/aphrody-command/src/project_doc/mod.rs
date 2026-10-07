// SPDX-License-Identifier: Apache-2.0
#![forbid(unsafe_code)]
#![warn(clippy::pedantic)]
//! `aphrody-project-doc` — Codex-compatible `AGENTS.md` discovery.
//!
//! Mirrors `openai/codex` `codex-rs/core/src/agents_md.rs` (module doc
//! comment, `agents_md_paths`, `candidate_filenames`, `AGENTS_MD_SEPARATOR`)
//! and `codex-rs/core/src/agents_md_manager.rs`, at the algorithm level
//! aphrody actually needs (a single-cwd, single-environment walk — upstream
//! has since grown multi-environment fan-out for its exec-server transport,
//! which aphrody's single-process CLI has no use for).
//!
//! Semantics (cite line ranges against the upstream file read for this
//! port):
//!
//! - **Project root**: walk up from `cwd` to the first ancestor (inclusive) containing a `.git`
//!   entry — file *or* directory, since a git worktree's `.git` is a file (`agents_md.rs` L10-L18:
//!   "walking upwards ... until a ... marker is found ... default marker list is used (`.git`)").
//!   If no ancestor has one, only `cwd` is considered (`agents_md.rs` L13-L14, L238-L239 `else {
//!   vec![dir] }`).
//! - **Per directory, root → cwd inclusive** (`agents_md.rs` L15-L17, L223-L240): take
//!   [`LOCAL_AGENTS_MD_FILENAME`] if it names a regular file, else [`DEFAULT_AGENTS_MD_FILENAME`],
//!   else the first `fallback_filenames` entry that names a regular file (`candidate_filenames`,
//!   L272-L296). A candidate name that exists but is *not* a regular file (a directory) is skipped
//!   and reported, not silently treated as absent — the next candidate in the same directory is
//!   still tried (upstream's `Ok(_) => {}` at L255 does the same: keep looking).
//! - **Global scope**: [`ProjectDocOptions::global_dir`] is checked the same way (override, then
//!   default filename; no fallback list) and, when present, contributes the first part.
//! - **Budget**: [`ProjectDocOptions::max_bytes`] is a *total* budget across every part, applied in
//!   order (global first, then root → cwd). A part that does not fully fit is truncated at the last
//!   UTF-8 character boundary that fits (upstream truncates on a raw byte offset, `agents_md.rs`
//!   L155-L166, which can produce a broken multi-byte sequence at the cut point once re-decoded —
//!   aphrody fixes this rather than porting the bug); a part encountered after the budget is
//!   already exhausted is dropped entirely. Both cases set [`ProjectDoc::truncated`] and are
//!   recorded in [`ProjectDoc::skipped`]. `max_bytes = 0` disables project docs entirely
//!   (`agents_md.rs` L133-L135 `if max_total == 0 { return Ok(None); }`).
//! - **Empty/whitespace-only** files are skipped and reported (`agents_md.rs` L169 `if
//!   !text.trim().is_empty()`).
//! - **Non-UTF-8** files are skipped and reported. This is a deliberate divergence: upstream
//!   lossy-decodes (`agents_md.rs` L168 `String::from_utf8_lossy`), silently turning invalid bytes
//!   into `\u{FFFD}` and feeding that to the model; aphrody's "annotate, don't filter"
//!   institutional rule (see the databooks post-mortem referenced from `CLAUDE.md` §7) says a
//!   corrupted file should be visible in `skipped`, not laundered into model input.
//! - **Symlinked files are followed** (`agents_md.rs` L190 doc comment: "Symlinks are allowed"):
//!   this crate uses `std::fs::metadata` (symlink-following) rather than `symlink_metadata`
//!   throughout.
use std::path::{Path, PathBuf};

mod discover;

pub use discover::{
    AGENTS_MD_SEPARATOR, DEFAULT_PROJECT_DOC_MAX_BYTES, discover,
};

/// Where a [`ProjectDocPart`] came from.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Scope {
    /// [`ProjectDocOptions::global_dir`].
    Global,
    /// A directory between the discovered project root and `cwd`,
    /// inclusive.
    Project,
}

/// Why a candidate file did not become a [`ProjectDocPart`].
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum SkipReason {
    /// The file's contents are empty or whitespace-only.
    #[error("file is empty or whitespace-only")]
    Empty,
    /// The file's contents are not valid UTF-8.
    #[error("file is not valid UTF-8")]
    NotUtf8,
    /// A candidate name exists at this path but is not a regular file (most
    /// commonly a directory literally named `AGENTS.md`).
    #[error("path exists but is not a regular file")]
    NotAFile,
    /// The total byte budget ([`ProjectDocOptions::max_bytes`]) was already
    /// exhausted before this file was reached; none of its content was
    /// included.
    #[error("byte budget already exhausted before this file was reached")]
    BudgetExhausted,
}

/// One assembled `AGENTS.md`-family document.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProjectDocPart {
    /// The file this part was read from.
    pub path: PathBuf,
    /// Global (home-scoped) or project (repository-scoped) origin.
    pub scope: Scope,
    /// The file's contents, already trimmed of surrounding whitespace and,
    /// if necessary, truncated to fit the remaining budget.
    pub content: String,
    /// Whether `content` is a truncated prefix of the file's real contents.
    pub truncated: bool,
}

/// The result of a [`discover`] call.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ProjectDoc {
    /// Assembled parts, in the order they should be concatenated: global
    /// first (if any), then one per directory from the project root down to
    /// `cwd`, inclusive.
    pub parts: Vec<ProjectDocPart>,
    /// `true` when at least one candidate file was truncated or dropped
    /// because of [`ProjectDocOptions::max_bytes`].
    pub truncated: bool,
    /// Every candidate file this crate looked at but did not turn into a
    /// part, with why. Never silently dropped — see the crate-level
    /// "annotate, don't filter" note.
    pub skipped: Vec<(PathBuf, SkipReason)>,
}

impl ProjectDoc {
    /// Concatenates every part's content in order, inserting
    /// [`AGENTS_MD_SEPARATOR`] exactly once, at the transition from the
    /// global part to the first project part (mirrors `openai/codex`
    /// `codex-rs/core/src/agents_md.rs` `legacy_text`, L386-L419: the
    /// separator marks where workspace-scoped instructions begin, so it
    /// appears only on that one transition, not between every part).
    #[must_use]
    pub fn render(&self) -> String {
        let mut output = String::new();
        let mut previous_scope: Option<Scope> = None;
        for part in &self.parts {
            if let Some(previous) = previous_scope {
                let separator = if previous == Scope::Global && part.scope == Scope::Project {
                    AGENTS_MD_SEPARATOR
                } else {
                    "\n\n"
                };
                output.push_str(separator);
            }
            output.push_str(&part.content);
            previous_scope = Some(part.scope);
        }
        output
    }
}

/// Options controlling [`discover`].
#[derive(Debug, Clone)]
pub struct ProjectDocOptions {
    /// Total byte budget across every discovered part. `0` disables project
    /// docs entirely. Defaults to [`DEFAULT_PROJECT_DOC_MAX_BYTES`] (32 KiB,
    /// matching upstream's `DEFAULT_PROJECT_DOC_MAX_BYTES`).
    pub max_bytes: usize,
    /// Extra filenames tried, in order, when a directory has neither
    /// [`LOCAL_AGENTS_MD_FILENAME`] nor [`DEFAULT_AGENTS_MD_FILENAME`] as a
    /// regular file. Not consulted for the global scope.
    pub fallback_filenames: Vec<String>,
    /// The aphrody state directory (the caller resolves this — see
    /// `aphrody_models::paths::state_dir()` — this crate never derives
    /// `~/.aphrody` itself). When `Some`, checked for a global override
    /// before the project walk.
    pub global_dir: Option<PathBuf>,
}

impl Default for ProjectDocOptions {
    fn default() -> Self {
        Self {
            max_bytes: DEFAULT_PROJECT_DOC_MAX_BYTES,
            fallback_filenames: Vec::new(),
            global_dir: None,
        }
    }
}

/// An error that stops discovery outright. Everything discovery can
/// gracefully route around (a missing file, an empty file, invalid UTF-8, a
/// directory in the way, a budget overrun) is reported through
/// [`ProjectDoc::skipped`] instead, never through this type.
#[derive(Debug, thiserror::Error)]
pub enum ProjectDocError {
    /// A filesystem operation failed for a reason other than "not found"
    /// (permissions, I/O error, and so on).
    #[error("failed to access {path}: {source}")]
    Io {
        path: PathBuf,
        #[source]
        source: std::io::Error,
    },
}

pub(crate) fn io_error(path: &Path, source: std::io::Error) -> ProjectDocError {
    ProjectDocError::Io { path: path.to_path_buf(), source }
}
