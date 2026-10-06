# Aphrody Web agent index — architecture

How a URL becomes a citable, deduplicated, searchable record, and where each
stage lives. Numbers for every stage are produced by
`bun docs/benchmarks/agent/run.ts` (see `docs/research/web/apps/bxc/benchmarks/results/` (not in repo)).

```
seeds / sitemaps / feeds
        │
        ▼
Frontier v2 (src/queue/RequestQueue.ts)
  per-host heaps · OPIC + anchor relevance + depth − duplicate family
  learned politeness (domain memory) · change-rate revisits · event-driven
        │  (cluster: src/queue/sharded — Redis streams, leases, Bloom seen-set)
        ▼
Access layer (src/crawler/MassiveCrawler.ts)
  tier ladder http → render → stealth (unavailable tiers skipped)
  start tier + proxy (Thompson sampling) from DomainMemory (src/profiles/domain-memory.ts)
  soft-block detection (src/profiles/soft-block.ts) · PagePool per (tier, proxy)
        │
        ▼
Document pipeline (src/crawler/document-pipeline.ts → Rust bxc-extract)
  main content · Markdown · blocks · chunks with heading paths and offsets
  canonical URL · SHA-256 content hash · 64-bit SimHash · anchors with text
        │
        ▼
Dedup
  canonical redirect · exact (content hash) · near (SimHash ≤ 3 bits, band index)
  learned content-neutral URL parameters (src/crawler/url-param-learner.ts)
  persisted Cuckoo seen-set (src/queue/frontier/cuckoo-filter.ts)
        │
        ▼
Index (src/db/BxcDB.ts, SQLite WAL)
  documents + chunks with provenance {url, canonical, fetchedAt, tier, simhash,
  contentHash, etag, last-modified} · title-boosted BM25 (FTS5)
  float32 BLOB embeddings (src/embed) · ANN index (Rust bxc-index, HNSW int8)
        │
        ▼
Retrieval
  hybrid BM25 ⊕ dense with RRF over the top 200 of each side · optional
  cross-encoder rerank · citations with offsets
  MCP `aphrody_index_search` · HTTP `GET /api/v1/index/search` · `aphrody web revalidate`
```

## Native boundary

| Library | Loaded by | Contents |
|---|---|---|
| `libbxc_rust_bridge` | `src/rust/bridge.ts` via `src/native/loader.ts` (ABI-checked) | DOM trees + node handles, extraction, SimHash, anchors, Markdown, cookies, non-blocking network jobs |
| `libcurl-impersonate` | `src/ffi/curl-impersonate.ts` via the loader | TLS-fingerprinted HTTP, executed on worker threads (`src/ffi/curl-worker-pool.ts`) |
| `libbxc_render` | `src/render/native-render.ts` via the loader | V8 page rendering without Chrome (`render` tier) |

Invariants: every C string argument is a pinned `Uint8Array` passed directly to
the call; DOM trees are owned by `DomTree` (idempotent `dispose`,
`FinalizationRegistry` backstop, use-after-dispose throws); network work never
blocks the JavaScript event loop (job handles or worker threads); a library
whose ABI version differs from the bindings is skipped or refused at load.

## HTTP surface

`src/server/app.ts` is the only HTTP application. `bun run server:start`,
`aphrody web api` and the serverless handler are adapters over it.
