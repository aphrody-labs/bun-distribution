<!-- SPDX-License-Identifier: Apache-2.0 -->
# Agent tooling brief (subagents included)

Every agent, subagent included, starts from the owners below before generic shell. Checked against the
installed binaries on 2026-10-06; confirm a command with `--help` before scripting it.

## 1. Load the context first

- Skills: `yolo:yolo` (execution), `yolo:bun-doctrine` (Bun), `yolo:code-intel` (navigation),
  `yolo:rust-target-check` (Rust gates), `aphrody:ecosystem` (what already exists),
  `aphrody:optimize-workspace` (dedup/migration), `aphrody:deploy` (hosts), `aphrody:upstreams` (upstream code
  without cloning), `yolo:docs` (versioned docs).
- MCP: load the Aphrody tools with `ToolSearch` (`select:mcp__plugin_aphrody_aphrody__<tool>`), for example
  `yolo_scan`, `yolo_parse`, `yolo_verify`, `yolo_n2b_scan`, `yolo_vector_search`, `docs_auto_search`,
  `bun_docs_search`, `upstream_search`/`upstream_read`, `infra_exec`, `infra_git_status`, `nu_eval`,
  `coord_read_status`/`coord_report_status`.
- Code graph: `graphify query "<question>"`, `graphify explain "<node>"`, `graphify path "A" "B"` before broad
  `rg` sweeps (`graphify-out/graph.json` exists at the repository root).

## 2. Command owners

| Need | Owner |
| :-- | :-- |
| What exists (crate, command, MCP tool) | skill `aphrody:ecosystem`, `aphrody scan manifests`, `yolo scan --json` |
| Search, replace, rename across files | `yolo workspace code-edit search\|replace\|rename` (`--engine ast --lang rust\|ts`), `yolo rename` |
| AST and tokens of one file | `yolo parse <file> --json` |
| Bun gates | `bun run bun:check`, `typecheck`, `lint`, `format:check`, `test` (root `package.json`) |
| Declared quality stages | `aphrody infra quality <stage> --repo aphrody --run`, `aphrody infra pipeline`, `aphrody infra workflow <stage>` |
| Cargo from WSL | `bun scripts/build/rust/vps-cargo.ts run -- <cargo args>` (never local heavy Cargo) |
| Cargo in a cloud session | `scripts/build/rust/cargo-serial.sh <cargo args>` |
| Hosts, services, probes | `aphrody infra ssh exec\|status\|logs`, `aphrody infra service`, `aphrody infra probe`, `yolo host … --host vps\|dbfr` |
| Factory build of pushed main | `yolo ship` |
| Node to Bun | `aphrody n2b`, `yolo n2b --dry-run --json` |
| Docs | `yolo docs <query>` (Bun), `aphrody docs search`, MCP `docs_auto_search` |
| Git and GitHub | `aphrody git inspect\|api\|repo\|search`, `aphrody infra git` |
| Web fetch and crawl | `aphrody web`, MCP `universal_web_fetch` |
| Memory, RAG, models | `aphrody memory`, `aphrody model`, skills `aphrody:aphrody-rag`, `aphrody:aphrody-train` |
| Coordination | `.coord/claims`, MCP `coord_*`, `aphrody a2a` |

## 3. Habits

- Batch reads with `bun -e` / `Bun.Glob` or `nu_eval`; avoid chains of `cd`, `sed -n` and `cat`.
- Wait for a long command with a single blocking call (or a background run with notification), not `until`/`sleep`
  polling loops.
- Report gates with the owner's evidence (`--json`) and name skipped checks.
