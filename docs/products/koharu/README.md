<!-- SPDX-License-Identifier: Apache-2.0 -->
# Aphrody Koharu

Standalone Rust/Bun library extracted from Koharu revision `c697b31e`.
[Upstream README](./UPSTREAM-README.md) and MIT/Apache-2.0 notices preserve provenance.

## Ownership and use

| Owner | Surface |
| --- | --- |
| `crates/koharu-library` and workspace crates | Projects, scenes, processing, translation, agent, render/export |
| `koharu-sdk` binary | Headless JSONL requests: `id`, `method`, `params`; response `result` or `error` |
| `packages/sdk` | Host-neutral Bun client plus native, settings and Tauri adapters |
| `packages/bridge` | Generated commands and WASM/WebGPU canvas bindings |
| Sibling `aphrody-ui/packages/koharu-ui` | Editor components, styles and presentation |

```sh
RUSTC_WRAPPER= cargo build -p koharu-library --bin koharu-sdk
```

The binary accepts `--root <directory>`. Current methods live in
`packages/sdk/src/native.ts` and `crates/koharu-library/src/bin/koharu-sdk.rs`.
UI's `koharu_rpc` broker uses the JSONL settings contract; the complete editor
is not yet mounted. Keep native durable scene/export work separate from transient
WebGPU canvas interaction.

## Remaining integration

Follow [K0–K9 in the shared plan](../../plans/ai/PLAN.md#koharu-aphrody-and-shenron-convergence)
and [AGENTS.md](../../reference/koharu/AGENTS.md) for NHITL, ownership and focused validation.
Local consumers currently use sibling paths; source is published at
[`aphrody-labs/aphrody-koharu`](https://github.com/aphrody-labs/aphrody-koharu). Clean
external source closure remains open.
Weights and native runtime binaries need separate distribution for offline use.

The standalone Rust desktop is Tauri v3 alpha while JavaScript adapters use v2;
that pairing is unqualified.

## Release

Run `bun run release [-- --version <semver>]` from the repository root. The command
uses `aphrody-ops koharu-release`, updates the workspace version and lockfile,
generates `CHANGELOG.md`, then creates the release commit and tag. Shenron consumes hash-bound **unreviewed** candidates;
visual judgment, authorization and editorial database writes remain in Shenron.

## Documentation

Run `bun run docs:check` to validate local Markdown/MDX links and Mint
root-relative routes under `packages/docs`.
