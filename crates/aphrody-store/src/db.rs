// SPDX-License-Identifier: Apache-2.0
//! The home database handle: open policy, migrations, integrity.

use std::path::{Path, PathBuf};

use aphrody_sql::{
    migrate::{MigrateOptions, MigrationSet, migrate_sqlite},
    sqlite::{self, OpenPolicy},
};
use rusqlite::Connection;

use crate::{
    error::{Result, StoreError},
    layout::HomeLayout,
};

/// Embedded migrations of the home database, in version order.
///
/// Applied migrations are immutable (checksummed); schema changes are new files.
///
/// # Errors
///
/// [`StoreError::Sql`] when an embedded file name is malformed (a build-time bug).
pub fn migrations() -> Result<MigrationSet> {
    Ok(aphrody_sql::embed_migrations!(
        "../migrations/0001_rag_baseline.sql",
        "../migrations/0002_home_core.sql",
        "../migrations/0003_code_graph.sql",
        "../migrations/0004_memories.sql",
        "../migrations/0005_sessions.sql",
        "../migrations/0006_training.sql",
        "../migrations/0007_graph_file_cache.sql",
    )?)
}

fn policy() -> OpenPolicy {
    let policy = OpenPolicy::read_write();
    #[cfg(feature = "vec")]
    let policy = policy.with_vec();
    policy
}

/// One open connection to a home database, fully migrated.
pub struct HomeDb {
    pub(crate) conn: Connection,
    path: Option<PathBuf>,
}

impl std::fmt::Debug for HomeDb {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("HomeDb")
            .field("path", &self.path)
            .finish_non_exhaustive()
    }
}

impl HomeDb {
    /// Open (creating when missing) the database of a resolved layout and migrate it.
    ///
    /// # Errors
    ///
    /// Open, migration or checksum failures.
    pub fn open(layout: &HomeLayout) -> Result<Self> {
        Self::open_path(&layout.db_path)
    }

    /// Open (creating when missing) the database at `path` and migrate it.
    ///
    /// An existing RAG database (tables `docs`, `chunks`, `vectors`, `meta` and no migration
    /// ledger) upgrades in place: the baseline migration is a no-op on its tables.
    ///
    /// # Errors
    ///
    /// Open, migration or checksum failures.
    pub fn open_path(path: impl AsRef<Path>) -> Result<Self> {
        let path = path.as_ref();
        let mut conn = sqlite::open(path, policy())?;
        migrate_sqlite(&mut conn, &migrations()?, &MigrateOptions::default())?;
        Ok(Self {
            conn,
            path: Some(path.to_path_buf()),
        })
    }

    /// Open a transient in-memory database, migrated (tests, dry runs).
    ///
    /// # Errors
    ///
    /// Open or migration failures.
    pub fn open_in_memory() -> Result<Self> {
        let mut conn = sqlite::open_in_memory(policy())?;
        migrate_sqlite(&mut conn, &migrations()?, &MigrateOptions::default())?;
        Ok(Self { conn, path: None })
    }

    /// Open an existing database read-only without migrating it (inspection, dry runs).
    ///
    /// # Errors
    ///
    /// [`StoreError::Sql`] when the file is missing or cannot be opened.
    pub fn open_read_only(path: impl AsRef<Path>) -> Result<Self> {
        let path = path.as_ref();
        let conn = sqlite::open(path, OpenPolicy::read_only())?;
        Ok(Self {
            conn,
            path: Some(path.to_path_buf()),
        })
    }

    /// The underlying connection.
    #[must_use]
    pub fn conn(&self) -> &Connection {
        &self.conn
    }

    /// The underlying connection, mutable (transactions).
    pub fn conn_mut(&mut self) -> &mut Connection {
        &mut self.conn
    }

    /// File path (`None` for an in-memory database).
    #[must_use]
    pub fn path(&self) -> Option<&Path> {
        self.path.as_deref()
    }

    /// Highest applied migration version (0 when none).
    ///
    /// # Errors
    ///
    /// SQLite failures.
    pub fn schema_version(&self) -> Result<u32> {
        let exists: bool = self.conn.query_row(
            "SELECT count(*) > 0 FROM sqlite_master WHERE type = 'table' AND name = ?1",
            [aphrody_sql::migrate::DEFAULT_TABLE],
            |row| row.get(0),
        )?;
        if !exists {
            return Ok(0);
        }
        let version: Option<i64> = self.conn.query_row(
            &format!(
                "SELECT max(version) FROM {}",
                aphrody_sql::migrate::DEFAULT_TABLE
            ),
            [],
            |row| row.get(0),
        )?;
        Ok(version.and_then(|v| u32::try_from(v).ok()).unwrap_or(0))
    }

    /// `PRAGMA integrity_check`; an error carries the first reported problem.
    ///
    /// # Errors
    ///
    /// [`StoreError::Integrity`] when SQLite reports anything but `ok`.
    pub fn integrity_check(&self) -> Result<()> {
        let result: String = self
            .conn
            .query_row("PRAGMA integrity_check", [], |row| row.get(0))?;
        if result == "ok" {
            Ok(())
        } else {
            Err(StoreError::Integrity(result))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const LEGACY_RAG_DDL: &str = "
        CREATE TABLE docs (id INTEGER PRIMARY KEY AUTOINCREMENT, path TEXT NOT NULL UNIQUE,
            hash TEXT NOT NULL, title TEXT, language TEXT, mtime_ms INTEGER NOT NULL,
            size_bytes INTEGER NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')));
        CREATE TABLE chunks (id INTEGER PRIMARY KEY AUTOINCREMENT,
            doc_id INTEGER NOT NULL REFERENCES docs(id) ON DELETE CASCADE,
            chunk_index INTEGER NOT NULL, heading TEXT, symbol TEXT, content TEXT NOT NULL,
            start_line INTEGER NOT NULL, end_line INTEGER NOT NULL, token_count INTEGER NOT NULL,
            created_at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE(doc_id, chunk_index));
        CREATE TABLE vectors (chunk_id INTEGER PRIMARY KEY REFERENCES chunks(id) ON DELETE CASCADE,
            model_id TEXT NOT NULL, dim INTEGER NOT NULL, quant TEXT NOT NULL DEFAULT 'f32',
            embedding BLOB NOT NULL);
        CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        INSERT INTO docs (path, hash, mtime_ms, size_bytes) VALUES ('a.rs', 'h1', 1, 10);
        INSERT INTO chunks (doc_id, chunk_index, content, start_line, end_line, token_count)
            VALUES (1, 0, 'fn main() {}', 1, 1, 4);
        INSERT INTO meta VALUES ('embedding_model', 'm');";

    #[test]
    fn migrations_are_valid_and_ordered() {
        let set = migrations().unwrap();
        assert_eq!(set.len(), 7);
        assert_eq!(set.latest_version(), Some(7));
    }

    #[test]
    fn opening_twice_is_idempotent_and_reaches_the_latest_version() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("db/aphrody.sqlite");
        let first = HomeDb::open_path(&path).unwrap();
        assert_eq!(first.schema_version().unwrap(), 7);
        drop(first);
        let second = HomeDb::open_path(&path).unwrap();
        assert_eq!(second.schema_version().unwrap(), 7);
        second.integrity_check().unwrap();
        let mode: String = second
            .conn()
            .pragma_query_value(None, "journal_mode", |r| r.get(0))
            .unwrap();
        assert_eq!(mode, "wal");
    }

    #[test]
    fn a_legacy_rag_database_upgrades_in_place_without_losing_rows() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("rag.sqlite");
        {
            let legacy = Connection::open(&path).unwrap();
            legacy.execute_batch(LEGACY_RAG_DDL).unwrap();
        }
        let db = HomeDb::open_path(&path).unwrap();
        let (docs, chunks): (i64, i64) = db
            .conn()
            .query_row(
                "SELECT (SELECT count(*) FROM docs), (SELECT count(*) FROM chunks)",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!((docs, chunks), (1, 1));
        // The new column exists and is NULL for the pre-existing document.
        let source: Option<i64> = db
            .conn()
            .query_row("SELECT source_id FROM docs WHERE path = 'a.rs'", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(source, None);
        assert_eq!(db.schema_version().unwrap(), 7);
    }

    #[test]
    fn a_modified_applied_migration_is_rejected() {
        let mut db = HomeDb::open_in_memory().unwrap();
        db.conn_mut()
            .execute(
                "UPDATE aphrody_migrations SET sha256 = ?1 WHERE version = 1",
                ["0".repeat(64)],
            )
            .unwrap();
        let result = migrate_sqlite(
            db.conn_mut(),
            &migrations().unwrap(),
            &MigrateOptions::default(),
        );
        assert!(result.is_err());
    }

    #[test]
    fn read_only_open_does_not_create_or_migrate() {
        let dir = tempfile::tempdir().unwrap();
        assert!(HomeDb::open_read_only(dir.path().join("missing.sqlite")).is_err());
    }
}
