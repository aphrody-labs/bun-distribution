---
name: rust-target-check
description: "Plan serialized cargo checks across targets (Linux x86_64, Windows MSVC, wasm32) and report per-target verdicts. Use after Rust, Cargo.toml or cfg changes, before pushing, or for cross-platform checks."
version: "2.0.0"
argument-hint: "[crate-name | --workspace] [--targets triple,triple,...]"
allowed-tools: Bash, Read
---

# rust-target-check: serialized multi-target cargo check

Verifies that a change type-checks on every target the project ships, without building
binaries. `cargo check` is enough to catch `cfg` mistakes, missing platform imports and
dependency features that do not exist on a target.

## 1. Decide the targets

In priority order:

1. Targets given by the user (`--targets`).
2. `targets = [...]` in `rust-toolchain.toml`, restricted to the platforms CI builds
   (`.github/workflows/*.yml` `--target` values, `Cross.toml`, `.cargo/config.toml`).
3. Default set: `x86_64-unknown-linux-gnu`, `x86_64-pc-windows-msvc`, `wasm32-unknown-unknown`.

Only check wasm for crates meant to run there (a `cdylib` with `wasm-bindgen`, a crate whose
README/CI targets wasm, or `[target.'cfg(target_arch = "wasm32")'.dependencies]`). A
workspace-wide wasm check fails on any crate using Tokio's runtime, `std::process` or native
C libraries, and that failure says nothing about the change.

Confirm the toolchain has them: `rustup target list --installed`; add missing ones with
`rustup target add <triple>`. A target that is not installed is reported as **skipped
(toolchain missing)**, never as passing.

## 2. Decide the scope

- Crate name given: `-p <crate>` (find names with `cargo metadata --no-deps --format-version 1`).
- `--workspace` or nothing given, and many crates changed: `--workspace`.
- Otherwise: the crates owning the changed files (`git diff --name-only` mapped to the
  nearest `Cargo.toml`).

Add `--locked` when `Cargo.lock` is committed; add `--offline` only when dependencies are
already fetched or vendored (otherwise it fails for reasons unrelated to the change).
If the project forbids workers from running cargo or reserves builds for a lead/CI, report
the exact commands to the integrator instead of running them. In the Aphrody monorepo,
workers never launch Cargo; the integrating agent runs one command at a time through
`scripts/build/rust/cargo-serial.sh`.

## 3. Run

Run one target at a time in the Aphrody workspace. The repository-wide file lock serializes
Cargo across terminals and agents; separate target directories do not authorize parallel
Cargo processes. Ask the integrating agent to run each applicable command sequentially.

Bash (Linux, macOS, WSL):

```bash
scripts/build/rust/cargo-serial.sh check -p my-crate --locked --message-format=short --target x86_64-unknown-linux-gnu
scripts/build/rust/cargo-serial.sh check -p my-crate --locked --message-format=short --target x86_64-pc-windows-msvc
scripts/build/rust/cargo-serial.sh check -p my-crate --locked --message-format=short --target wasm32-unknown-unknown
```

On Windows, send the target list to the integrating agent. The Aphrody wrapper is
a Bash script and is run from the Linux/WSL workspace; do not invoke it from
PowerShell or start parallel jobs.

## 4. Report

| Target | Verdict | Exit | First error |
| --- | --- | --- | --- |
| `x86_64-unknown-linux-gnu` | pass / FAIL / skipped | 0 | |
| `x86_64-pc-windows-msvc` | pass / FAIL / skipped | 101 | `src/fs.rs:42: unresolved import std::os::unix` |
| `wasm32-unknown-unknown` | pass / FAIL / skipped | 0 | |

- For each failure show only the first `error[...]` block of the log (`grep -m1 -A12 '^error'`).
- Distinguish **code errors** from **environment errors**: a `build.rs` that compiles C
  (`cc`, `bindgen`, `ring`, `openssl-sys`) needs a cross C toolchain. From Linux to
  Windows MSVC use `cargo xwin check --target x86_64-pc-windows-msvc`; for Linux from other
  hosts `cargo zigbuild` or `cross`. Report those as environment failures, with the fix.
- Success only if every non-skipped target passes. Read real exit codes; never infer a
  pass from partial output.

## Common fixes

- Platform-only import: gate with `#[cfg(unix)]` / `#[cfg(windows)]` or `cfg_select!` (1.95+).
- Platform-only dependency: move it to `[target.'cfg(windows)'.dependencies]`.
- wasm: disable default features that pull `tokio/rt-multi-thread`, `mio`, or filesystem
  access; for `getrandom` on `wasm32-unknown-unknown` enable its `wasm_js` backend (feature and, depending on the version, `--cfg getrandom_backend="wasm_js"`; check its README).
- Since Rust 1.96, undefined wasm imports fail to link; annotate extern blocks with
  `#[link(wasm_import_module = "...")]` (relevant to `cargo build`, not `check`).
