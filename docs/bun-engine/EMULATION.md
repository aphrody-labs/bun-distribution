# Bun Engine native engine sources

`crates/` is the unique root for native runtime, rendering, emulation, SDK,
firmware, compatibility, GPU and reverse-engineering source owners.

The checked-in gitlinks are executable upstream implementations, not placeholder
interfaces. The engine catalog binds each console to an exact source revision.
`libnds`, `libogc` and `open-agb-firm` provide the open SDK/firmware toolchain;
the Rust and C/C++ emulators consume homebrew and user-supplied test payloads.

The root build keeps one orchestration surface. Upstream projects that still
carry their own Cargo workspace are pinned under this root until their manifests
are normalized into the root Cargo graph; they are never represented by stubs.

## Native engine

`crates/bun-engine-core` (crate `bun-engine`) is the single native owner: one `machine::Machine`
trait, one input model, one wgpu/winit window and one CLI. It absorbed `bun-emu`,
`aphrody-nie-emu` (`backend`), `aphrody-emulator-host` (`host`) and `bun-engine-nds`
(`cartridge`). Consumers enable Cargo features (`window`, `nds`, `host`, `arm`, `x86`,
`cartridge`) instead of depending on separate crates.

## Arch Linux image

`factory/images/bunos-gaming` has an `emulation` target: the gaming image plus every emulator
binary from `emulation.packages` (RetroArch and libretro, MAME, ares, Mednafen, melonDS, DeSmuME,
Dolphin, Azahar, Cemu, mGBA, SameBoy, Mupen64Plus, RMG, Snes9x, bsnes-hd, Nestopia, FCEUX, PCSX2,
DuckStation, RPCS3, PPSSPP, Vita3K, shadPS4, Flycast, xemu, DOSBox Staging, ScummVM, 86Box, QEMU
with OVMF/AArch64 UEFI and swtpm, Waydroid and Android tools) and the `bun-engine` package from
`factory/bunos/pkgbuilds`. Packages absent from the pinned repositories are built from the AUR;
anything that still fails is listed in `/usr/share/bun-os/missing-packages.txt`.

```sh
bun factory image build bunos-gaming --target emulation
```
