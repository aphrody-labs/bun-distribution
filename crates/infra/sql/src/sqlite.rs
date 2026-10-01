// SPDX-License-Identifier: Apache-2.0

//! SQLite open policy (ADR D5) on top of bundled `rusqlite`.
//!
//! [`open`] applies, in this order: `busy_timeout=5000`, `journal_mode=WAL`,
//! `synchronous=NORMAL`, `foreign_keys=ON`, `temp_store=MEMORY` and
//! `PRAGMA optimize=0x10002` (check-and-analyse on open). Read-only
//! connections skip the pragmas that write (`journal_mode`, `optimize`).
//!
//! Only engines at 3.51.3 or later may write WAL databases (WAL-reset fix):
//! the bundled 3.53 qualifies; do not write them with an older system `sqlite3`.
//!
//! The optional `vec0` virtual table (sqlite-vec, feature `vec`) is registered
//! once per process as an auto extension, so every connection opened *after*
//! [`register_vec_extension`] has it.

use std::{path::Path, time::Duration};

pub use rusqlite;
use rusqlite::{Connection, OpenFlags};

use crate::error::{Result, SqlError};

/// `PRAGMA synchronous` level.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum Synchronous {
    /// `OFF`: no fsync (data loss on power failure).
    Off,
    /// `NORMAL`: the WAL-mode default of this policy.
    #[default]
    Normal,
    /// `FULL`.
    Full,
}

impl Synchronous {
    const fn as_sql(self) -> &'static str {
        match self {
            Self::Off => "OFF",
            Self::Normal => "NORMAL",
            Self::Full => "FULL",
        }
    }
}

/// Settings applied when a connection is opened.
#[derive(Debug, Clone)]
pub struct OpenPolicy {
    /// Open read-only (never creates the file, skips the writing pragmas).
    pub read_only: bool,
    /// Create the database file when missing (ignored when `read_only`).
    pub create: bool,
    /// Create missing parent directories (ignored when `read_only`).
    pub create_parent_dirs: bool,
    /// `journal_mode=WAL`.
    pub wal: bool,
    /// `synchronous` level.
    pub synchronous: Synchronous,
    /// `busy_timeout`.
    pub busy_timeout: Duration,
    /// `foreign_keys=ON`.
    pub foreign_keys: bool,
    /// `temp_store=MEMORY`.
    pub temp_store_memory: bool,
    /// `PRAGMA optimize=0x10002` on open.
    pub optimize_on_open: bool,
    /// Register and verify sqlite-vec (`vec0`); needs the `vec` feature.
    pub vec: bool,
}

impl Default for OpenPolicy {
    fn default() -> Self {
        Self::read_write()
    }
}

impl OpenPolicy {
    /// Read-write, create if missing, the full pragma set.
    #[must_use]
    pub fn read_write() -> Self {
        Self {
            read_only: false,
            create: true,
            create_parent_dirs: true,
            wal: true,
            synchronous: Synchronous::Normal,
            busy_timeout: Duration::from_millis(5000),
            foreign_keys: true,
            temp_store_memory: true,
            optimize_on_open: true,
            vec: false,
        }
    }

    /// Read-only reader connection (for scans that must not block the writer).
    #[must_use]
    pub fn read_only() -> Self {
        Self {
            read_only: true,
            create: false,
            create_parent_dirs: false,
            optimize_on_open: false,
            ..Self::read_write()
        }
    }

    /// Also register sqlite-vec (`vec0`).
    #[must_use]
    pub fn with_vec(mut self) -> Self {
        self.vec = true;
        self
    }

    /// Override `busy_timeout`.
    #[must_use]
    pub fn with_busy_timeout(mut self, timeout: Duration) -> Self {
        self.busy_timeout = timeout;
        self
    }

    /// Fail instead of creating a missing database file.
    #[must_use]
    pub fn without_create(mut self) -> Self {
        self.create = false;
        self
    }
}

/// Open `path` with `policy`.
///
/// # Errors
///
/// [`SqlError::Sqlite`] when the file cannot be opened or a pragma fails,
/// [`SqlError::Io`] when parent directories cannot be created,
/// [`SqlError::Extension`] / [`SqlError::FeatureDisabled`] for `policy.vec`.
pub fn open(path: impl AsRef<Path>, policy: OpenPolicy) -> Result<Connection> {
    let path = path.as_ref();
    if policy.vec {
        register_vec_extension()?;
    }
    if policy.create_parent_dirs
        && !policy.read_only
        && let Some(parent) = path.parent().filter(|parent| !parent.as_os_str().is_empty())
    {
        std::fs::create_dir_all(parent)?;
    }
    let mut flags = OpenFlags::default();
    if policy.read_only {
        flags.remove(OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_CREATE);
        flags.insert(OpenFlags::SQLITE_OPEN_READ_ONLY);
    } else if !policy.create {
        flags.remove(OpenFlags::SQLITE_OPEN_CREATE);
    }
    let conn = Connection::open_with_flags(path, flags)?;
    apply_policy(&conn, &policy)?;
    Ok(conn)
}

/// Open a private in-memory database with `policy`. WAL and `optimize` do not
/// apply to memory databases and are skipped.
///
/// # Errors
///
/// See [`open`].
pub fn open_in_memory(policy: OpenPolicy) -> Result<Connection> {
    if policy.vec {
        register_vec_extension()?;
    }
    let conn = Connection::open_in_memory()?;
    apply_policy(&conn, &OpenPolicy { wal: false, optimize_on_open: false, ..policy })?;
    Ok(conn)
}

/// Apply `policy` to an already-open connection (for callers that must open
/// with their own flags). sqlite-vec must be registered *before* the
/// connection was opened.
///
/// # Errors
///
/// [`SqlError::Sqlite`] when a pragma fails, [`SqlError::Extension`] when
/// `policy.vec` is set but `vec0` is missing on this connection.
pub fn apply_policy(conn: &Connection, policy: &OpenPolicy) -> Result<()> {
    conn.busy_timeout(policy.busy_timeout)?;
    if policy.wal && !policy.read_only {
        let mode: String =
            conn.pragma_update_and_check(None, "journal_mode", "WAL", |row| row.get(0))?;
        if !mode.eq_ignore_ascii_case("wal") && !mode.eq_ignore_ascii_case("memory") {
            tracing::warn!(journal_mode = %mode, "SQLite refused WAL mode");
        }
    }
    conn.execute_batch(&format!("PRAGMA synchronous = {};", policy.synchronous.as_sql()))?;
    if policy.foreign_keys {
        conn.execute_batch("PRAGMA foreign_keys = ON;")?;
    }
    if policy.temp_store_memory {
        conn.execute_batch("PRAGMA temp_store = MEMORY;")?;
    }
    if policy.optimize_on_open && !policy.read_only {
        conn.execute_batch("PRAGMA optimize=0x10002;")?;
    }
    if policy.vec {
        conn.query_row("SELECT vec_version()", [], |row| row.get::<_, String>(0)).map_err(|e| {
            SqlError::Extension(format!("sqlite-vec is not loaded on this connection: {e}"))
        })?;
    }
    Ok(())
}

/// Run `PRAGMA optimize` (call before closing a long-lived connection).
///
/// # Errors
///
/// [`SqlError::Sqlite`].
pub fn optimize(conn: &Connection) -> Result<()> {
    conn.execute_batch("PRAGMA optimize;")?;
    Ok(())
}

/// Consistent online backup with `VACUUM INTO`: written to `<backup>.partial`
/// then renamed, so a crash never leaves a truncated backup under the final
/// name. Refuses to overwrite an existing file.
///
/// # Errors
///
/// [`SqlError::BackupExists`], [`SqlError::Io`] or [`SqlError::Sqlite`].
pub fn vacuum_into(conn: &Connection, backup_path: impl AsRef<Path>) -> Result<()> {
    let backup = backup_path.as_ref();
    if backup.exists() {
        return Err(SqlError::BackupExists(backup.display().to_string()));
    }
    if let Some(parent) = backup.parent().filter(|parent| !parent.as_os_str().is_empty()) {
        std::fs::create_dir_all(parent)?;
    }
    let mut partial = backup.as_os_str().to_owned();
    partial.push(".partial");
    let partial = std::path::PathBuf::from(partial);
    if partial.exists() {
        std::fs::remove_file(&partial)?;
    }
    let target = partial.to_str().ok_or_else(|| {
        SqlError::Io(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "backup path is not valid UTF-8",
        ))
    })?;
    if let Err(error) = conn.execute("VACUUM INTO ?1", [target]) {
        let _ = std::fs::remove_file(&partial);
        return Err(error.into());
    }
    std::fs::rename(&partial, backup)?;
    Ok(())
}

/// Result of `PRAGMA wal_checkpoint(TRUNCATE)`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Checkpoint {
    /// A reader or writer prevented the checkpoint from completing.
    pub busy: bool,
    /// Frames in the WAL (`-1` outside WAL mode).
    pub log_frames: i64,
    /// Frames moved into the database file (`-1` outside WAL mode).
    pub checkpointed_frames: i64,
}

/// Checkpoint the WAL into the database file and truncate it (after bulk
/// indexing, before a file copy).
///
/// # Errors
///
/// [`SqlError::Sqlite`].
pub fn checkpoint_truncate(conn: &Connection) -> Result<Checkpoint> {
    Ok(conn.query_row("PRAGMA wal_checkpoint(TRUNCATE)", [], |row| {
        Ok(Checkpoint {
            busy: row.get::<_, i64>(0)? != 0,
            log_frames: row.get(1)?,
            checkpointed_frames: row.get(2)?,
        })
    })?)
}

/// Register sqlite-vec (`vec0`, `vec_version()`, ...) as a SQLite auto
/// extension. Idempotent and process-wide; connections opened afterwards have
/// the extension.
///
/// # Errors
///
/// [`SqlError::Extension`] when SQLite rejects the registration,
/// [`SqlError::FeatureDisabled`] without the `vec` feature.
#[cfg(feature = "vec")]
pub fn register_vec_extension() -> Result<()> {
    use std::sync::OnceLock;

    use rusqlite::auto_extension::{RawAutoExtension, register_auto_extension};

    static REGISTERED: OnceLock<std::result::Result<(), String>> = OnceLock::new();
    REGISTERED
        .get_or_init(|| {
            // SAFETY: `sqlite3_vec_init` is the extension entry point exported by the
            // statically linked sqlite-vec (built with SQLITE_CORE) and has the
            // `sqlite3_auto_extension` signature even though its Rust declaration is
            // the empty `fn()` of the crate's `extern` block, as documented by
            // sqlite-vec's Rust guide. The registration happens once and the entry
            // point lives for the whole process.
            let entry = unsafe {
                std::mem::transmute::<*const (), RawAutoExtension>(
                    sqlite_vec::sqlite3_vec_init as *const (),
                )
            };
            // SAFETY: `entry` is a valid entry point (above) and registration is not
            // performed from inside another auto extension.
            unsafe { register_auto_extension(entry) }.map_err(|e| e.to_string())
        })
        .clone()
        .map_err(SqlError::Extension)
}

/// Register sqlite-vec; unavailable without the `vec` feature.
///
/// # Errors
///
/// Always [`SqlError::FeatureDisabled`].
#[cfg(not(feature = "vec"))]
pub fn register_vec_extension() -> Result<()> {
    Err(SqlError::FeatureDisabled("vec"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pragma_i64(conn: &Connection, name: &str) -> i64 {
        conn.pragma_query_value(None, name, |row| row.get(0)).unwrap()
    }

    #[test]
    fn file_policy_applies_every_pragma() {
        let dir = tempfile::tempdir().unwrap();
        let conn = open(dir.path().join("nested/db.sqlite"), OpenPolicy::read_write()).unwrap();
        let mode: String = conn.pragma_query_value(None, "journal_mode", |r| r.get(0)).unwrap();
        assert_eq!(mode, "wal");
        assert_eq!(pragma_i64(&conn, "foreign_keys"), 1);
        assert_eq!(pragma_i64(&conn, "busy_timeout"), 5000);
        assert_eq!(pragma_i64(&conn, "temp_store"), 2, "2 = MEMORY");
        assert_eq!(pragma_i64(&conn, "synchronous"), 1, "1 = NORMAL");
    }

    #[test]
    fn in_memory_policy_skips_wal_but_keeps_integrity_pragmas() {
        let conn = open_in_memory(OpenPolicy::read_write()).unwrap();
        assert_eq!(pragma_i64(&conn, "foreign_keys"), 1);
        assert_eq!(pragma_i64(&conn, "busy_timeout"), 5000);
    }

    #[test]
    fn read_only_reader_sees_writer_commits_and_cannot_write() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("db.sqlite");
        let writer = open(&path, OpenPolicy::read_write()).unwrap();
        writer.execute_batch("CREATE TABLE t(a INTEGER); INSERT INTO t VALUES (1);").unwrap();
        let reader = open(&path, OpenPolicy::read_only()).unwrap();
        assert_eq!(
            reader.query_row("SELECT count(*) FROM t", [], |r| r.get::<_, i64>(0)).unwrap(),
            1
        );
        writer.execute("INSERT INTO t VALUES (2)", []).unwrap();
        assert_eq!(
            reader.query_row("SELECT count(*) FROM t", [], |r| r.get::<_, i64>(0)).unwrap(),
            2
        );
        assert!(reader.execute("INSERT INTO t VALUES (3)", []).is_err());
    }

    #[test]
    fn missing_file_is_not_created_without_create() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("absent.sqlite");
        assert!(open(&path, OpenPolicy::read_write().without_create()).is_err());
        assert!(open(&path, OpenPolicy::read_only()).is_err());
        assert!(!path.exists());
    }

    #[test]
    fn vacuum_into_writes_a_consistent_copy_and_refuses_overwrite() {
        let dir = tempfile::tempdir().unwrap();
        let conn = open(dir.path().join("db.sqlite"), OpenPolicy::read_write()).unwrap();
        conn.execute_batch("CREATE TABLE t(a TEXT); INSERT INTO t VALUES ('x'), ('y');").unwrap();
        let backup = dir.path().join("backups/2026-10-01/db.sqlite");
        vacuum_into(&conn, &backup).unwrap();
        assert!(backup.is_file());
        assert!(!backup.with_extension("sqlite.partial").exists());
        let copy = Connection::open(&backup).unwrap();
        assert_eq!(
            copy.query_row("SELECT count(*) FROM t", [], |r| r.get::<_, i64>(0)).unwrap(),
            2
        );
        assert!(matches!(vacuum_into(&conn, &backup), Err(SqlError::BackupExists(_))));
    }

    #[test]
    fn checkpoint_truncate_reports_wal_state() {
        let dir = tempfile::tempdir().unwrap();
        let conn = open(dir.path().join("db.sqlite"), OpenPolicy::read_write()).unwrap();
        conn.execute_batch("CREATE TABLE t(a); INSERT INTO t VALUES (1);").unwrap();
        let checkpoint = checkpoint_truncate(&conn).unwrap();
        assert!(!checkpoint.busy);
        let memory = open_in_memory(OpenPolicy::read_write()).unwrap();
        assert_eq!(checkpoint_truncate(&memory).unwrap().log_frames, -1);
    }

    #[cfg(not(feature = "vec"))]
    #[test]
    fn vec_policy_without_feature_is_an_error() {
        assert!(matches!(
            open_in_memory(OpenPolicy::read_write().with_vec()),
            Err(SqlError::FeatureDisabled("vec"))
        ));
    }

    #[cfg(feature = "vec")]
    #[test]
    fn vec0_is_available_and_answers_knn() {
        let conn = open_in_memory(OpenPolicy::read_write().with_vec()).unwrap();
        conn.execute_batch(
            "CREATE VIRTUAL TABLE v USING vec0(embedding float[3]);
             INSERT INTO v(rowid, embedding) VALUES (1, '[1,0,0]'), (2, '[0,1,0]');",
        )
        .unwrap();
        let nearest: i64 = conn
            .query_row(
                "SELECT rowid FROM v WHERE embedding MATCH '[0.9,0.1,0]' AND k = 1",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(nearest, 1);
        // A second registration is a no-op.
        register_vec_extension().unwrap();
    }
}
