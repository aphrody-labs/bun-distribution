<!-- SPDX-License-Identifier: Apache-2.0 -->
# IECODE Rust readiness

Audit date: 2026-09-29

Source checkout: `../iecode` at `8fdab4b96014f70972c2855878cab49510ffe876` (`Route IECODE gates through new Aphrody workspace`)

Target checkout: `<repo>`

This is a read-only assessment of the current IECODE Rust manifests and public
crate boundaries. It does not import code or change either Cargo workspace.

## Recommendation

Integrate **`iecode-geom` alone** as the first Rust tranche, under
`crates/iecode/geom`. It is an independently useful, pure geometry library
(`Vec2`/`Vec3` and scalar math) whose normal dependency tree is empty. Its
`serde` support is optional, and its `std` feature is separately optional.
The source declares `#![cfg_attr(not(feature = "std"), no_std)]` and
`#![forbid(unsafe_code)]`.

The package is materially safer to import than `iecode-core`: the latter is a
facade that directly depends on all seven current leaves (`emu`, `geom`,
`pipeline`, `re`, `sql`, `tasks`, `video`). `iecode-ffi` directly depends on
that facade, so it also pulls the entire graph and a stable C ABI boundary.

## Measured compilation evidence

All commands below ran from `../iecode` with a temporary target
folder, so no source or Cargo manifest was changed.

```text
CARGO_TARGET_DIR=/tmp/iecode-rust-readiness-target \
  cargo check --locked -p iecode-geom
# Finished dev profile successfully

CARGO_TARGET_DIR=/tmp/iecode-rust-readiness-target \
  cargo check --locked -p iecode-geom --no-default-features
# Finished dev profile successfully

CARGO_TARGET_DIR=/tmp/iecode-rust-readiness-target \
  cargo check --locked -p iecode-geom --no-default-features \
  --target wasm32-unknown-unknown
# Finished dev profile successfully

CARGO_TARGET_DIR=/tmp/iecode-rust-readiness-target \
  cargo test --locked -p iecode-geom
# 9 passed; 0 failed; 0 ignored

cargo tree --locked -p iecode-geom --edges normal
# iecode-geom v1.0.0 (.../crates/geom)
```

The source workspace uses resolver `3`, Rust edition `2024`, and
`rust-version = 1.97`. The target workspace currently uses the same resolver,
edition, and Rust version, so there is no toolchain version mismatch for this
first tranche.

## Crate boundary comparison

| Crate | Direct normal dependencies | Boundary | First-import decision |
| --- | --- | --- | --- |
| `iecode-geom` | none by default; optional `serde` | Pure values/math; `no_std` without `std`; unsafe forbidden | Import first |
| `iecode-video` | `thiserror` | Starts `ffmpeg` through `std::process`; host tool dependency | Keep separate from first tranche |
| `iecode-emu` | `serde` | Static emulator capability registry plus host-oriented `headless` module | Import after the contract owner is selected |
| `iecode-pipeline` | `serde`, `serde_json`, `thiserror` | Serializable pipeline schema and validation | Suitable second tranche with a schema/API owner |
| `iecode-tasks` | `serde`, `serde_json`, `thiserror`; default `host` adds Tokio, UUID, tracing and async-trait | Host job orchestration | Defer until runtime ownership is established |
| `iecode-re` | `goblin`, `iced-x86`, `zerocopy`, hashing and serialization stack | Binary triage/disassembly surface | Defer; materially larger dependency graph |
| `iecode-sql` | bundled SQLite, Tokio/Postgres/Rustls stack | Database/transport boundary | Defer; native build and service configuration surface |
| `iecode-ievr-data` | `serde_json` with `alloc`; optional `serde` | Game-specific no-std data models; already staged in target | Keep its separate rights and data review |
| `iecode-core` | all seven leaf crates | Unconditional facade/re-export graph | Do not use as a first import |
| `iecode-ffi` | `iecode-core`, `serde_json`; `cdylib` and `rlib` | C ABI `iecode.ffi/v1`, raw allocation ownership | Do not import before the core graph is accepted |
| `iecode-cli` | `iecode-core`, Clap, serialization | End-user executable | Defer with `core` |

`iecode-video` has a small Rust tree (`thiserror` and its proc-macro tree),
but it is not a portable foundational crate: its API owns an `ffmpeg`
subprocess and filesystem output. That operational dependency makes
`iecode-geom` the smaller *integration* slice despite `video` having few
direct crates.

## Manifest and workspace coupling

Every candidate package uses inherited package metadata, including
`version.workspace`, `edition.workspace`, `rust-version.workspace`, and
`repository.workspace`; most also use `publish.workspace`. `iecode-geom` also
uses `serde = { workspace = true, optional = true, features = ["derive"] }`.
It therefore cannot be copied as an isolated manifest without choosing how the
target workspace supplies that metadata and dependency declaration.

The target already supplies compatible resolver, edition, Rust version, lints,
`serde`, and `thiserror` workspace entries. Before an actual import, preserve
the source path and commit in the generated migration map, then copy the
crate rather than registering `../iecode` as a permanent path
member. A source-external path member would keep the target build dependent on
the developer checkout and would not satisfy the target repository's
self-contained workspace rule.

The first import must retain the package name `iecode-geom`, public API, and
source notices. It should add `crates/iecode/geom` to the target workspace,
then rerun these scoped commands from the target root:

```text
cargo check --locked -p iecode-geom
cargo check --locked -p iecode-geom --no-default-features
cargo check --locked -p iecode-geom --no-default-features \
  --target wasm32-unknown-unknown
cargo test --locked -p iecode-geom
cargo clippy --locked -p iecode-geom --all-targets -- -D warnings
```

## ABI and licensing risks

`iecode-ffi` publishes both `cdylib` and `rlib`. Its public C functions expose
`IecodeBytes` as `#[repr(C)]`, a version string based on the package version,
and schema string `iecode.ffi/v1`; callers must free buffers with the supplied
fields. Importing it changes the compatibility obligation from a Rust crate
migration to an ABI release decision. Its dependency on `iecode-core` makes a
partial import impossible without refactoring the existing source graph.

`LICENSES.md` states that the combined native emulator artifact is subject to
GPL-family terms because it incorporates melonDS. The document also says that
IECODE portable files may have their own permissive notices, but a combined
artifact must retain applicable notices and source obligations. It identifies
`iecode-ievr-data` as private commercial-source material with `publish =
false`. The current IECODE workspace package metadata has no workspace
`license` or `license-file` field, and the first-party manifests inspected do
not supply one. License/provenance must therefore be recorded per copied
crate; the target's Apache-2.0 workspace default must not be treated as a
relicensing statement for IECODE material.

## Explicitly excluded from this tranche

The IECODE workspace explicitly excludes `engine/bevy`, `emulators/dust`,
`emulators/gecko`, and `libraries/*`. They are not part of the 11-member Cargo
workspace assessed here. No conclusion in this report covers their build,
feature, ABI, or licensing readiness.

## Target import follow-up (2026-09-29)

The `iecode-ffi` boundary and its nine-crate first-party dependency closure were
subsequently copied under `aphrody/crates/iecode/` from source HEAD
`8fdab4b96014f70972c2855878cab49510ffe876`, including ten recorded uncommitted
source paths. `iecode-geom`, `iecode-pipeline`, `iecode-emu`, `iecode-re`,
`iecode-sql`, `iecode-tasks`, `iecode-video`, `iecode-core`, and `iecode-ffi`
are root Cargo members alongside the previously imported `iecode-ievr-data`.
Target package metadata was made explicit and the original workspace
`LICENSES.md` was copied. This local transfer preserves source provenance and
does not claim relicensing or authorize redistribution.

`cargo check -p iecode-ffi --locked --offline` passes from the Aphrody target.
No tests or Bun/.NET consumer parity were run. The current Bun wrapper's
symbols match `iecode-ffi`; the separately staged `@aphrody/nie` adapter still
requests the legacy `nie_*` API and remains incompatible. See
[`iecode-ffi-rust-extraction.json`](iecode-ffi-rust-extraction.json).
