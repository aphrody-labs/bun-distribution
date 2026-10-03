<!-- SPDX-License-Identifier: Apache-2.0 -->
# NIE capability map for IECODE and Aphrody owners

Evidence and proposed ownership for the [workspace convergence plan](../../../PLAN.md#nie-convergence).
This is a source audit, not proof of installed parity or a replacement for each
repository's implementation plan. Baseline: root NIE gitlink
`34c55fa1da54f715bb78ac336167fe18b13f9cca`, checked on 2026-09-29.
This matrix records that historical source shape. The 2026-10-01 source
transfer is recorded in the IECODE
[migration map](../../../../iecode/docs/migrations/ievr-to-iecode-2026-10-01.json).
The old NIE checkout paths below are historical. The active owner is the
`../iecode` workspace ([rules](../../../../iecode/AGENTS.md),
[plan](../../../../iecode/PLAN.md)); source presence or a historical UI/Web copy
does not establish current parity.

## Current ownership correction — 2026-09-30

This map is a historical inventory of the prior split, not a live consolidation
plan. Current ownership is defined by the IECODE
[rules](../../../../iecode/AGENTS.md) and [plan](../../../../iecode/PLAN.md). The active
source copies and integrations formerly present under `~/src`,
`<repo>`, and `../aphrody-py` were removed where the
IECODE owner already exists, as recorded in the
[transfer report](../../../../iecode/docs/migrations/IEVR-TO-IECODE-2026-10-01.md).
Do not use the remaining split-repository paths in this snapshot as live links.

## Inventory and dependency boundary

The WSL `nie/` checkout had zero files and a Git directory without `HEAD`,
`config` or index. The pinned revision was restored from its remote; the
incomplete directory is retained outside the workspace under
`~/.local/share/aphrody-workspace-recovery/nie-corrupt-20260929`. Infra's
[`@aphrody/workspace packages status`](../../../packages/infra/workspace/README.md)
now discovers NIE's Bun lockfile. The regenerated
[ecosystem inventory](../../ecosystem/ECOSYSTEM.md#nie)
records 46 live NIE crates, 9 Bun entries and 2 uv projects; the preceding
catalogue recorded none because the checkout was empty. Across the source root
it records 242 crates and 158 Bun packages. Infra's
[repository layering scanner](../../../scripts/repo-layering.ts)
reports 10 Aphrody category repositories, 92 Rust dependency edges, no cycles
and no layer violations before migration.

The old NIE checkout metadata (historical path: `../nie/Cargo.toml`) specified
`publish = false` and a commercial `license-file`; a former
`@aphrody/nie` package manifest declared MIT. That package path does not exist
in the active IECODE tree, so these values are historical evidence, not a
current metadata conflict. Recheck provenance and distribution scope against
the active IECODE manifests before redistribution. Untracked game assets and
working databases are not covered by source migration.

The ownership rule is **IECODE for every IEVR-specific rule, format, dataset,
workflow and adapter; existing Aphrody repositories for reusable capability,
public host and infrastructure**. No `aphrody-engine` repository is created.
IECODE already has `iecode-re`, `iecode-geom`, `iecode-video`, `iecode-tasks`,
`iecode-sql`, `iecode-emu` and `iecode-pipeline`; NIE aliases the first six.
Extract reusable pieces into the relevant Aphrody owner only when they are
demonstrably generic; keep game-specific code in IECODE. In particular OS
already has `aphrody-re`, `aphrody-task-runner` and `aphrody-jobs`.
`iecode-pipeline` validates manifests but does not execute jobs; the generic
executor is OS. Importing the `iecode-core` facade would pull all seven
leaves. IECODE's game state must stop depending on the UI renderer before
grafting: OS → UI and other reverse category dependencies remain forbidden.

## One authority per surface

| Public surface | Current collision | Target owner and cutover |
| --- | --- | --- |
| Agent plugin | `aphrody-ai/plugins/aphrody` exists; NIE contains a Bun preload, a Blender add-on and `plugins/aphrody/skills/yolo`. | AI publishes one agent plugin. Bun loaders and Blender remain format adapters; compare YOLO scripts with Infra's `aphrody-yolo` before removing the duplicate package. |
| MCP | The plugin manifest (historical path: `../aphrody-ai/plugins/aphrody/.mcp.json`) declares `aphrody-kernel mcp` and `aphrody-mcp server`; the NIE relay (historical path: `../aphrody-ai/crates/aphrody-mcp/src/nie_tools.rs`) starts `nie-mcp`. UI/Web also have specialist MCP binaries. | `aphrody-mcp` is the sole published stdio endpoint. OS kernel, UI, Web and IEVR remain capability owners through libraries or internal IPC. Migrate tool schemas and clients before removing child servers. |
| UI library | `@aphrody/m3` (historical path: `../aphrody-ui/packages/m3/package.json`) and its modules coexist with the Vite alias `@nie/inacord-ui`; NIE web still depends on Radix and Rosegriffon UI. | One M3 public framework API. Generic primitives and Explorer components move to UI; IEVR tokens, layouts and game rules move to IECODE as a client of that API. Migrate consumers before dropping aliases. Radix stays outside the active Aphrody UI graph. |
| Desktop | `aphrody-app` (historical path: `../aphrody-ui/crates/aphrody-app/Cargo.toml`) is the Tauri host; `aphrody-model-view` (historical path: `../aphrody-ui/crates/aphrody-model-view/Cargo.toml`) is another Tauri binary. `nie-game` is winit/wgpu; `nie-editor` is eframe. | One Tauri app and one qualified native wgpu 3D app under UI. Move reusable host/viewer code there; IECODE provides IEVR scenes and editing actions. Qualify accessibility, installed workflows and the UI wgpu 26 versus NIE wgpu 29 dependency gap. |
| CLI and shell | AI owns `aphrody`; NIE scripts use `nie`, `nie-mcp` and specialist binaries. Shell already owns PTY/VT/Nushell/TUI. | One public `aphrody` CLI, with compatibility shims while scripts migrate. No second Shell or browser view in the public webview. |
| RAG and databases | AI `aphrody-rag` provides FTS/vector search; `nie-wiki` serves structured SQLite and `nie-index` holds RE knowledge. | One RAG engine in AI, ingesting verified IEVR documents through an IECODE adapter. Structured wiki queries and RE provenance belong to IECODE. |
| RE, jobs and VFS | OS has `aphrody-re`, jobs, Drive, fsindex and kernel; Infra still exposes `VirtualDriveEngine`; NIE has forge, queue, CPK VFS and index. | One generic OS RE API/executor, one Files API and Explorer, one kernel. IECODE owns the game forge, CPK source/preview adapter and RE corpus. Its bounded RE frontier is not a second system job queue; its RE index is not file search. Follow the Files audit. |
| Public HTTP | `nie-site` serves IEVR routes and `nie-model-serve` serves GLB; `aphrody-site` serves Aphrody routes. | Web owns `aphrody-site` as the public origin and transport. IECODE owns IEVR handlers and model composition; migrate auth, assets, streaming and legacy URLs with parity and rollback. |

## Assignment of every live NIE crate

Every active crate appears exactly once below. The IECODE column captures its
game-specific contribution; the Aphrody column identifies reusable code or
host bindings to extract. A crate may be split, but its implementation is not
copied into two competing authorities. The
[generated list](../../ecosystem/ECOSYSTEM.md#nie)
contains each manifest, binary and feature.

| NIE crates | IECODE receives | Aphrody receives / migration condition |
| --- | --- | --- |
| `nie-core`, `nie-data`, `nie-formats`, `nie-lua`, `nie-lua-web`, `nie-save`, `nie-camera`, `nie-net`, `nie-explore`, `nie-viola`, `nie-ocgen`, `nie-pg`, `nie-wiki`, `nie-zukan`, `nie-steam`, `nie-launcher` | The game rules, Level-5 formats, CPK VFS source, saves, Lua scripts, camera, online protocol, modding, Steam depot policy, wiki and schema `nie`. `nie-lua-web` keeps its Emscripten requirement. | OS supplies Files/VDFS, process/job policy and generic Steam/SQL adapters where useful; Contracts carries only shared wire envelopes. IECODE's `nie-explore` plugs into the single Files API, never becomes another general Explorer or kernel. |
| `ievr-tools`, `nie-asm`, `nie-dump`, `nie-forge`, `nie-index`, `nie-pe`, `nie-queue`, `nie-re`, `nie-seed`, `nie-trace`, `nie-computer-use` | `nie.exe` provenance, byte exact PE/assembler rules, RTTI and labels, RE corpus/frontier, game image base, live game probes and forge stages G4–G6. | OS `aphrody-re` receives only generic minidump/disasm/process inspection missing today; `aphrody-task-runner`/`aphrody-jobs` execute jobs. Compare divergent `ievr-tools` and OS `aphrody-ievr` before removing either copy. The IEVR index is not RAG or Files search. |
| `nie-bench` | IEVR fixtures and expected hot-path outputs. | Infra owns reusable cross-language measurement orchestration; no product runtime is added. |
| `nie-aphrody-gisement`, `nie-bevy`, `nie-editor`, `nie-game`, `nie-render`, `nie-render3d`, `nie-ui`, `nie-viewer-web` | IEVR asset loaders, game scenes, tokens, editing actions and pixel-accurate outputs; optional Bevy loader and game-specific WebGL fallback. | UI owns reusable 2D/3D rendering, the generic editor/viewer, `aphrody-identity`, one Tauri host and one native wgpu host. Remove `nie-editor` and `nie-game` as separate binaries only when their modes work in the shared host. |
| `nie-app`, `nie-runtime`, `nie-play` | One IEVR state machine, simulation, scripted playthrough and its golden expectations. | UI owns generic renderer contracts and PNG/MP4 presentation; OS can own a generic deterministic scheduler if needed. Split the current direct `nie-render3d` dependency so IECODE consumes UI/OS without reverse category edges. |
| `nie-site`, `nie-model-serve` | IEVR route handlers, typed game catalogs and GLB/menu composition. | Web owns the `aphrody-site` HTTP server, auth, transport and legacy route compatibility; UI provides generic GLB rendering where reused. `nie-model-serve` does not serve AI inference models. |
| `nie-ffi`, `nie-wasm`, `nie-headless` | IEVR C-ABI, WASM exports and format-inspection functions. | UI's `@aphrody/bun` and Web's WASM host provide reusable binding/build mechanics; AI owns the public CLI command. Split `nie-wasm`, which imports almost every NIE crate, into demand-loaded capabilities before packaging. |
| `nie-cli`, `nie-mcp` | Domain command implementations and tool semantics as library APIs. | AI owns the sole public `aphrody` CLI and `aphrody-mcp`. Keep compatibility shims until scripts, bridges and all 19 `nie.*` tools migrate. |

## Bun, Python, UI and site consumers

| NIE source | Destination | Consumer to migrate |
| --- | --- | --- |
| `packages/nie-game` (not in repo) (`@nie/game`) | IECODE game domain package | Game and Explorer; preserve formations/text/rules without a second TS game implementation. |
| `packages/asset-source` (not in repo) (`@nie/asset-source`) | IECODE game asset client; Contracts only for messages crossing processes | `nie-web` and desktop loading consume OS Files/Web transport. Preserve `/f`, `/b` compatibility only behind the existing access policy. |
| `packages/nie-bridge` (not in repo) (`@nie/bridge`) | IECODE IEVR command DTO; Contracts for neutral control envelope | AI/UI clients call the single MCP/Files APIs after migration. |
| `packages/nie` (not in repo) (`@aphrody/nie`) | IECODE Bun FFI binding over its game libraries | Native decoding callers can reuse UI's `@aphrody/bun` bridge mechanics. Resolve MIT versus commercial Rust metadata first. |
| `packages/nie-plugin` (not in repo) (`@nie/plugin`) | IECODE Bun loaders for game formats | Generic happy-dom/test preload may reuse Compat/UI tooling; it is not an agent plugin. |
| `packages/nie-media` (not in repo) (`nie-media`) | IECODE episode/media domain logic | Aphrody Web supplies host/player transport; this package is no scraper, bot or encoder. |
| `apps/nie-web` (not in repo) (`nie-web`) | IECODE IEVR pages, `/inacord` game views and browser game client | Web serves the bundle through `aphrody-site`; UI owns reusable Explorer/editor components and M3 shell. Current Vite alias `@nie/inacord-ui` has 109 users; `src/desktop/Workspace.tsx` mounts Explorer only. Migrate Radix/Rosegriffon imports to M3/Base UI before cutover. |
| NIE Bun root `nie-monorepo` | No final runtime | Keep its lockfile/build scripts until consumers and reproducible builds are transferred. |
| `plugins/aphrody/skills/yolo` (`@aphrody/yolo`) | Infra's `aphrody-yolo` plus the single AI plugin | Compare commands and scripts before deleting a second automation package. |
| `nie-tools`, `niepy` uv projects | IECODE game RE/format adapters, with OS/AI public bindings | Inventory Python imports and Ren'Py/Blender consumers before deciding which code stays as optional tooling. |

`@nie/inacord-ui` is a Vite alias into `docs/products/ui/apps/nie-web/src/inacord`, not a
published package. Its game-specific views belong to IECODE; reusable M3
components belong to UI. `plugins/nie-blender` (not in repo) stays an IECODE game-format
add-on, not a
second agent plugin. `crates/archive/nie-engine` (not in repo) and `nie-rs` remain source
references outside the 46 live crates. Koharu receives no complete NIE crate:
its manga scene and pipeline already have owners. Shell receives no NIE
terminal; Discord receives no NIE bot package in the current checkout.

## Parity ledger required before removing NIE

For every migrated feature, record old command/route/tool and output, new
owner/API, consumer migration, data format/version, host, fixture, result and
rollback. Reuse the NIE plan (historical path: `../nie/PLAN.md`) and its byte exact forge G4–G6,
golden data, cross-host, screenshots, WASM and Inacord persistence gates.
Include the real Tauri and native wgpu apps, website auth/legacy URLs, CPK and
save files, wiki/RE database migration, scripts and all 19 `nie.*` MCP tools.
The current `nie-wasm` 2D rendering is partial and cannot be counted as game
parity. Remove a source or service only when its last consumer has moved and
the matching behavior and recovery path have been demonstrated.
