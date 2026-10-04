<!-- SPDX-License-Identifier: Apache-2.0 -->
# Aphrody Bun platform

Current source ownership, checked on 2026-10-02. The root
[Cargo workspace](../../../Cargo.toml) and [Bun workspace](../../../package.json)
own first-party dependencies. Retired split repositories are not build inputs.
The [ecosystem catalogue](../../ecosystem/ECOSYSTEM.md) is the generated inventory.

## Owners

| Capability | Source owner | Boundary |
| --- | --- | --- |
| Bun runtime fork | Fork pin, private `aphrody-labs/bun` | JavaScriptCore runtime, bundler, package manager and tests. The fork is distinct from the installed upstream Bun executable. |
| Toolchain discovery | [aphrody-toolchains](../../../crates/compat/toolchains/) | Installed executable discovery and version pins. |
| Node-to-Bun analysis | [N2B crates](../../../crates/compat/) and [surface inventory](../compat/n2b/BUN-SURFACE.md) | Static analysis, migration rules and reports; source analysis does not execute remote JavaScript. |
| Bun N2B consumers | [client](../../../packages/compat/n2b-client/), [plugin](../../../packages/compat/n2b-plugin/) | Thin bindings to the owned scanner and build-time analysis. |
| N2B native ABI | [aphrody-n2b-native](../../../crates/compat/n2b-native/) | Versioned C ABI with owned-string release. |
| Oxc tools | [Cargo pins](../../../Cargo.toml), private `aphrody-labs/oxc` | Parser, formatter, linter and minifier dependencies; inspect the actual pinned revisions. |
| Offline Bun docs | [aphrody-bun-docs](../../../crates/compat/bun-docs/), [Bun reference](../upstream-bun/) | Version-matched documentation and Node compatibility lookup. |
| Runtime C ABI | [aphrody-ffi](../../../crates/interop/ffi/) | In-process native calls through an explicit versioned ABI. |
| Web acquisition | [aphrody-web-crawl](../../../crates/web/web-crawl/), [web service](../../../crates/web/web-service/), [CLI](../../../crates/web/web-engine/) | One native crawl frontier and shared browser/network owners. |
| Bun web consumers | [WebService](../../../packages/web/agent-browser/src/service.ts) | Thin bindings; no independent fetch fallback, frontier or scraper engine. |
| RG game packages | [Pinned IECODE contract](https://github.com/aphrody-labs/iecode/blob/main/docs/rg/decisions/ievr-packages-from-iecode.md) | Producer-owned private archives; no copied game package or external Bun workspace member. |

## Runtime evidence

`config/bun-fork.json` (not in repo) records the historical Linux debug verification and the
native ABI versions for `bun:aphrody`. It also records unresolved distribution
and consumer-selection gates. Source presence and an installed upstream Bun
binary do not prove the fork module is running.

The module binds separately built Aphrody, N2B and Oxc dynamic libraries through
`bun:ffi`. It does not establish static linkage, replacement of Bun's parser,
minifier or test runner, or a cross-platform release. Revalidate exact library
and runtime revisions before making those claims.

## Single web owner

Only `aphrody-web*` owns crawling and scraping infrastructure. RG, Shenron and
IECODE retain domain parsing, indexing and caller configuration behind thin
bindings. Retired BXC or split-repository implementations must not be kept as
fallback engines. Preserve rendered-page acquisition and bounded-response
behavior when migrating a consumer; a static crawl is not rendered-page parity.

## Validation and delivery

Use root workspace commands and the owning package's scoped checks. Native
Cargo commands are serialized through `scripts/build/rust/cargo-serial.sh`.
The WSL build family remains parked until Aphrody deployment, following the
[Infra handoff](../../plans/infra/sql-convergence-handoff.md).

Private source archives and manifests carry revisions and SHA-256 evidence.
A successful install, static typecheck or narrow test does not establish live
service behavior or deployment. Repositories and packages remain private;
no registry publication is authorized.
