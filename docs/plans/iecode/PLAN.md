# IECODE execution plan

Status: stabilization baseline, 2026-09-22.

This is the execution ledger for the unified IECODE repository. IECODE owns portable tooling and
libraries; game-specific IEVR/Victory Road runtime code is being absorbed from `nie`.
The single IEVR migration ledger is [`../src/nie/PLAN.md`](../nie/PLAN.md). The complete remaining
work matrix, ownership rules and exit gates are in [`docs/REMAINING-WORK.md`](../../reference/iecode/REMAINING-WORK.md).

## Frozen architecture

- Rust is the default owner for new portable emulator, WASM and WebGPU logic.
  Aphrody's stable toolchain, workspace dependency style and verified shared
  crates are the baseline. Existing native and managed code moves only through
  measured extraction; IEVR-specific Rust runtime moves into IECODE by slice.
- `IECODE.sln` is the only .NET solution.
- `src/IECODE/Core` owns reusable format, archive, conversion, save, modding and media logic.
- `src/IECODE/Cli` is the only .NET command-line host.
- `src/IECODE/Gui` is the only .NET desktop host. Avalonia owns the application lifetime;
  FluentAvalonia supplies navigation and Fluent density; Material Icons supplies the shared icon
  vocabulary. Plugins contribute through `Gui/Shell` and never create a second host.
- `src/IECODE/Ffi` is the .NET native boundary.
- `src/IECODE/Core.Tests` is the .NET regression suite.
- `src/iecode-cpp` is the only C/C++ source owner, including the pinned melonDS emulator
  subsystem at `emulation/melonds`. It contains no C# project and is not part of the .NET
  solution. All managed code, including NDS parsing and viewer integration, lives under
  `src/IECODE`.
- Rust, Bun, C/C++, and Python remain in their existing workspaces until measured extraction;
  they do not duplicate .NET source or add another .NET host.

## GUI contract

One shell registry serves menus, toolbars, keyboard gestures and plugin contributions. The save
editor, NDS viewer, toolbox text decoder and IEVR configuration/mod/profile management are
integrated surfaces. New UI puts logic in a library/view-model first, uses shared Fluent/Material
resources, gives icon-only controls automation names, and preserves keyboard and screen-reader
access.

## Version policy

The SDK is pinned by `global.json`. NuGet versions are centrally managed in
`Directory.Packages.props`; projects contain no version literals. Lock files are retained for all
active projects and restore is locked. A major UI or package upgrade requires a complete restore,
build and regression report.

## Stabilization gates

```sh
dotnet restore IECODE.sln --locked-mode
dotnet build IECODE.sln --configuration Release --no-restore
dotnet test src/IECODE/Core.Tests/IECODE.Core.Tests.csproj --configuration Release --no-restore
bun run doctor
git diff --check
```

Generated build directories, caches, node modules, vcpkg installations and copyrighted game dumps
are not release inputs and must not be committed.

## Decision ledger

- 2026-09-22: froze the .NET surface at one solution, four runtime projects and one test project.
- 2026-09-22: selected Avalonia 11.3.22, FluentAvaloniaUI 2.0.5 and Material Icons 2.1.10 as
  the validated compatibility line; a major upgrade is a separate migration.
- 2026-09-22: integrated the NDS viewer, toolbox decoder and IEVR shell through the host registry.
- 2026-09-22: the publication target is the existing private GitHub repository
  `aphrody-code/iecode-csharp`; no second remote is created.

## Next measurable work

The active sequence is maintained in [`docs/REMAINING-WORK.md`](../../reference/iecode/REMAINING-WORK.md). The next
batch is player import/export/replace through a library service, followed by the first real
Avalonia reserve/player contribution. Every batch must leave the five-project solution and the
workspace/native gates green.

- 2026-09-22: the unified native preset was validated through C++ IECODE, winDS, Rust tests and
  the .NET regression suite. `VCPKG_ROOT` is supplied by the invoking environment through the
  preset; no checkout path is embedded in the repository.
- 2026-09-22: completed the first post-freeze contract cleanup: the NDS memory stream now exposes
  explicit read-only semantics, viewer converters return Avalonia's unset sentinel when reverse
  conversion is undefined, and the repeated-item helper is a real read-only enumerable. The
  stream contract is covered by two regression tests (276 total Core tests passing).
- 2026-09-22: completed the NDS plugin association matcher: hexadecimal and ASCII magic prefixes
  are supported without mutating the source reader, with regression coverage in the Core suite
  (277 tests passing). No plugin matcher path remains an unimplemented stub.
- 2026-09-22: extracted recruit, dismiss and recruitable-player selection into
  `src/IECODE/Gui/IESEViewModel/Services/PlayerRosterService.cs`; save information now reads from
  the loaded game instead of placeholder values. The export command and imported-player replace
  flow remain explicitly listed in `docs/REMAINING-WORK.md` because their storage binding is not
  complete. The solution build passed with 0 errors and the Core suite passed 277 tests.
- 2026-09-23: gate sweep brought `bun run check:all` back to green. The doctor now audits the
  Git-visible tree (`git ls-files`) instead of `find`, so disposable output of other gates no
  longer trips it and the native-in-managed check really runs on every host; it exposed the
  Kamek/PowerPC Strikers 2013 Xtreme mod under `src/IECODE/Gui/PlaylistMaker`, now moved to
  `src/iecode-cpp/mods/strikers2013-xtreme` (the managed PlaylistMaker helper stays in
  `src/IECODE`). The license audit compares POSIX paths and skips Git-ignored bytecode; Python
  bytecode is ignored; `uv.lock` records the `niepy` member; Ruff lints `niepy` and leaves the
  `src/iepy` submodule to its own gates; `Microsoft.NET.Test.Sdk` restores from nuget.org
  (the `dotnet10` feed mapping lacked 18.10.1). Locked restore, Release build (0 errors) and
  277 Core tests pass. The unified CMake preset remains blocked locally by the vcpkg baseline
  commit missing from `VCPKG_ROOT` and no MSVC developer environment.
- 2026-09-23: infrastructure consolidation. `aphrody-infra` is now the only orchestrator,
  pipeline, toolchain and release authority; IECODE keeps application code plus thin `bun run`
  gates. Removed Turborepo (`turbo.json`, `turbo` devDependency, `orchestrate` script) and the
  inert nested CI/agent configuration (`src/iecode-cpp/.github`, `src/winDS/.github`,
  `src/winDS/.claude` with its orphaned `scripts/claude` hook). Added gates `format:check`
  (rustfmt + Ruff format), `lint` (clippy `-D warnings` + Ruff), `test:rust` (nextest) and
  `release:check` (`cargo publish --dry-run` of the six portable crates). Pinned Rust with
  `rust-toolchain.toml` to aphrody-infra's `nightly-2026-05-17`. `publish-rust-crates.sh` and
  `github-history-audit.sh` moved to `aphrody-infra/scripts/iecode/` (`IECODE_ROOT`). Python:
  root, IEStrikers and mapenv floors aligned to `>=3.10` (the lock's effective intersection),
  Ruff targets `py310`, uv pinned to `==0.12.17`, nested `uv.lock`/`requirements.txt` removed
  (root lock covers all five members), `niepy` reformatted. Removed the unused
  `Microsoft.EntityFrameworkCore.Sqlite` reference and the VPS default game path; winDS
  `.env.example` no longer lists VPS deploy keys. Measured: doctor, typecheck, bun test (9),
  check:rust, check:python, format:check, lint, test:rust (93 passed, 1 skipped), release:check
  and the .NET Release build (0 errors) pass. `niepy` pytest needs the sibling `nie_ffi` library
  and a local game root (17 failures, 48 passed) and is not a gate yet.
- 2026-09-25: category-repo migration. The only reference to the retired `aphrody-code/aphrody`
  monolith was the managed CI caller `.github/workflows/aphrody-ci.yml`; it now calls
  `aphrody-code/aphrody-ai/.github/workflows/aphrody-reusable-ci.yml` pinned at `34e110340e71`
  (the commit that imported the workflow into `aphrody-ai`). That copy defaults uv to `0.12.17`,
  matching `required-version`; the old pin defaulted to `0.11.19`. No Cargo, Bun, tsconfig,
  script or doc path referenced `../aphrody` or `../aphrody-os`. Measured: doctor, typecheck,
  bun test (9), `cargo check --workspace --all-targets --locked` and `check:python` pass. The
  reusable Python job's default `uv run pytest` still hits the known `niepy` data failures and
  the `inz_cond` PyQt6 (optional extra) collection error; hosted Actions runs currently end in
  `startup_failure` for every aphrody-code repository, including self-contained workflows.
- 2026-09-29: normalized Rust workspace publication metadata to the IECODE repository and
  English package metadata. Verified with `cargo check --workspace --tests --locked` and
  `cargo clippy --workspace --all-targets --locked -- -D warnings` (10 workspace packages,
  both commands exit 0). The Bun workspace remains one lockfile and was revalidated on Bun
  1.4.2 with TypeScript 7.0.2 (`bun install --frozen-lockfile`; two package typechecks pass).
- 2026-09-29: provisioned the shared WSL toolchain: .NET SDK 10.0.112, PowerShell 7.6.6,
  GCC/Clang/MinGW, CMake, Ninja, ccache, Wine 32/64, X11/Wayland/OpenGL development headers,
  Bison/Flex/Autotools, and the official SteamCMD client. `vcpkg` is installed at
  `~/.local/share/vcpkg` with persistent source and binary caches under `~/.cache/vcpkg`;
  Bash, Nushell, and PowerShell now declare the same overridable toolchain/cache variables.
  The full native root-manifest installation completes through the cache, and the unified CMake
  build has passed the .NET stage (277 Core tests) while native winDS configuration continues.
  See `docs/DEVELOPMENT-ENVIRONMENT.md` for non-secret reproducibility details and the Valve
  authentication boundary.
- 2026-09-29: completed the unified native validation. The root superbuild now explicitly
  disables winDS's optional GDB stub because its `debug/GdbStub.*` sources are not present in
  this checkout, matching the documented winDS build contract. With the shared environment
  loaded, `cmake --preset unified && cmake --build --preset unified --parallel 2` succeeds:
  IECODE C++, winDS core, Rust FFI/CLI/workspace tests, and the .NET Core suite (277/277) all
  complete. GCC 13 emits existing deprecation warnings in winDS; no new warning policy was
  introduced by this batch.
- 2026-09-29: removed the stale IEStrikers `ppcdis` submodule declaration. ppcdis is now an
  external user-scoped tool selected through `PPCDIS_ROOT`, with the same default in Bash,
  Nushell and PowerShell; the shared checkout is at
  `~/.local/share/iecode/tools/ppcdis` (commit `774b594`). `uv lock --check` and an
  IEStrikers `common` import pass with the new boundary. devkitPPC remains an external native
  build prerequisite and is checked only by `configure.py`; its official package endpoint
  returned HTTP 403 from this host, so no incompatible replacement was installed.
- 2026-09-29: completed the PowerPC toolchain fallback through the official
  `devkitpro/devkitppc` container, pinned to digest
  `sha256:44cb1a920e1ec3ec7c06767493c3b85f8d643d6137cc4661f0201895ac6e4967`.
  User-scoped `DEVKITPPC` wrappers invoke the complete `powerpc-eabi-*` tool set
  with Podman and no network access. `powerpc-eabi-gcc --version` reports
  devkitPPC 16.1.0; a C smoke build and objdump inspection produced a valid
  `elf32-powerpc` object. Bash, Nushell, and PowerShell expose the same path.
- 2026-09-29: completed the Valve runtime setup. SteamCMD (client version
  1788292693) anonymously installed Proton 5.13 (app 1420170, build 8410451)
  and Proton Experimental (app 1493710, build 25502719) under the shared Steam
  library. The Ubuntu Steam launcher, Steam device rules, and 32/64-bit Steam
  runtime libraries are installed. Steamworks SDK acquisition remains outside
  the checkout because Valve requires a licensed developer account.
- 2026-09-29: completed the host C/C++ analysis-tool inventory with explicit
  Clang 23 tooling (`clang-tidy`, `clang-format`, and `clangd`), Meson 1.3.2,
  Bear 3.1.3, and Cppcheck 2.13.0. Version checks completed successfully;
  Clang's default compiler selection remains unchanged.
- 2026-09-29: exposed the Clang 23 analysis tools through user-scoped generic
  command names in `~/.local/bin`. Bash, Nushell, and PowerShell all resolve
  `clang-tidy`, `clang-format`, and `clangd` to version 23 without changing
  any system compiler alternative.
- 2026-09-29: corrected the Steam ownership decision using the remote Git
  history of `aphrody-code/nie` (the local sibling checkout has invalid Git
  metadata). `nie-steam` is the selected IEVR Steam implementation: it is the
  Rust/steamroom port of IECODE's SteamKit2 depot stack and includes the
  game-specific emulator converged with `nie-net`. IECODE keeps its managed
  interop compatibility layer until a measured consumer migration. See
  `docs/STEAM-ARCHITECTURE.md`.
- 2026-09-29: the NIE consolidation ledger was unified in
  [`../src/nie/PLAN.md`](../nie/PLAN.md). Initial Bun game packages moved into this
  workspace; remaining Rust, Python and host cutover work is tracked there.
- 2026-09-29: replaced the active WinDS-derived emulator input with official
  melonDS source at `906e9ebb27da8c6a715cd7abab4abfe8a8d29427`. It is now the
  `src/iecode-cpp/emulation/melonds` subsystem; the duplicate WinDS/DS32 tree
  was removed after preservation in Git history. No nested Git checkout,
  restore cache or bytecode is retained. The root CMake target is `melonds`
  and uses root-owned vcpkg overlays. The headless upstream core built 88 units
  and linked successfully. See `docs/MELONDS-UPSTREAM.md`.
- 2026-09-29: documented the session-level consolidation record and established
  `iecode_native` as the one CMake aggregation target for portable IECODE C++
  and the pinned melonDS core. The two source trees remain separate on purpose:
  IECODE owns portable code while melonDS remains an updateable upstream GPL
  snapshot. See `docs/SESSION-2026-09-29.md` and `docs/CPP-UNIFICATION.md`.
- 2026-09-29: aligned persistent Bash, Nushell and PowerShell development
  environments for Bun, Rust, .NET, vcpkg, CMake, cache, PowerPC, Aphrody and
  cloud configuration paths. All values are overridable and no credential value
  is stored in the repository. See `docs/DEVELOPMENT-ENVIRONMENT.md`.
- 2026-09-29: began the physical C/C++ convergence: the active melonDS source
  now lives under `src/iecode-cpp/emulation/melonds`, while duplicate WinDS/DS32
  source was removed from the checkout after its preservation in earlier Git
  commits. The combined emulator distribution is GPL-family licensed; provenance
  and component notices are tracked in `LICENSES.md` and `THIRD_PARTY.md`.
- 2026-09-29: refreshed the root vcpkg baseline to `58845ed63eb19aff55e896ea1f5d51f2a0df5b66`
  (assimp 6.0.5, cpp-httplib 0.58.0 and expat 2.8.5). The global toolchain
  remains intentionally conservative: CMake 3.25+, C++20 for IECODE and the
  upstream melonDS C++17 baseline. The combined build remains the acceptance gate.
- 2026-09-29: accepted the five-platform IECODE emulation direction in
  `docs/EMULATION-PLATFORM-DECISION.md`: headless native C/C++20 libraries,
  Rust-first emulator candidates when fixture tests justify them, one versioned
  C ABI for C#/Rust/Bun/Python, C# for Windows/modding/launching, Python for
  extraction/RE/data work, and separately owned IEVR runtime in `nie`.
  `crates/emu` now represents Switch as a reference-only NxEmu candidate and
  Steam as Proton compatibility rather than a console emulator. Five new
  synthetic-data-free platform contract tests pass; these do not claim game
  execution. Measured `cargo test --workspace --locked`: 103 passed, 1 ignored;
  `cargo clippy -p iecode-emu --all-targets --locked -- -D warnings`,
  `cargo check --workspace --tests --locked`, `cargo fmt --all --check`,
  `bun run doctor`, and `bun run test` (9 passed) all exit 0. Real headless
  boot fixtures for all five platforms remain the required next acceptance
  gate; Level-5 files stay private and outside Git.
- 2026-09-29: set Rust as the default owner for new IECODE emulation, WASM and
  WebGPU logic, while C/C++ remains the foreign-core/homebrew compatibility
  surface. Matched `rust-toolchain.toml` to Aphrody Infra/AI/OS/Native/Contracts
  stable `1.98.1` (same targets and components), added the Aphrody Rust 2024
  formatter policy and mechanically formatted the IECODE Rust workspace.
  `cargo fmt --all --check` and `git diff --check` pass. Dependency alignment is
  recorded in `docs/APHRODY-RUST-BASELINE.md`; the pre-existing uncommitted
  `rusqlite` 0.40 request in `Cargo.toml` conflicts with committed lock 0.37,
  so `cargo check --workspace --tests --locked` stops before compilation.
  That manifest/lock pair remains outside this batch and must be reconciled
  before the full Rust gate can be reported green. An isolated clean worktree
  at `ca780f8` passed the stable `1.98.1` workspace tests (103 passed,
  1 ignored) and Clippy `-D warnings`; the worktree was then removed.
- 2026-09-29: fixed the Rust-first headless emulator boundary in
  `docs/RUST-HEADLESS-EMULATION.md` and added a pure `crates/emu::headless`
  virtual-clock/snapshot contract. No console core, renderer, Steam/EAC adapter
  or official SDK is claimed as integrated. Direct Rust 2024 synthetic tests:
  3 passed; `cargo fmt --all --check` and `git diff --check` pass. The
  `cargo test -p iecode-emu --locked --offline` gate stops before compilation
  because the pre-existing `Cargo.toml` rusqlite 0.40 change is not reflected
  in `Cargo.lock`; that pair remains outside this batch. Next: legal homebrew
  boot fixture and deterministic replay for the first console adapter, then
  separate GPU/WASM and SDK/Steam integration gates.
- 2026-09-29: reset Rust ownership without deleting IECODE history: IECODE is
  the emulator integration sandbox, and stable, deduplicated Rust APIs move to
  their Aphrody category owner only with fixtures, provenance and platform
  gates. Created the full-history public `aphrody-code/bevy` fork and the
  `aphrody/stable-0.19.1` product branch at upstream `v0.19.1`; its isolated
  `aphrody-engine-host` package supplies a manually stepped headless game host.
  In the fork, 2 unit tests, Aphrody-only Clippy `-D warnings`, formatting and
  diff checks pass. Upstream Bevy 0.19.1 itself trips two Rust 1.98 Clippy
  diagnostics, so the fork's narrow gate uses `--no-deps`; no upstream source
  or IECODE emulator core was changed to silence them. IECODE's emulator
  contract remains a prototype, not a boot-tested console or production crate.
- 2026-09-29: moved the complete IECODE Git checkout from the Aphrody source
  workspace into the personal directory. Retained the established internal
  `src/IECODE` and `src/iecode-cpp` layouts after correcting an initial
  interpretation; removed one stale nested `nie.code-workspace`. Imported
  source-only Bevy, Dust, Gecko and nine license-cleared Git dependency forks
  under `engine/`, `emulators/` and `libraries/` with no nested Git or
  submodules. Exact revisions, excluded media and unlicensed/missing inputs
  are in `docs/FORK-INTEGRATION.md`. Root Cargo explicitly excludes upstream
  trees; `crates/emu` now points to the local Dust/Gecko sources, without
  claiming those cores are linked. The one-owner layout and official
  Cargo/Bun/uv/.NET/CMake conventions are in `docs/MONOREPO-CONVENTIONS.md`.
  Reconciled the pre-existing `rusqlite` 0.40 manifest with lockfile 0.40.2,
  synchronized the Bun membership manifest, added Aphrody-aligned Oxlint
  1.86.0/Oxfmt 0.71.0 gates, formatted Bun packages and removed .NET's
  machine-dependent `LangVersion=latest`. Measured after relocation: doctor
  (10 Rust, 5 Bun), Rust workspace (106 passed, 1 ignored), Clippy and check
  green; Bevy host 2 passed; Gecko `image` and `disasm` build; locked .NET
  restore/build and 277 Core tests green; unified CMake build green, native
  468 passed with 6 disabled; Python uv/Ruff and Bun Oxlint/Oxfmt green; 19
  imported/native source roots pass the license audit. IECODE Bun core/FFI
  tests pass (7+2), NIE plugin passes (4, 1 skip). Full Bun typecheck/test
  remain red because the imported NIE game package lacks its generated
  `formations-full.json` and `@aphrody/nie` still requires absent `nie-ffi`
  symbols. Dust's unlicensed Git dependencies and Gecko's unlicensed
  Solstice/beanwii inputs keep their main cores out of the production graph.
  The existing private `aphrody-code/iecode-csharp` repository was renamed in
  place to `aphrody-code/iecode`; the original Git history and one `origin`
  remote remain intact. This supersedes the 2026-09-22 publication-name entry.
- 2026-09-29: completed checkout relocation follow-up. The independent Bevy,
  Dust and Gecko full-history fork checkouts now live outside the Aphrody
  `src/` superproject; their source-only snapshots and pinned revisions remain
  inside IECODE. The old `src/iecode` gitlink and `.gitmodules` entry were
  removed from the superproject, while NIE's six Cargo path dependencies,
  three Bun fixture paths, shell helper and CI preflight were updated for the
  personal IECODE checkout. Infra's IECODE script defaults and workstation
  package paths were updated to the same location. `cargo metadata --locked
  --no-deps` passes in NIE; its full build remains blocked by the absent
  `formations-full.json` game dataset documented above. This is a checkout
  migration, not completion of the broader NIE absorption ledger.
- 2026-09-29: began the measured IEVR Rust extraction. Moved the 254 tracked
  files of NIE's `nie-data` into `crates/ievr-data` as the private,
  non-publishable `iecode-ievr-data` package, retaining the `nie_data`
  library import for consumers. At the source-transfer boundary 252 files
  matched byte-for-byte and two were adapted; the new owner then applied its
  rustfmt policy. NIE's workspace alias now resolves the IECODE crate, with
  `serde` and `serde_json` inherited from IECODE's workspace and both Cargo
  locks refreshed. The library's 98 unit tests and the IECODE workspace's
  1,516 tests (1 ignored), Clippy `-D warnings`, formatting, and locked Cargo
  check pass. NIE `cargo metadata --locked` and its `nie-ocgen` consumer pass,
  but `nie-core` still cannot compile without three absent
  game-derived JSON inputs. The commercial source-rights boundary remains
  separate from IECODE's GPL/Apache components. See
  `docs/IEVR-DATA-MIGRATION.md`; the rest of NIE's migration remains open.
- 2026-09-29: aligned the compatible imported GPU fork manifests with NIE's
  exact `wgpu` 29.0.3 baseline: IECODE Cryoglyph now forms its own isolated
  Cargo workspace and checks offline; Iced's existing lockfile already pins
  29.0.3 and its manifest parses in locked mode. Gecko was already at 29.0.3.
  Dust remains on wgpu 23 pending a real API port and fixture-based GPU tests;
  no incompatible dependency was force-bumped.
- 2026-09-29: staged Infra's `@aphrody/workspace` package in the new Aphrody
  monorepo, retaining its current source checkout as rollback until a clean
  clone is qualified. The new root Bun workspace, lock and isolated install
  policy are present. Its TypeScript 7 typecheck and 11 tests pass; the new
  workspace CLI's IECODE doctor reports 11 Rust and 5 Bun members. IECODE's
  thin `scripts/aphrody-ops.ts` binding now sends doctor, license and Python
  quality gates to that new package, not the CLI from `src/aphrody-infra`.
  IECODE doctor and the 19 declared vendor/fork license roots pass; Python
  lint passes. The new Aphrody repository is still an uncommitted migration
  scaffold with no remote, so its clean-clone and publication gates remain
  open; this change does not mark the old checkout removable.
- 2026-09-29: aligned IECODE's Bun catalog with the new Aphrody root on Bun
  1.4.2, TypeScript 7.0.2, oxlint 1.85.0 and oxfmt 0.70.0. Frozen install,
  TypeScript lint and formatting pass. The full Bun typecheck remains blocked
  by missing `@nie/game` formations data; the full Bun test run also has
  existing `nie-ffi` symbol failures. No release gate is claimed.
