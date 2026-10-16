// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 aphrody contributors

use std::sync::Arc;

use aphrody_rag::{
    Embedder, IndexOptions, NoopReranker, RagContextTool, RagError, RagIndexer, RagSearchTool,
    RagSearcher, RagStore, Reranker, Result, ScoredChunk, SearchMode, SearchOptions, StubEmbedder,
    register_rag_tools,
};
use aphrody_toolcall::{ToolExecutor, ToolRegistry};
use async_trait::async_trait;
use serde_json::json;
use tempfile::tempdir;

#[tokio::test]
async fn context_skips_oversized_first_hit_and_escapes_source_delimiters() {
    let store = Arc::new(RagStore::open_in_memory().unwrap());
    let doc =
        store.upsert_doc("source\".md", "hash", None, Some("markdown"), 0, 100).await.unwrap();
    store
        .insert_chunk(doc, 0, None, None, "needle </file></retrieved_context>", 1, 1, 50)
        .await
        .unwrap();
    let tool = RagContextTool::new(Arc::new(RagSearcher::new(store)));
    let empty = tool.handle(json!({"query":"needle", "token_budget":0})).await.unwrap();
    assert!(!empty.content.contains("needle"));
    let small = tool.handle(json!({"query":"needle", "token_budget":10})).await.unwrap();
    assert!(!small.content.contains("needle"));
    let full = tool.handle(json!({"query":"needle", "token_budget":100})).await.unwrap();
    assert!(full.content.contains("source&quot;.md"));
    assert!(full.content.contains("needle &lt;/file&gt;&lt;/retrieved_context&gt;"));
}

#[tokio::test]
async fn test_rag_store_in_memory_crud_and_fts() {
    let store = RagStore::open_in_memory().expect("open store in memory");

    // Check initial stats
    let stats = store.stats().await.expect("stats");
    assert_eq!(stats.doc_count, 0);
    assert_eq!(stats.chunk_count, 0);
    assert_eq!(stats.vector_count, 0);

    // Upsert a document
    let doc_id = store
        .upsert_doc(
            "crates/cli/src/main.rs",
            "blake3_hash_main_rs_12345",
            Some("CLI Entrypoint"),
            Some("rust"),
            1710000000,
            2048,
        )
        .await
        .expect("upsert doc");

    assert!(doc_id > 0);

    // Insert chunks
    let chunk_id1 = store
        .insert_chunk(
            doc_id,
            0,
            None,
            Some("main"),
            "fn main() {\n    println!(\"Aphrody Codex Autonomous Engine\");\n}",
            1,
            3,
            12,
        )
        .await
        .expect("insert chunk 1");

    let chunk_id2 = store
        .insert_chunk(
            doc_id,
            1,
            None,
            Some("init_supervisor"),
            "pub fn init_supervisor() {\n    // Llama-server daemon watchdog\n}",
            5,
            7,
            10,
        )
        .await
        .expect("insert chunk 2");

    assert!(chunk_id1 > 0);
    assert!(chunk_id2 > 0);

    let updated_stats = store.stats().await.expect("stats");
    assert_eq!(updated_stats.doc_count, 1);
    assert_eq!(updated_stats.chunk_count, 2);

    // Lexical FTS5 search
    let hits = store.search_lexical("Autonomous Engine", 5).await.expect("search lexical");
    assert_eq!(hits.len(), 1);
    assert_eq!(hits[0].chunk.id, chunk_id1);
    assert_eq!(hits[0].chunk.symbol.as_deref(), Some("main"));
    assert_eq!(hits[0].channel, "lexical");

    // Lexical search for supervisor
    let hits2 = store.search_lexical("watchdog", 5).await.expect("search lexical");
    assert_eq!(hits2.len(), 1);
    assert_eq!(hits2[0].chunk.id, chunk_id2);

    // Delete chunks and verify FTS trigger synchronization
    store.clear_doc_chunks(doc_id).await.expect("clear chunks");
    let hits_cleared = store.search_lexical("watchdog", 5).await.expect("search lexical");
    assert!(hits_cleared.is_empty());
}

#[tokio::test]
async fn test_rag_store_dense_vector_storage_and_scan() {
    let store = RagStore::open_in_memory().expect("open store");

    let doc_id = store
        .upsert_doc(
            "docs/architecture.md",
            "hash_arch_001",
            Some("Architecture"),
            Some("markdown"),
            1710000000,
            1024,
        )
        .await
        .expect("upsert doc");

    let chunk_id = store
        .insert_chunk(
            doc_id,
            0,
            Some("System Overview"),
            None,
            "# System Overview\nDual-agent coordination over A2A protocol.",
            1,
            2,
            15,
        )
        .await
        .expect("insert chunk");

    let embedder = StubEmbedder::new();
    let query_text = "coordination protocol agent";
    let query_vector = embedder.embed_query(query_text).await.expect("embed query");

    // Produce embedding for chunk content
    let chunk_text = "# System Overview\nDual-agent coordination over A2A protocol.";
    let chunk_vector = embedder.embed_query(chunk_text).await.expect("embed chunk");

    store.insert_vector(chunk_id, embedder.model_id(), &chunk_vector).await.expect("insert vector");

    let stats = store.stats().await.expect("stats");
    assert_eq!(stats.vector_count, 1);
    assert_eq!(stats.embedding_model.as_deref(), Some(embedder.model_id()));
    let mismatch = store.insert_vector(chunk_id, "other-space", &chunk_vector).await.unwrap_err();
    assert!(matches!(mismatch, aphrody_rag::RagError::ModelMismatch { .. }));

    // Scan vectors with exact chunk vector -> similarity should be ~1.0
    let exact_results =
        store.search_vector(&chunk_vector, embedder.model_id(), 5).await.expect("search vector");

    assert_eq!(exact_results.len(), 1);
    assert_eq!(exact_results[0].chunk.id, chunk_id);
    assert_eq!(exact_results[0].channel, "vector");
    assert!((exact_results[0].score - 1.0).abs() < 1e-4);

    // Scan with query vector -> similarity is within [-1.0, 1.0]
    let query_results =
        store.search_vector(&query_vector, embedder.model_id(), 5).await.expect("search vector");

    assert_eq!(query_results.len(), 1);
    assert!(query_results[0].score >= -1.0 && query_results[0].score <= 1.0);
}

#[tokio::test]
async fn test_rag_hybrid_searcher_and_honest_degrade() {
    let store = Arc::new(RagStore::open_in_memory().expect("open store"));

    let doc_id = store
        .upsert_doc("crates/demo/test.rs", "hash_demo", None, Some("rust"), 1710000000, 500)
        .await
        .expect("upsert doc");

    let c1 = store
        .insert_chunk(
            doc_id,
            0,
            None,
            Some("calculate_fib"),
            "fn calculate_fib(n: u32) -> u64 { /* fibonacci sequence */ }",
            1,
            5,
            15,
        )
        .await
        .expect("c1");

    // Case 1: Searcher WITHOUT embedder requested in Hybrid mode -> Honest degrade to Lexical
    let searcher_no_emb = RagSearcher::new(store.clone());
    let opts = SearchOptions { limit: 5, mode: SearchMode::Hybrid, ..Default::default() };

    let res1 = searcher_no_emb.search("calculate_fib", &opts).await.expect("search");
    assert_eq!(res1.mode_served, SearchMode::Lexical);
    assert!(res1.fallback_reason.is_some());
    assert_eq!(res1.hits.len(), 1);
    assert_eq!(res1.hits[0].chunk.id, c1);
    assert_eq!(res1.hits[0].channel, "lexical");

    // Case 2: Searcher WITH embedder and NoopReranker in Hybrid mode
    let embedder = Arc::new(StubEmbedder::new());
    let emb_vec = embedder
        .embed_query("fn calculate_fib(n: u32) -> u64 { /* fibonacci sequence */ }")
        .await
        .expect("embed");

    store.insert_vector(c1, embedder.model_id(), &emb_vec).await.expect("insert vector");

    let reranker = Arc::new(NoopReranker::new());
    let searcher_full =
        RagSearcher::new(store.clone()).with_embedder(embedder).with_reranker(reranker);

    let res2 = searcher_full.search("fibonacci sequence", &opts).await.expect("hybrid search");

    assert_eq!(res2.mode_served, SearchMode::Hybrid);
    assert!(res2.fallback_reason.is_none());
    assert_eq!(res2.hits.len(), 1);
    assert_eq!(res2.hits[0].chunk.id, c1);
    // Channel is updated to "rerank" after passing through reranker
    assert_eq!(res2.hits[0].channel, "rerank");
}

struct FailingReranker;

#[async_trait]
impl Reranker for FailingReranker {
    fn model_id(&self) -> &str {
        "failing-reranker"
    }

    async fn rerank(&self, _query: &str, _candidates: &mut [ScoredChunk]) -> Result<()> {
        Err(RagError::RerankFailed("deliberate test failure".to_string()))
    }
}

#[tokio::test]
async fn test_reranker_failure_is_reported_as_an_honest_fallback() {
    let store = Arc::new(RagStore::open_in_memory().expect("open store"));
    let doc_id = store
        .upsert_doc("docs/fallback.md", "hash", None, Some("markdown"), 1, 10)
        .await
        .expect("upsert doc");
    store
        .insert_chunk(doc_id, 0, None, None, "managed reranking fallback", 1, 1, 3)
        .await
        .expect("insert chunk");

    let searcher = RagSearcher::new(store).with_reranker(Arc::new(FailingReranker));
    let options =
        SearchOptions { mode: SearchMode::Lexical, rerank: true, ..SearchOptions::default() };
    let result = searcher.search("reranking fallback", &options).await.expect("search");

    assert_eq!(result.mode_served, SearchMode::Lexical);
    assert_eq!(result.hits[0].channel, "lexical");
    let reason = result.fallback_reason.expect("fallback reason");
    assert!(reason.contains("failing-reranker"), "{reason}");
    assert!(reason.contains("deliberate test failure"), "{reason}");
}

#[tokio::test]
async fn test_rag_indexer_incremental_walk() {
    let tmp = tempdir().expect("tempdir");
    let file1 = tmp.path().join("alpha.rs");
    let file2 = tmp.path().join("beta.md");

    tokio::fs::write(&file1, "pub fn alpha() {\n    // alpha code\n}\n")
        .await
        .expect("write file1");
    tokio::fs::write(&file2, "# Title Beta\n\nSection details about beta implementation.\n")
        .await
        .expect("write file2");

    let store = Arc::new(RagStore::open_in_memory().expect("open store"));
    let embedder = Arc::new(StubEmbedder::new());
    let indexer = RagIndexer::new(store.clone()).with_embedder(embedder);

    let opts = IndexOptions::default();

    // 1st run: all files indexed
    let stats1 = indexer.index_directory(tmp.path(), &opts).await.expect("index 1");

    assert_eq!(stats1.scanned_files, 2);
    assert_eq!(stats1.indexed_files, 2);
    assert_eq!(stats1.skipped_files, 0);
    assert!(stats1.total_chunks >= 2);
    assert!(stats1.total_vectors >= 2);

    // 2nd run: unchanged hashes -> all files skipped
    let stats2 = indexer.index_directory(tmp.path(), &opts).await.expect("index 2");

    assert_eq!(stats2.scanned_files, 2);
    assert_eq!(stats2.indexed_files, 0);
    assert_eq!(stats2.skipped_files, 2);

    // 3rd run: modify file1 -> only file1 re-indexed
    tokio::fs::write(&file1, "pub fn alpha_updated() {\n    // updated alpha\n}\n")
        .await
        .expect("modify file1");

    let stats3 = indexer.index_directory(tmp.path(), &opts).await.expect("index 3");

    assert_eq!(stats3.indexed_files, 1);
    assert_eq!(stats3.skipped_files, 1);
}

#[tokio::test]
async fn test_rag_agent_tools() {
    let store = Arc::new(RagStore::open_in_memory().expect("open store"));
    let embedder = Arc::new(StubEmbedder::new());

    let doc_id = store
        .upsert_doc("crates/cli/src/exec.rs", "hash_exec", None, Some("rust"), 1710000000, 1000)
        .await
        .expect("upsert doc");

    let chunk_id = store
        .insert_chunk(
            doc_id,
            0,
            None,
            Some("run_exec_subcommand"),
            "pub async fn run_exec_subcommand(query: &str) -> Result<()> {\n    // execution \
             logic\n}",
            1,
            3,
            12,
        )
        .await
        .expect("insert chunk");

    let emb = embedder.embed_query("pub async fn run_exec_subcommand").await.expect("embed");
    store.insert_vector(chunk_id, embedder.model_id(), &emb).await.expect("insert vector");

    let searcher = Arc::new(RagSearcher::new(store).with_embedder(embedder));

    // Test RagSearchTool
    let search_tool = RagSearchTool::new(searcher.clone());
    let search_res = search_tool
        .handle(json!({
            "query": "run_exec_subcommand",
            "limit": 3
        }))
        .await
        .expect("search tool handle");

    assert!(!search_res.is_error);
    assert!(search_res.content.contains("run_exec_subcommand"));
    assert!(search_res.content.contains("crates/cli/src/exec.rs"));

    // Test RagContextTool
    let context_tool = RagContextTool::new(searcher.clone());
    let context_res = context_tool
        .handle(json!({
            "query": "execution logic",
            "token_budget": 500
        }))
        .await
        .expect("context tool handle");

    assert!(!context_res.is_error);
    let text = &context_res.content;
    assert!(text.starts_with("<retrieved_context>"));
    assert!(text.ends_with("</retrieved_context>"));
    assert!(text.contains("crates/cli/src/exec.rs"));

    // Test registry registration helper
    let mut registry = ToolRegistry::new();
    register_rag_tools(&mut registry, searcher);
    assert!(registry.get("rag_search").is_some());
    assert!(registry.get("rag_context").is_some());
}

/// `index_document` is the BXC ingestion path: a URL key, in-memory markdown,
/// no filesystem. It must chunk, dedupe on identical content, and honour
/// `force_reindex`.
#[tokio::test]
async fn test_index_document_ingests_scraped_content_under_a_url_key() {
    let store = Arc::new(RagStore::open_in_memory().expect("open store"));
    let embedder = Arc::new(StubEmbedder::new());
    let indexer = RagIndexer::new(store.clone()).with_embedder(embedder);

    let url = "https://example.invalid/guide.html";
    let markdown = "# Guide\n\nA scraped page body with enough prose to chunk.\n";
    let opts = IndexOptions::default();

    let first = indexer
        .index_document(url, markdown, markdown.len() as i64, 1_700_000_000_000, &opts)
        .await
        .expect("first ingest")
        .expect("first ingest indexes");
    assert!(first.0 > 0, "expected at least one chunk");

    // The URL is the document key, so identical content is a no-op.
    let repeat = indexer
        .index_document(url, markdown, markdown.len() as i64, 1_700_000_000_001, &opts)
        .await
        .expect("repeat ingest");
    assert!(repeat.is_none(), "unchanged content must not be re-indexed");

    let forced = IndexOptions { force_reindex: true, ..IndexOptions::default() };
    let again = indexer
        .index_document(url, markdown, markdown.len() as i64, 1_700_000_000_002, &forced)
        .await
        .expect("forced ingest");
    assert!(again.is_some(), "force_reindex must re-index identical content");

    // Re-ingesting replaces chunks rather than accumulating them.
    let doc = store.get_doc_by_path(url).await.expect("lookup").expect("document present");
    assert_eq!(doc.path, url);
}

/// End-to-end pipeline test for Qwen3-Embedding (asymmetric prompt + MRL-512) and
/// cross-encoder reranker (re-ranking candidate pool into top results).
#[tokio::test]
async fn test_qwen3_hybrid_rag_with_mrl_and_reranker() {
    use aphrody_rag::{
        MATRYOSHKA_512_DIM, QWEN3_QUERY_INSTRUCTION, format_query_or_passage,
        truncate_and_normalize_mrl,
    };

    // 1. Verify Qwen3 prompt asymmetry
    let raw_query = "What is Aphrody RAG pipeline?";
    let formatted_query = format_query_or_passage("qwen3-embedding-0.6b", raw_query, true);
    assert!(formatted_query.starts_with(QWEN3_QUERY_INSTRUCTION));
    assert!(formatted_query.ends_with(raw_query));

    let raw_doc = "Aphrody RAG pipeline combines lexical FTS5 and dense vector search.";
    let formatted_doc = format_query_or_passage("qwen3-embedding-0.6b", raw_doc, false);
    assert_eq!(formatted_doc, raw_doc);

    // 2. Verify Matryoshka 512-d truncation & L2 normalisation
    let mut full_vec = vec![0.5_f32; 1024];
    truncate_and_normalize_mrl(&mut full_vec, MATRYOSHKA_512_DIM);
    assert_eq!(full_vec.len(), 512);
    let norm: f32 = full_vec.iter().map(|x| x * x).sum::<f32>().sqrt();
    assert!((norm - 1.0).abs() < 1e-5);

    // 3. Initialize RAG store with 512-dim stub representing Qwen3-Embedding-0.6B truncated MRL
    let store = Arc::new(RagStore::open_in_memory().expect("open store"));
    let embedder =
        Arc::new(StubEmbedder::with_model_and_dim("qwen3-embedding-0.6b", MATRYOSHKA_512_DIM));

    // Index 6 documents
    let doc_id = store
        .upsert_doc("docs/architecture.md", "hash_qwen3", Some("Arch"), Some("markdown"), 0, 1000)
        .await
        .expect("upsert doc");

    let chunk_texts = [
        "Passage 0: irrelevant noise about fruit and gardening.",
        "Passage 1: database indexing with sqlite and postgres.",
        "Passage 2: Qwen3-Embedding-0.6B produces high quality dense vectors.",
        "Passage 3: Qwen3-Reranker-0.6B scores query passage relevance with cross-encoder.",
        "Passage 4: Matryoshka representation learning allows truncation to 512 dimensions.",
        "Passage 5: Hybrid RAG combines reciprocal rank fusion with neural reranking.",
    ];

    let mut chunk_ids = Vec::new();
    for (i, text) in chunk_texts.iter().enumerate() {
        let cid = store
            .insert_chunk(doc_id, i, None, None, text, i * 10 + 1, (i + 1) * 10, 20)
            .await
            .expect("insert chunk");
        chunk_ids.push(cid);

        let vec = embedder.embed_batch(&[text.to_string()]).await.expect("embed batch")[0].clone();
        assert_eq!(vec.len(), 512);
        store.insert_vector(cid, embedder.model_id(), &vec).await.expect("insert vector");
    }

    // Custom cross-encoder Mock scoring mimicking Qwen3-Reranker-0.6B-q8
    struct MockQwen3Reranker;
    #[async_trait]
    impl Reranker for MockQwen3Reranker {
        fn model_id(&self) -> &str {
            "qwen3-reranker-0.6b-q8"
        }

        async fn rerank(&self, query: &str, candidates: &mut [ScoredChunk]) -> Result<()> {
            // Assign score based on semantic relevance to query words
            let q_lower = query.to_ascii_lowercase();
            let terms: Vec<&str> = q_lower.split_whitespace().collect();

            for c in candidates.iter_mut() {
                let text_lower = c.chunk.content.to_ascii_lowercase();
                let mut match_count = 0;
                for term in &terms {
                    if text_lower.contains(term) {
                        match_count += 1;
                    }
                }
                c.score = (match_count as f64) * 0.45;
            }

            // Cross-encoder sorts descending by score
            candidates.sort_by(|a, b| b.score.total_cmp(&a.score));
            Ok(())
        }
    }

    let reranker = Arc::new(MockQwen3Reranker);
    let searcher =
        RagSearcher::new(store.clone()).with_embedder(embedder.clone()).with_reranker(reranker);

    // Search query asking for Qwen3 reranker and Matryoshka
    let opts = SearchOptions {
        limit: 3,
        mode: SearchMode::Hybrid,
        rerank: true,
        rerank_top_n: 6,
        path_prefix: None,
        rrf_k: 60.0,
    };

    let result = searcher
        .search("Qwen3-Reranker cross-encoder scoring", &opts)
        .await
        .expect("search result");

    assert_eq!(result.mode_served, SearchMode::Hybrid);
    assert_eq!(result.hits.len(), 3);
    assert_eq!(result.hits[0].channel, "rerank");
    // Passage 3 has the highest match count for the reranker query
    assert!(result.hits[0].chunk.content.contains("Qwen3-Reranker-0.6B"));
    assert!(result.hits[0].score > 0.0);
}

/// A failed replacement must preserve metadata, lexical chunks and dense
/// vectors together, so the unchanged hash remains retryable.
#[tokio::test]
async fn index_document_failure_preserves_previous_corpus_and_retries() {
    let dir = tempdir().unwrap();
    let db = dir.path().join("rag.sqlite");
    let store = Arc::new(RagStore::open(&db).unwrap());
    let indexer = RagIndexer::new(store.clone())
        .with_embedder(Arc::new(StubEmbedder::with_model_and_dim("stub-8", 8)));
    let opts = IndexOptions::default();
    let original = "# Original\n\nneedle original corpus.";
    let replacement = "# Replacement\n\nreplacement corpus.";
    indexer.index_document("source.md", original, 42, 1, &opts).await.unwrap();
    let before = store.get_doc_by_path("source.md").await.unwrap().unwrap();
    let before_stats = store.stats().await.unwrap();
    assert!(before_stats.vector_count > 0);
    let conn = rusqlite::Connection::open(&db).unwrap();
    conn.execute_batch("CREATE TRIGGER reject_replacement BEFORE INSERT ON chunks BEGIN SELECT RAISE(ABORT, 'injected failure'); END;").unwrap();

    assert!(indexer.index_document("source.md", replacement, 99, 2, &opts).await.is_err());
    let after = store.get_doc_by_path("source.md").await.unwrap().unwrap();
    assert_eq!(after.id, before.id);
    assert_eq!(after.hash, before.hash);
    assert_eq!(
        (after.title, after.language, after.size_bytes, after.mtime_ms),
        (before.title, before.language, before.size_bytes, before.mtime_ms)
    );
    let after_stats = store.stats().await.unwrap();
    assert_eq!(after_stats.chunk_count, before_stats.chunk_count);
    assert_eq!(after_stats.vector_count, before_stats.vector_count);
    assert!(!store.search_lexical("needle", 10).await.unwrap().is_empty());
    assert!(store.search_lexical("replacement", 10).await.unwrap().is_empty());

    conn.execute_batch("DROP TRIGGER reject_replacement;").unwrap();
    assert!(
        indexer.index_document("source.md", replacement, 99, 2, &opts).await.unwrap().is_some()
    );
    assert!(store.search_lexical("needle", 10).await.unwrap().is_empty());
    assert!(!store.search_lexical("replacement", 10).await.unwrap().is_empty());
    assert_eq!(store.get_doc_by_path("source.md").await.unwrap().unwrap().mtime_ms, 2);
}

#[tokio::test]
async fn index_document_empty_replacement_clears_chunks_and_vectors() {
    let store = Arc::new(RagStore::open_in_memory().unwrap());
    let indexer = RagIndexer::new(store.clone())
        .with_embedder(Arc::new(StubEmbedder::with_model_and_dim("stub-8", 8)));
    let opts = IndexOptions::default();
    indexer.index_document("source.md", "original needle", 15, 1, &opts).await.unwrap();
    assert!(store.stats().await.unwrap().vector_count > 0);
    assert_eq!(indexer.index_document("source.md", "", 0, 2, &opts).await.unwrap(), Some((0, 0)));
    let stats = store.stats().await.unwrap();
    assert_eq!((stats.doc_count, stats.chunk_count, stats.vector_count), (1, 0, 0));
    assert!(store.search_lexical("needle", 10).await.unwrap().is_empty());
    assert_eq!(indexer.index_document("source.md", "", 0, 3, &opts).await.unwrap(), None);
}

#[tokio::test]
async fn upsert_doc_returns_its_own_id_after_other_inserts() {
    let store = RagStore::open_in_memory().unwrap();
    let first = store.upsert_doc("first.md", "old", None, None, 1, 10).await.unwrap();
    let second = store.upsert_doc("second.md", "second", None, None, 1, 10).await.unwrap();
    assert_ne!(first, second);
    let updated = store.upsert_doc("first.md", "new", None, None, 2, 20).await.unwrap();
    assert_eq!(updated, first);
    assert_eq!(store.get_doc_by_path("first.md").await.unwrap().unwrap().hash, "new");
    assert_eq!(store.get_doc_by_path("second.md").await.unwrap().unwrap().id, second);
}
