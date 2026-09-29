# IECODE emulation platform decision

Decision date: 2026-09-29. This document defines the target architecture; the
candidate inventory is not evidence that a runner is already linked or can boot
a game inside IECODE. `crates/emu` currently exposes metadata, not emulator
execution. The five platform tests in `crates/emu/tests/platform_contracts.rs`
check this contract with no game data; real boot tests are separate exit gates.

## Language ownership

| Surface | Owner | Boundary |
| --- | --- | --- |
| Portable emulation core, scheduler, device models, reusable codecs, VFS, WASM and WebGPU adapters | IECODE Rust sandbox, then the appropriate Aphrody Rust owner | Prototype and benchmark here; promote only a tested, deduplicated API with its fixtures and provenance |
| Existing IEVR runtime | Rust in sibling `nie` | IEVR-specific runtime stays in `nie`; portable crates move only after measured extraction |
| Foreign native emulator cores and console homebrew SDKs | `src/iecode-cpp` C/C++20 and target-side C | Headless adapters around source that cannot sensibly be written in Rust yet; no GUI dependency |
| Save editing, modding, installer, launcher, Windows-only integration and existing Level-5 utilities | `src/IECODE` C# | One .NET solution; GUI is a consumer, not the native core |
| Extraction, RE, data mining, scripting and ML tooling | One uv/Python workspace | Explicit file inputs and typed results; no duplicate native parser |
| Bun packages and browser surface | Bun/TypeScript | Thin C ABI or WebAssembly consumers |
| Graphics | Separate Rust render adapter | `wgpu` 30.0.1 target for native Vulkan/D3D12/Metal and browser WebGPU; platform-specific paths only for measured gaps |

The Rust-first portable emulator core owns virtual time, CPU/device state, memory, input,
audio/video output and state serialization. It must not own a window, file
picker, Steam account or GUI event loop. A versioned C ABI uses opaque handles,
explicit lifetimes, sized UTF-8/binary buffers and error codes. C++, Rust,
C#, Bun and Python bindings consume that ABI; no C++ exception or allocator
ownership crosses it. Per-console device timing and graphics semantics remain
separate even where utility code is shared.
IECODE is the validation sandbox, not the permanent production owner of every
Rust crate. The Bevy-derived game engine is owned by the separate
[`aphrody-code/bevy`](https://github.com/aphrody-code/bevy) fork; emulator
hardware cores do not acquire a Bevy dependency just because they share a host.

The concrete headless contract, adapter boundaries, legitimate Steam/EAC integration,
SDK packaging and selected Rust game-engine path are in
[`RUST-HEADLESS-EMULATION.md`](../../reference/iecode/RUST-HEADLESS-EMULATION.md). The small
`crates/emu::headless` lifecycle is executable but **not** a bootable emulator.

IECODE follows Aphrody's pinned stable Rust toolchain, Rust 2024 edition,
workspace-inherited dependencies/lints, formatting policy and strict check,
Clippy, test and license gates. Dependency versions and enabled features should
match the compatible Aphrody category owner when a crate is shared; do not
copy an unrelated dependency merely to make manifests look identical. The
toolchain pin is verified against `../src/aphrody-infra/rust-toolchain.toml`, not
guessed from a date.

## Platform decisions and real exit gates

| Platform | Preferred source path | Current IECODE state | Required runtime test before claiming integration |
| --- | --- | --- | --- |
| DS | Rust [Dust](https://github.com/kelpsyberry/dust) candidate; pinned melonDS is the native accuracy/reference path | melonDS source and headless core build exist; Dust is registry metadata only | Synthetic ARM9/ARM7 homebrew boots, deterministic frame/audio hash and save-state round trip in both cores |
| 3DS | C++ [Azahar](https://github.com/azahar-emu/azahar) candidate until a Rust core meets the same test | Registry metadata only; no Azahar source imported | Legal synthetic 3DS homebrew boots headlessly, frame hash and state round trip |
| Wii | Rust [Gecko](https://github.com/Torashi1069/emu.nintendo.wii.gecko) candidate; [Dolphin](https://github.com/dolphin-emu/dolphin) is the compatibility oracle | Registry metadata only; melonDS `src/dolphin` is JIT support, not a Wii emulator | Synthetic DOL homebrew boots, bounded frame/audio output and state round trip |
| Switch | C++ [NxEmu](https://github.com/N3xoX1/nxemu) evaluation candidate; no Rust candidate has passed acceptance | Reference-only registry entry; no Switch core imported | Independently licensed homebrew boots with no proprietary keys/firmware in the fixture; deterministic observable output |
| Steam/PC | Steam integration plus Valve [Proton](https://github.com/ValveSoftware/Proton) on Linux; **not** a console emulator | Compatibility reference only | Launch an IECODE-owned synthetic PC executable through an authorized local installation and verify exit, logs and cleanup |

The first five registry tests prove only that platform contracts and honest
integration states are represented. They are not substitutes for the runtime
tests above. A candidate cannot be marked `Available` until its source,
dependencies, headless build, C ABI adapter and fixture-based test all pass.
Rust is the implementation priority and the default for new shared logic. A
Rust upstream core is the first candidate when it meets these gates; the mere
existence of a Rust repository is insufficient to replace a more complete C++
emulator before fixture-based parity.

## Homebrew and assets

The C homebrew SDK candidates are [libnds](https://github.com/devkitPro/libnds)
for DS, [libctru](https://github.com/devkitPro/libctru) for 3DS,
[libogc](https://github.com/devkitPro/libogc) for Wii and
[libnx](https://github.com/switchbrew/libnx) for Switch. They are **target-side**
libraries, not host emulator cores. Inspect each license and transitive source
before importing; keep the original notices and track the exact revision.
Console menu artwork, firmware and BIOS images are separate from source code:
only independently licensed replacements or user-supplied material may enter
tests and distribution. Steamworks SDK remains account-gated and external.

Level-5-provided test files may be used only within the stated IE/RG development
agreement, in private local test storage with access controls. This decision
does not authorize publishing, committing or redistributing those files. The
repository's automated fixtures remain synthetic or explicitly redistributable.

## Migration order

1. Audit each candidate's exact revision, SPDX/per-file licenses, submodules,
   portability and independently reproducible headless build. Preserve source
   provenance and upstream history before any fork or source import.
2. Define a Rust-owned lifecycle and the C ABI, then prove it from
   C, Rust, C#, Bun and Python with the same synthetic fixture and ownership
   assertions. Keep C++20 requirements target-scoped; migrate melonDS source
   incrementally without changing timing behavior merely to satisfy syntax.
3. Integrate one platform at a time behind the common lifecycle. Remove each
   upstream GUI only after its core, debugger and test harness are independently
   buildable. Do not collapse console-specific hardware models into one class.
4. Add the runtime tests in the table, differential tests against reference
   cores, sanitizer/fuzzer jobs for untrusted formats, and GPU capability/fallback
   tests. Then expose launcher, save editor, Python and browser bindings.

The combined artifact's effective GPL obligations are documented in
`LICENSES.md`. An Apache-2.0 notice and a README credit do not relicense copied
GPL source. Any incompatible license or unavailable official source stops that
specific import, not the portable ABI work.
