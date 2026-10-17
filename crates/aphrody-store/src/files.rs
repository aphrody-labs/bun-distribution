// SPDX-License-Identifier: Apache-2.0
//! Corpus sources and per-file fingerprints: the incremental, resumable pipeline state.
//!
//! A scan produces [`FileFingerprint`]s; [`HomeDb::apply_scan`] diffs them against the stored
//! rows by BLAKE3 and reports a [`Delta`]. A changed file restarts at stage `scan`; an
//! unchanged file keeps the highest [`Stage`] already completed, so an interrupted run resumes
//! at the first stage that is not done and a repeated run does no work.

use std::collections::{BTreeMap, BTreeSet};

use rusqlite::{OptionalExtension as _, params};
use serde::{Deserialize, Serialize};

use crate::{
    db::HomeDb,
    error::{Result, StoreError},
    time::now_ms,
};

/// Pipeline stages in execution order (`serve` is query time and never stored).
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Stage {
    /// Fingerprinted.
    Scan,
    /// Class and language assigned.
    Classify,
    /// Code graph extracted.
    Extract,
    /// Chunked.
    Chunk,
    /// Embedded (or skipped when no embedder is configured).
    Embed,
    /// Written to the retrieval index.
    Index,
}

impl Stage {
    /// All stages in order.
    pub const ALL: [Self; 6] = [
        Self::Scan,
        Self::Classify,
        Self::Extract,
        Self::Chunk,
        Self::Embed,
        Self::Index,
    ];

    /// Database label.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Scan => "scan",
            Self::Classify => "classify",
            Self::Extract => "extract",
            Self::Chunk => "chunk",
            Self::Embed => "embed",
            Self::Index => "index",
        }
    }

    /// Parse a database label.
    ///
    /// # Errors
    ///
    /// [`StoreError::Invalid`] for an unknown label.
    pub fn parse(label: &str) -> Result<Self> {
        Self::ALL
            .into_iter()
            .find(|s| s.as_str() == label)
            .ok_or_else(|| StoreError::Invalid(format!("unknown stage `{label}`")))
    }

    /// The stage after this one, if any.
    #[must_use]
    pub fn next(self) -> Option<Self> {
        Self::ALL.get(self as usize + 1).copied()
    }
}

/// Coarse file class assigned by the classify stage.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum FileClass {
    /// Source code (graph extraction and chunking).
    Code,
    /// Prose or documentation.
    Doc,
    /// Structured data or configuration.
    Data,
    /// Generated or minified output (kept fingerprinted, never extracted).
    Generated,
    /// Binary content.
    Binary,
    /// Excluded by rule.
    Ignored,
    /// Not classified yet.
    Unknown,
}

impl FileClass {
    /// Database label.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Code => "code",
            Self::Doc => "doc",
            Self::Data => "data",
            Self::Generated => "generated",
            Self::Binary => "binary",
            Self::Ignored => "ignored",
            Self::Unknown => "unknown",
        }
    }

    /// Parse a database label.
    ///
    /// # Errors
    ///
    /// [`StoreError::Invalid`] for an unknown label.
    pub fn parse(label: &str) -> Result<Self> {
        Ok(match label {
            "code" => Self::Code,
            "doc" => Self::Doc,
            "data" => Self::Data,
            "generated" => Self::Generated,
            "binary" => Self::Binary,
            "ignored" => Self::Ignored,
            "unknown" => Self::Unknown,
            other => return Err(StoreError::Invalid(format!("unknown file class `{other}`"))),
        })
    }
}

/// What a scan observed about one file.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct FileFingerprint {
    /// Path relative to the source root, `/` separators.
    pub rel_path: String,
    /// Lower-case hex BLAKE3 of the content.
    pub blake3: String,
    /// Size in bytes.
    pub size_bytes: u64,
    /// Modification time, Unix milliseconds.
    pub mtime_ms: i64,
    /// Class (`Unknown` until classified).
    pub class: FileClass,
    /// Language label, when known.
    pub lang: Option<String>,
}

/// Difference between a scan and the stored state of a source.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Delta {
    /// Paths not stored before.
    pub added: Vec<String>,
    /// Paths whose hash changed.
    pub changed: Vec<String>,
    /// Paths with the stored hash.
    pub unchanged: Vec<String>,
    /// Stored paths absent from the scan.
    pub removed: Vec<String>,
}

impl Delta {
    /// Number of files that need processing (`added` plus `changed`).
    #[must_use]
    pub fn dirty(&self) -> usize {
        self.added.len() + self.changed.len()
    }
}

impl HomeDb {
    /// Create or update a source by label and return its id.
    ///
    /// # Errors
    ///
    /// [`StoreError::Invalid`] for an empty kind or label, or SQLite failures.
    pub fn upsert_source(&self, kind: &str, label: &str, root: Option<&str>) -> Result<i64> {
        if kind.is_empty() || label.is_empty() {
            return Err(StoreError::Invalid(
                "source kind and label must not be empty".into(),
            ));
        }
        let now = now_ms();
        self.conn.execute(
            "INSERT INTO sources (kind, label, root, created_at_ms, updated_at_ms)
             VALUES (?1, ?2, ?3, ?4, ?4)
             ON CONFLICT(label) DO UPDATE SET kind = excluded.kind, root = excluded.root,
                 updated_at_ms = excluded.updated_at_ms",
            params![kind, label, root, now],
        )?;
        Ok(self
            .conn
            .query_row("SELECT id FROM sources WHERE label = ?1", [label], |r| {
                r.get(0)
            })?)
    }

    /// Source id for a label, if it exists.
    ///
    /// # Errors
    ///
    /// SQLite failures.
    pub fn source_id(&self, label: &str) -> Result<Option<i64>> {
        Ok(self
            .conn
            .query_row("SELECT id FROM sources WHERE label = ?1", [label], |r| {
                r.get(0)
            })
            .optional()?)
    }

    /// Diff `scan` against the stored files of `source_id` without writing anything.
    ///
    /// # Errors
    ///
    /// SQLite failures.
    pub fn diff_scan(&self, source_id: i64, scan: &[FileFingerprint]) -> Result<Delta> {
        let stored = self.stored_hashes(source_id)?;
        let mut delta = Delta::default();
        let mut seen = BTreeSet::new();
        for file in scan {
            seen.insert(file.rel_path.as_str());
            match stored.get(&file.rel_path) {
                None => delta.added.push(file.rel_path.clone()),
                Some(hash) if *hash == file.blake3 => delta.unchanged.push(file.rel_path.clone()),
                Some(_) => delta.changed.push(file.rel_path.clone()),
            }
        }
        delta.removed = stored
            .keys()
            .filter(|p| !seen.contains(p.as_str()))
            .cloned()
            .collect::<Vec<_>>();
        Ok(delta)
    }

    /// Record a scan in one transaction: new and changed files restart at stage `scan`,
    /// unchanged files keep their stage (their `mtime_ms` and `class` are refreshed), files
    /// absent from the scan are removed from the fingerprint table (their documents are removed
    /// by the retrieval owner using the returned `removed` paths).
    ///
    /// # Errors
    ///
    /// SQLite failures; nothing is written on error.
    pub fn apply_scan(&mut self, source_id: i64, scan: &[FileFingerprint]) -> Result<Delta> {
        let delta = self.diff_scan(source_id, scan)?;
        let now = now_ms();
        let tx = self.conn.transaction()?;
        {
            let mut upsert = tx.prepare_cached(
                "INSERT INTO files (source_id, rel_path, blake3, size_bytes, mtime_ms, class, lang,
                                    stage, scanned_at_ms)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'scan', ?8)
                 ON CONFLICT(source_id, rel_path) DO UPDATE SET
                    blake3 = excluded.blake3, size_bytes = excluded.size_bytes,
                    mtime_ms = excluded.mtime_ms, class = excluded.class, lang = excluded.lang,
                    stage = CASE WHEN files.blake3 = excluded.blake3 THEN files.stage ELSE 'scan' END,
                    scanned_at_ms = excluded.scanned_at_ms",
            )?;
            for file in scan {
                let size = i64::try_from(file.size_bytes)
                    .map_err(|_| StoreError::Invalid(format!("{} is too large", file.rel_path)))?;
                upsert.execute(params![
                    source_id,
                    file.rel_path,
                    file.blake3,
                    size,
                    file.mtime_ms,
                    file.class.as_str(),
                    file.lang,
                    now
                ])?;
            }
            let mut remove =
                tx.prepare_cached("DELETE FROM files WHERE source_id = ?1 AND rel_path = ?2")?;
            for path in &delta.removed {
                remove.execute(params![source_id, path])?;
            }
        }
        tx.commit()?;
        Ok(delta)
    }

    /// Mark `stage` completed for a file, only when its stored hash is still `blake3` (a file
    /// that changed under the pipeline is left for the next scan). Returns whether it applied.
    /// Stages never move backwards.
    ///
    /// # Errors
    ///
    /// SQLite failures.
    pub fn complete_stage(
        &self,
        source_id: i64,
        rel_path: &str,
        blake3: &str,
        stage: Stage,
    ) -> Result<bool> {
        let current: Option<(String, String)> = self
            .conn
            .query_row(
                "SELECT blake3, stage FROM files WHERE source_id = ?1 AND rel_path = ?2",
                params![source_id, rel_path],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()?;
        let Some((hash, label)) = current else {
            return Ok(false);
        };
        if hash != blake3 || Stage::parse(&label)? >= stage {
            return Ok(false);
        }
        let changed = self.conn.execute(
            "UPDATE files SET stage = ?3 WHERE source_id = ?1 AND rel_path = ?2 AND blake3 = ?4",
            params![source_id, rel_path, stage.as_str(), blake3],
        )?;
        Ok(changed == 1)
    }

    /// Files of a source that have not completed `stage` yet, excluding classes that never
    /// enter later stages (`ignored`), in path order. This is the resume queue.
    ///
    /// # Errors
    ///
    /// SQLite failures.
    pub fn pending(&self, source_id: i64, stage: Stage) -> Result<Vec<FileFingerprint>> {
        let mut statement = self.conn.prepare(
            "SELECT rel_path, blake3, size_bytes, mtime_ms, class, lang, stage FROM files
             WHERE source_id = ?1 AND class <> 'ignored' ORDER BY rel_path",
        )?;
        let rows = statement.query_map([source_id], |r| {
            Ok((
                FileFingerprint {
                    rel_path: r.get(0)?,
                    blake3: r.get(1)?,
                    size_bytes: u64::try_from(r.get::<_, i64>(2)?).unwrap_or(0),
                    mtime_ms: r.get(3)?,
                    class: FileClass::parse(&r.get::<_, String>(4)?)
                        .map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e)))?,
                    lang: r.get(5)?,
                },
                r.get::<_, String>(6)?,
            ))
        })?;
        let mut out = Vec::new();
        for row in rows {
            let (file, label) = row?;
            if Stage::parse(&label)? < stage {
                out.push(file);
            }
        }
        Ok(out)
    }

    /// Number of stored files and per-stage counts of a source.
    ///
    /// # Errors
    ///
    /// SQLite failures.
    pub fn stage_counts(&self, source_id: i64) -> Result<BTreeMap<String, u64>> {
        let mut statement = self
            .conn
            .prepare("SELECT stage, count(*) FROM files WHERE source_id = ?1 GROUP BY stage")?;
        let rows = statement.query_map([source_id], |r| {
            Ok((
                r.get::<_, String>(0)?,
                u64::try_from(r.get::<_, i64>(1)?).unwrap_or(0),
            ))
        })?;
        Ok(rows.collect::<std::result::Result<_, _>>()?)
    }

    fn stored_hashes(&self, source_id: i64) -> Result<BTreeMap<String, String>> {
        let mut statement = self
            .conn
            .prepare("SELECT rel_path, blake3 FROM files WHERE source_id = ?1")?;
        let rows = statement.query_map([source_id], |r| Ok((r.get(0)?, r.get(1)?)))?;
        Ok(rows.collect::<std::result::Result<_, _>>()?)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fp(path: &str, hash: &str) -> FileFingerprint {
        FileFingerprint {
            rel_path: path.into(),
            blake3: hash.into(),
            size_bytes: 10,
            mtime_ms: 1,
            class: FileClass::Code,
            lang: Some("rust".into()),
        }
    }

    #[test]
    fn first_scan_adds_everything_and_a_repeat_changes_nothing() {
        let mut db = HomeDb::open_in_memory().unwrap();
        let source = db.upsert_source("fs", "repo", Some("/work/repo")).unwrap();
        let scan = vec![fp("a.rs", "h1"), fp("b.rs", "h2")];
        let first = db.apply_scan(source, &scan).unwrap();
        assert_eq!(first.added, ["a.rs", "b.rs"]);
        assert_eq!(first.dirty(), 2);
        let again = db.apply_scan(source, &scan).unwrap();
        assert_eq!(again.dirty(), 0);
        assert_eq!(again.unchanged.len(), 2);
    }

    #[test]
    fn upsert_source_is_stable_by_label() {
        let db = HomeDb::open_in_memory().unwrap();
        let a = db.upsert_source("fs", "repo", Some("/a")).unwrap();
        let b = db.upsert_source("git", "repo", Some("/b")).unwrap();
        assert_eq!(a, b);
        assert!(db.upsert_source("", "x", None).is_err());
    }

    #[test]
    fn changed_files_restart_and_unchanged_files_keep_their_stage() {
        let mut db = HomeDb::open_in_memory().unwrap();
        let source = db.upsert_source("fs", "repo", None).unwrap();
        db.apply_scan(source, &[fp("a.rs", "h1"), fp("b.rs", "h2")])
            .unwrap();
        for stage in Stage::ALL.into_iter().skip(1) {
            assert!(db.complete_stage(source, "a.rs", "h1", stage).unwrap());
        }
        assert!(
            db.complete_stage(source, "b.rs", "h2", Stage::Chunk)
                .unwrap()
        );
        // Same hash for a.rs, new hash for b.rs, new file c.rs.
        let delta = db
            .apply_scan(
                source,
                &[fp("a.rs", "h1"), fp("b.rs", "h3"), fp("c.rs", "h4")],
            )
            .unwrap();
        assert_eq!(
            (
                delta.added.len(),
                delta.changed.len(),
                delta.unchanged.len()
            ),
            (1, 1, 1)
        );
        let counts = db.stage_counts(source).unwrap();
        assert_eq!(counts.get("index"), Some(&1));
        assert_eq!(counts.get("scan"), Some(&2));
    }

    #[test]
    fn removed_files_leave_the_fingerprint_table() {
        let mut db = HomeDb::open_in_memory().unwrap();
        let source = db.upsert_source("fs", "repo", None).unwrap();
        db.apply_scan(source, &[fp("a.rs", "h1"), fp("b.rs", "h2")])
            .unwrap();
        let delta = db.apply_scan(source, &[fp("a.rs", "h1")]).unwrap();
        assert_eq!(delta.removed, ["b.rs"]);
        assert_eq!(db.stage_counts(source).unwrap().values().sum::<u64>(), 1);
    }

    #[test]
    fn stages_never_move_backwards_and_stale_hashes_are_refused() {
        let mut db = HomeDb::open_in_memory().unwrap();
        let source = db.upsert_source("fs", "repo", None).unwrap();
        db.apply_scan(source, &[fp("a.rs", "h1")]).unwrap();
        assert!(
            db.complete_stage(source, "a.rs", "h1", Stage::Chunk)
                .unwrap()
        );
        assert!(
            !db.complete_stage(source, "a.rs", "h1", Stage::Classify)
                .unwrap()
        );
        assert!(
            !db.complete_stage(source, "a.rs", "stale", Stage::Index)
                .unwrap()
        );
        assert!(
            !db.complete_stage(source, "missing.rs", "h1", Stage::Index)
                .unwrap()
        );
    }

    #[test]
    fn pending_is_the_resume_queue() {
        let mut db = HomeDb::open_in_memory().unwrap();
        let source = db.upsert_source("fs", "repo", None).unwrap();
        let mut ignored = fp("c.bin", "h3");
        ignored.class = FileClass::Ignored;
        db.apply_scan(source, &[fp("a.rs", "h1"), fp("b.rs", "h2"), ignored])
            .unwrap();
        db.complete_stage(source, "a.rs", "h1", Stage::Index)
            .unwrap();
        db.complete_stage(source, "b.rs", "h2", Stage::Chunk)
            .unwrap();
        let queue = db.pending(source, Stage::Embed).unwrap();
        assert_eq!(
            queue
                .iter()
                .map(|f| f.rel_path.as_str())
                .collect::<Vec<_>>(),
            ["b.rs"]
        );
        assert!(db.pending(source, Stage::Index).unwrap().len() == 1);
    }

    #[test]
    fn stage_helpers_round_trip() {
        for stage in Stage::ALL {
            assert_eq!(Stage::parse(stage.as_str()).unwrap(), stage);
        }
        assert_eq!(Stage::Scan.next(), Some(Stage::Classify));
        assert_eq!(Stage::Index.next(), None);
        assert!(Stage::parse("serve").is_err());
        assert_eq!(FileClass::parse("generated").unwrap(), FileClass::Generated);
    }
}
