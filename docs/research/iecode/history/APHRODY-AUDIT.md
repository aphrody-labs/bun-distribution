# Aphrody repository history audit

Measured on 2026-09-22 from GitHub with `gh` authenticated as `aphrody-code`,
and from complete local mirrors under `/tmp/iecode-history.5sBKQE`. The mirrors
are disposable audit inputs and are not copied into this repository.

## Scope and totals

| Repository | Role | All-ref commits | Branches | Tags | Releases | PRs | IECODE action |
| --- | --- | ---: | ---: | ---: | ---: | ---: | --- |
| [`nie`](https://github.com/aphrody-code/nie) | IEVR/Victory Road runtime, formats, RE, site | 2,295 | 2 | 15 | 15 | 4 | Keep game-specific ownership in `nie`; consume only portable contracts. |
| [`iecode-cpp`](https://github.com/aphrody-code/iecode-cpp) | C++ extraction/format toolkit | 2 | 1 | 0 | 0 | 0 | Already restored under `src/iecode-cpp`; CMake remains a native backend. |
| [`iecode-csharp`](https://github.com/aphrody-code/iecode-csharp) | C# extraction/format toolkit | 2 | 1 | 0 | 0 | 0 | Absorbed into `src/IECODE/{Core,Cli,Gui,Ffi}`; .NET FFI joins `iecode-ffi`. |
| [`node-api-dotnet`](https://github.com/aphrody-code/node-api-dotnet) | .NET ↔ Bun/Node host and generator | 264 | 6 | 0 | 0 | 5 | Use official NuGet/Node API contracts through `IECODE.Ffi`; do not fork the implementation. |
| [`winclean`](https://github.com/aphrody-code/winclean) | Windows native tools, AOT and FFI SDK | 166 | 3 | 7 | 5 | 5 | Absorb ABI patterns and schemas; keep Windows-only tools outside portable core. |
| [`winDS`](https://github.com/aphrody-code/winDS) | melonDS-derived DS emulator | 3,841 | 68 | 26 | 0 | 5 | Keep as external GPL emulator reference; port IECODE-specific probes and fixtures only. |
| [`ghidra-suite-plugin`](https://github.com/aphrody-code/ghidra-suite-plugin) | Ghidra RE automation | 3 | 1 | 2 | 2 | 0 | Integrate headless RE contracts/scripts, never Ghidra itself into Rust core. |
| [`rs-bun`](https://github.com/aphrody-code/rs-bun) | Rust ↔ Bun FFI guidance and tooling | 4 | 1 | 0 | 0 | 0 | Applied in `packages/iecode-ffi` and `crates/ffi`. |
| [`bun-agent`](https://github.com/aphrody-code/bun-agent) | Bun migration and agent tooling | 8 | 1 | 1 | 0 | 0 | Keep management scripts only; no agent runtime in IECODE. |
| [`dbxv2`](https://github.com/aphrody-code/dbxv2) | General game RE/extraction reference | 4 | 1 | 0 | 0 | 0 | Reuse uv/ruff/RE workflow patterns, not Dragon Ball-specific data. |

The API count for `nie` is 1,719 commits on the default branch; the larger
2,295 count includes all fetched tags and branches. The same all-ref rule gives
264 for Node API and 166 for Winclean. Counts therefore must not be compared to
default-branch-only API counts without stating the ref set.

## Forgotten adjacent sources: RG and VPS

These two repositories were not in the first Aphrody-code-only pass.

| Repository | Role | All-ref commits | Branches | Tags | Releases | PRs | IECODE action |
| --- | --- | ---: | ---: | ---: | ---: | ---: | --- |
| [`rose-griffon/rg`](https://github.com/rose-griffon/rg) | Rose Griffon web/wiki monorepo, Inagle data and media presentation | 1,176 in the local checkout | 5 | 1 | 0 | 26 | Restore only portable media/catalog/url/player contracts into `packages/iecode-core`; keep DB, UI, bot, web routes and production data in RG/nie. |
| [`aphrody-code/vps`](https://github.com/aphrody-code/vps) | Deployment/infrastructure monorepo | 1,503 | 7 | 3 | 0 | 18 | Keep deployment, Nginx, systemd, secrets and release slots outside IECODE. Reuse only generic management conventions. |

The RG history contains the media work that must remain represented:

- `1f8e959f`: one shared structure for the four media collections;
- `4bceb873`, `d49dcf70`, `719e9781`, `9fe2f317`: technique-video URLs,
  variants, thumbnails, database projection and refresh pipeline;
- `68241120`: audio player and download contract;
- `419fab92`: catalogue-driven video page;
- `e170a51f`: extraction of the Azalee domain into a headless library;
- `66553d32`: explicit removal of old IECODE/UI coupling;
- `410ed795`: Azalee deployment ownership moved to `nie`.

Those commits explain why IECODE owns the pure catalogue, URL, work, manga,
video and player adapters while the site and database remain elsewhere. No
`apps/website`, `apps/achillea-bot`, `packages/db`, `packages/ui`, Supabase
schema, VPS unit, backup or production release artifact is copied into IECODE.

## Important historical decisions

### IEVR and Victory Road

`nie` owns the game-specific runtime. Its releases are `v0.1.0` through
`v0.5.11` with the missing `v0.5.5` tag/release gap preserved by the remote
history. The important portable work is already represented by IECODE's core
facade and ABI, while IEVR routes, game state, VFS data and copyrighted assets
remain in `nie`.

The two historical PRs that matter for restoration are:

- PR #1: `nie-explorer : roadmap complète (encodeurs, éditeurs, données, RE)`;
- PR #2: `restaure .gitignore + vague RE funcLua (5e lot)`.

They are provenance for the existing extraction/RE surfaces, not a reason to
duplicate those surfaces in IECODE.

### DS emulation and Inazuma Eleven

The exact IE-specific emulator commit is:

```text
winDS:e1e9d745ab9f22221cf0b7fd2dd9887d7d06e84f
fake enough of WEP processing to make Inazuma Eleven work
```

It changes `src/NDS.cpp` and `src/Wifi.cpp`: WEP-frame FCS handling, receive
cropping, memory capture and reduced noise around the wireless I/O range. This
is recorded as the canonical DS compatibility fixture. IECODE must port the
behaviour into a tested Rust/native adapter or keep the upstream library as an
explicit dynamic backend; it must not silently claim that `iecode-emu` itself
implements a complete DS CPU/Wi-Fi emulator.

### FFI and .NET

`winclean` commit `705a57611391` is the model for the current IECODE ABI: a
flat C library, explicit allocation/free, sync/async entrypoints, JSON-schema
code generation and Bun/Rust consumers. `node-api-dotnet` commits
`33a1dc9981aa`, `0961d2a5f052` and `0f607ea7b28c` provide the .NET 10 and Bun
generator integration. IECODE now has the corresponding `iecode-core`,
`iecode-ffi`, Bun binding and `IECODE.Ffi` adapter.

## Provenance policy

- Restore source only when it is IECODE-owned or a portable adapter is being
  ported under its original license.
- Record third-party emulator and RE repositories as pinned external backends;
  do not vendor their full history, binaries, ROMs, BIOS, dumps or assets.
- Prefer the newest complete branch/tag for a capability, then record the exact
  commit that supplied a measured behaviour.
- Every absorbed capability has one owner: Rust core logic, native backend,
  .NET adapter, Bun adapter or RE script. No duplicate implementation is accepted.

The reproducible inventory command is `aphrody-infra/scripts/iecode/github-history-audit.sh` (sibling repository, owned by aphrody-infra).
