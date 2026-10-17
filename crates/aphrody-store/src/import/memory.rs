// SPDX-License-Identifier: Apache-2.0
//! Memory importer: `memory_records` (local provider) and `memory_items` (SQLite backend) into
//! `memories`, keyed by `(ns, id)` so a second run inserts nothing.

use std::path::Path;

use rusqlite::params;

use super::{ImportReport, count, open_legacy, table_exists};
use crate::{db::HomeDb, error::Result};

/// Import (or, with `apply == false`, count) the memories of one legacy database.
///
/// `origin` labels the rows (for example `legacy:memory/memory.sqlite`).
///
/// # Errors
///
/// SQLite or I/O failures; nothing is written on error.
pub fn import_memories(
    db: &mut HomeDb,
    legacy_path: &Path,
    origin: &str,
    apply: bool,
) -> Result<ImportReport> {
    let legacy = open_legacy(legacy_path)?;
    let mut report = ImportReport::new("memory", !apply);
    let has_records = table_exists(&legacy, "memory_records")?;
    let has_items = table_exists(&legacy, "memory_items")?;
    if !has_records && !has_items {
        report
            .notes
            .push("no memory table in the legacy database".into());
        return Ok(report);
    }
    if has_records {
        report.add(
            "records_read",
            count(&legacy, "SELECT count(*) FROM memory_records")?,
        );
    }
    if has_items {
        report.add(
            "items_read",
            count(&legacy, "SELECT count(*) FROM memory_items")?,
        );
    }
    let tx = db.conn.transaction()?;
    let mut inserted = 0_u64;
    let mut existing = 0_u64;
    {
        let mut insert = tx.prepare(
            "INSERT OR IGNORE INTO memories
                (id, ns, content, tags_json, metadata_json, embedding, origin, created_at_ms, updated_at_ms)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        )?;
        if has_records {
            let mut read = legacy.prepare(
                "SELECT id, agent_id, content, tags_json, metadata_json, created_at_unix_ms
                 FROM memory_records",
            )?;
            let mut rows = read.query([])?;
            while let Some(r) = rows.next()? {
                let created: i64 = r.get(5)?;
                let n = insert.execute(params![
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                    r.get::<_, String>(3)?,
                    r.get::<_, String>(4)?,
                    rusqlite::types::Null,
                    origin,
                    created,
                    created
                ])?;
                if n == 1 { inserted += 1 } else { existing += 1 }
            }
        }
        if has_items {
            let mut read = legacy.prepare(
                "SELECT id, ns, content, embedding, metadata, created_at, updated_at FROM memory_items",
            )?;
            let mut rows = read.query([])?;
            while let Some(r) = rows.next()? {
                let n = insert.execute(params![
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                    "[]",
                    r.get::<_, String>(4)?,
                    r.get::<_, Option<Vec<u8>>>(3)?,
                    origin,
                    r.get::<_, i64>(5)?,
                    r.get::<_, i64>(6)?
                ])?;
                if n == 1 { inserted += 1 } else { existing += 1 }
            }
        }
    }
    report.add("would_insert_or_inserted", inserted);
    report.add("already_present", existing);
    if apply {
        tx.commit()?;
    } // else: dropped, rolled back.
    Ok(report)
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    fn legacy(dir: &Path) -> std::path::PathBuf {
        let path = dir.join("memory.sqlite");
        let conn = Connection::open(&path).unwrap();
        conn.execute_batch(
            "CREATE TABLE memory_records (id TEXT PRIMARY KEY, agent_id TEXT NOT NULL,
                content TEXT NOT NULL, tags_json TEXT NOT NULL DEFAULT '[]',
                created_at_unix_ms INTEGER NOT NULL, metadata_json TEXT NOT NULL DEFAULT '{}');
             INSERT INTO memory_records VALUES ('1','agent','alpha beta','[]',10,'{}');
             INSERT INTO memory_records VALUES ('2','agent','gamma','[\"t\"]',20,'{}');",
        )
        .unwrap();
        path
    }

    #[test]
    fn dry_run_counts_without_writing_and_apply_is_idempotent() {
        let dir = tempfile::tempdir().unwrap();
        let path = legacy(dir.path());
        let before = std::fs::read(&path).unwrap();
        let mut db = HomeDb::open_in_memory().unwrap();

        let dry = import_memories(&mut db, &path, "legacy:test", false).unwrap();
        assert!(dry.dry_run);
        assert_eq!(dry.counts["would_insert_or_inserted"], 2);
        let n: i64 = db
            .conn()
            .query_row("SELECT count(*) FROM memories", [], |r| r.get(0))
            .unwrap();
        assert_eq!(n, 0);

        let applied = import_memories(&mut db, &path, "legacy:test", true).unwrap();
        assert_eq!(applied.counts["would_insert_or_inserted"], 2);
        let again = import_memories(&mut db, &path, "legacy:test", true).unwrap();
        assert_eq!(again.counts["already_present"], 2);
        assert_eq!(again.counts["would_insert_or_inserted"], 0);

        // FTS is in sync and the legacy file is byte-identical.
        let hit: i64 = db
            .conn()
            .query_row(
                "SELECT count(*) FROM memories_fts WHERE memories_fts MATCH 'gamma'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(hit, 1);
        assert_eq!(std::fs::read(&path).unwrap(), before);
    }
}
