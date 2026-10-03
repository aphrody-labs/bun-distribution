# NIE MCP and plugin API inventory

Audit date: 2026-09-29. Read-only source comparison; no binaries or protected
game data were opened.

## Revisions and current locations

| Repository | HEAD | Worktree |
| --- | --- | --- |
| NIE submodule object DB at `~/src/.git/modules/nie` | `94d88bc3993e7dabddf44ce9804d5b41ee5d4c4c` (superproject gitlink) | source worktree absent; tree readable from local Git objects |
| `../iecode` | `8fdab4b96014f70972c2855878cab49510ffe876` | clean, `main...origin/main` |

At current NIE HEAD, `packages/` contains only `README.md`; the package source
described by NIE's package docs is absent from that checkout. Its tracked copy
is now `../iecode/packages/nie-plugin` and its binding is
`../iecode/packages/nie`. NIE's `PLAN.md` still assigns these packages
to IECODE. `docs/nie/CONTEXT.md` and `PLUGIN-AUDIT.md` in IECODE cite the prior
NIE revision `34c55fa`; those snapshots are stale for MCP tool names/count and
must not be treated as current API evidence.

## NIE MCP surface

The server is `nie mcp` in `nie-cli` (`crates/tools/nie-mcp/src/main.rs` only
calls `nie_cli::main_entry_with(["nie", "mcp"])`). `nie-cli/src/mcp.rs`
serves MCP JSON-RPC through `rmcp::transport::stdio`; server identity is
`nie-game`, protocol version is `2024-11-05`, and it advertises tools only.
The `nie-mcp` crate directly depends on `nie-cli` and `anyhow`. The handlers
call shared Rust library functions in-process; they do not spawn a CLI child.

The live router contains **67 tools**: 48 `cli_*` command adapters plus 19
compatibility tools. A source test asserts 67 and checks each of the 47
non-`mcp` Clap commands has a `cli_<command>` adapter. Every CLI adapter has
the same input object `{ "args": string[] }` (`args` defaults to `[]`),
where values are the exact Clap tail after the top-level command. Its output
envelope is `{ success, stdout, stderr, error, truncated }`; capture is bounded
to 8 MiB per stdout/stderr. Argument rejection, parse/dispatch errors, worker
failure and panic are represented as `success:false` with `error` populated.
Server instructions say to use `tools/list` as authoritative.

CLI adapter names (the `cli_` prefix is part of each tool name):

```text
cli_oc, cli_computer_use, cli_mod, cli_launcher, cli_viola, cli_format,
cli_decode, cli_refresh_typed_json, cli_steam, cli_info, cli_locales,
cli_convert, cli_render, cli_lua, cli_lua_run, cli_lua_audit, cli_net,
cli_seed, cli_seed_ui, cli_strings, cli_find, cli_grep, cli_img, cli_play,
cli_mode, cli_icons, cli_avatar, cli_ocgen, cli_atlas, cli_coverage,
cli_queue, cli_propagate, cli_rtti, cli_index, cli_disasm, cli_pdata,
cli_rebuild, cli_recover, cli_save, cli_wiki, cli_uniform_map, cli_textures,
cli_menu_predecode, cli_mem, cli_vfs, cli_vn, cli_video, cli_live
```

The 19 direct compatibility tools expose these schemas and behavior:

| Tool | Input fields | Behavior and errors |
| --- | --- | --- |
| `wiki_character_card` | `id` required | Exact card; rejects empty or >256-byte ID; unavailable/read/missing errors are sanitized. |
| `wiki_search` | `query` required, `limit` optional | Limit defaults 20, must be 1–100; nonempty query ≤256 bytes. Read-only wiki search. |
| `zukan_rank` | `entry`, `candidates` JSON values, `maxResults` required | Bounded native matcher; decode/match errors propagated. |
| `aphrody_api_health` | `{}` | GET `${NIE_APHRODY_API_URL:-http://127.0.0.1:8085}/api/v1/health`, 5 s timeout and one retry on transport/server error; non-success and invalid JSON errors. |
| `vfs_list` | `prefix?`, `limit?` | Limit defaults 200, clamped 1–5000. |
| `vfs_search` | `query`, `limit?` | Limit defaults 100, clamped 1–2000; query must be nonempty and ≤16 KiB; substring or glob. |
| `vfs_stat` | `path` | Exact file or directory-prefix metadata. |
| `vfs_cat` | `path`, `maxBytes?` | Bounded VFS bytes; defaults 256 KiB, clamped 1–8 MiB; UTF-8 text or base64. |
| `asset_get` | `path`, `decode?`, `maxBytes?` | Raw/JSON/PNG/WAV in process; `decode:"model"` calls bounded model-serve HTTP. Decode modes and size cap are checked. |
| `re_query` | `sql`, `limit?` | Read-only SQLite; limit defaults 50, clamped 1–1000; returns rows/truncated/columns. |
| `re_function` | `name?`, `vaddr?` | RE function report; invalid address errors returned. |
| `re_coverage` | `{}` | Read-only RE coverage report. |
| `repo_read` | `path`, `maxBytes?` | Confined repository read through `nie-explore::Depot`. |
| `explorer_status` | `{}` | Reports loopback bridge and connected explorer. |
| `explorer_navigate` | `prefix`, `select?` | Rejects NUL path values; forwards a navigate frame. |
| `explorer_open` | `path` | Confined VFS path; rejects absolute, backslash, control and `..` components. |
| `explorer_tab` | `tab` | Accepts `editor`, `explorer`, `search`, `data`, `cpk`, `save`, `mods`, `re`, `lua`, `settings`; otherwise error. |
| `explorer_toast` | `message`, `kind?` | Nonempty/no-NUL message; kind defaults `info`, allowed `info`, `success`, `error`. |
| `game_launch` | `args?: string[]` | Spawns configured `nie.exe`; ≤128 args, each ≤16 KiB and no NUL; returns PID or an error. |

Compatibility handlers return JSON text for success. Their failure helper
serializes `{ "error": "…" }` and returns the tool error result. Most blocking
handlers use `spawn_blocking`; the CLI adapters use a dedicated bounded-stack
thread. Not every legacy surface is read-only: CLI adapters include write,
install, process-memory and live-game operations. The tool descriptions mark
many of those, but migration must preserve their actual subcommand policy and
not infer safety from the MCP wrapper.

There is a second, optional transport for explorer control: MCP startup tries
to bind a loopback WebSocket at `127.0.0.1:${NIE_BRIDGE_PORT:-8791}/bridge`.
Bind failure is nonfatal. It carries explorer `navigate`, `open`, `tab`, and
`toast` messages; it is not an MCP transport. Health/model adapters also make
HTTP calls as described above. `nie-mcp` itself only serves MCP on stdio.

## `@nie/plugin`, dependencies, and data contract

At IECODE HEAD, `@nie/plugin` is a private ESM Bun workspace package at
`packages/nie-plugin` (version `1.0.0`). Its runtime dependencies are
`@aphrody/nie` (`workspace:*`) and `@happy-dom/global-registrator` (`catalog:`);
`@types/bun` and `typescript` are dev dependencies. It has no MCP dependency.
Exports are `<repo>`, `./register`, and `./happydom`. Bun preloads registration for
game-format bundling and happy-dom for tests; this is a library-loader/test
plugin, not an MCP server or MCP tool registry.

`register.ts` registers `nie-game-formats`: `.g4tx` becomes PNG bytes, and
`.cfg.bin`, `.objbin`, `.g4pkm`, `.lip`, `.p3lip`, `.mev`, `.mevbin`, `.g4md`
become decoded JSON via `@aphrody/nie`. Bundler namespace `nie:re/*` reads JSON
from `data/re/<name>.json`; `nie:re/lua/<name>` reads raw bytes from
`data/lua_scripts/<name>`. `index.ts` additionally exports `loadRe`,
`loadLuaScript`, and `RE_PATHS`. `NIE_ROOT` overrides this data root. Package
source contains no data; `data/` is ignored runtime input and is not a transfer
artifact. Registration and imports are lazy with respect to native loading;
the first decode call can throw `NativeLibraryError` with the build hint.
`happydom.ts` restores Bun-native fetch/request globals after registering
happy-dom.

## Compatibility with current IECODE FFI: breaking ABI gap

The migrated `@aphrody/nie` package still implements the old game-specific Bun
binding directly with `bun:ffi`. It opens a library named `iecode` (override
`NIE_FFI_PATH`, otherwise workspace `target/{debug,release}` and host-triple
profiles) and declares legacy `nie_*` symbols including `nie_crc32`,
`nie_crand_*`, `nie_version`, `nie_bytes_free_fields`, `nie_decode_json_out`,
`nie_g4tx_to_png_out`, `nie_vfs_*`, `nie_font_*`, `nie_emu_registry_json_out`,
and optional `nie_wiki_json_out`. `@nie/plugin` relies on at least
`nie_decode_json_out` and `nie_g4tx_to_png_out`; VFS and random exports remain
part of the package's public API.

Current IECODE `crates/ffi` builds `cdylib` **`iecode_ffi`**, schema
`iecode.ffi/v1`, and exports only `iecode_core_version`, `iecode_ffi_schema`,
`iecode_emu_registry_json_out`, `iecode_pipeline_validate_json`,
`iecode_bytes_free_fields`, plus a no-op `iecode_ffi_free`. Its output record is
`IecodeBytes { ptr, len, cap }`; registry/pipeline functions use status codes
and return `IecodeBytes`. `packages/iecode-ffi` loads `iecode_ffi${suffix}` (or
`IECODE_FFI_LIBRARY`) and binds only those IECODE symbols.

Therefore `@aphrody/nie` is **not compatible with the current
`iecode-ffi`** by library-name, symbol-name, surface, or operation contract.
Building current IECODE FFI cannot satisfy the plugin's decode/PNG/VFS/wiki
calls; the plugin's native test and runtime decode path require a compatibility
adapter or an expanded, explicitly versioned IECODE FFI before they can pass.
Do not relabel this as a matching ABI merely because both use Rust, Bun FFI,
JSON, or the `iecode` product name.

## Extraction implications

1. Treat the source server's 67 current names and each input/output/error
   contract above as the baseline; the earlier 19 `nie.*` count in NIE's plan
   does not describe this current `nie-game` router.
2. Keep generic MCP hosting/tool policy in Aphrody AI, with IEVR operations
   behind IECODE-owned library/service adapters. Preserve a compatibility
   namespace/alias phase for existing clients; pin each consumer and rollback
   before removing the source router.
3. Preserve writable-tool boundaries, bounded output, path checks, read-only
   DB flags, VFS decode modes, loopback bridge protocol, and current errors as
   explicit contracts. Names or command parity alone do not establish behavior
   parity.
4. Split the generic Bun registration and happy-dom host mechanism from the
   game-specific file filters, `nie:re` data paths, and native calls. The
   current plugin's `@aphrody/nie` dependency must be redirected to a compatible
   IECODE binding; `packages/iecode-ffi` is not that binding today.

### Evidence paths

- NIE: `crates/tools/nie-mcp/src/main.rs`,
  `crates/tools/nie-mcp/Cargo.toml`, `crates/tools/nie-cli/src/mcp.rs`,
  `crates/tools/nie-cli/src/mcp/bridge.rs`, `crates/tools/nie-cli/src/output.rs`,
  `crates/tools/nie-cli/src/main.rs`, `crates/engine/nie-ffi/src/lib.rs`,
  `crates/engine/nie-ffi/Cargo.toml`, `PLAN.md`.
- IECODE: `packages/nie-plugin/{package.json,src/index.ts,src/register.ts,src/happydom.ts}`,
  `packages/nie/package.json`, `packages/nie/src/index.ts`,
  `packages/iecode-ffi/{package.json,src/index.ts}`, `crates/ffi/src/lib.rs`,
  `crates/ffi/Cargo.toml`, `docs/nie/{CONTEXT.md,PLUGIN-AUDIT.md}`.

No runtime MCP client interrogation or build was run; the report records tracked
source contracts at the listed commits, not a live server's negotiated schemas.
