<!-- SPDX-License-Identifier: Apache-2.0 -->
# Unified package capabilities

Owner: Aphrody. Producer integrations: Bun SP/WG and the vcpkg/NuGet forks.

- `aphrody-pkg-core`: I/O-free `Source`, `Version`, `Index` and crypto contracts.
  Version schemes and original integrity strings stay ecosystem-specific.
  SP/WG absorb the existing system
  parsers and version/lock models here; none are implemented by this skeleton.
- `aphrody-pkg-store`: streaming SHA-256 blob ingestion, upstream digest checks,
  deduplicated publication, verification, logical blob statistics and writable
  native reflink materialization with an independent-copy fallback.
  Callers pass the configured `<Aphrody home>/store`; no existing cache is moved.

The current store refuses destination overwrite and verifies the bytes being
materialized. Writable consumers get independent cloned or copied files. Immutable
hardlink materialization, cache adapters, garbage collection, resume HTTP,
solver, CLI and FFI remain open work. Full builds and cross-tool performance
qualification remain main's final pass.

The workspace lockfile includes the new members. On native Windows, scoped tests
(four store fixtures) and strict all-target Clippy pass using
`scripts/dev/windows-cargo.ps1`. Repeat for affected changes or another target:

```sh
cargo check --locked -p aphrody-pkg-core -p aphrody-pkg-store
cargo test --locked -p aphrody-pkg-core -p aphrody-pkg-store
cargo clippy --locked -p aphrody-pkg-core -p aphrody-pkg-store --all-targets -- -D warnings
```

Store fixtures cover repeated content, consumer mutation isolation, destination
collision, upstream hash mismatch, corrupt blobs and address path validation.
They also cover eight concurrent writers and temporary cleanup. The current
Windows NTFS target exercises copy fallback; native block cloning remains to be
qualified on ReFS/Dev Drive, Linux btrfs/xfs and macOS APFS. No real
NuGet/vcpkg installation is qualified. The requested speed and cache savings need the real
cross-tool workloads after the adapters are connected.
