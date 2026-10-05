# PERF-M3-YOLO: measured performance of aphrody-m3 and yolo

Date: 2026-10-04. Scope: the aphrody-m3 monorepo, the yolo CLI (build, serve and compile paths) and the Bun pipeline
between them. Every figure below comes from `scripts/bench/run.ts` or from the exact command printed next to it.
Raw snapshots: `perf-before.json`, `perf-after.json` (distributions, equivalence gates, environment).

## Environment and method

| | |
| --- | --- |
| Host | WSL2, kernel 6.18.33.2-microsoft-standard-WSL2, Intel i7-13700F (16 threads), 20000 MiB RAM |
| Toolchain | Bun 1.4.2 (744846f84), TypeScript 7.0.2 (native), oxlint 1.86.0, hyperfine (cargo) |
| Revisions | before: aphrody-m3 a4c76cb, yolo dfd3853 (mcp and themes re-measured at f39fb9f). after: aphrody-m3 e7febc4 (contains f5d206a and 970d122), yolo 1a3e91c (contains e05c82e); `status` measured at f3253ca |
| State | warm: Bun global install cache and OS page cache populated. "cold" is named where it applies |
| Load | the host is shared with other agents (git fetches, builds, test runs). Load average during the runs: before 6.5 to 8.7, after 9.1 to 10.5. Quiet-machine A/B figures are marked |
| Statistics | timings are p50 with p95 and min in the JSON. `--repeat 3` keeps, per timing, the best p50 of three complete runs (a loaded host only adds time) |
| Gates | equivalence gates (output digests, tool answers, pass counts) are stored next to the numbers; `--compare` prints the ones that differ |

Synthetic and single-host: none of this proves production scalability.

## Results

Harness, best of 3 complete runs, `bun scripts/bench/run.ts --repeat 3 --cold-cache --out ...`:

| Metric (command) | Before | After | Change |
| --- | ---: | ---: | ---: |
| yolo CLI `bun ~/yolo/apps/cli/src/index.ts version` (20 runs) | 19.9 ms (p95 20.5) | 7.59 ms (p95 8.34) | -62% |
| yolo `version --json` (the preflight of every wrapper task) | 19.8 ms | 7.67 ms | -61% |
| yolo `status --json` (default command of a checkout) | 159.2 ms (p95 195.6) | 12.5 ms (p95 14.3) | -92% |
| compiled yolo `version` (`bun build --compile`) | 17.1 ms (p95 18.1) | 3.25 ms (p95 3.44) | -81% |
| compiled yolo size | 77.86 MiB | 80.55 MiB | +3.4% |
| m3-mcp cold start (spawn to `initialize` response, 10 runs) | 65.4 ms (p95 67.6) | 59.2 ms | -9.5% |
| m3-os-themes CLI `generate --target all` (20 runs) | 42.4 ms | 27.2 ms | -36% |
| m3-os-themes first `generate()` in a process | 26.3 ms | 11.0 ms | -58% |
| m3-os-themes warm `generate()` (48 files, 38479 B) | 10.3 ms | 1.04 ms | -90% |
| `bun scripts/yolo.ts test` (23 packages) | 5.33 s | 3.43 s | -36% |

Same-state A/B, run back to back on the same files (more reliable than two harness runs; hyperfine -N, 2 warm-ups, 12 runs, `version` 20 runs):

| Command | Before | After |
| --- | ---: | ---: |
| `bun run --filter '@aphrody/m3*' --if-present test` vs the same with `--parallel --no-exit-on-error` (3 runs each) | 5.35, 5.29, 5.36 s | 2.97, 2.94, 2.89 s |
| yolo `version` (quiet host) | 20.7 ms | 6.4 ms |
| yolo `help` | 19.2 ms | 5.5 ms |
| yolo `docs --json` | 19.7 ms | 6.1 ms |
| yolo `doctor --json` | 21.6 ms | 11.7 ms |
| yolo `runtime list` | 20.1 ms | 10.0 ms |
| yolo `plugin check` | 30.4 ms | 18.0 ms |
| m3-mcp cold start, `server.ts` at HEAD vs changed (10 runs, best of 3) | 69.5 ms | 61.3 ms |
| minimal M3 server executable, start to first line (20 runs) | 14.3 ms (default flags) | 3.9 ms (`--bytecode`, no autoload) |
| minimal M3 server executable size | 78.29 MiB | 80.49 MiB |

The compiled-server row compares two flag sets in one run (`compile.server_default` and `compile.server_tuned`); the
repository has no compile of that server to change (see "Findings").

Not attributable to these fixes (other sessions changed the code between the runs): `test.sum` 9.97 s to 13.45 s
(m3-next 20 to 46 tests, m3-baseui 0 to 82, m3-fonts 4 to 10), `bundle.total` 1015 KiB to 1.08 MiB min and 354 to 398 KiB
gzip (new packages and components), `install.nm_bytes` 777 to 781 MiB (new dependencies), `typecheck.sum`, `task.typecheck`
(the package pipeline became a cached `scripts/build.ts`). The compile build times are dominated by copying an 80 MiB
runtime on a loaded disk (120 ms to 2.5 s for the same command) and are not a result.

## Fixes

| Fix | Where | Measured effect | Trade-off |
| --- | --- | --- | --- |
| Load each CLI command on demand; the programmatic API forwards to the module that defines it; `version` loads two small modules | yolo `apps/cli/src/index.ts`, `version.ts`, `packages/runtime/src/target.ts` (e05c82e) | `version` 19.9 to 6.5 ms, every other command 5 to 15 ms faster | first call of an API function pays its import (about 1 to 5 ms); `hostTarget` moved to a leaf module, `artifact` re-exports it |
| Compile the standalone yolo with `--bytecode`, without `.env`/`bunfig.toml` autoload; no top-level `await` in the entry guards; `isCompiled()` also checks `Bun.main` (a bytecode build reports the build-time path as `import.meta.dir`) | yolo `scripts/release/compile-flags.ts`, `release.ts`, `apps/cli/src/*.ts` guards, `packages/core/src/vfs/home.ts` (e05c82e) | compiled `version` 17.1 to 3.25 ms | +2.7 MiB binary; the installed binary no longer reads the cwd's `.env`/`bunfig.toml` (yolo reads neither) |
| `status`: inspect the submodules once instead of twice, count the first 250 files with `readdirSync` instead of a recursive `Bun.Glob` (55 ms on `vendor/next`) | yolo `packages/core/src/vendor/status.ts` (f3253ca) | `status --json` 159.2 to 12.5 ms; `inspectPackages` 75 to 3 ms | `readVendorStatus` takes an optional second argument; counts identical on all eight submodules (251, 251, 251, 251, 251, 92, 134, 251) |
| Memoise `rolesFor` per (seed, variant, mode), frozen results, 32 entries | m3-os-themes `src/color.ts` (f5d206a) | warm `generate()` 10.3 to 1.04 ms, first call 26.3 to 11.0 ms; one `generate()` called `schemeFromSeed` about 17 times for 2 distinct schemes | shared frozen object (a caller that mutated roles would now throw; none does) |
| Load the theme generators and the symbol catalogue on first use | m3-mcp `src/server.ts` (970d122) | cold start -8 ms (-12% A/B) | first call of those tools pays about 16 ms |
| Run package tests with `bun run --parallel --no-exit-on-error`: `--filter` alone waits for the workspace dependencies' scripts | `scripts/yolo.ts` (e7febc4) | 5.3 s to 2.9 s, identical pass counts per package | prefixed Foreman-style output; all packages at once; a failing package still fails the task (exit 3 checked on a two-package fixture) |
| `scripts/bench/run.ts`, `bun run bench`, `bun run bench:check`, `perf-budget.json` | `scripts/bench/`, `scripts/yolo.ts`, `package.json` | see Budget | none at runtime |

## Measured and left alone

| Area | Figure | Why it stays |
| --- | --- | --- |
| `bun install` | cold node_modules (warm cache) 143 ms before, 130 ms after; no-op 9.6 to 10.1 ms | at the floor. Isolated linker (default for this lockfile, `configVersion` 1) beats `--linker hoisted` (380 to 434 ms) and the hardlink backend beats `copyfile` (190 ms vs 613 ms, one run each) |
| Cold registry install | 21.8 to 24.4 s for 781 MiB (`--cache-dir` empty) | bandwidth bound: `--network-concurrency` 16, 48, 128 gave 22.2, 24.3, 21.9 s. No bunfig change helps |
| node_modules size | 781 MiB clean install (fixture), 962 MiB in the long-lived checkout | `next` 202 MiB plus its swc binding 92 MiB (glibc) and 91 MiB (musl) are 388 MiB, 48%, all for `m3-next`'s dev/peer dependency. The musl variants of swc, oxlint, oxfmt, lightningcss, sharp and @napi-rs/canvas are 176 MiB (22.7%): Bun 1.4.2 records no `libc` for them, so it cannot skip them |
| Duplicate versions | lockfile: 609 names, 616 versions. Six names twice or thrice: semver (6.3.1, 5.7.2, 7.8.5), zod (4.6.5, and 3.25.76 pinned by `@ag-ui/proto`), @types/unist, content-type, entities, source-map | the second copies total about 7 MiB (0.9%); forcing zod 3 to 4 would break `@ag-ui/proto`. The `catalog:` consolidation is already in place |
| Barrel files / `sideEffects` | one named import from a package barrel, minified, bare imports external: m3-primitives 110.7 KB to 680 B, m3-ai 83.3 KB to 59 B, m3-os-themes 32.4 KB to 592 B, m3-tailwind 8.4 KB to 857 B, m3-react `MdButton` 26.7 KB to 2.4 KB | Bun already shakes these; setting `"sideEffects": false` on m3-react in a copy gave the same bytes. Only `canvas` (230 of 234 KB, vendored native wrapper, side effects declared on purpose) and `m3-fonts` (85 KB of font data) do not shrink |
| tsc / oxlint | `typecheck.sum` 5.3 s over 27 packages (0.06 to 0.57 s each, TypeScript 7 native), `oxlint` over the lint scope 0.18 to 0.20 s | no project-reference or incremental gain available at these sizes |
| Package tests | `m3-ai` 2.7 s (a 2.1 s `setTimeout` in `ai.test.tsx:313`), `m3-primitives` 2.4 s (overlay tests sleep 600 ms and more), `m3-codemods` 2.0 s | sleep bound, and the test files are owned by another session; with the parallel run the slowest package sets the wall time |
| `m3 --version`, `m3 build` | `m3 build` of `apps/web` 132 ms; `m3 --version` takes 47 ms, 44 ms of it the static import of `@tailwindcss/node` and oxide through `plugin.ts` | `build` and `dev` need Tailwind anyway; deferring it would only speed up `version`/`help`/`tokens`/`new` (about 7 ms) |
| `m3 dev` | ready in 50 ms, first request 90 ms (Tailwind compile) | not changed |
| m3-mcp | SDK and zod are about 45 ms of the 59 ms. A single-file `bun build --target bun` bundle starts in 45 ms | not adopted: it needs a build artifact next to `src/server.ts` |

## Findings for other owners

- `m3 compile` (`packages/m3/src/cli.ts`) calls `Bun.build({ entrypoints: [html], compile: true })` with the default browser
  target. Bun 1.4.2 then writes a standalone HTML file (113188 B for `apps/web`), which the CLI marks executable; it is not an
  executable and does not serve. The comment in `scripts/yolo.ts` calls it a single executable.
- The new `packages/m3-bun` compile passes `autoloadDotenv: false, autoloadBunfig: false` but no `bytecode: true`. On the
  benchmark's minimal `serveM3` server `--bytecode` took the start from 14.3 to 3.9 ms (+2.2 MiB); it needs an entry without
  top-level `await` (a `main()` function).
- Bun 1.4.2 `--compile --bytecode` reports the build-time source path as `import.meta.dir`; code that detects the executable
  with `import.meta.dir.includes("$bunfs")` must also look at `Bun.main`.
- `bun x oxlint` at the root resolved oxlint from Bun's global cache while the root had no dependency on it; the root
  `devDependencies` another session is adding (uncommitted when this was written) pin it.

## Equivalence evidence

- yolo: `bun test test/` 296 pass, 5 skip, 0 fail (before the change: 283 pass, 1 fail in `host-config`, a systemd catalogue
  check owned by another session, which has since been fixed). `tsc --noEmit`, oxlint and oxfmt clean on the touched files.
- yolo differential run of the old and the new entry on 25 read-only commands (`help`, `version`, `status`, `docs`, `parse`,
  `plugin`, `verify --list`, `doctor`, `runtime`, `scan`, `generate`, unknown command): identical output apart from timestamps
  and `scan`'s `treeFingerprint`, which also differs between two runs of the same entry. `yolo mcp` answers an `initialize` +
  `tools/list` session with the same bytes. The compiled bytecode binary and the plain compiled binary print the same for 13
  commands, including a no-argument run (`help`), `ship` and `web build` (handed to the checkout).
- `yolo status --json`: the full report (apart from the timestamp) and its Markdown are identical old versus new.
- m3-os-themes: wyhash over all 48 generated paths and bytes unchanged (`themes.output`); 19 tests pass.
- m3-mcp: the 11 tool names and the answers of `m3_os_themes_list`, `m3_os_themes_generate`, `m3_symbol_search`, `m3_symbol_svg`
  and `m3_token_lookup` have identical digests before and after (`mcp.tools`, `mcp.call.3` to `mcp.call.7`).
- Tests: per-package pass counts are the same with `--parallel` (23 packages, 0 failures in both runs).
- `bun scripts/bench/run.ts --compare docs/reports/perf-before.json docs/reports/perf-after.json`: 62 of 74 gates identical.
  The 12 that differ are other sessions' work: a help line in yolo's uncommitted `index.ts`, new packages and tests, new
  lock entries, fixed tests and type errors in m3-baseui and m3-fonts, `oxlint` 9 errors to 6, and the intended
  `compile.yolo.flags`.

## Budget

`docs/reports/perf-budget.json` holds the after figures for 15 metrics (yolo `version`, `version --json`, `status`; mcp cold
start; themes CLI, first, warm; `node_modules` bytes; bundle total min and gzip; compiled server size and start; compiled yolo
size and start; lint task). `bun scripts/bench/run.ts --check` (`bun run bench:check`, through `scripts/yolo.ts`) measures only
the groups and tasks the budget names (about 30 s), prints a table, and exits 1 when a metric exceeds its budget by more than
10%. A failing timing is re-measured twice and the best p50 counts. Verified: it passes on the current tree and exits 1 against
a budget of 3 ms for `yolo version`.

Left out of the budget on purpose: `task.typecheck` (cached pipeline), `task.test` (CPU bound, 3.4 to 3.8 s run to run on this
host, so a 10% gate would flap; `scripts/yolo.test.ts` pins the parallel plan instead), compile build times (disk bound), and
per-package series. The timing budgets were taken under load 9 to 10, so they are loose on a quiet host. `bundle.total` and
`install.nm_bytes` move when other sessions add code or dependencies, which is the point of the gate; both were re-taken last
(the tree had grown to 1.21 MiB min, 446 KiB gzip and 794 MiB between the after-run and the commit, +12% and +2%).

## Not measured

- Windows and macOS hosts, a quiet-host full run, CI (no GitHub Actions job starts on aphrody-labs/aphrody: billing).
- Browser-side cost of the showcase: load, hydration, HMR latency. Next 16 / Turbopack consumers of the packages (only Bun's
  bundler was used for tree-shaking).
- Tauri desktop build and Cargo (workers do not start Cargo). `yolo ship`, `verify`, `host`, `upgrade` end to end.
- The installed `~/.yolo/bin/yolo` (77.7 MiB, built before these changes) was not replaced; the compiled figures are fresh builds
  of the release command in a scratch directory. No release was published and nothing was deployed.
- Cold-cache install is one sample per run (network). Linker and backend comparisons beyond the figures above.

## Appendix: per-package figures

Bundles: `Bun.build`, browser target, ESM, split, minified, every `exports` entry of the package, bare imports external, KiB
(`bundle.pkg.*` in the snapshots). A 0.0 row has no importable JS entry (`codemods`, `web`, the `app` and `tauri` examples) or, for
`identity`, cannot resolve its `crates/` assets from this mount depth. The differences are mostly other sessions' code; the memoisation in
`m3-os-themes` and the lazy imports in `m3-mcp` add a few hundred bytes each, not separated from the rest.

| package | min before | min after | gzip before | gzip after | CSS after |
| --- | ---: | ---: | ---: | ---: | ---: |
| ag-ui | 0.3 | 0.3 | 0.2 | 0.2 | - |
| app | - | 0.0 | - | 0.0 | - |
| assets | 213.8 | 213.8 | 78.7 | 78.7 | - |
| canvas | 27.9 | 27.9 | 9.1 | 9.1 | - |
| eslint-plugin-m3 | 72.6 | 72.6 | 22.7 | 22.7 | - |
| identity | 0.0 | 0.0 | 0.0 | 0.0 | - |
| m3 | 31.9 | 32.2 | 14.7 | 14.9 | - |
| m3-ai | 81.4 | 81.4 | 21.8 | 21.8 | - |
| m3-baseui | 0.0 | 30.6 | 0.0 | 18.3 | 124.9 |
| m3-bun | - | 50.4 | - | 22.0 | - |
| m3-codemods | 0.0 | 0.0 | 0.0 | 0.0 | - |
| m3-config | 4.7 | 4.7 | 2.4 | 2.4 | - |
| m3-design | 52.8 | 52.8 | 13.9 | 13.9 | - |
| m3-explorer | 11.8 | 11.8 | 3.8 | 3.8 | - |
| m3-fonts | 84.6 | 84.7 | 31.8 | 31.8 | 812.9 |
| m3-forms | 7.0 | 7.0 | 2.2 | 2.2 | - |
| m3-front | 3.2 | 3.2 | 1.9 | 1.9 | - |
| m3-icons | 5.2 | 5.2 | 2.9 | 2.9 | - |
| m3-mcp | 5.4 | 5.8 | 2.5 | 2.6 | - |
| m3-motion | 11.0 | 11.0 | 3.3 | 3.3 | - |
| m3-next | 18.9 | 24.7 | 8.3 | 10.8 | 0.2 |
| m3-next-migrate | 70.5 | 70.5 | 26.3 | 26.3 | - |
| m3-os-themes | 29.7 | 32.1 | 10.4 | 11.0 | - |
| m3-primitives | 108.1 | 108.1 | 27.9 | 27.9 | - |
| m3-react | 41.3 | 41.3 | 23.5 | 23.5 | - |
| m3-reader | 62.8 | 62.8 | 17.2 | 17.2 | 4.6 |
| m3-tailwind | 8.2 | 8.2 | 3.2 | 3.2 | 36.8 |
| m3-theme | 8.0 | 8.0 | 3.6 | 3.6 | 37.5 |
| m3-tokens | 12.5 | 12.5 | 5.2 | 5.2 | 15.5 |
| material-design-icons | 0.6 | 0.8 | 0.4 | 0.5 | - |
| nie-ui | 25.0 | 25.0 | 8.7 | 8.7 | - |
| scaffold | 15.8 | 15.8 | 7.3 | 7.3 | - |
| tauri | - | 0.0 | - | 0.0 | - |
| web | 0.0 | 0.0 | 0.0 | 0.0 | - |
| **total** | 1015.1 | 1105.4 | 353.9 | 397.6 | 1032.4 |

Tests and typecheck: p50 of 3 runs of the package script on a loaded host (`test.pkg.*`, `typecheck.pkg.*`). Differences
come from tests added or fixed by other sessions (m3-baseui, m3-fonts, m3-next, m3-os-themes) and from load.

| package | `bun run test` before | after | `bun run typecheck` before | after |
| --- | ---: | ---: | ---: | ---: |
| ag-ui | 60 ms | 61 ms | 85 ms | 88 ms |
| app | - | - | - | 164 ms |
| assets | 12 ms | 12 ms | 60 ms | 58 ms |
| canvas | 54 ms | 51 ms | 208 ms | 208 ms |
| eslint-plugin-m3 | 187 ms | 215 ms | - | 83 ms |
| identity | 7 ms | 7 ms | 58 ms | 57 ms |
| m3 | 361 ms | 469 ms | 214 ms | 208 ms |
| m3-ai | 2.66 s | 2.67 s | 543 ms | 543 ms |
| m3-baseui | 23 ms | 1.11 s | 304 ms | 474 ms |
| m3-bun | - | 146 ms | - | 105 ms |
| m3-codemods | 2.03 s | 2.16 s | - | 83 ms |
| m3-config | 25 ms | 25 ms | 101 ms | 83 ms |
| m3-design | 24 ms | 24 ms | 102 ms | 85 ms |
| m3-explorer | 213 ms | 218 ms | 517 ms | 493 ms |
| m3-fonts | 8 ms | 88 ms | 78 ms | 79 ms |
| m3-forms | 211 ms | 211 ms | 518 ms | 499 ms |
| m3-front | 107 ms | 117 ms | 207 ms | 205 ms |
| m3-icons | 99 ms | 103 ms | 93 ms | 96 ms |
| m3-mcp | 9 ms | 9 ms | 122 ms | 118 ms |
| m3-motion | 39 ms | 40 ms | 141 ms | 142 ms |
| m3-next | 103 ms | 553 ms | 121 ms | 126 ms |
| m3-next-migrate | 40 ms | 40 ms | 158 ms | 142 ms |
| m3-os-themes | 206 ms | 425 ms | 97 ms | 86 ms |
| m3-primitives | 2.45 s | 2.44 s | 571 ms | 573 ms |
| m3-react | 186 ms | 180 ms | 215 ms | 216 ms |
| m3-reader | 437 ms | 431 ms | 135 ms | 143 ms |
| m3-tailwind | 142 ms | 139 ms | 78 ms | 86 ms |
| m3-theme | 15 ms | 15 ms | 123 ms | 135 ms |
| m3-tokens | 146 ms | 145 ms | 81 ms | 94 ms |
| material-design-icons | - | 12 ms | - | 93 ms |
| nie-ui | - | - | 76 ms | 91 ms |
| scaffold | 55 ms | 53 ms | 81 ms | 92 ms |
| tauri | - | - | - | 200 ms |
| web | - | 154 ms | 111 ms | 125 ms |
| **sum of p50** | 9.97 s | 13.45 s | 5.27 s | 6.31 s |

## Reproduce

```sh
cd ~/aphrody/design/aphrody-m3
bun scripts/bench/run.ts                       # all groups except build, about 3 minutes; --only yolo,mcp,themes,install,test,typecheck,lint,task,bundle,compile
bun scripts/bench/run.ts --repeat 3 --cold-cache --out /tmp/after.json   # what perf-after.json is
bun scripts/bench/run.ts --compare docs/reports/perf-before.json /tmp/after.json
bun run bench:check                            # the budget gate
bun scripts/bench/run.ts --update-budget --baseline docs/reports/perf-before.json   # rewrite the budget from a fresh run
```

YOLO_ROOT (default `~/yolo`) selects the yolo checkout; `BENCH_MCP_SERVER` points the mcp group at another `server.ts`.
