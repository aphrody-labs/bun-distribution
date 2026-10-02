<!-- SPDX-License-Identifier: Apache-2.0 -->
# N2B surface used with Bun

This inventory follows the current manifests and source. It separates the full
N2B product from the smaller in-process API exposed by `bun:aphrody`.

## Rust crates

| Crate | Current role |
| --- | --- |
| `aphrody-n2b` | CLI, migration modes, scaffolding, web artifact and analysis commands |
| `aphrody-n2b-ai` | report enrichment and prompt context |
| `aphrody-n2b-core` | orchestration, manifest, audit, reports and public re-exports |
| `aphrody-n2b-github` | GitHub issue and PR audit |
| `aphrody-n2b-native` | C ABI v2 for Bun FFI; separately versioned at 0.2.0 |
| `aphrody-n2b-registry` | module, API, CLI and package compatibility registries |
| `aphrody-n2b-report` | text, JSON, JSONL, Markdown and SARIF rendering |
| `aphrody-n2b-rules` | import, CLI and Bun API rules; uses Oxc AST crates |
| `aphrody-n2b-scanners` | source, lockfile, package, configuration, workflow and container scanners |
| `aphrody-n2b-types` | Rust findings, run options and generated report schema types |
| `aphrody-n2b-util` | text offsets and edit helpers |

The first, second, third, fourth, sixth through eleventh crates are at 0.6.2
in their manifests. The native crate is independently versioned.

## Bun packages

| Package | Exports |
| --- | --- |
| `@aphrody/n2b-core` | `scan`, `rules`, `promptMarkdown`, `binaryVersion`; `./cli`; shims `./shims`, `./shims/env`, `./shims/fs`, `./shims/path`, `./shims/shell` (formerly `@aphrody/n2b-shims`, merged 2026-10-02) |
| `@aphrody/n2b-plugin` | `n2bPlugin()` for `Bun.plugin()`/build findings; native fork scan with CLI fallback |
| `@aphrody/n2b-shims` | compatibility alias (published 0.6.2 on npm): root, `./env`, `./fs`, `./path`, `./shell` re-export `@aphrody/n2b-core/shims*` |
| `@aphrody/n2b-types` | generated report types from Contracts JSON schema v2 |

All four package manifests currently declare version 0.6.2. The plugin scans
once per build with `bun:aphrody` when available, or invokes the Rust CLI when
using installed Bun, when the native library is unavailable, or when a custom
binary/working directory is requested. It is a build plugin.
`native: "required"` surfaces import or ABI failures; `native: "off"` forces
the CLI. The default `"auto"` falls back and reports a native scan failure.

## Contracts and command surface

- `crates/contracts/schema/v2.json` is the report contract. Its generated
  TypeScript `N2BReport` contains schema version 2, tool, version, mode, root,
  file count, finding count and files. Findings carry rule IDs, severity,
  confidence, byte ranges, replacement, autofix flags, context and optional
  compatibility metadata.
- `crates/contracts/schema/n2b.schema.json` describes the `n2b` manifest.
  Rust manifest loading and rule overrides live in `aphrody-n2b-core/manifest.rs`.
- `aphrody-n2b/src/cli/args.rs` owns the complete CLI. Root scan accepts
  `--fix`, `--aggressive`, `--migrate`, `--scaffold-polyfills`, `--report`,
  repeated `--ignore`, `--quiet` and `--agent`. Report formats are text, JSON,
  JSONL, md/markdown and SARIF. The command enum also includes `rules`, `web`,
  `prompt`, `audit`, `app`, `win32`, `linux`, `wasm`, `bin`, `patch`, `bunpp`,
  `llmstxt`, `rust` and `analyze`, each with its own arguments in that source.
- The in-process ABI currently covers the scanner only: no CLI scaffolding,
  GitHub audit, `--migrate` side effects, prompt generation or rules listing.
  `node2bun_scan_json` is read-only. `node2bun_scan_with_options_json` accepts
  JSON `mode` (`check`, `fix`, `aggressive`), `ignore` globs and `dry_run`.
  Fix and aggressive can write files unless `dry_run=true`. This boundary
  returns the JSON v2 report and uses `node2bun_string_free` for ownership.

## Oxc dependency boundary

`aphrody-n2b-rules` depends on `oxc_allocator`, `oxc_ast`, `oxc_ast_visit`,
`oxc_parser` and `oxc_span` pinned to commit
`3369b5f993a5eb889c14e4a0efe9e258664c4ef5` of the Aphrody Oxc fork.
The fork incorporates upstream Oxc `0.152.0` crates and has a separate
format/minify/lint C ABI for Bun. The AST migration changes exported variable
declarations from `ExportNamedDeclaration.declaration` to
`ExportDeclaration.declaration`. Bun's own parser, builder and test runner
remain separate implementations today.
