<!-- SPDX-License-Identifier: Apache-2.0 -->

# Aphrody

Aphrody is a private Rust and Bun monorepo for the Aphrody platform. It owns
product behavior, application services, shared capabilities, and the tooling
that builds and operates them. The current architecture moves reusable runtime
mechanisms into a precompiled Bun-based runtime produced by Yolo; Aphrody
consumes that runtime through a small versioned SDK. The migration is in
progress. See [PLAN.md](PLAN.md) for the decision, evidence, and acceptance
gates.

## Workspace map

| Path | Responsibility |
| --- | --- |
| `apps/` | Product applications, including Shenron and Rose Griffon |
| `packages/` | Bun packages and Workspace/Infra orchestration |
| `crates/` | Rust libraries, services, and capability owners |
| `config/` | Product, build, service, host, and deployment declarations |
| `scripts/` | Audits, builds, development, migration, release, and operations |
| `docs/` | Architecture, plans, APIs, operations, and generated references |
| `.coord/` | Shared claims, task receipts, and agent coordination |

The Python services live in `/home/aphro/aphrody-py`. IECODE has its own
repository at `/home/aphro/iecode` and owns its game implementation. Yolo is
the runtime producer at `/home/aphro/yolo`; this repository does not vendor its
engine sources.

## Start here

1. Read [AGENTS.md](AGENTS.md), [PLAN.md](PLAN.md), and [MEMORY.md](MEMORY.md).
2. Find the owning package, crate, service, and its current tests before
   changing a shared capability.
3. Check `.coord/claims` before editing shared work. Keep domain data, secrets,
   model weights, and caches in their existing protected stores.
4. Use the owning Workspace/Infra or capability-owner command. Do not create a
   second build factory, deployment path, updater, CLI, or network stack.

Current repository and package inventories are generated in
[`docs/reference/workspace/STATE.md`](docs/reference/workspace/STATE.md). The
documentation entry point is [`docs/README.md`](docs/README.md), and the
operator guides are under [`docs/operations/`](docs/operations/).

## Development and delivery

Use the pinned toolchain and the scripts declared by the selected package.
Bun and TypeScript changes use their scoped lint, format, type, and test gates.
Rust commands run through `scripts/build/rust/cargo-serial.sh`; preserve the
configured build factory, sccache, and shared caches. Documentation changes
use scoped link and whitespace checks plus the documentation index gate.
Record failed and skipped checks without describing them as passing.

Build and release work is owned by Workspace/Infra. A source tree, packaged
release, installed service, and activated production workload are separate
states. For Shenron administration read the `dbfr` profile and the current
Infra runbooks; protect PostgreSQL, Redis, RAG, and served assets during any
consolidation. Do not use a release candidate as proof of activation.

Repositories stay private. Push only to an existing authorized remote. Use
`aphrody-dev <contact@aphrody.com>` for commits, with no assistant attribution.
