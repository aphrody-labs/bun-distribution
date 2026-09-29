<!-- SPDX-License-Identifier: Apache-2.0 -->
# Bun and Rust integration boundaries

This repository does not link a Rust crate into the Bun executable. Bun is
discovered and launched as an installed program through the shared
[`aphrody-toolchains`](../crates/aphrody-toolchains/) crate. The
optional `third_party/bun` submodule provides Bun source and documentation; it
is not a member of this Cargo workspace.

## Existing interfaces

- `aphrody-n2b-native` exports a versioned C ABI. Its `node2bun_scan_json`
  function runs the N2B scanner in check mode and returns an owned JSON result;
  `node2bun_string_free` releases it. The Aphrody Bun fork's `bun:aphrody`
  module loads this dynamic library through `bun:ffi`. The library must be
  supplied separately; the Rust scanner is not linked into the Bun executable.
- `aphrody-ffi` in `aphrody-ai` exposes Aphrody's command surface through a
  separate C dynamic library and `bun:ffi`.
- `aphrody-bun` and `@aphrody/bun` in `aphrody-ui` expose UI Rust hot paths to
  Bun through `bun:ffi`; UI owns their lifecycle and API.
- Bun's experimental `bun-native-plugin` supports a Rust/N-API bundler
  `onBeforeParse` hook. It is a build transform API, not a runtime module or a
  general way to add `Bun.*` APIs.

These interfaces let Bun programs call native Rust code. The N2B scan ABI calls
the Rust scanner in-process without spawning the `n2b` CLI. These libraries are
separate dynamic artifacts, each with its own ABI and release boundary.

For the cross-repository crate/package map and the staged plan for a native
Aphrody Bun runtime, see [Infra's Aphrody Bun platform document](../infra/APHRODY-BUN-PLATFORM.md).
