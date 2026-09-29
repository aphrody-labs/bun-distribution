# IECODE native workspace

This is the single IECODE repository, now located outside the sibling Aphrody
`src/` directory. `Cargo.toml`, `IECODE.sln`, `CMakeLists.txt`, `package.json`
and `pyproject.toml` are the one IECODE-owned entry point per language.
Imported Rust fork source is under `engine/`, `emulators/` and `libraries/`,
without nested Git repositories. Those sources are not yet root Cargo members;
their staged merge and legal gaps are in [Fork integration](./FORK-INTEGRATION.md).
The canonical names and one-owner rules for every language are in
[Monorepo conventions](./MONOREPO-CONVENTIONS.md).

The validated workstation configuration and cache policy are documented in
[Development environment](./DEVELOPMENT-ENVIRONMENT.md).

- `src/iecode-cpp`: the single C/C++ owner: IECODE parsers, converters, CLI, utilities and the
  pinned `emulation/melonds` DS runtime subsystem.
- `src/IECODE`: unified .NET 10 `IECODE.Core`, `IECODE.Cli`, `IECODE.Gui` and `IECODE.Ffi` projects.
- `crates/pipeline`: process-free ordered stage manifests shared by every binding.
- `crates/`: portable Rust foundations; the IEVR/Victory Road Rust product
  remains in the sibling `../src/nie` checkout until measured extraction.

All imported source is now in one checkout. The language boundaries remain explicit, but nested upstream
`.git` directories and generated dependency/build trees are not part of IECODE. CMake keeps the
optional native adapters behind one workspace target; Rust remains the canonical capability
owner and C#/C++/Python are bindings or migration references.

```sh
VCPKG_ROOT=/path/to/vcpkg cmake --preset unified
cmake --build build/unified

# Explicit optional builds:
cmake -S . -B build \
  -DBUILD_IECODE_CPP=ON -DTEST_IECODE_CSHARP=ON -DBUILD_MELONDS=ON -DBUILD_UNIFIED=ON
```

`-DBUILD_UNIFIED=ON` adds one integration target named `iecode`: it checks the Rust CLI,
builds the Rust C-ABI library (the shared artifact is `iecode.dll` or `libiecode.so` according
to the host), runs the .NET 10 tests, and depends on `iecode_native`. The latter is the single
CMake aggregation target for `iecode-cpp` and the pinned melonDS core. It does not copy ROMs,
BIOS files, keys, or upstream third-party trees into this workspace.

The C# workspace is validated independently with:

```sh
dotnet build IECODE.sln --configuration Release
dotnet test src/IECODE/Core.Tests/IECODE.Core.Tests.csproj --configuration Release
```

Rust remains the canonical implementation for portable IECODE capabilities; only IEVR/Victory
Road runtime behaviour stays in the sibling `nie` workspace. The native checkouts do not own a
second implementation of a capability exposed by the Rust FFI.
