# N2B and Oxc map (Rust and Bun)

Snapshot of 2026-10-02, read from the working tree (uncommitted changes of
other agents included). Evidence is `file:line`. "Unverified" means the fact
was not checked against a build or a run; nothing here was compiled.
Sections 1, 2 and 3 reflect the n2b deduplication of 2026-10-02 (section 6).

## 1. N2B, Rust side

All crates live in `crates/compat/`, inherit versions from the root
`[workspace.dependencies]` and are path members.

| Crate (package name) | Path | Kind | Internal deps | Notable external deps | Features |
|---|---|---|---|---|---|
| `aphrody-n2b` | `crates/compat/n2b` | lib + bin `n2b` (`src/main.rs`) | n2b-core, `aphrody-toolchains` | clap, tokio, octocrab, which, similar, colored; dev: assert_cmd, jsonschema | `default = []`, `ai = ["dep:fastembed"]` |
| `aphrody-n2b-core` | `crates/compat/n2b-core` | lib; modules `ai`, `audit`, `github`, `llmstxt`, `manifest`, `report`, `report_card`, `rules`, `run`, `scanners`, `util` | n2b-types, n2b-registry | **oxc_allocator, oxc_parser, oxc_ast, oxc_ast_visit, oxc_span** (`rules/imports_ast.rs`), serde_yaml, regex, memchr, crossbeam-channel, ignore, globset, url, walkdir, which, reqwest, octocrab, tokio, colored; dev: proptest | `default = []` |
| `aphrody-n2b-registry` | `crates/compat/n2b-registry` | lib; rule tables `registry/{apis,modules,packages,cli,globals}.toml` | n2b-types | toml, regex | none |
| `aphrody-n2b-native` | `crates/compat/n2b-native` | rlib (C ABI exported via `aphrody-ffi`) | n2b-core | memchr; dev: tempfile | none |
| `aphrody-n2b-types` | `crates/compat/n2b-types` | lib (generated `schema.rs` + `types.rs`) | none | serde | none |

Integration tests of n2b-core: `crates/compat/n2b-core/tests/proptest_package_json.rs`, `crates/compat/n2b-core/tests/proptest_source.rs`,
`crates/compat/n2b-core/tests/rules_cli_commands.rs` (was `n2b-rules/tests/cli_commands.rs`), `crates/compat/n2b-core/tests/util_edits.rs`
(was `n2b-util/tests/edits.rs`). n2b keeps `crates/compat/n2b/tests/contract.rs`, `crates/compat/n2b/tests/baselines/`, `tests/fixtures/` (not in repo).

Resolved external versions (Cargo.lock): `fastembed 5.17.3`, `octocrab 0.54.2` (crates.io).

### Consumers of the N2B crates

| Consumer | Evidence | Uses |
|---|---|---|
| `apps/cli` (`aphrody` binary) | `apps/cli/Cargo.toml:130` | `aphrody-n2b`; subcommand `aphrody n2b` = `Commands::N2b` (`crates/infra/aphrody-command/src/lib.rs:521`, dispatch `:1742` -> `commands::N2bCommand`) |
| `apps/cli` package manager | `crates/infra/aphrody-command/src/package_cmd.rs:18,104,107` | `PackageName::N2b`, `cargo_package: Some("n2b")` (the Cargo package is `aphrody-n2b`; whether this resolves is unverified) |
| `crates/ai/mcp` (MCP server) | `crates/ai/mcp/Cargo.toml:146-147` | n2b-core, n2b-types; MCP tool `n2b` (`crates/ai/mcp/src/main.rs:2216-2240`, modes check/fix/migrate, renders with `aphrody_n2b_core::report::render_json`), contract `n2b` in `aphrody_schema` (`main.rs:2182-2187`, `include_str!` of `crates/contracts/schema/v2.json`) |
| `crates/compat/bun-docs` | `crates/compat/bun-docs/Cargo.toml:16` | n2b-registry (Node->Bun equivalents; listed as MCP tool `bun_node_equivalent` in `docs/reference/workspace/TOOLS.md:157`) |
| `crates/interop/ffi` (`aphrody-ffi`) | `crates/interop/ffi/Cargo.toml:53`, `src/lib.rs:65` | re-exports `aphrody_n2b_native::*` |

## 2. N2B, Bun side and tooling

| Package | Path | Version | Workspace deps | Scripts | Tests |
|---|---|---|---|---|---|
| `@aphrody/n2b-core` (dir name `n2b-client`) | `packages/compat/n2b-client` | 0.6.2 | n2b-types | build, start, dev, typecheck, test | `test/binary-resolution.test.ts`, `test/cli.test.ts`, `test/shims.test.ts` |
| `@aphrody/n2b-plugin` | `packages/compat/n2b-plugin` | 0.6.2 | n2b-types, n2b-core | typecheck, test | `test-resolution.test.ts` |
| `@aphrody/n2b-shims` | `packages/compat/n2b-shims` | 0.6.2 | n2b-core | build, typecheck | none (compatibility alias: every entry re-exports `@aphrody/n2b-core/shims*`) |
| `@aphrody/n2b-types` | `packages/compat/n2b-types` | 0.6.2 | none | build, typecheck | none |

No package outside `packages/compat` declares a dependency on `@aphrody/n2b-*`
(grep over `apps/**`, `packages/**` package.json). None declares a `bin`.

Other surfaces:

| Surface | Path |
|---|---|
| Root script | `package.json:290` `"n2b:google": "aphrody n2b packages/google/google"` |
| Skill | `plugins/aphrody/skills/n2b/SKILL.md` |
| Agent | `plugins/aphrody/agents/node2bun.md` |
| Scripts | `scripts/tools/compat/scripts/n2b/{autofix-toolchain.ps1,coverage-daemon.ts,generate-schema-types.ts}`, `scripts/audit/compat/scripts/n2b/coverage-check.ts` |
| Docs | `docs/<category>/compat/n2b/{node,plugin,bun}` (bun: 26 residual files; canonical Bun docs are `docs/<category>/upstream-bun`) |

## 3. Oxc, Rust side

Every Oxc crate is a git dependency on upstream
`https://github.com/oxc-project/oxc.git` rev
`8c5a04ea0d5ca56e0d2d925f51f6b45669aa5e2a`, declared in the root `Cargo.toml`;
Cargo.lock resolves all of them to that rev (34 `oxc*` package entries in
Cargo.lock, including transitive ones).

| Crate | Root Cargo.toml line | Lock version | Direct workspace users |
|---|---|---|---|
| `oxc_allocator` | 232 | 0.152.0 | oxc-bridge, n2b-core, rag-core (opt) |
| `oxc_ast` | 233 | 0.152.0 | n2b-core, rag-core (opt) |
| `oxc_ast_visit` | 353 | 0.152.0 | n2b-core |
| `oxc_codegen` (`default-features = false`) | 40 | 0.152.0 | oxc-bridge |
| `oxc_formatter` | 41 | 0.71.0 | oxc-bridge |
| `oxc_linter` | 42 | 1.86.0 | oxc-bridge |
| `oxc_minifier` | 43 | 0.152.0 | oxc-bridge |
| `oxc_parser` | 234 | 0.152.0 | oxc-bridge, n2b-core, rag-core (opt) |
| `oxc_semantic` | 44 | 0.152.0 | oxc-bridge |
| `oxc_span` | 235 | 0.152.0 | oxc-bridge, n2b-core, rag-core (opt) |

Workspace crates using Oxc:

| Crate | Evidence | Notes |
|---|---|---|
| `aphrody-oxc-bridge` (`crates/compat/oxc-bridge`, rlib, root `Cargo.toml:38`) | `crates/compat/oxc-bridge/Cargo.toml:12-19` | C ABI (`aphrody_oxc_lint`, `aphrody_oxc_free`, ...); 2 `#[test]` |
| `aphrody-n2b-core` | `crates/compat/n2b-core/Cargo.toml:40-44` | AST import scan (`src/rules/imports_ast.rs`) |
| `aphrody-rag-core` | `crates/ai/rag-core/Cargo.toml:15,20,32-35` | feature `oxc` (**default-on**) -> JS/TS chunker `src/jsts_chunker.rs`; off for wasm32 |

Consumers of `aphrody-oxc-bridge`: `crates/interop/ffi/Cargo.toml:54`
(`src/lib.rs:67` re-export) and `crates/discord/aphrody-discord-compiler/Cargo.toml:12`
(`src/lib.rs:246,444`). Consumers of `aphrody-rag-core` (and thus Oxc by default):
`crates/interop/ffi`, `crates/ai/rag-python`, `crates/ai/memory`, `crates/ai/ai`,
`crates/ai/rag-eval`.

## 4. Oxc, Bun side

| Package | Declared | Resolved (bun.lock) | Where |
|---|---|---|---|
| `oxlint` | root catalog `1.86.0` (`package.json:34`), root devDep `catalog:` (`:357`) | `oxlint@1.86.0` (bun.lock:5760) | `catalog:` in `packages/rg/achillea-{types,client,contract,core}` (not in repo), `shenron:packages/pipeline`, `shenron:packages/koharu`, `apps/rg/{website,bot}` (not in repo), `shenron:apps/bot`, `shenron:packages/koharu`; peer `>=1.0.0` in `m3/packages/eslint-plugin-m3/package.json:46` |
| `oxfmt` | root catalog `0.71.0` (`package.json:35`), root devDep `catalog:` (`:356`) | `oxfmt@0.71.0` (bun.lock:5758) | root only in the main workspace |
| `oxc-parser` | not declared by any first-party package.json | `oxc-parser@0.143.0` (bun.lock:5756), transitive, pulled by `@sentry/bundler-plugins@11.1.0` (bun.lock:3440) | - |
| `@oxc-project/types` | not declared | `0.151.0` (bun.lock:2930), required `=0.151.0` by `rolldown@1.2.11` (bun.lock:6156); `oxc-parser` wants `^0.143.0` | - |
| `oxc-transform`, `oxc-minify`, `oxc-resolver` | not declared, not in bun.lock | - | - |

Separate imported workspaces (own lockfiles, not the root catalog):
`config/rg/package.json` (not in repo) (catalog `oxlint ^1.86.0` :47, `oxfmt ^0.71.0` :158) and
`shenron:package.json` (catalog `oxlint ^1.81.0` :28, `oxfmt ^0.66.0` :29,
behind the root pins).

Pins: `config/update/pins.json` tools `oxlint` (targets `package.json`,
`docs/reference/workspace/CLI.md`) and `oxfmt`; `pins check` reports both ok.

Config files (30 found outside `node_modules`/`target`/`.next`): root
`.oxlintrc.json`, `.oxfmtrc.json` (`$schema` from `node_modules/oxlint|oxfmt`);
`config/rg/.oxlintrc.json` (not in repo), `config/rg/.oxfmtrc.json` (not in repo), `iecode/packages/rg/config/oxlintrc.json`,
`m3/packages/eslint-plugin-m3/test/.oxlintrc.json`, and per-package pairs in
`m3/packages/{m3-primitives,assets,m3-theme,m3-explorer,m3-forms,canvas,m3-ai,...}`.

Gates and scripts running them:

| Runner | Evidence |
|---|---|
| Root scripts | `package.json:276` `ai:lint` (`oxlint -c .oxlintrc.json packages/ai/ packages/web/x/`), `:277` `ai:fmt` (`oxfmt ...`) |
| Monorepo gate allow-list | `packages/infra/workspace/src/monorepo-gate.ts:174-175` (accepts `oxlint ...` and `oxfmt --check ...` package scripts) |
| RG ops | `packages/infra/workspace/src/rg.ts:207` (not in repo) (`config/rg/oxfmt.json` (not in repo)) |
| Asset generator | `scripts/build/ui/packages/assets/scripts/generate.ts:104` (`bunx oxfmt`) |
| Agent home tool list | `packages/infra/workspace/src/agent-home.ts:72-73` |

No `.github/workflows` file runs oxlint/oxfmt (grep).

## 5. Stale references to the deleted forks

The forks `aphrody-labs/bun` and `aphrody-labs/oxc` (aliased `aphrody-code/*`)
were deleted on 2026-10-02. `config/bun-fork.json` (not in repo) and `upstream/` do not exist
in the tree. Cargo.lock and bun.lock contain no fork reference.

Live code (behaviour depends on a `bun:aphrody` module that stock Bun lacks):

| File:line | Reference |
|---|---|
| `crates/os/kernel/src/runtimes.rs:23` | probes `require('bun:aphrody').moduleVersion` |
| `packages/compat/n2b-plugin/src/index.ts:79` | specifier `"bun:aphrody"` |
| `packages/interop/native/src/library.ts:293` | owner type `"@aphrody/bun" \| "bun:aphrody"` |
| `packages/interop/native/fixtures/bun-fork-native.ts:18,31` | fixture for `bun:aphrody` |

Current docs that still describe the forks as live:

| File:line | Reference |
|---|---|
| `PLAN.md:169,230` | Bun fork merge, `bun:aphrody` tests |
| `docs/plans/workspace/PLAN.md:75,76,231,368` | `bun:aphrody`, `oxc/apps/aphrody-oxc` |
| `docs/plans/infra/PLAN.md:150` | `bun:aphrody` on Aphrody `main` |
| `docs/reference/infra/UPSTREAMS.md:56,57` | `aphrody-labs/bun`, `aphrody-code/oxc` rows |
| `docs/reference/infra/APHRODY-BUN-PLATFORM.md:13,18,28` | links missing `config/bun-fork.json` (not in repo), `aphrody-labs/oxc` |
| `docs/reference/compat/n2b/BUN-SURFACE.md:5,36` | `bun:aphrody` API |
| `docs/reference/compat/BUN-RUST-INTEGRATION.md:14` | fork's `bun:aphrody` |
| `docs/reference/web/WEB-RUNTIME.md:144` | fork `bun/`, `bun:aphrody` |
| `docs/reference/workspace/DEPS-INVENTORY.md:196` | `aphrody-code/oxc` pinned `31d5266e150f` |
| `docs/reference/upstream-bun/APHRODY-FORK.md:3,11,15,18` | fork procedure |
| `docs/products/upstream-bun/README.md:5` | fork README |
| `docs/products/upstream-oxc/apps/aphrody-oxc/README.md:3` | fork cdylib README |
| `crates/compat/oxc-bridge/README.md:4` | origin `oxc/apps/aphrody-oxc` (provenance; correct as history) |
| `docs/migration/BUN-FORK-UNIFIED-NATIVE.md:8,12,13,17,51,99` | fork commits, PR, CI run |

Already updated to say the fork was deleted: `docs/operations/infra/update/BUN.md:7,102`,
`docs/operations/infra/UPDATE.md:93`, `docs/research/infra/github-mirrors-audit-2026-10-02.md:65`.

Historical evidence (dated logs/JSON, keep as record): `inventory/2026-09-30-{bun,oxc}-transfer.json`,
`docs/operations/**/2026-10-01*/*.{log,json}` (rev `31d5266e...` on `aphrody-code/oxc`),
`docs/migration/n2b-qualification-2026-10-01/*.log`, `docs/migration/source-map.json`,
`docs/migration/{unified-ui-ffi,native-rust-extraction}.json`, `docs/migration/IMPORTED-DOCS-INDEX.md`,
`docs/plans/2026-09-29-consolidation-initial-archive.md` (not in repo),
`docs/research/os/low-level-audit-2026-10-01/{bun-chaine,abi}.md`,
`shenron:apps/bot/dist/shenron.map` (build output).

## 6. N2B deduplication (2026-10-02)

Nothing below was compiled: Cargo is run only by the integrating agent. Bun gates were run.

### Before / after

| Measure | Before (HEAD `c7d6863aa`) | After (working tree) |
|---|---|---|
| Rust crates `crates/compat/n2b*` | 11 | 5 (`n2b`, `n2b-core`, `n2b-native`, `n2b-registry`, `n2b-types`) |
| Files in `crates/compat/n2b*` | 122 | 111 |
| Lines, all files in `crates/compat/n2b*` | 30,111 | 29,738 |
| Lines, `*.rs` in `crates/compat/n2b*` | 21,723 | 21,724 (code moved, not rewritten; see below) |
| Bun packages `packages/compat/n2b-*` | 4 | 4 (`n2b-shims` is now a 5-file re-export alias) |
| Lines, `*.ts` in `packages/compat` | 1,081 | 1,102 |
| Files under `docs/*/compat/n2b/` | 423 | 114 |
| Lines under `docs/*/compat/n2b/` | 195,911 | 151,861 |
| n2b scripts (`scripts/{tools,audit}/compat/scripts/n2b`) | 12 files, 1,059 lines | 4 files, 612 lines |
| `[workspace.dependencies]` n2b entries | 11 | 5 |

### What moved where

| Before | After | Alias / contract kept |
|---|---|---|
| crates `aphrody-n2b-{ai,github,util,report,rules,scanners}` (no consumer outside n2b except mcp -> report) | modules `aphrody_n2b_core::{ai,github,util,report,rules,scanners}` (`crates/compat/n2b-core/src/<name>/`) | same public paths `aphrody_n2b_core::<name>` that n2b-core already re-exported; none of the six crates is on crates.io (API 404) |
| `aphrody_n2b_report::render_json` in `crates/ai/mcp/src/main.rs` | `aphrody_n2b_core::report::render_json` | MCP tool `n2b` unchanged |
| private `write` + `which` copies in `n2b/src/{app,linux,wasm,win32}_cmd.rs` | `crates/compat/n2b/src/scaffold_fs.rs` (`write_tagged`, `which`) | output and log tags unchanged |
| `@aphrody/n2b-shims` sources | `@aphrody/n2b-core/shims{,/env,/fs,/path,/shell}` (`packages/compat/n2b-client/src/shims/`) | `@aphrody/n2b-shims` 0.6.2 is published on npm: the package stays as a re-export alias |
| 309 Bun doc files in `docs/*/compat/n2b/bun/` | `docs/*/upstream-bun/` | per-file aliases + SHA-256 in `docs/migration/n2b-dedup-2026-10-02.json` |
| `docs/apis/contracts/v2.json` (not in repo) | `crates/contracts/schema/v2.json` | `include_str!` in mcp repointed; alias recorded in the same JSON |
| Node-to-Bun mapping list in `plugins/aphrody/skills/n2b/SKILL.md` | pointer to `crates/compat/n2b-registry/registry/*.toml`, `aphrody n2b rules`, MCP `bun_node_equivalent` | skill name and triggers unchanged |
| `update-bun-docs.{sh,ps1}`, `n2b-env.{sh,ps1}`, `refactor-{start,state}.{sh,ps1}` | deleted | `yolo ops bun-upstream-docs` remains the Bun-docs entry point |

Kept on purpose: `n2b-types` (consumed by mcp and imported by `@aphrody/n2b-plugin`, and
`n2b-registry` depends on it), `n2b-registry` (consumed by `bun-docs`, which must not pull n2b-core's
Oxc, reqwest and octocrab tree), `n2b-native` (re-exported by `aphrody-ffi`).
