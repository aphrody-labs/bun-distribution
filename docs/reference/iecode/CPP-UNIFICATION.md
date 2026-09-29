# IECODE C++ unification

## One build surface

`iecode_native` is the single native aggregation target. It depends on exactly
two CMake components:

| Component | Source owner | Output role |
| --- | --- | --- |
| `iecode_cpp` | `src/iecode-cpp` | Portable IECODE parsers, formats, VFS, conversion and CLI support |
| `melonds` | `src/iecode-cpp/emulation/melonds` | Pinned GPL Nintendo DS runtime subsystem |

The root `iecode` target depends on `iecode_native` plus Rust FFI/CLI/tests and
the .NET tests. This gives every native consumer one target and one root vcpkg
manifest without pretending that incompatible source ownership is a shared
library.

## Source boundary

`src/iecode-cpp` is the only location for IECODE C++ code. Its
`emulation/melonds` subtree is an unmodified, pinned upstream GPL source
snapshot. The old WinDS/DS32 duplicate tree was removed from the checkout and
remains available only through Git history.

This boundary removes duplicate emulator trees while preserving a reviewable
upstream update path. The combined native emulator artifact is GPL-family
licensed; portable interfaces remain explicit through the Rust/C ABI or a
documented C++ adapter with fixtures.

## Build and validation

```sh
cmake --preset unified
cmake --build --preset unified --parallel 2
cmake --build build/unified --target iecode_native --parallel 2
```

The headless configuration intentionally sets `BUILD_QT_SDL=OFF`,
`ENABLE_OGLRENDERER=OFF`, and `ENABLE_GDBSTUB=OFF` for melonDS. Qt/SDL remains
an explicit vcpkg feature, never an implicit dependency of the portable build.

## Rules for future C++ work

- Add portable game-format, archive, VFS and conversion logic to `iecode-cpp`.
- Do not patch `emulation/melonds` directly; carry a documented upstream revision instead.
- Do not revive the removed WinDS/DS32 tree as a build input.
- Add a test or ABI fixture before moving a capability across language owners.
