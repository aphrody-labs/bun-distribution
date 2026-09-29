# Development environment

This page records the reproducible WSL setup validated on 2026-09-29. It does
not contain credentials; Steam and Valve developer authentication remains in
the user's existing private configuration.

## Installed toolchains

| Component | Validated version or location |
| --- | --- |
| .NET SDK | 10.0.112 on WSL; Windows SDK 10.0.401 |
| PowerShell | 7.6.6 |
| C/C++ | GCC 13, Clang 18/23, C++20 IECODE / C++17 upstream melonDS, CMake 3.25+, Ninja, Meson, ccache, Bison, Flex and Autotools |
| C/C++ analysis | clang-tidy 23, clang-format 23, clangd 23, Bear 3.1.3 and Cppcheck 2.13.0 |
| Windows native | Visual Studio Build Tools 2026 / MSVC v145, Windows SDK 10.0.26100, C++/WinRT |
| Rust | pinned by `rust-toolchain.toml`; sccache is the workspace compiler wrapper |
| Bun / TypeScript | Bun 1.4.2, TypeScript 7.0.2 |
| Python | root uv workspace and `uv.lock` |
| PPC reverse engineering | external `ppcdis` checkout at `$PPCDIS_ROOT` (`~/.local/share/iecode/tools/ppcdis`) |
| PowerPC compiler | official devkitPro devkitPPC 16.1.0 container exposed through `$DEVKITPPC` wrappers |
| vcpkg | `$HOME/.local/share/vcpkg`, bootstrapped without metrics |
| SteamCMD | `steamcmd` globally resolves to `/usr/games/steamcmd`; Valve client version 1788292693 after self-update |
| Steam client | Ubuntu `steam-installer` and Steam 32/64-bit runtime libraries |
| Proton | Valve Proton 5.13 and Proton Experimental `experimental-11.0-20260924-x86_64` in `~/.local/share/Steam/steamapps/common` |
| Locale | `en_US.UTF-8` is generated for Valve tooling; the default `C.UTF-8` remains supported |

## Persistent caches and shell setup

`~/.config/shell/env.sh`, `~/.config/nushell/env.nu`, and
`~/.config/powershell/Microsoft.PowerShell_profile.ps1` define the same
overridable variables:

- `APHRODY_ROOT` and `IECODE_ROOT`, pointing to the personal checkouts at
  `$HOME/aphrody` and `$HOME/iecode`. The IECODE gate binding resolves the
  Aphrody workspace from `APHRODY_ROOT` or the sibling checkout by default.
- `VCPKG_ROOT`, `VCPKG_DOWNLOADS`, `VCPKG_DEFAULT_BINARY_CACHE`,
  `VCPKG_BINARY_SOURCES`, `VCPKG_MAX_CONCURRENCY`, and
  `VCPKG_DISABLE_METRICS`.
- `DOTNET_ROOT`, `NUGET_PACKAGES`, `CCACHE_DIR`, `CMAKE_GENERATOR`, and
  `CMAKE_BUILD_PARALLEL_LEVEL`.
- `BUN_INSTALL`, `CARGO_HOME`, `RUSTUP_HOME`, `RUSTC_WRAPPER`, and
  `SCCACHE_CACHE_SIZE` for the Bun and Rust toolchains.
- `PPCDIS_ROOT`, pointing to the external ppcdis toolchain used by the legacy
  IEStrikers tools.
- `DEVKITPPC`, pointing to wrappers for the pinned official devkitPro image.
- `APHRODY_HOME`, GitHub, Google Cloud and OVH configuration paths, plus the
  non-secret Google Cloud project/location defaults. Credential contents remain
  in their existing private files and are never committed.

The vcpkg binary cache is `$XDG_CACHE_HOME/vcpkg/archives` (or
`~/.cache/vcpkg/archives`) and the source-download cache is
`$XDG_CACHE_HOME/vcpkg/downloads`. It is safe to keep them between builds;
they are not repository inputs.

`~/.local/bin` supplies the generic `clang-tidy`, `clang-format`, and `clangd`
commands as user-scoped links to their Clang 23 binaries. This preserves the
system compiler alternatives while making the analysis tools consistent across
Bash, Nushell, and PowerShell.

## Verification

```sh
dotnet restore IECODE.sln --locked-mode
dotnet build IECODE.sln --configuration Release --no-restore
dotnet test src/IECODE/Core.Tests/IECODE.Core.Tests.csproj --configuration Release --no-restore
bun install --frozen-lockfile
bun run typecheck
cargo check --workspace --tests --locked
cargo clippy --workspace --all-targets --locked -- -D warnings
cmake --preset unified
cmake --build --preset unified --parallel 2
```

The native preset was last run successfully on 2026-09-29. It builds the
portable IECODE C++ target and melonDS core, builds/checks the Rust FFI and CLI,
runs the Rust workspace tests, and runs the .NET Core suite (277/277 passing).
The superbuild disables melonds's optional GDB stub and Qt/SDL frontend for the
headless core build.

IEStrikers keeps its proprietary CodeWarrior and user-supplied game-binary
requirements outside the repository. Its PowerPC assembler dependency is
`DEVKITPPC`. The official devkitPro package service returned HTTP 403 from this
host, so the toolchain uses the official `devkitpro/devkitppc` container instead
(digest `sha256:44cb1a920e1ec3ec7c06767493c3b85f8d643d6137cc4661f0201895ac6e4967`).
Podman wrappers provide `powerpc-eabi-*` tools without vendoring binaries into
the checkout; `powerpc-eabi-gcc --version` reports 16.1.0 and a PowerPC ELF
smoke build has passed.

## Valve software boundary

SteamCMD anonymously installed and validated Valve Proton 5.13 (app 1420170)
and Proton Experimental (app 1493710). The Ubuntu Steam launcher and its
32/64-bit runtime libraries are also installed. The Steamworks SDK still
requires a licensed Valve developer account; neither credentials nor SDK files
may be committed to this repository.
