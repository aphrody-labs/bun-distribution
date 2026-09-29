<!-- SPDX-License-Identifier: Apache-2.0 -->

# aphrody-n2b-registry

The data-driven rule registry of [n2b](https://crates.io/crates/aphrody-n2b), the Node.js to Bun
migration analyzer. Five TOML files shipped in the crate (`registry/apis.toml`, `modules.toml`,
`packages.toml`, `cli.toml`, `globals.toml`) are embedded with `include_str!`, then parsed and
validated on first access:

- `APIS`: Node.js APIs and their Bun rewrites (`ApiEntry`, `Rewrite`, `ReplaceKind`);
- `MODULES`: Node.js built-in modules and their Bun compatibility (`ModuleEntry`, `Compat`);
- `PACKAGES`: npm packages with a Bun-native replacement (`PackageEntry`, `PackageStrategy`);
- `CLI`: `node`, `npm`, `npx`, `yarn` and `pnpm` commands and their `bun` equivalents
  (`CliEntry`);
- `GLOBALS`: Node.js globals (`GlobalEntry`, `GlobalContext`).

`ImportGraph` and `ImportBinding` describe the imports of a file so rules only match a symbol
that is really imported from the expected module; `derive_severity` maps a module's `Compat`
status to a finding `Severity`.

## Install

```toml
[dependencies]
aphrody-n2b-registry = "0.6.2"
```

## Example

```rust
use aphrody_n2b_registry::{APIS, MODULES};

assert!(!APIS.is_empty());
assert!(!MODULES.is_empty());
```

## License

Apache-2.0.
