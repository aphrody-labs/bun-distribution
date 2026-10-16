// SPDX-License-Identifier: Apache-2.0
//! Legacy RAG importer: a database written by `aphrody-rag` (`docs`, `chunks`, `vectors`,
//! `meta`) merged into the home database. Documents are keyed by path and never replaced;
//! vectors are copied only when the embedding model matches (vector spaces are never mixed).

use std::{collections::HashMap, path::Path};

use rusqlite::{OptionalExtension as _, params};

use super::{ImportReport, count, open_legacy, table_exists};
use crate::{db::HomeDb, error::Result};

/// Import (or count) a legacy RAG database into the source `label`.
///
/// # Errors
///
/// SQLite or I/O failures; nothing is written on error.
pub fn import_rag(
    db: &mut HomeDb,
    legacy_path: &Path,
    label: &str,
    apply: bool,
) -> Result<ImportReport> {
    let legacy = open_legacy(legacy_path)?;
    let mut report = ImportReport::new("rag", !apply);
    if !table_exists(&legacy, "docs")? || !table_exists(&legacy, "chunks")? {
        report.notes.push("legacy database has no docs/chunks tables".into());
        return Ok(report);
    }
    report.add("docs_read", count(&legacy, "SELECT count(*) FROM docs")?);
    report.add("chunks_read", count(&legacy, "SELECT count(*) FROM chunks")?);
    let has_vectors = table_exists(&legacy, "vectors")?;
    if has_vectors {
        report.add("vectors_read", count(&legacy, "SELECT count(*) FROM vectors")?);
    }
    let legacy_model: Option<String> = if table_exists(&legacy, "meta")? {
        legacy
            .query_row("SELECT value FROM meta WHERE key = 'embedding_model'", [], |r| r.get(0))
            .optional()?
    } else {
        None
    };
    let target_model: Option<String> = db
        .conn
        .query_row("SELECT value FROM meta WHERE key = 'embedding_model'", [], |r| r.get(0))
        .optional()?;
    let vectors_compatible = has_vectors
        && match (&legacy_model, &target_model) {
            (Some(a), Some(b)) => a == b,
            (Some(_), None) | (None, _) => true,
        };
    if has_vectors && !vectors_compatible {
        report.notes.push("embedding models differ: vectors are not imported".into());
    }

    let source_id = db.upsert_source("legacy-rag", label, Some(&legacy_path.to_string_lossy()))?;
    let tx = db.conn.transaction()?;
    let mut doc_map: HashMap<i64, i64> = HashMap::new();
    {
        let mut docs = legacy.prepare(
            "SELECT id, path, hash, title, language, mtime_ms, size_bytes FROM docs ORDER BY id",
        )?;
        let mut insert = tx.prepare(
            "INSERT OR IGNORE INTO docs (path, hash, title, language, mtime_ms, size_bytes, source_id)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        )?;
        let mut rows = docs.query([])?;
        while let Some(r) = rows.next()? {
            let n = insert.execute(params![
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, Option<String>>(3)?,
                r.get::<_, Option<String>>(4)?,
                r.get::<_, i64>(5)?,
                r.get::<_, i64>(6)?,
                source_id
            ])?;
            if n == 1 {
                doc_map.insert(r.get(0)?, tx.last_insert_rowid());
                report.add("docs_inserted", 1);
            } else {
                report.add("docs_already_present", 1);
            }
        }
    }
    let mut chunk_map: HashMap<i64, i64> = HashMap::new();
    {
        let mut chunks = legacy.prepare(
            "SELECT id, doc_id, chunk_index, heading, symbol, content, start_line, end_line, token_count
             FROM chunks ORDER BY id",
        )?;
        let mut insert = tx.prepare(
            "INSERT INTO chunks (doc_id, chunk_index, heading, symbol, content, start_line, end_line, token_count)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        )?;
        let mut rows = chunks.query([])?;
        while let Some(r) = rows.next()? {
            let Some(&doc) = doc_map.get(&r.get::<_, i64>(1)?) else { continue };
            insert.execute(params![
                doc,
                r.get::<_, i64>(2)?,
                r.get::<_, Option<String>>(3)?,
                r.get::<_, Option<String>>(4)?,
                r.get::<_, String>(5)?,
                r.get::<_, i64>(6)?,
                r.get::<_, i64>(7)?,
                r.get::<_, i64>(8)?
            ])?;
            chunk_map.insert(r.get(0)?, tx.last_insert_rowid());
            report.add("chunks_inserted", 1);
        }
    }
    if vectors_compatible {
        let mut vectors =
            legacy.prepare("SELECT chunk_id, model_id, dim, quant, embedding FROM vectors")?;
        let mut insert = tx.prepare(
            "INSERT OR IGNORE INTO vectors (chunk_id, model_id, dim, quant, embedding)
             VALUES (?1, ?2, ?3, ?4, ?5)",
        )?;
        let mut rows = vectors.query([])?;
        while let Some(r) = rows.next()? {
            let Some(&chunk) = chunk_map.get(&r.get::<_, i64>(0)?) else { continue };
            insert.execute(params![
                chunk,
                r.get::<_, String>(1)?,
                r.get::<_, i64>(2)?,
                r.get::<_, String>(3)?,
                r.get::<_, Vec<u8>>(4)?
            ])?;
            report.add("vectors_inserted", 1);
        }
        if let (Some(model), None) = (&legacy_model, &target_model)
            && report.counts.get("vectors_inserted").copied().unwrap_or(0) > 0
        {
            tx.execute("INSERT OR IGNORE INTO meta (key, value) VALUES ('embedding_model', ?1)", [model])?;
        }
    }
    if apply {
        tx.commit()?;
    }
    Ok(report)
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    fn legacy(dir: &Path, model: &str) -> std::path::PathBuf {
        let path = dir.join("rag.sqlite");
        let c = Connection::open(&path).unwrap();
        c.execute_batch(&format!(
            "CREATE TABLE docs (id INTEGER PRIMARY KEY AUTOINCREMENT, path TEXT NOT NULL UNIQUE,
                hash TEXT NOT NULL, title TEXT, language TEXT, mtime_ms INTEGER NOT NULL,
                size_bytes INTEGER NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')));
             CREATE TABLE chunks (id INTEGER PRIMARY KEY AUTOINCREMENT, doc_id INTEGER NOT NULL,
                chunk_index INTEGER NOT NULL, heading TEXT, symbol TEXT, content TEXT NOT NULL,
                start_line INTEGER NOT NULL, end_line INTEGER NOT NULL, token_count INTEGER NOT NULL);
             CREATE TABLE vectors (chunk_id INTEGER PRIMARY KEY, model_id TEXT NOT NULL,
                dim INTEGER NOT NULL, quant TEXT NOT NULL DEFAULT 'f32', embedding BLOB NOT NULL);
             CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
             INSERT INTO meta VALUES ('embedding_model', '{model}');
             INSERT INTO docs (path, hash, mtime_ms, size_bytes) VALUES ('a.md', 'h', 1, 5);
             INSERT INTO chunks (doc_id, chunk_index, content, start_line, end_line, token_count)
                VALUES (1, 0, 'hello retrieval world', 1, 1, 3);
             INSERT INTO vectors VALUES (1, '{model}', 2, 'f32', x'0000803f00000040');"
        ))
        .unwrap();
        path
    }

    #[test]
    fn docs_chunks_and_vectors_are_merged_once_and_searchable() {
        let dir = tempfile::tempdir().unwrap();
        let path = legacy(dir.path(), "m1");
        let mut db = HomeDb::open_in_memory().unwrap();
        let dry = import_rag(&mut db, &path, "legacy-rag:test", false).unwrap();
        assert_eq!(dry.counts["docs_inserted"], 1);
        assert_eq!(db.conn().query_row::<i64, _, _>("SELECT count(*) FROM docs", [], |r| r.get(0)).unwrap(), 0);

        let first = import_rag(&mut db, &path, "legacy-rag:test", true).unwrap();
        assert_eq!(first.counts["chunks_inserted"], 1);
        assert_eq!(first.counts["vectors_inserted"], 1);
        let hits: i64 = db
            .conn()
            .query_row("SELECT count(*) FROM chunks_fts WHERE chunks_fts MATCH 'retrieval'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(hits, 1);
        let again = import_rag(&mut db, &path, "legacy-rag:test", true).unwrap();
        assert_eq!(again.counts["docs_already_present"], 1);
        assert!(!again.counts.contains_key("chunks_inserted"));
    }

    #[test]
    fn vectors_of_another_model_are_not_mixed() {
        let dir = tempfile::tempdir().unwrap();
        let path = legacy(dir.path(), "m2");
        let mut db = HomeDb::open_in_memory().unwrap();
        db.conn().execute("INSERT INTO meta VALUES ('embedding_model', 'm1')", []).unwrap();
        let report = import_rag(&mut db, &path, "legacy-rag:test", true).unwrap();
        assert!(!report.counts.contains_key("vectors_inserted"));
        assert_eq!(report.counts["chunks_inserted"], 1);
        assert!(report.notes.iter().any(|n| n.contains("embedding models differ")));
    }
}
