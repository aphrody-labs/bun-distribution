<!-- SPDX-License-Identifier: Apache-2.0 -->
# Unified package capabilities

Owner: Aphrody. Producer integrations: Bun SP/WG and the vcpkg/NuGet forks.

- `aphrody-pkg-core`: I/O-free `Source`, `Version`, `Index` and crypto contracts.
  Version schemes and original integrity strings stay ecosystem-specific.
  SP/WG absorb the existing system
  parsers and version/lock models here; none are implemented by this skeleton.
- `aphrody-pkg-store`: streaming SHA-256 blob ingestion, upstream digest checks,
  deduplicated publication, verification, logical blob statistics and writable
  copy materialization.
  Callers pass the configured `<Aphrody home>/store`; no existing cache is moved.

The current store refuses destination overwrite and verifies the bytes being
materialized. Writable consumers get independent copies. Reflinks, immutable
hardlink materialization, cache adapters, garbage collection, resume HTTP,
solver, CLI and FFI remain open work. Full builds and cross-tool performance
qualification remain main's final pass.

The workspace lockfile includes the new members. On native Windows, scoped tests
(three store fixtures) and strict all-target Clippy pass using
`scripts/dev/windows-cargo.ps1`. Repeat for affected changes or another target:

```sh
cargo check --locked -p aphrody-pkg-core -p aphrody-pkg-store
cargo test --locked -p aphrody-pkg-core -p aphrody-pkg-store
cargo clippy --locked -p aphrody-pkg-core -p aphrody-pkg-store --all-targets -- -D warnings
```

Store fixtures cover repeated content, consumer mutation isolation, destination
collision, upstream hash mismatch, corrupt blobs and address path validation.
They do not yet cover concurrent writers, the native reflink paths or real
NuGet/vcpkg installations. The requested speed and cache savings need the real
cross-tool workloads after the adapters are connected.
