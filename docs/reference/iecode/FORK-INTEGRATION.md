# Rust fork source integration

Checked on 2026-09-29. The canonical IECODE checkout is in the user's personal
directory, outside the sibling Aphrody `src/` workspace. All paths below are
source snapshots in the **same IECODE Git repository**, not nested Git
repositories, submodules, package caches or release-ready merged crates.
The three optional full-history product fork checkouts are retained separately
outside the Aphrody `src/` superproject; they are not IECODE members or build
inputs. Their canonical IECODE source snapshots are the paths in the table below.

## Active language entry points

| Language | Single IECODE-owned entry point | Current source owner |
| --- | --- | --- |
| Rust | root `Cargo.toml` workspace | `crates/` and `apps/`; `crates/emu` owns the headless contract |
| C# | `IECODE.sln` | `src/IECODE/` |
| C/C++ | root `CMakeLists.txt` superbuild | `src/iecode-cpp/` |
| Bun/TypeScript | root `package.json` workspace | `packages/` |
| Python | root `pyproject.toml` and `uv.lock` | Python members in `src/` |

The imported upstream manifests are kept for provenance and isolated narrow
tests. They are **not** alternative IECODE package/release entry points. A
crate becomes an `iecode-*` workspace member only after its APIs, dependency
resolution, fixtures and licensing have been reconciled with `crates/emu`.
No emulator boot or cross-renderer GPU interop is claimed by this import.

## Source snapshots

| IECODE path | Source / product fork | Pinned revision | Local license evidence |
| --- | --- | --- | --- |
| `engine/bevy` | `aphrody-code/bevy`, upstream `bevyengine/bevy` | `12fb3d1c83bf639706b82a0921d9b4b34eab7f4e` | `LICENSE-APACHE`, `LICENSE-MIT` |
| `emulators/dust` | `aphrody-code/dust`, upstream `kelpsyberry/dust` | `76d79f25e4ea3ce355c4ac868f5ac9a233e64b89` | `LICENSE` (GPL-3.0) |
| `emulators/gecko` | `aphrody-code/emu.nintendo.wii.gecko`, upstream `Torashi1069/emu.nintendo.wii.gecko` | `39e82205a0da154f23fd36b95e64a8029d468618` | `LICENSE` (GPL-3.0) |
| `libraries/iecode-imgui-rs` | `aphrody-code/imgui-rs` | `7a8d2ed3b837f37bbe71f3f431bf5e1a4898cc30` | Apache-2.0/MIT notices |
| `libraries/iecode-slog-imgui` | `aphrody-code/slog-imgui` | `13d36cb78c112805e1185cfb43d6b9dc630919dc` | Apache-2.0/MIT notices |
| `libraries/iecode-wasmtime` | `aphrody-code/wasmtime` | `59ed12379df8beb8b0d7c825963033b68c2ebc9a` | `LICENSE` (Apache-2.0) |
| `libraries/iecode-iced` | `aphrody-code/iced` | `0d12e964da8c3f0f7a02d3d731e3187eecfe5779` | `LICENSE` (MIT) |
| `libraries/iecode-iced_aw` | `aphrody-code/iced_aw` | `0d6fe5f62ea12bfbbc97bf7076cc6063acf23c3f` | `LICENSE` (MIT) |
| `libraries/iecode-idb-rs` | `aphrody-code/idb-rs` | `843ae819f16aec0051c13b77d3ffccbbc70a3318` | `LICENSE` (Apache-2.0) |
| `libraries/iecode-chipi-spec` | `aphrody-code/chipi-spec` | `faaf9f1293b3a858264f51906838c2d12492c50e` | `LICENSE` (MPL-2.0) |
| `libraries/iecode-cryoglyph` | `aphrody-code/cryoglyph` | `53ba3e879539d19ed8162942126a977ec896cc3b` | Apache-2.0/MIT/Zlib notices |
| `libraries/iecode-winit` | `aphrody-code/winit` | `05b8ff17a06562f0a10bb46e6eaacbe2a95cb5ed` | `LICENSE` (Apache-2.0) |

The forked dependency revisions come from the Dust and Gecko Cargo lockfiles;
the three main trees come from their pinned product branches. Gecko's chipi
specification includes now resolve to the IECODE-owned `libraries/` source,
not a Git submodule. The other imported dependencies are source-preservation
inputs until Cargo manifests can safely switch from remote Git revisions to
local path dependencies. Upstream `wgpu` versions differ (Dust 23, Aphrody UI
26, Gecko and Bevy 29); no GPU type is shared across those versions.

Narrow checks on the imported source: Bevy's `aphrody-engine-host` passes 2
tests; Gecko's `image` crate passes its build/test (0 unit tests), and the
`disasm` crate compiles using the local Chipi specifications. These are not
full emulator boots. The root unified CMake build and 468 native IECODE tests
pass independently of the Rust emulator cores.

## Intentionally excluded and unresolved

- No ROM, game dump, BIOS, IPL binary, sample media, fonts, generated snapshot,
  package cache, build output, nested CI/agent configuration or nested `.git`
  was imported. Bevy example
  assets, Gecko `other/roms` and images, Dust fonts/screenshots, and IDB test
  databases/snapshots are deliberately absent; source-only snapshots cannot
  run every upstream example or fixture suite.
- Dust Git dependencies `emu-utils`, `arm-decoder`, `imgui-wgpu`,
  `discord-rpc`, and `imgui-memory-editor` have no detected license or root
  license file. They are not copied here. `emu-utils` also fails to compile at
  Dust's pinned revision with the tested stable/nightly toolchains because of
  unresolved portable-SIMD imports.
- Gecko's `beanwii` Git submodule has no detected license. Codeberg
  `hazelwiss/solstice` at its exact pinned revision has no root license, and
  Gecko embeds its `gc_custom_ipl.bin`; neither source nor binary is copied.
  `emulators/gecko` therefore cannot build its main core yet. This is an
  explicit missing input, not an invitation to add an empty IPL placeholder.
- GitHub permits platform forking, but a public repository without a license
  does not grant general redistribution rights. See
  [GitHub's licensing guidance](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/licensing-a-repository).

## Merge gate

1. Obtain redistributable alternatives or explicit licenses for the missing
   Dust/Gecko inputs; keep proprietary test files outside Git.
2. Boot legal homebrew fixtures in each core and measure deterministic
   CPU/bus/memory behavior against `crates/emu::headless`.
3. Extract console-exclusive core code into `iecode-*` workspace members;
   reuse one clock, input, save-state, FFI and frame contract. Keep Bevy as a
   game-engine module, not as a second emulator runtime.
4. Replace the isolated Git dependency declarations with local IECODE source
   paths only after locked builds, target checks and license audits pass.
5. Re-run the root Rust, Bun, Python, .NET and native gates before claiming a
   single production artifact. The GPL-family combined distribution must
   retain all component notices; Apache-2.0 alone is insufficient.
