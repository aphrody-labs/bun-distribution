# RAG native integration plan (LlamaIndex concepts, pure-Rust in-process)

Status: 2026-10-01. Owner area: `crates/ai/{rag,rag-core,rag-eval,rag-python,embed,memory,context,summary,train,ocr*}`.
Constraint set: no vendoring, no subprocess on the hot path, no duplicate capability, preserve crate
names, APIs, CLI args, schemas and the on-disk format of existing indexes.

LlamaIndex (MIT, `llama-index-core`) is used as a concept reference only. No source is copied. The
abstraction names below (Document/Node, NodeParser, VectorStore, Retriever, NodePostprocessor,
QueryEngine, IngestionPipeline) are borrowed as design vocabulary and are attributed here.

## 1. Inventory result

| Crate | Role | Python / subprocess |
| --- | --- | --- |
| `aphrody-rag-core` | pure chunkers (Rust, TS/JS via oxc, Markdown, structural, prose), RRF, weighted RRF, MMR, dedup, int8 quantisation, exact top-k, eval metrics, f32/f64 vector kernels | none |
| `aphrody-rag` | SQLite FTS5 + vector BLOB store, `RagSearcher` (lexical/vector/hybrid + rerank), `RagIndexer` (ignore-aware, blake3 incremental), agent tools, Postgres + Redis shenron adapters, `Embedder`/`Reranker` traits | none (HTTP to llama-server only, see below) |
| `aphrody-embed` | `embeddings` (fastembed/ORT), `native` (pure-Rust BERT on `gemm`, manifest + sha256, cross-encoder), `server` (OpenAI `/v1/embeddings`), `aphrody-embed` worker bin (framed stdio) | none |
| `aphrody-rag-eval` | gold-set harness, CLI | none |
| `aphrody-rust` (`rag-python`) | PyO3 cdylib: pack/unpack, normalise, similarity, top-k, kmeans update, thin wrappers over `rag-core` | it IS the Python bridge (Python calls Rust, not the reverse) |
| `aphrody-memory` | agent memory: HNSW(brute force) JSONL, LanceDB, SQLite, mem0/honcho adapters | none |
| `aphrody-context` | token budget / trim | `GoTokenEstimator` spawns `aphrody-tokenizer-go` per estimate (opt-in estimator, not default) |
| `aphrody-summary`, `ocr`, `ocr-core`, `ocr-onnx` | no subprocess | none |
| `ocr-vlm` | spawns a VLM server binary / CLI (`server.rs`, `vlm.rs`) | subprocess (another domain: inference) |
| `aphrody-train` | `uv run python -m <module>` training job runner | subprocess, cold path, legitimate (PyTorch training) |

Python/PyO3: `rag-python` is the only PyO3 crate. It is not on any Rust RAG path: `aphrody-rag` does
not depend on it. There is no Python subprocess in retrieval, indexing, embedding or reranking.

HTTP hops (not subprocess but not in-process): `LlamaServerEmbedder`, `OpenAiCompatEmbedder`,
`LlamaServerReranker` talk to a llama-server. Before this change the only in-process embedder was
`OrtEmbedder` (feature `ort`), serialised behind a `Mutex`, and there was no in-process reranker.

## 2. Coverage matrix (LlamaIndex concept to Aphrody owner)

| LlamaIndex concept | Aphrody owner | Gap / action |
| --- | --- | --- |
| `Document` / `TextNode` + metadata | `rag::DocRecord` / `ChunkRecord` (path, heading, symbol, lines) | no generic metadata map; deliberate (schema is a compat contract). Gap G1 |
| Readers (`SimpleDirectoryReader`) | `rag::RagIndexer` (`ignore` walk, hash incremental) | PDF/OCR readers live in `ocr*`, not wired as readers. Gap G2 |
| Node parsers: `SentenceSplitter`, `MarkdownNodeParser`, `CodeSplitter` | `rag-core` `ProseChunker`, `MarkdownChunker`, `RustChunker`, `JsTsChunker`, `StructuralChunker` | covered; canonical owner `rag-core` |
| Semantic / hierarchical splitters, window / sentence-context postprocessor | none | Gap G3 (neighbour-chunk expansion is cheap: `chunk_index` is stored) |
| `BaseEmbedding` (+ query/passage instruction) | `rag::Embedder` trait, `format_query_or_passage` | covered |
| Embedding backends | `NativeEmbedder` (new), `OrtEmbedder`, `LlamaServerEmbedder`, `OpenAiCompatEmbedder`, `StubEmbedder` | covered; mistral.rs gap G4 |
| Embedding cache (`IngestionCache`) | `RagIndexer` skips unchanged files by blake3 hash; no chunk-level cache | Gap G5 (chunk-hash to vector reuse across files / re-index) |
| `VectorStore` | `RagStore` (SQLite BLOB, exact scan), `memory` (HNSW brute force, LanceDB), Postgres adapter | duplicates, see section 3 |
| Retrievers: vector, BM25, hybrid, `QueryFusionRetriever` (RRF, relative score, dist-based) | `RagSearcher` Hybrid + `rag-core::fusion::{rrf, rrf_weighted, apply_source_weights}` | covered; relative-score fusion not implemented. Gap G6 |
| MMR retrieval | `fusion::mmr` (not wired in `RagSearcher`) | Gap G7 wire an option |
| Node postprocessors (similarity cutoff, dedup, metadata filter) | `fusion::dedup_by_key`, `path_prefix` filter | cutoff missing, G8 |
| Rerankers (`SentenceTransformerRerank`, `LLMRerank`) | `NativeReranker` (new), `LlamaServerReranker`, `NoopReranker` | covered |
| `RetrieverQueryEngine`, `ResponseSynthesizer` (refine, compact, tree) | `RagContextTool` builds a context block; synthesis is the agent's LLM call (`agent-runtime`, other owner) | by design: Aphrody injects context, the agent loop synthesises |
| Query transforms (HyDE, multi-query, decomposition) | none | Gap G9, depends on inference API (other agent) |
| Evaluation (`RetrieverEvaluator`, hit rate, MRR) | `rag-core::eval`, `rag-eval` (Recall@k, MRR, gate) | covered; generation eval (faithfulness) absent, G10 |
| Chat engine / memory buffer | `aphrody-memory`, `aphrody-context`, `aphrody-summary` | covered by other crates |
| Agents / workflows | `agent-runtime`, `agent-tools`, `toolcall` | out of scope (other owners) |
| Knowledge graph / property graph index | none | not planned |
| Sparse embeddings (SPLADE) | none (FTS5 BM25 is the sparse branch) | not planned |

## 3. Duplicates and canonical owners

| Capability | Copies | Canonical owner | Action |
| --- | --- | --- | --- |
| `cosine`, `dot`, `l2_normalize` (f32) | `rag-core::fusion`, `embed::native::embedder`, `memory::lib::cosine_similarity` + `hnsw::l2_norm`, `rag-python` wrapper | `rag-core::fusion` for retrieval kernels. `embed` keeps its own (it must not depend on rag-core; leaf crate) | W6: have `memory` import `rag-core` kernels (memory is the only avoidable copy) |
| Vector store | `rag` SQLite exact scan; `memory` HNSW-brute-force + LanceDB | `rag::RagStore` for documents/corpus; `memory` for agent facts. Different data models (chunked corpus with FTS vs. keyed records), not merged | keep; document the boundary. Do not add a third |
| In-process embedder | `embed::embeddings` (fastembed/ORT, via `OrtEmbedder`) and `embed::native` | `embed::native` (no ONNX Runtime dylib, lock-free, manifest + sha256, wasm-adjacent, same code the worker and E5 server run) | `NativeEmbedder` added; `ort` stays as the opt-in path for ONNX-only user exports (`load_user_defined`) |
| Reranker | `LlamaServerReranker` (HTTP) vs native cross-encoder | `NativeReranker` default when installed; llama-server only for Qwen3-reranker-class models that are not BERT-family | added |
| Chunker | only `rag-core` has chunkers (the `ts_parity_golden` test pins the TS port). `context`/`summary` do not chunk | `rag-core` | no duplicate |
| Fusion/RRF | `rag-core::fusion` only; `RagSearcher::fuse_rrf` is a thin caller | `rag-core` | none |
| Token counting | `context::{HeuristicTokenEstimator, GoTokenEstimator}`, `ChunkOptions` token_count in rag-core | see B4 | W5 |

## 4. Subprocess / Python removal plan

Removed or avoided now:

- Embedding on the hot path no longer needs llama-server or the ORT dylib: `NativeEmbedder` and
  `NativeReranker` run in-process (feature `native`). No process, no HTTP hop, no `Mutex`.

Remaining, with disposition:

| Path | Kind | Disposition |
| --- | --- | --- |
| `rag-python` (`aphrody-rust` cdylib) | PyO3, Python to Rust | keep: unique value is giving the Python tooling (`aphrody-py`, `scripts/tools/ai/bench-*`) the same kernels. It is a leaf cdylib, depends only on `rag-core`, is not on any default Rust path. Make it non-default in the root workspace (`default-members`) so a normal `cargo build` does not need Python headers. Lead decision, root manifest |
| `LlamaServer{Embedder,Reranker}`, `OpenAiCompatEmbedder` | HTTP to a managed server | keep as selectable backends. Preferred end state: consume the inference crates' in-process API (mistral.rs `Embedding` model selector, `mistralrs-core::pipeline::embedding`) via a new `Embedder` impl once that other agent exposes it (G4) |
| `aphrody-embed` worker bin (framed stdio) | subprocess by design | not used by `aphrody-rag`; consumers that want in-process should use `NativeEmbedder`. Candidate for deletion after FFI consumers migrate |
| `context::GoTokenEstimator` | subprocess per call, opt-in | replace with in-process `tokenizers` (already pinned at `0.23.2` in the root) or a tiktoken-compatible crate. Needs the encoding to be decided: W5 |
| `train::run_training_job` (`uv run python -m ...`) | subprocess, cold path | keep (PyTorch/SentenceTransformers training has no Rust equivalent). Not on a query path |
| `ocr-vlm` | spawns VLM binary | belongs to the inference/OCR migration (other area); route through the inference API when it exists |

## 5. Performance bottlenecks and fixes

| Bottleneck | Where | Fix | Status |
| --- | --- | --- | --- |
| `search_vector` joined `chunks` + `docs` for every stored vector, allocated a `Vec<f32>` and a `ChunkRecord` (incl. full text) per row, then sorted everything | `rag/src/store.rs` | stream `(chunk_id, blob)` into one flat matrix, select with `rag-core::fusion::top_k_exact` (bounded heap, O(k) extra), hydrate chunk text only for the winners | done |
| One autocommit transaction, one lock acquisition, one model-lock `SELECT` and one `meta` upsert per chunk during indexing | `RagStore::insert_vector`, `RagIndexer` | `RagStore::insert_vectors` (single transaction, prepared statement, one check). Same bytes on disk | done |
| `OrtEmbedder` holds a `std::sync::Mutex` across inference: concurrent queries and indexing serialise | `rag/src/embedder/ort.rs` | `NativeEmbedder` shares `Arc<Engine>` (engine is `Send + Sync`, own rayon pool) | done (opt-in) |
| Model load per call risk | `facade::global_*` already `OnceLock`; adapters here hold the `Arc` | construct once at CLI/app start, never per query | by construction |
| HTTP JSON serialisation of f32 vectors to llama-server | embedder/llama.rs, openai.rs | in-process native/mistral.rs path removes it | partial |
| Whole vector table still scanned per query (exact search, O(N d)) | `search_vector` | acceptable to roughly 100k chunks. Beyond that: int8 quantised column (`quant` field already in the schema; `fusion::quantize_i8/dot_i8` exist) then HNSW. Also hold the matrix in memory (`ArcSwap`/`RwLock` snapshot invalidated on write) to avoid re-reading BLOBs per query | W4 |
| `tokio::sync::Mutex<rusqlite::Connection>` blocks the async runtime during scans and serialises readers | `RagStore` | WAL is on; open a second read-only connection (or small pool) for `search_*`, keep one writer. Needs a spawn_blocking boundary | W3 |
| Indexing embeds file by file, awaiting each batch | `indexer.rs` | pipeline: chunk on rayon, embed batches concurrently with the writer transaction | W3 |
| Embedding failure silently dropped (`if let Ok`) so a file is marked indexed without vectors | `indexer.rs` | surface a counter in `IndexStats` and do not record the doc hash if embedding failed (changes semantics, so deferred) | W2 |
| `GoTokenEstimator` spawns a process per call and re-resolves the binary by walking the filesystem each time | `context/src/lib.rs` | in-process estimator (W5) | open |

## 6. Dependency lines for the lead (root `Cargo.toml`; not edited here)

No new third-party crate is required for what was implemented. Required wiring:

1. `aphrody-embed` is declared at the root as `default-features = false, features = []`. The new
   `aphrody-rag/native` feature turns on `aphrody-embed/native`, which pulls `tokenizers`, `ureq`,
   `sha2`, `serde`, `serde_json`, `rayon`, `gemm`, `safetensors`, `memmap2`, `base64` from the
   workspace table. Verify these exist in `[workspace.dependencies]` (the `aphrody-embed` manifest
   already references them as `workspace = true`, so they should).
2. Enable the feature where the CLI builds RAG (`apps/cli`, other agent): `aphrody-rag = { workspace = true, features = ["native"] }`.
3. Optional hygiene: move `crates/ai/rag-python` out of `default-members` (keep it in `members`).
4. For W5 (in-process tokens): the root already pins `tokenizers = "0.23.2"`; add `tokenizers = { workspace = true }` to `crates/ai/context` once an encoding file is chosen. `tiktoken-rs` would be a new dependency.
5. For G4 (mistral.rs in-process embeddings): depends on how the inference owner exposes
   `mistralrs` (path or git pin on the `upstream/` fork). Do not add until their API lands.

## 7. Ordered work items

Done in this change:

- W0. `aphrody-rag` feature `native`: `NativeEmbedder`, `NativeReranker` (in-process, lock-free).
- W0. `RagStore::search_vector` two-pass top-k; `RagStore::insert_vectors` batch transaction; indexer uses it.

Next (safe, ordered):

1. W1. Config: add `EmbedBackend::Native` (and a native rerank option) in `aphrody-config`, resolve in
   `config_resolve.rs`, construct in `crates/infra/aphrody-command/src/rag_cmd.rs` and the MCP tools. Needs those owners.
   Note: an index is locked to one `embed_model_id`; native ids are `native:<repo>@<rev>`, so switching
   backend means a new index (or an explicit re-embed), never mixing spaces.
2. W2. Make embedding failures visible in `IndexStats`; do not mark a doc indexed without vectors.
3. W3. Read connection(s) separate from the writer, `spawn_blocking` for scans, overlap chunk / embed / write.
4. W4. In-memory vector snapshot + int8 column (`quant='i8'`) using existing `fusion` kernels; HNSW above a size threshold.
5. W5. Replace `GoTokenEstimator` with an in-process estimator; delete the Go binary lookup.
6. W6. `memory` reuses `rag-core::fusion` kernels (remove its private cosine/norm).
7. W7. Retrieval features from the matrix: G3 neighbour expansion, G7 MMR option in `SearchOptions`, G8 score cutoff, G6 relative-score fusion, G5 chunk-hash embedding cache table (additive, new table, no change to existing ones).
8. W8. G4: `Embedder` impl over mistral.rs embedding pipeline once the inference crate API is published; then deprecate the HTTP embedders for local use.
9. W9. G9/G10: query transforms and generation eval, on top of the inference API.

## 8. Verification state

Nothing was compiled or run (agents do not run cargo; the lead builds once). The new code was
written against the read APIs of `aphrody_embed::native` (`Embedder::load/embed_batch/dim`,
`Reranker::load/score`, `find_model`, `find_reranker`, `ensure_model`, `require_installed`,
`ModelFiles::{default_dir, versioned_id}`) and `rag_core::fusion::top_k_exact`. Expect to check:
feature `native` builds on its own, `search_vector` ordering parity on ties (now ascending row order
instead of insertion order of an unordered scan), and the existing `rag/tests/rag_store_tests.rs`.
