// SPDX-License-Identifier: Apache-2.0
//! # aphrody-store: the single agent-home database
//!
//! One SQLite database per agent home (`<home>/db/aphrody.sqlite`), opened through
//! `aphrody-sql` (WAL, foreign keys, busy timeout) and versioned by the checksummed
//! `aphrody_migrations` runner. This crate owns the schema and everything that is not
//! retrieval: path resolution for the global and per-profile homes, corpus sources and
//! per-file fingerprints (the incremental, resumable pipeline state), the pipeline run
//! journal, synchronisation state and checksum-verified backups.
//!
//! Retrieval (`aphrody-rag`), the code graph (`aphrody-code-graph`), memories, sessions and
//! training registries are tables of the same file, added by later additive migrations; each
//! keeps its own typed API and persists through this database. A domain profile never reads
//! the global file: isolation is by file, never by a column.

#![deny(unsafe_code)]

pub mod backup;
pub mod cli;
pub mod db;
pub mod deny;
pub mod error;
pub mod files;
pub mod import;
pub mod layout;
pub mod runs;
pub mod scan;
pub mod sync_state;
pub mod time;

pub use crate::{
    deny::{DenyPolicy, is_denied},
    backup::{BackupReport, verify_backup},
    db::HomeDb,
    error::{Result, StoreError},
    files::{Delta, FileClass, FileFingerprint, Stage},
    layout::{HomeLayout, HomeScope},
    runs::{RunStatus, RunSummary},
};
