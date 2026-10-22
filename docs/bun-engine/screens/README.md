# Showcase captures

Everything here was produced on the VPS (`ssh vps`, checkout `~/src/bun-os`), headless, with the
Bun Engine RetroArch binding (`packages/bun-engine/src/libretroarch.ts`) and homebrew listed in
[../HOMEBREW.md](../HOMEBREW.md). No input was sent: each PNG is the last frame after N frames.

## Console captures

`capture.ts` opens the core and the content through `RetroArch.open`, iterates N frames, converts
the last frame with `toRGBA` and writes a PNG (`SCALE=2` is a nearest-neighbour upscale).
Common environment: `LIBRETRO_INFO=/tmp/lra-probe/info LIBRETRO_SYSTEM=/tmp/lra-con-probe/system`
and `LIBRETROARCH_LIB=/tmp/lra-swiss-1/libretroarch.so` (the Vulkan-enabled libretroarch; the plain
`vendor/retroarch` build cannot give Azahar its Vulkan context). Cores are the buildbot or
`/tmp/lra-concore` builds named below. `CAPTURE_HOME` points at a copy of an earlier probe home
that already holds that core's `.opt` file; it is only needed for Azahar and Dolphin.

| File | Command (from `docs/bun-engine/screens`) | Core | Frames | sha256 |
| --- | --- | --- | --- | --- |
| `nds-godmode9i.png` | `SCALE=2 bun capture.ts desmume_libretro.so GodMode9i.nds 300 nds-godmode9i.png` | desmume | 300 | `cd32ea108de96ec8c06520be03fa5461fe8dbe850e4fc7936f18067c69ce1097` |
| `3ds-fbi.png` | `bun capture.ts azahar_libretro.so FBI.3dsx 600 3ds-fbi.png` | azahar | 600 | `ced98f6cc269b9e41d8f1dfc83a7ff3c6a079149b78dea08637cef35befb1c78` |
| `gc-swiss.png` | `bun capture.ts dolphin_libretro.so swiss_r2119.dol 600 gc-swiss.png` | dolphin with the Swiss patch | 600 | `e82a3e037f4c625ca2f718fe41a3b78efb47ed9c3ae6e3fa753721725cc79091` |
| `wii-snes9xgx.png` | `bun capture.ts dolphin_libretro.so snes9xgx/boot.dol 400 wii-snes9xgx.png` | dolphin | 400 | `d50c15bae3f4c894bf95627fd6c594ecf6d271739745282ff7ccf8b79e85ae3e` |
| `gba-hello.png` | `SCALE=2 bun capture.ts mgba_libretro.so hello.gba 120 gba-hello.png` | mgba | 120 | `588f23aa73273fff30adb591643280fa4bfc7222ddf3770c9088f111bf261d11` |
| `nes-lan-master.png` | `bun capture.ts nestopia_libretro.so lan_master.nes 240 nes-lan-master.png` | nestopia | 240 | `bd1ad56dd8f81be740f4f2668b582bcd05e0087a455b7772372892d0cbaefc13` |

Each was run twice with identical hashes. The content files are the ones in HOMEBREW.md
(`/tmp/lra-concontent`, `vendor/rustboyadvance-ng`, `vendor/tetanes`). Frames are the core's own
output size: NDS 256x384 (two screens), 3DS 400x480, GameCube/Wii 640x528, GBA 240x160, NES 602x224
(Nestopia's NTSC filter width). The first Dolphin capture of Snes9x GX for the GameCube also
showed Dolphin's own debug overlay and was not kept.

## Frontend flow

`flow.ts` drives the real frontend in headless Chrome over CDP. Scratch library on the VPS:
`BEP_ROOT=/tmp/showcase-usr` (not a protected store), one folder source `/tmp/showcase-lib/<system>/`
with each homebrew and a `<stem>.png` cover beside it, the free/bep/store sources removed, and the
default route of each system set to `embedded:<core>`.

```
BEP_ROOT=/tmp/showcase-usr LIBRETROARCH=/tmp/lra-swiss-1/libretroarch.so \
  bun packages/bun-engine/src/cli.ts frontend --port 50181 --no-window
google-chrome --headless=new --no-sandbox --remote-debugging-port=9333 --user-data-dir=/tmp/showcase-chrome \
  --window-size=1280,720 --enable-unsafe-webgpu --enable-features=Vulkan --use-vulkan=swiftshader \
  --use-angle=swiftshader about:blank
bun docs/bun-engine/screens/flow.ts http://127.0.0.1:50181/ 9333 docs/bun-engine/screens nes
```

| File | What it shows | sha256 |
| --- | --- | --- |
| `flow-1-library.png` | Library home, system cards with the captures as covers | `7927481103aa67c6b036db3ff84c3adcc4fd3d9d36911740ee4507be02eb17db` |
| `flow-2-system.png` | NES view: game row with thumbnail, detail with cover | `f0e8dc0d370424ad403d143baf9520acc6d598f317c71f5085ee49438bd7669e` |
| `flow-3-playing.png` | Lan Master playing in the player iframe (`embedded:nestopia`), 8 s after launch | `4e8a63797b8539693b52dfb739e67a38225e99dc508ef4953632e51bf2a11ca0` |
| `flow-4-returned.png` | After Escape: iframe removed, same game row focused | `f0e8dc0d370424ad403d143baf9520acc6d598f317c71f5085ee49438bd7669e` |

`flow-4` is byte-identical to `flow-2` on purpose: the library came back to exactly the state it
was left in, and the script printed `focus game 194` (the game's `data-game` id). PNGs are
palette-quantized to 128 colours to stay under 150 KB.

## Console-style home and quick menu (phase 1)

`ui-flow.ts` drives the new frontend (`web/app`) in headless Chrome over CDP, on the same scratch library as
the flow above. A fake Gamepad API object with an Xbox-style id stands in for a pad (the VPS has none), so
the captures prove our pad code, not Chrome's or the OS's gamepad stack. `session-flow.ts` captures the
compositor output of a kiosk window with `grim`.

```
bun docs/bun-engine/screens/ui-flow.ts http://127.0.0.1:50181/ 9333 docs/bun-engine/screens
# kiosk stand-in for the gamescope session (headless sway, `bun-engine frontend --session`, Chrome via a wrapper):
XDG_RUNTIME_DIR=/run/user/1000 WAYLAND_DISPLAY=wayland-1 bun docs/bun-engine/screens/session-flow.ts 9223 docs/bun-engine/screens
```

| File | What it shows |
| --- | --- |
| `ui-home.png` | Home with a connected pad: top bar, hero for the last played game with the focused Play button, Recent shelf, footer glyphs |
| `ui-quick-menu.png` | The quick menu over the running NES game (`embedded:nestopia`), paused, Resume focused |
| `ui-search.png` | Search with the pad keyboard and the result list (typed `sw`) |
| `ui-session-confirm.png` | `grim` capture of the kiosk window under headless sway: the restart confirm dialog, Cancel focused first |

What the run printed (VPS, 1280 x 720): the select hint showed the Xbox `A` glyph; keydown to `focusin` was
0.6 to 7 ms; layout shift was 0; no control lacked an accessible name; RetroArch reported `PAUSED` when the quick menu
opened; Save state wrote `states/Nestopia/LanMaster.state`, Screenshot wrote `LanMaster-<date>.png`, Load state
loaded it; Volume went from 70 to 60 with the left arrow; Stop game opened a confirm dialog with Cancel focused,
and Resume put the focus back on the game frame. Not shown in captures: the Select+Start exit chord, the Guide
button and Select+R3, and Escape in a menu, which were exercised with the fake pad and reported in text only.

Kiosk run: sway reported the Chrome window fullscreen (`fullscreen_mode 1`, the page saw `outerHeight === screen.height`),
so the home is the whole session with no window chrome. The power menu opened from the power button (focused with the
keyboard), Restart frontend replaced the Chrome process (new pid, page back), Exit to desktop ended Chrome and the
`bun-engine` process. Real gamescope was **not** run (no GPU: its Vulkan start-up fails on missing
`VK_KHR_present_id`). Keys reached Chrome over CDP: `wtype` on the headless seat did not deliver key events. In the
Wayland kiosk the grim capture showed the game frame black behind the quick menu while the CDP capture of the same
page showed it; the cause is explained in phase 2 (a WebGPU canvas is not composited in software), and
`kiosk-quick-menu.png` is the corrected `grim` capture. `ui-quick-menu.png` (CDP) is kept.

Session review: `factory/bunos/pkgbuilds/bun-engine/bunos-gamescope-session` is unchanged. It sets
`XDG_CURRENT_DESKTOP=gamescope`, which makes `bun-engine frontend` run as a kiosk window (`underGamescope()`), so the
frontend is the only client. What changed in the frontend: Exit to desktop ends the window and the server (gamescope
follows its child), Restart frontend reopens the window, and a kiosk window that dies on its own is reopened up to three
times a minute instead of ending the session. `-e` in the default gamescope flags only matters under Steam; without a
Guide button, F1 or Select + R3 open the quick menu. `BUN_ENGINE_CHROME_ARGS` adds browser flags (the VPS run used it
through the wrapper for `--no-sandbox`).

## Library UI, phase 2 (game page, apps, sounds, sleep, host panels, saves, pad, pacing)

Run on the VPS (`ssh vps`) in a private tree (`git archive` of `origin/os` plus the changed files) with `BEP_ROOT` on
tmpfs, because `/home` I/O was throttled by other jobs and sqlite WAL on it stalled. The library is the showcase one plus
five extra entries (copies of the NES and GBA homebrew under other names, each with its capture beside it) so that "More
on <system>" has something to show. Scripts (all in this folder, all print PASS/FAIL per check):

| Script | What it drives |
| --- | --- |
| `ui-flow2.ts` | headless Chrome over CDP (fake Gamepad API object as in `ui-flow.ts`): app tile, game page, sounds, power menu, Settings panels, per-profile saves. 44 checks. |
| `session-flow2.ts` | the kiosk stand-in (headless Sway, Chrome kiosk window, `bun-engine frontend --session`): Sleep, checked with `swaymsg` and `grim`. 9 checks. |
| `kiosk-game.ts` | the game picture as the compositor shows it (`grim`), 2D presenter against WebGPU presenter in the same window. |
| `pad-real.ts` + `uinput-pad.py` | the frontend driven by a real kernel gamepad device seen by Chrome's own Gamepad stack. 15 checks. |
| `frame-pacing.ts` | requestAnimationFrame deltas and game-frame intervals while a core runs. |

| File | What it shows |
| --- | --- |
| `ui-home.png`, `ui-home-apps.png` | home with the hero; scrolled to the Apps shelf (one tile for the declared app) |
| `ui-game-page.png`, `ui-game-page-related.png` | the game page: hero, one Play, favourite, facts; the two related shelves |
| `ui-power-sleep.png` | power menu in the kiosk with Sleep display enabled (Sway found) |
| `ui-power-sleep-na.png` | the same menu on a host with no display power tool: disabled, with the reason |
| `ui-settings-display.png`, `ui-settings-audio.png`, `ui-settings-host.png` | display, audio (a PipeWire sink), network, storage, controllers, apps |
| `ui-settings-audio-na.png` | the audio panel with no sound server: the designed "Not available" state |
| `kiosk-game-default.png`, `kiosk-game-webgpu.png`, `kiosk-quick-menu.png` | `grim` captures of the kiosk: game with the 2D presenter, the same game forced to WebGPU (black), quick menu over the game |
| `frame-pacing-2d.json`, `frame-pacing-webgpu.json` | the pacing measurements |

The network panel capture hides the address text (`ui-flow2.ts` replaces it before the screenshot); everything else is
unedited.

### 1. Game page, 2. app tiles

Checked: the hero has exactly one primary button (Play); the cover image loaded; both related shelves are filled; the
favourite toggle flips `aria-pressed` and the server value (and back); a related tile opens another game page, Back
returns to the first and Back again to home with focus on Play; a declared app (`sleep 600`, declared with
`bun-engine library apps add`) shows as one tile, Enter starts a process that exists in `/proc`, the tile reads Running
and the status pill counts it, a second Enter asks first (Cancel focused), confirming ends the process. An unknown app id
is refused. Declaring apps over HTTP is deliberately not possible (see `apps.ts`).
Not covered: no media library (video, music) feeds the tiles: only declared programs.

### 3. Sounds

Four cues rendered offline with `OfflineAudioContext`: focus 0.049 peak, select 0.079, back 0.070, error 0.064 (all under
0.09, under 0.17 s, RMS 0.009 to 0.017), so none is silent or clipping. The default is Automatic (`auto`); with
`motion=reduced` it plays nothing; `on` overrides reduced motion and survives a reload; `off` plays nothing; the value
lives in shell.db. Moving focus with the arrow keys played the focus cue (the page's own play log).
Not covered: nobody listened; the VPS has no audio device.

### 4. Sleep

On the kiosk stand-in: the power menu offers Sleep display (Sway found); Sway reports `power: false` for the output
afterwards, `grim` blocks on the powered-off output (killed after 4 s), the page holds a black cover, the first key wakes
it (Sway reports power on, cover gone, focus back on a control), and a reload while asleep wakes the display at boot.
Without Sway or X11 DPMS (headless Chrome run) the entry is disabled with the host's reason and pressing it only raises
an error toast: nothing goes dark.
Not covered: the X11 (`xset`) path (no X server here); a real key arriving at a powered-off Sway output (the seat has no
keyboard, keys came over CDP); real gamescope, which has no display power control, so Sleep is off there by design.

### 5. Settings panels

Read from the host when the page opens, no panel has a control. Display: browser size and scale, screen, measured refresh
(60 Hz), host outputs (Sway `get_outputs` in the kiosk, the kernel's DRM connector in headless Chrome: `Virtual-1
800 x 600`). Audio: sinks from `wpctl` against a private PipeWire with one null sink (the page listed "Bun UI test sink",
default, 100 %); with no sound server (`pactl` absent, `wpctl` cannot connect) the panel shows the reason. Network:
`ip -j addr` and the default route, virtual interfaces folded into a count. Storage: `statfs` per volume, compared with
`df` in the script, plus save sizes per profile. Controllers: what the browser reports.
Not covered: `pactl`, `nmcli` and `xrandr` parsing (tools absent here; written, not run).

### 6. Per-profile saves

`<home>/profiles/<profile>/{states,screenshots}`. A fresh profile's first play copied the two shared states
(`states/Nestopia/LanMaster.state` and its thumbnail, from the phase 1 run) into its folder, byte-identical; the shared
files were byte-identical afterwards; Save state and Screenshot from the quick menu wrote only into the profile's folder;
Load state loaded it; the game page counts the profile's saves; a profile that never played is told it will start from
the shared ones. Battery saves (SRAM) are not split.

### 7. The black game picture in the kiosk: root cause

Reproduction (`kiosk-game.ts`, Chrome 155 kiosk window on headless Sway, no GPU): the same running game, seen through
`grim`, was 86.9 % lit pixels (2304 colours) with the 2D presenter and **0 % (one colour) with the WebGPU presenter**,
while the page's own readback of the WebGPU canvas held 130689 lit pixels and 2334 colours and the frames kept arriving
(469 presented). `chrome://gpu` in that window: `gpu_compositing: disabled_software`, `webgl: unavailable_off` (no context
at all), `webgpu: unavailable_software`.

Cause: a WebGPU canvas is only shown by a GPU compositor. With no GPU Chrome composites in software; WebGL falls back to a
readback path (it showed up once the SwiftShader flags were passed) and a 2D canvas is plain pixels, but a WebGPU canvas
has no software path and is drawn as nothing. A test page with a 2D, a WebGL, a top-level WebGPU and a cross-origin
iframe WebGPU canvas gave 2D red and (with flags) WebGL green in the kiosk and no blue for either WebGPU canvas; headless
Chrome on the same host (`gpu_compositing: enabled`, GPU compositing through SwiftShader) showed all four. So it was never
the capture tool: the phase 1 CDP screenshot came from the headless Chrome, which composites on the GPU path. Flag sets
tried in the kiosk without effect on WebGPU: `--ignore-gpu-blocklist`, `--use-vulkan=swiftshader
--enable-unsafe-swiftshader`, `--use-gl=angle --use-angle=swiftshader`, with or without `--enable-gpu-rasterization`:
Chrome on Wayland here never turned GPU compositing on.

Fix: the player (`libretroarch-client/main.ts`) picks its presenter. A software adapter (`isFallbackAdapter`: SwiftShader,
llvmpipe, WARP) or no WebGPU gets a 2D canvas with an RGBA conversion of the frame (XRGB8888 and RGB565) stretched with
nearest-neighbour; a hardware adapter keeps WebGPU; `?renderer=webgpu|2d` forces one. In the kiosk the game and the quick
menu now show in the `grim` capture (`kiosk-quick-menu.png`), and the 2D path also paces better (item 9). On real hardware
under gamescope nothing changes. Not verified: a hardware WebGPU adapter (none here).

A second kiosk finding, not caused by the app: on this loaded host Chrome sometimes keeps a stale window geometry under
Sway (page drawn offset by 115 x 10, black bars, right and bottom cropped, `grim` pixel 2,2 black) although Sway reports
the window fullscreen at 0,0. `swaymsg fullscreen disable; fullscreen enable` fixes it; the scripts do that while waiting
for the page to fill the output.

### 8. Real gamepad

A virtual Xbox 360 style pad made through `/dev/uinput` by `uinput-pad.py` (root through passwordless `sudo`, with an ACL
for the test user on the two new device nodes, which vanish with the device) and read by headless Chrome's own Gamepad
stack (udev, `joydev`). Nothing in the page is faked: `navigator.getGamepads` is native. Chrome reported
`Microsoft X-Box 360 pad (STANDARD GAMEPAD Vendor: 045e Product: 028e)`, mapping `standard`, 17 buttons, 4 axes; D-pad
right is button 15, LB 4, RB 5, Select 8, Start 9, Guide (BTN_MODE) 16, L3 10, left trigger 6, stick X 0.9. The frontend
(`pad-real.ts`, 15 checks) with that pad: the footer showed the Xbox glyphs; D-pad moved focus, A opened the game page, B
went back, the left stick moved focus, RB and LB changed page, Start opened the quick menu and B closed it; A launched a
game, Select + R3 and the Guide button opened the quick menu over it (paused), the D-pad moved in the menu, B resumed,
Select + Start left the game. Earlier versions of the script lost one or two of the 15 checks per run when taps raced the
page load on this busy host; the final script waits for each outcome and passed 15/15 three times in a row.
Limits: it is a virtual device on the kernel input path, not a physical USB or Bluetooth pad (no real Guide button
firmware, no rumble, no battery); a headless Chrome page needed a first button press before Chrome listed the pad.

### 9. Frame pacing

`frame-pacing.ts`, headless Chrome with software rendering at 1280 x 720, NES core (Nestopia, `embedded:nestopia`), 20 s
per row, on a 12-core host with a load average of 53 (other jobs running: read the tails with that in mind). Milliseconds;
"late" counts intervals over 25 ms.

| Row | p50 | p95 | p99 | max | late |
| --- | --- | --- | --- | --- | --- |
| home page, idle (launcher rAF) | 16.7 | 16.8 | 16.8 | 16.8 | 0 of 1200 |
| launcher page while the game plays (rAF) | 16.7 | 16.7 | 16.8 | 16.8 | 0 of 1200 |
| player page, 2D presenter (rAF) | 16.7 | 16.7 | 16.8 | 33.3 | 1 of 1199 |
| game frames reaching the screen, 2D presenter | 16.7 | 33.3 | 33.4 | 33.5 | 62 of 1138 |
| launcher page while the game plays, WebGPU presenter forced | 16.7 | 33.4 | 66.6 | 100.1 | 211 of 943 |
| player page, WebGPU presenter forced (SwiftShader) | 16.7 | 49.9 | 50.1 | 116.7 | 334 of 806 |
| game frames reaching the screen, WebGPU presenter | 16.7 | 50.0 | 66.7 | 116.7 | 352 of 775 |

The browser keeps 60 Hz with the 2D presenter; the late game frames (5 %) are display frames in which the server's
setTimeout-paced core loop had not produced a new frame, i.e. host scheduling under load, not rendering. The SwiftShader
WebGPU presenter is CPU-bound and misses frames (p95 50 ms), which is the second reason software adapters now get the 2D
path. This is a software-rendering measurement of this host: it says nothing about a GPU, a TV or gamescope pacing.

## Not covered

- Only the NES game was played through the iframe; NDS, 3DS, GameCube and Wii were run through
  the binding only. 3DS and GameCube/Wii are slow on this CPU-only VPS (software Vulkan and GL).
- No audio was listened to (the VPS has no audio device), and the phase 1 flows sent only Enter and Escape: the real
  pad is covered in phase 2 (virtual device) and the player path is now reported by the page (`retroarch.renderer`).
- SNES has no capture (no open SNES homebrew was fetched).
- The Nestopia frame is stretched in the player because the core reports its NTSC-filter geometry.
