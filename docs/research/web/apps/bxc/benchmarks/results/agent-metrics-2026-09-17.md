# BXC agent-index metrics — 2026-09-17T11:51:08.251Z

Environment: {"platform":"linux","arch":"x64","bun":"1.4.0","cores":12,"commit":"65d3c62"}

| Metric | Value | Target | Pass | Samples | Method |
|---|---|---|---|---|---|
| CPU-ms / page, static HTML (http tier + extraction) | 9.0387 ms | <= 20 (Phase 1) | yes | 60 | process.cpuUsage over 60 fixture pages (~60 KB), 8 concurrent curl-impersonate worker clients, includes main-content extraction, chunking, SimHash, anchors (fixture server runs in-process: its CPU is included) |
| CPU-ms / page, Chrome headless spawned per URL (baseline) | 900.768 ms | — | — | 8 | median rusage of `chrome --headless=new --dump-dom` (process tree reaped by Chrome) over 8 fixture pages |
| Near-duplicate ratio in index | 0 ratio | < 0.01 (Phase 2) | yes | 300 | crawl of a 200-article fixture blog whose pages link to utm/amp/print/trailing-slash variants (40 % of links); ratio = (indexed article rows − distinct canonical articles) / indexed article rows |
| Pages / s / core (local fixture, http tier, full pipeline) | 97.0692 pages/s/core | >= 20 (Phase 2) | yes | 710 | fetched pages / wall seconds / average cores busy (process CPU time ÷ wall time); fixture server shares the process |
| API/MCP handler p99 latency under crawl load | 27.9824 ms | < 100 (Phase 2) | yes | 80 | every 25 ms during a 16-concurrency crawl, on the crawler's event loop (like the MCP server): HTTP handler + BM25 chunk search on the live index |
| Extraction F1 vs gold (macro) | 0.9673 F1 | >= 0.9 (Phase 2) | yes | 126 | bag-of-words token F1 of bxc_extract_main text vs labelled main text; macro average over the gold set (real pages have silver labels from site-specific selectors) |
| Search nDCG@10, no API keys (best pipeline) | 0.6774 nDCG@10 | >= 0.7 (Phase 2) | no | 300 | BEIR SciFact test (300 queries, 5183 abstracts); embedder bxc-hashing-512 (non-semantic fallback); hybrid = title-boosted BM25 ⊕ dense, RRF over top-200 |
| index.component_report | — | — | — | — | see rust-bridge/crates/bxc-index/BENCHMARKS.md |
