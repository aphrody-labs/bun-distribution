// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 aphrody contributors
//
//! The crate's error type.

/// Anything the queue can refuse or fail at.
#[derive(Debug, thiserror::Error)]
#[non_exhaustive]
pub enum JobError {
    /// A scheduling request cannot be safely claimed.
    #[error("invalid job specification: {0}")]
    InvalidSpec(String),
    /// A worker's lease or concurrency configuration is invalid.
    #[error("invalid worker configuration: {0}")]
    InvalidWorkerConfig(&'static str),
    /// The `SQLite` layer failed.
    #[error("sqlite error: {0}")]
    Sqlite(#[from] rusqlite::Error),

    /// A payload or result could not be (de)serialised.
    #[error("json error: {0}")]
    Json(#[from] serde_json::Error),

    /// Log or database file I/O failed.
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),

    /// No job carries that id.
    #[error("unknown job `{0}`")]
    UnknownJob(String),

    /// A row in the database does not decode to a [`crate::Job`]. This means
    /// the file was written by an incompatible version or edited by hand;
    /// naming the id makes it removable.
    #[error("job `{id}` is corrupt in the store: {reason}")]
    Corrupt {
        /// The offending job id.
        id: String,
        /// What failed to decode.
        reason: String,
    },

    /// The transition asked for is not legal from the job's current state.
    #[error("job `{id}` is {state}, cannot {action}")]
    BadTransition {
        /// The job in question.
        id: String,
        /// Its current state.
        state: crate::JobState,
        /// The refused action.
        action: &'static str,
    },

    /// No handler is registered for a job's `kind`.
    #[error("no handler registered for kind `{0}`")]
    UnknownKind(String),
}

/// Result alias used across the crate.
pub type Result<T> = core::result::Result<T, JobError>;
