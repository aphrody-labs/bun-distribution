// SPDX-License-Identifier: Apache-2.0
//! Deterministic content revision of an Agent Home (`sha256-v1`).
//!
//! The revision identifies the *content* of a home, independently of
//! timestamps, permissions or the machine. It uses SHA-256 only, so any
//! runtime can recompute it without this crate: Bun does it natively with
//! `Bun.CryptoHasher("sha256")` (reference implementation and golden vector:
//! `packages/infra/workspace/src/agent-home-revision.ts`).
//!
//! ## Algorithm `sha256-v1`
//!
//! 1. Walk the home recursively. Symbolic links are never followed nor counted. Skip every
//!    directory whose name is in [`EXCLUDED_DIRS`] (at any depth) and every file whose name ends
//!    with a suffix in [`EXCLUDED_SUFFIXES`]: they hold derived or volatile state (cache table,
//!    git objects, databases, locks, logs, native sessions, temp files), not home content.
//! 2. For each remaining regular file, take its path relative to the home, with `/` separators.
//!    The path must be valid UTF-8 and contain no line break.
//! 3. Sort the paths by their UTF-8 bytes.
//! 4. Build a manifest with one line per file: `<sha256 hex of the bytes> <size in bytes, decimal>
//!    <relative path>\n` (single spaces, lowercase hex).
//! 5. The revision is `sha256-v1:` followed by the lowercase hex SHA-256 of the manifest bytes.
//!    An empty home hashes the empty manifest.
//!
//! [`crate::sync::SyncSnapshot::revision_sha256`] applies steps 4 and 5 to the
//! seven synchronised documents in contract order.

use std::{
    path::{Path, PathBuf},
    time::SystemTime,
};

use serde::{Deserialize, Serialize};

use crate::{HomeError, fsutil::sha256_hex};

/// Algorithm tag prefixed to every revision.
pub const REVISION_ALGORITHM: &str = "sha256-v1";

/// Directory names never part of the home content (matched at any depth).
pub const EXCLUDED_DIRS: &[&str] = &[
    ".aphrody",
    ".git",
    ".coord",
    "db",
    "cache",
    "locks",
    "logs",
    "sessions",
    "node_modules",
];

/// File-name suffixes never part of the home content.
pub const EXCLUDED_SUFFIXES: &[&str] = &[
    ".tmp",
    ".lock",
    ".sqlite",
    ".sqlite-wal",
    ".sqlite-shm",
    ".db",
    ".db-wal",
    ".db-shm",
    "-journal",
];

/// One content file of a home.
#[derive(Debug, Clone)]
pub struct ContentFile {
    /// Home-relative path with `/` separators.
    pub path: String,
    /// Absolute path on disk.
    pub abs: PathBuf,
    /// Size in bytes.
    pub size: u64,
    /// Last modification time.
    pub modified: SystemTime,
}

/// Digest of one content file, as listed in the manifest.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct FileDigest {
    /// Home-relative path with `/` separators.
    pub path: String,
    /// Size in bytes.
    pub size: u64,
    /// Lowercase hex SHA-256 of the bytes.
    pub sha256: String,
}

/// Revision of a home with its manifest entries.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct HomeRevision {
    /// Always [`REVISION_ALGORITHM`].
    pub algorithm: String,
    /// `sha256-v1:<hex>`.
    pub revision: String,
    /// Manifest entries, sorted by path bytes.
    pub files: Vec<FileDigest>,
}

/// Whether a file name is excluded from the content set.
#[must_use]
pub fn is_excluded_file(name: &str) -> bool {
    EXCLUDED_SUFFIXES
        .iter()
        .any(|suffix| name.ends_with(suffix))
}

/// Whether a directory name is excluded from the content set.
#[must_use]
pub fn is_excluded_dir(name: &str) -> bool {
    EXCLUDED_DIRS.contains(&name)
}

fn invalid(path: &Path, why: &str) -> HomeError {
    HomeError::io(
        path,
        std::io::Error::new(std::io::ErrorKind::InvalidData, why.to_string()),
    )
}

/// List the content files of `root` (see the module docs for the rules),
/// sorted by the UTF-8 bytes of their relative path.
///
/// # Errors
/// [`HomeError::Io`] when `root` or a subdirectory cannot be read, or when a
/// content path is not UTF-8 or contains a line break.
pub fn content_files(root: &Path) -> Result<Vec<ContentFile>, HomeError> {
    let mut out = Vec::new();
    let mut stack: Vec<(PathBuf, String)> = vec![(root.to_path_buf(), String::new())];
    while let Some((dir, prefix)) = stack.pop() {
        let entries = std::fs::read_dir(&dir).map_err(|e| HomeError::io(&dir, e))?;
        for entry in entries {
            let entry = entry.map_err(|e| HomeError::io(&dir, e))?;
            let abs = entry.path();
            let file_type = entry.file_type().map_err(|e| HomeError::io(&abs, e))?;
            if file_type.is_symlink() {
                continue;
            }
            let Some(name) = entry.file_name().to_str().map(str::to_string) else {
                return Err(invalid(&abs, "home content path is not valid UTF-8"));
            };
            if name.contains(['\n', '\r']) {
                return Err(invalid(&abs, "home content path contains a line break"));
            }
            let rel = if prefix.is_empty() {
                name.clone()
            } else {
                format!("{prefix}/{name}")
            };
            if file_type.is_dir() {
                if !is_excluded_dir(&name) {
                    stack.push((abs, rel));
                }
            } else if file_type.is_file() && !is_excluded_file(&name) {
                let meta = entry.metadata().map_err(|e| HomeError::io(&abs, e))?;
                let modified = meta.modified().map_err(|e| HomeError::io(&abs, e))?;
                out.push(ContentFile {
                    path: rel,
                    abs,
                    size: meta.len(),
                    modified,
                });
            }
        }
    }
    out.sort_by(|a, b| a.path.as_bytes().cmp(b.path.as_bytes()));
    Ok(out)
}

/// Revision string of an already sorted manifest.
#[must_use]
pub fn manifest_revision(files: &[FileDigest]) -> String {
    let mut manifest = String::new();
    for f in files {
        manifest.push_str(&f.sha256);
        manifest.push(' ');
        manifest.push_str(&f.size.to_string());
        manifest.push(' ');
        manifest.push_str(&f.path);
        manifest.push('\n');
    }
    format!("{REVISION_ALGORITHM}:{}", sha256_hex(manifest.as_bytes()))
}

/// Digest one content file.
///
/// # Errors
/// [`HomeError::Io`] when the file cannot be read.
pub fn digest(file: &ContentFile) -> Result<FileDigest, HomeError> {
    let bytes = std::fs::read(&file.abs).map_err(|e| HomeError::io(&file.abs, e))?;
    Ok(FileDigest {
        path: file.path.clone(),
        size: bytes.len() as u64,
        sha256: sha256_hex(&bytes),
    })
}

/// Compute the `sha256-v1` revision of the home at `root`.
///
/// # Errors
/// See [`content_files`] and [`digest`].
pub fn home_revision(root: &Path) -> Result<HomeRevision, HomeError> {
    let files = content_files(root)?
        .iter()
        .map(digest)
        .collect::<Result<Vec<_>, _>>()?;
    Ok(HomeRevision {
        algorithm: REVISION_ALGORITHM.to_string(),
        revision: manifest_revision(&files),
        files,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Golden vector shared with the Bun reference implementation
    /// (`packages/infra/workspace/test/agent-home-revision.test.ts`).
    pub(crate) const GOLDEN_REVISION: &str =
        "sha256-v1:306433f35207da84b3a810e6caa22af2ef87a2432e5243f87090b4c926fcede5";

    pub(crate) fn write(root: &Path, rel: &str, body: &[u8]) {
        let p = root.join(rel);
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        std::fs::write(p, body).unwrap();
    }

    fn golden_fixture(root: &Path) {
        write(root, "AGENTS.md", b"rules\n");
        write(root, "USER.md", b"---\nname: Sam\n---\n");
        write(root, "memory/2026-10-06.md", b"note\n");
        write(
            root,
            "skills/\u{e9}t\u{e9}.md",
            "\u{e9}t\u{e9}\n".as_bytes(),
        );
        // Excluded: state, git, databases, temp files.
        write(root, ".aphrody/workspace-state.json", b"{}");
        write(root, ".git/HEAD", b"ref: refs/heads/main\n");
        write(root, "db/aphrody.sqlite", b"SQLite format 3");
        write(root, "memory/cache/x.md", b"derived");
        write(root, ".USER.md.123.tmp", b"partial");
        write(root, "knowledge.db", b"bin");
    }

    #[test]
    fn golden_vector_is_stable() {
        let td = tempfile::tempdir().unwrap();
        golden_fixture(td.path());
        let rev = home_revision(td.path()).unwrap();
        assert_eq!(rev.revision, GOLDEN_REVISION);
        let paths: Vec<_> = rev.files.iter().map(|f| f.path.as_str()).collect();
        assert_eq!(
            paths,
            [
                "AGENTS.md",
                "USER.md",
                "memory/2026-10-06.md",
                "skills/\u{e9}t\u{e9}.md"
            ]
        );
    }

    #[test]
    fn revision_ignores_mtime_and_changes_with_content() {
        let td = tempfile::tempdir().unwrap();
        golden_fixture(td.path());
        let before = home_revision(td.path()).unwrap().revision;
        let p = td.path().join("AGENTS.md");
        let f = std::fs::OpenOptions::new().write(true).open(&p).unwrap();
        f.set_modified(SystemTime::UNIX_EPOCH).unwrap();
        assert_eq!(home_revision(td.path()).unwrap().revision, before);
        write(td.path(), "AGENTS.md", b"rules v2\n");
        assert_ne!(home_revision(td.path()).unwrap().revision, before);
    }

    #[test]
    fn empty_home_hashes_the_empty_manifest() {
        let td = tempfile::tempdir().unwrap();
        assert_eq!(
            home_revision(td.path()).unwrap().revision,
            "sha256-v1:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        );
    }

    #[cfg(unix)]
    #[test]
    fn symlinks_are_not_followed() {
        let td = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        write(outside.path(), "secret.md", b"s");
        write(td.path(), "AGENTS.md", b"rules\n");
        std::os::unix::fs::symlink(outside.path(), td.path().join("link")).unwrap();
        let rev = home_revision(td.path()).unwrap();
        assert_eq!(rev.files.len(), 1);
    }
}
