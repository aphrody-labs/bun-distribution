<!-- SPDX-License-Identifier: Apache-2.0 -->
# Mirror of the seed of the private `vu` repository

The repository `aphrody-labs/vu` (private, created 2026-10-05, decision D1 in [../PLAN.md](../PLAN.md)) is the build
input of the runtime. This directory keeps, inside the Aphrody monorepo, the files that carry the pins and the identity, so
that they stay reviewable and checked by a gate even where the private repository is not readable.

| File | In the vu repository | Role |
| --- | --- | --- |
| [vu.json](vu.json) | vu.json (byte-identical) | The single place of the runtime name and the templates of every derived name |
| [vendor.json](vendor.json) | vendor.json (byte-identical) | Pins: the three forks (exact commit, fork branch, crates.io evidence) and the python-build-standalone assets with sha256 |
| [Cargo.toml.scaffold](Cargo.toml.scaffold) | Cargo.toml | Workspace root of the launcher and the CPython embedding (copy at the time of the first build) |
| [rust-toolchain.toml.scaffold](rust-toolchain.toml.scaffold) | rust-toolchain.toml | The Aphrody Rust channel (copy at the time of the first build) |

The two `.scaffold` files carry that suffix so that Cargo and the repository's manifest scanners ignore them.

Checks: `bun scripts/audit/workspace/vu-pins.ts` (offline), `--online` (fork branches and upstream tags through
`aphrody git api`) and `--vu <checkout>` (the private repository's vendor.json and vu.json equal the files here); tests in
scripts/audit/workspace/vu-pins.test.ts.
