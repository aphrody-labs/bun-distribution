// SPDX-License-Identifier: Apache-2.0

//! Embedded plain-SQL migration runner (ADR D8).
//!
//! # Contract
//!
//! * Files are named `NNNN_name.sql` (four or more digits, then `_`, then a
//!   name) and are embedded in the binary: pass `(file_name, contents)` pairs
//!   to [`MigrationSet::from_files`] or use [`embed_migrations!`].
//! * Applied migrations are recorded in `aphrody_migrations(version, name,
//!   sha256, applied_at)`. The checksum is the SHA-256 of the file with CRLF
//!   normalised to LF. A recorded checksum that differs from the embedded file
//!   is an error: **applied migrations are immutable**, fix forward with a new
//!   file.
//! * One transaction per file; a failing file rolls back and stops the run.
//!   Files must not contain `BEGIN`/`COMMIT` nor statements that cannot run in
//!   a transaction (`CREATE INDEX CONCURRENTLY`, `VACUUM`).
//! * PostgreSQL serialises runners with `pg_advisory_xact_lock` (key derived
//!   from the tracking table name) taken inside every transaction; SQLite uses
//!   `BEGIN IMMEDIATE`.
//! * A database *ahead* of the binary (applied version unknown here) and an
//!   out-of-order pending file are errors.
//! * Migrations use the **direct** URL (see [`crate::env`]); the runner only
//!   uses the simple query protocol and unnamed typed statements, so it also
//!   works behind a transaction pooler.
//!
//! One crate owns one database (or one schema through
//! [`MigrateOptions::schema`], which also scopes the tracking table), as the
//! tracking table is keyed by version only.

use std::collections::BTreeMap;

use sha2::{Digest as _, Sha256};

use crate::error::{Result, SqlError};

/// Default tracking table.
pub const DEFAULT_TABLE: &str = "aphrody_migrations";

/// One parsed migration file.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Migration {
    /// Numeric prefix of the file name.
    pub version: u32,
    /// Name part of the file name (without version and `.sql`).
    pub name: String,
    /// SQL text.
    pub sql: String,
    /// Lower-case hex SHA-256 of the CRLF-normalised SQL.
    pub sha256: String,
}

/// An ordered, validated set of migrations.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct MigrationSet {
    migrations: Vec<Migration>,
}

impl MigrationSet {
    /// Build a set from `(file name or path, contents)` pairs. Only the last
    /// path component is parsed, so `include_str!` paths can be passed as is.
    ///
    /// # Errors
    ///
    /// [`SqlError::InvalidMigrationName`] or [`SqlError::DuplicateMigration`].
    pub fn from_files(files: &[(&str, &str)]) -> Result<Self> {
        let mut by_version = BTreeMap::new();
        for (path, sql) in files {
            let (version, name) = parse_file_name(path)?;
            let migration = Migration {
                version,
                name,
                sql: (*sql).to_owned(),
                sha256: checksum(sql),
            };
            if by_version.insert(version, migration).is_some() {
                return Err(SqlError::DuplicateMigration(version));
            }
        }
        Ok(Self {
            migrations: by_version.into_values().collect(),
        })
    }

    /// Migrations in ascending version order.
    pub fn iter(&self) -> impl Iterator<Item = &Migration> {
        self.migrations.iter()
    }

    /// Number of migrations.
    #[must_use]
    pub fn len(&self) -> usize {
        self.migrations.len()
    }

    /// Whether the set is empty.
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.migrations.is_empty()
    }

    /// Highest version, if any.
    #[must_use]
    pub fn latest_version(&self) -> Option<u32> {
        self.migrations.last().map(|migration| migration.version)
    }

    fn get(&self, version: u32) -> Option<&Migration> {
        self.migrations
            .binary_search_by_key(&version, |m| m.version)
            .ok()
            .map(|i| &self.migrations[i])
    }
}

/// Embed migration files next to the calling source file:
///
/// ```ignore
/// let set = aphrody_sql::embed_migrations!(
///     "../migrations/0001_init.sql",
///     "../migrations/0002_index.sql",
/// )?;
/// ```
///
/// Paths are relative to the file that invokes the macro (like `include_str!`).
/// Expands to `Result<MigrationSet>`.
#[macro_export]
macro_rules! embed_migrations {
    ($($file:literal),+ $(,)?) => {
        $crate::migrate::MigrationSet::from_files(&[ $( ($file, include_str!($file)) ),+ ])
    };
}

/// SHA-256 (lower-case hex) of `sql` with `\r\n` normalised to `\n`.
#[must_use]
pub fn checksum(sql: &str) -> String {
    let mut hasher = Sha256::new();
    let mut rest = sql;
    while let Some(index) = rest.find("\r\n") {
        hasher.update(&rest.as_bytes()[..index]);
        hasher.update(b"\n");
        rest = &rest[index + 2..];
    }
    hasher.update(rest.as_bytes());
    hasher
        .finalize()
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect::<String>()
}

/// Split `NNNN_name.sql` (after stripping any directory) into version and name.
///
/// # Errors
///
/// [`SqlError::InvalidMigrationName`].
pub fn parse_file_name(path: &str) -> Result<(u32, String)> {
    let invalid = || SqlError::InvalidMigrationName(path.to_owned());
    let file = path.rsplit(['/', '\\']).next().unwrap_or(path);
    let stem = file.strip_suffix(".sql").ok_or_else(invalid)?;
    let (digits, name) = stem.split_once('_').ok_or_else(invalid)?;
    if digits.len() < 4 || !digits.bytes().all(|b| b.is_ascii_digit()) || name.is_empty() {
        return Err(invalid());
    }
    let version = digits.parse::<u32>().map_err(|_| invalid())?;
    Ok((version, name.to_owned()))
}

/// Where and under which name progress is tracked.
#[derive(Debug, Clone)]
pub struct MigrateOptions {
    /// PostgreSQL schema holding the tracking table (created if missing).
    /// Ignored by SQLite.
    pub schema: Option<String>,
    /// Tracking table name.
    pub table: String,
}

impl Default for MigrateOptions {
    fn default() -> Self {
        Self {
            schema: None,
            table: DEFAULT_TABLE.to_owned(),
        }
    }
}

impl MigrateOptions {
    /// Track in `<schema>.aphrody_migrations`.
    #[must_use]
    pub fn in_schema(schema: impl Into<String>) -> Self {
        Self {
            schema: Some(schema.into()),
            table: DEFAULT_TABLE.to_owned(),
        }
    }

    fn validated(&self) -> Result<()> {
        for ident in self.schema.iter().chain(std::iter::once(&self.table)) {
            let mut chars = ident.chars();
            let valid = ident.len() <= 63
                && chars
                    .next()
                    .is_some_and(|c| c.is_ascii_alphabetic() || c == '_')
                && chars.all(|c| c.is_ascii_alphanumeric() || c == '_');
            if !valid {
                return Err(SqlError::InvalidIdentifier(ident.clone()));
            }
        }
        Ok(())
    }

    #[cfg_attr(not(feature = "postgres"), allow(dead_code))]
    fn qualified(&self) -> String {
        match &self.schema {
            Some(schema) => format!("{schema}.{}", self.table),
            None => self.table.clone(),
        }
    }
}

/// A row of the tracking table.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AppliedMigration {
    /// Version.
    pub version: u32,
    /// Name.
    pub name: String,
    /// Recorded checksum.
    pub sha256: String,
}

/// What a run did.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct MigrationReport {
    /// Migrations applied by this run, in order: `(version, name)`.
    pub applied: Vec<(u32, String)>,
    /// Migrations that were already recorded and unchanged.
    pub already_applied: usize,
}

/// Compare `applied` with `set` and return the pending migrations in order.
///
/// # Errors
///
/// [`SqlError::UnknownAppliedMigration`], [`SqlError::ChecksumMismatch`] or
/// [`SqlError::OutOfOrderMigration`].
pub fn plan<'a>(set: &'a MigrationSet, applied: &[AppliedMigration]) -> Result<Vec<&'a Migration>> {
    for row in applied {
        let migration = set
            .get(row.version)
            .ok_or(SqlError::UnknownAppliedMigration(row.version))?;
        if migration.sha256 != row.sha256 {
            return Err(SqlError::ChecksumMismatch {
                version: row.version,
                name: migration.name.clone(),
                recorded: row.sha256.clone(),
                embedded: migration.sha256.clone(),
            });
        }
    }
    let newest = applied.iter().map(|row| row.version).max();
    let pending: Vec<&Migration> = set
        .iter()
        .filter(|migration| !applied.iter().any(|row| row.version == migration.version))
        .collect();
    if let (Some(newest), Some(first)) = (newest, pending.first())
        && first.version < newest
    {
        return Err(SqlError::OutOfOrderMigration {
            pending: first.version,
            applied: newest,
        });
    }
    Ok(pending)
}

#[cfg(any(feature = "postgres", test))]
fn lock_key(qualified_table: &str) -> i64 {
    let digest = Sha256::digest(format!("aphrody_migrations:{qualified_table}").as_bytes());
    let mut bytes = [0_u8; 8];
    bytes.copy_from_slice(&digest[..8]);
    i64::from_be_bytes(bytes)
}

// ---------------------------------------------------------------------------
// PostgreSQL
// ---------------------------------------------------------------------------

#[cfg(feature = "postgres")]
mod pg_runner {
    use tokio_postgres::{
        Client, Transaction,
        types::{ToSql, Type},
    };

    use super::{
        AppliedMigration, MigrateOptions, Migration, MigrationReport, MigrationSet, lock_key, plan,
    };
    use crate::error::{Result, SqlError};

    const BOOTSTRAP: &str = "CREATE TABLE IF NOT EXISTS {table} (\
        version bigint PRIMARY KEY, \
        name text NOT NULL, \
        sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'), \
        applied_at timestamptz NOT NULL DEFAULT now())";

    fn db_message(error: &tokio_postgres::Error) -> String {
        error
            .as_db_error()
            .map_or_else(|| error.to_string(), |db| db.message().to_owned())
    }

    async fn read_applied(client: &Client, table: &str) -> Result<Vec<AppliedMigration>> {
        let rows = client
            .query_typed(
                &format!("SELECT version, name, sha256 FROM {table} ORDER BY version"),
                &[],
            )
            .await?;
        rows.iter()
            .map(|row| {
                let version: i64 = row.try_get(0)?;
                Ok(AppliedMigration {
                    version: u32::try_from(version)
                        .map_err(|_| SqlError::UnknownAppliedMigration(u32::MAX))?,
                    name: row.try_get(1)?,
                    sha256: row.try_get(2)?,
                })
            })
            .collect()
    }

    async fn apply(tx: &Transaction<'_>, table: &str, migration: &Migration) -> Result<()> {
        tx.batch_execute(&migration.sql)
            .await
            .map_err(|error| SqlError::MigrationFailed {
                version: migration.version,
                name: migration.name.clone(),
                message: db_message(&error),
            })?;
        let version = i64::from(migration.version);
        let params: [(&(dyn ToSql + Sync), Type); 3] = [
            (&version, Type::INT8),
            (&migration.name, Type::TEXT),
            (&migration.sha256, Type::TEXT),
        ];
        tx.execute_typed(
            &format!("INSERT INTO {table} (version, name, sha256) VALUES ($1, $2, $3)"),
            &params,
        )
        .await?;
        Ok(())
    }

    /// Apply every pending migration of `set` to PostgreSQL.
    ///
    /// # Errors
    ///
    /// Checksum, ordering and identifier errors (see [`SqlError`]),
    /// [`SqlError::MigrationFailed`] for a failing file, or a driver error.
    pub async fn migrate_postgres(
        client: &mut Client,
        set: &MigrationSet,
        options: &MigrateOptions,
    ) -> Result<MigrationReport> {
        options.validated()?;
        let table = options.qualified();
        let lock = format!("SELECT pg_advisory_xact_lock({})", lock_key(&table));

        {
            let tx = client.transaction().await?;
            tx.batch_execute(&lock).await?;
            if let Some(schema) = &options.schema {
                tx.batch_execute(&format!("CREATE SCHEMA IF NOT EXISTS {schema}"))
                    .await?;
            }
            tx.batch_execute(&BOOTSTRAP.replace("{table}", &table))
                .await?;
            tx.commit().await?;
        }

        let applied = read_applied(client, &table).await?;
        let pending = plan(set, &applied)?;
        let mut report = MigrationReport {
            applied: Vec::new(),
            already_applied: set.len() - pending.len(),
        };
        for migration in pending {
            let tx = client.transaction().await?;
            tx.batch_execute(&lock).await?;
            let version = i64::from(migration.version);
            let params: [(&(dyn ToSql + Sync), Type); 1] = [(&version, Type::INT8)];
            let existing = tx
                .query_typed(
                    &format!("SELECT sha256 FROM {table} WHERE version = $1"),
                    &params,
                )
                .await?;
            if let Some(row) = existing.first() {
                let recorded: String = row.try_get(0)?;
                if recorded != migration.sha256 {
                    return Err(SqlError::ChecksumMismatch {
                        version: migration.version,
                        name: migration.name.clone(),
                        recorded,
                        embedded: migration.sha256.clone(),
                    });
                }
                // Applied concurrently by another runner while we waited for the lock.
                report.already_applied += 1;
                continue;
            }
            apply(&tx, &table, migration).await?;
            tx.commit().await?;
            tracing::info!(version = migration.version, name = %migration.name, "applied migration");
            report
                .applied
                .push((migration.version, migration.name.clone()));
        }
        Ok(report)
    }
}

#[cfg(feature = "postgres")]
pub use pg_runner::migrate_postgres;

// ---------------------------------------------------------------------------
// SQLite
// ---------------------------------------------------------------------------

/// Apply every pending migration of `set` to SQLite (one `BEGIN IMMEDIATE`
/// transaction per file). `options.schema` is ignored.
///
/// `PRAGMA foreign_keys` is a no-op inside a transaction: do not toggle it in
/// migration files.
///
/// # Errors
///
/// Checksum, ordering and identifier errors (see [`SqlError`]),
/// [`SqlError::MigrationFailed`] for a failing file, or a driver error.
#[cfg(feature = "sqlite")]
pub fn migrate_sqlite(
    conn: &mut rusqlite::Connection,
    set: &MigrationSet,
    options: &MigrateOptions,
) -> Result<MigrationReport> {
    use rusqlite::TransactionBehavior;

    options.validated()?;
    let table = &options.table;
    conn.execute_batch(&format!(
        "CREATE TABLE IF NOT EXISTS {table} (\
            version INTEGER PRIMARY KEY, \
            name TEXT NOT NULL, \
            sha256 TEXT NOT NULL, \
            applied_at TEXT NOT NULL DEFAULT (datetime('now')))"
    ))?;
    let applied = {
        let mut statement = conn.prepare(&format!(
            "SELECT version, name, sha256 FROM {table} ORDER BY version"
        ))?;
        let rows = statement.query_map([], |row| {
            Ok(AppliedMigration {
                version: u32::try_from(row.get::<_, i64>(0)?).unwrap_or(u32::MAX),
                name: row.get(1)?,
                sha256: row.get(2)?,
            })
        })?;
        rows.collect::<std::result::Result<Vec<_>, _>>()?
    };
    let pending = plan(set, &applied)?;
    let mut report = MigrationReport {
        applied: Vec::new(),
        already_applied: set.len() - pending.len(),
    };
    for migration in pending {
        let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let existing: Option<String> = tx
            .query_row(
                &format!("SELECT sha256 FROM {table} WHERE version = ?1"),
                [i64::from(migration.version)],
                |row| row.get(0),
            )
            .map(Some)
            .or_else(|error| match error {
                rusqlite::Error::QueryReturnedNoRows => Ok(None),
                other => Err(other),
            })?;
        if let Some(recorded) = existing {
            if recorded != migration.sha256 {
                return Err(SqlError::ChecksumMismatch {
                    version: migration.version,
                    name: migration.name.clone(),
                    recorded,
                    embedded: migration.sha256.clone(),
                });
            }
            report.already_applied += 1;
            continue;
        }
        tx.execute_batch(&migration.sql)
            .map_err(|error| SqlError::MigrationFailed {
                version: migration.version,
                name: migration.name.clone(),
                message: error.to_string(),
            })?;
        tx.execute(
            &format!("INSERT INTO {table} (version, name, sha256) VALUES (?1, ?2, ?3)"),
            rusqlite::params![
                i64::from(migration.version),
                migration.name,
                migration.sha256
            ],
        )?;
        tx.commit()?;
        tracing::info!(version = migration.version, name = %migration.name, "applied migration");
        report
            .applied
            .push((migration.version, migration.name.clone()));
    }
    Ok(report)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn set(files: &[(&str, &str)]) -> MigrationSet {
        MigrationSet::from_files(files).unwrap()
    }

    #[test]
    fn file_names_are_parsed_and_validated() {
        assert_eq!(
            parse_file_name("0001_registry.sql").unwrap(),
            (1, "registry".into())
        );
        assert_eq!(
            parse_file_name("crates/x/migrations/00012_add_index_v2.sql").unwrap(),
            (12, "add_index_v2".into())
        );
        for bad in [
            "0001.sql",
            "001_a.sql",
            "abcd_a.sql",
            "0001_.sql",
            "0001_a.txt",
            "0001_a",
        ] {
            assert!(
                matches!(parse_file_name(bad), Err(SqlError::InvalidMigrationName(_))),
                "{bad}"
            );
        }
    }

    #[test]
    fn set_is_sorted_and_rejects_duplicate_versions() {
        let migrations = set(&[
            ("0010_c.sql", "c"),
            ("0002_b.sql", "b"),
            ("0001_a.sql", "a"),
        ]);
        let versions: Vec<u32> = migrations.iter().map(|m| m.version).collect();
        assert_eq!(versions, [1, 2, 10]);
        assert_eq!(migrations.latest_version(), Some(10));
        assert!(matches!(
            MigrationSet::from_files(&[("0001_a.sql", "a"), ("0001_b.sql", "b")]),
            Err(SqlError::DuplicateMigration(1))
        ));
    }

    #[test]
    fn checksum_is_stable_hex_and_ignores_line_endings() {
        let lf = checksum("SELECT 1;\nSELECT 2;\n");
        assert_eq!(lf.len(), 64);
        assert!(
            lf.bytes()
                .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
        );
        assert_eq!(lf, checksum("SELECT 1;\r\nSELECT 2;\r\n"));
        assert_ne!(lf, checksum("SELECT 1;\nSELECT 3;\n"));
        // Known SHA-256 of "abc".
        assert_eq!(
            checksum("abc"),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
    }

    fn applied(set: &MigrationSet, versions: &[u32]) -> Vec<AppliedMigration> {
        set.iter()
            .filter(|m| versions.contains(&m.version))
            .map(|m| AppliedMigration {
                version: m.version,
                name: m.name.clone(),
                sha256: m.sha256.clone(),
            })
            .collect()
    }

    #[test]
    fn plan_returns_pending_in_order() {
        let migrations = set(&[
            ("0001_a.sql", "a"),
            ("0002_b.sql", "b"),
            ("0003_c.sql", "c"),
        ]);
        let pending = plan(&migrations, &applied(&migrations, &[1])).unwrap();
        assert_eq!(
            pending.iter().map(|m| m.version).collect::<Vec<_>>(),
            [2, 3]
        );
        assert!(
            plan(&migrations, &applied(&migrations, &[1, 2, 3]))
                .unwrap()
                .is_empty()
        );
        assert_eq!(plan(&migrations, &[]).unwrap().len(), 3);
    }

    #[test]
    fn plan_rejects_modified_ahead_and_out_of_order() {
        let migrations = set(&[
            ("0001_a.sql", "a"),
            ("0002_b.sql", "b"),
            ("0003_c.sql", "c"),
        ]);

        let mut tampered = applied(&migrations, &[1]);
        tampered[0].sha256 = checksum("something else");
        assert!(matches!(
            plan(&migrations, &tampered),
            Err(SqlError::ChecksumMismatch { version: 1, .. })
        ));

        let mut ahead = applied(&migrations, &[1]);
        ahead.push(AppliedMigration {
            version: 9,
            name: "future".into(),
            sha256: checksum("f"),
        });
        assert!(matches!(
            plan(&migrations, &ahead),
            Err(SqlError::UnknownAppliedMigration(9))
        ));

        // 2 is missing while 3 is applied.
        assert!(matches!(
            plan(&migrations, &applied(&migrations, &[1, 3])),
            Err(SqlError::OutOfOrderMigration {
                pending: 2,
                applied: 3
            })
        ));
    }

    #[test]
    fn options_reject_unsafe_identifiers() {
        assert!(MigrateOptions::default().validated().is_ok());
        assert!(MigrateOptions::in_schema("training").validated().is_ok());
        for bad in ["", "1abc", "a-b", "a;drop table x", "a b", "sch.ema"] {
            assert!(
                matches!(
                    MigrateOptions::in_schema(bad).validated(),
                    Err(SqlError::InvalidIdentifier(_))
                ),
                "{bad}"
            );
        }
        let options = MigrateOptions {
            schema: None,
            table: "x; --".into(),
        };
        assert!(options.validated().is_err());
        assert_eq!(
            MigrateOptions::in_schema("training").qualified(),
            "training.aphrody_migrations"
        );
    }

    #[test]
    fn lock_key_is_stable_and_scoped() {
        assert_eq!(
            lock_key("aphrody_migrations"),
            lock_key("aphrody_migrations")
        );
        assert_ne!(
            lock_key("aphrody_migrations"),
            lock_key("training.aphrody_migrations")
        );
    }

    #[test]
    fn embed_macro_reads_files_relative_to_the_caller() {
        let migrations = embed_migrations!(
            "../tests/fixtures/0001_init.sql",
            "../tests/fixtures/0002_more.sql",
        )
        .unwrap();
        assert_eq!(migrations.len(), 2);
        assert_eq!(migrations.iter().next().unwrap().name, "init");
        assert!(
            migrations
                .iter()
                .next()
                .unwrap()
                .sql
                .contains("CREATE TABLE widgets")
        );
    }

    #[cfg(feature = "sqlite")]
    mod sqlite {
        use rusqlite::Connection;

        use super::*;

        fn connection() -> Connection {
            crate::sqlite::open_in_memory(crate::sqlite::OpenPolicy::read_write()).unwrap()
        }

        fn fixtures() -> MigrationSet {
            embed_migrations!(
                "../tests/fixtures/0001_init.sql",
                "../tests/fixtures/0002_more.sql",
            )
            .unwrap()
        }

        fn count(conn: &Connection, sql: &str) -> i64 {
            conn.query_row(sql, [], |row| row.get(0)).unwrap()
        }

        #[test]
        fn applies_in_order_and_is_idempotent() {
            let mut conn = connection();
            let report =
                migrate_sqlite(&mut conn, &fixtures(), &MigrateOptions::default()).unwrap();
            assert_eq!(
                report.applied,
                [(1, "init".to_owned()), (2, "more".to_owned())]
            );
            assert_eq!(report.already_applied, 0);
            assert_eq!(count(&conn, "SELECT count(*) FROM aphrody_migrations"), 2);
            conn.execute("INSERT INTO widgets (name, size) VALUES ('a', 3)", [])
                .unwrap();

            let again = migrate_sqlite(&mut conn, &fixtures(), &MigrateOptions::default()).unwrap();
            assert!(again.applied.is_empty());
            assert_eq!(again.already_applied, 2);
            let recorded: String = conn
                .query_row(
                    "SELECT sha256 FROM aphrody_migrations WHERE version = 1",
                    [],
                    |r| r.get(0),
                )
                .unwrap();
            assert_eq!(recorded, fixtures().iter().next().unwrap().sha256);
        }

        #[test]
        fn only_new_files_run_on_a_later_start() {
            let mut conn = connection();
            let first = set(&[("0001_a.sql", "CREATE TABLE a (x INTEGER);")]);
            migrate_sqlite(&mut conn, &first, &MigrateOptions::default()).unwrap();
            let both = set(&[
                ("0001_a.sql", "CREATE TABLE a (x INTEGER);"),
                ("0002_b.sql", "CREATE TABLE b (y INTEGER);"),
            ]);
            let report = migrate_sqlite(&mut conn, &both, &MigrateOptions::default()).unwrap();
            assert_eq!(report.applied, [(2, "b".to_owned())]);
            assert_eq!(report.already_applied, 1);
        }

        #[test]
        fn modified_applied_file_is_a_checksum_error() {
            let mut conn = connection();
            migrate_sqlite(
                &mut conn,
                &set(&[("0001_a.sql", "CREATE TABLE a (x);")]),
                &MigrateOptions::default(),
            )
            .unwrap();
            let error = migrate_sqlite(
                &mut conn,
                &set(&[("0001_a.sql", "CREATE TABLE a (x, y);")]),
                &MigrateOptions::default(),
            )
            .unwrap_err();
            assert!(
                matches!(error, SqlError::ChecksumMismatch { version: 1, .. }),
                "{error}"
            );
        }

        #[test]
        fn failing_file_rolls_back_atomically_and_stops_the_run() {
            let mut conn = connection();
            let broken = set(&[
                ("0001_ok.sql", "CREATE TABLE ok (x);"),
                (
                    "0002_bad.sql",
                    "CREATE TABLE half (x); INSERT INTO missing_table VALUES (1);",
                ),
                ("0003_never.sql", "CREATE TABLE never (x);"),
            ]);
            let error = migrate_sqlite(&mut conn, &broken, &MigrateOptions::default()).unwrap_err();
            assert!(
                matches!(error, SqlError::MigrationFailed { version: 2, .. }),
                "{error}"
            );
            let tables = |name: &str| {
                count(
                    &conn,
                    &format!("SELECT count(*) FROM sqlite_master WHERE name = '{name}'"),
                )
            };
            assert_eq!(tables("ok"), 1, "files before the failure stay applied");
            assert_eq!(
                tables("half"),
                0,
                "the failing file is rolled back as a whole"
            );
            assert_eq!(tables("never"), 0, "later files do not run");
            assert_eq!(count(&conn, "SELECT count(*) FROM aphrody_migrations"), 1);
        }

        #[test]
        fn custom_tracking_table_is_validated_and_used() {
            let mut conn = connection();
            let options = MigrateOptions {
                schema: None,
                table: "my_migrations".into(),
            };
            migrate_sqlite(&mut conn, &fixtures(), &options).unwrap();
            assert_eq!(count(&conn, "SELECT count(*) FROM my_migrations"), 2);
            let bad = MigrateOptions {
                schema: None,
                table: "x; DROP TABLE widgets".into(),
            };
            assert!(matches!(
                migrate_sqlite(&mut conn, &fixtures(), &bad),
                Err(SqlError::InvalidIdentifier(_))
            ));
        }
    }
}
