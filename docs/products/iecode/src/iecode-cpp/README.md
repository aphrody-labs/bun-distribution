# IECODE C++ toolkit

This directory is the C/C++ surface of the unified IECODE workspace. Rust owns the canonical
portable capability API; C/C++ supplies native parsers, conversion tools and compatibility
implementations behind the common CMake/FFI boundary. IEVR/Victory Road runtime ownership stays
in the sibling `nie` workspace.

## Scope

- `src/iecode-cpp/`: C/C++ parsers, converters, CLI, decompilation helpers, and tests.
- `cmake/`, `CMakeLists.txt`, `vcpkg.json`: native build configuration.
- `bench/cpp/`: benchmark harness.
- `mods/strikers2013-xtreme/`: Kamek/CodeWarrior PowerPC sources of the Inazuma Eleven GO
  Strikers 2013 Xtreme mod. It is built with its own `build.py` toolchain, is outside the CMake
  source glob, and its managed playlist helper lives in `src/IECODE/Gui/PlaylistMaker`.

This repository contains no game dumps or generated VFS data.
