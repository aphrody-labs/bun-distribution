// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 aphrody contributors

//! Shenron corpus loader and ingestion into Aphrody RAG storage.
//!
//! Parses and loads Dragon Ball encyclopedic corpora (such as `corpus-databooks.json`,
//! lot JSONL files, or raw Markdown passages) and indexes them into Aphrody's SQLite
//! [`RagStore`] with FTS5 lexical indexing and optional dense vector embeddings.

use std::{
    collections::HashSet,
    path::Path,
    sync::Arc,
    time::Instant,
};

use aphrody_rag_core::{ChunkOptions, chunker_for_path};
use serde::{Deserialize, Serialize};
use tracing::{debug, info, warn};

use crate::{
    embedder::Embedder,
    error::{RagError, Result},
    store::RagStore,
};

/// A normalized Shenron document before chunking and indexing.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ShenronCorpusDoc {
    /// Canonical document identifier (e.g. `databook-1`, `databook-1-p3`, `wiki:character:son-goku`).
    pub id: String,
    /// Human-readable title or book name.
    #[serde(default, alias = "titre", alias = "title")]
    pub name: Option<String>,
    /// Web URL or canonical relative wiki slug (e.g. `/wiki/databooks/1`, `/wiki/personnages/son-goku`).
    #[serde(default)]
    pub url: String,
    /// Markdown or raw text content of the document.
    #[serde(default, alias = "content", alias = "texte")]
    pub markdown: Option<String>,
    /// Language tag (`fr`, `ja`, `en`).
    #[serde(default)]
    pub lang: Option<String>,
    /// Optional entity tag (e.g. `Son Goku`, `Vegeta`).
    #[serde(default)]
    pub entity: Option<String>,
    /// Document kind (e.g. `databook`, `character`, `technique`, `saga`, `canon`).
    #[serde(default)]
    pub kind: Option<String>,
}

impl ShenronCorpusDoc {
    /// Return the most descriptive title available.
    pub fn display_title(&self) -> String {
        self.name
            .clone()
            .filter(|s| !s.trim().is_empty())
            .unwrap_or_else(|| self.id.clone())
    }

    /// Return the textual content, defaulting to empty string.
    pub fn text_content(&self) -> &str {
        self.markdown.as_deref().unwrap_or("").trim()
    }
}

/// Helper container for JSON files shaped like `{"docs": [...]}`.
#[derive(Debug, Deserialize)]
struct CorpusContainer {
    docs: Option<Vec<ShenronCorpusDoc>>,
}

/// Configuration options for Shenron corpus ingestion.
#[derive(Debug, Clone)]
pub struct ShenronIngestOptions {
    /// Maximum number of documents to ingest (useful for quick evaluation or sampling).
    pub max_docs: Option<usize>,
    /// Minimum text character length required for a document to be ingested.
    pub min_content_len: usize,
    /// Options controlling markdown chunk splitting.
    pub chunk_opts: ChunkOptions,
    /// Batch size for computing vector embeddings when an embedder is provided.
    pub batch_size: usize,
    /// Re-index documents even if already present.
    pub force: bool,
}

impl Default for ShenronIngestOptions {
    fn default() -> Self {
        Self {
            max_docs: None,
            min_content_len: 12,
            chunk_opts: ChunkOptions::default(),
            batch_size: 32,
            force: false,
        }
    }
}

/// Statistics returned after an ingestion run.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ShenronIngestStats {
    /// Total documents read from source.
    pub total_docs_read: usize,
    /// Documents successfully written to `docs` table.
    pub docs_ingested: usize,
    /// Chunks created and written to `chunks` / `chunks_fts`.
    pub chunks_created: usize,
    /// Dense vectors computed and stored.
    pub vectors_created: usize,
    /// Documents skipped (too short, empty, or duplicate).
    pub skipped: usize,
    /// Any non-fatal document errors encountered.
    pub errors: Vec<String>,
    /// Total elapsed time in milliseconds.
    pub elapsed_ms: u64,
}

/// Load a Shenron corpus from a JSON file, JSONL file, or directory containing such files.
pub fn load_shenron_corpus(path: impl AsRef<Path>) -> Result<Vec<ShenronCorpusDoc>> {
    let path = path.as_ref();
    if !path.exists() {
        return Err(RagError::Other(format!("Corpus path does not exist: {}", path.display())));
    }

    let mut docs = Vec::new();
    if path.is_file() {
        load_corpus_file(path, &mut docs)?;
    } else if path.is_dir() {
        for entry in std::fs::read_dir(path)? {
            let entry = entry?;
            let sub_path = entry.path();
            if sub_path.is_file() {
                let ext = sub_path
                    .extension()
                    .and_then(|e| e.to_str())
                    .unwrap_or("")
                    .to_ascii_lowercase();
                if ext == "json" || ext == "jsonl" {
                    let _ = load_corpus_file(&sub_path, &mut docs);
                }
            }
        }
    }

    Ok(docs)
}

fn load_corpus_file(path: &Path, docs: &mut Vec<ShenronCorpusDoc>) -> Result<()> {
    let content = std::fs::read_to_string(path)?;
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();

    if ext == "jsonl" {
        for (line_idx, line) in content.lines().enumerate() {
            let trimmed = line.trim();
            if trimmed.is_empty() || trimmed.starts_with("//") {
                continue;
            }
            match serde_json::from_str::<ShenronCorpusDoc>(trimmed) {
                Ok(doc) => docs.push(doc),
                Err(err) => {
                    debug!("Failed to parse line {} in {}: {err}", line_idx + 1, path.display());
                },
            }
        }
    } else {
        // Try parsing as {"docs": [...]}
        if let Ok(container) = serde_json::from_str::<CorpusContainer>(&content) {
            if let Some(inner) = container.docs {
                docs.extend(inner);
                return Ok(());
            }
        }
        // Try parsing directly as [...]
        if let Ok(array) = serde_json::from_str::<Vec<ShenronCorpusDoc>>(&content) {
            docs.extend(array);
            return Ok(());
        }
        warn!("Unrecognized JSON structure in {}", path.display());
    }

    Ok(())
}

/// Ingest a slice of [`ShenronCorpusDoc`] records into `store`.
pub async fn ingest_shenron_docs(
    store: &RagStore,
    docs: &[ShenronCorpusDoc],
    embedder: Option<&Arc<dyn Embedder>>,
    opts: &ShenronIngestOptions,
) -> Result<ShenronIngestStats> {
    let start = Instant::now();
    let mut stats = ShenronIngestStats {
        total_docs_read: docs.len(),
        ..Default::default()
    };

    if let Some(emb) = embedder {
        store.ensure_embedding_model(emb.model_id()).await?;
    }

    let mut seen_paths: HashSet<String> = HashSet::new();
    let limit = opts.max_docs.unwrap_or(docs.len()).min(docs.len());

    for doc in &docs[..limit] {
        let text = doc.text_content();
        if text.len() < opts.min_content_len {
            stats.skipped += 1;
            continue;
        }

        // Determine canonical document path / URL
        let raw_url = if doc.url.trim().is_empty() {
            format!("/wiki/databooks/{}", doc.id)
        } else {
            doc.url.trim().to_string()
        };

        // Normalize URL to lowercase path for boundary-aware retrieval
        let url_path = if let Some(stripped) = raw_url.strip_prefix("https://dragonballfr.com") {
            stripped.to_string()
        } else if let Some(stripped) = raw_url.strip_prefix("http://dragonballfr.com") {
            stripped.to_string()
        } else {
            raw_url
        };

        // Ensure unique document path in SQLite store
        let unique_path = if seen_paths.contains(&url_path) {
            format!("{url_path}#{}", doc.id)
        } else {
            url_path.clone()
        };
        seen_paths.insert(unique_path.clone());

        let hash = blake3::hash(text.as_bytes()).to_hex().to_string();
        let title = doc.display_title();
        let language = doc.lang.as_deref().unwrap_or("fr");
        let size_bytes = text.len() as i64;
        let mtime_ms = 0i64;

        let doc_id = match store
            .upsert_doc(&unique_path, &hash, Some(&title), Some(language), mtime_ms, size_bytes)
            .await
        {
            Ok(id) => id,
            Err(err) => {
                stats.errors.push(format!("Failed to upsert doc {}: {err}", doc.id));
                continue;
            },
        };

        stats.docs_ingested += 1;
        let _ = store.clear_doc_chunks(doc_id).await;

        // Chunking: for small passages, insert single chunk preserving title
        let mut chunks_to_embed = Vec::new();
        if text.len() <= 1200 {
            let token_count = (text.len() / 4).max(1);
            match store
                .insert_chunk(doc_id, 0, Some(&title), doc.entity.as_deref(), text, 1, 1, token_count)
                .await
            {
                Ok(chunk_id) => {
                    stats.chunks_created += 1;
                    if embedder.is_some() {
                        chunks_to_embed.push((chunk_id, text.to_string()));
                    }
                },
                Err(err) => {
                    stats.errors.push(format!("Insert chunk error for {}: {err}", doc.id));
                },
            }
        } else {
            let chunker = chunker_for_path(&format!("{unique_path}.md"));
            let chunks = chunker.chunk(&unique_path, text, &opts.chunk_opts);

            for (idx, c) in chunks.into_iter().enumerate() {
                let heading = c.symbol.as_deref().or(Some(&title));
                let symbol = doc.entity.as_deref();
                let token_count = (c.text.len() / 4).max(1);
                match store
                    .insert_chunk(
                        doc_id,
                        idx,
                        heading,
                        symbol,
                        &c.text,
                        c.start_line as usize,
                        c.end_line as usize,
                        token_count,
                    )
                    .await
                {
                    Ok(chunk_id) => {
                        stats.chunks_created += 1;
                        if embedder.is_some() {
                            chunks_to_embed.push((chunk_id, c.text));
                        }
                    },
                    Err(err) => {
                        stats.errors.push(format!("Insert chunk error in {}: {err}", doc.id));
                    },
                }
            }
        }

        // Compute dense embeddings if embedder is attached
        if let Some(emb) = embedder {
            for chunk_slice in chunks_to_embed.chunks(opts.batch_size) {
                let texts: Vec<String> = chunk_slice.iter().map(|(_, t)| t.clone()).collect();
                match emb.embed_batch(&texts).await {
                    Ok(vectors) => {
                        for ((chunk_id, _), vec) in chunk_slice.iter().zip(vectors) {
                            if let Ok(()) = store.insert_vector(*chunk_id, emb.model_id(), &vec).await {
                                stats.vectors_created += 1;
                            }
                        }
                    },
                    Err(err) => {
                        stats.errors.push(format!("Embedding batch failed: {err}"));
                    },
                }
            }
        }
    }

    stats.elapsed_ms = start.elapsed().as_millis() as u64;
    info!(
        "Ingested {} docs ({} chunks, {} vectors) in {} ms",
        stats.docs_ingested, stats.chunks_created, stats.vectors_created, stats.elapsed_ms
    );

    Ok(stats)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_corpus_doc_json() {
        let json = r##"{"id":"databook-1","name":"Dragon Ball Daizenshuu 1","url":"https://dragonballfr.com/wiki/databooks/1","markdown":"# Daizenshuu 1\n\nLe monde d'Akira Toriyama","lang":"fr"}"##;
        let doc: ShenronCorpusDoc = serde_json::from_str(json).unwrap();
        assert_eq!(doc.id, "databook-1");
        assert_eq!(doc.display_title(), "Dragon Ball Daizenshuu 1");
        assert_eq!(doc.lang.as_deref(), Some("fr"));
        assert!(doc.text_content().contains("Akira Toriyama"));
    }

    #[tokio::test]
    async fn ingest_shenron_docs_in_memory() {
        let store = RagStore::open_in_memory().unwrap();
        let docs = vec![
            ShenronCorpusDoc {
                id: "databook-1".to_string(),
                name: Some("Daizenshuu 1".to_string()),
                url: "/wiki/databooks/1".to_string(),
                markdown: Some("# Daizenshuu 1\n\nRecueil des illustrations couleur d'Akira Toriyama pour Dragon Ball.".to_string()),
                lang: Some("fr".to_string()),
                entity: Some("Son Goku".to_string()),
                kind: Some("databook".to_string()),
            },
            ShenronCorpusDoc {
                id: "kamehameha".to_string(),
                name: Some("Kamehameha".to_string()),
                url: "/wiki/techniques/kamehameha".to_string(),
                markdown: Some("Technique emblematique de Kame Sennin transmise a Son Goku.".to_string()),
                lang: Some("fr".to_string()),
                entity: Some("Kamehameha".to_string()),
                kind: Some("technique".to_string()),
            },
        ];

        let stats = ingest_shenron_docs(&store, &docs, None, &ShenronIngestOptions::default()).await.unwrap();
        assert_eq!(stats.docs_ingested, 2);
        assert_eq!(stats.chunks_created, 2);
        assert_eq!(stats.skipped, 0);

        // Verify lexical retrieval via FTS5
        let hits = store.search_lexical("Toriyama", 5).await.unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].chunk.path, "/wiki/databooks/1");

        let tech_hits = store.search_lexical("Kamehameha", 5).await.unwrap();
        assert_eq!(tech_hits.len(), 1);
        assert_eq!(tech_hits[0].chunk.path, "/wiki/techniques/kamehameha");
    }
}
