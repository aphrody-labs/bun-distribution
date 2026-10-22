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
page showed it (WebGPU on SwiftShader does not reach the Wayland surface here), so the game picture in
`ui-quick-menu.png` comes from the CDP capture.

Session review: `factory/bunos/pkgbuilds/bun-engine/bunos-gamescope-session` is unchanged. It sets
`XDG_CURRENT_DESKTOP=gamescope`, which makes `bun-engine frontend` run as a kiosk window (`underGamescope()`), so the
frontend is the only client. What changed in the frontend: Exit to desktop ends the window and the server (gamescope
follows its child), Restart frontend reopens the window, and a kiosk window that dies on its own is reopened up to three
times a minute instead of ending the session. `-e` in the default gamescope flags only matters under Steam; without a
Guide button, F1 or Select + R3 open the quick menu. `BUN_ENGINE_CHROME_ARGS` adds browser flags (the VPS run used it
through the wrapper for `--no-sandbox`).

## Not covered

- Only the NES game was played through the iframe; NDS, 3DS, GameCube and Wii were run through
  the binding only. 3DS and GameCube/Wii are slow on this CPU-only VPS (software Vulkan and GL).
- No audio, no input beyond Enter and Escape, and no on-screen WebGPU proof: Chrome ran on
  SwiftShader, and which path the player page used (WebGPU or 2D) was not checked.
- SNES has no capture (no open SNES homebrew was fetched).
- The Nestopia frame is stretched in the player because the core reports its NTSC-filter geometry.
