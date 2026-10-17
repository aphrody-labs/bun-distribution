// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 aphrody contributors

//! Core SQLite storage layer for documents, chunks, FTS5 index, and dense vectors.

use std::{
    path::Path,
    sync::{Arc, PoisonError},
};

use aphrody_rag_core::fusion::top_k_exact;
use aphrody_sql::{
    SqlError,
    sqlite::{self, OpenPolicy},
};
use rusqlite::{Connection, OptionalExtension as _, params};
use serde::{Deserialize, Serialize};
use tokio::sync::Mutex;

use crate::{
    error::{RagError, Result},
    schema::initialize_schema,
};

/// A stored document record in the database.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DocRecord {
    /// Document identifier.
    pub id: i64,
    /// Repository-relative or canonical filesystem path.
    pub path: String,
    /// BLAKE3 content hash.
    pub hash: String,
    /// Document title if identified.
    pub title: Option<String>,
    /// Document source language (e.g. "rust", "typescript", "markdown").
    pub language: Option<String>,
    /// Last modification timestamp in milliseconds.
    pub mtime_ms: i64,
    /// File size in bytes.
    pub size_bytes: i64,
    /// Ingestion timestamp.
    pub created_at: String,
}

/// A stored chunk record.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChunkRecord {
    /// Chunk identifier.
    pub id: i64,
    /// Parent document identifier.
    pub doc_id: i64,
    /// Parent document path.
    pub path: String,
    /// 0-indexed position within document.
    pub chunk_index: usize,
    /// Heading context if Markdown.
    pub heading: Option<String>,
    /// Function or symbol name if code.
    pub symbol: Option<String>,
    /// Textual chunk body.
    pub content: String,
    /// 1-based start line.
    pub start_line: usize,
    /// 1-based end line.
    pub end_line: usize,
    /// Approximate token count.
    pub token_count: usize,
}

/// Metadata written atomically with a document's replacement chunks.
pub(crate) struct NewDoc<'a> {
    pub path: &'a str,
    pub hash: &'a str,
    pub title: Option<&'a str>,
    pub language: Option<&'a str>,
    pub mtime_ms: i64,
    pub size_bytes: i64,
}

/// Chunk fields written together with a document replacement.
pub(crate) struct NewChunk {
    pub heading: Option<String>,
    pub symbol: Option<String>,
    pub content: String,
    pub start_line: usize,
    pub end_line: usize,
    pub token_count: usize,
}

/// A retrieved chunk paired with a retrieval score and provenance channel.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScoredChunk {
    /// The retrieved chunk record.
    pub chunk: ChunkRecord,
    /// Retrieval score (BM25, cosine, RRF, or cross-encoder probability).
    pub score: f64,
    /// Provenance channel ("lexical", "vector", "rrf", "rerank").
    pub channel: String,
}

/// High-level statistics about the stored RAG corpus.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct RagStats {
    /// Total number of indexed documents.
    pub doc_count: usize,
    /// Total number of extracted text chunks.
    pub chunk_count: usize,
    /// Total number of stored dense vectors.
    pub vector_count: usize,
    /// Embedding model identifier recorded in metadata, if set.
    pub embedding_model: Option<String>,
}

/// Maps `aphrody-sql` failures onto the public [`RagError`] variants.
fn sql_error(error: SqlError) -> RagError {
    match error {
        SqlError::Sqlite(error) => RagError::Sqlite(error),
        SqlError::Io(error) => RagError::Io(error),
        other => RagError::Other(other.to_string()),
    }
}

/// Thread-safe RAG SQLite store.
///
/// Connections are opened through the `aphrody-sql` SQLite policy (WAL,
/// `busy_timeout=5000`, `foreign_keys=ON`, `temp_store=MEMORY`,
/// `PRAGMA optimize=0x10002`). File-backed stores also keep a dedicated
/// read-only connection so the brute-force vector scan runs on a blocking
/// thread without holding the writer's async mutex.
#[derive(Clone)]
pub struct RagStore {
    conn: Arc<Mutex<Connection>>,
    /// Read-only connection for scans; `None` for in-memory stores, whose data
    /// is only visible to the writer connection.
    reader: Option<Arc<std::sync::Mutex<Connection>>>,
}

impl RagStore {
    /// Open or create a persistent SQLite RAG database at `path`.
    pub fn open(path: impl AsRef<Path>) -> Result<Self> {
        let path = path.as_ref();
        let conn = sqlite::open(path, OpenPolicy::read_write()).map_err(sql_error)?;
        initialize_schema(&conn)?;
        let reader = match sqlite::open(path, OpenPolicy::read_only()) {
            Ok(reader) => Some(Arc::new(std::sync::Mutex::new(reader))),
            Err(error) => {
                tracing::debug!(%error, "RAG store has no dedicated reader connection");
                None
            }
        };
        Ok(Self {
            conn: Arc::new(Mutex::new(conn)),
            reader,
        })
    }

    /// Open or create the canonical persistent SQLite RAG database under the unified state directory
    /// (`~/.aphrody/vector/rag.sqlite`).
    pub fn open_default() -> Result<Self> {
        let dir =
            aphrody_models::paths::vector_dir().map_err(|e| RagError::Other(e.to_string()))?;
        std::fs::create_dir_all(&dir)?;
        let path = dir.join("rag.sqlite");
        Self::open(path)
    }

    /// Open a transient in-memory database (useful for isolated tests).
    pub fn open_in_memory() -> Result<Self> {
        let conn = sqlite::open_in_memory(OpenPolicy::read_write()).map_err(sql_error)?;
        initialize_schema(&conn)?;
        Ok(Self {
            conn: Arc::new(Mutex::new(conn)),
            reader: None,
        })
    }

    /// Fold the WAL back into the database file and truncate it (call after bulk indexing).
    /// Returns `true` when the checkpoint completed; a concurrent reader can make it return
    /// `false` without error.
    pub async fn checkpoint(&self) -> Result<bool> {
        let conn = self.conn.lock().await;
        let checkpoint = sqlite::checkpoint_truncate(&conn).map_err(sql_error)?;
        Ok(!checkpoint.busy)
    }

    /// Upsert a document record. Returns the `doc_id`.
    pub async fn upsert_doc(
        &self,
        path: &str,
        hash: &str,
        title: Option<&str>,
        language: Option<&str>,
        mtime_ms: i64,
        size_bytes: i64,
    ) -> Result<i64> {
        let conn = self.conn.lock().await;

        conn.execute(
            r#"
            INSERT INTO docs (path, hash, title, language, mtime_ms, size_bytes)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6)
            ON CONFLICT(path) DO UPDATE SET
                hash = excluded.hash,
                title = excluded.title,
                language = excluded.language,
                mtime_ms = excluded.mtime_ms,
                size_bytes = excluded.size_bytes,
                created_at = datetime('now')
            "#,
            params![path, hash, title, language, mtime_ms, size_bytes],
        )?;

        // On conflict, last_insert_rowid still refers to an unrelated previous
        // insert. Resolve the document by its unique path in both cases.
        let doc_id = conn.query_row("SELECT id FROM docs WHERE path = ?1", [path], |row| {
            row.get(0)
        })?;
        Ok(doc_id)
    }

    /// Find a document by path.
    pub async fn get_doc_by_path(&self, path: &str) -> Result<Option<DocRecord>> {
        let conn = self.conn.lock().await;
        let mut stmt = conn.prepare(
            r#"
            SELECT id, path, hash, title, language, mtime_ms, size_bytes, created_at
            FROM docs WHERE path = ?1
            "#,
        )?;

        let record = stmt
            .query_row(params![path], |row| {
                Ok(DocRecord {
                    id: row.get(0)?,
                    path: row.get(1)?,
                    hash: row.get(2)?,
                    title: row.get(3)?,
                    language: row.get(4)?,
                    mtime_ms: row.get(5)?,
                    size_bytes: row.get(6)?,
                    created_at: row.get(7)?,
                })
            })
            .optional()?;

        Ok(record)
    }

    /// Upsert one document and replace all of its chunks atomically.
    pub(crate) async fn upsert_doc_chunks(
        &self,
        doc: NewDoc<'_>,
        chunks: &[NewChunk],
    ) -> Result<Vec<i64>> {
        let NewDoc {
            path,
            hash,
            title,
            language,
            mtime_ms,
            size_bytes,
        } = doc;
        let mut conn = self.conn.lock().await;
        let tx = conn.transaction()?;
        tx.execute(
            r#"
            INSERT INTO docs (path, hash, title, language, mtime_ms, size_bytes)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6)
            ON CONFLICT(path) DO UPDATE SET
                hash = excluded.hash,
                title = excluded.title,
                language = excluded.language,
                mtime_ms = excluded.mtime_ms,
                size_bytes = excluded.size_bytes,
                created_at = datetime('now')
            "#,
            params![path, hash, title, language, mtime_ms, size_bytes],
        )?;
        let doc_id: i64 = tx.query_row("SELECT id FROM docs WHERE path = ?1", [path], |row| {
            row.get(0)
        })?;
        tx.execute("DELETE FROM chunks WHERE doc_id = ?1", [doc_id])?;
        let mut ids = Vec::with_capacity(chunks.len());
        for chunk in chunks {
            tx.execute(
                r#"
                INSERT INTO chunks (doc_id, chunk_index, heading, symbol, content, start_line, end_line, token_count)
                VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
                "#,
                params![
                    doc_id,
                    ids.len() as i64,
                    chunk.heading,
                    chunk.symbol,
                    chunk.content,
                    chunk.start_line as i64,
                    chunk.end_line as i64,
                    chunk.token_count as i64,
                ],
            )?;
            ids.push(tx.last_insert_rowid());
        }
        tx.commit()?;
        Ok(ids)
    }

    /// Delete a document and its associated chunks / vectors (via cascade).
    pub async fn delete_doc(&self, doc_id: i64) -> Result<()> {
        let conn = self.conn.lock().await;
        conn.execute("DELETE FROM docs WHERE id = ?1", params![doc_id])?;
        Ok(())
    }

    /// Delete any existing chunks for a document prior to re-chunking.
    pub async fn clear_doc_chunks(&self, doc_id: i64) -> Result<()> {
        let conn = self.conn.lock().await;
        conn.execute("DELETE FROM chunks WHERE doc_id = ?1", params![doc_id])?;
        Ok(())
    }

    /// Insert a single chunk. Returns the new `chunk_id`.
    #[expect(
        clippy::too_many_arguments,
        reason = "Existing public API retained for consumer compatibility"
    )]
    pub async fn insert_chunk(
        &self,
        doc_id: i64,
        chunk_index: usize,
        heading: Option<&str>,
        symbol: Option<&str>,
        content: &str,
        start_line: usize,
        end_line: usize,
        token_count: usize,
    ) -> Result<i64> {
        let conn = self.conn.lock().await;
        conn.execute(
            r#"
            INSERT INTO chunks (doc_id, chunk_index, heading, symbol, content, start_line, end_line, token_count)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
            "#,
            params![
                doc_id,
                chunk_index as i64,
                heading,
                symbol,
                content,
                start_line as i64,
                end_line as i64,
                token_count as i64
            ],
        )?;

        Ok(conn.last_insert_rowid())
    }

    /// Store a dense vector embedding for a chunk.
    pub async fn insert_vector(
        &self,
        chunk_id: i64,
        model_id: &str,
        embedding: &[f32],
    ) -> Result<()> {
        let conn = self.conn.lock().await;
        let existing = conn
            .query_row("SELECT model_id FROM vectors LIMIT 1", [], |row| {
                row.get::<_, String>(0)
            })
            .optional()?;
        if let Some(expected) = existing
            && expected != model_id
        {
            return Err(RagError::ModelMismatch {
                expected,
                found: model_id.to_owned(),
            });
        }
        let mut blob = Vec::with_capacity(embedding.len() * 4);
        for &val in embedding {
            blob.extend_from_slice(&val.to_le_bytes());
        }

        conn.execute(
            r#"
            INSERT INTO vectors (chunk_id, model_id, dim, quant, embedding)
            VALUES (?1, ?2, ?3, 'f32', ?4)
            ON CONFLICT(chunk_id) DO UPDATE SET
                model_id = excluded.model_id,
                dim = excluded.dim,
                embedding = excluded.embedding
            "#,
            params![chunk_id, model_id, embedding.len() as i64, blob],
        )?;
        conn.execute(
            r#"
            INSERT INTO meta (key, value) VALUES ('embed_model_id', ?1)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value
            "#,
            params![model_id],
        )?;

        Ok(())
    }

    /// Store many dense vectors in one transaction (one lock, one fsync-batch,
    /// one model-lock check). Returns the number of vectors written.
    ///
    /// Same semantics and on-disk format as [`Self::insert_vector`]; a model
    /// mismatch aborts the whole batch before any row is written.
    pub async fn insert_vectors(&self, model_id: &str, items: &[(i64, Vec<f32>)]) -> Result<usize> {
        if items.is_empty() {
            return Ok(0);
        }
        let mut conn = self.conn.lock().await;
        let tx = conn.transaction()?;
        let existing = tx
            .query_row("SELECT model_id FROM vectors LIMIT 1", [], |row| {
                row.get::<_, String>(0)
            })
            .optional()?;
        if let Some(expected) = existing
            && expected != model_id
        {
            return Err(RagError::ModelMismatch {
                expected,
                found: model_id.to_owned(),
            });
        }
        let mut written = 0;
        {
            let mut stmt = tx.prepare(
                r#"
                INSERT INTO vectors (chunk_id, model_id, dim, quant, embedding)
                VALUES (?1, ?2, ?3, 'f32', ?4)
                ON CONFLICT(chunk_id) DO UPDATE SET
                    model_id = excluded.model_id,
                    dim = excluded.dim,
                    embedding = excluded.embedding
                "#,
            )?;
            let mut blob = Vec::new();
            for (chunk_id, embedding) in items {
                blob.clear();
                blob.reserve(embedding.len() * 4);
                for &val in embedding {
                    blob.extend_from_slice(&val.to_le_bytes());
                }
                stmt.execute(params![chunk_id, model_id, embedding.len() as i64, blob])?;
                written += 1;
            }
        }
        tx.execute(
            r#"
            INSERT INTO meta (key, value) VALUES ('embed_model_id', ?1)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value
            "#,
            params![model_id],
        )?;
        tx.commit()?;
        Ok(written)
    }

    /// Lock this index to one embedding space before vectors are written.
    ///
    /// Existing vectors are inspected as the source of truth so older indexes
    /// without metadata are repaired safely. A different model is rejected;
    /// callers must use a separate index or explicitly rebuild every vector.
    pub async fn ensure_embedding_model(&self, model_id: &str) -> Result<()> {
        let conn = self.conn.lock().await;
        let mut statement = conn.prepare("SELECT DISTINCT model_id FROM vectors LIMIT 2")?;
        let existing = statement
            .query_map([], |row| row.get::<_, String>(0))?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        if existing.len() > 1 {
            return Err(RagError::Other(
                "index contains vectors from multiple embedding models".to_owned(),
            ));
        }
        if let Some(expected) = existing.first()
            && expected != model_id
        {
            return Err(RagError::ModelMismatch {
                expected: expected.clone(),
                found: model_id.to_owned(),
            });
        }
        conn.execute(
            r#"
            INSERT INTO meta (key, value) VALUES ('embed_model_id', ?1)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value
            "#,
            params![model_id],
        )?;
        Ok(())
    }

    /// Perform FTS5 lexical search over chunks.
    pub async fn search_lexical(&self, query: &str, limit: usize) -> Result<Vec<ScoredChunk>> {
        let conn = self.conn.lock().await;

        // Escape query if needed or pass cleaned terms:
        let clean_query: String = query
            .chars()
            .map(|c| {
                if c.is_alphanumeric() || c == '_' {
                    c
                } else {
                    ' '
                }
            })
            .collect();
        let terms: Vec<&str> = clean_query.split_whitespace().collect();
        if terms.is_empty() {
            return Ok(Vec::new());
        }
        let match_expr = terms.join(" ");

        let mut stmt = conn.prepare(
            r#"
            SELECT c.id, c.doc_id, d.path, c.chunk_index, c.heading, c.symbol, c.content, c.start_line, c.end_line, c.token_count,
                   bm25(chunks_fts) as rank
            FROM chunks_fts
            JOIN chunks c ON chunks_fts.rowid = c.id
            JOIN docs d ON c.doc_id = d.id
            WHERE chunks_fts MATCH ?1
            ORDER BY rank ASC
            LIMIT ?2
            "#,
        )?;

        let rows = stmt.query_map(params![match_expr, limit as i64], |row| {
            let chunk = ChunkRecord {
                id: row.get(0)?,
                doc_id: row.get(1)?,
                path: row.get(2)?,
                chunk_index: row.get::<_, i64>(3)? as usize,
                heading: row.get(4)?,
                symbol: row.get(5)?,
                content: row.get(6)?,
                start_line: row.get::<_, i64>(7)? as usize,
                end_line: row.get::<_, i64>(8)? as usize,
                token_count: row.get::<_, i64>(9)? as usize,
            };
            // BM25 returns negative lower scores for better matches; normalize into positive:
            let raw_rank: f64 = row.get(10)?;
            let score = (-raw_rank).max(0.0) + 1.0;

            Ok(ScoredChunk {
                chunk,
                score,
                channel: "lexical".to_string(),
            })
        })?;

        let mut results = Vec::new();
        for r in rows {
            results.push(r?);
        }

        Ok(results)
    }

    /// Perform exact dense vector similarity search across all chunks for `model_id`.
    ///
    /// Two passes: (1) stream only `(chunk_id, embedding)` into one flat row-major
    /// matrix and select the exact top-`limit` with the bounded-heap kernel from
    /// `aphrody-rag-core` (no per-row chunk/doc join, no per-row `Vec`, no full
    /// sort); (2) hydrate chunk text only for the `limit` winners.
    ///
    /// The scan runs on a blocking thread: on the dedicated read-only connection for
    /// file-backed stores (writers are not blocked, WAL readers never block them), or,
    /// for in-memory stores, on the writer connection moved into `spawn_blocking`.
    pub async fn search_vector(
        &self,
        query_embedding: &[f32],
        model_id: &str,
        limit: usize,
    ) -> Result<Vec<ScoredChunk>> {
        let dim = query_embedding.len();
        if dim == 0 || limit == 0 {
            return Ok(Vec::new());
        }
        let query = query_embedding.to_vec();
        let model_id = model_id.to_owned();
        let joined = if let Some(reader) = &self.reader {
            let reader = Arc::clone(reader);
            tokio::task::spawn_blocking(move || {
                let conn = reader.lock().unwrap_or_else(PoisonError::into_inner);
                scan_vectors(&conn, &query, &model_id, limit)
            })
            .await
        } else {
            let conn = Arc::clone(&self.conn).lock_owned().await;
            tokio::task::spawn_blocking(move || scan_vectors(&conn, &query, &model_id, limit)).await
        };
        joined.map_err(|error| RagError::Other(format!("vector scan task failed: {error}")))?
    }

    /// Read a metadata key.
    pub async fn meta_get(&self, key: &str) -> Result<Option<String>> {
        let conn = self.conn.lock().await;
        let mut stmt = conn.prepare("SELECT value FROM meta WHERE key = ?1")?;
        let res = stmt.query_row(params![key], |row| row.get(0)).optional()?;
        Ok(res)
    }

    /// Set a metadata key.
    pub async fn meta_set(&self, key: &str, value: &str) -> Result<()> {
        let conn = self.conn.lock().await;
        conn.execute(
            r#"
            INSERT INTO meta (key, value) VALUES (?1, ?2)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value
            "#,
            params![key, value],
        )?;
        Ok(())
    }

    /// Collect database statistics.
    pub async fn stats(&self) -> Result<RagStats> {
        let conn = self.conn.lock().await;
        let doc_count: usize = conn
            .query_row("SELECT count(*) FROM docs", [], |r| r.get::<_, i64>(0))
            .map(|n| n as usize)?;
        let chunk_count: usize = conn
            .query_row("SELECT count(*) FROM chunks", [], |r| r.get::<_, i64>(0))
            .map(|n| n as usize)?;
        let vector_count: usize = conn
            .query_row("SELECT count(*) FROM vectors", [], |r| r.get::<_, i64>(0))
            .map(|n| n as usize)?;

        let embedding_model = conn
            .query_row(
                "SELECT value FROM meta WHERE key = 'embed_model_id'",
                [],
                |r| r.get(0),
            )
            .optional()?;

        Ok(RagStats {
            doc_count,
            chunk_count,
            vector_count,
            embedding_model,
        })
    }
}

/// Exact top-`limit` scan of the `vectors` table for `model_id` (blocking).
fn scan_vectors(
    conn: &Connection,
    query_embedding: &[f32],
    model_id: &str,
    limit: usize,
) -> Result<Vec<ScoredChunk>> {
    let dim = query_embedding.len();
    let mut ids: Vec<i64> = Vec::new();
    let mut matrix: Vec<f32> = Vec::new();
    {
        let mut stmt =
            conn.prepare("SELECT chunk_id, dim, embedding FROM vectors WHERE model_id = ?1")?;
        let mut rows = stmt.query(params![model_id])?;
        while let Some(row) = rows.next()? {
            let row_dim = row.get::<_, i64>(1)? as usize;
            let blob = row.get_ref(2)?.as_blob().map_err(|e| {
                rusqlite::Error::FromSqlConversionFailure(
                    2,
                    rusqlite::types::Type::Blob,
                    Box::new(e),
                )
            })?;
            if row_dim != dim || blob.len() != dim * 4 {
                continue;
            }
            ids.push(row.get(0)?);
            matrix.extend(
                blob.as_chunks::<4>()
                    .0
                    .iter()
                    .map(|bytes| f32::from_le_bytes(*bytes)),
            );
        }
    }

    let top = top_k_exact(query_embedding, &matrix, dim, limit);
    let mut stmt = conn.prepare(
        r#"
        SELECT c.id, c.doc_id, d.path, c.chunk_index, c.heading, c.symbol, c.content, c.start_line, c.end_line, c.token_count
        FROM chunks c
        JOIN docs d ON c.doc_id = d.id
        WHERE c.id = ?1
        "#,
    )?;
    let mut out = Vec::with_capacity(top.len());
    for (row_index, score) in top {
        let chunk_id = ids[row_index];
        let chunk = stmt
            .query_row(params![chunk_id], |row| {
                Ok(ChunkRecord {
                    id: row.get(0)?,
                    doc_id: row.get(1)?,
                    path: row.get(2)?,
                    chunk_index: row.get::<_, i64>(3)? as usize,
                    heading: row.get(4)?,
                    symbol: row.get(5)?,
                    content: row.get(6)?,
                    start_line: row.get::<_, i64>(7)? as usize,
                    end_line: row.get::<_, i64>(8)? as usize,
                    token_count: row.get::<_, i64>(9)? as usize,
                })
            })
            .optional()?;
        if let Some(chunk) = chunk {
            out.push(ScoredChunk {
                chunk,
                score: f64::from(score),
                channel: "vector".to_string(),
            });
        }
    }
    Ok(out)
}
