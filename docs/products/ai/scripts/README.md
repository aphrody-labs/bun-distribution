<!-- SPDX-License-Identifier: Apache-2.0 -->

# `scripts/` — repo automation inventory

Quick reference for the scripts shipped with `aphrody`. Cross-platform parity
follows the project priority order (Linux #1, Windows #2, WASM #3, macOS
best-effort, cf. `CLAUDE.md` §0). Host operations and VPS deployment have been
handed to `aphrody-infra` (`../aphrody-infra/scripts/aphrody/`); system-layer
kernel and desktop automation live in `../aphrody-os/scripts`.

## Build & deployment helpers

| Script | Platform | Purpose |
|---|---|---|
| `deploy.sh` | Linux bash | Build release binaries and install to `~/.local/bin`. |
| `run-qwen3-moe.sh` | Linux bash | Run local Qwen3 MoE inference with optional speculative decoding. |
| `verify-release.ts` | Bun / Cross-platform | Pre-release verification gate (`apps/shenron-*`, `aphrody-mcp`, `aphrody-a2a-coord`). |

## Benchmarks & Diagnostics

| Script | Purpose |
|---|---|
| `bench-all.ts` | Unified benchmark suite orchestrator across all language surfaces. |
| `bench-bun-surface.ts` | Benchmark Bun runtime operations and CLI latency. |
| `bench-python-surface.ts` | Benchmark Python client calls and import overhead. |
| `bench-rust-surface.ts` | Benchmark native Rust binaries and cold start latency. |
| `bun run runtime:check` | Central `aphrody-ops` gate for Bun and uv/Python runtime surfaces. |
| `bun run docs:check-links` | Central `aphrody-ops` gate checking relative Markdown documentation links. |
| `scan-repo.sh` | Shell scanner for repository tree, file sizes and manifests. |
| `gh-repo-intelligence.ts` | GitHub repository intelligence metadata extraction. |
| `github-account-audit.ts` | GitHub user/organization audit and repository discovery. |

## Shenron & RAG Datastores

| Script | Purpose |
|---|---|
| `shenron-rag-indexes.sql` | PostgreSQL DDL: concurrent unique index and FTS GIN index for `aphrody_rag_documents`. |
| `shenron-rag-vectors.sql` | PostgreSQL DDL: `aphrody_shenron_vectors` pgvector storage with cosine HNSW index. |
| `rag-nice.sh` | Linux priority/niceness wrapper for batch RAG indexing passes. |
| `test-gemini-embedding-2.py` | Embedding generation validation for Gemini embeddings. |

## Ingestion, Databooks & OCR

| Script | Purpose |
|---|---|
| `databooks-autopilot.sh` | Autopilot pipeline runner for databook ingestion passes. |
| `databooks-ppocr-pass.sh` | PP-OCR pass for high-throughput character and block recognition. |
| `databooks-transcribe-all.sh` | Full batch runner for transcription across corpus targets. |
| `databooks-transcribe.ts` | Bun transcription worker with JSON audit logging. |
| `translate-jp-fr.ts` | Japanese-to-French translation and glossary alignment helper. |
| `merge_data.py` | Dataset merging and deduplication utility. |
| `download_gdrive.py` | Google Drive dataset download and verification helper. |

## Agent Sync & Cookies

| Script | Purpose |
|---|---|
| `../py/aphrody/scripts/autopilot.sh` | Legacy Linux PLAN-marker loop for Claude execution and Gemini review. |
| `sync-agent-home.ts` | Synchronize agent-home workspace rules and soul configuration. |
| `sync-agent-plugins.ts` | Sync plugin definitions and tool manifests across agent runtimes. |
| `build-grok-cookie-jar.py` | Convert exported session cookies to `~/.aphrody/cookies/grok.json`. |
| `test-xai-grok-bxc.sh` | Validation suite for xAI Grok and BXC web extraction. |
| *(host infra / VPS)* | VPS scrapers, network proxies and systemd templates live in `../aphrody-infra/scripts/aphrody/`. |

`bun run ecosystem:check` validates local Cargo paths across Aphrody AI, OS and
infra, plus the `@aphrody/xai` dependency on aphrody-web's `@aphrody/x` (the AI
layer consumes the web layer; aphrody-web never depends on this repository).
`bun run ecosystem:sync` rewrites those generated paths after relocating
checkouts. Set `APHRODY_AI_ROOT`, `APHRODY_OS_ROOT`, `APHRODY_INFRA_ROOT` and
`APHRODY_WEB_ROOT` to absolute checkout paths when they are not siblings.
`aphrody-ops ecosystem-deps --ai-root . --write --registry` switches `@aphrody/xai`
to the `@aphrody/x` version declared in aphrody-web for a registry build; it does
not publish either package or Rust crates.
