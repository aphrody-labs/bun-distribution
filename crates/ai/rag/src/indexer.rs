// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 aphrody contributors

//! Incremental filesystem scanner and chunk indexer with BLAKE3 content hashing,
//! .gitignore respect, and batched vector embedding generation.

use std::{path::Path, sync::Arc, time::Instant};

use aphrody_rag_core::{ChunkKind, ChunkOptions, chunker_for_path, detect_language};
use ignore::WalkBuilder;
use serde::{Deserialize, Serialize};
use tracing::{debug, warn};

use crate::{
    embedder::Embedder,
    error::Result,
    store::{NewChunk, NewDoc, RagStore},
};

/// Configuration options for the indexing pass.
#[derive(Debug, Clone)]
pub struct IndexOptions {
    /// Chunking strategy options.
    pub chunk_opts: ChunkOptions,
    /// Batch size for vector embedding computation.
    pub batch_size: usize,
    /// Force re-indexing even if BLAKE3 content hash matches existing record.
    pub force_reindex: bool,
    /// Explicit whitelist of file extensions (empty means allow all supported).
    pub extensions: Vec<String>,
    /// Maximum allowed file size in bytes before skipping (default 2 MiB).
    pub max_file_size: u64,
}

impl Default for IndexOptions {
    fn default() -> Self {
        Self {
            chunk_opts: ChunkOptions::default(),
            batch_size: 32,
            force_reindex: false,
            extensions: Vec::new(),
            max_file_size: 2 * 1024 * 1024,
        }
    }
}

/// Aggregated statistics from an indexing run.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct IndexStats {
    /// Total files encountered in directory walk.
    pub scanned_files: usize,
    /// Files successfully indexed (new or updated).
    pub indexed_files: usize,
    /// Files skipped because their hash did not change or size exceeded cap.
    pub skipped_files: usize,
    /// Total chunks created and stored.
    pub total_chunks: usize,
    /// Total dense vectors generated and stored.
    pub total_vectors: usize,
    /// Non-fatal file-level errors encountered.
    pub errors: Vec<String>,
    /// Duration of indexing run in milliseconds.
    pub elapsed_ms: u64,
}

/// Incremental repository and directory indexer.
pub struct RagIndexer {
    store: Arc<RagStore>,
    embedder: Option<Arc<dyn Embedder>>,
}

impl RagIndexer {
    /// Create a new indexer writing to `store`.
    pub fn new(store: Arc<RagStore>) -> Self {
        Self { store, embedder: None }
    }

    /// Attach an embedding model for automatic vector generation during indexing.
    pub fn with_embedder(mut self, embedder: Arc<dyn Embedder>) -> Self {
        self.embedder = Some(embedder);
        self
    }

    /// Recursively index a directory tree starting at `root_dir`.
    pub async fn index_directory(
        &self,
        root_dir: impl AsRef<Path>,
        opts: &IndexOptions,
    ) -> Result<IndexStats> {
        let root = root_dir.as_ref();
        let start = Instant::now();
        if let Some(embedder) = &self.embedder {
            self.store.ensure_embedding_model(embedder.model_id()).await?;
        }
        let mut stats = IndexStats::default();

        let walker = WalkBuilder::new(root)
            .hidden(false) // allows scanning .claude, etc. if needed, but gitignore still filters
            .git_ignore(true)
            .git_global(true)
            .git_exclude(true)
            .build();

        for entry_res in walker {
            let entry = match entry_res {
                Ok(e) => e,
                Err(err) => {
                    stats.errors.push(format!("Walk error: {err}"));
                    continue;
                },
            };

            let path = entry.path();
            if !path.is_file() {
                continue;
            }

            stats.scanned_files += 1;

            // Check extensions filter if provided
            if !opts.extensions.is_empty() {
                let ext = path
                    .extension()
                    .and_then(|e| e.to_str())
                    .unwrap_or_default()
                    .to_ascii_lowercase();
                if !opts.extensions.iter().any(|e| e.eq_ignore_ascii_case(&ext)) {
                    stats.skipped_files += 1;
                    continue;
                }
            }

            match self.index_file(path, root, opts).await {
                Ok(Some((chunks_count, vectors_count))) => {
                    stats.indexed_files += 1;
                    stats.total_chunks += chunks_count;
                    stats.total_vectors += vectors_count;
                },
                Ok(None) => {
                    stats.skipped_files += 1;
                },
                Err(err) => {
                    stats.errors.push(format!("Failed to index {}: {err}", path.display()));
                },
            }
        }

        if stats.indexed_files > 0 {
            // Bulk load finished: fold the WAL back into the database file.
            if let Err(error) = self.store.checkpoint().await {
                tracing::debug!(%error, "post-index WAL checkpoint failed");
            }
        }

        stats.elapsed_ms = start.elapsed().as_millis() as u64;
        Ok(stats)
    }

    /// Index a single file relative to `base_dir`. Returns `Some((chunks, vectors))` if indexed,
    /// or `None` if skipped.
    pub async fn index_file(
        &self,
        file_path: impl AsRef<Path>,
        base_dir: impl AsRef<Path>,
        opts: &IndexOptions,
    ) -> Result<Option<(usize, usize)>> {
        let abs_path = file_path.as_ref();
        let base = base_dir.as_ref();

        let rel_path_str =
            abs_path.strip_prefix(base).unwrap_or(abs_path).to_string_lossy().replace('\\', "/");

        let metadata = match tokio::fs::metadata(abs_path).await {
            Ok(m) => m,
            Err(err) => {
                debug!("Cannot read metadata for {}: {err}", abs_path.display());
                return Ok(None);
            },
        };

        if metadata.len() > opts.max_file_size {
            debug!(
                "Skipping {}: size {} exceeds max {}",
                abs_path.display(),
                metadata.len(),
                opts.max_file_size
            );
            return Ok(None);
        }

        let bytes = match tokio::fs::read(abs_path).await {
            Ok(b) => b,
            Err(err) => {
                warn!("Cannot read file {}: {err}", abs_path.display());
                return Ok(None);
            },
        };

        // Text verification: skip binary files
        let content_str = match std::str::from_utf8(&bytes) {
            Ok(s) => s,
            Err(_) => {
                debug!("Skipping non-UTF-8 binary file {}", abs_path.display());
                return Ok(None);
            },
        };

        let mtime_ms = metadata
            .modified()
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as i64)
            .unwrap_or(0);

        self.index_document(&rel_path_str, content_str, metadata.len() as i64, mtime_ms, opts).await
    }

    /// Index one in-memory document under a logical key.
    ///
    /// This is the path used by non-filesystem sources — notably content
    /// scraped by BXC, where `path_key` is the source URL. Chunking, hashing,
    /// chunk replacement and embedding are identical to [`Self::index_file`],
    /// which delegates here once it has read the file off disk.
    ///
    /// Returns `Some((chunks, vectors))`, or `None` when an identical document
    /// is already indexed and `force_reindex` is not set.
    ///
    /// # Errors
    ///
    /// Propagates store failures (upsert, chunk insertion, vector insertion).
    pub async fn index_document(
        &self,
        path_key: &str,
        content_str: &str,
        size_bytes: i64,
        mtime_ms: i64,
        opts: &IndexOptions,
    ) -> Result<Option<(usize, usize)>> {
        let rel_path_str = path_key.to_owned();
        let content_hash = blake3::hash(content_str.as_bytes()).to_hex().to_string();

        if !opts.force_reindex
            && let Some(doc) = self.store.get_doc_by_path(&rel_path_str).await?
            && doc.hash == content_hash
        {
            return Ok(None);
        }

        let lang = format!("{:?}", detect_language(&rel_path_str)).to_ascii_lowercase();

        // Prepare chunks before replacing anything. The shared store commits the
        // document metadata and all replacement chunks in one transaction.
        let chunks = {
            let chunker = chunker_for_path(&rel_path_str);
            chunker.chunk(&rel_path_str, content_str, &opts.chunk_opts)
        };
        let chunks: Vec<NewChunk> = chunks
            .iter()
            .map(|ch| NewChunk {
                heading: ch.symbol.clone().filter(|_| matches!(ch.kind, ChunkKind::Heading)),
                symbol: ch.symbol.clone().filter(|_| matches!(ch.kind, ChunkKind::Code)),
                content: ch.text.clone(),
                start_line: ch.start_line as usize,
                end_line: ch.end_line as usize,
                token_count: (ch.text.len() / 4).max(1),
            })
            .collect();
        let inserted_chunk_ids = self
            .store
            .upsert_doc_chunks(
                NewDoc {
                    path: &rel_path_str,
                    hash: &content_hash,
                    title: None,
                    language: Some(&lang),
                    mtime_ms,
                    size_bytes,
                },
                &chunks,
            )
            .await?;
        if inserted_chunk_ids.is_empty() {
            return Ok(Some((0, 0)));
        }
        let chunk_texts: Vec<String> = chunks.into_iter().map(|chunk| chunk.content).collect();

        // Generate vector embeddings if embedder configured
        let mut vector_count = 0;
        if let Some(ref emb) = self.embedder {
            let model_id = emb.model_id().to_string();

            // Process embeddings in batches
            for (chunk_ids_batch, texts_batch) in
                inserted_chunk_ids.chunks(opts.batch_size).zip(chunk_texts.chunks(opts.batch_size))
            {
                if let Ok(embeddings) = emb.embed_batch(texts_batch).await {
                    let items: Vec<(i64, Vec<f32>)> =
                        chunk_ids_batch.iter().copied().zip(embeddings).collect();
                    if let Ok(written) = self.store.insert_vectors(&model_id, &items).await {
                        vector_count += written;
                    }
                }
            }
        }

        Ok(Some((inserted_chunk_ids.len(), vector_count)))
    }
}
