---
name: nie-monorepo
description: Navigate the nie Rust and Bun workspaces, choose the existing owner for a capability, and apply shared dependency, host, validation, and commit conventions. Use before placing files, changing packages, or building nie.
---

# nie monorepo

Read `PLAN.md` first: it is the only active execution plan. Read the nearest `AGENTS.md`
before editing. Use `nie-architecture` for the settled product and ownership boundaries.
Archived plans are historical evidence, not instructions.

## Source layout

| Path | Responsibility |
|---|---|
| `crates/engine/*` | Shared formats, data, Lua, runtime, rendering, resources and editing contracts |
| `crates/forge/*` | Executable production and reverse-engineering evidence |
| `crates/tools/*` | Existing CLI, MCP, HTTP, wiki and operational owners; extract reusable logic before adding another binding |
| `crates/archive/*` | Historical reference outside the maintained workspace |
| `apps/nie-web` | Canonical browser and desktop frontend source and Vite build; the only frontend application in nie |
| `apps/nie-web/src/desktop` | Workspace views mounted by `BrowserHost`, the only host adapter since the Inacord Tauri app was removed on 2026-09-26 |
| sibling `rg/packages/ui` | General UI primitives owned by the RG repository; nie consumes the package without copying it |
| `packages/inacord-ui` | Shared application/game presentation, Explorer controls and resource components |
| `packages/asset-source` | Asset transport, loading and capability contracts |
| `packages/nie` | Rust FFI consumption from Bun |
| `packages/nie-plugin` | Bun game-file import adapter |
| `packages/nie-bridge` | Existing automation/control transport contract |
| `crates/tools/nie-site` | Rust public site, pages and read-only IEVR HTTP API |
| `crates/tools/nie-wiki` | Rust IEVR mirror queries, projections and native desktop operations |
| `data/`, `var/` | Private game resources, measurements and generated evidence; preserve user content |

There is no Tauri host in nie: the Inacord Tauri app (`apps/inacord`) was removed on 2026-09-26.
The desktop is aphrody-ui `crates/aphrody-app`; IEVR stays in nie web (`nie-site` + `apps/nie-web`),
and the app reaches the game only through the `nie.*` tools of aphrody-ai `aphrody-mcp`. The
native game UI is retained in nie as a separate reconstruction/authoring/forge target, headless.
A shared build entry alone does not prove that every capability works in the browser.

## Dependency ownership

- Root `Cargo.toml` owns dependency versions and local crate paths. Members use
  `workspace = true`, retaining role-specific features, optional flags and target conditions.
- Root `Cargo.lock` no longer includes Tauri: the desktop package was removed on 2026-09-26.
  Do not recreate a nested desktop workspace or lockfile, or reintroduce a Tauri member here.
- SQLite and PostgreSQL sessions and migration runners belong to `nie-sql`; `nie-explore` is the
  adapter. Do not reintroduce a parallel SQL plugin stack.
- Root `package.json` owns Bun workspaces and dependency catalogs. Local dependencies use
  `workspace:*`; external dependencies use `catalog:` or a declared named catalog. Peer
  requirements remain compatibility contracts. Keep one root `bun.lock`.
- A library owns its direct imports. Do not copy all library dependencies into the frontend,
  merge unrelated responsibilities into a giant package, or remove a compatibility facade
  before its consumers migrate.

## Scoped commands

Run from the root unless a directory is specified. Select gates for changed owners; defer them
until the source phase is complete when the user explicitly requests that order.

```bash
bun run check:dependencies
cargo clippy -p <library-crate> --lib --tests --locked -- -D warnings
cargo test -p <library-crate> --locked <test-filter>
bun run --cwd apps/nie-web typecheck
bun run --cwd apps/nie-web typecheck:desktop
```

Use existing build scripts for Wasm/FFI and host artifacts. Never run
`cargo build --workspace --all-targets` on the constrained host. Python commands use `uv run`.

## Handoff and traps

- Inspect `git status --short` before edits. Reserve exclusive file scopes for parallel agents.
- Stage explicit task-owned paths; preserve unrelated changes and user captures. Commit coherent
  completed batches. Push/deploy only when the user's publication authorization covers it.
- Record exact nonzero test/assertion counts and failures in `PLAN.md`. Build success is not UI,
  native/Wasm, or executable parity. Never use a zero-test run as a passing test gate.
- Preserve copyrighted resources privately; do not stage game dumps or bulk evidence. Existing
  tracked user artifacts must not be deleted as cleanup.
- Bun preloading may load `nie-ffi`; inspect `bunfig.toml` and build the FFI library if required.
  On Windows, identify the process holding a DLL before stopping it; never use broad process kills.
- VFS access requires the configured game installation (`NIE_GAME_DIR` when used by the owner).
- Machine-specific failures are evidence to diagnose, not permanent exemptions from a gate.
- Code, identifiers, paths and agent documentation are English; user-facing French prose is allowed.
