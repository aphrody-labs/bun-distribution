# Native Bun migration

Quality commands are native `bun check`, `bun lint` and `bun fmt`. Root tooling
uses the pinned fork and bunfmt.json. The native checker covers 41 authored
files; the imported frontend covers 1,479 files.

Aggressive n2b ran across the 16 library inputs and the SDK with two workers.
Rewrites were reviewed. Browser and embedded host scripts retain their runtime;
native Buffer compatibility remains where a replacement cannot preserve its
contract. Unsupported mock helpers and invalid callback rewrites were corrected.

The internal Rust owner is
[packages/bun-n2b](https://github.com/aphrody-labs/bun/tree/176fa03201a78cd9f4ac6e839294d81ef4852435/packages/bun-n2b).
The patch adds explicit submodule traversal, bounded scan/report retention,
accurate clean-file counts, nested package resolution and AST rewrite guards.
Directory pruning avoids repeated ancestor checks. Limit failures explicitly
report an incomplete scan.

The native Cargo check passed for the core, CLI and addon on Windows. Rust 1.97
remains the declared minimum; the gate used the installed Rust 1.99 toolchain.
The installed n2b addon remains 0.7.0. Its fresh artifact has not been built or
installed, so new scanner flags are source-qualified only.
