// SPDX-License-Identifier: Apache-2.0
//! Importers from the pre-existing stores into the home database.
//!
//! Every importer reads its legacy source **read-only**, is idempotent (a second apply inserts
//! nothing) and has a dry-run mode that reports counts only and never writes. Legacy files are
//! never moved, truncated or deleted.

pub mod graphify;
pub mod memory;
pub mod rag;
pub mod sessions;

use std::{collections::BTreeMap, path::Path};

use rusqlite::{Connection, OpenFlags};
use serde::{Deserialize, Serialize};

use crate::error::Result;

/// Outcome of an import (or of its dry run).
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct ImportReport {
    /// Importer name.
    pub importer: String,
    /// True when nothing was written.
    pub dry_run: bool,
    /// Named counters (rows read, inserted, already present, skipped...).
    pub counts: BTreeMap<String, u64>,
    /// Human-readable remarks (never row content).
    pub notes: Vec<String>,
}

impl ImportReport {
    pub(crate) fn new(importer: &str, dry_run: bool) -> Self {
        Self { importer: importer.to_owned(), dry_run, ..Self::default() }
    }

    pub(crate) fn add(&mut self, key: &str, amount: u64) {
        *self.counts.entry(key.to_owned()).or_insert(0) += amount;
    }
}

/// Open a legacy SQLite file strictly read-only.
pub(crate) fn open_legacy(path: &Path) -> Result<Connection> {
    Ok(Connection::open_with_flags(
        path,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )?)
}

pub(crate) fn table_exists(conn: &Connection, name: &str) -> Result<bool> {
    Ok(conn.query_row(
        "SELECT count(*) > 0 FROM sqlite_master WHERE type = 'table' AND name = ?1",
        [name],
        |r| r.get(0),
    )?)
}

pub(crate) fn count(conn: &Connection, sql: &str) -> Result<u64> {
    let n: i64 = conn.query_row(sql, [], |r| r.get(0))?;
    Ok(u64::try_from(n).unwrap_or(0))
}
