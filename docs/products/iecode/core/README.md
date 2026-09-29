# IECODE core

This directory records the design for converging IECODE on one Rust library crate, `iecode-core`.
It is not a claim that every implementation has already been ported. The repository still has
language owners and compatibility surfaces; this document separates reusable library code from
CLIs, applications, game-specific code and build adapters.

The native contract is the companion `iecode-ffi` crate. Its Bun and .NET
consumers, plus the historical repository audit, are documented in
[FFI-INTEGRATION.md](../../../reference/iecode/core/FFI-INTEGRATION.md).

## Decision

`iecode-core` becomes the canonical domain API. It is a Rust library crate with a typed Rust API
and optional `cdylib`/`staticlib` exports for the shared C ABI. `iecode` remains a thin Rust CLI
binding over that API.

The final Rust shape is one package with feature-gated modules, not one giant always-linked
binary:

```text
crates/core/
  Cargo.toml                 # package iecode-core, lib + cdylib/staticlib
  src/lib.rs                 # public prelude and capability registry
  src/api/                    # versioned request/response contracts
  src/formats/                # pure binary formats and codecs
  src/crypto/                 # bounded, deterministic primitives
  src/archive/                # archive/container readers and writers
  src/assets/                 # asset conversion contracts
  src/geometry/               # POD geometry and scalar math
  src/re/                     # generic binary triage and disassembly
  src/sql/                    # database boundary, feature = sql
  src/tasks/                  # host job orchestration, feature = host
  src/video/                  # frame/video contracts, optional implementation
  src/ffi/                    # C ABI handles, ownership and error mapping
  tests/                      # cross-language parity fixtures
```

`apps/iecode-cli` becomes a binary-only member that depends on `iecode-core`. C++, .NET, Python and Bun
do not become Cargo members: they consume the same versioned C ABI or generated bindings and must
not create a second command tree.

## Non-goals

- Do not copy IEVR/Victory Road game state, UI, launcher or site routes into the portable core.
- Do not expose Rust private layout, C++ classes, C# objects or exceptions across the ABI.
- Do not put tests, command `main` functions, applications, vendored headers or generated files
  under the core library module tree.
- Do not delete an implementation before a non-zero parity fixture proves equivalent behavior.

See [COMPARISON.md](../../../reference/iecode/core/COMPARISON.md) for the measured inventory and [UNIFICATION.md](../../../reference/iecode/core/UNIFICATION.md)
for the migration sequence and ABI rules.
