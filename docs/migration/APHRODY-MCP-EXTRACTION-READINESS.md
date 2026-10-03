# Aphrody MCP extraction readiness

Updated 2026-09-30 after default, toolbox, and Shenron MCP qualification. The
earlier read-only assessment is retained below as historical evidence; current
target status is recorded first.

## Decision

**The Aphrody MCP crate is integrated; protocol qualification is still partial.**
The target includes the `aphrody-mcp` executable, its imported AI dependency
closure, and the `rmcp` 3.4.1 dependency. `cargo check --offline -p aphrody-mcp`
passes with its default `dragonball` feature. NIE is not yet in the root
monorepo, so the optional `nie` feature is disabled by default and excluded
from the `toolbox` feature. NIE's stdio transport lives in the library-only
`aphrody-mcp-nie-bridge` package and can be enabled explicitly for integration
qualification; its Unix fixtures use mock children.

The `toolbox` feature is separately build-, test- and Clippy-qualified. It
includes `rag-ort`, which forwards the existing `aphrody-rag/ort` backend, and
still excludes NIE. The default server remains free of that ONNX RAG backend.

The current client config still names exactly one `aphrody-mcp` endpoint. Its
default tool catalog does not publish any `nie.*` tools. When the optional
feature is enabled for qualification, that endpoint publishes `nie.tools`,
`nie.call`, and typed compatibility wrappers, while the 67-name child catalog
remains dynamically discoverable through `nie.tools`.
The bridge conformance fixture now exercises all 67 names, generic `cli_*`
schemas, descriptor passthrough/filtering, a JSON-RPC error, bounded line
handling, timeout/reset, reconnect, and reuse of the same child across calls.
The test checks the size-limit algorithm with a small fixture limit; production
still accepts a maximum 64 MiB frame.

The 67-entry fixture derives `inputSchema` through the same `rmcp`
`schema_for_input` helper used by the pinned source SDK and mirrored NIE request
types. Read-only inspection of source commit `94d88bc3993e7dabddf44ce9804d5b41ee5d4c4c`
found that `wiki_character_card`, `wiki_search`, and `zukan_rank` use
`deny_unknown_fields`; the bridge DTOs and generated fixture schemas now retain
that constraint. The default client configuration now passes an integration
smoke check: the exact one-endpoint source config starts `aphrody-mcp`, completes
`initialize`/`tools/list`, exposes Shenron's `dragonball.*` surface, and contains
no `nie.*` tools. Both the default live-client assertion and the expanded
`toolbox` check verify all 37 exact Shenron names and object schemas; the
router test checks the same names and annotations. Runtime source-schema and
child error parity and explorer WebSocket survival are still open.

The stdio server supports both the legacy `initialize` lifecycle and the
2026-07-28 stateless lifecycle. It routes `server/discover` and modern requests
carrying protocol metadata through `rmcp::service::serve_directly`, while
preserving the existing initialize flow for older clients. Live subprocess
coverage now verifies discovery, negotiated support, server identity and the
full 37-name Shenron catalog without an initialize request; the request router
has a matching unit test.

When explicitly enabled, the AI implementation keeps a single process
boundary: `aphrody-mcp` exposes `nie.tools`, `nie.call`, and typed `nie.*`
compatibility calls, then forwards requests to one persistent `nie-mcp` child
over stdio. It remains opt-in until the NIE source crate is a monorepo member
and the FFI/data/licence and consumer-parity gates are resolved.

## Revisions and workspace graph

| Checkout                            | Revision                                   | Observed state                      |
| ----------------------------------- | ------------------------------------------ | ----------------------------------- |
| Source `~/src/aphrody-ai` | `3aa88791f49b963a00f073cb206677ea9d1957e1` | clean `main...origin/main`          |
| NIE submodule Gitlink                | `94d88bc3993e7dabddf44ce9804d5b41ee5d4c4c` | working tree absent; commit available locally |
| IECODE `../iecode`         | `8fdab4b96014f70972c2855878cab49510ffe876` | clean `main...origin/main`          |
| Target `<repo>`        | local extraction worktree                  | broad migration batch remains dirty |

On 2026-09-29 the referenced NIE checkout `~/src/nie` was absent, but
the superproject's exact gitlink commit remained in its local submodule object
database and was inspected read-only through a temporary detached checkout at
`~/tmp/nie-mcp-audit`. This verified the current 67-name router and
direct request DTO attributes. The clean audit checkout and isolated bridge
harness remain under `~/tmp`. The real source MCP
test could not be run: Cargo workspace loading fails before compilation because
the NIE manifest points at source directories such as
`../iecode/crates/re`, which are absent in the current IECODE checkout.
The mock fixture is therefore schema parity evidence from the matching DTOs and
SDK schema generator, not a live child-runtime test.

The current target root includes the AI MCP workspace package and the NIE
bridge library. The lock resolves both `aphrody-mcp` and `rmcp` 3.4.1. The
source MCP crate remains binary-only; the transport seam is the separate
library, not an added server handler or second executable.

Historical audit snapshot: source `aphrody-mcp/Cargo.toml` defines only
`[[bin]] name = "aphrody-mcp"`
(no `[lib]`). It is a member of the 60-plus crate AI workspace and directly
depends on many AI siblings: `aphrody-config`, `aphrody-kernel`, `aphrody-a2a`,
`aphrody-a2a-server`, `aphrody-git`, `aphrody-http-error`, `aphrody-backend`,
`aphrody-gemini-runtime`, `aphrody-google`, `aphrody-firefly`,
`aphrody-capture`, `aphrody-web-bridge`, three `aphrody-n2b-*` crates,
`aphrody-voice`, `aphrody-re`, `aphrody-gemini-web`, `aphrody-session`,
`aphrody-memory`, and `aphrody-manga`, plus feature-gated RAG, OCR, jobs,
vision, WinClean, and Obscura crates. Those AI members were outside the target
workspace at audit time; their mapped closure is now imported. The `nie`
feature is optional and disabled by default (also excluded from `toolbox`). An
explicit `--features nie` build can exercise the bridge, but it cannot remove
the unconditional dependencies or turn this binary-only `main.rs` into an
independently compilable NIE module.

The integrated source and target use `rmcp` 3.4.1. The root lockfile now
resolves it offline as part of the imported MCP crate and bridge.

## What the existing NIE integration actually exposes

The NIE source inventory at the revision above records 67 child tools: 48
`cli_*` adapters and 19 native compatibility tools. Their schemas, bounds,
error paths, side effects, and transports are inventoried in
[`NIE-MCP-API-INVENTORY.md`](NIE-MCP-API-INVENTORY.md).

The AI server's opt-in `nie` feature registers **21 public Aphrody tool names**:
`nie.tools`, `nie.call`, and 19 typed compatibility wrappers. It does
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

## Completed transport tranche and remaining qualification

1. **Done.** Add `crates/ai/aphrody-mcp-nie-bridge` as a
   **library-only** member. Copy the current `nie_tools.rs` bridge and its
   request types into that package under the distinct package name
   `aphrody-mcp-nie-bridge`; do not add `[[bin]]`, `#[tool_handler]`, a second
   server, or a client-facing MCP registration. Keep the existing source
   `aphrody-mcp` executable as the configured endpoint during this tranche.
2. **Done.** Give the library only its required dependency slice: reviewed `rmcp` 3.4.1
   model/schema support, `tokio` process/IO/sync/time features, `serde` derive,
   and `serde_json`. Inherit target workspace metadata/lints. No NIE Cargo
   crate, native FFI library, game data, RAG, browser, OCR, or model crate is
   needed to compile the stdio adapter.
3. **Done.** After target library checks pass, point the existing source endpoint at this
   distinct path package and remove the duplicate module only after the source
   caller passes its checks. Keep its one public binary name and existing MCP
   configuration; do not install or activate a second `aphrody-mcp` executable
   concurrently.
4. **Partial; mock transport and source DTO schema tranche qualified.** Fake
   stdio children verify the negotiated legacy protocol, complete 67-name
   catalog, generated schemas from mirrored source DTOs, filtering,
   `tools/call`, JSON-RPC errors, bounded-frame rejection, timeout, reconnect
   after error/timeout, and persistent-child reuse. Source inspection confirmed
   exact required fields, camel-case keys and strict unknown-field handling for
   the direct NIE schemas. Shenron router checks assert all direct tools register
   and preserve the five admin tools' read-only/destructive annotations.
   The single-endpoint default client smoke check also passes with Shenron
   available and NIE absent. Remaining work: run the real child against its
   current source build, compare child error/side-effect behavior, and exercise
   the real explorer WebSocket lifecycle. None of these checks reads game data
   or invokes external admin APIs.
5. **Partial.** The current source endpoint configuration is parsed and the
   built server's default initialize/tools-list flow is exercised. Consumer
   behavior when the optional NIE bridge is enabled remains open. Keep the child
   bridge until IECODE exposes equivalent game operations and the explorer
   lifecycle under resolved data and license terms.

The target builds the full imported `aphrody-mcp` package and isolated transport
boundary while keeping one configured endpoint. The bridge fixture verifies
passthrough against a source-inspected 67-name mock catalog; it does **not**
qualify the real child's complete protocol/lifecycle.

## Evidence inspected

- Source manifests/code: `aphrody-ai/Cargo.toml`,
  `crates/aphrody-mcp/Cargo.toml`, `src/main.rs`, `src/nie_tools.rs`,
  `docs/PLAN.md`, `LICENSE` at AI HEAD above.
- NIE source: `Cargo.toml`, `LICENSE`, `crates/tools/nie-mcp/Cargo.toml`,
  `crates/tools/nie-cli/src/mcp.rs`, `crates/tools/nie-cli/src/mcp/bridge.rs`.
- IECODE: `Cargo.toml`, `crates/ffi/src/lib.rs`, `packages/iecode-ffi/src/index.ts`.
- Target: root `Cargo.toml`, `Cargo.lock`, `PLAN.md`, and
  [`NIE-MCP-API-INVENTORY.md`](NIE-MCP-API-INVENTORY.md).

The original audit performed no Cargo build or tests. Current evidence is the
target command output recorded in `PLAN.md`; no live child tool call or dataset
access was performed.

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
