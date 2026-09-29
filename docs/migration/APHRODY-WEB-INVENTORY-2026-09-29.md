<!-- SPDX-License-Identifier: Apache-2.0 -->
# Aphrody Web extraction baseline — 2026-09-29

This is a target-repository inventory, not a claim that the referenced source
checkout is current. The Infra-generated [`source-map.json`](./source-map.json)
records `aphrody-web` at `6f966cc5cd56c01eb2a3d20e6ef518d5794b02d9`, clean,
with 1,652 paths, 26 Rust manifests, and 6 Bun manifests. Recheck the source
head, worktree, hashes, notices, and consumers through Infra before importing.

## What is already in this target

- `packages/web/x` contains `@aphrody/x`, a Bun/TypeScript client and its
  configuration, services, storage, and tests.
- `crates/web` has no Rust source/manifests yet. The root Cargo manifest still
  resolves `aphrody-web-bridge` and `obscura-mcp` through
  `../src/aphrody-web`; that is a checkout dependency, not an extracted owner.
- AI MCP, messaging, and application-server code already consume or route BXC
  tools. Those are consumers to preserve while replacing the implementation.
- The generated ecosystem catalog describes 22 Aphrody Web Rust crates and six
  Bun packages: the `aphrody-web*` family, `aphrody-browser`, the Obscura
  workspace, `@aphrody/agent-browser`, BXC, `@aphrody/bxc-test`, and `@aphrody/x`.
  The catalog is generated evidence; it must be refreshed before migration.

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
