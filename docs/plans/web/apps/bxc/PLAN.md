# BXC — Breakthrough Plan

Goal: turn BXC from a large feature-rich scraper toolkit (60k TS lines, 25k Rust lines,
78 MCP tools, 33 CLI commands) into a defensible, measurable technology: **the
zero-spawn, self-learning web engine that produces an agent-ready index of the
web at 10–50x lower cost per page than Chrome-based crawlers.**

Everything below is grounded in the current code (`path:line`). Sections 1–3 are the
audit; sections 4–7 are the plan. The plan is ordered so each phase is shippable and
benchmarkable on its own.

---

## 0. Honest positioning

What is real today:
- A working Rust engine stack (`rust-bridge/crates/obscura-{dom,net,js,browser,cdp}`)
  with html5ever DOM, a V8 runtime (deno_core), and a CDP server — i.e. the seed of a
  headless browser that is **not Chrome**.
- An in-process CDP emulation in Bun (`src/transport/StaticDomTransport.ts`, 17
  domains) so Playwright-style code runs without spawning anything.
- A TLS-fingerprinted HTTP client via curl-impersonate (`src/ffi/curl-impersonate.ts`).
- A profile ladder static → http → fast → stealth → max with auto-escalation
  (`src/profiles/auto-escalation.ts:42`).
- A crawler → SQLite FTS5 + vectors → MCP search loop (`src/crawler/MassiveCrawler.ts`,
  `src/db/BxcDB.ts`, `src/mcp/server.ts`).

What is not real yet (and is what an acquirer would actually pay for):
- The Rust engine does not execute page JavaScript in the zero-spawn path; SPAs fall
  through to a spawned Chrome.
- "Semantic" search is a hashing trick, not semantics (`src/utils/vector.ts:22`,
  `src/utils/vector-embed.ts:8`).
- Vector search is a full-table scan with JSON parsing (`src/db/BxcDB.ts:267-323`).
- Escalation learns nothing across domains; the crawler spawns and kills a browser
  per URL (`MassiveCrawler.ts:270-285`).
- There is no reproducible benchmark suite proving any cost/quality claim.

Nobody buys a repo for its tool count. They buy **(a) a measured 10x on a metric they
care about, (b) a moat that is hard to copy, (c) adoption.** The plan targets exactly
those three.

---

## 1. Critical flaws (fix first, P0)

| # | Flaw | Evidence | Impact |
|---|------|----------|--------|
| F1 | Hard-coded Postgres URL with password as fallback | `src/db/AphrodyPg.ts:58` | Credential leak in git history; blocks any due diligence |
| F2 | Native FFI calls block Bun's event loop on network I/O (`rt.block_on`) | `rust-bridge/src/lib.rs:694,771,879,…` | MCP stdio server freezes for whole request; kills concurrency |
| F3 | `cargo run` invoked at runtime if `bxc-engine` is missing | `src/transport/WebSocketTransport.ts:185` | Non-deterministic startup, minutes of latency, impossible in prod |
| F4 | MCP browser tools share one `activePage` and ignore later profile requests | `src/mcp/server.ts:17-25` | Wrong profile silently used; no session isolation |
| F5 | Dead Rust modules referencing undeclared deps (`lol_html`, `cxx`) | `rust-bridge/src/obscura_engine.rs`, `chromium_cxx.rs` (not in `lib.rs`) | Misleading; `static mut` + `unwrap()` on CString if ever wired |
| F6 | No ABI compatibility check at dlopen time (only `>0` in doctor) | `src/rust/bridge.ts`, `src/cli/doctor.ts:52` | Silent memory corruption after a mismatched build |
| F7 | `stringPtr()` passes pointer to a temporary Buffer with no lifetime pin | `src/rust/bridge.ts` | GC-timing dependent UB across the FFI boundary |
| F8 | Two divergent copies of `@aphrody/fut` (local `packages/fut/src` vs npm 0.2.1) | `src/cli/fut.ts:41` vs `src/crawler/MassiveFutCrawler.ts:21`, `src/server/index.ts:9` | Behaviour drift, untestable |
| F9 | Three HTTP API stacks, three HTML→Markdown implementations, two dlopen loaders | `src/server/index.ts`, `src/cli/api.ts`, `src/serverless/`; `html2md`, `obscura-js/markdown.rs`, `src/internal/html-to-markdown.ts`; `bridge.ts:150`, `curl-impersonate.ts:404` | Maintenance cost, inconsistent output |
| F10 | Stale Zig references (`build-lightpanda-static.ts`, Makefile `zig-out`, `turbo.json`, `StaticDomTransport.ts:206-290` comments, `isZigQueryAvailable()` always true) | listed | Confuses contributors and acquirers |
| F11 | Scratch files committed at repo root (`--help`, `--pipeline`, `debug-serp.html`, `sync_crawl.tar.gz`, `bxc-memory.sqlite*`) | repo root | Hygiene |

---

## 2. Major algorithmic weaknesses

### A. Crawl frontier is BFS with a boolean priority
- `RequestQueue` priority is `forefront ? 1 : 0` (`src/queue/RequestQueue.ts:324`);
  dequeue order is `priority DESC, id ASC` (`:217`). That is FIFO.
- No host-aware scheduling: all hosts share one queue; a single slow host starves
  the pool while `RateLimiter.acquire` waits (`MassiveCrawler.ts:215`).
- No importance model (OPIC / on-line PageRank / link-depth decay / anchor-text
  relevance), no revisit policy, no change-rate estimation → the index can never be
  "fresh" nor "focused".
- `drain(batchSize=10, pollMs=500)` polls SQLite (`RequestQueue.ts:504`) instead of
  being event-driven.

### B. Deduplication is exact-URL only
- `uniqueKey` defaults to URL (`RequestQueue.ts:319`). No `rel=canonical`
  resolution, no URL-parameter learning, no content fingerprint. The same article at
  `?utm=…`, `/amp/`, `m.` and `www.` is crawled and indexed 4 times. No SimHash /
  MinHash anywhere in `src/` or `rust-bridge/` (grep confirms).

### C. "Embeddings" are hashing tricks; vector search is O(N·d) with JSON parse
- Default embedding = 512-d term hashing (`src/utils/vector.ts:22`); pgvector path =
  384-d SHA-256 word hashing pretending to be MiniLM (`src/utils/vector-embed.ts:5-8`).
  Zero semantic generalisation: "car" and "automobile" are orthogonal.
- Real embeddings require a Gemini/OpenAI key, one HTTP call per page, sequential
  (`MassiveCrawler.ts:315`).
- `searchSemantic` does `SELECT … WHERE vector IS NOT NULL`, `JSON.parse` every row,
  brute-force cosine (`BxcDB.ts:267-323`). At 1M pages that is ~2 GB of JSON parsing
  per query. Vectors are stored as `TEXT` (`BxcDB.ts:88`).
- Hybrid RRF exists (`BxcDB.ts:334`) but fuses only top-`2·limit` from each side,
  and FTS5 has no per-field weighting or title boosting.

### D. Escalation ladder is static and memoryless across domains
- Order fixed at `static → http → fast → stealth → max` (`auto-escalation.ts:42`);
  memory is per-URL only. Every new URL on a Cloudflare domain re-fails through the
  cheap tiers.
- `MassiveCrawler` hard-codes http → stealth (skips `fast`), picks a proxy at
  random (`:221`) with no health/ban scoring, and creates + destroys a full
  `Browser.newPage` per URL (`:246`, `:274`). Chrome spawn cost is paid per escalated
  page instead of amortised via `src/pool/PagePool.ts` (unused by the crawler).
- Challenge detection is substring matching on titles/HTML
  (`src/crawler/crawl-utils.ts:116`, `src/router/challenge-detect.ts`). No detection
  of soft-blocks (200 + empty shell, honeypot content, JS-only render).

### E. Zero-spawn path cannot run page JavaScript
- `StaticDomTransport` emulates `Runtime.evaluate` (`:133-136`) but there is no page
  JS execution; `obscura-js` (V8 via deno_core) exists in Rust but is not wired into
  the FFI bridge (21 symbols, none JS-related). Result: every SPA / hydrated page
  escalates to a spawned Chrome, which is exactly the cost the project claims to avoid.

### F. Content extraction is naive
- Title via regex (`MassiveCrawler.ts:236`), text via `extractText` (whole-body
  strip), markdown via `html2md` on the full document. No main-content / boilerplate
  removal (no Readability / text-density / DOM-distance algorithm; grep confirms).
  Nav, footers, cookie banners and "related posts" all pollute FTS, embeddings and
  the LLM context.
- Chunking for RAG is one chunk per document (`AphrodyPg.ts:182-192`), not
  semantic/structure-aware.

### G. Nested DOM queries re-parse HTML with regexes
- `ZigElement` re-parses `outerHTML` for every nested selector (`src/ffi/zigquery.ts`);
  `DomTreePtr` is a bare `number` (no double-free protection). O(n) per nested query
  and unsafe.

### H. No distributed execution model
- `Bun.redis` + `AphrodyRedis` exist, but the crawler frontier is a local SQLite
  (`bxc-massive-frontier`), so "multiple workers" means multiple processes fighting
  over one WAL file. No work-stealing, no sharded frontier, no shared seen-set.

### I. No measurement
- `bench` script points at `benchmarks/run-all.ts`; there is no cost-per-page,
  block-rate, extraction-quality or search-quality benchmark that can be re-run.
  Only 1 crawler test file (`test/crawler/dragonballfr.test.ts`), 1 DB test.

---

## 3. Missing features (ranked by value to an acquirer)

1. **Local embeddings in Rust** (no API key): MiniLM/BGE-small via `candle` or
   `ort`, batched, quantised int8. Ships in the `.so`.
2. **ANN vector index** in Rust: HNSW (or `usearch`) with int8/binary quantisation,
   memory-mapped, persisted alongside SQLite. Sub-10 ms search at 10M vectors.
3. **JS execution in the zero-spawn engine**: wire `obscura-js` into the bridge with
   a minimal DOM binding (document/querySelector/fetch/XHR/setTimeout/JSON), so
   Next/Nuxt/React hydration and JSON-fetching SPAs render without Chrome.
4. **Main-content extraction** (Rust): text-density + link-density + DOM-distance
   scoring (Readability/trafilatura class), with structural chunking (heading tree).
5. **Near-duplicate detection**: SimHash (64-bit, shingled) on extracted text +
   canonical URL resolution + learned URL-parameter stripping.
6. **Importance-driven frontier**: per-host queues, OPIC score, anchor-text relevance
   to a crawl goal, change-rate (Poisson) revisit scheduling, sitemap + feed
   ingestion as first-class seeds.
7. **Domain fingerprint memory**: per-eTLD+1 record of which profile/proxy/fingerprint
   succeeded, block signatures seen, and optimal politeness delay; used to *start* at
   the right tier and to score proxies.
8. **Async FFI**: Rust tasks return a handle; completion via callback/poll so Bun's
   loop never blocks. Cancellable, with timeouts.
9. **Sharded, Redis-backed frontier** with a shared Bloom/Cuckoo seen-set, work-stealing
   workers, and exactly-once page persistence.
10. **Structured extraction to schema**: given a JSON Schema or TypeScript type,
    extract typed records from pages (currently only `get_url_types`/OpenAPI
    heuristics). This is the "site-to-API" promise made real.
11. **Provenance + freshness metadata** on every indexed chunk (fetch time, profile,
    hash, canonical, HTTP validators) so agents can cite and re-validate.
12. **Reproducible benchmark suite** + public leaderboard: cost/page, block-rate,
    JS-render fidelity, extraction F1 vs gold set, search nDCG.

---

## 4. Breakthrough thesis

> **BXC = a Rust "agent browser" that renders the web without Chrome, learns how to
> get through each site, and emits a deduplicated, semantically indexed, citable
> knowledge layer that any LLM agent can query over MCP — at a cost per page an order
> of magnitude below headless-Chrome fleets.**

Three moats, each with a hard number:

| Moat | Metric | Target |
|------|--------|--------|
| **Zero-spawn rendering** (obscura + V8 + curl-impersonate) | CPU-ms and RSS per rendered page vs Chrome headless | ≤ 1/10 CPU, ≤ 1/20 RSS on a 1k-site mixed corpus, ≥ 95 % text parity with Chrome |
| **Self-learning access layer** (domain memory + fingerprint/proxy scoring) | Block rate on top-10k domains after warm-up | < 2 % blocked, < 1.3 average tier attempts per page |
| **Agent-ready index** (local embeddings + HNSW + boilerplate removal + SimHash) | Search nDCG@10 on a held-out QA set; duplicate ratio | nDCG ≥ 0.75 with no API keys; < 1 % near-duplicates |

Why this is buyable: it is the missing "web layer for agents" — local-first,
key-less, MCP-native. The combination (own rendering engine + adaptive access +
built-in index) does not exist as a single deployable binary today.

---

## 5. Roadmap

Each phase ends with a benchmark number in `benchmarks/` and a green
`bun run verify`.

### Phase 0 — Hardening (1–2 weeks)
- Remove hard-coded credentials (`AphrodyPg.ts:58`), rotate the password, add
  `gitleaks` to CI.
- Delete dead Rust (`obscura_engine.rs`, `chromium_cxx.rs`), stray
  `libhtml2md.so`, Zig leftovers, root scratch files.
- Single native loader: `src/native/loader.ts` (dlopen + path probing + Win
  `SetDllDirectoryW` + ABI check `bxc_bridge_abi_version === EXPECTED`). Both
  `bridge.ts` and `curl-impersonate.ts` consume it.
- Pin FFI string lifetimes (keep Buffers referenced until call returns; use
  `toArrayBuffer` + explicit `FinalizationRegistry` for tree handles; typed
  `DomTree` class with `dispose()` and double-free guard).
- Make `bxc-engine` missing a hard error with an `bxc install` hint; never `cargo run`.
- One HTTP API (Elysia) — delete `cli/api.ts` and `serverless/` or make them thin
  adapters of `src/server`.
- One HTML→Markdown path (Rust `html2md`, exposed via bridge); delete the others.
- Make `packages/fut` a workspace member; remove the npm copy.
- MCP: session-keyed pages (`Map<sessionId, Page>`), honour profile per call.
- Tests: crawler unit tests (frontier, dedup, escalation decision), DB tests
  (FTS, hybrid), FFI lifetime tests under ASAN in CI.

### Phase 1 — Algorithmic core (3–5 weeks)
1. **Frontier v2** (`src/queue/`):
   - Per-host queues with a global heap keyed by `(nextAllowedAt, -score)`.
   - Score = `OPIC cash + anchor relevance + depth decay − duplicate-family penalty`.
   - Event-driven dequeue (no polling); batch inserts.
   - Revisit scheduler: per-URL change-rate estimate (Poisson λ), priority ∝
     `λ · importance`.
   - Sitemap/RSS/Atom ingestion as seeds with `lastmod` priority.
2. **Dedup v1** (Rust, in bridge): `bxc_simhash64(text)`; canonical URL
   resolution (`<link rel=canonical>`, `og:url`); learned parameter stripping
   (params whose removal yields identical SimHash on ≥ N samples). Seen-set as a
   Cuckoo filter persisted to disk.
3. **Extraction v2** (Rust, in bridge): `bxc_extract_main(html) -> {title,
   byline, published, text, markdown, blocks[]}` using text/link density + DOM
   distance scoring; structural chunks with heading paths. Gold set of 500 pages
   with manual labels; target F1 ≥ 0.9 vs trafilatura baseline.
4. **Domain memory** (`src/profiles/domain-memory.ts` + SQLite table): per eTLD+1:
   best tier, fingerprint, proxy scores (EWMA success), block signatures,
   politeness delay learned from 429/503 backoff. Escalation starts at the
   remembered tier; proxies chosen by score, not `Math.random()`.
5. **Page pooling in crawler**: `MassiveCrawler` uses `PagePool` per profile; stealth
   browser contexts reused across N pages; per-URL cost drops from spawn to
   `newContext`.
6. **Async FFI**: convert `bxc_gemini_web_ask`, `bxc_x_*`, `bxc_dns_recon` to
   job-handle API (`submit → poll/callback → free`); Bun side wraps in Promises.

### Phase 2 — Breakthrough (6–10 weeks)
1. **JS in the zero-spawn engine**:
   - Expose `obscura-browser` page lifecycle over FFI (`bxc_page_new/navigate/eval/
     html/free`) with the shared tokio runtime and V8 isolates per page.
   - Minimal Web API surface in `obscura-js/ops.rs`: `document.*` bound to
     obscura-dom, `fetch`/XHR via obscura-net (fingerprinted), timers, `JSON`,
     `localStorage` stub, `MutationObserver` no-op, `IntersectionObserver` fire-once.
   - Hydration fidelity gate: crawl 1k mixed sites with both obscura-JS and Chrome,
     compare extracted main text; promote profiles where parity ≥ 95 %.
   - New profile `render` sits between `http` and `fast` in the ladder.
2. **Local embeddings** (`rust-bridge/crates/bxc-embed`): `candle` (or `ort`) with
   bge-small/MiniLM int8, batched inference, model downloaded to `~/.bxc/models` by
   `bxc install`. FFI `bxc_embed_batch(texts) -> f32[][]`. Throughput target
   ≥ 300 chunks/s on 8 cores CPU.
3. **ANN index** (`rust-bridge/crates/bxc-index`): HNSW (M=16, ef=128) with scalar
   int8 quantisation, mmap-persisted, incremental inserts, deletes via tombstones.
   FFI `bxc_index_add/search/save/load`. Replace `BxcDB.searchSemantic`. Hybrid =
   BM25 (title-boosted FTS5) ⊕ HNSW with RRF over top-200 each, then optional
   cross-encoder rerank (bge-reranker-base, local).
4. **Structured extraction to schema**: `bxc extract --schema schema.json url…`:
   DOM-to-JSON via learned selectors (repeated-structure detection on the DOM tree)
   with LLM fallback only for unresolved fields; cache selectors per domain in
   domain memory. This turns "site-to-API" into a reproducible product.
5. **Provenance model**: every chunk carries `{url, canonical, fetchedAt, profile,
   simhash, etag/last-modified, contentHash}`; MCP search returns citations with
   byte offsets; `bxc revalidate` uses HTTP validators before re-fetch.

### Phase 3 — Scale + distribution (4–8 weeks)
1. **Sharded frontier**: Redis streams per shard, consistent hashing on eTLD+1 so a
   host lives on one worker (politeness stays local); shared Cuckoo seen-set in
   Redis; exactly-once persistence via idempotent upsert on `contentHash`.
2. **Single binary** (`bxc`) embedding: rust bridge, curl-impersonate, embedding
   model manifest, MCP server. `bxc serve` = crawler + index + MCP/HTTP in one
   process; `bxc worker` joins a cluster.
3. **Benchmark suite + public numbers** (`benchmarks/`): cost/page (CPU-ms,
   RSS, bytes), block-rate on a fixed top-10k list, JS-render parity, extraction F1,
   search nDCG, dedup ratio; CI publishes a JSON artefact per commit.
4. **Adoption surface**: `@aphrody/bxc` SDK, MCP marketplace listing, Claude/Gemini
   extension manifests already present — add hosted demo index of a public corpus
   (e.g. docs of the top-500 OSS projects) queryable over MCP.

---

## 6. Acceptance metrics (definition of "revolutionary")

| Metric | Today (estimated) | Phase 1 | Phase 2 | Phase 3 |
|--------|-------------------|---------|---------|---------|
| CPU-ms / page, static HTML | ~30 (curl + html2md) | 20 | 15 | 15 |
| CPU-ms / page, SPA (needs JS) | ~1500 (Chrome spawn per URL) | ~400 (pooled Chrome) | ≤ 100 (obscura-JS) | ≤ 100 |
| RSS / concurrent page, SPA | ~150 MB | ~60 MB | ≤ 8 MB | ≤ 8 MB |
| Block rate, top-10k domains | unknown | measured | < 5 % | < 2 % |
| Near-duplicate ratio in index | unknown (no dedup) | < 3 % | < 1 % | < 1 % |
| Extraction F1 vs gold | unknown (full-body) | ≥ 0.85 | ≥ 0.9 | ≥ 0.92 |
| Search nDCG@10, no API keys | ≈ random (hashing) | — | ≥ 0.7 | ≥ 0.75 |
| Vector search latency @1M docs | seconds (full scan) | — | < 10 ms | < 10 ms |
| Pages / s / core, mixed corpus | unknown | measured | ≥ 20 | ≥ 50 (sharded) |
| MCP p99 latency under crawl load | blocks (sync FFI) | < 200 ms | < 100 ms | < 100 ms |

---

## 7. Risks and mitigations

- **JS fidelity gap**: a minimal Web API will not render everything. Mitigation:
  parity gate per domain, automatic fallback to Chrome tier, domain memory records
  which tier is needed. The win is on the 70–80 % of pages that only need
  hydration + fetch, not 100 %.
- **Anti-bot arms race**: fingerprints rot. Mitigation: fingerprint packs versioned
  with Aphrody OS releases; domain memory measures decay and re-escalates.
- **Model size**: ship a model manifest, download on explicit `install`, and
  verify by hash; keep weights outside the Web executable.
- **Legal/ethical exposure**: this plan does not change policy; keep the existing
  configuration surface and make provenance explicit so downstream users can filter.
- **Scope creep** (78 MCP tools, many verticals): freeze new verticals until Phase 2
  ships; verticals (fut, anime, dragonball, google, x) become `packages/*` consumers
  of the core, not core code.

---

## 8. First 10 concrete tasks

1. Rotate and remove the password in `src/db/AphrodyPg.ts:58`; add gitleaks to `ci.yml`.
2. Delete `rust-bridge/src/obscura_engine.rs`, `chromium_cxx.rs`, Zig leftovers, root scratch files.
3. Create `src/native/loader.ts`; migrate `bridge.ts` and `curl-impersonate.ts`; add ABI equality check.
4. Add `bxc_simhash64` + `bxc_extract_main` to `rust-bridge/src/lib.rs` (new crate `bxc-extract`); tests with a 100-page gold set.
5. Replace `RequestQueue` ordering with per-host heaps + OPIC score; remove polling.
6. Wire `PagePool` into `MassiveCrawler`; stop per-URL `Browser.newPage` for stealth.
7. Implement `domain-memory.ts` and use it in `autoEscalate` and `MassiveCrawler`.
8. Convert the three network FFI calls to async job handles.
9. New crate `bxc-index` (HNSW + int8) and `bxc-embed` (candle, bge-small); replace `searchSemantic`.
10. `benchmarks/run-all.ts`: cost/page, block-rate, extraction F1, nDCG; publish JSON in CI.
