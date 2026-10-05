<!-- SPDX-License-Identifier: Apache-2.0 -->
# Scaffold of the planned `vu` repository

Local files only: no repository `vu` exists and none is created by this plan (decision D1 in [../PLAN.md](../PLAN.md)).
They are the first commit of that repository, kept here so that the pins are reviewable and checked by a gate.

| File | Becomes | Role |
| --- | --- | --- |
| [vu.json](vu.json) | vu.json | The single place of the runtime name and the templates of every derived name |
| [vendor.json](vendor.json) | vendor.json | Pins: the three forks (exact commit, fork branch, crates.io evidence) and the python-build-standalone assets with sha256 |
| [vu-forge.json](vu-forge.json) | config/vu-forge.json | Build host configuration, smoke commands and receipt schema, mirror of config/bun-forge.json |
| [Cargo.toml.scaffold](Cargo.toml.scaffold) | Cargo.toml | Workspace root: path dependencies on the fork checkouts, release profile |
| [rust-toolchain.toml.scaffold](rust-toolchain.toml.scaffold) | rust-toolchain.toml | The Aphrody Rust channel |

The two `.scaffold` files carry that suffix so that Cargo and the repository's manifest scanners ignore them.

Checks: `bun scripts/audit/workspace/vu-pins.ts` (offline) and `--online` (fork branches and upstream tags through
`aphrody git api`); tests in scripts/audit/workspace/vu-pins.test.ts.
