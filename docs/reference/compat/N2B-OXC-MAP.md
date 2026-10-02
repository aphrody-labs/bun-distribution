# N2B and Oxc map (Rust and Bun)

Snapshot of 2026-10-02, read from the working tree (uncommitted changes of
other agents included). Evidence is `file:line`. "Unverified" means the fact
was not checked against a build or a run; nothing here was compiled.

## 1. N2B, Rust side

All crates live in `crates/compat/`, inherit versions from the root
`[workspace.dependencies]` and are path members.

| Crate (package name) | Path | Kind | Internal deps | Notable external deps | Features | `#[test]` count* | Integration tests |
|---|---|---|---|---|---|---|---|
| `aphrody-n2b` | `crates/compat/n2b` | lib + bin `n2b` (`src/main.rs`, Cargo.toml:16) | n2b-core, `aphrody-toolchains` | clap, tokio, octocrab, which, similar, colored; dev: assert_cmd, jsonschema | `default = []`, `ai = ["dep:fastembed"]` | 21 | `tests/contract.rs`, `tests/baselines/`, `tests/fixtures/` |
| `aphrody-n2b-core` | `crates/compat/n2b-core` | lib | n2b-types, -util, -ai, -github, -report, -rules, -scanners | serde_yaml, regex, memchr, crossbeam-channel, ignore, globset, url, walkdir, which, reqwest, octocrab, tokio; dev: proptest | `default = []` | 19 | `tests/proptest_package_json.rs`, `tests/proptest_source.rs` |
| `aphrody-n2b-rules` | `crates/compat/n2b-rules` | lib | n2b-types, -util, -registry | **oxc_allocator, oxc_parser, oxc_ast, oxc_ast_visit, oxc_span** (Cargo.toml:27-31; used in `src/imports_ast.rs`) | none | 12 | `tests/cli_commands.rs` |
| `aphrody-n2b-scanners` | `crates/compat/n2b-scanners` | lib | n2b-types, -util, -rules | serde_yaml, regex | none | 17 | none |
| `aphrody-n2b-registry` | `crates/compat/n2b-registry` | lib | n2b-types | toml, regex | none | 8 | none |
| `aphrody-n2b-report` | `crates/compat/n2b-report` | lib | n2b-types, -ai, -util | colored | none | 0 | none |
| `aphrody-n2b-util` | `crates/compat/n2b-util` | lib | n2b-types | memchr | none | 7 | `tests/edits.rs` |
| `aphrody-n2b-native` | `crates/compat/n2b-native` | rlib (C ABI exported via `aphrody-ffi`) | n2b-core | memchr; dev: tempfile | none | 3 | none |
| `aphrody-n2b-github` | `crates/compat/n2b-github` | lib | none | octocrab | none | 0 | none |
| `aphrody-n2b-ai` | `crates/compat/n2b-ai` | lib | none | serde | none | 0 | none |
| `aphrody-n2b-types` | `crates/compat/n2b-types` | lib | none | serde | none | 0 | none |

\* `grep -c '#[test]'` over `src/` and `tests/`; proptest and async tests may be undercounted.

Resolved external versions (Cargo.lock): `fastembed 5.17.3`, `octocrab 0.54.2` (crates.io).

### Consumers of the N2B crates

| Consumer | Evidence | Uses |
|---|---|---|
| `apps/cli` (`aphrody` binary) | `apps/cli/Cargo.toml:130` | `aphrody-n2b`; subcommand `aphrody n2b` = `Commands::N2b` (`apps/cli/src/lib.rs:521`, dispatch `:1742` -> `commands::N2bCommand`) |
| `apps/cli` package manager | `apps/cli/src/package_cmd.rs:18,104,107` | `PackageName::N2b`, `cargo_package: Some("n2b")` (the Cargo package is `aphrody-n2b`; whether this resolves is unverified) |
| `crates/ai/mcp` (MCP server) | `crates/ai/mcp/Cargo.toml:146-148` | n2b-core, n2b-report, n2b-types; MCP tool `n2b` (`crates/ai/mcp/src/main.rs:2216-2227`, modes check/fix/migrate), contract `n2b` in `aphrody_schema` (`main.rs:2182-2207`) |
| `crates/compat/bun-docs` | `crates/compat/bun-docs/Cargo.toml:16` | n2b-registry (Node->Bun equivalents; listed as MCP tool `bun_node_equivalent` in `docs/reference/workspace/TOOLS.md:157`) |
| `crates/interop/ffi` (`aphrody-ffi`) | `crates/interop/ffi/Cargo.toml:53`, `src/lib.rs:65` | re-exports `aphrody_n2b_native::*` |

## 2. N2B, Bun side and tooling

| Package | Path | Version | Workspace deps | Scripts | Tests |
|---|---|---|---|---|---|
| `@aphrody/n2b-core` (dir name `n2b-client`) | `packages/compat/n2b-client` | 0.6.2 | n2b-types, n2b-shims | build, start, dev, typecheck, test | `test/binary-resolution.test.ts`, `test/cli.test.ts`, `test/shims.test.ts` |
| `@aphrody/n2b-plugin` | `packages/compat/n2b-plugin` | 0.6.2 | n2b-types, n2b-core | typecheck, test | `test-resolution.test.ts` |
| `@aphrody/n2b-shims` | `packages/compat/n2b-shims` | 0.6.2 | none | build, typecheck | none |
| `@aphrody/n2b-types` | `packages/compat/n2b-types` | 0.6.2 | none | build, typecheck | none |

No package outside `packages/compat` declares a dependency on `@aphrody/n2b-*`
(grep over `apps/**`, `packages/**` package.json). None declares a `bin`.

Other surfaces:

| Surface | Path |
|---|---|
| Root script | `package.json:290` `"n2b:google": "aphrody n2b packages/google/google"` |
| Skill | `plugins/aphrody/skills/n2b/SKILL.md` |
| Agent | `plugins/aphrody/agents/node2bun.md` |
| Scripts | `scripts/tools/compat/scripts/n2b/{n2b-env.sh,n2b-env.ps1,refactor-start.sh,refactor-start.ps1,autofix-toolchain.ps1,coverage-daemon.ts,generate-schema-types.ts}`, `scripts/audit/compat/scripts/n2b/coverage-check.ts` |

## 3. Oxc, Rust side

Every Oxc crate is a git dependency on upstream
`https://github.com/oxc-project/oxc.git` rev
`8c5a04ea0d5ca56e0d2d925f51f6b45669aa5e2a`, declared in the root `Cargo.toml`;
Cargo.lock resolves all of them to that rev (34 `oxc*` package entries in
Cargo.lock, including transitive ones).

| Crate | Root Cargo.toml line | Lock version | Direct workspace users |
|---|---|---|---|
| `oxc_allocator` | 232 | 0.152.0 | oxc-bridge, n2b-rules, rag-core (opt) |
| `oxc_ast` | 233 | 0.152.0 | n2b-rules, rag-core (opt) |
| `oxc_ast_visit` | 353 | 0.152.0 | n2b-rules |
| `oxc_codegen` (`default-features = false`) | 40 | 0.152.0 | oxc-bridge |
| `oxc_formatter` | 41 | 0.71.0 | oxc-bridge |
| `oxc_linter` | 42 | 1.86.0 | oxc-bridge |
| `oxc_minifier` | 43 | 0.152.0 | oxc-bridge |
| `oxc_parser` | 234 | 0.152.0 | oxc-bridge, n2b-rules, rag-core (opt) |
| `oxc_semantic` | 44 | 0.152.0 | oxc-bridge |
| `oxc_span` | 235 | 0.152.0 | oxc-bridge, n2b-rules, rag-core (opt) |

Workspace crates using Oxc:

| Crate | Evidence | Notes |
|---|---|---|
| `aphrody-oxc-bridge` (`crates/compat/oxc-bridge`, rlib, root `Cargo.toml:38`) | `crates/compat/oxc-bridge/Cargo.toml:12-19` | C ABI (`aphrody_oxc_lint`, `aphrody_oxc_free`, ...); 2 `#[test]` |
| `aphrody-n2b-rules` | `crates/compat/n2b-rules/Cargo.toml:27-31` | AST import scan |
| `aphrody-rag-core` | `crates/ai/rag-core/Cargo.toml:15,20,32-35` | feature `oxc` (**default-on**) -> JS/TS chunker `src/jsts_chunker.rs`; off for wasm32 |

Consumers of `aphrody-oxc-bridge`: `crates/interop/ffi/Cargo.toml:54`
(`src/lib.rs:67` re-export) and `crates/discord/aphrody-discord-compiler/Cargo.toml:12`
(`src/lib.rs:246,444`). Consumers of `aphrody-rag-core` (and thus Oxc by default):
`crates/interop/ffi`, `crates/ai/rag-python`, `crates/ai/memory`, `crates/ai/ai`,
`crates/ai/rag-eval`.

## 4. Oxc, Bun side

| Package | Declared | Resolved (bun.lock) | Where |
|---|---|---|---|
| `oxlint` | root catalog `1.86.0` (`package.json:34`), root devDep `catalog:` (`:357`) | `oxlint@1.86.0` (bun.lock:5760) | `catalog:` in `packages/rg/achillea-{types,client,contract,core}`, `packages/shenron/pipeline`, `packages/koharu/bridge`, `apps/rg/{website,bot}`, `apps/shenron/bot`, `apps/koharu/editor`; peer `>=1.0.0` in `packages/ui/eslint-plugin-m3/package.json:46` |
| `oxfmt` | root catalog `0.71.0` (`package.json:35`), root devDep `catalog:` (`:356`) | `oxfmt@0.71.0` (bun.lock:5758) | root only in the main workspace |
| `oxc-parser` | not declared by any first-party package.json | `oxc-parser@0.143.0` (bun.lock:5756), transitive, pulled by `@sentry/bundler-plugins@11.1.0` (bun.lock:3440) | - |
| `@oxc-project/types` | not declared | `0.151.0` (bun.lock:2930), required `=0.151.0` by `rolldown@1.2.11` (bun.lock:6156); `oxc-parser` wants `^0.143.0` | - |
| `oxc-transform`, `oxc-minify`, `oxc-resolver` | not declared, not in bun.lock | - | - |

Separate imported workspaces (own lockfiles, not the root catalog):
`config/rg/package.json` (catalog `oxlint ^1.86.0` :47, `oxfmt ^0.71.0` :158) and
`config/shenron/package.json` (catalog `oxlint ^1.81.0` :28, `oxfmt ^0.66.0` :29,
behind the root pins).

Pins: `config/update/pins.json` tools `oxlint` (targets `package.json`,
`docs/reference/workspace/CLI.md`) and `oxfmt`; `pins check` reports both ok.

Config files (30 found outside `node_modules`/`target`/`.next`): root
`.oxlintrc.json`, `.oxfmtrc.json` (`$schema` from `node_modules/oxlint|oxfmt`);
`config/rg/.oxlintrc.json`, `config/rg/.oxfmtrc.json`, `config/shenron/.oxlintrc.json`,
`config/shenron/.oxfmtrc.json`, `packages/rg/config/oxlintrc.json`,
`packages/ui/eslint-plugin-m3/test/.oxlintrc.json`, and per-package pairs in
`packages/ui/{m3-primitives,assets,m3-theme,m3-explorer,m3-forms,canvas,m3-ai,...}`.

Gates and scripts running them:

| Runner | Evidence |
|---|---|
| Root scripts | `package.json:276` `ai:lint` (`oxlint -c .oxlintrc.json packages/ai/ packages/web/x/`), `:277` `ai:fmt` (`oxfmt ...`) |
| Monorepo gate allow-list | `packages/infra/workspace/src/monorepo-gate.ts:174-175` (accepts `oxlint ...` and `oxfmt --check ...` package scripts) |
| RG ops | `packages/infra/workspace/src/rg.ts:207` (`config/rg/oxfmt.json`) |
| Asset generator | `scripts/build/ui/packages/assets/scripts/generate.ts:104` (`bunx oxfmt`) |
| Agent home tool list | `packages/infra/workspace/src/agent-home.ts:72-73` |

No `.github/workflows` file runs oxlint/oxfmt (grep).

## 5. Stale references to the deleted forks

The forks `aphrody-labs/bun` and `aphrody-labs/oxc` (aliased `aphrody-code/*`)
were deleted on 2026-10-02. `config/bun-fork.json` and `upstream/` do not exist
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
| `docs/reference/infra/APHRODY-BUN-PLATFORM.md:13,18,28` | links missing `config/bun-fork.json`, `aphrody-labs/oxc` |
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
`docs/plans/2026-09-29-consolidation-initial-archive.md`,
`docs/research/os/low-level-audit-2026-10-01/{bun-chaine,abi}.md`,
`apps/shenron/bot/dist/shenron.map` (build output).
