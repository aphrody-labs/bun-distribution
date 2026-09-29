# IECODE architecture

This repository is the portable IECODE monorepo. It owns reusable code that is not the
IEVR/Victory Road product runtime. The `nie` repository remains the owner of IEVR data,
formats, game logic, the site, and the Rust CLI binary `nie` (formerly `niers`).

The DS/3DS/Wii/Switch/Steam emulation and compatibility direction, including
language ownership and honest runtime-test gates, is recorded in
[`docs/EMULATION-PLATFORM-DECISION.md`](../../decisions/iecode/EMULATION-PLATFORM-DECISION.md).
For new portable capabilities, Rust is the default implementation language;
existing C/C++ and C# code remains in place until a measured library extraction.
The shared Aphrody toolchain, formatting and dependency policy is recorded in
[`docs/APHRODY-RUST-BASELINE.md`](../../reference/iecode/APHRODY-RUST-BASELINE.md).

Directory convention: `crates/` contains Rust packages, `packages/` contains Bun libraries,
`apps/` contains executable Bun/Rust applications, and `src/` contains C++, C#, and uv/Python
source trees.

## Ownership boundary

| Surface | Owner | Contract |
| --- | --- | --- |
| Portable Rust core and CLI | target `crates/core` (`iecode-core`) plus `apps/iecode-cli` (`iecode`) | one canonical library API, feature-gated modules, one Cargo lockfile |
| Rust consolidation inputs | current `crates/{emu,geom,re,sql,tasks,video}` | migration sources; they are not competing long-term core owners |
| C/C++ | `src/iecode-cpp` | Single owner for portable IECODE and the `emulation/melonds` GPL DS subsystem; dependencies from the root vcpkg manifest |
| Portable .NET | `src/IECODE/{Core,Cli,Gui,Ffi}` | four SDK-style projects, .NET 10, central NuGet versions; former ndsSharp/IESE logic is source-integrated |
| Desktop UI | `src/IECODE/Gui` | one Avalonia host combining FluentAvalonia navigation/theme primitives with Material Icons; integrated viewer plugins remain library-backed |
| Shell contract | `src/IECODE/Gui/Shell` | host-owned stable command/contribution registry shared by native menus, keyboard gestures, toolbars and plugins |
| Python tools | `src/*` Python members | one uv workspace and lockfile, Ruff as formatter/linter |
| Core logic | `crates/core` | package `iecode-core`; one Rust facade over capability crates |
| Native boundary | `crates/ffi` | package `iecode-ffi`; one flat C ABI for Bun, .NET and native hosts |
| Media adapters | `packages/iecode-core` | package `iecode-core`; no source copy in `nie` |
| Bun native binding | `packages/iecode-ffi` | Bun `bun:ffi` consumer with no hardcoded checkout path |
| Orchestration | root `package.json` gate scripts; pipeline in `../src/aphrody-infra` | thin `bun run` gates, aphrody-infra is the only orchestrator |
| IEVR/Victory Road | sibling repository `nie` | game-specific crates, UI, site, assets and CLI bindings |

All IECODE package names use the `iecode-*` or `@iecode/*` prefix. No historical compatibility
package name is retained because this workspace is not published or consumed.

## Dependency rules

1. Source ownership is unique. A moved component has one directory and one manifest.
2. Managed C# belongs under `src/IECODE`; emulator C/C++ belongs under `src/iecode-cpp` or
   `src/iecode-cpp`. The two surfaces communicate through explicit native/FFI boundaries, never
   by compiling one language tree into the other project.
3. Rust workspace dependencies are declared once in the root `Cargo.toml`; members inherit
   versions and lints. Portable crates contain `version` alongside a local `path` while
   developing, so Cargo can replace the path with the crates.io version when packaged.
4. Bun has one root `bun.lock`. Workspace packages use `workspace:` only inside IECODE; the
   `nie` repository consumes published packages and never reaches into this source tree.
5. Python has one `uv.lock`; all members share the root `requires-python` intersection and are
   invoked with `uv run`, never a bare interpreter.
6. C++ dependencies come only from `vcpkg.json`; CMake configuration is selected through
   `CMakePresets.json`, not per-project flags.
7. .NET package versions live in `Directory.Packages.props`; projects do not carry duplicate
   `PackageReference` versions. Restore is locked when a lock file is present.
8. FFI is a boundary, not a second implementation: Rust owns logic, C ABI owns stable layouts,
   Bun/.NET/C++ consume generated or declared bindings.

## Build graph

```text
workspace-doctor
      |
      +--> cargo check/test --workspace ----> iecode-*.rlib
      +--> uv lock/check + ruff ------------> Python tools
      +--> bun run typecheck/test ---------> Bun packages
      +--> dotnet restore/build/test -------> IECODE .NET assemblies
      +--> cmake --preset unified ----------> iecode_native (iecode-cpp + melonDS)
```

`aphrody-infra` (`config/pipeline.json`) sequences these gates; it does not replace Cargo, uv, dotnet or CMake.
The native build remains opt-in because vcpkg toolchains and platform SDKs are host-specific.

The single-crate convergence design, measured comparison and ABI sequence live in
[`docs/core/`](../../products/iecode/core/README.md). Until that migration is complete, the existing Rust members
remain buildable and are treated as source owners for compatibility rather than silently moved.
The complete Aphrody Git provenance and absorption decisions live in
[`docs/history/APHRODY-AUDIT.md`](../../research/iecode/history/APHRODY-AUDIT.md).

The uncompleted migration batches, measured GUI gaps, external-repository audit and acceptance
gates are tracked in [`docs/REMAINING-WORK.md`](../../reference/iecode/REMAINING-WORK.md). That document is a backlog,
not evidence that the target architecture has already absorbed every source tree.

## Naming

- `iecode-*` for portable Rust packages and native targets.
- `iecode` for the single canonical portable CLI binary.
- `@iecode/*` for new Bun packages.
- `IECODE.*` for .NET assemblies and namespaces.
- `iecode_` for C/C++ targets and exported symbols.
- `nie` (formerly `niers`) for the Rust CLI binary in the `nie` repository.
- `nie-*` only when the code is an IEVR/Victory Road owner or an existing compatibility name.

## Management entrypoints

```text
bun run doctor
bun run typecheck
bun run test
bun run check:rust
bun run check:python
bun run check:dotnet
cmake --preset unified
cmake --build --preset unified --parallel 2
```

The doctor is read-only and fails on duplicate roots, missing manifests, stale nested
workspaces, or accidental source copies. It does not delete data, dumps, assets or build output.

## Reference decisions

This layout follows Cargo's shared workspace/lockfile model, uv's single-workspace lock model,
.NET central package management, CMake presets with a vcpkg manifest, and a single external pipeline (aphrody-infra).
