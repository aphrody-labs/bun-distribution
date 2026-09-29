<!-- SPDX-License-Identifier: Apache-2.0 -->

# `@aphrody/nie` compatibility binding

This private package is staged from IECODE for API inventory. Its current Bun
symbol table still targets the older `nie_*` ABI. The current IECODE Rust crate
`iecode-ffi` instead exports `iecode_*` symbols and builds the
`iecode_ffi` library. They are not ABI-compatible, so this package must not be
used to load the current IECODE library or preloaded into repository commands.

`@aphrody/iecode-ffi` is the wrapper aligned with the current
`iecode.ffi/v1` schema. The Rust provider has not yet been moved into this
workspace. Keep this compatibility package private and unpublished until the
game-format ABI is versioned, implemented by the Rust provider and checked
against the plugin's schemas and fixtures.

`IECODE_ROOT` and the legacy `NIE_ROOT` environment variable select the data
and native-artifact root. No game datasets or built native libraries are
included in this repository.
