<!-- SPDX-License-Identifier: Apache-2.0 -->
# Aphrody M3 — integration plan

## Owner directive — native Rust and Bun targets (2026-10-09)

The [native Rust migration plan](../docs/plans/m3-native-rust/PLAN.md) owns the
new execution queue: Aphrody sites and application servers move to native Rust,
M3 supports both Rust and Bun, and generic runtime/framework code transfers to
the Bun fork through qualified handoffs. Existing Bun milestones below remain
dated source evidence; they do not qualify the new Rust target.

[GOAL.md](GOAL.md) owns the requested scope. [AGENTS.md](AGENTS.md) owns local
execution rules. [MEMORY.md](MEMORY.md) records dated validation and limitations.
The [Aphrody architecture](../PLAN.md) and [Yolo producer plan](../../yolo/PLAN.md)
remain authoritative for native runtime and installed hosts.

## One framework, explicit owners

| Surface | Owner |
| --- | --- |
| Plugin, theme modules, Bun web build, App Router (`@aphrody/m3/app`) and `m3` CLI | `packages/m3` |
| App API/file server, executable compiler and deployment configuration | `packages/m3-bun` |
| Shared `Bun.build` preset and workspace build cache | `packages/m3-config`, `scripts/build.ts` |
| Tokens, themes and renderer adapters | M3 packages; canonical native token contract in Aphrody `crates/ui/m3-tokens` |
| Package build/test orchestration | `scripts/yolo.ts`, the Bun CLI `$YOLO_ROOT/packages/engine/yolo/src/index.ts` |
| App Router example app (replaces the removed `apps/showcase`) | `apps/example` |
| Native artifacts and installed desktop/mobile hosts | Aphrody integrator and declared build factory |

See the [framework guide](docs/guides/FRAMEWORK.md),
[Bun application guide](docs/guides/M3-BUN.md),
[design plan](docs/plans/design/M3-PLAN.md) and
[host matrix](docs/plans/design/M3-MULTI-HOST-PLAN.md).

## Gates

Use the scripts actually declared by the selected checkout:

```sh
bun run check
bun run test
bun run lint
bun run typecheck
bun test ./packages/m3/qualification/check.test.ts
```

The root test task includes script tests, workspace package tests and integrity
gates. Its package exclusions and the narrower default build/lint/typecheck
scopes are documented in the framework guide. Qualify an affected package with
its own declared scripts when the root scope does not cover it. Run oxlint and
oxfmt on owned TypeScript files; use content/link/whitespace checks for documents.

Build, executable smoke and native installation are separate gates. Do not
rebuild or overwrite another active batch's outputs, install dependencies,
publish a package or claim cross-platform support to resolve a documentation
task. Run relevant artifact gates when owning the corresponding source batch.

## Finalization queue

1. Resolve `m3 check` against the nearest framework contract while preserving
   the existing Aphrody `bun:check` contract.
2. Align the package map, entrypoints, build pipeline and host matrix with source.
3. Record workspace checks and remaining source/platform dependencies with
   reproductions in [the finalization receipt](docs/reports/FRAMEWORK-FINALIZATION.md).
4. Deliver the completed owned batch; leave concurrent source batches and
   unqualified host milestones open until their integrator supplies evidence.

Successful timing, output generation or a source export alone never closes a
runtime, deployment, performance or installed host milestone.

## App Router (chantier S, Bun fork plan section S)

`@aphrody/m3/app` implements Next.js `app/` conventions on `Bun.build` (rsc/ssr/client layers) and `Bun.serve` with
`react-server-dom-parcel`; see the [framework guide](docs/guides/FRAMEWORK.md#app-router-aphrodym3app). Tests:
`packages/m3/test/app/{scan,plugin,router}.test.ts` on `test/fixtures/app-router` (40 pass on 2026-10-09). The example
app `apps/example` builds, prerenders and serves end to end in `apps/example/test/app.test.ts` (7 pass). The `spa`
scaffold template (TanStack Router on m3-bun) type-checks and bundles against `@tanstack/react-router` 1.170. M3
`DataTable`/`VirtualList` live in `@aphrody/m3-react` (`test/data.test.tsx`, 6 pass).
`m3 compile` links an App Router build into one executable (server layers bundled, the other build files embedded with
`with { type: "file" }`) and `m3 docker` writes a context (`server.js`, `dist/`, Dockerfile on
`ghcr.io/aphrody-labs/alpine:3.24-runtime`); `test/app/compile.test.ts` covers both (55 pass in `test/app`).
Measured comparison (`apps/example/bench/next-vs-m3.ts --runs 3 --seconds 5`, 2026-10-09): one small app written once
(static `/` with 200 links and a client counter, dynamic `/items/[id]` reading `headers()`, route handler
`/api/ping`), React 19.3.0, both servers on Bun 1.4.3-aphrody.2 (`m3 start`, `bun --bun next start`; no Node.js on the
host), Windows x64, 24 threads, machine shared with other jobs, Bun fetch client in the same machine (32 connections):

| metric | m3 | Next 16.5.0-canary.4 |
| --- | --- | --- |
| cold build, median of 3 | 170 ms | 2691 ms |
| output size (`dist` / `.next` without cache) | 2.8 MiB | 6.2 MiB |
| start to first 200, median of 3 | 85 ms | 461 ms |
| JavaScript downloaded for `/` | 238 175 B | 576 531 B |
| `/` req/s (p50/p99 ms) | 10 101 (3.1/4.1) | 1 623 (18.9/32.6) |
| `/items/7` req/s (p50/p99 ms) | 8 703 (3.3/6.3) | 529 (57.3/120.7) |
| `/api/ping` req/s (p50/p99 ms) | 59 067 (0.5/1.1) | 2 280 (13.5/27.2) |
| memory idle / after load (process tree working set) | 55.4 / 101.6 MiB | 86.7 / 159.2 MiB |

Not measured: Next on Node.js, Linux, a real app (Shenron slice).
Next: Shenron slice (blocked: Shenron does not depend on `@aphrody/m3` with `/app` yet). Bun gaps (Bake `"use server"`, production Bake)
are fixed in the Bun fork core, never shimmed here.

## Full Bun (chantier T, Bun fork plan section T)

Outside the framework packages, no vite, vitest, jest, pnpm, tsx, ts-node, esbuild or webpack remains: tests run with
`bun test` + happy-dom, builds with `Bun.build`, `eslint-plugin-m3` is an oxlint JS plugin, `scripts/yolo.ts` runs the
Bun CLI of yolo (never the bash launcher) and package tests are scoped to `./packages/*`. `node:*` imports were moved to
Bun APIs where equivalent (`Bun.file`, `Bun.write`, `Bun.spawn`, `Bun.CryptoHasher`, `Bun.fileURLToPath`, `Bun.Archive`);
`node:path`, `node:os`, `mkdtemp`, recursive `rm`, `symlink`, `chmod` and synchronous public APIs stay. `@aphrody/rg-ui` is
a workspace member with typed optional host peers. Verification after the 2026-10-09 refactor is pending the final test pass.
