<!-- SPDX-License-Identifier: Apache-2.0 -->
# Shell pipeline qualification — 2026-10-02

`@aphrody/shell-web` now declares four real package gates. Its `build` command
uses the existing WASM release builder and serialized Cargo wrapper; `lint`
uses Oxlint on `src` and `test`. The regenerated `config/pipeline.json` contains
a `bun-shell` stage after OS with lint, typecheck, test and build steps. A fresh
`pipelineCatalog()` result matched the committed JSON exactly: 17 stages and
231 steps. The catalog still reports missing gates in 74 other packages, so
this is not a green monorepo-wide pipeline verdict.

Scoped commands and results:

The [machine report](shell-pipeline-2026-10-02/report.json) records each command,
exit code, duration and SHA256 of its full log; the adjacent `build.log`,
`lint.log`, `typecheck.log` and `test.log` retain the command output.

| Command | Result | Coverage |
| --- | --- | --- |
| `bun run build` in `packages/shell/web` | exit 0 | `aphrody-shell-web` wasm32 release and `wasm-bindgen` output |
| `bun run lint` | exit 0 | Oxlint applied to `src` and `test`; existing warnings remain |
| `bun run typecheck` and root filtered typecheck | exit 0 | package `tsconfig.json` |
| `bun test` | exit 0 | 7 passed; 3 live/browser/OPFS tests skipped by their environment gates |
| `oxfmt --check package.json` | exit 0 | changed manifest |
| frozen Bun install dry run | exit 0 | root lockfile resolution; no install scripts |

The combined Shell check, including the browser and Tauri e2e paths, has
separate evidence in [Shell status](../../products/shell/STATUS.md). The live
E2B provider conformance and exact Tauri screenshot/DOM gate remain open.
