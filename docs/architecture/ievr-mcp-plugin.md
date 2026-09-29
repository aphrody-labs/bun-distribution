<!-- SPDX-License-Identifier: Apache-2.0 -->

# IEVR, MCP and Bun plugin integration

Observed 2026-09-29 from current local checkouts. This page records boundaries
and migration steps; a source copy or successful crate check is not parity.

## Current ownership and call paths

| Surface                    | Current owner and evidence                                                                                                                                                                                                                              | Target boundary                                                                                                  |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| IEVR schemas and pure data | IECODE `crates/ievr-data`, package `iecode-ievr-data`, library name `nie_data`; copied as the first slice to `crates/iecode/ievr-data`.                                                                                                                 | Aphrody Rust crate with IECODE source/API identity retained.                                                     |
| Native format, VFS and FFI | IECODE `crates/ffi` is package `iecode-ffi`, whose Cargo target is `iecode_ffi`; its current schema is `iecode.ffi/v1` with `iecode_*` exports. The staged `@aphrody/iecode-ffi` wrapper maps those exact names.                                        | Move and build the Rust provider in the Cargo workspace, then validate the Bun calls against the built artifact. |
| NIE MCP implementation     | `nie-mcp` is a thin binary that calls `nie_cli::main_entry_with(["nie", "mcp"])`; MCP handlers live in `nie-cli/src/mcp.rs`.                                                                                                                            | One unified `aphrody-mcp` server with the same IEVR tool schemas, behavior and error model.                      |
| AI MCP integration         | `aphrody-ai/crates/aphrody-mcp/src/nie_tools.rs` launches a long-lived `NIE_MCP_BIN` child (default `nie-mcp`) over JSON-RPC stdio. `main.rs` registers generic catalog/call tools and typed helpers.                                                   | In-process calls after native/service APIs and persistent explorer behavior are integrated and qualified.        |
| MCP endpoint               | Current `nie/.mcp.json` configures only `aphrody-mcp` over stdio.                                                                                                                                                                                       | Keep one endpoint; do not introduce a second public server.                                                      |
| Bun plugin                 | IECODE package `@nie/plugin`: Bun format loaders and `nie:re/*` reader, plus happy-dom registration. It depends on `@aphrody/nie`. The generic preload implementation is staged as `@aphrody/bun-test-dom`; the old plugin is copied but not activated. | Keep the `@nie/plugin` facade private until its game-format ABI and data contract match the Rust provider.       |

The extracted crate record is [`../migration/ievr-iecode-extraction.json`](../migration/ievr-iecode-extraction.json).
The source map records package, crate and MCP paths at its scan revision.
Focused audits on 2026-09-29 observed clean IECODE HEAD
`8fdab4b96014f70972c2855878cab49510ffe876` and clean NIE HEAD
`fd624e060a4180c988336bcc3f829bb1835cbf24`. Package-level hashes and the
current MCP contract are in the migration records.

The FFI audit found a real ABI split in the current source. Rust
`crates/ffi` exports `iecode_core_version`, `iecode_ffi_schema`,
`iecode_emu_registry_json_out`, `iecode_pipeline_validate_json`, and
`iecode_bytes_free_fields`; Cargo reports the native library target as
`iecode_ffi`. The IECODE `packages/nie/src/index.ts` still requests `nie_*`
symbols and searches for `libiecode`, so it cannot load that provider. The
staged `packages/iecode/iecode-ffi/src/index.ts` uses the current `iecode_*` symbol
names and platform library filename, but the Rust provider has not yet been
copied into this workspace. The package remains staging code until that
provider is integrated and exercised end to end.

The Bun extraction and source hashes are recorded in
[`../migration/iecode-bun-extraction.json`](../migration/iecode-bun-extraction.json).
No root `bunfig.toml` preloads the game plugin, and no MCP transport was
replaced in this slice.

## Migration order and acceptance

1. Import the remaining IEVR format, VFS/save, rules/Lua/runtime, forge and FFI
   crates with their workspace dependencies, notices, source heads and licenses.
   Preserve old paths until consumers use the new workspace.
2. Generate bindings from the final IEVR FFI contract. Keep the `@aphrody/nie`
   exports and `@nie/plugin` subpaths compatible while switching their native
   library resolution from a neighboring checkout to the Aphrody artifact.
3. Split Bun plugin registration from IEVR-specific suffixes and data paths.
   Keep `happy-dom` setup generic. Game data and generated binaries stay outside
   the repository.
4. Connect IEVR MCP handlers to the in-process API while retaining the single
   `aphrody-mcp` endpoint. Compare tool names, descriptions, input schemas,
   success/error payloads, timeouts, large binary results and explorer session
   lifetime against the running source service before removing the child bridge.
5. Resolve the conflict between the `@aphrody/nie` manifest's `MIT` value and
   the IEVR migration documentation's commercial-license boundary before any
   package publication or public source transfer. Keep the package private
   until provenance and redistribution rights are established.

Do not claim integrated MCP/plugin parity until those checks run against a
clean Aphrody checkout and authorized IEVR data source.
