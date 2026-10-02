<!-- SPDX-License-Identifier: Apache-2.0 -->
# aphrody-compat documentation

## Current reference

| Document | Content |
| --- | --- |
| [PLAN.md](../../../plans/compat/PLAN.md) | Decision ledger (crates.io release set of the `n2b` CLI closure). |
| [BUN.md](../../../reference/compat/BUN.md) | Compat Bun workspace map, manifest rules, gates and the Bun upgrade procedure. The cross-repository map lives in [Infra](../../../reference/infra/APHRODY-BUN-PLATFORM.md). |
| [BUN-RUST-INTEGRATION.md](../../../reference/compat/BUN-RUST-INTEGRATION.md) | Existing Bun/Rust process and FFI boundaries; no runtime crate is linked into Bun. |
| [n2b/README.md](../n2b/README.md) | n2b knowledge base: vendored Bun and Node docs, regeneration, registry citations. |
| [../scripts/n2b/PLUGIN-SCRIPTS.md](../../../reference/compat/scripts/n2b/PLUGIN-SCRIPTS.md) | n2b maintenance scripts. |

## Research and audits (point-in-time)

These record findings at a given date. Paths and crate names in them may predate the category
split (for example `C:/src/aphrody`, `crates/interop/ffi` or `/tmp/bun`); the root
[README](./README.md.038abe5c2ce0) is authoritative for the current layout.

| Document | Content |
| --- | --- |
| [aphrody-bun.md](../../../reference/compat/aphrody-bun.md) | Upstream Bun's hybrid Rust + C++ architecture. |
| [aphrody-bun-napi-optimization.md](../../../apis/compat/aphrody-bun-napi-optimization.md) | napi-rs vs `bun:ffi` for Rust-to-TypeScript libraries on Bun. |
| [bun-crates-deep-dive.md](../../../reference/compat/bun-crates-deep-dive.md), [-2](../../../reference/compat/bun-crates-deep-dive-2.md), [-3](../../../reference/compat/bun-crates-deep-dive-3.md) | Deep dive into Bun's internal Rust crates. |
| [research/bun-rust-ffi-best-practices.md](../../../research/compat/research/bun-rust-ffi-best-practices.md) | `bun:ffi` best practices extracted from Bun's source. |
| [research/bun-vs-vite-2026.md](../../../research/compat/research/bun-vs-vite-2026.md) | Bun vs Vite as frontend build toolchain, with benchmarks. |
| [n2b/plugin/n2b/](../../../reference/compat/n2b/plugin/n2b/INDEX.md) | Historical n2b bundle from before the move into this repository: changelog, research, Bun roadmap mapping, WASM reports. |
