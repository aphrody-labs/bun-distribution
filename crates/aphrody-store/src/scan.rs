// SPDX-License-Identifier: Apache-2.0
//! Scan and classify stages: walk a tree (gitignore and `.graphifyignore` rules, hard secret deny
//! list), fingerprint files by BLAKE3 (reusing the stored hash when size and mtime are
//! unchanged) and record the result in the `files` table.

use std::{collections::BTreeMap, path::Path};

use ignore::WalkBuilder;
use rusqlite::params;
use serde::{Deserialize, Serialize};

use crate::{
    db::HomeDb,
    deny::{DenyPolicy, is_denied},
    error::Result,
    files::{Delta, FileClass, FileFingerprint},
};

/// Scan configuration.
#[derive(Debug, Clone)]
pub struct ScanOptions {
    /// Files larger than this are not fingerprinted.
    pub max_file_size: u64,
    /// Deny policy of the root.
    pub policy: DenyPolicy,
}

impl Default for ScanOptions {
    fn default() -> Self {
        Self {
            max_file_size: 2 * 1024 * 1024,
            policy: DenyPolicy::Repo,
        }
    }
}

/// Counters of one scan.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct ScanOutcome {
    /// Files recorded.
    pub files: usize,
    /// Files whose hash was recomputed.
    pub hashed: usize,
    /// Files skipped by the deny list.
    pub denied: usize,
    /// Files skipped for size.
    pub oversized: usize,
    /// Files that could not be read.
    pub unreadable: usize,
    /// New files since the previous scan.
    pub added: usize,
    /// Files whose hash changed.
    pub changed: usize,
    /// Files that disappeared.
    pub removed: usize,
    /// Full difference with the previous scan (paths); not serialised.
    #[serde(skip)]
    pub delta: Delta,
}

/// Language label of a path by extension.
#[must_use]
pub fn language_of(path: &str) -> Option<&'static str> {
    let ext = path.rsplit_once('.')?.1.to_ascii_lowercase();
    Some(match ext.as_str() {
        "rs" => "rust",
        "ts" | "tsx" | "mts" | "cts" => "typescript",
        "js" | "jsx" | "mjs" | "cjs" => "javascript",
        "py" | "pyi" => "python",
        "go" => "go",
        "java" => "java",
        "c" | "h" => "c",
        "cc" | "cpp" | "cxx" | "hpp" => "cpp",
        "cs" => "csharp",
        "rb" => "ruby",
        "php" => "php",
        "sh" | "bash" => "bash",
        "md" | "mdx" => "markdown",
        "txt" | "rst" => "text",
        "toml" => "toml",
        "json" | "jsonl" => "json",
        "yaml" | "yml" => "yaml",
        "sql" => "sql",
        _ => return None,
    })
}

fn is_generated(path: &str, sample: &[u8]) -> bool {
    let lower = path.to_ascii_lowercase();
    if lower.ends_with(".min.js")
        || lower.ends_with(".bundle.js")
        || lower.ends_with(".map")
        || lower.ends_with("package-lock.json")
        || lower.ends_with("cargo.lock")
        || lower.ends_with("bun.lock")
        || lower.ends_with("yarn.lock")
    {
        return true;
    }
    if lower.split('/').any(|c| {
        matches!(
            c,
            "dist" | "ui-dist" | "generated" | "__generated__" | "vendor"
        )
    }) {
        return true;
    }
    // Minified output: a very long first line.
    sample
        .split(|b| *b == b'\n')
        .next()
        .is_some_and(|line| line.len() > 2000)
}

/// Classify a file from its path and a content sample.
#[must_use]
pub fn classify(path: &str, sample: &[u8]) -> (FileClass, Option<&'static str>) {
    if sample.iter().take(8192).any(|b| *b == 0) {
        return (FileClass::Binary, None);
    }
    let lang = language_of(path);
    let class = if is_generated(path, sample) {
        FileClass::Generated
    } else {
        match lang {
            Some("markdown" | "text") => FileClass::Doc,
            Some("toml" | "json" | "yaml" | "sql") => FileClass::Data,
            Some(_) => FileClass::Code,
            None => FileClass::Unknown,
        }
    };
    (class, lang)
}

fn hash_hex(bytes: &[u8]) -> String {
    blake3::hash(bytes).to_hex().to_string()
}

impl HomeDb {
    /// Stored fingerprints of a source: path to (blake3, size, mtime, class, lang).
    ///
    /// # Errors
    ///
    /// SQLite failures.
    #[allow(clippy::type_complexity)]
    pub fn stored_files(
        &self,
        source_id: i64,
    ) -> Result<BTreeMap<String, (String, i64, i64, String, Option<String>)>> {
        let mut statement = self.conn.prepare(
            "SELECT rel_path, blake3, size_bytes, mtime_ms, class, lang FROM files WHERE source_id = ?1",
        )?;
        let rows = statement.query_map(params![source_id], |r| {
            Ok((
                r.get::<_, String>(0)?,
                (r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?),
            ))
        })?;
        Ok(rows.collect::<std::result::Result<_, _>>()?)
    }
}

/// Scan `root` for the source `source_id` and record the fingerprints.
///
/// # Errors
///
/// SQLite failures (unreadable files are counted, not fatal).
pub fn scan_tree(
    db: &mut HomeDb,
    source_id: i64,
    root: &Path,
    options: &ScanOptions,
) -> Result<ScanOutcome> {
    let stored = db.stored_files(source_id)?;
    let mut outcome = ScanOutcome::default();
    let mut fingerprints: Vec<FileFingerprint> = Vec::new();
    let policy = options.policy;
    let root_owned = root.to_path_buf();
    let walker = WalkBuilder::new(root)
        .hidden(false)
        .git_ignore(true)
        .git_global(false)
        .git_exclude(true)
        .add_custom_ignore_filename(".graphifyignore")
        .filter_entry(move |entry| {
            let rel = entry
                .path()
                .strip_prefix(&root_owned)
                .unwrap_or(entry.path());
            let rel = rel.to_string_lossy().replace('\\', "/");
            rel.is_empty() || !is_denied(&rel, policy)
        })
        .build();
    for entry in walker {
        let Ok(entry) = entry else {
            outcome.unreadable += 1;
            continue;
        };
        if !entry.file_type().is_some_and(|t| t.is_file()) {
            continue;
        }
        let rel = entry
            .path()
            .strip_prefix(root)
            .unwrap_or(entry.path())
            .to_string_lossy()
            .replace('\\', "/");
        let Ok(meta) = entry.metadata() else {
            outcome.unreadable += 1;
            continue;
        };
        if meta.len() > options.max_file_size {
            outcome.oversized += 1;
            continue;
        }
        let mtime_ms = meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map_or(0, |d| i64::try_from(d.as_millis()).unwrap_or(0));
        let size = i64::try_from(meta.len()).unwrap_or(i64::MAX);
        if let Some((hash, s, m, class, lang)) = stored.get(&rel)
            && *s == size
            && *m == mtime_ms
        {
            fingerprints.push(FileFingerprint {
                rel_path: rel,
                blake3: hash.clone(),
                size_bytes: meta.len(),
                mtime_ms,
                class: FileClass::parse(class).unwrap_or(FileClass::Unknown),
                lang: lang.clone(),
            });
            continue;
        }
        let Ok(bytes) = std::fs::read(entry.path()) else {
            outcome.unreadable += 1;
            continue;
        };
        outcome.hashed += 1;
        let (class, lang) = classify(&rel, &bytes);
        fingerprints.push(FileFingerprint {
            blake3: hash_hex(&bytes),
            rel_path: rel,
            size_bytes: meta.len(),
            mtime_ms,
            class,
            lang: lang.map(str::to_owned),
        });
    }
    outcome.files = fingerprints.len();
    outcome.delta = db.apply_scan(source_id, &fingerprints)?;
    outcome.added = outcome.delta.added.len();
    outcome.changed = outcome.delta.changed.len();
    outcome.removed = outcome.delta.removed.len();
    Ok(outcome)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tree() -> tempfile::TempDir {
        let dir = tempfile::tempdir().unwrap();
        let r = dir.path();
        std::fs::create_dir_all(r.join("src")).unwrap();
        std::fs::create_dir_all(r.join("secrets")).unwrap();
        std::fs::create_dir_all(r.join("node_modules/x")).unwrap();
        std::fs::write(r.join("src/lib.rs"), "pub fn a() {}").unwrap();
        std::fs::write(r.join("README.md"), "# hi").unwrap();
        std::fs::write(r.join("data.sqlite"), "x").unwrap();
        std::fs::write(r.join("node_modules/x/i.js"), "x").unwrap();
        std::fs::write(r.join(".env"), "TOKEN=abc").unwrap();
        std::fs::write(r.join("bundle.min.js"), "var a=1;").unwrap();
        std::fs::write(r.join("blob.dat"), [0_u8, 1, 2]).unwrap();
        std::fs::write(r.join("ignored.txt"), "x").unwrap();
        std::fs::write(r.join(".graphifyignore"), "ignored.txt\n").unwrap();
        dir
    }

    #[test]
    fn the_scan_skips_secrets_ignored_files_and_classifies_the_rest() {
        let dir = tree();
        let mut db = HomeDb::open_in_memory().unwrap();
        let source = db.upsert_source("fs", "t", None).unwrap();
        let out = scan_tree(&mut db, source, dir.path(), &ScanOptions::default()).unwrap();
        let stored = db.stored_files(source).unwrap();
        let paths: Vec<&str> = stored.keys().map(String::as_str).collect();
        assert!(
            paths.contains(&"src/lib.rs") && paths.contains(&"README.md"),
            "{paths:?}"
        );
        for hidden in [".env", "data.sqlite", "node_modules/x/i.js", "ignored.txt"] {
            assert!(!paths.contains(&hidden), "{hidden} must not be recorded");
        }
        assert_eq!(stored["src/lib.rs"].3, "code");
        assert_eq!(stored["README.md"].3, "doc");
        assert_eq!(stored["bundle.min.js"].3, "generated");
        assert_eq!(stored["blob.dat"].3, "binary");
        assert!(out.hashed >= 4);
    }

    #[test]
    fn a_rescan_hashes_nothing_and_a_change_is_detected() {
        let dir = tree();
        let mut db = HomeDb::open_in_memory().unwrap();
        let source = db.upsert_source("fs", "t", None).unwrap();
        scan_tree(&mut db, source, dir.path(), &ScanOptions::default()).unwrap();
        let again = scan_tree(&mut db, source, dir.path(), &ScanOptions::default()).unwrap();
        assert_eq!(again.hashed, 0);
        assert_eq!(again.delta.dirty(), 0);
        std::fs::write(dir.path().join("src/lib.rs"), "pub fn b() {}  // changed").unwrap();
        std::fs::remove_file(dir.path().join("README.md")).unwrap();
        let third = scan_tree(&mut db, source, dir.path(), &ScanOptions::default()).unwrap();
        assert_eq!(third.delta.changed, ["src/lib.rs"]);
        assert_eq!(third.delta.removed, ["README.md"]);
    }

    #[test]
    fn oversized_files_are_counted_not_recorded() {
        let dir = tree();
        let mut db = HomeDb::open_in_memory().unwrap();
        let source = db.upsert_source("fs", "t", None).unwrap();
        let out = scan_tree(
            &mut db,
            source,
            dir.path(),
            &ScanOptions {
                max_file_size: 5,
                ..ScanOptions::default()
            },
        )
        .unwrap();
        assert!(out.oversized >= 1);
        assert!(!db.stored_files(source).unwrap().contains_key("src/lib.rs"));
    }

    #[test]
    fn minified_first_lines_are_generated() {
        let long = "a".repeat(3000);
        assert_eq!(
            classify("x/app.js", long.as_bytes()).0,
            FileClass::Generated
        );
        assert_eq!(classify("x/app.js", b"let a = 1;").0, FileClass::Code);
        assert_eq!(
            classify("crates/ui/app/ui-dist/app.js", b"x").0,
            FileClass::Generated
        );
    }
}
