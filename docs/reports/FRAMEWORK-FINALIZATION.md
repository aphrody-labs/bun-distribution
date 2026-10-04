<!-- SPDX-License-Identifier: Apache-2.0 -->
# Framework finalization — 2026-10-04

Scope: the owner's confirmed request to finalize Aphrody M3 in the current
private checkout. Baseline: `8f4b3a5177a5919c590066bc338be3d2e2fefd79`, branch
`main`. The checkout already contained a large production source batch and
changed submodules owned by other sessions. This batch preserves those edits
and delivers only its CLI correction, regressions and coherent documentation.

## Delivered contract

`m3 check` selects the nearest `aphrody-m3` manifest declaring `check`. An
enclosing Aphrody `bun:check` remains supported, while an application's unrelated
`check` does not mask the framework. At the M3 repository root, testing uses its
declared `test` task, which avoids traversing upstream/reference test trees.

The package map and plans now describe `$YOLO_ROOT/bin/yolo`, `Bun.build` and
declaration generation, `@aphrody/m3-bun` as the app runtime/compiler owner,
the minimal web example, the adaptive showcase and actual gate scopes. The
previous unconditional completion and installed host claims have been removed.

## Validation evidence

Checks describe this current dirty checkout, including preexisting source work;
they do not establish a clean release or attribute that work to this batch.

| Command / scope | Observed result |
| --- | --- |
| `bun scripts/check-exports.ts --json` | 43 packages; 0 errors; 3 warnings for NIE WASM outputs in its independent submodule |
| `bun scripts/check-assets.ts --json` | 0 errors |
| `bun scripts/check-links.ts --json` | 0 errors at the initial checkout |
| `bun run typecheck` | 27 executed; 0 cached, failed or skipped; 32,247 ms |
| `bun run lint` | Exit 0; existing warnings remain |
| Scoped UI production, Next, migration and showcase suites | 211 passing tests; 1 conditional native Rust parity skip |
| `bun scripts/native.ts status --json` | Existing `@aphrody/bun@3.3.0` library loads through the native Yolo SDK |
| Initial `bun run test` inside sandbox | Script stage: 60 pass, 2 preparation timeouts; no global success claimed |
| `bun test --timeout 20000 ./scripts/forks.test.ts` | 22 pass, 0 fail; local temporary Git repositories only |
| Initial parallel package tests inside sandbox | Local socket tests fail with `EPERM`; interrupted the owned aggregate and reran outside sandbox |
| Root test rerun outside sandbox | Script stage: 65 pass, 1 temporary-Git preparation timeout; package stage not reached |
| Complete script suite with `--timeout 20000` | 72 pass, 0 fail, 213 assertions across 8 files |
| `bun test ./packages/m3/qualification/check.test.ts` | 7 pass, 0 fail, 22 assertions; also discovered by the M3 package's existing `bun test` task |
| Explicit TypeScript on the owned CLI and qualification | Pass |
| Strict oxlint and oxfmt on the two owned TypeScript files | Pass; no warnings or format violations |
| Final default TypeScript rerun after source changes | 5 executed, 22 cached, 0 failed or skipped |
| Final `bun run check` and owned document link/whitespace checks | 0 errors; the same 3 independent NIE WASM warnings remain |

The full parallel package rerun outside the sandbox exited 1. Four package
processes failed; negative-test child processes printed additional expected
failures and are not counted as package failures:

| Package | Outer suite result | Failure observed |
| --- | --- | --- |
| `@aphrody/scaffold` | 22 pass, 3 fail | Existing Vite/stylesheet expectations and temporary-output fixture conflict with the concurrently changed scaffolder contract |
| `@aphrody/m3-next-migrate` | 98 pass, 5 fail | New private owner workspace requirement rejects existing temporary-output fixtures |
| `@aphrody/m3-theme` | 10 pass, 3 fail | Installed native generator and committed sheets differ in their source-path provenance header |
| `@aphrody/m3-showcase` | 19 pass, 1 fail | Font response begins with `[obj` instead of the expected WOFF2 `wOF2` bytes |

The Bun runtime's outer suite passed 121 tests, with 4 platform skips. Earlier
scoped UI results describe their sampled source state; concurrent changes after
that sample do not inherit its qualification. These aggregate failures remain
owned by the active source batches and prevent calling the whole framework
finished. No new engine build, dependency installation, deployment, registry
publication or platform activation is established by this batch.

## Remaining source and host qualification

These reproductions belong to other active or preexisting source batches. They
remain open; documentation cannot close their technical gates.

- **Benchmark entrypoint:** `bun /home/aphro/yolo/bin/yolo version --json`
  fails with a syntax error; `/home/aphro/yolo/bin/yolo version --json` succeeds.
  `scripts/bench/run.ts` still uses the former shape and records nonzero command
  durations as metrics. A budget comparison must not qualify those timings.
- **Gate coverage:** `scripts/build.ts` currently uses `tsconfig.json` instead
  of the package's declared typecheck command. Alternate configs/multi-command
  scripts need their owner gates. Root `scripts/yolo.ts` also ignores additional
  build/test/lint/typecheck arguments; use the direct owner pipeline where needed.
- **Export selection:** an unknown selector to `scripts/check-exports.ts`
  currently returns zero packages without an error. Default full-workspace
  qualification was used here; an empty selected scope is not valid evidence.
- **HTTP parity:** `createM3App` protects built-in health/metadata endpoints,
  while `startM3Server` native routes can shadow them. A GET-only method route
  answers HEAD differently through `routesToFetch` and Bun native dispatch.
  The portable/native matrix needs these cases before claiming identical APIs.
- **DOM timing:** the Next client's dynamic seed test waits a fixed 50 ms.
  It passes in isolation but failed when grouped with other DOM suites. Replace
  that delay with a bounded observable assertion in its owning batch.
- **Formatting:** existing script formatting fails for `check-assets.ts`,
  `check-exports.ts`, `check-links.ts` and `lib/workspace.ts`; owned TypeScript is
  qualified separately. Do not weaken formatting gates to claim a global pass.
- **Installed hosts:** desktop/mobile installation, screen-reader use, native
  permissions and process lifetime require platform receipts. Source exports,
  responsive viewports and generated configs are insufficient. See the
  [host matrix](../plans/design/M3-MULTI-HOST-PLAN.md).

Raw command logs stay under `/tmp` or ignored coordination runs. They are not
staged. File memory records evidence only, without provider synchronization.
