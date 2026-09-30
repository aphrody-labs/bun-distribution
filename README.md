<!-- SPDX-License-Identifier: Apache-2.0 -->

# Aphrody — Rust + Bun

This is the active Aphrody Rust and Bun monorepo. Its [plan](PLAN.md) records
migration progress and acceptance gates; the source-to-target evidence is in
[`docs/migration/`](docs/migration/). The shared orchestration package is
[`@aphrody/workspace`](packages/infra/aphrody-workspace/).

`/home/aphro/aphrody-py` owns Aphrody Python work. `/home/aphro/iecode`
exclusively owns IECODE, NIE and IEVR game implementation. `/home/aphro/src`
is a legacy source archive. This repository retains historical extraction
records for code that was staged and later removed; those records do not imply
that the code is still present here.

Read [AGENTS.md](AGENTS.md) before editing. Use the root Cargo and Bun
manifests for current workspace members and the owning package's checks for
validation. The open migration work is tracked in [PLAN.md](PLAN.md).
