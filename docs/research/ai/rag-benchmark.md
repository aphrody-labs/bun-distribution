<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- docs-links: external-paths — backtick paths in this dated document name files of the repository at the time it records (Shenron and Koharu moved to aphrody-labs/shenron on 2026-10-05), not of this checkout. -->
# Aphrody RAG Architecture and Shenron Benchmark

This document describes Aphrody's local retrieval engine and the evidence available for comparison with Shenron. A score is comparable only when both targets use the same gold set, corpus snapshot, and retrieval condition.

---

## 1. Architectural Overview

Aphrody provides an embedded hybrid search engine for repository navigation and knowledge base grounding.

### Core Crates

1. **`aphrody-rag-core`** (pure Rust, WASM32-compatible):
   - **AST-Aware Chunkers**: Specialized chunkers for Rust (`syn`), TypeScript/JavaScript (`oxc_parser`), Markdown (heading hierarchy), and prose.
   - **Units**: Chunk sizing is measured in UTF-16 code units.
   - **Fusion & Ranking**: Reciprocal Rank Fusion (RRF with $k=60$), source weighting, and Maximal Marginal Relevance (MMR) diversification.
2. **`aphrody-rag`** (Storage & Orchestration):
   - **Storage**: Single embedded SQLite database (`rusqlite`) utilizing FTS5 (`unicode61 remove_diacritics 2`) for lexical matching, plus raw vector BLOB storage.
   - **Vector Search**: Exact scan of stored vector BLOBs; latency depends on corpus size and hardware.
   - **Model Abstractions**: `Embedder` and `Reranker` traits with implementations for ONNX Runtime (`OrtEmbedder`), `LlamaServerEmbedder` (`/v1/embeddings`), and remote APIs.
   - **Honest Mode Serving**: If vector embedding fails or is unavailable, queries degrade gracefully to `lexical` search, setting `mode_served = "lexical"` without aborting turns.
3. **`aphrody-rag-eval`**:
   - Automated evaluation harness matching the exact scoring metrics and gold fixture format of `apps/shenron/bot/src/lib/rag-eval.ts` from Dragon Ball FR.

---

## 2. Evaluation Metrics and Shenron Baseline

The Shenron gold file in the sibling checkout, `../shenron/apps/bot/tests/rag-gold.jsonl`, contained 172 valid cases on 2026-09-24. Of these, 170 specify `expectUrl`, 8 specify `expectTitle`, and 1 specifies `expect`; matcher types can overlap. These counts describe the fixture, not retrieval quality.

### Metrics Defined
- **Recall@K (R@K)**: Proportion of gold target passages found within the top-$K$ returned results ($K \in \{1, 3, 5, 10\}$).
- **Mean Reciprocal Rank (MRR)**: Average reciprocal rank of the first relevant document: $\frac{1}{|Q|} \sum_{i=1}^{|Q|} \frac{1}{\text{rank}_i}$.
- **Normalized Discounted Cumulative Gain (nDCG@10)**: Position-discounted ranking relevance.
- **Latency (p50 / p95)**: End-to-end query processing time in milliseconds.

### Verified historical baseline

The [Shenron audit from 2026-09-14](https://github.com/aphrody-code/shenron/blob/f847733a26533cff8e274c358ecd12e5c1971630/docs/audits/rag-eval-2026-09-14.json) records a lexical-only run over 172 cases and 56,190 chunks, with all 172 expected sources present. It reports R@1 0.442, R@3 0.680, R@5 0.802, R@10 0.855, MRR 0.581, and nDCG@10 0.641. The audit does not report latency percentiles or a hybrid/reranked Aphrody comparison.

### Local offline feasibility on 2026-09-24

The local Shenron `apps/shenron/bot/data/bot.db` and `data/test.db` (not in repo) contain no `rag_chunks` table. The former has four stored evaluation histories, each covering only three cases; they cannot stand in for the 172-case gold run. The Aphrody indexes under `var/proofs/codex-oss-rag-vector/20260920` (not in repo) and `var/proofs/codex-oss-api-rag/20260920-142900` (not in repo) contain only two and one synthetic Markdown documents respectively. Their paths do not match the gold source URLs. No current 172-case offline retrieval score is available from these files.

The public GET benchmark attempted at 2 QPS returned three HTTP 429 responses. Do not repeat that run until the endpoint owner provides an approved evaluation window. The Shenron evaluation script writes its report to Redis after querying, so it must not be run as a read-only probe. Both local databases were inspected with `sqlite3 -readonly`; no Shenron file or service was modified.

For MCP searches, `aphrody-rag-eval` defaults to the Aphrody public origin, `https://aphrody.com/mcp`. The former `mcp.dragonballfr.com` hostname fails TLS name negotiation and is not a valid default. An MCP result needs explicit `mode_served` and `hits` fields to qualify for this benchmark.

---

## 3. CLI Usage

```bash
# Index a corpus you own into a separate local SQLite store
aphrody rag --db ./rag-index.db index ./corpus

# Search that index (the requested mode requires a configured embedder)
aphrody rag --db ./rag-index.db search "exclusive GPU lease acquisition" --mode lexical

# Evaluate an existing Aphrody-format index with matching gold URLs
aphrody-rag-eval --target local --db ./rag-index.db --mode lexical --gold ./rag-gold.jsonl --gate "recall@5>=0.80" --json

# MCP evaluation uses https://aphrody.com/mcp by default. Its allowed search tools
# are rag_search, shenron_rag_search, and aphrody_shenron_rag_search.
```
