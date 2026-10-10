<!-- SPDX-License-Identifier: Apache-2.0 -->
# Nushell 0.116.0 on wasm32-unknown-unknown

Measured on 2026-10-02 in the external scratch crate
`/tmp/aphrody-shell-t9-20261002`; no workspace dependency or native
`aphrody-nu` code was changed. The manifest pins `nu-parser`, `nu-engine`
and `nu-command` to `=0.116.0`, each with `default-features = false`, and
re-exports them behind `parser`, `engine` and `command` features respectively.

Each command was run serially through the repository Cargo wrapper:

```sh
scripts/build/rust/cargo-serial.sh check --manifest-path /tmp/aphrody-shell-t9-20261002/Cargo.toml --target wasm32-unknown-unknown --features parser
scripts/build/rust/cargo-serial.sh check --manifest-path /tmp/aphrody-shell-t9-20261002/Cargo.toml --target wasm32-unknown-unknown --features engine
scripts/build/rust/cargo-serial.sh check --manifest-path /tmp/aphrody-shell-t9-20261002/Cargo.toml --target wasm32-unknown-unknown --features command
```

| Feature | Result | Distinct dependency tree lines¹ |
| --- | --- | ---: |
| `parser` | pass | 188 |
| `engine` | pass | 189 |
| `command` | pass | 381 |

¹ `cargo tree --manifest-path /tmp/aphrody-shell-t9-20261002/Cargo.toml --target wasm32-unknown-unknown --features <feature> --prefix none | sort -u | wc -l`. Counts are a dependency cost proxy, not a linked binary size. The command graph contains `nu-system` and `libc` despite default features being off; it does not contain `rusqlite`, `sqlx`, `reqwest` or `ureq`. These are compile checks, not a browser run.

**Decision:** the parser is a viable wasm32 candidate, but defer integration until a concrete grammar requirement exceeds `LocalShell`. The full `nu-command` set is not a VFS-backed browser shell merely because it compiles: filesystem and process commands need a host capability bridge, and the dependency graph is much larger than the current local engine. A follow-up would need a browser execution test, explicit replacement or restriction of OS/network commands, a VFS-backed command set, and bounded output/session behavior. Keep `aphrody-nu` native for now.
