# NIE factual context

## Verified source state

| Item | Observed state |
| --- | --- |
| Source repository | `aphrody-code/nie`, local `/home/aphro/src/nie` |
| Revision | `34c55fa` (`main` equals `origin/main`) |
| Git history | The local clone is shallow (one commit); remote history confirms `nie-steam` was ported from IECODE's C# SteamKit2 layer in `b1e02ccc` and extended in `903481c7`. |
| Rust | 46 active `crates/{engine,forge,tools}` members; `crates/archive/nie-engine` is explicitly excluded and `crates/archive/nie-rs` is reference-only. |
| Bun | One workspace: `apps/nie-web` plus six active packages. |
| Python | Root `nie-tools` UV project and `python/niepy` package. |
| IEVR identity | `nie-steam`, the game formats, reconstruction forge, runtime, web client, and `niepy` all name or document Inazuma Eleven: Victory Road directly. |

The source repository explicitly says that IEVR web runtime is `nie-site` plus
`apps/nie-web`; the former Inacord Tauri host was removed. It also declares
that the generic desktop reaches game capabilities only through the `nie.*`
MCP process boundary.

## Existing cross-repository boundaries

NIE already consumes portable IECODE crates through path dependencies:
`iecode-re`, `iecode-sql`, `iecode-video`, `iecode-emu`, `iecode-geom`, and
`iecode-tasks`. Its `Cargo.toml` also consumes generic Aphrody components from
`aphrody-os` and `aphrody-ui`. The consolidation removes the accidental
two-workspace arrangement; it must not replace it with new sibling path
dependencies.

IECODE already has one Cargo workspace, one Bun workspace and one UV lock. Its
UV member `src/niepy` is an implemented package with modules and tests; its
modules differ from NIE's `python/niepy`. The migration must compare and merge
both APIs without overwriting either implementation or adding a second lock or
Python root. The user-defined ownership
split is explicit: Aphrody owns cross-product MCP/plugin, AI/RAG, database,
cache, generic RE, 3D-rendering, automation scripts/pipelines, computer-use,
filesystem/explorer, compression, conversion/import-export and UI platforms;
IECODE owns the IEVR binary, game VFS, game data, game formats, game wiki and
their adapters.

## Infrastructure boundary

The Aphrody Infra CLI was queried read-only on 2026-09-29. It reports a clean
NIE worktree at `34c55fa`, the WSL build host with Rust, Cargo, Bun and UV, and
the current pipeline still targets both `nie` and `iecode`. Its service and
route catalogues mark the public NIE runtime retired on 2026-09-25.

This is context, not a migration workstream: only the Aphrody Infra CLI and
its owning repository may plan or apply topology, service, route or release
changes. IECODE exposes application gates only.

## Existing ownership collisions

IECODE's `iecode-core` re-exports `iecode-re` and `iecode-pipeline`, and
`iecode-ffi` exposes pipeline validation. Those are live public APIs, while
`aphrody-os/crates/aphrody-re` already owns generic PE, ELF, Mach-O and
disassembly capabilities. A generic pipeline owner has not yet been verified
from the repository inventory. The migration must map callers, schemas and
behavior before replacing either API.

`aphrody-ai/crates/aphrody` is the existing Aphrody CLI package and
`aphrody-ai/crates/aphrody-mcp` is the unified MCP server. NIE's `nie-mcp`
depends on `nie-cli`; `@nie/plugin` registers game-format Bun loaders. Their
game-specific commands and loaders need adapters in the existing command and
plugin surfaces.

No game dump, Steam credential, refresh token, licensed SDK, local model cache,
SQLite index, PostgreSQL data, `target`, `node_modules`, `dist`, or generated
VFS archive is a migration input.
