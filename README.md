<!-- SPDX-License-Identifier: Apache-2.0 -->

# Aphrody — Rust + Bun

This is the active Aphrody Rust and Bun monorepo. Its [plan](PLAN.md) records
migration progress and acceptance gates; the source-to-target evidence is in
[`docs/migration/`](docs/migration/). The shared orchestration package is
[`@aphrody/workspace`](packages/infra/workspace/). Upstream clones live in
`~/source` (`bun run sources`); the native AI integration plan is
[docs/plans/ai/native-integration-master.md](docs/plans/ai/native-integration-master.md).

`/home/aphro/aphrody-py` owns Aphrody Python work. `/home/aphro/iecode`
exclusively owns IECODE, NIE and IEVR game implementation. `/home/aphro/src`
is a legacy source archive. This repository retains historical extraction
records for code that was staged and later removed; those records do not imply
that the code is still present here.

Read [AGENTS.md](AGENTS.md) before editing. Current crates, packages and apps
per domain are generated in [STATE.md](docs/reference/workspace/STATE.md); the
documentation index is [docs/README.md](docs/README.md). Both are refreshed by
`bun run docs:gen` and gated by `bun run docs:check`. Use the owning package's
checks for validation. The open migration work is tracked in [PLAN.md](PLAN.md).
