# Bun OS console shell

The console shell is the full-screen, controller-first face of Bun OS on Windows: the SteamOS idea
rebuilt for an NVIDIA Windows PC, written in Rust on Bevy 0.20 (wgpu 30), with a native Material 3
interface, the Bun Engine emulators in-process and Steam games through the Steam client.

| Item | Path |
| --- | --- |
| Crate (owner) | `crates/bun-os-shell` (lib + `bun-os-shell` binary) |
| Engine entry | `bun-engine shell [...]` (Rust CLI, starts the sibling `bun-os-shell`) |
| Bun entry | `bun packages/bun-engine/src/cli.ts shell [...]` (`packages/bun-engine/src/shell.ts`) |
| Route resolver | `bun-engine library command <id>` (`packages/bun-engine/src/frontend/cli.ts`) |
| Profiles (Bun half) | `packages/bun-engine/src/frontend/profiles.ts`, `bun-engine library profile [key [field=value...]]` |
| State | `usr/var/lib/bep/shell.db` (profiles, sessions, settings), `usr/var/lib/bep/shell/{states,captures}` |

## Build and run

```sh
# Bevy's bevy_internal command line exceeds what sccache can spawn on Windows (os error 206):
# run the wrapper with an empty RUSTC_WRAPPER.
RUSTC_WRAPPER= CARGO_BUILD_RUSTC_WRAPPER= bun msvc exec --toolset 14.44 -- bun scripts/cargo.ts exec -- build --release -p bun-os-shell
target/release/bun-os-shell                       # 1600x900 window
target/release/bun-os-shell --session             # borderless full screen, hidden cursor
target/release/bun-os-shell status                # JSON: library, NVIDIA, display, encoders, busy state
target/release/bun-os-shell --windowed 1920x1080 --script "wait:1500,right,shot:home,guide,shot:quick,exit" --shots DIR --stats FILE
```

`--script` drives the same intent pipeline as real input (`left|right|up|down`, `accept`, `back`,
`guide`, `prev`, `next`, `wait:MS`, `shot:NAME`, `play:KEY|TITLE`, `exit`); `--stats` writes the
frame-time report (mean, p50/p95/p99, max, frames over 16.7 ms) plus the machine counters.

## Session at sign-in (opt-in)

The shell never replaces Explorer and never changes a system or security setting. Session mode is
a per-user startup entry the owner registers explicitly:

```sh
"C:\src\bun-os\target\release\bun-os-shell.exe" install-session     # HKCU\...\Run\BunOSConsoleShell = "<exe>" --session
"C:\src\bun-os\target\release\bun-os-shell.exe" uninstall-session
```

`bun-os-shell session-status` prints the current entry and the opt-in line; Settings shows the
same line. "Return to the desktop" (Power menu or Settings) exits the shell; Explorer keeps running
underneath, so the desktop is simply revealed.

## Interface (Bevy UI, Material 3)

- Tokens come from `aphrody-m3-tokens` (baseline seed #6750A4, tonal spot, dark): the same values
  as `packages/m3-theme/tokens.css` and `design-system/bun-os-play/MASTER.md` (primary #CFBDFE,
  surface #141218). Type is Google Sans Flex (variable weights through Bevy's parley text) at the
  M3 scale x1.25 for 10-foot viewing; shapes and spacing use the MASTER.md tokens. Icons are
  Material Symbols Rounded rasterized at startup from the pinned font in `packages/m3-fonts`
  through `aphrody-svg` (no emoji, no network).
- Design units are 1080p; `UiScale` follows the window.
- Screens are Bevy states: Home, Library, Game hub, Downloads, Settings, Playing; overlays (Quick
  menu, Power) are a second state machine drawn above any screen or game.
  - Home: full-bleed hero art of the focused game (Steam `librarycache`, or the suspend thumbnail
    of an emulator game) with an M3 scrim, top bar (tabs, NVIDIA pill, power, clock), the game
    rail (focused tile pinned to the left edge as on PS5), Play/Resume and Game hub actions, and
    activity cards (resume points, the running external game, transfers, NVIDIA, last session).
  - Library: every game with filter chips (All, Steam, Emulators, Web).
  - Game hub: details and the per-game profile (frame limit, scaling, borderless, instant resume,
    performance overlay); Resume / Start fresh for suspended machines.
  - Downloads: Steam transfers read from `appmanifest_*.acf` and the bep packages in `usr/`.
  - Settings: sounds, haptics, reduced motion (System/Reduced/Full), performance overlay, library
    reload, the session opt-in line, return to desktop, and the system panel (NVIDIA, display,
    capture).
- Motion: M3 springs (`aphrody_m3_tokens::motion`, expressive spatial/effects) for focus scale,
  outline, rail and grid scroll, hero crossfade, sheet and toast. Reduced motion snaps every
  spring; "System" follows Windows `SPI_GETCLIENTAREAANIMATION` (Animation effects).
- Sounds: four UI sounds synthesized at startup (no third-party audio) played through
  `bevy_audio`; haptics are `GamepadRumbleRequest`s through `bevy_gilrs`.

## Input

Controller first, through Bevy (`bevy_gilrs`, Windows.Gaming.Input / XInput pads), keyboard and
mouse as fallbacks. Navigation is Bevy's automatic directional navigation
(`AutoDirectionalNavigation`), with only the active layer navigable.

| Action | Pad | Keyboard | Mouse |
| --- | --- | --- | --- |
| Move (with repeat 380/85 ms) | D-pad, left stick | arrows, WASD | wheel |
| Accept | A (South) | Enter, Space | click |
| Back | B (East) | Escape, Backspace | |
| Quick menu (Guide) | Guide when reported, View alone in menus, View+Menu in game | Home, F1, Escape in game | |
| Previous / next tab | LT / RT | Q / E, PageUp / PageDown | |

In game, pads use Nintendo positions (East = A, South = B); keyboard Z/X/A/S/Q/W, Enter, Backspace.
Windows.Gaming.Input does not report the Xbox Guide button to desktop apps and Xbox Game Bar owns
it by default, hence the View+Menu chord.

## Games and "Gamescope for Windows"

| Source | Launch | Focus / window | Frame limit | Scaling | Resume |
| --- | --- | --- | --- | --- | --- |
| Bun Engine machines (NES, GBA, DS, PS1 from `library.db`) | in-process machine thread | inside the shell (Bevy image) | per profile, presentation | Sharp (nearest), Smooth (bilinear), FSR 1 (engine `Fsr1Upscale`) | instant: paused in memory, state + thumbnail on disk |
| Release emulators and RetroArch (`usr/`) | `bun-engine library command <id>` then spawned and owned by the shell | window found in its process tree, made borderless on its monitor (profile), focused; shell minimized and restored on exit | emulator's own | emulator's own | emulator's own |
| Steam (installed) | `steam://rungameid/<id>` after checking `RunningAppID` and streaming processes | game window focused, shell minimized while `RunningAppID` is set, restored after | game / NVIDIA app (no driver profile edits) | DLSS/NIS where the game exposes them | Steam's |
| Steam (owned, not installed) | `steam://nav/games/details/<id>` (Steam page) | | | | |
| Web cores (`dist/web-emulation`) | `serve.ts` + browser (WebGPU) | browser | | | |

Suspend semantics: leaving a machine (Quick menu Home, B into another screen) pauses it and writes
`Machine::save_state` + a PNG thumbnail; Resume continues instantly from memory. Launching another
machine saves the current one and drops it; launching it again later loads the state from disk.
Close game discards the state. `Machine::save_state`/`load_state` are implemented for the NES
(TetaNES) and GBA (RustBoyAdvance-NG) cores; other cores report that they cannot save.

## NVIDIA and display (read-only)

- NVAPI (`nvapi64.dll`, `nvapi_QueryInterface`): GPU name, driver/branch, temperature, core and
  memory clocks, load, G-SYNC/VRR state of the primary display (`NvAPI_Disp_GetVRRInfo`), Reflex
  API presence (`NvAPI_D3D_SetSleepMode` exported). NVML (`nvml.dll`): board power, enforced power
  limit, VRAM. Polled at 1 Hz on a thread; shown in the top bar, activity card, quick menu, HUD.
- HDR passthrough info: DXGI `IDXGIOutput6::GetDesc1` of the shell's monitor (color space
  G2084/P2020 = HDR on, peak luminance, bits per color).
- Capture: screenshots through Bevy's `Screenshot` (PNG). Recording of Bun Engine games through
  the Media Foundation sink writer with hardware transforms enabled, which selects the vendor H.264
  MFT (NVIDIA H.264 Encoder MFT = NVENC); the encoder actually used is reported.
- Nothing writes driver profiles (DRS), global NVIDIA settings or Windows settings. Master volume
  in the quick menu is the same per-user action as the taskbar slider.

## Engine integration and pending work

- Bevy comes from the workspace (`crates/bevy*`, v0.20.0) shared with `bun-engine`, so the shell
  and the engine run one Bevy and one wgpu 30 device. The FSR 1 scaler is the engine's
  `Fsr1Plugin`/`Fsr1Upscale`; because that pass replaces the whole camera output, the shell enables
  it only while no overlay covers the game (overlays and the HUD show the nearest-scaled image).
- Machines still run on the shell's own thread (`src/machine.rs`, `Machine` trait only) until the
  engine runtime offers runtime insertion/removal of a machine (`MachineSlot` is installed at App
  build today). Requested from the runtime owner: an InsertMachine/RemoveMachine path with systems
  registered once and `MachineStatus.paused` honored, and FSR 1 into an image target for UI hosts.
