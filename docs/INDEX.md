<!-- SPDX-License-Identifier: Apache-2.0 -->

# Documentation index

All canonical documentation is organized by category and domain. Source import
and duplicate resolution are recorded in [`migration/`](migration/).

The current IEVR/MCP/plugin ownership and integration sequence is documented in
[`architecture/ievr-mcp-plugin.md`](architecture/ievr-mcp-plugin.md).

| Category        | Scope                                            |
| --------------- | ------------------------------------------------ |
| `architecture/` | Ownership, process boundaries, dependency graph  |
| `apis/`         | Rust/Bun/Python public contracts and schemas     |
| `decisions/`    | Dated architecture and migration decisions       |
| `guides/`       | Contributor and user workflows                   |
| `operations/`   | Build, release and runtime operations owned here |
| `plans/`        | Active product and domain plans                  |
| `products/`     | Product and application documentation            |
| `reference/`    | Crate/package manuals and technical references   |
| `research/`     | Audits, measurements and source comparisons      |

The unified architecture and consolidation plan for Bun 1.4.2, ElysiaJS, Colyseus and Discord bots are documented in
[`plans/convergence/ROSE-GRIFFON-ACHILLEA-CONVERGENCE.md`](plans/convergence/ROSE-GRIFFON-ACHILLEA-CONVERGENCE.md) and
[`architecture/convergence/BUN-ELYSIA-COLYSEUS-ARCHITECTURE.md`](architecture/convergence/BUN-ELYSIA-COLYSEUS-ARCHITECTURE.md).

SQL engines, clients, topology, migrations, backups and dedup rules for all of
Aphrody are decided in
[`decisions/infra/sql-convergence.md`](decisions/infra/sql-convergence.md);
the supporting 2026 research is in [`research/ai/sqllm/`](research/ai/sqllm/README.md).

The Tauri 3 upstream line, runtime choice, centralized versions and sync
script are documented in
[`operations/ui/tauri-upstream.md`](operations/ui/tauri-upstream.md).

Imported source documentation is indexed in
[`migration/IMPORTED-DOCS-INDEX.md`](migration/IMPORTED-DOCS-INDEX.md). Its
source paths, revisions, exact duplicate aliases and import status are recorded
in [`migration/source-map.json`](migration/source-map.json).

Imported scripts are indexed in
[`migration/IMPORTED-SCRIPTS-INDEX.md`](migration/IMPORTED-SCRIPTS-INDEX.md);
their relocation and provenance status are recorded in
[`migration/script-import.json`](migration/script-import.json).

The first Rust source extraction, IECODE's IEVR data crate, has a focused
provenance and validation record at
[`migration/ievr-iecode-extraction.json`](migration/ievr-iecode-extraction.json).
The staged IECODE Bun packages and compatibility limits are recorded in
[`migration/iecode-bun-extraction.json`](migration/iecode-bun-extraction.json).
The current NIE MCP tool/schema inventory is in
[`migration/NIE-MCP-API-INVENTORY.md`](migration/NIE-MCP-API-INVENTORY.md),
and the documentation link re-audit is in
[`migration/IMPORTED-DOCS-LINK-REAUDIT.md`](migration/IMPORTED-DOCS-LINK-REAUDIT.md).
The current IECODE crate import boundary is in
[`migration/IECODE-RUST-READINESS.md`](migration/IECODE-RUST-READINESS.md).
