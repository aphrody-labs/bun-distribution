// SPDX-License-Identifier: Apache-2.0
//! Checksum-verified backups of the home database.
//!
//! A backup is a consistent `VACUUM INTO` copy written under
//! `<state>/private/backups/aphrody-unique/<date>/` (ADR D12: one consolidated backup tree, no
//! second copy elsewhere), hashed with SHA-256, described by a `<name>.sha256` sidecar, verified
//! by re-hashing and reopening it read-only with `PRAGMA integrity_check`, and only then
//! recorded in the `backups` ledger of the live database. An existing backup is never
//! overwritten.

use std::{
    fs::{File, OpenOptions},
    io::{Read as _, Write as _},
    path::{Path, PathBuf},
};

use aphrody_sql::sqlite::{self, OpenPolicy};
use rusqlite::params;
use serde::{Deserialize, Serialize};
use sha2::{Digest as _, Sha256};

use crate::{
    db::HomeDb,
    error::{Result, StoreError},
    time::{compact_timestamp, now_ms},
};

/// What a verified backup produced.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct BackupReport {
    /// Backup file.
    pub path: PathBuf,
    /// Lower-case hex SHA-256 of the backup file.
    pub sha256: String,
    /// Size in bytes.
    pub bytes: u64,
    /// Highest applied migration at backup time.
    pub schema_version: u32,
    /// Creation time, Unix milliseconds.
    pub created_at_ms: i64,
}

/// SHA-256 of a file, streamed.
///
/// # Errors
///
/// I/O failures.
pub fn sha256_file(path: &Path) -> Result<String> {
    let mut file = File::open(path)?;
    let mut hasher = Sha256::new();
    let mut buffer = vec![0_u8; 1 << 20];
    loop {
        let read = file.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(hasher.finalize().iter().map(|b| format!("{b:02x}")).collect())
}

/// Verify a backup: its SHA-256 equals `expected_sha256`, it opens read-only and passes
/// `PRAGMA integrity_check`.
///
/// # Errors
///
/// [`StoreError::ChecksumMismatch`], [`StoreError::Integrity`] or I/O and SQL failures.
pub fn verify_backup(path: &Path, expected_sha256: &str) -> Result<()> {
    let actual = sha256_file(path)?;
    if actual != expected_sha256 {
        return Err(StoreError::ChecksumMismatch { expected: expected_sha256.to_owned(), actual });
    }
    let conn = sqlite::open(path, OpenPolicy::read_only())?;
    let result: String = conn.query_row("PRAGMA integrity_check", [], |row| row.get(0))?;
    if result == "ok" { Ok(()) } else { Err(StoreError::Integrity(result)) }
}

/// Result of verifying every backup recorded in the ledger.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct LedgerCheck {
    /// Backups recorded.
    pub recorded: usize,
    /// Backups whose file exists and matches its recorded SHA-256 and integrity.
    pub verified: usize,
    /// Backups whose file is gone.
    pub missing: usize,
    /// Backups whose file no longer matches (checksum or integrity); paths only.
    pub corrupt: Vec<String>,
}

impl HomeDb {
    /// Verify every backup of the ledger against its file.
    ///
    /// # Errors
    ///
    /// SQLite failures (a bad backup is reported in the result, not as an error).
    pub fn verify_ledger(&self) -> Result<LedgerCheck> {
        let mut statement = self.conn.prepare("SELECT path, sha256 FROM backups ORDER BY id")?;
        let rows = statement.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?;
        let mut check = LedgerCheck::default();
        for row in rows {
            let (path, sha) = row?;
            check.recorded += 1;
            let file = std::path::Path::new(&path);
            if !file.is_file() {
                check.missing += 1;
            } else if verify_backup(file, &sha).is_ok() {
                check.verified += 1;
            } else {
                check.corrupt.push(path);
            }
        }
        Ok(check)
    }

    /// Back up this database into `dir` (created when missing), verify the copy, write the
    /// `.sha256` sidecar and record it in the ledger.
    ///
    /// `label` becomes part of the file name (`aphrody-<label>-<UTC timestamp>.sqlite`) and
    /// `reason` is stored in the ledger.
    ///
    /// # Errors
    ///
    /// [`StoreError::Sql`] when the target exists, verification failures, I/O and SQL failures.
    /// A copy that fails verification is removed (it is a file this call created).
    pub fn backup(&self, dir: &Path, label: &str, reason: &str) -> Result<BackupReport> {
        let created_at_ms = now_ms();
        let safe: String = label
            .chars()
            .map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == '_' { c } else { '-' })
            .collect();
        let name = format!(
            "aphrody-{safe}-{}-{:03}.sqlite",
            compact_timestamp(created_at_ms),
            created_at_ms.rem_euclid(1000)
        );
        let path = dir.join(&name);
        sqlite::vacuum_into(&self.conn, &path)?;

        let sha256 = match sha256_file(&path)
            .and_then(|sha| verify_backup(&path, &sha).map(|()| sha))
        {
            Ok(sha) => sha,
            Err(error) => {
                let _ = std::fs::remove_file(&path);
                return Err(error);
            },
        };
        let bytes = std::fs::metadata(&path)?.len();
        let sidecar = dir.join(format!("{name}.sha256"));
        OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&sidecar)?
            .write_all(format!("{sha256}  {name}\n").as_bytes())?;

        let schema_version = self.schema_version()?;
        self.conn.execute(
            "INSERT INTO backups (path, sha256, size_bytes, schema_version, reason, created_at_ms)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                path.to_string_lossy(),
                sha256,
                i64::try_from(bytes).unwrap_or(i64::MAX),
                schema_version,
                reason,
                created_at_ms
            ],
        )?;
        Ok(BackupReport { path, sha256, bytes, schema_version, created_at_ms })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn seeded() -> (tempfile::TempDir, HomeDb) {
        let dir = tempfile::tempdir().unwrap();
        let mut db = HomeDb::open_path(dir.path().join("home/db/aphrody.sqlite")).unwrap();
        let source = db.upsert_source("fs", "repo", None).unwrap();
        db.apply_scan(
            source,
            &[crate::FileFingerprint {
                rel_path: "a.rs".into(),
                blake3: "h".into(),
                size_bytes: 1,
                mtime_ms: 1,
                class: crate::FileClass::Code,
                lang: None,
            }],
        )
        .unwrap();
        (dir, db)
    }

    #[test]
    fn a_backup_is_consistent_hashed_recorded_and_verifiable() {
        let (dir, db) = seeded();
        let backups = dir.path().join("private/backups/aphrody-unique/2026-10-06");
        let report = db.backup(&backups, "global", "test").unwrap();
        assert!(report.path.starts_with(&backups));
        assert_eq!(report.sha256.len(), 64);
        assert_eq!(report.schema_version, 7);
        verify_backup(&report.path, &report.sha256).unwrap();
        let sidecar = std::fs::read_to_string(format!("{}.sha256", report.path.display())).unwrap();
        assert!(sidecar.starts_with(&report.sha256));
        let recorded: i64 =
            db.conn().query_row("SELECT count(*) FROM backups", [], |r| r.get(0)).unwrap();
        assert_eq!(recorded, 1);
        // The copy holds the data and the live database is untouched.
        let copy = HomeDb::open_read_only(&report.path).unwrap();
        let files: i64 = copy.conn().query_row("SELECT count(*) FROM files", [], |r| r.get(0)).unwrap();
        assert_eq!(files, 1);
        db.integrity_check().unwrap();
    }

    #[test]
    fn the_ledger_reports_verified_missing_and_corrupt_backups() {
        let (dir, db) = seeded();
        let backups = dir.path().join("b");
        let good = db.backup(&backups, "a", "one").unwrap();
        let gone = db.backup(&backups, "b", "two").unwrap();
        let bad = db.backup(&backups, "c", "three").unwrap();
        std::fs::remove_file(&gone.path).unwrap();
        let mut bytes = std::fs::read(&bad.path).unwrap();
        let last = bytes.len() - 1;
        bytes[last] ^= 0xff;
        std::fs::write(&bad.path, bytes).unwrap();
        let check = db.verify_ledger().unwrap();
        assert_eq!((check.recorded, check.verified, check.missing), (3, 1, 1));
        assert_eq!(check.corrupt, [bad.path.to_string_lossy().into_owned()]);
        assert!(good.path.is_file());
    }

    #[test]
    fn tampering_is_detected() {
        let (dir, db) = seeded();
        let report = db.backup(&dir.path().join("b"), "global", "test").unwrap();
        let mut bytes = std::fs::read(&report.path).unwrap();
        let last = bytes.len() - 1;
        bytes[last] ^= 0xff;
        std::fs::write(&report.path, bytes).unwrap();
        assert!(matches!(
            verify_backup(&report.path, &report.sha256),
            Err(StoreError::ChecksumMismatch { .. })
        ));
    }

    #[test]
    fn an_existing_backup_is_never_overwritten() {
        let (dir, db) = seeded();
        let backups = dir.path().join("b");
        let first = db.backup(&backups, "global", "one").unwrap();
        let before = std::fs::read(&first.path).unwrap();
        // Same label within the same second would collide: the second call must fail or use a
        // new name, and in both cases the first file stays byte-identical.
        let _ = db.backup(&backups, "global", "two");
        assert_eq!(std::fs::read(&first.path).unwrap(), before);
    }

    #[test]
    fn labels_cannot_escape_the_backup_directory() {
        let (dir, db) = seeded();
        let backups = dir.path().join("b");
        let report = db.backup(&backups, "../../evil", "test").unwrap();
        assert!(report.path.starts_with(&backups));
    }
}
