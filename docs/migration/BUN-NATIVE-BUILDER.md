<!-- SPDX-License-Identifier: Apache-2.0 -->
# Aggregate Bun native builder

`@aphrody/workspace` owns `aphrody-ops bun-native`. Its source is
`packages/aphrody-workspace/src/bun-native.ts` in Infra; the consolidated dispatcher
retains the same implementation under `packages/infra/aphrody-workspace`.
The library owner is the monorepo's `crates/ai/aphrody-ffi`, and the consumer is
`packages/bun/aphrody`, package `@aphrody/bun`.

## Build and stage

From the Aphrody monorepo root:

```sh
bun packages/infra/aphrody-workspace/src/ops.ts bun-native --gpu
```

The default builds the host release cdylib with Cargo's lock enforced and the
configured `sccache` wrapper intact. `--debug`, `--offline`, and `--unlocked` are
explicit alternatives. `--gpu` requires the aggregate feature to forward to
`aphrody-bun/gpu`; an unrelated feature with the same name is rejected.
Cargo's compiler-artifact report supplies the artifact path. Cross-target
artifacts cannot be qualified through the host smoke.

`--root=<monorepo>` selects the owner checkout. `--package-root=<consumer>` stages
into another copy of `@aphrody/bun`, enabling checks outside the source checkout.
The destination is `native/<host-triple>/<platform-library-name>`, with an
adjacent `manifest.json`.

## Qualify an existing debug artifact

```sh
bun packages/infra/aphrody-workspace/src/ops.ts bun-native \
  --debug --stage-existing=/absolute/path/libaphrody_ffi.so \
  --artifact-sha256=<64-lowercase-hex-digits> \
  --package-root=/absolute/path/isolated-consumer
```

This mode does not invoke Cargo or establish build/source closure. It rejects
release and GPU claims. The manifest records `provenance: "existing-debug"`,
`buildSourceHead: null`, `features: null`, and native crate `version: null`.
The observed checkout HEAD, dirty state and Cargo lock fingerprint describe the
checkout inspected during staging, not the unknown source of the reused binary.
Loading a debug package requires `APHRODY_FFI_DEV=1`.

## Qualification and failure behavior

The builder copies the package sources and artifact into a temporary installation
under `node_modules/@aphrody/bun`. It checks the source/copy SHA-256 and optional
expected hash, writes a temporary manifest, and launches a fresh process without
`APHRODY_FFI_LIB` or a usable Cargo target directory. The smoke imports the real
package exports for M3, CLI, Web, Manga, Shenron, N2B and Oxc. It checks ABI
versions, `--version`, HTML handling, M3 arithmetic, Oxc outputs, a genuine N2B
finding, unchanged Node input, and the single shared library handle.

ABI descriptors come from the consumer's `src/native-artifact.ts`. The manifest
records the host triple/libc, profile/features, versions, file hash/size,
toolchain/lock, observed checkout and build provenance. A clean source HEAD is
claimed only for a Cargo build whose checkout remains clean at the same HEAD.
Release installation additionally passes with development mode disabled.

The verified artifact is renamed into place before its final manifest. A failed
smoke never publishes the temporary success marker; a stale final manifest
cannot validate a replacement artifact with a different hash.

SIGINT, SIGTERM and the API's AbortSignal stop only the subprocess tree owned by
that invocation. Unix children use an independent process group; Windows uses
`taskkill /PID /T /F`. Temporary copies are removed in `finally`.

Tests live in `test/bun-native.test.ts` beside the owner package. The real staging
gate is enabled by `APHRODY_NATIVE_TEST_ROOT`, optionally with
`APHRODY_NATIVE_TEST_ARTIFACT` and `APHRODY_NATIVE_TEST_SHA256`. Linux cancellation
is verified using an actual subprocess and descendant. Windows cancellation,
cross-platform releases, complete NIE datasets and product parity require their
own gates; this builder does not qualify them.
