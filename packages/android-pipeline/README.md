# Android pipeline owner

Bounded, non-executing inspection of APK, AAB, APKS and APEX ZIP containers for
Bun Engine. The planner targets PE, ELF or WebAssembly/WASI only when rebuildable
sources exist. An opaque Android package remains assigned to an Android runtime.

This package does not decode signatures, bypass platform security, install SDKs,
or redistribute application payloads.

## Documentation and tools

- [`docs/compose-versions.md`](docs/compose-versions.md): verified Android
  Gradle Plugin, Kotlin, Compose BOM, Material 3, Activity and Lifecycle
  versions applied by `apps/bun-android`, with the UI rules they imply.
- [`docs/references/`](docs/references): Google Maven and Maven Central
  metadata snapshots and query provenance backing those versions.
- [`tools/ghidra/`](tools/ghidra): headless Ghidra scripts.
  `SmokeSummary.java` prints program, language, function and instruction
  counts; `SmokeNativeExports.java` requires and decompiles the
  `android_add` C ABI and `Java_com_aphrody_android_NativeBridge_add` JNI
  exports of `crates/android-native`.

These files come from `aphrody-labs/bun-engine` (`docs/android`,
`tools/android`) at revision `6afa5a7e1f04e29ee1ec75ede9c7c2220ad12b68`,
MIT licensed by Aphrody Labs under the same license as this package.
