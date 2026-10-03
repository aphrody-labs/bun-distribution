<!-- SPDX-License-Identifier: Apache-2.0 -->
# Rust builds on the VPS factory

Rust compilation, tests and release assembly belong on the VPS build host.
WSL and Windows remain editing and orchestration clients. Infra and Workspace
own source transfer, pipeline selection and release delivery; this document
does not introduce a second SSH or deployment orchestrator.

## Serialization and caches

Every Cargo command runs through `scripts/build/rust/cargo-serial.sh` from
the selected source owner. One command holds the host lock at a time, with
at most six compiler jobs and incremental compilation disabled. Use two jobs
initially for memory-heavy native inference builds; choose a higher limit only
after observing memory headroom. Do not start parallel target builds or give
each pipeline its own lock.

The wrapper accepts these host settings:

| Setting | Behavior |
| --- | --- |
| `APHRODY_CARGO_JOBS` | Integer 1–6; default 6. |
| `APHRODY_CARGO_LOCK_TIMEOUT_SECS` | Nonnegative integer seconds; default 1800. |
| `APHRODY_CARGO_LOCK_DIR` | Shared lock directory; default `$HOME/.cache/aphrody`. Configure the same directory for every factory runner account. |
| `APHRODY_CARGO_TARGET_DIR` | Optional absolute Cargo artifact directory, isolated per source owner; conflicts with `--target-dir` are rejected. |
| `RUSTC_WRAPPER` | Existing configuration is preserved, including an explicit empty opt-out. When unset and installed, `sccache` is selected. |
| `APHRODY_BUILD_HOST` | Factory dispatch sets `vps`; enabled factory policy rejects unmarked heavy Cargo execution before acquiring the Cargo lock. |
| `APHRODY_LOCAL_CARGO` | Explicit `1` permits a deliberately selected scoped diagnostic; never set globally or use for ordinary builds. |

Help requests and commands such as metadata, formatting and dependency-tree
inspection remain usable locally. Build-producing Cargo plugins (`nextest`,
`xwin`, `zigbuild`) follow the same guard as build, check, Clippy and tests.
The host marker routes operational policy; it is not an authentication boundary.

Keep registry, Git and sccache stores outside temporary release snapshots.
Use persistent source-owner target directories when the owner's packaging
contract supports them. Retain toolchain, target, features and build profile in
run provenance; the presence of a cached binary alone is not release proof.
Do not erase reusable caches as part of normal successful release cleanup.

## Native consumers and target ordering

IECODE's current authority is `docs/development/INAGLE-NIE-FFI.md` in its
own checkout. Its Cargo configuration and native packaging expect root
`target/`; AppImage packaging explicitly refuses redirected target directories.
Do not apply the optional target override globally to these owners. Build the
actual ABI producer before native consumer tests; fallback tests and explicit
native skips do not qualify the compiled ABI.

Run scoped Linux gates first. Run Windows MSVC only with its actual SDK/linker
or the owner's declared cross toolchain; run WASM only for declared WASM
consumers. Missing toolchains are skipped prerequisites, not successful checks.
Cross targets share the same lock. Maintain separate gate results for check,
Clippy, tests and release linking, even when compiled dependencies are reused.
Do not merge feature-specific release commands when their feature union would
change a binary's behavior.

## Migration boundary

Stopping RG and moving Shenron to DBFR are operations owned by Infra. A Rust
wrapper change does not prove either operation happened. DBFR remains the
Shenron runtime host; the VPS produces verified artifacts for delivery there.
Keep production inputs, databases and credentials in their protected stores.

On Windows `cargo-serial.ps1` retains the existing session mutex and restores
its temporary build environment on exit. It is not a cross-host lock or a
permission to resume local builds alongside the VPS queue.

## Evidence — 2026-10-03

This change updates wrapper configuration and documents owner constraints.
No Cargo command, native build or product test was run by the worker. Bash
syntax validation, PowerShell parser validation and scoped `git diff --check`
passed on 2026-10-03. Build speed
and cross-platform qualification require measured remote runs; neither is
inferred from these configuration changes.
