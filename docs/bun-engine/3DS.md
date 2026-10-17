# Nintendo 3DS machine

Bun Engine runs the Nintendo 3DS through `crates/aphrody-ctr-emu`, with a standalone desktop and
browser frontend in `crates/aphrody-ctr-desktop`. The layout follows Dust (the DS core): a core
crate that owns the machine, and a frontend crate that owns the window, GPU presentation, audio
and input. This page records the audit that chose what is reused and what remains to be done.

## Audit

| Candidate | Location | Verdict |
| --- | --- | --- |
| Zakuro (MIT) | `vendor/zakuro` | Reused as the machine. About 63k lines of Rust: ARM11 interpreter with ARMv6K and VFP11 (`zakuro-cpu`), Horizon kernel SVCs and about 40 HLE services including `srv`, `fs`, `gsp`, `hid`, `apt`, `cfg`, `dsp`, `y2r`, `cam`, `ir`, `uds` (`zakuro-core`), CXI/CCI/CIA/ExeFS/RomFS readers (`zakuro-fs`), PICA200 rasteriser and shader interpreter/JIT (`zakuro-gpu`), saved states, cheats, mods, and an ahead-of-time recompilation hook. Builds for `wasm32` with the software renderer. |
| Azahar | `vendor/azahar` | C++ reference. Not linked; `cpp-host` can load it as a plugin. Used to cross-check service behaviour. |
| `aphrody-ctr` | `crates/aphrody-ctr` | Pure PICA command and register stream encoding/decoding (libctru/citro3d side). Kept as the SDK-side codec and test-vector producer. |
| libctru, ctru-rs, citro3d, citro2d, cargo-3ds | `vendor/libctru`, `vendor/ctru-rs`, `vendor/citro3d`, `vendor/citro2d` | ABI references for services, GSP command queues and the PICA register layout. The `.3dsx` loader follows the Homebrew Launcher conventions libctru expects. |
| Dust | `crates/aphrody-dust-core`, `-soft-2d`, `-soft-3d`, `-wgpu` | Structural model only. Its ARM9 (ARMv5TE) and ARM7 interpreters target the DS memory map and are not reused for the 3DS ARM11. |
| `bun-engine` | `crates/bun-engine-core` | Machine host. The `ctr` feature is now a thin `Machine` over `aphrody-ctr-emu`. |
| wgpu, winit | workspace | Used by the frontend. cpal (as in Zakuro) is used for native audio. |

Not reused: melonDS, Dolphin, rustboyadvance-ng, starpsx, tetanes (other consoles), and the Dust
ARM cores (wrong architecture and memory map).

## Architecture

```text
aphrody-ctr-desktop   winit window / WebGPU canvas, wgpu screen renderer, cpal audio, input
        |
aphrody-ctr-emu       Emu / Builder / Input / Video / Debug, 3DSX to CXI conversion
        |
zakuro-core           System: kernel, services, GPU glue, DSP, saved states
  zakuro-cpu          ARM11 MPCore (ARMv6K) + VFP11
  zakuro-gpu          PICA200 software rasteriser, shader interpreter/JIT, optional Vulkan
  zakuro-fs           NCCH / NCSD / CIA / ExeFS / RomFS
bun-engine (ctr)      Machine adapter used by `bun-engine run 3ds` and the Bevy runtime
```

### Core (`aphrody-ctr-emu`)

* `Emu::builder()` selects model (Old/New 3DS), region, language, 3D slider, owner name, data
  directory and a fixed clock for reproducible runs, then boots a path or an in-memory image.
* Images: decrypted `.cxi`, `.cci`/`.3ds`, `.cia`; homebrew `.3dsx` is relocated to
  `0x00100000` and wrapped as a NoCrypto CXI with an SVC-permissive exheader and an IVFC RomFS
  (`homebrew::cxi_from_3dsx`, previously private to `bun-engine`).
* `run_frame()` advances one screen refresh (268,111,856 Hz / 4,481,136 cycles, 59.83 Hz).
* `video()` returns the top (400x240), bottom (320x240) and, when the title renders stereo 3D,
  the right-eye top image.
* `take_audio()` returns DSP stereo PCM at 32,728 Hz. `take_console()` returns the
  `svcOutputDebugString` text libctru's debug console emits.
* `save_state()` / `load_state()` capture CPU, memory, kernel, services and GPU (postcard + LZ4).
* `debug()` gives registers, guest memory reads, the recent-instruction ring, the PC sampling
  profiler, services opened, unimplemented SVC numbers and `err:f` fatal errors.

### Frontend (`aphrody-ctr-desktop`)

* `Layout` stacks the screens, scales to the window and maps pointer positions to touch pixels.
* `Renderer` (wgpu 30) uploads both screens as `Rgba8Unorm` textures and draws them with a
  single pipeline; the top screen can show a red/cyan anaglyph of the two eyes.
* `aphrody-ctr` (feature `desktop`): winit window, cpal audio with drift-compensated resampling,
  keyboard and mouse input, F5/F9 saved states, F3 anaglyph, pause and fast-forward, and a
  `--headless N` mode for CI-style runs.
* `Ctr3ds` (feature `web`, `wasm32-unknown-unknown`): wasm-bindgen class that boots an image
  from bytes, draws to a WebGPU canvas, and exposes input, audio and saved states.

## Mapping to the requested plan

| Item | Status |
| --- | --- |
| ARM11 MPCore (ARMv6K + VFP11), memory, MMU, bus | Provided by Zakuro (`zakuro-cpu`, `zakuro-core::memory`). |
| ARM9 (ARMv5TE) and firmware | Not emulated. The HLE kernel and services replace the firmware, so no ARM9 core, boot ROM or key material is required. A low-level ARM9 core is future work if native firmware boot becomes a goal. |
| 3DSX, CIA, CCI/3DS, CXI boot | Done. Encrypted retail images need external decryption; no keys are shipped. |
| HLE kernel and services | Done by Zakuro (see audit). |
| PICA200 GPU, 400x240 / 320x240, stereo | Software rasteriser and shader interpreter/JIT, right-eye output, anaglyph presentation. Presentation is wgpu; rasterisation on wgpu is future work. |
| DSP audio, HID, saves, saved states | Done through Zakuro; HID covers buttons, circle pad, C-stick, touch and tilt. |
| Desktop and wasm frontends, Bun Engine integration | Done. |

## Validation

* Build: `cargo check -p aphrody-ctr-emu -p aphrody-ctr-desktop` (Linux hosts need the ALSA and
  udev development packages for cpal; Windows hosts can fail on unrelated C dependencies, so
  verify on the VPS).
* Browser: `cargo check -p aphrody-ctr-desktop --target wasm32-unknown-unknown
  --no-default-features --features web`.
* Target program: a libctru `.3dsx` built with `cargo 3ds build` (ctru-rs) runs with
  `aphrody-ctr app.3dsx`, or headless with `aphrody-ctr app.3dsx --headless 600`. No commercial
  ROM, Nintendo firmware or key is part of the repository.

## Licences

Zakuro is MIT-licensed (`vendor/zakuro/LICENSE`) and is consumed unmodified as a pinned
submodule. The homebrew loader follows the public 3DSX format. libctru, citro3d and ctru-rs
remain external references under their own licences.
