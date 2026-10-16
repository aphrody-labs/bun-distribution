<!-- SPDX-License-Identifier: Apache-2.0 -->
# aphrody-command

Shared command parser and in-process dispatch for Aphrody hosts. Domain
implementations remain in their existing libraries; this crate assembles their
command bindings. It owns the implementation formerly in `crates/infra/aphrody/src`.

`crates/infra/aphrody` retains the `aphrody` package, binary, compatibility exports and
feature names. `aphrody-ffi` consumes this library directly, preserving its C
symbols, argument convention and captured stdout/stderr. The library installs
no global allocator and introduces no subprocess boundary between the FFI and
the dispatcher.

Native hosts call `run_async`, `run_from_args` or `run_captured`. Arguments to
these Rust entry points include the program name; C ABI adapters still prepend
`aphrody` to their caller's arguments. WASM keeps the existing lightweight
help/version surface.

The root workspace owns versions and gates. Use
`scripts/build/rust/cargo-serial.sh` for check, clippy, test and build commands.
CLI integration tests stay with the binary; library and provisioning tests live
here. Windows stack reservation stays in the binary build script; build version
metadata lives with the command implementation.
