<!-- SPDX-License-Identifier: Apache-2.0 -->
# Unified package capabilities

Product owner: Aphrody. Runtime/system integration owner: the Bun fork.
The common bindings provide a reusable model for the fork (2026-10-09 LAYERS directive).

- `aphrody-pkg-core`: I/O-free contracts and npm, Cargo sparse, NuGet,
  vcpkg and PyPI JSON parsers preserving metadata and integrity. npm, NuGet and PEP 440
  matching use native version schemes. Unsupported floating NuGet/vcpkg constraints error.
- `aphrody-pkg-store`: streaming SHA-256 CAS, verified reflink/copy materialization,
  process locks, durable owner references and explicit dry-run/apply garbage collection.
- `aphrody-pkg-net`: bounded concurrent HTTP downloads, cancellation, strong ETag
  resume validation and digest verification before publication.
- `aphrody-pkg-cli`: local store/index commands and remote npm/Cargo/NuGet metadata;
  integrated into `aphrody pkg` using the configured profile home.
- `aphrody-pkg-ffi`: versioned C ABI, cbindgen header and C/C++/C#/Python/Bun/Rust
  examples. See [qualification](ffi/QUALIFICATION.md).

Native Windows validation: 28 unit tests and strict all-target Clippy pass across
these five crates; `aphrody-command` checks successfully. C, C++, C#, Python and
Bun executed the native debug DLL; the Rust example executed the owner library.
All examples produced the same SHA-256 blob (11 bytes) in isolated stores.
These results establish this target and debug configuration only.

Remaining work: solver, extraction/signatures, complete package installation,
shared cache adapters, Python wheel/release packaging, qualified runtime consumer
migration and real NuGet/vcpkg workload measurements. No installed command
activation or cross-tool speed improvement is claimed. NTFS exercised copy
fallback; native cloning needs qualification on other filesystems. Existing
protected caches and databases were not moved or garbage collected.
