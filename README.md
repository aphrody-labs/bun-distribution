<!-- SPDX-License-Identifier: Apache-2.0 -->

# Aphrody — Rust + Bun

The canonical Rust and Bun monorepo is being assembled from the Aphrody source
workspaces. Migration scope, provenance, order and stability gates are in
[PLAN.md](PLAN.md). The cross-repository orchestrator remains
`@aphrody/workspace` in `aphrody-infra`.

The initial Cargo workspace contains the first IECODE/NIE domain slice at
`crates/iecode/ievr-data`. It preserves package `iecode-ievr-data` and Rust
library name `nie_data`; it is private and unpublished. Its source and origin
revisions, SHA comparison, license boundary, and current check result are in
[`docs/migration/ievr-iecode-extraction.json`](docs/migration/ievr-iecode-extraction.json).
The source checkout remains intact. This extraction does not yet include the
IECODE FFI binding, `@aphrody/nie`, the Bun plugin, or the NIE MCP tools.

The Bun workspace now stages the IECODE `@aphrody/iecode-ffi`, `@aphrody/nie`
and `@nie/plugin` surfaces, plus the shared `@aphrody/bun-test-dom` preload.
These packages typecheck on the root TypeScript 7 toolchain. The current Rust
`iecode-ffi` provider has not yet joined Cargo, and the older `@aphrody/nie`
symbol table is incompatible with it; the plugin remains private and inactive
until the ABI and game-data contract are reconciled. Details and source hashes
are in [`iecode-bun-extraction.json`](docs/migration/iecode-bun-extraction.json).

The remaining Cargo crates, Bun apps/packages, and MCP handlers have not been
fully imported. Follow the exact source-to-target inventory and open
acceptance gates in [PLAN.md](PLAN.md).
