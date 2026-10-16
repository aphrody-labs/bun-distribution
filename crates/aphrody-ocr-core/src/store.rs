// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 aphrody contributors

//! Durable deposit of OCR results into one `SQLite` file.
//!
//! # Why a database next to the JSONL
//!
//! JSONL is the streaming format: it survives an interrupted batch and makes
//! `--skip-done` possible. It is a poor *corpus*: answering "which pages are
//! `needs-review`", "which pages were read twice with different text" or "what
//! is the mean confidence of this lot" means re-parsing every line of every
//! run. The store keeps the same records, keyed and indexed, so a deposit is
//! queryable and a re-run is idempotent instead of duplicated.
//!
//! The JSONL stays authoritative for append-only streaming; this store is a
//! projection of it that can always be rebuilt with `aphrody ocr db ingest`.
//!
//! # Identity
//!
//! A row is keyed by `(page_id, content_key)` where `content_key` is the image
//! digest when the producer computed one, and the empty string otherwise.
//! Re-reading the same bytes therefore *replaces* the row, while re-reading a
//! page whose image was swapped out keeps both records — which is the whole
//! point of carrying `sha256` in the contract.

use std::path::{Path, PathBuf};

use rusqlite::{Connection, OptionalExtension as _, params};

use crate::result::{OcrResult, OcrStatus};

/// Schema version written to `PRAGMA user_version`.
const SCHEMA_VERSION: i64 = 1;

/// Failures of a deposit.
#[derive(Debug)]
pub enum StoreError {
    /// The database could not be opened, migrated, read or written.
    Sqlite(rusqlite::Error),
    /// The database directory could not be created.
    Io(std::io::Error),
    /// A record could not be serialised for storage, or read back.
    Encode(serde_json::Error),
}

impl std::fmt::Display for StoreError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Sqlite(e) => write!(f, "OCR store: {e}"),
            Self::Io(e) => write!(f, "OCR store: {e}"),
            Self::Encode(e) => write!(f, "OCR store: encode record: {e}"),
        }
    }
}

impl std::error::Error for StoreError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::Sqlite(e) => Some(e),
            Self::Io(e) => Some(e),
            Self::Encode(e) => Some(e),
        }
    }
}

impl From<rusqlite::Error> for StoreError {
    fn from(error: rusqlite::Error) -> Self {
        Self::Sqlite(error)
    }
}

impl From<std::io::Error> for StoreError {
    fn from(error: std::io::Error) -> Self {
        Self::Io(error)
    }
}

impl From<serde_json::Error> for StoreError {
    fn from(error: serde_json::Error) -> Self {
        Self::Encode(error)
    }
}

/// Result of a store operation.
pub type Result<T> = std::result::Result<T, StoreError>;

/// What one deposit changed.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, serde::Serialize)]
pub struct DepositReport {
    /// Records written for a page/content pair not previously stored.
    pub inserted: u64,
    /// Records that replaced an existing row for the same page and bytes.
    pub replaced: u64,
}

impl DepositReport {
    /// Every record the deposit accepted.
    #[must_use]
    pub const fn total(&self) -> u64 {
        self.inserted + self.replaced
    }
}

/// Row counts per final status, for a one-line corpus report.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, serde::Serialize)]
pub struct StoreStats {
    /// Pages that carry text.
    pub text: u64,
    /// Pages the backend finished with no credible text region.
    pub no_text: u64,
    /// Pages that likely hold text but could not be read.
    pub unreadable: u64,
    /// Pages held back by a quality rule.
    pub needs_review: u64,
    /// Pages whose backend failed before an outcome existed.
    pub processing_error: u64,
}

impl StoreStats {
    /// Every stored page.
    #[must_use]
    pub const fn total(&self) -> u64 {
        self.text + self.no_text + self.unreadable + self.needs_review + self.processing_error
    }

    /// Pages that may be considered for an automatic deposit downstream.
    #[must_use]
    pub const fn depositable(&self) -> u64 {
        self.text
    }
}

/// One stored page, in listing order.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
pub struct StoredPage {
    /// Stable page identity within its batch or corpus.
    pub page_id: String,
    /// Path recorded by the producer.
    pub path: PathBuf,
    /// Final semantic status.
    pub status: OcrStatus,
    /// Mean recognition confidence, when the backend produced one.
    pub mean_confidence: Option<f32>,
    /// Number of recognised regions stored for the page.
    pub blocks: u64,
    /// Backend of the last attempt.
    pub backend: Option<String>,
    /// Where this record came from: a JSONL path, or the run that produced it.
    pub source: Option<String>,
    /// UTC timestamp of the deposit, RFC 3339.
    pub recorded_at: String,
}

/// Filters for [`OcrStore::list`].
#[derive(Debug, Clone, Default)]
pub struct ListFilter {
    /// Restrict to one final status.
    pub status: Option<OcrStatus>,
    /// Cap the number of rows. `None` means every match.
    pub limit: Option<u32>,
}

impl ListFilter {
    /// Only pages in `status`.
    #[must_use]
    pub const fn status(mut self, status: OcrStatus) -> Self {
        self.status = Some(status);
        self
    }

    /// At most `limit` rows.
    #[must_use]
    pub const fn limit(mut self, limit: u32) -> Self {
        self.limit = Some(limit);
        self
    }
}

/// The OCR corpus database.
#[derive(Debug)]
pub struct OcrStore {
    conn: Connection,
    path: Option<PathBuf>,
}

impl OcrStore {
    /// Open the durable OCR corpus selected by a resolved Home Agent profile.
    ///
    /// The profile context owns path resolution, so OCR never falls back to a
    /// process-global corpus when a named profile is active.
    ///
    /// # Errors
    ///
    /// [`StoreError`] when the profile directory, database or schema cannot be
    /// created.
    pub fn open_profile(profile: &aphrody_agent_home::ProfileServiceContext) -> Result<Self> {
        Self::open(profile.ocr_database_path())
    }

    /// Open (creating if needed) the store at `path`.
    ///
    /// # Errors
    ///
    /// [`StoreError`] when the parent directory, the file or the schema cannot
    /// be created.
    pub fn open(path: impl AsRef<Path>) -> Result<Self> {
        let path = path.as_ref();
        if let Some(parent) = path.parent()
            && !parent.as_os_str().is_empty()
        {
            std::fs::create_dir_all(parent)?;
        }
        let store = Self { conn: Connection::open(path)?, path: Some(path.to_path_buf()) };
        store.migrate()?;
        Ok(store)
    }

    /// An in-memory store, for tests and dry runs.
    ///
    /// # Errors
    ///
    /// [`StoreError`] when the schema cannot be applied.
    pub fn in_memory() -> Result<Self> {
        let store = Self { conn: Connection::open_in_memory()?, path: None };
        store.migrate()?;
        Ok(store)
    }

    /// The backing file, or `None` for an in-memory store.
    #[must_use]
    pub fn path(&self) -> Option<&Path> {
        self.path.as_deref()
    }

    fn migrate(&self) -> Result<()> {
        // WAL lets `aphrody ocr db stats` read while a batch is still
        // depositing; the full record is kept verbatim so the store can be
        // reprojected without going back to the JSONL.
        self.conn.execute_batch(
            "PRAGMA journal_mode = WAL;
             PRAGMA synchronous = NORMAL;
             PRAGMA foreign_keys = ON;
             PRAGMA busy_timeout = 5000;
             CREATE TABLE IF NOT EXISTS ocr_pages (
                 page_id         TEXT NOT NULL,
                 content_key     TEXT NOT NULL,
                 path            TEXT NOT NULL,
                 sha256          TEXT,
                 media_type      TEXT,
                 status          TEXT NOT NULL,
                 markdown        TEXT,
                 mean_confidence REAL,
                 block_count     INTEGER NOT NULL DEFAULT 0,
                 model_id        TEXT,
                 backend         TEXT,
                 provider        TEXT,
                 elapsed_ms      INTEGER,
                 record          TEXT NOT NULL,
                 source          TEXT,
                 recorded_at     TEXT NOT NULL,
                 PRIMARY KEY (page_id, content_key)
             );
             CREATE INDEX IF NOT EXISTS ocr_pages_status ON ocr_pages (status);
             CREATE INDEX IF NOT EXISTS ocr_pages_path ON ocr_pages (path);
             CREATE TABLE IF NOT EXISTS ocr_blocks (
                 page_id     TEXT NOT NULL,
                 content_key TEXT NOT NULL,
                 idx         INTEGER NOT NULL,
                 text        TEXT NOT NULL,
                 confidence  REAL,
                 role        TEXT,
                 polygon     TEXT,
                 PRIMARY KEY (page_id, content_key, idx),
                 FOREIGN KEY (page_id, content_key)
                     REFERENCES ocr_pages (page_id, content_key) ON DELETE CASCADE
             );",
        )?;
        self.conn.pragma_update(None, "user_version", SCHEMA_VERSION)?;
        Ok(())
    }

    /// Deposit one record, replacing an earlier read of the same bytes.
    ///
    /// Every status is stored, including `no-text` and `processing-error`: a
    /// page that failed must stay visible, not vanish from the corpus.
    ///
    /// # Errors
    ///
    /// [`StoreError`] on encode or write failure.
    pub fn deposit(&mut self, result: &OcrResult, source: Option<&str>) -> Result<DepositReport> {
        self.deposit_all(std::slice::from_ref(result), source)
    }

    /// Deposit many records in one transaction.
    ///
    /// # Errors
    ///
    /// [`StoreError`] on encode or write failure. The transaction is rolled
    /// back, so a failed ingest never leaves half a lot behind.
    pub fn deposit_all(
        &mut self,
        results: &[OcrResult],
        source: Option<&str>,
    ) -> Result<DepositReport> {
        let recorded_at = now_rfc3339();
        let tx = self.conn.transaction()?;
        let mut report = DepositReport::default();
        for result in results {
            let content_key = result.image.sha256.clone().unwrap_or_default();
            let existed: Option<i64> = tx
                .query_row(
                    "SELECT 1 FROM ocr_pages WHERE page_id = ?1 AND content_key = ?2",
                    params![result.page_id, content_key],
                    |row| row.get(0),
                )
                .optional()?;
            let last = result.attempts.last();
            tx.execute(
                "INSERT INTO ocr_pages
                    (page_id, content_key, path, sha256, media_type, status, markdown,
                     mean_confidence, block_count, model_id, backend, provider, elapsed_ms,
                     record, source, recorded_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16)
                 ON CONFLICT (page_id, content_key) DO UPDATE SET
                     path = excluded.path,
                     sha256 = excluded.sha256,
                     media_type = excluded.media_type,
                     status = excluded.status,
                     markdown = excluded.markdown,
                     mean_confidence = excluded.mean_confidence,
                     block_count = excluded.block_count,
                     model_id = excluded.model_id,
                     backend = excluded.backend,
                     provider = excluded.provider,
                     elapsed_ms = excluded.elapsed_ms,
                     record = excluded.record,
                     source = excluded.source,
                     recorded_at = excluded.recorded_at",
                params![
                    result.page_id,
                    content_key,
                    result.image.path.to_string_lossy(),
                    result.image.sha256,
                    result.image.media_type,
                    status_key(result.status),
                    result.markdown,
                    result.quality.mean_confidence,
                    i64::try_from(result.blocks.len()).unwrap_or(i64::MAX),
                    last.map(|attempt| attempt.run.model_id.clone()),
                    last.map(|attempt| attempt.run.backend.clone()),
                    last.and_then(|attempt| attempt.run.provider.clone()),
                    last.and_then(|attempt| i64::try_from(attempt.elapsed_ms).ok()),
                    serde_json::to_string(result)?,
                    source,
                    recorded_at,
                ],
            )?;
            // Blocks are rewritten wholesale: a second read of the same bytes
            // must not leave regions from the previous attempt behind.
            tx.execute(
                "DELETE FROM ocr_blocks WHERE page_id = ?1 AND content_key = ?2",
                params![result.page_id, content_key],
            )?;
            for (idx, block) in result.blocks.iter().enumerate() {
                let polygon =
                    block.polygon.map(|polygon| serde_json::to_string(&polygon)).transpose()?;
                tx.execute(
                    "INSERT INTO ocr_blocks
                        (page_id, content_key, idx, text, confidence, role, polygon)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                    params![
                        result.page_id,
                        content_key,
                        i64::try_from(idx).unwrap_or(i64::MAX),
                        block.text,
                        block.confidence,
                        block.role,
                        polygon,
                    ],
                )?;
            }
            if existed.is_some() {
                report.replaced += 1;
            } else {
                report.inserted += 1;
            }
        }
        tx.commit()?;
        Ok(report)
    }

    /// Whether this exact page identity is already stored.
    ///
    /// # Errors
    ///
    /// [`StoreError`] on read failure.
    pub fn contains(&self, page_id: &str, sha256: Option<&str>) -> Result<bool> {
        let found: Option<i64> = self
            .conn
            .query_row(
                "SELECT 1 FROM ocr_pages WHERE page_id = ?1 AND content_key = ?2",
                params![page_id, sha256.unwrap_or_default()],
                |row| row.get(0),
            )
            .optional()?;
        Ok(found.is_some())
    }

    /// Counts per final status.
    ///
    /// # Errors
    ///
    /// [`StoreError`] on read failure.
    pub fn stats(&self) -> Result<StoreStats> {
        let mut stmt =
            self.conn.prepare("SELECT status, COUNT(*) FROM ocr_pages GROUP BY status")?;
        let mut stats = StoreStats::default();
        let rows =
            stmt.query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?)))?;
        for row in rows {
            let (key, rows) = row?;
            let count = u64::try_from(rows).unwrap_or(0);
            match key.as_str() {
                "text" => stats.text = count,
                "no-text" => stats.no_text = count,
                "unreadable" => stats.unreadable = count,
                "processing-error" => stats.processing_error = count,
                // A status written by a newer schema is surfaced as needing
                // review rather than dropped from the total: a count that
                // silently omits rows is worse than one that over-reports.
                _ => stats.needs_review += count,
            }
        }
        Ok(stats)
    }

    /// Stored pages, newest deposit first.
    ///
    /// # Errors
    ///
    /// [`StoreError`] on read failure.
    pub fn list(&self, filter: &ListFilter) -> Result<Vec<StoredPage>> {
        let mut sql = String::from(
            "SELECT page_id, path, status, mean_confidence, block_count, backend, source, \
             recorded_at FROM ocr_pages",
        );
        if filter.status.is_some() {
            sql.push_str(" WHERE status = ?1");
        }
        sql.push_str(" ORDER BY recorded_at DESC, page_id ASC");
        if let Some(limit) = filter.limit {
            use std::fmt::Write as _;
            // Bound, not user text: the value is an integer parsed by clap.
            let _ = write!(sql, " LIMIT {limit}");
        }
        let mut stmt = self.conn.prepare(&sql)?;
        let map = |row: &rusqlite::Row<'_>| {
            Ok(StoredPage {
                page_id: row.get(0)?,
                path: PathBuf::from(row.get::<_, String>(1)?),
                status: parse_status(&row.get::<_, String>(2)?),
                mean_confidence: row.get(3)?,
                blocks: u64::try_from(row.get::<_, i64>(4)?).unwrap_or(0),
                backend: row.get(5)?,
                source: row.get(6)?,
                recorded_at: row.get(7)?,
            })
        };
        let pages = match filter.status {
            Some(status) => stmt
                .query_map(params![status_key(status)], map)?
                .collect::<rusqlite::Result<Vec<_>>>()?,
            None => stmt.query_map([], map)?.collect::<rusqlite::Result<Vec<_>>>()?,
        };
        Ok(pages)
    }

    /// The full stored record for a page, as deposited.
    ///
    /// # Errors
    ///
    /// [`StoreError`] on read failure or on a record that no longer parses.
    pub fn record(&self, page_id: &str, sha256: Option<&str>) -> Result<Option<OcrResult>> {
        let raw: Option<String> = self
            .conn
            .query_row(
                "SELECT record FROM ocr_pages WHERE page_id = ?1 AND content_key = ?2",
                params![page_id, sha256.unwrap_or_default()],
                |row| row.get(0),
            )
            .optional()?;
        raw.map(|raw| serde_json::from_str(&raw).map_err(StoreError::Encode)).transpose()
    }
}

/// The kebab-case key stored for a status.
fn status_key(status: OcrStatus) -> &'static str {
    match status {
        OcrStatus::Text => "text",
        OcrStatus::NoText => "no-text",
        OcrStatus::Unreadable => "unreadable",
        OcrStatus::NeedsReview => "needs-review",
        OcrStatus::ProcessingError => "processing-error",
    }
}

/// Read a status back, defaulting an unknown key to review rather than to text.
fn parse_status(key: &str) -> OcrStatus {
    match key {
        "text" => OcrStatus::Text,
        "no-text" => OcrStatus::NoText,
        "unreadable" => OcrStatus::Unreadable,
        "processing-error" => OcrStatus::ProcessingError,
        _ => OcrStatus::NeedsReview,
    }
}

/// Deposit timestamp, UTC, second precision, sortable as text.
fn now_rfc3339() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::result::{
        Attempt, AttemptStatus, ImageIdentity, OcrBlock, Quality, RESULT_SCHEMA_V2, RunProvenance,
    };

    fn sample(page_id: &str, status: OcrStatus, sha: Option<&str>, text: &str) -> OcrResult {
        OcrResult {
            schema: RESULT_SCHEMA_V2.into(),
            page_id: page_id.into(),
            image: ImageIdentity {
                path: PathBuf::from(format!("{page_id}.jpg")),
                sha256: sha.map(ToOwned::to_owned),
                media_type: Some("image/jpeg".into()),
            },
            attempts: vec![Attempt {
                run: RunProvenance {
                    model_id: "ppocr-v5-mobile".into(),
                    backend: "onnx-runtime".into(),
                    provider: Some("cpu".into()),
                    model_digest: None,
                    prompt_digest: None,
                },
                status: AttemptStatus::Completed,
                elapsed_ms: 12,
                quality: Quality::default(),
                error: None,
            }],
            status,
            markdown: None,
            blocks: vec![OcrBlock {
                text: text.into(),
                polygon: Some([[0.0, 0.0], [1.0, 0.0], [1.0, 1.0], [0.0, 1.0]]),
                confidence: Some(0.9),
                role: Some("text".into()),
            }],
            quality: Quality { mean_confidence: Some(0.9), reasons: Vec::new() },
            raw: None,
        }
    }

    #[test]
    fn deposit_is_idempotent_for_the_same_bytes() {
        let mut store = OcrStore::in_memory().unwrap();
        let first = store.deposit(&sample("p1", OcrStatus::Text, Some("abc"), "hello"), None);
        assert_eq!(first.unwrap(), DepositReport { inserted: 1, replaced: 0 });

        let again = store.deposit(&sample("p1", OcrStatus::Text, Some("abc"), "hello again"), None);
        assert_eq!(again.unwrap(), DepositReport { inserted: 0, replaced: 1 });

        assert_eq!(store.stats().unwrap().total(), 1);
        let stored = store.record("p1", Some("abc")).unwrap().unwrap();
        assert_eq!(stored.blocks[0].text, "hello again");
    }

    #[test]
    fn a_replaced_image_keeps_both_reads() {
        let mut store = OcrStore::in_memory().unwrap();
        store.deposit(&sample("p1", OcrStatus::Text, Some("abc"), "old"), None).unwrap();
        store.deposit(&sample("p1", OcrStatus::Text, Some("def"), "new"), None).unwrap();
        assert_eq!(store.stats().unwrap().total(), 2);
        assert!(store.contains("p1", Some("abc")).unwrap());
        assert!(!store.contains("p1", Some("zzz")).unwrap());
    }

    #[test]
    fn every_status_is_stored_not_only_depositable_ones() {
        let mut store = OcrStore::in_memory().unwrap();
        store
            .deposit_all(
                &[
                    sample("a", OcrStatus::Text, None, "a"),
                    sample("b", OcrStatus::NoText, None, ""),
                    sample("c", OcrStatus::Unreadable, None, ""),
                    sample("d", OcrStatus::NeedsReview, None, "d"),
                    sample("e", OcrStatus::ProcessingError, None, ""),
                ],
                Some("lot-001.jsonl"),
            )
            .unwrap();
        let stats = store.stats().unwrap();
        assert_eq!(stats.total(), 5);
        assert_eq!(stats.depositable(), 1);
        assert_eq!(stats.processing_error, 1);

        let review = store.list(&ListFilter::default().status(OcrStatus::NeedsReview)).unwrap();
        assert_eq!(review.len(), 1);
        assert_eq!(review[0].page_id, "d");
        assert_eq!(review[0].source.as_deref(), Some("lot-001.jsonl"));
    }

    #[test]
    fn profile_stores_open_distinct_corpus_files() {
        let temp = tempfile::tempdir().unwrap();
        let left_context = aphrody_agent_home::ProfileServiceContext::new(
            temp.path().join("workspace-left"),
            Some("left"),
        );
        let right_context = aphrody_agent_home::ProfileServiceContext::new(
            temp.path().join("workspace-right"),
            Some("right"),
        );
        let mut left = OcrStore::open_profile(&left_context).unwrap();
        let right = OcrStore::open_profile(&right_context).unwrap();

        left.deposit(&sample("left-page", OcrStatus::Text, Some("abc"), "left"), None).unwrap();
        assert_eq!(left.stats().unwrap().total(), 1);
        assert_eq!(right.stats().unwrap().total(), 0);
        assert_ne!(left.path(), right.path());
    }

    #[test]
    fn blocks_do_not_survive_a_second_read() {
        let mut store = OcrStore::in_memory().unwrap();
        store.deposit(&sample("p1", OcrStatus::Text, Some("abc"), "one"), None).unwrap();
        let mut second = sample("p1", OcrStatus::NoText, Some("abc"), "");
        second.blocks.clear();
        store.deposit(&second, None).unwrap();
        let count: i64 = store
            .conn
            .query_row("SELECT COUNT(*) FROM ocr_blocks WHERE page_id = 'p1'", [], |row| row.get(0))
            .unwrap();
        assert_eq!(count, 0);
    }
}
