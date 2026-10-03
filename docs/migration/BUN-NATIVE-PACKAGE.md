<!-- SPDX-License-Identifier: Apache-2.0 -->
# Bun native package qualification

Recorded 2026-09-30. The package implementation lives entirely inside
`packages/bun/aphrody/src`: CLI, Web and Shenron use `engine.ts`, and Manga
uses `manga.ts`. The historical Rust crate's Bun entry points re-export these
owners. Both entry points therefore share resource accounting and the lazy
native handle; an installed package needs no Cargo checkout to import them.

The native loader defaults to `native/<host-triple>/` or the legacy flat
`native/` directory. Linux GNU and musl hosts are distinguished. Before opening
an artifact, it validates `manifest.json`, package version, host/libc, seven ABI
versions, source/toolchain provenance, completed consumer smoke, size and streamed
SHA-256. The normal profile requires a clean release source revision. These
checks establish internal artifact consistency, not publisher authentication.

Local `target/{release,debug}` discovery and raw overrides without a manifest
require `APHRODY_FFI_DEV=1`. Existing debug staging records unknown build version,
features and source revision explicitly, and cannot qualify a release. Importing
public bindings remains lazy. Runtime ABI calls still validate the loaded library.

## Recorded checks

- TypeScript 7 typecheck and scoped Oxc lint/format pass.
- Six artifact/package regressions pass: host/ABI/provenance rejection, explicit
  development profile, hashing across multiple chunks, all public imports in an
  isolated package copy, opt-in checkout lookup, and corruption rejection.
- Combined Bun run: **12 passed, 4 skipped, 0 failed, 60 assertions**, against
  `libaphrody_ffi.so` SHA-256
  `bed77451d962748d4e07d43cb530f3c4ec36ccbeddce7ed219668fa460a960b0`.
  Live calls cover M3, SVG, CLI, Web, N2B and Oxc; shared handle close/reload and
  native resource accounting pass.
- Four differential/fork tests skipped because their former source binaries
  are absent. Earlier successful fork qualification remains historical evidence,
  not a current rerun. Installed active consumer smoke and builder evidence are
  recorded separately by the Infra owner.

Linux x86_64 GNU release staging from a clean clone is requalified on
2026-10-03: commit `7d927b1fa82213df38d68f2dd9bad4433eb116ef`, release + GPU,
isolated consumer smoke passed with development mode enabled and disabled.
Artifact SHA-256: `4fdc85087208baf2005130193adcc945734431190837c6ca499e9205b718bd79`;
the manifest and limits are recorded in [the root plan](../../PLAN.md).
Other platforms, a durable installed distribution and publication remain open.
The target repository currently has no configured Git remote.
