<!-- SPDX-License-Identifier: Apache-2.0 -->
# Native N2B and Oxc aggregation

Recorded 2026-09-30. `aphrody-ffi` now includes the existing N2B and Oxc native
implementations. Their target crates build as internal `rlib`s and produce no
additional dynamic library. `@aphrody/bun/n2b` and `@aphrody/bun/oxc` preserve
the scan/options, UTF-16 offsets, format, minify and lint contracts. No Bun
parser, bundler or test-runner implementation is replaced by this bridge.

## Provenance and contracts

| Owner | Source revision | Target | License |
| --- | --- | --- | --- |
| Compat N2B native | `80091ab69f284e593efa4b6b415e4637cc55fdaa` | `crates/compat/aphrody-n2b-native` | Apache-2.0 |
| Oxc native bridge | `31d5266e150ff17af52f0c2fc798cc27dc9a5a59` | `crates/compat/aphrody-oxc-bridge` | MIT; source notice retained in its `LICENSE` |

Both source worktrees were clean when their reference bridges were rebuilt
with `cargo build --offline --locked -p <native-owner>`. The N2B implementation
is unchanged except for an explicit safety documentation section. The Oxc
implementation is unchanged except for two native boundary tests. The Oxc
root dependencies, including those used by N2B, all select the same fork
revision. `cargo tree --offline --locked -p aphrody-ffi --duplicates` reports
no duplicate Oxc crate roots; this does not quantify mapped code size.

The original source files have these SHA-256 values:

| Source file | SHA-256 |
| --- | --- |
| Compat native `src/lib.rs` | `52d0e77e61242f2dad7be88b00fd1e25422a90b2a08cdd9844fbb4f6a02e28e5` |
| Compat native `Cargo.toml` | `cb51fc74b520087082bc2939851cad61fb1b493ee5c0180bf2eaa13af69aea33` |
| Oxc bridge `src/lib.rs` | `c3c500d73f223479729ad04c2bbdabbfece451f21d21c7da56a3bdd00cfc199f` |
| Oxc bridge `Cargo.toml` | `16fec4551f3d86da706dfb35702531b5aca6bc03e2a91316b3429fba42b2771d` |

Aphrody ABI remains 1, N2B ABI remains 2 with JSON report schema 2, and Oxc ABI
remains 1. Every owned result is freed with its original destructor. The
[tooling C header](../../crates/interop/ffi/include/aphrody-tooling.h)
declares these contracts and compiles as C17 and C++17 with strict warnings.

The native symbol audit of the rebuilt debug aggregate resolves all ten:
`node2bun_abi_version`, `node2bun_scan_json`,
`node2bun_scan_with_options_json`, `node2bun_string_free`, `find_newlines_u16`,
`aphrody_oxc_abi_version`, `aphrody_oxc_format`, `aphrody_oxc_minify`,
`aphrody_oxc_lint`, and `aphrody_oxc_free`.

## Native lifetime and consumer proof

The package and fork builtin share the registry at
`globalThis[Symbol.for("aphrody.ffi.library.v1")]`, with absolute `path`,
`library` and `owner` fields. Imports remain lazy. A builtin-first handle is
upgraded by opening and validating the package's full symbol set before
closing the old handle, preventing native unload between them. Builtin calls
follow the registry on every operation. Closing removes the registry and the
next operation reopens it. A different explicit `APHRODY_FFI_LIB` path while
loaded is rejected. The Web binding still rejects close while native resources
are live. The aggregate retains mimalloc's `local_dynamic_tls` option for
Linux loading from Bun.

The retained native tests
and fork fixture
verify raw error ownership, report parity against rebuilt Compat, Oxc output
parity against its rebuilt original bridge, source immutability, preview and
actual safe fixes, ignores, UTF-16 astral/lone-surrogate offsets, and both
compiled-fork load orders with close/reload and explicit-path rejection.
N2B reports/errors compare complete parsed JSON values because Cargo feature
unification can change JSON object key order without changing the schema.
Fifteen Oxc fixture responses match the original bridge byte for byte.

The scoped checks passed:

- Rust native tests: 5 passed (3 N2B, 2 Oxc), no failures.
- Aggregate plus both owners: all-target Clippy, `--no-deps -D warnings`.
- Debug `cargo build --offline --locked -p aphrody-ffi` and native symbol audit.
- Bun native and existing library tests: 10 passed, 0 skipped, 73 assertions.
- The compiled fork also ran the 8 native tests, 0 skipped, 58 assertions.
- TypeScript 7 package typecheck, Oxc lint of 7 changed TypeScript files with
  0 diagnostics, scoped Oxfmt/Rustfmt and `git diff --check`.

Reproduce the complete Bun consumer test from the target repository:

```sh
APHRODY_FFI_LIB="$PWD/target/debug/libaphrody_ffi.so" \
APHRODY_OXC_REFERENCE_LIB=~/src/oxc/target/debug/libaphrody_oxc_bridge.so \
APHRODY_N2B_REFERENCE_LIB=~/src/aphrody-compat/target/debug/libaphrody_n2b_native.so \
APHRODY_BUN_FORK_BIN=~/src/bun/build/debug/bun-debug \
bun test packages/bun/aphrody/test-native.test.ts packages/bun/aphrody/test-library.test.ts
```

Reference-library and fork-specific tests skip if their explicit environment
variables are absent. The recorded run supplied all three. The reference paths
are differential-test inputs, not runtime dependencies of the façade.

## Open acceptance

This proves the Linux debug native tranche. A fresh release artifact with the
new symbol set, GPU parity, Windows/macOS validation, clean-clone packaging,
installed OS selection, release memory/cold-start measurements, and the full
migration acceptance gates remain open. Existing old release artifacts cannot
satisfy the expanded registry; use the tested explicit debug artifact or
rebuild the aggregate. The full N2B CLI retains capabilities outside the scan
ABI. Original checkouts and histories remain intact.
