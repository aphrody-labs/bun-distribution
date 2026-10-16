# Browser WebAssembly source and notices

The DS and Wii WebAssembly modules are GPL-3.0-only derivatives of the
retained Dust and Gecko implementations. Their original GPL text is included
as `LICENSE.GPL-3.0`. This package does not grant rights to game inputs.

Published binary packages include `corresponding-source.tgz`. It contains the
complete tracked producer source for the 17 local Cargo members required by
these adapters, their manifests, the root dependency catalog and lockfile,
original license notices, and the build script. No ROMs, dumps, databases,
credentials or generated caches form part of the archive.

The archive's `SOURCE-RECEIPT.json` identifies the source commit, package members,
file hashes and selected Bun runtime. Registry and pinned upstream dependencies
are identified by `Cargo.lock`; those dependencies retain their own licenses.
The supplied workspace member list is narrowed to the adapters and their local
dependencies while keeping their paths and dependency declarations intact.

Use the qualified Aphrody Bun fork recorded in `config/bun-runtime.json`,
the Rust toolchain recorded in `rust-toolchain.toml`, the
`wasm32-unknown-unknown` target, and the `wasm-bindgen-cli` version in the lockfile.
The original build entry point is `scripts/iecode/build/build-emulator-web.ts`:
`--ds` selects Dust and the default selects Wii. It uses the native serialized
Aphrody Cargo factory, then emits browser bindings with `wasm-bindgen`.
On a separately qualified redistribution build host, equivalent Cargo target
builds and `wasm-bindgen --target web` reproduce the same build stages.
