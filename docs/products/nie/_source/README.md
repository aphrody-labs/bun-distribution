# Documentation index

Every document under `docs/` is listed here, and a gate enforces it: `bun run docs:check` fails if
a file is added to this directory without an entry below. Measured 2026-09-19, **16 of 34
documents were missing** from the previous index — including `ARCHITECTURE.md`, which 22 other
files link to. An index that covers half the corpus is worse than no index, because it reads as
exhaustive.

The repository has one execution plan: [`../PLAN.md`](../../../plans/nie/_source/PLAN.md). Documents here provide
evidence and specifications; they do not define competing priorities. Superseded plans
remain in [Git history at `c3fa2af`](https://github.com/aphrody-code/nie/tree/c3fa2af/docs/archive/plans).

## Start here

| Document | What it owns |
| --- | --- |
| [`../README.md`](./README.md.1420254c5733) | What the project is, its measured status, the five shipped surfaces. |
| [`../CONTRIBUTING.md`](../../../guides/nie/_source/CONTRIBUTING.md) | The gate, commit and PR rules, and how to build/release/deploy one surface. |
| [`../PLAN.md`](../../../plans/nie/_source/PLAN.md) | The only active roadmap and gate ledger. Architecture ownership, priorities, measured state. |
| [`../AGENTS.md`](../../../reference/nie/_source/AGENTS.md) | Short operational instructions every agent reads first, whatever its engine. |
| [`ARCHITECTURE.md`](../../../architecture/nie/_source/ARCHITECTURE.md) | Who does what under this root, and **what must never be merged**. |
| [`ORGANISATION.md`](../../../reference/nie/_source/ORGANISATION.md) | Where a new file goes, and why. Modelled on `openai/codex`. |

## Reverse engineering, the binary and its formats

| Document | What it owns |
| --- | --- |
| [`ATLAS.md`](../../../reference/nie/_source/ATLAS.md) | The single index of every RE surface (files, crates, docs, KB digest, forge, tools) and the loop that aims at 100 %. |
| [`RE.md`](../../../reference/nie/_source/RE.md) | The RE knowledge base, function anchoring, decompiled structures. |
| [`FORGE.md`](../../../reference/nie/_source/FORGE.md) | Producing `nie.exe` byte for byte, and the measurement that judges it. |
| [`FORMATS.md`](../../../apis/nie/_source/FORMATS.md) | CPK, RDBN, T2B, the G4\* family, Criware audio — the container specifications. |
| [`VFS.md`](../../../reference/nie/_source/VFS.md) | The virtual file system and its 255 342 indexed files. |
| [`CAMERA-G4CM.md`](../../../reference/nie/CAMERA-G4CM.md) | The cutscene cameras: 1 215 `.g4cm` decoded, and what still blocks. |
| [`COMPUTER-USE-RE-TRACE.md`](../../../reference/nie/COMPUTER-USE-RE-TRACE.md) | The read-only boundary, provenance, guardrails, and the `nie-re`/`nie-trace` migration decision. |
| [`RE-MIGRATION-MAP.md`](../../../reference/nie/RE-MIGRATION-MAP.md) | Subsystem classification of nie.exe (117,068 functions) and roadmap for migration to Rust. |
| [`re/README.md`](./re/README.md) | Canonical centre for RE data and the local → consumer → Rust → parity audit rule. |
| [`nie-rtti-classes.txt`](../../../reference/nie/nie-rtti-classes.txt) | Raw RTTI class listing extracted from the binary. |
| [`dll-exports/`](dll-exports/) | Export tables of the DLLs the game loads. |

## Engine, rendering and the game's screens

| Document | What it owns |
| --- | --- |
| [`STACK.md`](../../../reference/nie/STACK.md) | Engine runtime architecture, Lua 5.2 integration, the main loop. |
| [`DESIGN.md`](../../../architecture/nie/_source/DESIGN.md) | Pixel-perfect rendering of the Start, Menu and HUD screens, measured on real captures. |
| [`DESIGN-UI.md`](../../../architecture/nie/DESIGN-UI.md) | The UI design system derived from those measurements. |
| [`AVATAR.md`](../../../reference/nie/AVATAR.md) | Full specification of the avatar editor (`chara_edit`). |
| [`modele-de-match.md`](../../../reference/nie/modele-de-match.md) | Match simulation, and the shoot/save evaluator as actually reversed. |
| [`mainmenu01-visual-analysis.md`](../../../reference/nie/_source/mainmenu01-visual-analysis.md) | Measurements and visual analysis of the `mainmenu01` layer. |
| [`ui-convergence-visual-analysis.md`](../../../reference/nie/ui-convergence-visual-analysis.md) | Where `nie-web` and Inacord agree visually, and where they do not. |
| [`RENDER-QA.md`](../../../reference/nie/RENDER-QA.md) | Graphics backends per platform, visual QA of an assembled GLB, and why the three rasterisers must be compared on a non-square viewport. |
| [`MEDIA-COVERAGE.md`](../../../reference/nie/MEDIA-COVERAGE.md) | Measured coverage of game media exposed by the web gallery and its reproducible inventory commands. |
| [`BENCHMARKS.md`](../../../research/nie/BENCHMARKS.md) | Comparative performance measurements. |
| [`VIDEO-STACK.md`](../../../reference/nie/VIDEO-STACK.md) | The video stack chosen across the Rust and Bun ecosystems, measured on this machine. |
| [`BEVY.md`](../../../reference/nie/BEVY.md) | Bevy adapter evaluation against Bevy 0.19.1: boundaries, assets, gizmos, and why ECS stays out of the simulation core. |
| [`game-data/`](game-data/) | Extracted game-data references. |
| [`vfs/`](vfs/) | VFS inventories and per-mount notes. |
| [`architecture/`](architecture/) | Ownership and shared-surface contracts per application. |

## Applications, services and content

| Document | What it owns |
| --- | --- |
| [`SITE.md`](../../../reference/nie/_source/SITE.md) | What `nie.aphrody.com` is and is not: names, the placeholder home page, the one startup gate, the silent pagination clip. |
| [`MCP.md`](../../../reference/nie/_source/MCP.md) | The pure-Rust native MCP server (`rmcp`), its security model and its tests. |
| [`NIE-ET-CLI.md`](../../../reference/nie/NIE-ET-CLI.md) | Architecture of `nie.exe` and complete operational manual of the `nie` CLI. |
| [`INSTALLATION.md`](../../../guides/nie/_source/INSTALLATION.md) | Installing the `nie` CLI from the `nie-cli` package. |
| [`STEAM-LINUX.md`](../../../reference/nie/STEAM-LINUX.md) | Steam/Proton/SteamCMD setup for running `nie.exe` natively on Linux. |
| [`IEVR-SAVE-EDITOR-PORT.md`](../../../reference/nie/IEVR-SAVE-EDITOR-PORT.md) | Reverse engineering and native Rust port of the Save Editor (v2.2.2, .NET 9): 33 memory hooks, 142 Spirit Cards, 1 299 Supertechniques. |
| [`FAN-MODS.md`](../../../reference/nie/FAN-MODS.md) | Version inventory, legal acquisition, VFS mod manifests, `.utmod` handling and the Rust creation/validation workflow. |
| [`CONSOLE-PIPELINE.md`](../../../reference/nie/CONSOLE-PIPELINE.md) | Unified DS/3DS/Wii/Android extraction, decoding, modding and emulator-validation boundary. |
| [`IEVR-ULTIMATE-TEAM.md`](../../../reference/nie/IEVR-ULTIMATE-TEAM.md) | Full native port of IEVR Ultimate Team: Supabase mirror (497 players, 69 teams, 8 packs), 663 assets (28 MB), pack simulator, 2D formation placement (9 canonical + dynamic algorithm A), AES-256-GCM, EAC bypass and MCP. |
| [`NIE-ONLINE-MODE.md`](../../../reference/nie/NIE-ONLINE-MODE.md) | The reversed network subsystem of `nie.exe` (Level-5 / Epic Online Services) and the `nie-net` community multiplayer architecture. |
| [`esport/`](esport/) | Inazuma Eleven VR e-sport & competitive specification: 11 rank tiers, directional ELO, dynamic matchmaking, double validation, tournaments and clans. |
| [`ASTRO-LOR.md`](../../../reference/nie/_source/ASTRO-LOR.md) | Astro Lor, an **original** character: present in no CPK, produced entirely here. |
| [`EXPORT-APP.md`](../../../reference/nie/EXPORT-APP.md) | The app-icon export tool: 30 000+ files to WebP + zstd in one archive. |
| [`BXC-NATIVE.md`](../../../reference/nie/BXC-NATIVE.md) | Why the external BXC browser engine has no local Bun service layer. |
| [`AFUBUKI-UNIFIED-PIPELINE.md`](../../../reference/nie/AFUBUKI-UNIFIED-PIPELINE.md) | Unified Afubuki VFS, Zukan, OC and rendering pipeline. |

## Operations and infrastructure

| Document | What it owns |
| --- | --- |
| [`DEVELOPMENT-ENVIRONMENT.md`](../../../reference/nie/DEVELOPMENT-ENVIRONMENT.md) | Reproducible shell environment, repository-local agent configuration, secret-file boundary, validation, and rollback. |
| [`HOSTS-AND-PORTS.md`](../../../reference/nie/HOSTS-AND-PORTS.md) | Pointer: hosts, ports, routes and DNS are owned by aphrody-infra (`config/service-catalog.json`, `config/nginx-routes.json`, `docs/ops/OVH.md`). |
| [`SERVER-ROBUSTNESS.md`](../../../reference/nie/SERVER-ROBUSTNESS.md) | Server landscape, runtime library evaluation, and resilience hardening across `nie-site`, `nie-model-serve`, and `nie-net`. |
| `../aphrody-infra/docs/ops/OVH.md` | The three OVH accounts, their zones, records and procedures (moved to aphrody-infra). |
| [`legal/`](legal/) | The signed exploitation agreement and its annexes. |

## Agents and multi-engine work

| Document | What it owns |
| --- | --- |
| [`A2A-CODEX.md`](../../../reference/nie/_source/A2A-CODEX.md) | The agent-to-agent wire protocol. The rules about *not overwriting each other* live in `AGENTS.md` § 2. |
| [`AGENT-SYNC.md`](../../../reference/nie/AGENT-SYNC.md) | Synchronisation contract between local agents and the VPS. |

## History

| Document | What it owns |
| --- | --- |
| [`../PROVENANCE.md`](../../../reference/nie/_source/PROVENANCE.md) | Per-tree provenance, and what was dropped on import. |
| [`IECODE-MIGRATION.md`](../../../reference/nie/_source/IECODE-MIGRATION.md) | The source-to-crate ledger of the C++ and C# toolkits, exported 2026-09-07. |
| [`IMPORT-EXPORT.md`](../../../reference/nie/IMPORT-EXPORT.md) | Import/export boundaries for game data and assets. |
| [`PUBLIC-NAMING.md`](../../../reference/nie/PUBLIC-NAMING.md) | Public naming and identity conventions. |
| [`reports/`](reports/) | Dated audits (crates, Bun apps and packages, 2026-09-25) the current plan was triaged against. |

## The two invariants

1. **No blind commit.** A gate is passed only when a command has run and returned an exact count
   — lines, links, bytes, exit code. Paste the output, not the intention.
2. **A deployed service is not done until it answers.** A live request on its port or domain has
   to certify the status; `systemctl is-active` does not.

## RE anchors

Knowledge base (`var/nie.sqlite`) tables:
- `function` — 117 068 functions of `nie.exe`
- `coverage` — binary coverage metrics
- `xref` — call-graph topology
- `pdata_func` — `.pdata` function boundaries
- `hash_name` — VFS CRC32 table
- `forge_unit` — unit compilation tracking
- `rtti_class` — RTTI MSVC hierarchy

Key binary addresses:
- `0x1404ecd60` — Mesh transform dispatch
- `0x1406d5840` — Main tick loop
