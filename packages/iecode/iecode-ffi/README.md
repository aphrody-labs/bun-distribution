<!-- SPDX-License-Identifier: Apache-2.0 -->

# @aphrody/iecode-ffi

Bun FFI adapter for IECODE's current `iecode.ffi/v1` C ABI. The wrapper matches
`iecode-ffi` exports (`iecode_core_version`, `iecode_ffi_schema`, registry,
pipeline validation and the owned-byte release function). Set
`IECODE_FFI_LIBRARY` to the native library path; the default is the platform
loader name `iecode_ffi`.

The current Rust implementation is in IECODE's `crates/ffi`. It has not yet
been copied into the Aphrody Cargo workspace, so this wrapper is staged but is
not an end-to-end runnable integration. It does not provide the older NIE
game-format ABI used by `@aphrody/nie`.
