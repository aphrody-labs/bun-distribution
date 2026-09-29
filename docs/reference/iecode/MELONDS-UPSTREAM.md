# melonDS upstream integration

## Active source

`src/iecode-cpp/emulation/melonds` is the active Nintendo DS emulator subsystem.
It is the unmodified source tree exported from the official `melonDS-emu/melonDS`
repository at:

```text
906e9ebb27da8c6a715cd7abab4abfe8a8d29427
2026-08-23
Look for MakeEmbed.cmake in the correct location even if melonDS is included in subprojects
```

The tree intentionally contains no nested `.git` directory, submodule, vendored
checkout, generated build directory, ROM, BIOS, key or user data. Its upstream
license is GPL-3.0.

## Historical overlay

The former WinDS/DS32 duplicate tree was removed from the checkout during the
native convergence. Its pre-removal state remains recoverable from the earlier
Git commits; it is never a CMake source input.

## CMake and vcpkg contract

The root CMake target is `melonds`. It reads only the root vcpkg manifest and
the root-owned `cmake/overlay-{ports,triplets}` directories. The standard
headless target sets:

```text
BUILD_QT_SDL=OFF
ENABLE_OGLRENDERER=OFF
ENABLE_GDBSTUB=OFF
```

This builds the upstream `core` static library without requiring Qt or a
frontend-provided GLAD definition. Enabling the Qt/SDL frontend is explicit via
`BUILD_MELONDS_QT6=ON` and requires the corresponding reviewed vcpkg feature.

## Validation

On 2026-09-29, the following completed on the WSL build host:

```sh
cmake --fresh --preset unified
cmake --build build/unified --target melonds --parallel 2
```

The upstream headless core compiled 88 units and linked `libcore.a`.
