# Nintendo DS and 3DS SDK (`aphrody-nds-sdk`)

One SDK to develop and test DS and 3DS games (Inazuma Eleven first) on the Bun OS workspace. It
joins the cores that already exist instead of adding another emulator:

| Piece | Owner | Role in the SDK |
| --- | --- | --- |
| Dust | `crates/aphrody-dust-core`, `-soft-2d`, `-soft-3d` (`-wgpu`, `-cli` stay standalone) | Nintendo DS machine |
| Zakuro | `vendor/zakuro` through `crates/aphrody-ctr-emu` (`docs/bun-engine/3DS.md`) | Nintendo 3DS machine |
| Bevy 0.20 | `crates/bevy*` | `HandheldPlugin` (screens, input, audio, events) |
| Bun Engine | `crates/bun-engine-core` | `ds`/`3ds` machines run through the SDK (`machine::handheld`) |

## Audit

* The DS machine was a private ~200 line adapter inside `bun-engine` (`machine/nds.rs`). It moved
  into the SDK and gained persistent backups, saved states, registers and memory access.
* The 3DS machine was a private adapter inside `bun-engine` (`machine/ctr.rs`); it moved into the
  SDK too. `aphrody-ctr-desktop` (winit + wgpu + cpal frontend) and `aphrody-dust-wgpu` stay as
  standalone frontends; they are not duplicated by the SDK.
* `bun-engine` now has one `machine::handheld::HandheldMachine` (a `Machine` over the SDK's
  `Handheld`) instead of two machines. Its `nds` and `ctr` features only enable the SDK cores, and
  the `NdsPlugin` / `CtrPlugin` Bevy plugins build that machine.
* Fixes found on the way: DS `X` and `Y` were passed with the 3DS bit layout (bits 10 and 11) while
  Dust expects bits 16 and 17, so they never reached the game; the DS cartridge chip ID lacked the
  `<< 8` on its capacity byte.

## API

```rust
use aphrody_nds_sdk::{open, Options, Input, button, Step};

let mut machine = open("game.nds", &Options::default())?; // NDS, CCI, CIA, CXI or 3DSX by content
loop {
    machine.set_input(&Input { buttons: button::START, ..Input::default() });
    if machine.run_frame() != Step::Frame { break; }
    let top = machine.image(ScreenId::Top);       // RGBA8, 256x192 (DS) or 400x240 (3DS)
    let bottom = machine.image(ScreenId::Bottom); // 256x192 or 320x240
}
```

* `Format::detect(bytes)`: NDS (logo CRC), CCI (`NCSD`), CXI (`NCCH`), CIA (header size `0x2020`),
  3DSX (`3DSX`). Names and extensions are never trusted.
* `trait Handheld`: `run_frame`, `frames`, `image`, `image_right_eye` (3DS stereo), `set_input`
  (buttons in DS bit order plus `ZL`/`ZR`, touch, circle pad, C-stick), `take_audio` (interleaved
  stereo `f32`), `take_console`, `save_state`/`load_state`, `flush_save`, `registers`,
  `read_memory`, `status`.
* Saves: DS cartridge backups are written to `<image>.sav` (`Options::save_path`); the chip comes
  from an existing file size, then a verified game table (`SaveType::known`), then a 512 KiB flash
  default, or `Options::save_type`. A wrong chip makes the game report a card error (Inazuma Eleven
  on a flash chip stops on "loading failed"; its real chip is a 64 KiB EEPROM). 3DS save data and
  the SD card live in `Options::data_dir` (default `$BUN_ENGINE_DATA/3ds` or the user data dir).
* Saved states: Dust savestates (persistent format) on the DS, Zakuro postcard + LZ4 on the 3DS.
* Debugger: ARM9 (DS) or ARM11 (3DS) registers, guest memory (DS: main RAM view), status line.
  The 3DS core also keeps the instruction ring, profiler and fatal errors in `aphrody-ctr-emu`.

### Bevy

`HandheldPlugin::from_path(path, Options)` (or `from_bytes`) boots the image when the app is built.
It installs the non-send `HandheldSlot`, steps one frame per `FixedUpdate` at the console refresh
rate, updates the `HandheldScreens` images (`top`, `bottom`), reads `HandheldInput` (keyboard map in
`HandheldKeyMap`), plays audio on a `bevy_audio` sink when `AudioPlugin` is present, and emits
`HandheldEvent::{Frame, Shutdown, Fault, StateSaved, StateLoaded}`. `SaveHandheldState(path)` and
`LoadHandheldState(path)` messages write and read states. The plugin spawns no camera or sprite.

```text
cargo run -p aphrody-nds-sdk --example viewer --features viewer -- game.nds
```

`examples/viewer.rs` stacks both screens, maps the mouse to touch, F5/F9 to saved states.

### Headless runner

```text
nds-sdk info <image>
nds-sdk run <image> [--frames N] [--every N] [--tap BUTTON@FRAME]... [--save-type T] [--data DIR] [--no-save] [--dump DIR]
```

Prints an FNV-1a hash of both screens and the number of non-black pixels every `--every` frames,
then the machine status; exit code 1 on boot failure or guest fault. `--dump` writes local PPM
files for inspection and must not be committed.

## Verification

`cargo check -p aphrody-nds-sdk` and `--features viewer --examples`, `cargo check -p bun-engine
--no-default-features --features nds,ctr,host` on the VPS (the Windows C build fails on
`aws-lc-sys`).

### Boot results with owner-supplied assets (headless, no keys, no firmware)

Assets stay outside git (`/usr/` is ignored); they were copied to `/tmp` on the VPS for the run and
deleted afterwards.

| Image | Result |
| --- | --- |
| Inazuma Eleven (France) `.nds`, Inazuma Eleven 2 Tempete de Glace (France) `.nds` | Boot, run 1500+ frames without a crash; intro cutscene renders on the lower screen with a 64 KiB EEPROM backup (the upper screen is black there). With the flash default the game shows its own "loading failed" message, which is the signature of a wrong backup chip, not of a core failure. |
| 138 `.cia` titles in `usr/bin/3ds` (system titles `00040010`, `0004001B`, `00040030`, `0004009B`, `000400DB`, `00040130`, `00040138`, `00048005`, `0004800F`) | All refused by the 3DS core: the contents are encrypted and Zakuro needs decrypted titles. Decryption needs console keys, which the SDK neither ships nor accepts. Not a core defect. |

Homebrew test programs: see the developer toolchain section below.
