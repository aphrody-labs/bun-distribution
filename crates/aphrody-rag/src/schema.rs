// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 aphrody contributors

//! SQLite schema initialization and migration for the unified RAG database.

use rusqlite::Connection;

use crate::error::Result;

/// Apply the canonical RAG database schema to `conn`.
///
/// Open `conn` through [`aphrody_sql::sqlite::open`] so the standard pragmas (WAL,
/// `busy_timeout`, ...) are in force; this function only owns the DDL.
pub fn initialize_schema(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        r#"
        -- WAL, synchronous, busy_timeout, temp_store and optimize belong to the
        -- `aphrody_sql::sqlite::OpenPolicy` the store opens its connections with.
        -- Foreign keys stay here as a safety net: ON DELETE CASCADE depends on it.
        PRAGMA foreign_keys = ON;

        CREATE TABLE IF NOT EXISTS docs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            path TEXT NOT NULL UNIQUE,
            hash TEXT NOT NULL,
            title TEXT,
            language TEXT,
            mtime_ms INTEGER NOT NULL,
            size_bytes INTEGER NOT NULL,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS chunks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            doc_id INTEGER NOT NULL REFERENCES docs(id) ON DELETE CASCADE,
            chunk_index INTEGER NOT NULL,
            heading TEXT,
            symbol TEXT,
            content TEXT NOT NULL,
            start_line INTEGER NOT NULL,
            end_line INTEGER NOT NULL,
            token_count INTEGER NOT NULL,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            UNIQUE(doc_id, chunk_index)
        );

        CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
            content,
            heading,
            symbol,
            content=chunks,
            content_rowid=id,
            tokenize = 'unicode61 remove_diacritics 2'
        );

        CREATE TRIGGER IF NOT EXISTS chunks_ai AFTER INSERT ON chunks BEGIN
            INSERT INTO chunks_fts(rowid, content, heading, symbol)
            VALUES (new.id, new.content, new.heading, new.symbol);
        END;

        CREATE TRIGGER IF NOT EXISTS chunks_ad AFTER DELETE ON chunks BEGIN
            INSERT INTO chunks_fts(chunks_fts, rowid, content, heading, symbol)
            VALUES ('delete', old.id, old.content, old.heading, old.symbol);
        END;

        CREATE TRIGGER IF NOT EXISTS chunks_au AFTER UPDATE ON chunks BEGIN
            INSERT INTO chunks_fts(chunks_fts, rowid, content, heading, symbol)
            VALUES ('delete', old.id, old.content, old.heading, old.symbol);
            INSERT INTO chunks_fts(rowid, content, heading, symbol)
            VALUES (new.id, new.content, new.heading, new.symbol);
        END;

        CREATE TABLE IF NOT EXISTS vectors (
            chunk_id INTEGER PRIMARY KEY REFERENCES chunks(id) ON DELETE CASCADE,
            model_id TEXT NOT NULL,
            dim INTEGER NOT NULL,
            quant TEXT NOT NULL DEFAULT 'f32',
            embedding BLOB NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_vectors_model_id ON vectors(model_id);

        CREATE TABLE IF NOT EXISTS meta (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );
        "#,
    )?;

    Ok(())
}
