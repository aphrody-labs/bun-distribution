// SPDX-License-Identifier: Apache-2.0
//! Substring path index: `files(path, size, modified)` plus an FTS5 trigram table over the paths.
//!
//! Unlike [`crate::FsIndex`] (word-prefix search, upserts in place), a [`PathIndex`] is rebuilt as
//! a whole from an entry iterator: the database is written beside the target as
//! `<name>.sqlite.partial` and renamed into place, so readers never see a half-built index. The
//! caller owns the walk (for example an `ignore` walk that honours `.gitignore`).

use std::{
    fs, io,
    path::{Path, PathBuf},
};

use rusqlite::{Connection, OpenFlags, types::Value};
use serde::{Deserialize, Serialize};

use crate::FsIndexError;

/// One indexed file.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct PathHit {
    /// Path as given at build time (the unique key).
    pub path: String,
    /// Size in bytes.
    pub size: u64,
    /// Last-modified time as a unix timestamp (seconds), or 0 if unavailable.
    pub modified: u64,
}

/// A path index stored in one SQLite file.
#[derive(Debug, Clone)]
pub struct PathIndex {
    path: PathBuf,
}

fn io_error<'a>(
    action: &'static str,
    path: &'a Path,
) -> impl FnOnce(io::Error) -> FsIndexError + 'a {
    move |source| FsIndexError::Io { action, path: path.to_path_buf(), source }
}

impl PathIndex {
    /// Refers to the index at `path`; nothing is opened until a method needs it.
    #[must_use]
    pub fn open(path: impl AsRef<Path>) -> Self {
        Self { path: path.as_ref().to_path_buf() }
    }

    /// Location of the database file.
    #[must_use]
    pub fn path(&self) -> &Path {
        &self.path
    }

    fn create(path: &Path) -> Result<Connection, FsIndexError> {
        let _ = fs::remove_file(path);
        let db = Connection::open(path)
            .map_err(|source| FsIndexError::Open { path: path.to_path_buf(), source })?;
        db.execute_batch(
            "PRAGMA journal_mode = OFF;
             PRAGMA synchronous = OFF;
             CREATE TABLE files (path TEXT PRIMARY KEY, size INTEGER NOT NULL, modified INTEGER NOT NULL);
             CREATE VIRTUAL TABLE files_fts USING fts5(path, content = 'files', tokenize = 'trigram');",
        )?;
        Ok(db)
    }

    /// Replaces the index with `entries` (a later duplicate path wins). Returns the number of
    /// entries written.
    ///
    /// # Errors
    ///
    /// [`FsIndexError::Open`] / [`FsIndexError::Sqlite`] on a database failure,
    /// [`FsIndexError::Io`] if the finished database cannot be moved into place.
    pub fn write(&self, entries: impl IntoIterator<Item = PathHit>) -> Result<usize, FsIndexError> {
        let partial = self.path.with_extension("sqlite.partial");
        let mut db = Self::create(&partial)?;
        let tx = db.transaction()?;
        let mut count = 0;
        {
            let mut insert = tx.prepare(
                "INSERT OR REPLACE INTO files (path, size, modified) VALUES (?1, ?2, ?3)",
            )?;
            for hit in entries {
                insert.execute(rusqlite::params![
                    hit.path,
                    i64::try_from(hit.size).unwrap_or(i64::MAX),
                    i64::try_from(hit.modified).unwrap_or(i64::MAX)
                ])?;
                count += 1;
            }
        }
        tx.execute("INSERT INTO files_fts (files_fts) VALUES ('rebuild')", [])?;
        tx.commit()?;
        drop(db);
        fs::rename(&partial, &self.path)
            .map_err(io_error("cannot move filesystem index into place", &self.path))?;
        Ok(count)
    }

    /// Imports a `path\tsize\tmtime` text index (one entry per line, malformed lines skipped) into
    /// this database, then removes the text file. Returns the imported entry count.
    ///
    /// # Errors
    ///
    /// [`FsIndexError::Io`] if `legacy` cannot be read or removed; see [`Self::write`].
    pub fn import_legacy(&self, legacy: &Path) -> Result<usize, FsIndexError> {
        let content =
            fs::read_to_string(legacy).map_err(io_error("cannot read filesystem index", legacy))?;
        let entries: Vec<PathHit> = content
            .lines()
            .filter_map(|line| {
                let mut fields = line.rsplitn(3, '\t');
                let modified = fields.next()?.parse().ok()?;
                let size = fields.next()?.parse().ok()?;
                Some(PathHit { path: fields.next()?.to_owned(), size, modified })
            })
            .collect();
        let count = self.write(entries)?;
        fs::remove_file(legacy).map_err(io_error("cannot remove filesystem index", legacy))?;
        Ok(count)
    }

    fn connect(&self) -> Result<Connection, FsIndexError> {
        Connection::open_with_flags(&self.path, OpenFlags::SQLITE_OPEN_READ_ONLY)
            .map_err(|source| FsIndexError::Open { path: self.path.clone(), source })
    }

    /// Paths containing every whitespace-separated word of `query`, case-insensitively, shortest
    /// first: words of three characters or more go through the FTS5 trigram index, shorter ones
    /// through an escaped `LIKE`.
    ///
    /// # Errors
    ///
    /// [`FsIndexError::EmptyQuery`] if `query` has no words; [`FsIndexError::Open`] /
    /// [`FsIndexError::Sqlite`] on a database failure.
    pub fn search(&self, query: &str, limit: usize) -> Result<Vec<PathHit>, FsIndexError> {
        let words: Vec<String> = query.split_whitespace().map(str::to_lowercase).collect();
        if words.is_empty() {
            return Err(FsIndexError::EmptyQuery);
        }
        let (long, short): (Vec<&String>, Vec<&String>) =
            words.iter().partition(|word| word.chars().count() >= 3);
        let mut sql = String::from("SELECT f.path, f.size, f.modified FROM files f");
        let mut params: Vec<String> = Vec::new();
        let mut filters: Vec<String> = Vec::new();
        if !long.is_empty() {
            sql.push_str(" JOIN files_fts ON files_fts.rowid = f.rowid");
            filters.push("files_fts MATCH ?".into());
            params.push(
                long.iter()
                    .map(|word| format!("\"{}\"", word.replace('"', "\"\"")))
                    .collect::<Vec<_>>()
                    .join(" AND "),
            );
        }
        for word in short {
            filters.push("lower(f.path) LIKE ? ESCAPE '!'".into());
            let escaped = word.replace('!', "!!").replace('%', "!%").replace('_', "!_");
            params.push(format!("%{escaped}%"));
        }
        sql.push_str(" WHERE ");
        sql.push_str(&filters.join(" AND "));
        sql.push_str(" ORDER BY length(f.path), f.path LIMIT ?");
        let db = self.connect()?;
        let mut statement = db.prepare(&sql)?;
        let mut values: Vec<Value> = params.into_iter().map(Value::Text).collect();
        values.push(Value::Integer(i64::try_from(limit).unwrap_or(i64::MAX)));
        let rows = statement.query_map(rusqlite::params_from_iter(values), |row| {
            Ok(PathHit {
                path: row.get(0)?,
                size: u64::try_from(row.get::<_, i64>(1)?).unwrap_or_default(),
                modified: u64::try_from(row.get::<_, i64>(2)?).unwrap_or_default(),
            })
        })?;
        Ok(rows.collect::<rusqlite::Result<_>>()?)
    }

    /// Number of indexed paths.
    ///
    /// # Errors
    ///
    /// [`FsIndexError::Open`] / [`FsIndexError::Sqlite`] on a database failure.
    pub fn len(&self) -> Result<usize, FsIndexError> {
        let count: i64 =
            self.connect()?.query_row("SELECT count(*) FROM files", [], |r| r.get(0))?;
        Ok(usize::try_from(count).unwrap_or_default())
    }

    /// True when the index holds no paths.
    ///
    /// # Errors
    ///
    /// See [`Self::len`].
    pub fn is_empty(&self) -> Result<bool, FsIndexError> {
        Ok(self.len()? == 0)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn hit(path: &str, size: u64, modified: u64) -> PathHit {
        PathHit { path: path.to_owned(), size, modified }
    }

    fn found(index: &PathIndex, query: &str) -> Vec<String> {
        index.search(query, 10).unwrap().into_iter().map(|hit| hit.path).collect()
    }

    #[test]
    fn search_matches_every_word_as_a_substring() {
        let dir = tempfile::tempdir().unwrap();
        let index = PathIndex::open(dir.path().join("fsindex.sqlite"));
        let entries = [
            hit("repo/src/http/client.rs", 1, 9),
            hit("repo/src/http/server.rs", 1, 9),
            hit("repo/docs/http.md", 1, 9),
            hit("repo/.github/workflows/ci.yml", 1, 9),
            hit("repo/100%_done.txt", 1, 9),
        ];
        assert_eq!(index.write(entries).unwrap(), 5);
        assert!(!dir.path().join("fsindex.sqlite.partial").exists());
        assert_eq!(index.len().unwrap(), 5);
        assert!(!index.is_empty().unwrap());

        assert_eq!(found(&index, "HTTP client"), ["repo/src/http/client.rs"]);
        assert_eq!(
            found(&index, "http"),
            ["repo/docs/http.md", "repo/src/http/client.rs", "repo/src/http/server.rs"]
        );
        assert_eq!(found(&index, "workflows"), ["repo/.github/workflows/ci.yml"]);
        assert_eq!(found(&index, "ci yml"), ["repo/.github/workflows/ci.yml"]);
        assert!(found(&index, "rs 100%").is_empty());
        assert_eq!(found(&index, "0%"), ["repo/100%_done.txt"]);
        assert_eq!(found(&index, "%_"), ["repo/100%_done.txt"]);
        assert!(found(&index, "\"quoted\"").is_empty());
        assert!(matches!(index.search("  ", 10), Err(FsIndexError::EmptyQuery)));
        assert_eq!(index.search("http", 2).unwrap().len(), 2);
        assert!(index.search("http", 10).unwrap().iter().all(|h| h.size == 1 && h.modified == 9));
    }

    #[test]
    fn write_replaces_the_previous_index() {
        let dir = tempfile::tempdir().unwrap();
        let index = PathIndex::open(dir.path().join("fsindex.sqlite"));
        index.write([hit("old/a.rs", 1, 1), hit("old/b.rs", 1, 1)]).unwrap();
        assert_eq!(index.write([hit("new/a.rs", 2, 2), hit("new/a.rs", 3, 3)]).unwrap(), 2);
        assert_eq!(index.len().unwrap(), 1);
        assert!(found(&index, "old").is_empty());
        assert_eq!(index.search("a.rs", 5).unwrap(), [hit("new/a.rs", 3, 3)]);
    }

    #[test]
    fn legacy_text_index_is_imported_then_removed() {
        let dir = tempfile::tempdir().unwrap();
        let legacy = dir.path().join("fsindex.tsv");
        fs::write(&legacy, "C:\\repo\\src\\Lib.rs\t42\t7\nbroken line\n").unwrap();
        let index = PathIndex::open(dir.path().join("fsindex.sqlite"));
        assert_eq!(index.import_legacy(&legacy).unwrap(), 1);
        assert!(!legacy.exists());
        let hits = index.search("lib.RS", 5).unwrap();
        assert_eq!(hits, [hit("C:\\repo\\src\\Lib.rs", 42, 7)]);
        assert!(matches!(index.import_legacy(&legacy), Err(FsIndexError::Io { .. })));
    }

    #[test]
    fn a_missing_index_fails_to_open() {
        let dir = tempfile::tempdir().unwrap();
        let index = PathIndex::open(dir.path().join("absent.sqlite"));
        assert!(matches!(index.len(), Err(FsIndexError::Open { .. })));
    }
}
