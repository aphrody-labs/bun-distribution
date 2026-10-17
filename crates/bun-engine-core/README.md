# Bun Engine

Unified Rust kernel (`bun-engine` crate): plugin scheduling, binary inspection, the C ABI, and
every emulation machine behind one `machine::Machine` trait, one `machine::Input`, one wgpu/winit
window (`window`) and one CLI (`bun-engine run <system> <image>`).

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

`window`, `nds`, `host` (`bevy-web` for wasm), `nes`, `gba`, `psx`, `arm`, `x86`, `wii`, `ctr` (3DS), `switch`, `cartridge`. Consumers take
`bun-engine` from the workspace with `default-features = false` and enable what they share.

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
| Switch | SWITCH_ROW |
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
