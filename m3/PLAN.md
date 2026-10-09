<!-- SPDX-License-Identifier: Apache-2.0 -->
# Aphrody M3 — integration plan

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
| App Router example app (replaces the removed `apps/showcase`) | `apps/` (pending) |
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
`packages/m3/test/app/{scan,plugin,router}.test.ts` on `test/fixtures/app-router` (written 2026-10-09, not yet run).
Next: example app, Shenron slice, compile and Docker Alpine through m3-bun, measured comparison with `next build`/`next
start`, TanStack Router SPA template, M3 `DataTable`/`VirtualList`. Bun gaps (Bake `"use server"`, production Bake)
are fixed in the Bun fork core, never shimmed here.

## Full Bun (chantier T, Bun fork plan section T)

Outside the framework packages, no vite, vitest, jest, pnpm, tsx, ts-node, esbuild or webpack remains: tests run with
`bun test` + happy-dom, builds with `Bun.build`, `eslint-plugin-m3` is an oxlint JS plugin, `scripts/yolo.ts` runs the
Bun CLI of yolo (never the bash launcher) and package tests are scoped to `./packages/*`. `node:*` imports were moved to
Bun APIs where equivalent (`Bun.file`, `Bun.write`, `Bun.spawn`, `Bun.CryptoHasher`, `Bun.fileURLToPath`, `Bun.Archive`);
`node:path`, `node:os`, `mkdtemp`, recursive `rm`, `symlink`, `chmod` and synchronous public APIs stay. `@aphrody/rg-ui` is
a workspace member with typed optional host peers. Verification after the 2026-10-09 refactor is pending the final test pass.
