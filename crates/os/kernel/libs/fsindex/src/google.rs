// SPDX-License-Identifier: Apache-2.0
//! Read-only adapter for the Google desktop companion app's `local_files.db`.
//!
//! Exposes full-text search (SQLite FTS5) over the user's
//! local filesystem pre-indexed by the Google Windows App (WGA).
//! Metadata-only, privacy-bounded, opened strictly in read-only mode (`PRAGMA query_only = ON;`).

use std::path::{Path, PathBuf};

use rusqlite::{Connection, OpenFlags};
use serde::{Deserialize, Serialize};

use crate::FsIndexError;

/// An indexed file entry from Google's `local_files.db`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct GoogleFileHit {
    /// Absolute file path.
    pub path: String,
    /// Parent directory path.
    pub parent_path: String,
    /// File name component.
    pub filename: String,
    /// Extension (including dot, e.g. ".rs", or empty).
    pub extension: String,
    /// True if entry is a directory.
    pub is_dir: bool,
    /// Last modified timestamp (milliseconds since Unix epoch).
    pub last_modified: i64,
}

/// Read-only accessor for Google's `local_files.db`.
pub struct GoogleFilesDb {
    conn: Connection,
}

impl GoogleFilesDb {
    /// Open an existing `local_files.db` in strict read-only mode.
    ///
    /// # Errors
    ///
    /// [`FsIndexError::Sqlite`] if the database cannot be opened or configured.
    pub fn open(path: impl AsRef<Path>) -> Result<Self, FsIndexError> {
        let conn = Connection::open_with_flags(
            path,
            OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
        )?;
        conn.execute_batch("PRAGMA query_only = ON;")?;
        Ok(Self { conn })
    }

    /// Open an in-memory database with Google's WGA schema (for testing).
    ///
    /// # Errors
    ///
    /// [`FsIndexError::Sqlite`] on failure.
    pub fn open_in_memory() -> Result<Self, FsIndexError> {
        let conn = Connection::open_in_memory()?;
        conn.execute_batch(
            "CREATE TABLE local_files (
                file_id            INTEGER PRIMARY KEY AUTOINCREMENT,
                file_path          TEXT UNIQUE COLLATE NOCASE,
                parent_path        TEXT,
                filename           TEXT,
                extension          TEXT,
                is_directory       INTEGER,
                is_users_directory INTEGER,
                last_modified      INTEGER
            );
            CREATE INDEX idx_parent_path ON local_files(parent_path);
            CREATE VIRTUAL TABLE local_files_fts USING fts5(
                filename, file_path, content='local_files', content_rowid='file_id'
            );
            CREATE TRIGGER trg_local_files_ai AFTER INSERT ON local_files BEGIN
                INSERT INTO local_files_fts(rowid, filename, file_path)
                VALUES (new.file_id, new.filename, new.file_path);
            END;",
        )?;
        Ok(Self { conn })
    }

    /// Default path to Google's `local_files.db` on Windows:
    /// `%LOCALAPPDATA%\Google\Google\local_files.db`.
    #[must_use]
    pub fn default_path() -> Option<PathBuf> {
        let local_app_data = std::env::var_os("LOCALAPPDATA")?;
        let p = PathBuf::from(local_app_data).join("Google").join("Google").join("local_files.db");
        if p.exists() { Some(p) } else { None }
    }

    /// Fast count of indexed files. Reads `sqlite_sequence` in O(1),
    /// with fallback to `SELECT count(*)`.
    ///
    /// # Errors
    ///
    /// [`FsIndexError::Sqlite`] on database failure.
    pub fn len(&self) -> Result<usize, FsIndexError> {
        let seq: Result<i64, _> = self.conn.query_row(
            "SELECT seq FROM sqlite_sequence WHERE name = 'local_files'",
            [],
            |r| r.get(0),
        );
        if let Ok(n) = seq {
            return Ok(usize::try_from(n).unwrap_or(0));
        }
        let count: i64 =
            self.conn.query_row("SELECT count(*) FROM local_files", [], |r| r.get(0))?;
        Ok(usize::try_from(count).unwrap_or(0))
    }

    /// True if index contains no rows.
    ///
    /// # Errors
    ///
    /// [`FsIndexError::Sqlite`] on failure.
    pub fn is_empty(&self) -> Result<bool, FsIndexError> {
        Ok(self.len()? == 0)
    }

    /// Perform a full-text search against Google's `local_files_fts` table.
    ///
    /// # Errors
    ///
    /// [`FsIndexError::EmptyQuery`] if query contains no alphanumeric terms;
    /// [`FsIndexError::Sqlite`] on database failure.
    pub fn search(&self, query: &str, limit: usize) -> Result<Vec<GoogleFileHit>, FsIndexError> {
        let cleaned: String = query
            .chars()
            .filter(|c| c.is_alphanumeric() || *c == '_' || *c == '.' || *c == '-')
            .collect();
        if cleaned.is_empty() {
            return Err(FsIndexError::EmptyQuery);
        }
        let fts_query = format!("\"{cleaned}\"*");
        let mut stmt = self.conn.prepare(
            "SELECT f.file_path, f.parent_path, f.filename, f.extension, f.is_directory, \
             f.last_modified
             FROM local_files_fts
             JOIN local_files f ON f.file_id = local_files_fts.rowid
             WHERE local_files_fts MATCH ?1
             LIMIT ?2",
        )?;

        let rows = stmt.query_map(rusqlite::params![fts_query, limit as i64], |row| {
            let is_dir_int: i32 = row.get(4)?;
            Ok(GoogleFileHit {
                path: row.get(0)?,
                parent_path: row.get(1)?,
                filename: row.get(2)?,
                extension: row.get(3)?,
                is_dir: is_dir_int != 0,
                last_modified: row.get(5)?,
            })
        })?;

        let mut hits = Vec::new();
        for r in rows {
            hits.push(r?);
        }
        Ok(hits)
    }

    /// Direct insertion helper for test setups.
    #[cfg(test)]
    pub fn insert_test_entry(
        &self,
        path: &str,
        parent: &str,
        name: &str,
        ext: &str,
        is_dir: bool,
        mtime: i64,
    ) -> Result<(), FsIndexError> {
        self.conn.execute(
            "INSERT INTO local_files (file_path, parent_path, filename, extension, is_directory, \
             is_users_directory, last_modified)
             VALUES (?1, ?2, ?3, ?4, ?5, 1, ?6)",
            rusqlite::params![path, parent, name, ext, i32::from(is_dir), mtime],
        )?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn google_in_memory_search_works() {
        let db = GoogleFilesDb::open_in_memory().expect("open in-memory");
        assert!(db.is_empty().expect("is_empty"));

        db.insert_test_entry(
            "C:\\Users\\user\\src\\main.rs",
            "C:\\Users\\user\\src",
            "main.rs",
            ".rs",
            false,
            1790000000000,
        )
        .expect("insert");

        db.insert_test_entry(
            "C:\\Users\\user\\docs\\readme.md",
            "C:\\Users\\user\\docs",
            "readme.md",
            ".md",
            false,
            1790000000000,
        )
        .expect("insert");

        assert_eq!(db.len().expect("len"), 2); // 2 inserted entries

        let hits = db.search("main", 10).expect("search main");
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].filename, "main.rs");
        assert_eq!(hits[0].extension, ".rs");
        assert!(!hits[0].is_dir);

        let hits_md = db.search("readme", 10).expect("search readme");
        assert_eq!(hits_md.len(), 1);
        assert_eq!(hits_md[0].filename, "readme.md");

        assert!(matches!(db.search("   ", 10), Err(FsIndexError::EmptyQuery)));
    }

    #[test]
    fn live_google_db_if_available() {
        if let Some(path) = GoogleFilesDb::default_path() {
            let db = GoogleFilesDb::open(path).expect("open live google db");
            let count = db.len().expect("get length");
            assert!(count > 1000, "live google db should hold indexed files");
            let hits = db.search("Cargo", 5).expect("search live db");
            assert!(!hits.is_empty(), "searching Cargo should yield results");
        }
    }
}
