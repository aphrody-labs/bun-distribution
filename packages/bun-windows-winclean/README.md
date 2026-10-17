# bun-windows-winclean

Canonical Rust SDK for WinClean-compatible Windows automation and diagnostics.

The SDK belongs to the Bun Windows distribution. Aphrody exposes it through its
CLI and MCP surfaces but does not own or duplicate the implementation.

## Gaming profile

The `gaming_*` tools turn the computer-use surface into a game driver
(`aphrody_agent_tools::winclean_gaming_tools` advertises them directly):

| Tool                                                                               | Windows                                                                                                         | Linux (X11, Xvfb `:99`)                            |
| ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| `gaming_capture_window`, `gaming_capture_benchmark`                                | Windows.Graphics.Capture on Direct3D 11 (`aphrody_capture::gpu`), GDI fallback                                  | ImageMagick `import`                               |
| `gaming_frame_pacing`                                                              | DWM present timestamps: fps, frame times, jitter, 1 % low                                                       | content-change sampling (gamescope stats later)    |
| `gaming_mouse_delta`, `gaming_mouse_button`, `gaming_key`, `gaming_input_sequence` | `SendInput` raw relative motion and scan codes, sub-ms pacing                                                   | `xdotool` (XTEST)                                  |
| `gaming_steam_launch`                                                              | `steam://rungameid/<id>` from `bun-steam`, window wait and focus                                                | same, through `/usr/games/steam`                   |
| `gaming_environment`                                                               | WGC, XInput slots, GameInput runtime, ViGEmBus driver presence                                                  | display, xdotool, import, `/dev/uinput`, gamescope |
| `gaming_get_*`, `gaming_profile_status`                                            | read-only Game Mode, HAGS, power plan, background apps, Game Bar capture, timer resolution, NVIDIA (nvidia-smi) | GPU only                                           |
| `gaming_profile_apply`                                                             | owner-run: applies pending items (`confirm: true`)                                                              | n/a                                                |

Virtual gamepads use ViGEmBus (`gamepad_*`); XInput and GameInput only read pads. The SDK never
installs drivers. `cargo run -p bun-windows-winclean --example gaming -- status|capture <title>|scratch|call <tool> [json]|apply`
drives the profile.
