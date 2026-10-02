// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 aphrody contributors

//! Shenron corpus loader and ingestion into Aphrody RAG storage.
//!
//! Parses and loads Dragon Ball encyclopedic corpora (such as `corpus-databooks.json`,
//! lot JSONL files, or raw Markdown passages) and indexes them into Aphrody's SQLite
//! [`RagStore`] with FTS5 lexical indexing and optional dense vector embeddings.

use std::{collections::HashSet, path::Path, sync::Arc, time::Instant};

use aphrody_rag_core::{ChunkOptions, chunker_for_path};
use serde::{Deserialize, Serialize};
use sha2::{Digest as _, Sha256};
use tracing::info;

use crate::{
    embedder::Embedder,
    error::{RagError, Result},
    store::{NewChunk, NewDoc, RagStore},
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
            .as_deref()
            .map(str::trim)
            .filter(|name| !name.is_empty())
            .map(str::to_owned)
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
    /// Preserve source URLs as paths for older Shenron corpus consumers.
    pub preserve_urls: bool,
    /// Reproduce the historical Dragon Ball corpus paragraph chunk boundaries.
    pub legacy_chunks: bool,
}

impl Default for ShenronIngestOptions {
    fn default() -> Self {
        Self {
            max_docs: None,
            min_content_len: 12,
            chunk_opts: ChunkOptions::default(),
            batch_size: 32,
            force: false,
            preserve_urls: false,
            legacy_chunks: false,
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
    /// Documents already present with unchanged content.
    pub unchanged: usize,
    /// Any non-fatal document errors encountered.
    pub errors: Vec<String>,
    /// Total elapsed time in milliseconds.
    pub elapsed_ms: u64,
}

struct CorpusChunk {
    heading: Option<String>,
    text: String,
    start_line: usize,
    end_line: usize,
}

fn utf16_len(text: &str) -> usize {
    text.encode_utf16().count()
}

fn legacy_heading(line: &str) -> Option<String> {
    let level = line.bytes().take_while(|byte| *byte == b'#').count();
    if !(1..=6).contains(&level)
        || !line.get(level..)?.chars().next().is_some_and(char::is_whitespace)
    {
        return None;
    }
    let mut title = line[level..].trim_end();
    while title.ends_with('#') {
        title = title[..title.len() - 1].trim_end();
    }
    (!title.is_empty()).then(|| title.to_owned())
}

/// Match the former Bun corpus ingester's chunk shape exactly, including its
/// UTF-16 thresholds and inclusion of Markdown heading lines in chunk text.
fn legacy_corpus_chunks(text: &str, title: &str) -> Vec<CorpusChunk> {
    const SINGLE_CHUNK_MAX: usize = 1200;
    const TARGET_CHUNK_CHARS: usize = 1500;
    if utf16_len(text) <= SINGLE_CHUNK_MAX {
        return vec![CorpusChunk {
            heading: Some(title.to_owned()),
            text: text.to_owned(),
            start_line: 1,
            end_line: 1,
        }];
    }

    let lines: Vec<&str> = text.split('\n').collect();
    let mut chunks = Vec::new();
    let mut heading = title.to_owned();
    let mut buffer: Vec<&str> = Vec::new();
    let mut start_line = 1;
    let mut size = 0;
    for (index, line) in lines.iter().enumerate() {
        let line_no = index + 1;
        let next_heading = legacy_heading(line);
        let paragraph_end = line.trim().is_empty() && size >= TARGET_CHUNK_CHARS;
        let hard_cap = size + utf16_len(line) > TARGET_CHUNK_CHARS * 2;
        if next_heading.is_some() || paragraph_end || (hard_cap && !buffer.is_empty()) {
            let body = buffer.join("\n").trim().to_owned();
            if !body.is_empty() {
                chunks.push(CorpusChunk {
                    heading: Some(heading.clone()),
                    text: body,
                    start_line,
                    end_line: line_no.saturating_sub(1).max(start_line),
                });
            }
            buffer.clear();
            size = 0;
            start_line = line_no;
            if let Some(next_heading) = next_heading {
                heading = next_heading;
            }
        }
        buffer.push(line);
        size += utf16_len(line) + 1;
    }
    let body = buffer.join("\n").trim().to_owned();
    if !body.is_empty() {
        chunks.push(CorpusChunk {
            heading: Some(heading),
            text: body,
            start_line,
            end_line: lines.len().max(start_line),
        });
    }
    chunks
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
        let mut paths = std::fs::read_dir(path)?
            .map(|entry| entry.map(|entry| entry.path()))
            .collect::<std::io::Result<Vec<_>>>()?;
        paths.sort();
        for sub_path in paths {
            if sub_path.is_file() {
                let ext = sub_path
                    .extension()
                    .and_then(|e| e.to_str())
                    .unwrap_or("")
                    .to_ascii_lowercase();
                if ext == "json" || ext == "jsonl" {
                    load_corpus_file(&sub_path, &mut docs)?;
                }
            }
        }
    }

    Ok(docs)
}

fn load_corpus_file(path: &Path, docs: &mut Vec<ShenronCorpusDoc>) -> Result<()> {
    let content = std::fs::read_to_string(path)?;
    let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("").to_ascii_lowercase();

    if ext == "jsonl" {
        for (line_idx, line) in content.lines().enumerate() {
            let trimmed = line.trim();
            if trimmed.is_empty() || trimmed.starts_with("//") {
                continue;
            }
            match serde_json::from_str::<ShenronCorpusDoc>(trimmed) {
                Ok(doc) => docs.push(doc),
                Err(err) => {
                    return Err(RagError::Other(format!(
                        "invalid corpus JSON at {}:{}: {err}",
                        path.display(),
                        line_idx + 1
                    )));
                },
            }
        }
    } else {
        // Try parsing as {"docs": [...]}
        if let Ok(container) = serde_json::from_str::<CorpusContainer>(&content)
            && let Some(inner) = container.docs
        {
            docs.extend(inner);
            return Ok(());
        }
        // Try parsing directly as [...]
        if let Ok(array) = serde_json::from_str::<Vec<ShenronCorpusDoc>>(&content) {
            docs.extend(array);
            return Ok(());
        }
        return Err(RagError::Other(format!(
            "unrecognized corpus JSON structure in {}",
            path.display()
        )));
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
    let mut stats = ShenronIngestStats { total_docs_read: docs.len(), ..Default::default() };

    if let Some(emb) = embedder {
        store.ensure_embedding_model(emb.model_id()).await?;
    }

    let mut seen_paths: HashSet<String> = HashSet::new();
    let limit = opts.max_docs.unwrap_or(docs.len()).min(docs.len());

    for doc in &docs[..limit] {
        let text = doc.text_content();
        if utf16_len(text) < opts.min_content_len {
            stats.skipped += 1;
            continue;
        }

        // Determine canonical document path / URL
        let raw_url = if doc.url.trim().is_empty() {
            if opts.preserve_urls {
                format!("/corpus/{}", doc.id)
            } else {
                format!("/wiki/databooks/{}", doc.id)
            }
        } else {
            doc.url.trim().to_string()
        };

        // Older Shenron ingestion stored the complete source URL as `docs.path`.
        // Keep that identity when requested; otherwise use the normalized path.
        let url_path = if opts.preserve_urls {
            raw_url
        } else if let Some(stripped) = raw_url.strip_prefix("https://dragonballfr.com") {
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
        // The former Bun consumer stored SHA-256; accept that digest to avoid
        // rewriting unchanged rows while new Rust writes retain BLAKE3.
        let legacy_hash =
            Sha256::digest(text.as_bytes()).iter().map(|b| format!("{b:02x}")).collect::<String>();
        if !opts.force
            && store
                .get_doc_by_path(&unique_path)
                .await?
                .is_some_and(|existing| existing.hash == hash || existing.hash == legacy_hash)
        {
            stats.unchanged += 1;
            continue;
        }
        let title = doc.display_title();
        let language = doc.lang.as_deref().filter(|lang| !lang.is_empty()).unwrap_or("fr");

        // Chunking uses the historical corpus shape only for consumers that
        // explicitly request it; other RAG ingestion keeps the general chunker.
        let chunks = if opts.legacy_chunks {
            legacy_corpus_chunks(text, &title)
        } else if utf16_len(text) <= 1200 {
            vec![CorpusChunk {
                heading: Some(title.clone()),
                text: text.to_owned(),
                start_line: 1,
                end_line: 1,
            }]
        } else {
            chunker_for_path(&format!("{unique_path}.md"))
                .chunk(&unique_path, text, &opts.chunk_opts)
                .into_iter()
                .map(|chunk| CorpusChunk {
                    heading: chunk.symbol,
                    text: chunk.text,
                    start_line: chunk.start_line as usize,
                    end_line: chunk.end_line as usize,
                })
                .collect()
        };
        let chunks: Vec<NewChunk> = chunks
            .into_iter()
            .map(|chunk| NewChunk {
                heading: chunk.heading.or_else(|| Some(title.clone())),
                symbol: doc.entity.clone(),
                token_count: (utf16_len(&chunk.text) / 4).max(1),
                content: chunk.text,
                start_line: chunk.start_line,
                end_line: chunk.end_line,
            })
            .collect();
        let chunk_ids = match store
            .upsert_doc_chunks(
                NewDoc {
                    path: &unique_path,
                    hash: &hash,
                    title: Some(&title),
                    language: Some(language),
                    mtime_ms: 0,
                    size_bytes: text.len() as i64,
                },
                &chunks,
            )
            .await
        {
            Ok(ids) => ids,
            Err(err) => {
                stats.errors.push(format!("Failed to replace document {}: {err}", doc.id));
                continue;
            },
        };
        stats.docs_ingested += 1;
        stats.chunks_created += chunk_ids.len();
        let chunks_to_embed: Vec<(i64, String)> =
            chunk_ids.into_iter().zip(chunks.into_iter().map(|chunk| chunk.content)).collect();

        // Compute dense embeddings if embedder is attached
        if let Some(emb) = embedder {
            for chunk_slice in chunks_to_embed.chunks(opts.batch_size) {
                let texts: Vec<String> = chunk_slice.iter().map(|(_, t)| t.clone()).collect();
                match emb.embed_batch(&texts).await {
                    Ok(vectors) => {
                        for ((chunk_id, _), vec) in chunk_slice.iter().zip(vectors) {
                            if let Ok(()) =
                                store.insert_vector(*chunk_id, emb.model_id(), &vec).await
                            {
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

        let stats = ingest_shenron_docs(&store, &docs, None, &ShenronIngestOptions::default())
            .await
            .unwrap();
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
