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

## Not covered

- Only the NES game was played through the iframe; NDS, 3DS, GameCube and Wii were run through
  the binding only. 3DS and GameCube/Wii are slow on this CPU-only VPS (software Vulkan and GL).
- No audio, no input beyond Enter and Escape, and no on-screen WebGPU proof: Chrome ran on
  SwiftShader, and which path the player page used (WebGPU or 2D) was not checked.
- SNES has no capture (no open SNES homebrew was fetched).
- The Nestopia frame is stretched in the player because the core reports its NTSC-filter geometry.
