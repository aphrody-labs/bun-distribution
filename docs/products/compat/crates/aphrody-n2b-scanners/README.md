<!-- SPDX-License-Identifier: Apache-2.0 -->

# aphrody-n2b-scanners

Project-file scanners of [n2b](https://crates.io/crates/aphrody-n2b), the Node.js to Bun migration
analyzer. Each scanner takes a path and the file content and returns the findings plus the
rewritten content (`(Vec<Finding>, String)`).

Covered files: `package.json`, `bunfig.toml`, `tsconfig.json`, `turbo.json`, `components.json`,
`next.config.*` and other JavaScript configs, `.npmrc` and other rc files, `.nvmrc`,
`pnpm-workspace.yaml`, rival lockfiles, `.env*`, Dockerfiles, Compose files, `Procfile`, shell
scripts and shebangs, Husky hooks, GitHub Actions workflows, `tauri.conf.json`, `Cargo.toml`, and
JavaScript/TypeScript sources (through
[`aphrody-n2b-rules`](https://crates.io/crates/aphrody-n2b-rules)).

## Install

```toml
[dependencies]
aphrody-n2b-scanners = "0.6.2"
```

## Example

```rust
use aphrody_n2b_scanners::nvmrc::scan_nvmrc;

let (findings, _rewritten) = scan_nvmrc(".nvmrc", "20\n");
assert!(!findings.is_empty());
```

## License

Apache-2.0.
