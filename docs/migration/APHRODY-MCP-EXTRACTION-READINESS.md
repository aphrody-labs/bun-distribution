# Aphrody MCP extraction readiness

Audit date: 2026-09-29. Read-only review of source and target manifests, plans,
and MCP adapters. No code was moved or built.

## Decision

**The full `aphrody-mcp` crate is not ready to drop into this target workspace.**
The target is a scaffold with no MCP crate, binary, `rmcp` dependency, or AI
runtime dependency closure. The source crate is a binary-only, heavily coupled
server, not an isolated transport library. The existing NIE bridge is the
smallest useful seam: compile it first as a library with no server handler or
binary, then add it to the existing `aphrody-mcp` endpoint when that server is
imported. Do not register or publish a second endpoint.

The current AI implementation already has the right transitional shape: one
`aphrody-mcp` process exposes `nie.tools`, `nie.call`, and typed `nie.*`
compatibility calls, then forwards requests to one persistent `nie-mcp` child
over stdio. That child is hidden behind the configured Aphrody endpoint; it is
not separately configured by a client. It must remain a process boundary
until IECODE provides the game services and the FFI/data/licence gaps are
resolved.

## Revisions and workspace graph

| Checkout                            | Revision                                   | Observed state                      |
| ----------------------------------- | ------------------------------------------ | ----------------------------------- |
| Source `/home/aphro/src/aphrody-ai` | `3aa88791f49b963a00f073cb206677ea9d1957e1` | clean `main...origin/main`          |
| NIE `/home/aphro/src/nie`           | `fd624e060a4180c988336bcc3f829bb1835cbf24` | clean `main...origin/main`          |
| IECODE `/home/aphro/iecode`         | `8fdab4b96014f70972c2855878cab49510ffe876` | clean `main...origin/main`          |
| Target `/home/aphro/aphrody`        | no commit yet                              | scaffold/import files are untracked |

The target root `Cargo.toml` currently includes `crates/iecode/ievr-data`,
`crates/infra/*`, and `crates/contracts/aphrody-kernel-client`. It has no
`crates/ai/aphrody-mcp`, and `Cargo.lock` has no `aphrody-mcp` or `rmcp`
package. The target dependency catalogue has basic `tokio`, `serde`,
`serde_json`, etc., but no `rmcp` entry.

Source `aphrody-mcp/Cargo.toml` defines only `[[bin]] name = "aphrody-mcp"`
(no `[lib]`). It is a member of the 60-plus crate AI workspace and directly
depends on many AI siblings: `aphrody-config`, `aphrody-kernel`, `aphrody-a2a`,
`aphrody-a2a-server`, `aphrody-git`, `aphrody-http-error`, `aphrody-backend`,
`aphrody-gemini-runtime`, `aphrody-google`, `aphrody-firefly`,
`aphrody-capture`, `aphrody-web-bridge`, three `aphrody-n2b-*` crates,
`aphrody-voice`, `aphrody-re`, `aphrody-gemini-web`, `aphrody-session`,
`aphrody-memory`, and `aphrody-manga`, plus feature-gated RAG, OCR, jobs,
vision, WinClean, and Obscura crates. Those AI members are not in the target
workspace. `--no-default-features --features nie` can disable default tool
families, but it cannot remove the unconditional dependencies or turn this
binary-only `main.rs` into an independently compilable NIE module.

Both source workspaces currently pin/use `rmcp` 3.4.1 (AI pins exactly
`=3.4.1`; NIE requests `3.4.1`). The target must add that reviewed version to
its dependency catalogue and lock when it takes ownership. The existing target
Cargo lock alone cannot resolve or verify this crate today.

## What the existing NIE integration actually exposes

The NIE source inventory at the revision above records 67 child tools: 48
`cli_*` adapters and 19 native compatibility tools. Their schemas, bounds,
error paths, side effects, and transports are inventoried in
[`NIE-MCP-API-INVENTORY.md`](NIE-MCP-API-INVENTORY.md).

The AI server's `nie` feature currently registers **21 public Aphrody tool
names**: `nie.tools`, `nie.call`, and 19 typed compatibility wrappers. It does
not publish all 67 child tools as individually named tools in Aphrody's
`tools/list`. Instead:

- `nie.tools` calls the child's live `tools/list`; `filter` narrows names and
  `schemas=true` returns the child input schemas.
- `nie.call` validates a plain tool name and forwards its arbitrary JSON
  arguments unchanged, so it can reach all child tools, including every
  `cli_*` command.
- The typed wrappers give common VFS, RE, wiki, and explorer calls stable
  `nie.*` names and compile-time request schemas.

This is a working discovery/dispatch adapter, not 67-tool schema parity at the
Aphrody endpoint. A client that only reads Aphrody's initial `tools/list` sees
the 21 wrappers, not the full child catalog. Preserve the dynamic catalog and
call path through transition; if the acceptance requirement is that all 67
names/schemas appear directly in Aphrody `tools/list`, a separate dynamic
tool-registration mechanism is still required. Do not claim that parity from
the current wrapper count.

`nie.call` is marked destructive in its MCP annotations, which is appropriate
for its broad access to write/install, memory mutation, and launch commands.
The typed read-only wrappers carry narrower annotations. Preserve those
policy boundaries rather than deriving a blanket allow-list from tool names.

The bridge keeps one child in a process-global mutex, initializes MCP once,
uses newline-delimited JSON-RPC stdio, and respawns after a failed request.
`NIE_MCP_BIN` defaults to `nie-mcp` on `PATH`; an empty value disables the
family. `NIE_MCP_TIMEOUT_SECS` defaults to 120 seconds; the bridge accepts
lines up to 64 MiB. The child receives the remaining environment unchanged,
including `NIE_REPO` and game/service paths. The adapter asks for protocol
`2025-06-18` but discards the initialize response; NIE's current handler
advertises `2024-11-05`. Confirm the negotiated version and lifecycle in the
conformance test instead of assuming the constants agree.

The separate NIE child also starts the optional explorer WebSocket bridge on
loopback port 8791 by default. That bridge is part of explorer lifecycle, not
a second externally configured MCP endpoint. Removing the child before
replacing this lifecycle would break explorer control.

## Data and rights boundary

`aphrody-mcp` source and workspace declare Apache-2.0. NIE's Cargo workspace
sets `license-file = "LICENSE"`; the agreement is commercial, and `nie-mcp`
inherits that license metadata. A process adapter can remain Apache-licensed
because it contains no NIE engine implementation, but bundling or redistributing
the `nie-mcp` executable, game assets, database, or copied NIE source needs its
own documented rights decision. Keep ignored `data/`, local game installs,
SQLite RE/wiki databases, saves, and model-serving artifacts out of this import.
IECODE's current `iecode-ffi` also does not replace the game-specific `nie_*`
ABI; see the ABI findings in the NIE inventory and IECODE's FFI integration
record.

## First compilable tranche, with one endpoint

1. In the target root, add `crates/ai/aphrody-mcp-nie-bridge` as a
   **library-only** member. Copy the current `nie_tools.rs` bridge and its
   request types into that package under the distinct package name
   `aphrody-mcp-nie-bridge`; do not add `[[bin]]`, `#[tool_handler]`, a second
   server, or a client-facing MCP registration. Keep the existing source
   `aphrody-mcp` executable as the configured endpoint during this tranche.
2. Give the library only its required dependency slice: reviewed `rmcp` 3.4.1
   model/schema support, `tokio` process/IO/sync/time features, `serde` derive,
   and `serde_json`. Inherit target workspace metadata/lints. No NIE Cargo
   crate, native FFI library, game data, RAG, browser, OCR, or model crate is
   needed to compile the stdio adapter.
3. After target library checks pass, point the existing source endpoint at this
   distinct path package and remove the duplicate module only after the source
   caller passes its checks. Keep its one public binary name and existing MCP
   configuration; do not install or activate a second `aphrody-mcp` executable
   concurrently.
4. Add protocol-fixture tests using a fake stdio child: handshake and negotiated
   version, `tools/list` reporting 67 names, schema passthrough with and without
   `schemas=true`, representative exact `tools/call` forwarding, error results,
   64 MiB line handling, timeout, child restart, and explorer bridge survival.
   These tests need no game data. Real operation parity still needs the licensed
   local fixtures/runtime and must separately cover all 67 names, input schemas,
   error forms, side effects, and bounded responses.
5. Only after source consumers pass and the root dependency closure is mapped,
   import the full `aphrody-mcp` binary and its AI-owned libraries. Then route
   it through the one existing endpoint; replace the child bridge only when
   IECODE exposes equivalent game operations and the explorer lifecycle.

This tranche yields a real target Cargo build for the transport boundary while
leaving a single registered endpoint and avoiding an unlicensed or unavailable
game-data dependency. It does **not** claim full `aphrody-mcp` extraction or
67-name `tools/list` parity.

## Evidence inspected

- Source manifests/code: `aphrody-ai/Cargo.toml`,
  `crates/aphrody-mcp/Cargo.toml`, `src/main.rs`, `src/nie_tools.rs`,
  `docs/PLAN.md`, `LICENSE` at AI HEAD above.
- NIE source: `Cargo.toml`, `LICENSE`, `crates/tools/nie-mcp/Cargo.toml`,
  `crates/tools/nie-cli/src/mcp.rs`, `crates/tools/nie-cli/src/mcp/bridge.rs`.
- IECODE: `Cargo.toml`, `crates/ffi/src/lib.rs`, `packages/iecode-ffi/src/index.ts`.
- Target: root `Cargo.toml`, `Cargo.lock`, `PLAN.md`, and
  [`NIE-MCP-API-INVENTORY.md`](NIE-MCP-API-INVENTORY.md).

No Cargo build, tests, live tool call, or dataset access was performed.

## Later IECODE wrapper follow-up

After this read-only audit, the IECODE source checkout was modified locally in
`packages/iecode-ffi/src/index.ts` and `packages/iecode-ffi/tests/contract.test.ts`
to correct the Bun FFI declarations, pointer conversion and add ABI contract
checks. Those two files are now copied into the target at
`packages/iecode/iecode-ffi/`; the source checkout is therefore no longer clean.
The source FFI cdylib built with locked offline Cargo dependencies. A Linux x64
native smoke test returned version `1.0.0`, schema `iecode.ffi/v1`, eight
registry entries, a valid pipeline result, and the expected invalid-JSON error.
This validates this source library/wrapper pair, but the target still has not
imported the Rust FFI provider crate; it does not close the broader target
workspace or MCP parity gates.
