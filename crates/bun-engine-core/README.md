# Bun Engine

Unified Rust kernel (`bun-engine` crate): plugin scheduling, binary inspection, the C ABI, and
every emulation machine behind one `machine::Machine` trait, one `machine::Input`, one wgpu/winit
window (`window`) and one CLI (`bun-engine run <system> <image>`). The same window hosts the native
game-stream client (`bun-engine stream`, see [STREAM.md](STREAM.md)).

## Absorbed owners

| Former crate | Now |
| --- | --- |
| `bun-emu` | `machine` (DS, ARM, x86), `window`, the `bun-engine` binary |
| `aphrody-nie-emu` | `backend` (backend registry, capability contracts, headless sessions) |
| `aphrody-emulator-host` | `host` (Bevy scheduling of the DS core) |
| `bun-engine-nds` | `cartridge` (DS header inspection), `bun-engine info`, `dotnet/` Tinke |

The native decompiler wrapper moved to `bun-re` (`decompile` feature); reverse engineering stays
with `crates/re`, rea and Replica.

## Features

`window`, `nds`, `host` (`bevy-web` for wasm), `nes`, `gba`, `psx`, `arm`, `x86`, `wii`, `ctr` (3DS), `switch`, `cartridge`, `stream` (game-stream client, default), `steam` (Steamworks: `steam::SteamPlugin`, the `steam` commands and `run --steam`; see `docs/bun-engine/STEAM.md`). Consumers take
`bun-engine` from the workspace with `default-features = false` and enable what they share.

## Commands

| Command | What it does |
| --- | --- |
| `bun-engine run <system> <image>` | Run a machine (table below) in the single window; `--headless --frames N --out DIR` dumps screens |
| `bun-engine info <rom.nds> [--json]` | Read-only DS cartridge header inspection |
| `bun-engine stream <host>` | Moonlight/GameStream client for Sunshine, Wolf or Moonshine: PIN pairing, launch, RTSP, encrypted ENet control with keyboard/raw-mouse/XInput forwarding, RTP + Reed-Solomon FEC video, zero-copy DXVA decode (H.264/HEVC/AV1) into wgpu, FSR1 EASU+RCAS upscale, low-latency present, latency HUD |
| `bun-engine stream --pair <host>` / `--apps` / `--quit-app` | Pair only (PIN printed for the owner to enter on the host), list host apps, stop the running app |
| `bun-engine stream --loopback` | Self-test without a server: synthetic pattern -> Media Foundation H.264 -> same RTP/FEC path over 127.0.0.1 -> decode -> FSR1 -> present, with a latency report |
| `bun-engine run <system> <image> --steam [--steam-appid N]` | Feature `steam`: run under Steam (AppID 480 by default): overlay with pause, Steam Input action sets, Rich Presence, screenshot hook, Steam Cloud saves keyed by ROM SHA-256 |
| `bun-engine steam status\|presence\|cloud\|input\|input-manifest\|stats` | Feature `steam`: client state, Rich Presence read-back, Remote Storage quota/list/round trip/sync, Steam Input manifest and handles, achievements stub |
| `bun-engine steam install-shortcut\|uninstall-shortcut` | Bun Engine and bep library games as non-Steam shortcuts with generated grid/hero/logo/icon art (Steam closed; backup, atomic write, verify) |

## Machines

| System | Core | State |
| --- | --- | --- |
| Nintendo DS | `aphrody-dust-core` (interpreter, soft 2D/3D, HLE BIOS) | runs: `bun-engine run nds <rom>` |
| Game Boy Advance | `vendor/rustboyadvance-ng/core` with Normmatt's free BIOS | runs: `bun-engine run gba <rom>`; jsmolka arm, thumb and memory tests pass |
| PlayStation | `vendor/starpsx/core` (StarPSX) with the free PCSX-Redux OpenBIOS | runs: `bun-engine run psx <exe|bin> --bios openbios.bin`; ps1-tests lines and animated-triangle render |
| NES | `vendor/tetanes/tetanes-core` (TetaNES) | runs: `bun-engine run nes <rom>`; 175 free ROMs via `bep roms nintendo-nes` |
| ARM firmware | `rdynarmic` A64 JIT, QEMU `virt` map (RAM 0x4000_0000, PL011) | runs EL0 code: `bun-engine run arm <image>` |
| x86 guests | Windows Hypervisor Platform partition, COM1 | runs flat images: `bun-engine run x86 <image>`; Linux 64-bit boot in progress |
| GameCube / Wii | `aphrody-wii-runtime` (Gekko/Broadway interpreter, DOL direct boot, XFB readback) | runs: `bun-engine run gc|wii <dol>`; GX scenes need the GPU renderer |
| Nintendo 3DS | `vendor/zakuro` (HLE kernel and services, software PICA renderer), feature `ctr` | runs: `bun-engine run 3ds <3dsx|cia|cxi|cci>`; `.3dsx` is relocated and wrapped in a NoCrypto CXI (RomFS included); FBI 2.6.1 (MIT) CIA and 3DSX reach the main menu on both screens |
| Switch | `crates/ruzu-*` (Ruzu, rdynarmic JIT, HLE services), feature `switch` | runs: `bun-engine run switch <nro|nso>` without keys or firmware; Ruzu's null renderer reads every composited framebuffer back from device memory (block-linear), so CPU-drawn surfaces (libnx console/framebuffer) show and GPU-rendered scenes stay black; `svcOutputDebugString` is the console, `BUN_ENGINE_LOG=1` echoes Ruzu warnings; nx-hbmenu 3.6.1 (ISC) boots and draws its console |
| Other Rust cores | `vendor/{gopher64,jgenesis,retroboy}` | pinned in the console catalog |
| C++ cores | `vendor/{ares,mame,retroarch}` | pinned in the console catalog |

## Stack decisions

- **Qt 6 front end:** `cxx-qt` (KDAB) for QObject/QML from Rust; it does not wrap QWidgets.
  `qmetaobject-rs` is the direct-API alternative.
- **Rust and C++:** `cxx` for interfaces we own, `autocxx` for large existing C++ trees such
  as the vendored emulators, `bindgen` for C, `cbindgen` for Rust-to-C headers.
- **Android from Rust:** `ndk` and `ndk-context` crates with `cargo-ndk`; JNI directly or
  UniFFI (JNA does not call `JNI_OnLoad`, so initialize `ndk-context` explicitly).
- **Hypervisor guests:** QEMU's Rust support covers device models only; accelerators stay
  C. For an in-process Windows guest use the `whpx` crate (x64 only); on Linux
  `kvm-ioctls` from rust-vmm.
