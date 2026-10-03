---
name: nie-architecture
description: "Settled NIE (Inazuma Eleven Victory Road) architecture: one library owner per capability behind thin API/CLI/MCP/web bindings, and the native game UI as a separate reconstruction target. Use before placing NIE code or adding a parser, UI or binding."
---

# nie architecture

> **Applies when:** the IECODE checkout (its root has a `iecode:crates/nie` directory) is the working directory; paths prefixed `iecode:` are relative to that root, unprefixed paths to the Aphrody monorepo.
> **Otherwise:** read `docs/architecture/nie/` and `docs/reference/workspace/NIE-CAPABILITY-MAP.md` in the Aphrody monorepo, and say that the NIE sources are unavailable rather than guessing crate or file names.

`iecode:PLAN.md` is the execution ledger and `iecode:AGENTS.md` the only agent contract. This skill
fixes architectural choices; it does not certify that their implementation or reverse engineering is
complete. Use `nie-monorepo` for paths, dependency conventions and scoped commands.

## Two retained product goals

1. **Capabilities stay headless in their Rust library owner** (wiki, 3D editing, modding, reverse
   engineering, Lua, live memory) and are exposed through API, CLI, MCP, code/scripts and the
   Blender/mobile integrations; a preview may consume their read-only results but never becomes
   their operator surface. The former Inacord Tauri explorer and the former NIE web application
   (the nie-web app and the inacord-ui and asset-source packages) are not members of either
   checkout any more (`iecode:docs/nie/README.md`, `iecode:docs/nie/IECODE-MIGRATION.md`). The
   Aphrody desktop is the `aphrody-app` package (`crates/ui/app`, which has an `identity` module);
   the NIE MCP server (`iecode:crates/nie/aphrody-nie-mcp`) still exposes `explorer_*` tools that
   drive an Inacord page over a loopback bridge, so check `explorer_status` before assuming a client
   is connected.
2. **The native game UI remains a distinct reconstruction target.** Preserve native layouts,
   menus, animation, resource resolution and Lua/state contracts for backend behavior, mod
   authoring and production of a new `nie.exe`. Retain its reference ledger and native/Wasm
   evidence. Shared application completion and game reconstruction are separate acceptance axes.

Visual reference captures (explorer, game main menu) must never become runtime screen textures. No
reference authorizes fake gameplay, substitute artwork or the deletion of an underlying library owner.

## Public site boundary

The public IEVR site was the Rust `nie-site` binary (routes, read-only API, local mirror boundary).
Its crate is not in the IECODE tree; its retired deployment template is `systemd/nie-site.service`
and the retained spec is `iecode:docs/nie/SITE.md`. Whatever hosts it must not absorb desktop-only
VFS mutation, mods, reverse engineering or native game runtime state. Bun stays an operational
transport only; no TypeScript game-data parser or cloud-backed IEVR adapter.

## One implementation per role

Rust owners are packages under `iecode:crates/nie/aphrody-nie-<x>` (written `<x>` below).

| Role | Existing owner to extend |
|---|---|
| General UI primitives | `packages/rg/ui` (Aphrody monorepo); NIE-specific presentation has no maintained owner in either checkout, so decide it explicitly before adding one |
| Native desktop integration | `aphrody-app` (`crates/ui/app`), reached through the NIE MCP tools, never a direct dependency |
| Binary format decoding, including Level-5/Criware families | `formats` |
| Typed game tables | `data` |
| Resource inspection and media resolution | `explore` |
| SQLite/PostgreSQL connections and migration runners | `sql` (Postgres tooling in `pg`) |
| Domain state and simulation | `core`, `runtime`, `app` according to existing domain boundaries |
| Lua execution and observed native callbacks | `lua` |
| Scene documents, models and rendering | `render3d` (and `render` for RGBA8 composition), with `game`, `camera` and `ui` consumers |
| Save/mod/Steam capabilities | `save`, `viola`, `steam` |
| Game-data wiki mirror, projections and query APIs | `wiki` |
| Zukan candidate ranking | `zukan`; do not claim historical TypeScript pipelines migrated without proof |
| Executable forge and RE | `pe`, `asm`, `forge`, `re`, `index`, `trace` |
| Bun FFI | `ffi` (its library target is `iecode`) |
| CLI, MCP and Wasm | thin bindings: `cli` (binary `nie`), `mcp` (binary `aphrody-nie-mcp`, also `nie mcp`), `wasm` |
| Model/GLB HTTP serving | `model-serve` |

A CLI, command handler or React component must not become a second home for domain algorithms.
Extract reusable logic into its existing library owner, preserve the original caller, then add
other bindings. Do not create another parser, navigation implementation or UI package without
first checking existing owners. Authentication, publishing and remote storage remain separate
application infrastructure; they are not game-engine capabilities.

## Native resources as the principal theme

- Display localized entity names alongside exact game/resource IDs for characters, skills,
  stadiums, keshins, items and story moments. Resolve media-folder labels from verified native
  text-CFG relations in the user's language. Backend VFS paths and database keys stay unchanged.
  Unsupported joins remain explicit; a hand-written category label is not native localization.
- The shared native-text contract addresses a label by the measured `(VFS locale, family, hash)`
  tuple and retains source-file provenance and hash ambiguity. Do not use a UI fallback string as
  a translated game label. The shell URL locales and game VFS locales are distinct: all measured
  VFS languages are selectable for game text without claiming a translated host route exists.
- A gallery shares one deduplicated resource inventory: counts and pagination must come from it,
  not from summed source totals. Azalee data/filter/card capabilities live in
  `iecode:packages/azalee` and are consumed through host adapters.

- Keep source VFS path, native resource/region identity, filename and existing slug traceable in
  resource contracts. Preserve served routes and identifiers during migration.
- Reuse decoded spritesheets, bitmap-font rasterization, native media and measured palette data.
  A transformed mask or a character-derived palette must not be described as an exact original
  menu resource. Missing icon mappings remain explicit work, not guessed substitutions.
- Load resources on demand with shared caching; preload startup music, SFX, fonts and required
  assets through the existing loader. Keep navigation usable during loading and errors.
- Localized textures, fonts and other declared companions use the native VFS companion resolver
  with the selected game locale. A host may fall back only when that resolver returns a concrete
  common/non-localized VFS path; it must never reconstruct locale directories in CSS or JS.
- Expose supported native formats as first-class resource types through common decoders and
  adapters. Conversion/export is an explicit optional operation, not a separate mandatory import
  pipeline. Browser codec or OS limitations require real adapters and honest capability results.

## Host convergence and migration boundaries

Keep one presentation owner for a 3D editor/viewer and one preview lifecycle per host: do not
create another editor to add a host. The Rust reconstruction renderer (`render3d`, `game`)
remains a distinct backend until its rendering and editing contracts reach measured parity.

Native adapters retain filesystem and process operations; web adapters use the existing HTTP/Wasm
owners. A browser adapter must fail desktop filesystem, process, updater and mutation commands
explicitly: never hide an unavailable operation behind a successful no-op.

Wiki raw queries, legacy MCP facades and TypeScript ranking remain compatibility boundaries
until consumer migration is demonstrated.

Use one root Cargo workspace/lockfile and one Bun catalog/lockfile. Dependency convergence
preserves consumer features and target conditions; it does not require one package for unrelated
roles. New shared behavior goes to an existing NIE crate or a maintained Aphrody owner, never a
parallel placeholder crate; read `iecode:docs/nie/IECODE-MIGRATION.md` and
`iecode:docs/migrations/NIERS-ABSORPTION.md` before adding a parser or data family.

## Acceptance

Track application feature preservation, native theme provenance, native game reconstruction and
executable production separately. Require relevant interaction, decoding, round-trip, rendering
and native/Wasm gates with nonzero counts before completion claims. Compilation or an HTTP 200
is insufficient. Keep unsupported formats and unproven reverse-engineering behavior visible in
`iecode:PLAN.md`; the architectural decision never turns those gaps into completed work.
