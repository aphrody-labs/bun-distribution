// SPDX-License-Identifier: Apache-2.0
//! Typed errors of the home database.

use thiserror::Error;

/// Result alias for store operations.
pub type Result<T, E = StoreError> = std::result::Result<T, E>;

/// Failures of the home database.
#[derive(Debug, Error)]
pub enum StoreError {
    /// Shared SQL layer failure (open policy, migration runner).
    #[error("SQL error: {0}")]
    Sql(#[from] aphrody_sql::SqlError),
    /// SQLite driver failure.
    #[error("SQLite error: {0}")]
    Sqlite(#[from] rusqlite::Error),
    /// Filesystem failure.
    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),
    /// JSON (de)serialisation failure.
    #[error("JSON error: {0}")]
    Json(#[from] serde_json::Error),
    /// The agent home directory could not be resolved.
    #[error("agent home not resolvable: {0}")]
    Home(String),
    /// A profile name sanitises to nothing.
    #[error("invalid profile name `{0}`")]
    InvalidProfile(String),
    /// A value is outside the documented domain.
    #[error("invalid value: {0}")]
    Invalid(String),
    /// A backup or database failed its integrity verification.
    #[error("integrity check failed: {0}")]
    Integrity(String),
    /// A backup no longer matches its recorded checksum.
    #[error("checksum mismatch: expected {expected}, found {actual}")]
    ChecksumMismatch {
        /// Recorded SHA-256.
        expected: String,
        /// Computed SHA-256.
        actual: String,
    },
}
