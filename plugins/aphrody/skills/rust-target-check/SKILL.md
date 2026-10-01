---
name: rust-target-check
description: "Run cargo check for several targets at once (default Linux x86_64, Windows MSVC, wasm32) and report per-target verdicts with the first real error. Use after Rust, Cargo.toml or cfg changes, before pushing, or for cross-platform checks."
version: "2.0.0"
argument-hint: "[crate-name | --workspace] [--targets triple,triple,...]"
allowed-tools: Bash, Read
---

# rust-target-check: multi-target cargo check

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
If the project forbids agents from running cargo, or reserves builds for a lead/CI, report
the exact commands instead of running them.

## 3. Run

Concurrent `cargo` processes sharing one `target/` directory wait on its lock, so true
parallelism needs one target dir per triple. Use parallel runs when disk allows; otherwise
run the same commands sequentially in the default `target/` (incremental reuse makes this
cheap).

Bash (Linux, macOS, WSL):

```bash
SCOPE="-p my-crate"            # or --workspace
FLAGS="--locked --message-format=short"
LOG="${TMPDIR:-/tmp}/xcheck"; mkdir -p "$LOG"
declare -A PID
for T in x86_64-unknown-linux-gnu x86_64-pc-windows-msvc wasm32-unknown-unknown; do
  CARGO_TARGET_DIR="target/xcheck-$T" cargo check $SCOPE $FLAGS --target "$T" >"$LOG/$T.log" 2>&1 &
  PID[$T]=$!
done
for T in "${!PID[@]}"; do wait "${PID[$T]}"; echo "$T exit=$?"; done
```

PowerShell (Windows):

```powershell
$scope = @('-p','my-crate'); $log = Join-Path $env:TEMP 'xcheck'; New-Item -Force -ItemType Directory $log | Out-Null
$jobs = foreach ($t in 'x86_64-pc-windows-msvc','x86_64-unknown-linux-gnu','wasm32-unknown-unknown') {
  Start-Job -ArgumentList $t,$scope,$log,$PWD -ScriptBlock {
    param($t,$scope,$log,$cwd) Set-Location $cwd
    $env:CARGO_TARGET_DIR = "target/xcheck-$t"
    cargo check @scope --locked --message-format=short --target $t *> (Join-Path $log "$t.log")
    [pscustomobject]@{ Target = $t; Exit = $LASTEXITCODE }
  }
}
$jobs | Wait-Job | Receive-Job
```

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
