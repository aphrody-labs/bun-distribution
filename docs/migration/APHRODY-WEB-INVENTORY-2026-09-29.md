<!-- SPDX-License-Identifier: Apache-2.0 -->
# Aphrody Web extraction baseline — 2026-09-29

This is a target-repository inventory, not a claim that the referenced source
checkout is current. The Infra-generated [`source-map.json`](./source-map.json)
records `aphrody-web` at `bbeb5ef4c497f7d27f546ad2cc15a250dcc93c83`, clean,
with 1,653 paths. Reading only manifest paths listed by that map found 22
product Rust crates, four other Cargo manifests (workspace root, Drive server,
embedded scanner tool, and vendored Taffy), and six Bun manifests (workspace
root, one app, and four packages). Recheck source heads, worktree, hashes,
notices, and consumers through Infra before importing.

## Current manifest inventory from Infra source map

Product Rust crates and source paths:

| Cargo package | Source path |
| --- | --- |
| `aphrody-browser` | `crates/aphrody-browser` |
| `aphrody-site` | `crates/aphrody-site` |
| `aphrody-web` | `crates/aphrody-web` |
| `aphrody-web-bridge` | `crates/aphrody-web-bridge` |
| `aphrody-web-chromium` | `crates/aphrody-web-chromium` |
| `aphrody-web-engine` | `crates/aphrody-web-engine` |
| `aphrody-web-extract` | `crates/aphrody-web-extract` |
| `aphrody-web-ffi` | `crates/aphrody-web-ffi` |
| `aphrody-web-index` | `crates/aphrody-web-index` |
| `aphrody-web-render` | `crates/aphrody-web-render` |
| `aphrody-web-service` | `crates/aphrody-web-service` |
| `aphrody-x` | `crates/aphrody-x` |
| `aphrody-x-algorithm` | `crates/aphrody-x-algorithm` |
| `obscura` | `crates/aphrody-obscura/crates/obscura` |
| `obscura-browser` | `crates/aphrody-obscura/crates/obscura-browser` |
| `obscura-cdp` | `crates/aphrody-obscura/crates/obscura-cdp` |
| `obscura-cli` | `crates/aphrody-obscura/crates/obscura-cli` |
| `obscura-dom` | `crates/aphrody-obscura/crates/obscura-dom` |
| `obscura-js` | `crates/aphrody-obscura/crates/obscura-js` |
| `obscura-mcp` | `crates/aphrody-obscura/crates/obscura-mcp` |
| `obscura-net` | `crates/aphrody-obscura/crates/obscura-net` |
| `obscura-render` | `crates/aphrody-obscura/crates/obscura-render` |

Bun application and package manifests:

| Kind | Package | Source path |
| --- | --- | --- |
| Application | `@aphrody/bxc` | `apps/bxc` |
| Package | `@aphrody/agent-browser` | `packages/agent-browser` |
| Package | `@aphrody/bxc-test` | `packages/bxc-test` |
| Package | `@aphrody/m3-tokens` | `packages/m3-tokens` |
| Package | `@aphrody/x` | `packages/x` |
| Workspace root | `aphrody-web` (private) | `.` |

The other Cargo manifests are `apps/bxc/.agents/skills/rust-native-scanner`
(`rust-native-scanner`), `drive-server` (`sd-server`), and vendored
`crates/aphrody-obscura/vendor/taffy` (`taffy`). They are not product crates.
Manifest presence alone does not prove workspace membership, an active target,
or justify merging crate boundaries. Reconfirm license and dependency closure
before importing.

## What is already in this target

- `packages/web/x` contains `@aphrody/x`, a Bun/TypeScript client and its
  configuration, services, storage, and tests.
- `crates/web/aphrody-web-extract` now contains the source Rust implementation
  of main-content extraction, Markdown, structural chunks and SimHash. The
  earlier URL/metadata API remains as a wrapper on its shared DOM parser. The
  imported source and adapted files are recorded in
  [`aphrody-web-extract-import.json`](./aphrody-web-extract-import.json).
- `crates/web/obscura-dom` supplies the imported HTML parser backend with the
  source Obscura license. Its target manifest uses version `0.1.1` to coexist
  with the source checkout's `0.1.0` until its remaining consumers move.
- `crates/web/aphrody-web-index` now contains the source HNSW vector index,
  including its FFI handle API, persistence and recall tests. The source
  mapping is in [`aphrody-web-index-import.json`](./aphrody-web-index-import.json).
- The root Cargo manifest now resolves `aphrody-web-bridge` locally. Its
  source import and adaptations are recorded in
  [`aphrody-web-bridge-import.json`](./aphrody-web-bridge-import.json).
  `obscura-mcp` still resolves through the source checkout.
- The in-progress `aphrody-tools` worktree calls the local Rust extractor
  directly for opt-in `web_fetch` Markdown. Its AI crate import is uncommitted;
  clean-clone consumer cutover remains open. AI MCP, messaging, and
  application-server code still consume or route BXC tools.
- The generated ecosystem catalog previously described 22 Rust crates and six
  Bun manifests. The tables above are from the refreshed Infra map; refresh the
  catalog through its owner before changing generated catalog contents.

## Browser and runtime ownership map

| Surface | Existing owner / role | Consolidation boundary |
| --- | --- | --- |
| Obscura | `obscura-{dom,net,browser,cdp,js,render,mcp,cli}` plus `aphrody-browser`; DOM, network, V8 execution, CDP, optional layout/paint and MCP | Keep as an internal backend of canonical `aphrody-web`; qualify V8/thread/feature and upstream-license boundaries before merging crates. |
| Web engine and service | `aphrody-web-engine`, `aphrody-web-service`, `aphrody-web` | Canonical Rust web/browser API and thin CLI/service entry points. |
| Extraction and indexing | `aphrody-web-extract`, `aphrody-web-index` | The portable source crates are imported locally. Retire source FFI consumers after their schemas, gold corpus, index persistence and ranking gates pass. |
| FFI | `aphrody-web-ffi`, `aphrody-web-bridge` | One ABI/loader owner; keep compatibility symbols and existing callers until mapped and qualified. The local bridge now uses Rust directly for Markdown, still loads native DOM/title/DNS functions and drives BXC for browser work. |
| Chromium/CDP | `aphrody-web-chromium`, browser/CDP adapters and BXC profiles | Preserve explicit Chromium escalation and profile/cookie isolation; JSC or Obscura does not imply Chromium parity. |
| Lightpanda | Optional external headless engine configured for `agent-browser` and BXC profiles | Keep an adapter/backend only where workload parity justifies it; do not fold an unmodified Zig upstream into Rust. |
| Agent automation | `@aphrody/agent-browser` in the generated source catalog; installed host CLI is agent-browser 0.38.1 | Treat the installed CLI and the source package as separate artifacts; keep one supported agent-facing setup and document engine selection. |
| BXC | Bun implementation and SDK, MCP/CLI consumers | Behavior migrates into canonical Rust owners before removing the compatibility facade. |

## Verified extraction consumers and remaining cutover

| Consumer | Source call or contract | Target status |
| --- | --- | --- |
| `aphrody-web-ffi` | `bxc_extract_main`, `bxc_html_to_markdown_with_base`, `bxc_simhash64` and `aphrody_web_*` aliases call source `aphrody-web-extract` | Extraction adapters are copied into the single target `aphrody-ffi` and call the target extractor. The source checkout still serves the old Bun loader until the rest of its ABI is migrated. Historical aliases are temporary. |
| `aphrody-web-service` and `aphrody-web-engine` | Re-export/call `extract_main` and `html_to_markdown` | Still source checkout dependencies; move after HTTP/service fixture gates. |
| BXC Bun `src/rust/bridge.ts` | Loads `aphrody_web_extract_main`, `aphrody_web_html_to_markdown`, `aphrody_web_simhash64` | Keep export map and output JSON stable while switching the native library owner. |
| `aphrody-web-bridge` | Historically loaded `bxc_html_to_markdown` for direct fetch | Imported locally; direct fetch and its public Markdown method use `aphrody-web-extract`. The compatibility loader now prefers `APHRODY_FFI_LIB` and canonical title/DOM symbols, falling back to the older library during cutover. DNS and browser subprocess paths remain open. |
| `aphrody-web-ffi` index exports | Calls `aphrody_web_index::ffi_api` in the source checkout | Target HNSW library and its C ABI adapters are imported into the single `aphrody-ffi`; the old Bun caller still loads the source library. |
| `aphrody-memory` | `HnswBackend` stores JSONL records and ranks by exact cosine scan | Different persistence and ranking semantics; decide an explicit migration before sharing the BXC HNSW implementation. |
| Target `aphrody-tools` `web_fetch` | Opt-in HTML-to-Markdown with `rendering.kind` and `rendering.via` | Current AI worktree calls target `aphrody-web-extract` directly; `via` keeps the legacy value and `backend` identifies the Rust owner. Clean-clone import pending. |
| Target AI MCP/client | Discovers and routes `bxc_*` tools through the BXC process | Discovery, schemas, auth and browser lifecycle not yet cut over. |

The imported portable extractor passed 27 unit, seven extraction and 20
Markdown tests offline. The bridge passed its scoped offline tests in a clean
archive and a local HTTP regression proved direct Markdown conversion without
loading the native library. The index passed its API and recall tests in the
current worktree. The BXC gold corpus and its 259 fixtures, browser profiles,
native exports, and clean-clone AI/Bun consumer gates remain open. These
results demonstrate portable extraction, indexing and direct fetch only.

The initial unified ABI adapters are recorded in
[`aphrody-web-unified-ffi-import.json`](aphrody-web-unified-ffi-import.json).
The single `aphrody-ffi` build exports extraction, text, DOM and index symbols;
its 24 Rust unit tests and Bun native extraction and HNSW persistence smokes
passed through the single `bun/index.ts` loader. The Rust Web
bridge loaded that exact `libaphrody_ffi.so` through `APHRODY_FFI_LIB` and
passed its title, Markdown and DOM tests. The Web v4 ABI, browser/network
tools, final Bun loader and sole MCP endpoint are not yet cut over.

The target `aphrody-mcp` now registers `aphrody_web_extract_html` directly from
the shared extractor. Its no-default-features check passes after importing the
versioned Contracts schema needed by that binary; its scoped suite passes 58
unit and three integration tests. The dynamic Web tool catalog
still uses a child process for capabilities not yet migrated, so this is one
native tool migration rather than closure of the MCP work.
The default-feature MCP check remains blocked by 22 Taffy API errors in the
external `obscura-render` source checkout; the no-default-features target and
tests above do not prove native browser parity.

The target plan already sets P5 acceptance in
[`workspace/PLAN.md`](../plans/workspace/PLAN.md): web/JS/crawl parity, browser
backend qualification, unified FFI, and no old facade except declared shims.
The product inventory is also described in [`Web README`](../products/web/README.md),
[`runtime boundaries`](../reference/web/WEB-RUNTIME.md), and
[`browser ecosystem`](../reference/web/web/WEB-BROWSER-ECOSYSTEM.md).

## Host setup verified in this pass

- `obscura` and `lightpanda` resolve from `~/.local/bin`; Obscura reports
  version 0.2.3, and Lightpanda reports
  `1.0.0-nightly.9909+f086b75d5` (`lightpanda version`). `agent-browser`
  reports version 0.38.1.
- `agent-browser install --with-deps` completed. Required Linux libraries were
  already installed, and Chrome 154.0.8037.57 is present.
- Web variables are already defined in both `~/.config/shell/env.sh` and
  `~/.config/nushell/env.nu`: `APHRODY_HOME`, `APHRODY_ROOT`,
  `BXC_COOKIES_DIR`, `APHRODY_OBSCURA_BIN`, `BXC_LIGHTPANDA_BIN`,
  `BXC_LIGHTPANDA_PATH`, and `AGENT_BROWSER_ENGINE`. Nushell loaded all seven
  when its config files were explicitly selected. No secret values are recorded.
- `aphrody web install --help` currently fails with “unrecognized subcommand
  `install`” in the installed Aphrody CLI. The source guide documents this
  command, so the full Aphrody Web vendor/Rust-bridge installation remains an
  integration gap. Do not silently substitute a build from another checkout.
- `lightpanda --version` is not a supported version form; its CLI exposes
  subcommands. Use `lightpanda version` to inspect the installed build before
  depending on version-specific behavior.

## Migration order

1. Refresh the Infra source map and recursively qualify manifests, dirty state,
   Gitlinks, source hashes, licenses, package exports, C ABI symbols, CLI/MCP
   schemas, and every Rust/Bun caller.
2. Resolve root workspace dependencies and source path escapes. Extract a
   dependency-closed Rust slice under `crates/web/` with provenance; keep source
   and target side-by-side.
3. Establish fixtures for extraction, browser/CDP lifecycle, cookies/profile
   isolation, errors, crawl behavior and ABI before deduplicating implementations.
4. Move consumers to the canonical Rust facade and Bun package, then qualify
   clean clones, release artifacts and rollback before retiring compatibility
   paths.

The Google cookie values pasted into the conversation are credentials. They
must remain outside this repository, notes, shell startup files and command
logs; rotate/revoke them and use the private cookie store only after rotation.
