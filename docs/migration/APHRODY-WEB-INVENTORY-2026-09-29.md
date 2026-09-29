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
- `crates/web/aphrody-web-extract` is now the first local Rust owner. It
  implements opt-in URL normalization and static title/description/canonical
  metadata extraction. Its six focused unit tests pass. It is not yet wired to
  consumers and does not claim BXC parity.
- The root Cargo manifest still resolves `aphrody-web-bridge` and `obscura-mcp`
  through `../src/aphrody-web`; those are checkout dependencies, not extracted
  owners.
- AI MCP, messaging, and application-server code already consume or route BXC
  tools. Those are consumers to preserve while replacing the implementation.
- The generated ecosystem catalog previously described 22 Rust crates and six
  Bun manifests. The tables above are from the refreshed Infra map; refresh the
  catalog through its owner before changing generated catalog contents.

## Browser and runtime ownership map

| Surface | Existing owner / role | Consolidation boundary |
| --- | --- | --- |
| Obscura | `obscura-{dom,net,browser,cdp,js,render,mcp,cli}` plus `aphrody-browser`; DOM, network, V8 execution, CDP, optional layout/paint and MCP | Keep as an internal backend of canonical `aphrody-web`; qualify V8/thread/feature and upstream-license boundaries before merging crates. |
| Web engine and service | `aphrody-web-engine`, `aphrody-web-service`, `aphrody-web` | Canonical Rust web/browser API and thin CLI/service entry points. |
| Extraction and indexing | `aphrody-web-extract`, `aphrody-web-index` | Consolidate duplicated HTML-to-Markdown, main-content extraction, URL canonicalization, SimHash and vector-index paths after parity evidence. |
| FFI | `aphrody-web-ffi`, `aphrody-web-bridge` | One ABI/loader owner; keep compatibility symbols and existing callers until mapped and qualified. The bridge currently spans native byte operations and a BXC subprocess for browser work. |
| Chromium/CDP | `aphrody-web-chromium`, browser/CDP adapters and BXC profiles | Preserve explicit Chromium escalation and profile/cookie isolation; JSC or Obscura does not imply Chromium parity. |
| Lightpanda | Optional external headless engine configured for `agent-browser` and BXC profiles | Keep an adapter/backend only where workload parity justifies it; do not fold an unmodified Zig upstream into Rust. |
| Agent automation | `@aphrody/agent-browser` in the generated source catalog; installed host CLI is agent-browser 0.38.1 | Treat the installed CLI and the source package as separate artifacts; keep one supported agent-facing setup and document engine selection. |
| BXC | Bun implementation and SDK, MCP/CLI consumers | Behavior migrates into canonical Rust owners before removing the compatibility facade. |

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
