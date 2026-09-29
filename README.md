<!-- SPDX-License-Identifier: Apache-2.0 -->

# Aphrody — Rust + Bun

The canonical Rust and Bun monorepo is being assembled from the Aphrody source
workspaces. Migration scope, provenance, order and stability gates are in
[PLAN.md](PLAN.md). The cross-repository orchestrator remains
`@aphrody/workspace` in `aphrody-infra`.

The root Cargo workspace now integrates the ten Contracts crates, the standalone Native crate, all 24 OS
crates, all four Shell crates, all 13 Compat crates, all 25 Koharu crates, and IECODE data plus the nine-crate native FFI closure
under `crates/iecode/`. The IEVR slice preserves package
`iecode-ievr-data` and Rust library name `nie_data`; it is private and
unpublished. Contracts/OS/Shell/Compat file provenance, package versions and
scoped checks are recorded in
[`docs/migration/native-rust-extraction.json`](docs/migration/native-rust-extraction.json).
The IECODE data source and origin revisions, SHA comparison, license boundary,
and check result are in
[`docs/migration/ievr-iecode-extraction.json`](docs/migration/ievr-iecode-extraction.json).
The current IECODE Rust FFI and library closure, source working-tree provenance,
and focused check are in
[`docs/migration/iecode-ffi-rust-extraction.json`](docs/migration/iecode-ffi-rust-extraction.json).
Source checkouts remain intact. The Koharu source tree, package metadata and
MIT/Apache notices are recorded in
[`koharu-rust-extraction.json`](docs/migration/koharu-rust-extraction.json). Two Cargo
path dependencies still reach the UI source checkout, outside this task scope.
The IECODE source's older `@aphrody/nie` ABI and NIE MCP consumers remain to be qualified;
no IECODE Bun wrapper is staged in this workspace.

The four Compat N2B packages are also in the Bun workspace under
`packages/compat/`; their provenance and typecheck results are in
[`compat-bun-extraction.json`](docs/migration/compat-bun-extraction.json).
The OS `@aphrody/os` client and private Windows WinClean client are integrated
under `packages/os/`; their source and workspace records are documented in
[`os-bun-extraction.json`](docs/migration/os-bun-extraction.json).
Koharu's `@koharu/sdk`, `@koharu/bridge`, and `@koharu/docs` workspaces are
integrated under `packages/koharu/`; see
[`koharu-bun-extraction.json`](docs/migration/koharu-bun-extraction.json) for
source hashes and the bridge path adjustment.
FUT's `@aphrody/fut` package is under `packages/fut/fut/`; its committed
session file was excluded. Its BXC dependency is still outside this checkout,
so the package's full typecheck remains open. See
[`fut-bun-extraction.json`](docs/migration/fut-bun-extraction.json).
The IECODE Bun compatibility wrappers were removed from this workspace after
the staged `@aphrody/nie` ABI proved incompatible with the current Rust provider
and the game-loader/data/license contracts remained unqualified. The generic
`@aphrody/bun-test-dom` package remains independently owned here. The historical
staging paths and source hashes are retained in
[`iecode-bun-extraction.json`](docs/migration/iecode-bun-extraction.json).

The remaining Cargo crates, Bun apps/packages, and MCP handlers have not been
fully imported. Follow the exact source-to-target inventory and open
acceptance gates in [PLAN.md](PLAN.md).
