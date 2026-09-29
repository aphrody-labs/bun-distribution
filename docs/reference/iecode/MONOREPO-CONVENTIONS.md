# IECODE multilingual monorepo conventions

Checked against the official tool documentation on 2026-09-29. The repository
itself lives outside Aphrody's sibling `src/` checkout. A **single project per
language** means one owning workspace/solution/build graph, not one enormous
crate, package, assembly or translation unit.

| Surface | Canonical entry / lock | New source naming | Ownership |
| --- | --- | --- | --- |
| Rust | `Cargo.toml` / `Cargo.lock` | `crates/<domain>` with package `iecode-<domain>`; `apps/iecode-<host>` | Portable domain logic, headless emulator contract, WASM, versioned C ABI |
| Bun/TypeScript | `package.json` / `bun.lock` | `packages/iecode-<domain>`; `src/*.ts`, `*.test.ts` | Thin client bindings, web/CLI presentation and package adapters |
| .NET 10 | `IECODE.sln`, `Directory.Packages.props`, project locks | `src/IECODE/<Domain>/IECODE.<Domain>.csproj` | One managed Core, CLI, GUI, FFI and tests; Windows/launcher/modding hosts |
| C/C++ | root `CMakeLists.txt`, `CMakePresets.json`, `vcpkg.json` | `src/iecode-cpp/<domain>`; IECODE targets `iecode_<domain>` | Foreign emulator cores, target-side libraries and ABI adapters |
| Python | `pyproject.toml` / `uv.lock` | New distributions `iecode-<domain>`, imports `iecode_<domain>` | Extraction, scripting, analysis and data preparation |

The existing historical Python and NIE package names are compatibility
surfaces. Do not rename their imports or published identifiers until their
consumers and lockfiles migrate together. New IECODE-owned modules follow the
prefix immediately. Keep names, APIs, paths and new technical docs in English.

## One owner per behavior

1. Put reusable algorithms and device-independent state in a library first.
   `crates/emu` owns scheduling/snapshot contracts; a console core owns its own
   CPU, bus, RAM and device semantics. A CLI, GUI, Bun package or Python module
   does not copy those algorithms.
2. Cross-language calls use the versioned C ABI and explicit data schemas.
   C# P/Invoke, Bun FFI and Python bindings are adapters, not competing format
   parsers. A WebGPU/DX12/Vulkan host consumes an owned frame/command contract,
   not another backend's incompatible GPU handles.
3. Runtime orchestration, deployment and release policy belong to the
   Aphrody monorepo's Infra workspace, not IECODE; IECODE only exposes thin local gates. Private game
   fixtures stay outside Git and are mounted by explicit developer paths.
4. Imported Bevy/Dust/Gecko and license-cleared dependency trees are pinned
   source inputs under `engine/`, `emulators/`, `libraries/`. Their nested
   upstream manifests are intentionally excluded from the root Cargo workspace
   until measured extraction into `iecode-*` members. This preserves source
   and notices without asserting a merged runtime or duplicate release graph.

## Package-manager rules

- Cargo: use the virtual root workspace, inherited package metadata,
  dependencies and lints, one `Cargo.lock`, explicit members/exclusions and
  `--locked` in gates. [Cargo workspace reference](https://doc.rust-lang.org/cargo/reference/workspaces.html).
- Bun: declare every active package in `workspaces.packages`, share versions
  through the root catalog, use `workspace:*` for local package links, commit
  one `bun.lock` and verify with `bun install --frozen-lockfile`. TypeScript 7
  remains semantic checker; Oxlint/Oxfmt own lint/format.
  [Bun workspaces](https://bun.com/docs/pm/workspaces),
  [catalogs](https://bun.com/docs/pm/catalogs).
- uv: one root workspace and `uv.lock`; each member has its own
  `pyproject.toml`. Use `tool.uv.sources` with `workspace = true` for internal
  dependencies, not duplicated editable path declarations. Do not add pip or
  Poetry lockfiles. [uv workspaces](https://docs.astral.sh/uv/concepts/projects/workspaces/).
- .NET: keep `Directory.Packages.props` as the sole NuGet version source and
  locked restore. Let the target framework choose its supported C# language
  version; `LangVersion=latest` is deliberately removed because Microsoft
  warns that it makes builds machine-dependent.
  [Central Package Management](https://learn.microsoft.com/en-us/nuget/consume-packages/central-package-management),
  [C# version guidance](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/configure-language-version).
- CMake: expose logical targets and usage requirements, do not duplicate
  include/link flags between native modules; use root presets and the one
  vcpkg manifest. Keep upstream melonDS' C++17 requirement separate from
  IECODE's C++20 target. The root superbuild is the acceptance graph while
  upstream native source is being factored.
  [CMake build-system model](https://cmake.org/cmake/help/latest/manual/cmake-buildsystem.7.html),
  [presets](https://cmake.org/cmake/help/latest/manual/cmake-presets.7.html).

## Current convergence gates and gaps

`bun run doctor` checks workspace membership and prefixes; `cargo check
--workspace --tests --locked` validates the active Rust graph; locked .NET
restore/build/tests validate the managed graph. `bun run format:check` and
`bun run lint` include Oxlint/Oxfmt alongside Rust and Python.

The NIE Bun packages were imported before their generated game formations
JSON and `nie-ffi` native symbols were available here. Their TypeScript test
and native integration gates are therefore **not green**; do not replace the
missing game data with invented data or silently skip native assertions. The
separate legal/build blockers for Dust and Gecko are in
[Fork integration](./FORK-INTEGRATION.md). The next real merge is to move the
licensed `nie-ffi` Rust implementation and private-data generation pipeline
behind IECODE's single ABI, then update Bun consumers and fixtures together.
