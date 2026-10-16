// SPDX-License-Identifier: Apache-2.0

//! Error type shared by every `aphrody-sql` module.

/// Result alias used across the crate.
pub type Result<T, E = SqlError> = std::result::Result<T, E>;

/// Errors produced by `aphrody-sql`.
///
/// No variant ever embeds a database URL or a password: URLs are only exposed
/// through [`crate::env::DatabaseUrl`], whose `Display` and `Debug` redact the
/// credentials.
#[derive(Debug, thiserror::Error)]
#[non_exhaustive]
pub enum SqlError {
    /// None of the candidate environment variables is set to a non-empty value.
    #[error("no database URL configured; set one of: {}", .0.join(", "))]
    MissingEnv(Vec<String>),

    /// The database URL could not be parsed.
    #[error("invalid database URL ({0})")]
    InvalidUrl(String),

    /// A feature required by the requested operation is not compiled in.
    #[error("the `{0}` feature of aphrody-sql is not enabled")]
    FeatureDisabled(&'static str),

    /// TLS setup failure (root certificates, protocol versions).
    #[error("TLS configuration error: {0}")]
    Tls(String),

    /// A migration file name does not follow `NNNN_name.sql`.
    #[error("invalid migration file name `{0}`: expected `NNNN_name.sql`")]
    InvalidMigrationName(String),

    /// Two migration files share a version.
    #[error("duplicate migration version {0}")]
    DuplicateMigration(u32),

    /// An applied migration no longer matches its embedded file.
    #[error(
        "migration {version} (`{name}`) was modified after being applied: \
         recorded sha256 {recorded}, embedded sha256 {embedded}"
    )]
    ChecksumMismatch {
        /// Migration version.
        version: u32,
        /// Migration name.
        name: String,
        /// Checksum recorded in `aphrody_migrations`.
        recorded: String,
        /// Checksum of the embedded file.
        embedded: String,
    },

    /// The database records a migration this binary does not embed.
    #[error(
        "database has migration {0} applied but this binary does not embed it (database is ahead)"
    )]
    UnknownAppliedMigration(u32),

    /// A pending migration is older than the newest applied one.
    #[error(
        "migration {pending} is pending but {applied} is already applied (out-of-order migration)"
    )]
    OutOfOrderMigration {
        /// Pending (unapplied) version.
        pending: u32,
        /// Newest applied version.
        applied: u32,
    },

    /// An SQL identifier supplied to the migration runner is unsafe.
    #[error("invalid SQL identifier `{0}`")]
    InvalidIdentifier(String),

    /// A migration failed; the transaction of that file was rolled back.
    #[error("migration {version} (`{name}`) failed: {message}")]
    MigrationFailed {
        /// Migration version.
        version: u32,
        /// Migration name.
        name: String,
        /// Underlying database error message.
        message: String,
    },

    /// Filesystem failure (parent directory, backup path).
    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),

    /// A SQLite extension (sqlite-vec) could not be registered or is missing.
    #[error("SQLite extension error: {0}")]
    Extension(String),

    /// Backup target already exists.
    #[error("backup target `{0}` already exists")]
    BackupExists(String),

    /// PostgreSQL protocol or server error.
    #[cfg(feature = "postgres")]
    #[error("PostgreSQL error: {0}")]
    Postgres(#[from] tokio_postgres::Error),

    /// Pool checkout failure (timeout, connection error, closed pool).
    #[cfg(feature = "postgres")]
    #[error("PostgreSQL pool error: {0}")]
    Pool(#[from] deadpool_postgres::PoolError),

    /// Pool construction failure.
    #[cfg(feature = "postgres")]
    #[error("PostgreSQL pool build error: {0}")]
    PoolBuild(#[from] deadpool_postgres::BuildError),

    /// SQLite error.
    #[cfg(feature = "sqlite")]
    #[error("SQLite error: {0}")]
    Sqlite(#[from] rusqlite::Error),
}
