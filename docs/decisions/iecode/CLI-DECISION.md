# IECODE CLI decision

## Decision

Rust owns the single canonical CLI: package `iecode-cli`, binary `iecode`.

The other languages are library owners or bindings, never competing command trees:

| Surface | Strength | Boundary decision |
| --- | --- | --- |
| Rust | broadest existing command coverage, shared libraries, clap, FFI and native/Wasm portability | canonical CLI and orchestration layer |
| C#/.NET 10 | strongest existing format/editor domain implementation and Windows integration | `IECODE.Core` library owner; `IECODE.Cli` is the single binding and `IECODE.Gui` the single desktop host |
| C++/CMake/vcpkg | broad native format/modding implementation and direct native performance | `iecode_core` backend and C ABI exports; no second user-facing CLI |
| Python/uv | useful extraction, mapping and research scripts; several independent tools | one uv tool workspace; callable libraries/adapters, no second CLI |
| Bun/Turborepo | excellent package tests, media adapters and Rust FFI consumption | package/API/FFI bindings; no command ownership |

Rust wins because the CLI can call the Rust domain libraries directly, expose one JSON contract,
and attach C/C++/.NET/Python/Bun through explicit FFI adapters. A subprocess chain would create
multiple error models, duplicate discovery and incompatible output. The first migration step is
therefore a thin Rust command router, followed by extracting each foreign implementation into a
library boundary and adding parity fixtures before removing compatibility commands.

The deeper core decision and measured source comparison are maintained in
[`docs/core/README.md`](../../products/iecode/core/README.md), [`docs/core/COMPARISON.md`](../../reference/iecode/core/COMPARISON.md) and
[`docs/core/UNIFICATION.md`](../../reference/iecode/core/UNIFICATION.md).

## Stable command groups

- `iecode doctor`: validate the unified manifests and ownership graph.
- `iecode emu list`: list the canonical emulator capability registry.
- `iecode version`: print the CLI/schema versions.

All commands accept `--json` for automation. `doctor` accepts `--workspace DIR` or the
`IECODE_WORKSPACE` environment variable and otherwise inspects the current directory. Human
output stays on stdout; failures go to stderr and return exit code `2`. JSON failures use the
`iecode.cli/v1` envelope with an `error.code` and `error.message`, so scripts do not need to
parse prose. `--quiet` and `-v`/`--verbose` are reserved global switches and are already parsed
at the boundary for forward-compatible diagnostics.

Format, archive, model, texture, save, mod, extraction and Python research commands are added
only after their library owner exposes a typed Rust/FFI function and a round-trip test. Existing
C# and C++ command trees remain callable during migration, but are not registered as additional
top-level CLIs.

## Migration order

1. Rust router and JSON envelope.
2. C# implementation extraction into `IECODE.Core` interfaces and generated FFI.
3. C++ `iecode_core` C ABI and Rust binding tests.
4. Python functions moved behind typed uv package APIs.
5. Bun adapters consume the same JSON/FFI schema.
6. Compatibility command binaries removed only after parity counts are non-zero and equal.

The initial production gate is deliberately small and measurable: `cargo fmt --all -- --check`,
`cargo clippy -p iecode-cli --all-targets -- -D warnings`, the CLI unit/contract tests, and JSON
smoke tests for `version`, `doctor`, `emu list`, plus a failing `doctor` invocation. A green
router does not claim that C#, C++ or Python commands have already been migrated; each remains
blocked on its typed library boundary and parity fixture.
