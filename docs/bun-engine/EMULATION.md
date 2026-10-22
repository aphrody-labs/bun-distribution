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

## Static recompilation

`re recompile` (also `bun-engine recompile`) lifts GBA (ARMv4T ARM/Thumb with the BIOS),
PlayStation (MIPS R3000A BIOS and PS-EXE) and NES (6502) images through the bun-re pipeline and
emits a Rust crate over `bun_engine::recomp`, which links the same RustBoyAdvance-NG, StarPSX and
TetaNES device models through small runner hooks (`GameBoyAdvance::set_cpu_runner`,
`System::set_runner`, `ControlDeck::set_cpu_runner`). The crate builds as a native executable or a
`wasm32-unknown-unknown` module; code the static pass does not reach runs in the core interpreter.
Verification compares frame buffers and console output with `bun-engine run`. See
[`docs/re-pipeline.md`](../re-pipeline.md).

## RetroArch in process

The `vendor/retroarch` fork builds RetroArch as a shared library that its host paces:

```sh
cd vendor/retroarch && ./configure --enable-libretroarch && make -j"$(nproc)"
```

`packages/bun-engine/src/libretroarch.ts` loads `libretroarch.so` (`.dll`, `.dylib`) through
`bun:ffi` and drives it one `iterate()` per frame. Its `host` drivers hand over frames as
zero-copy views (XRGB8888 is already `bgra8unorm` for WebGPU, and RGB565 and the menu's RGBA4444
are converted through lookup tables), interleaved float stereo for an AudioWorklet, and RetroPad
bits per port. `command()` carries RetroArch's network command protocol (`PAUSE_TOGGLE`,
`SAVE_STATE`, `READ_CORE_MEMORY`, ...). Fast-forward runs extra core frames inside one
`iterate()`, up to 3/4 of a frame period. Every directory RetroArch writes to (saves, states,
core options, system, playlists) stays under `home`.

Configured with `--enable-egl`, `host` also serves OpenGL and GLES cores: it renders them in a
headless EGL context (Mesa surfaceless or pbuffer) and reads frames back through alternating
PBOs, one frame behind. Vulkan cores are not served by `host` yet.

The fork also has a native `webgpu` video driver (`--enable-webgpu`, with `--with-webgpu_libs` and
`--with-webgpu_cflags` pointing at wgpu-native or Dawn) for X11, and an emdawnwebgpu canvas path.
It does not run slang shader presets yet.

The launch router (`frontend/launch.ts`) lists it as `embedded:<core>` after the external
`libretro:<core>` route, so a host without a RetroArch executable still launches libretro games:
it needs only `libretroarch` and the core from `bep add libretro <core>`, and shares the BIOS
linking (`linkCoreBios`) with the external route. The `bun-engine` package builds and installs
`/usr/lib/libretroarch.so`.

`bun-engine retroarch --core <id|file> [content]` (`--frames N` runs headless and prints a summary) runs it behind `Bun.serve` and opens a WebGPU page:
one WebSocket carries frames (only when their serial changes, deflated, and dropped for a client
that falls behind), audio chunks for an AudioWorklet,
and the standard gamepad or keyboard as RetroPad bits. `RetroArchPresenter`
(`src/libretroarch-gpu.ts`) uploads XRGB8888 as `bgra8unorm` with `bytesPerRow = pitch`, RGB565
and RGBA4444 as `r16uint` unpacked in WGSL, and draws letterboxed; `capture()` reads the result
back. Bun has no `navigator.gpu`, so the presenter runs in a browser or `Bun.WebView`; headless
Chrome on a GPU-less Linux host needs `--enable-unsafe-webgpu --enable-features=Vulkan
--use-vulkan=swiftshader --use-angle=swiftshader`.

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
