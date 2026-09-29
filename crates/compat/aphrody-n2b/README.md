<!-- SPDX-License-Identifier: Apache-2.0 -->

# aphrody-n2b

`n2b` is a Node.js to Bun migration analyzer and codemod. It scans a JavaScript or TypeScript
project (sources, `package.json`, lockfiles, `tsconfig`, Dockerfiles, CI workflows and other
configuration files), reports what Bun already supports, what needs a rewrite and what has no
Bun equivalent, and can apply the safe rewrites.

## Install

```sh
cargo install aphrody-n2b      # installs the `n2b` binary
```

The optional `ai` feature (`cargo install aphrody-n2b --features ai`) enables fastembed
crosslinks in `n2b analyze`.

## Usage

```sh
n2b                          # scan the current directory, text report
n2b path/to/project --report json
n2b --fix                    # apply the safe rewrites
n2b --aggressive             # also apply the rewrites marked `aggressive`
n2b --migrate                # --aggressive plus side effects (bun install, rival lockfile
                             # removal, pnpm-workspace.yaml to package.json), with backups
n2b rules --report json      # every rule id, category and docs link
n2b prompt                   # a Markdown migration prompt for an LLM
n2b audit                    # GitHub issues and pull requests mentioning bun/node
```

Reports: `--report text|json|jsonl|md|markdown|sarif`. `--agent` disables colours, logs to
stderr, keeps stdout for the structured payload and switches a text report to JSON. `--ignore
<glob>` excludes paths. Exit codes: `0` clean, `1` findings, `2` error.

Other subcommands: `web` (scripts of a rendered page artifact), `llmstxt` (`llms.txt` generation
through `siteone-crawler`), `analyze`, `patch`, `bunpp`, and the project scaffolders `app`, `bin`,
`win32`, `linux`, `wasm` and `rust`. `n2b --help` lists every flag.

## Library

The crate also exposes `aphrody_n2b::run_from` and `run_from_env`, which run the CLI inside an
embedding process (with an explicit argument iterator, or the process arguments). The scanning
engine lives in [`aphrody-n2b-core`](https://crates.io/crates/aphrody-n2b-core).

## JSON report

The JSON report follows schema v2 (`schema_version: 2`); its Rust types are in
[`aphrody-n2b-types`](https://crates.io/crates/aphrody-n2b-types).

## License

Apache-2.0.
