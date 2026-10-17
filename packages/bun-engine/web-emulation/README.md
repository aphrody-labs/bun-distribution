# Web emulation build pipeline

Builds the emulators play.aphrody.app runs in the browser and publishes them in one fixed
layout. The site only integrates these artifacts; it does not build them.

| Path | Role |
| --- | --- |
| `build.ts` | Rust cores (`rust`), Qt cores through Docker (`qt`), index and firmware (`index`) |
| `qt/Containerfile` | Pinned Emscripten 5.0.5 + Qt 6.12.0 for WebAssembly (single- and multi-threaded kits) + third-party libraries |
| `qt/build-melonds.sh`, `qt/patches/melonds/` | melonDS Qt 6 front end for WebAssembly |
| `runtime/` | Browser helpers shipped with the cores: `firmware.js` (open-source firmware fetch, OPFS/IndexedDB cache, local user files), `touch.js` (pointer to bottom-screen mapping), `melonds.js` (ES module wrapper of the Qt build with the common API) |
| `serve.ts` | Local cross-origin-isolated server (COOP same-origin, COEP credentialless) |
| `smoke.ts`, `smoke.html` | Headless Chrome smoke test per core over the DevTools protocol |
| `web-emulation.lock.json` | Every pinned input: toolchain, tool archives (sha256), image digests, Ubuntu snapshot, Qt, source commits, test content |

Builds run on the workstation only (never on the VPS). `build.ts` waits until no other
cargo/rustc/docker build is running before it starts one.

```sh
bun packages/bun-engine/web-emulation/build.ts rust dust-nds zakuro-3ds   # Rust cores, both variants
docker build -f packages/bun-engine/web-emulation/qt/Containerfile -t bun-os/qt-wasm:6.12.0-emsdk5.0.5 packages/bun-engine/web-emulation/qt
bun packages/bun-engine/web-emulation/build.ts qt melonds                 # Qt cores in that image
bun packages/bun-engine/web-emulation/smoke.ts dust-nds zakuro-3ds melonds
bun packages/bun-engine/web-emulation/serve.ts                            # http://localhost:8787/smoke/?core=...
```

## Artifact layout

```
dist/web-emulation/
  index.json                      every manifest (served as /api/emulation)
  report.json                     build sizes and times per core and variant
  smoke.json                      last smoke results (frames, frame hash, timings, console errors)
  firmware/firmware.json          open-source firmware served with the cores (sha256, sha512, SRI, source order)
  firmware/<file>                 openbios.bin, normatt_gba_bios.bin
  runtime/{firmware,touch,melonds}.js
  <core>/manifest.json
  <core>/bun_engine.js            wasm-bindgen --target web glue (Rust cores)
  <core>/bun_engine_bg.wasm       wasm-opt -O3, stripped
  <core>/threads/...              optional +atomics variant (`build.ts rust --threads`)
  melonds/{melonds.js,melonDS.js,melonDS.wasm,qtloader.js,build.json}
```

Served by the site under `/emulation/<core>/`: `application/wasm` for `.wasm`, immutable cache
for `*.wasm`/`*.js`, `no-cache` for `manifest.json`, with COOP `same-origin` and COEP
`credentialless` on the page.

## Manifest schema (`<core>/manifest.json`, `schemaVersion` 1)

| Field | Type | Meaning |
| --- | --- | --- |
| `id` | string | Directory name under `/emulation/` |
| `name` | string | Display name |
| `kind` | `"rust"` \| `"qt-emscripten"` | Build path |
| `systems` | string[] | bun-engine system ids the core boots (`nds`, `3ds`, `ctr`, `nes`, `gba`, `psx`) |
| `extensions` | string[] | Accepted image extensions |
| `module` | string | ES module, relative to the core directory |
| `wasm` | string | WebAssembly binary, relative to the core directory |
| `start` | string | Export that boots a game (default `start`) |
| `threads` | boolean | Whether `module`/`wasm` need SharedArrayBuffer (cross-origin isolation) |
| `renderer` | string | `webgpu` (Rust cores: Bevy on wgpu 30) or `qt-raster` (Qt software raster in a canvas) |
| `engine` | string? | `bevy` for the Rust cores |
| `touch` | boolean | `handle.set_touch(x, y, down)` is meaningful (bottom-screen pixels) |
| `audio` | string | `bevy_audio` (Rust) or `sdl2-webaudio` (Qt/SDL) |
| `firmware` | string[] | Open-source components from `firmware/firmware.json` the core can use |
| `license` | string | SPDX expression of the core |
| `version` | string | Crate version or pinned source commit |
| `sha256` | object | Digests of `module` and `wasm` |
| `variants.threads` | object? | `{ module, wasm, threads: true, sha256 }`: the shared-memory build |

## JavaScript API (every core)

```js
const mod = await import(`/emulation/${core}/${manifest.module}`);
await mod.default({ module_or_path: `/emulation/${core}/${manifest.wasm}` });
const handle = await mod[manifest.start ?? "start"](canvas, rom, { system, bios, firmware });
handle.set_input(keys);           // A=1 B=2 SELECT=4 START=8 RIGHT=16 LEFT=32 UP=64 DOWN=128 R=256 L=512 X=1024 Y=2048
handle.set_touch(x, y, down);     // bottom screen: DS 256x192, 3DS 320x240 (manifest.touch)
handle.stop(); handle.free?.();
// diagnostics: handle.frames, handle.frame_hash, handle.lit, handle.first_frame_ms,
// handle.renderer, handle.audio, handle.stopped
```

Rust cores: `start` builds the same Bevy `App` as `bun-engine run` (`crate::web` is a thin
wasm-bindgen facade over `bun_engine::runtime`): Bevy's web window bound to the canvas (an id is
assigned when it has none; `fit_canvas_to_parent`), WebGPU through wgpu 30, `bevy_input`
keyboard (Z/X/A/S/Q/W, Enter, Backspace/Right Shift, arrows) and `bevy_gilrs` gamepads folded
into `EngineInput`, machine audio on `bevy_audio`, the machine in `FixedUpdate` at its own refresh
rate (DS 59.826 Hz, 3DS 59.831 Hz) on Bevy's `requestAnimationFrame` loop. `set_input` bits are
an `ExternalPads` source OR-ed with keyboard and gamepads; `set_touch` overrides the mouse touch
point while held. Options: `system` (required), `bios` (`Uint8Array`), `firmware` (registry id
`bios` must match; without it `bios` is a local user file). One machine per module instance:
winit cannot recreate its browser event loop, so switching games needs a reload.

Rust cores also export `systems()`, `firmware_registry()` and `FirmwareVerifier` (streamed
sha256/sha512/size check with gzip and Zstandard decoding, shared with native hosts through
`bun_engine::firmware`).

`runtime/touch.js` exports `bindTouch(canvas, handle, system)` and `bottomScreenPoint(...)`.

## Firmware

Only open-source components are listed (`packages/bun-engine/plugins/consoles/free-firmware.json`):
PCSX-Redux OpenBIOS (PlayStation, MIT) and Normmatt's GBA BIOS. `runtime/firmware.js`
`loadFreeFirmware(id, { Verifier })` tries the same-origin copy, then the registry URL, then the
mirror order from `mirrors.json`, each with Subresource Integrity (sha512); the bytes are checked
again by `FirmwareVerifier` and cached in OPFS (IndexedDB fallback). The Libreboot mirrors send no
CORS headers, so in practice the same-origin copy is the one a browser can use; the others stay
for hosts that proxy them. `readUserFirmware(file)` / `acceptUserFirmware(element, cb)` read a
user's own dump locally: it is never uploaded or cached. DS cores need no firmware (Dust HLE
BIOS, melonDS FreeBIOS); Zakuro is HLE. Proprietary BIOS files and console keys are never
fetched or shipped; Azahar's built-in key blob is disabled (`ENABLE_BUILTIN_KEYBLOB=OFF`).

## Builds

Rust: `cargo build -p bun-engine --lib --target wasm32-unknown-unknown --profile wasm-release
--no-default-features --features web,<core>` (profile `wasm-release`: opt-level 3, fat LTO,
one codegen unit, `panic=abort`, stripped) with `+simd128,+bulk-memory,...`, without sccache
(its re-spawned rustc command lines exceed the Windows limit on web-sys/Bevy). Then
`wasm-bindgen --target web` and `wasm-opt -O3` (Binaryen) with debug info, producers and
target-feature sections stripped. Bevy's `webgpu` and `webgl2` features are exclusive, so the
artifacts are WebGPU only (Chrome/Edge 113+, Firefox 141+, Safari 26). `--threads` adds an
