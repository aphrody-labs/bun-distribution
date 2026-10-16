# @aphrody/canvas

Aphrody's canvas package: a stable `@aphrody/*` namespace over the pinned upstream Skia
runtime [`@napi-rs/canvas`](https://github.com/Brooooooklyn/canvas) (1.0.9, commit `8411071`),
plus the M3 surface contract used by the M3 packages, SpaceUI, Tauri and the render crates.
Consumers import `@aphrody/canvas` and never depend on `@napi-rs/canvas` directly.

```sh
bun add @aphrody/canvas   # Bun >= 1.4.2
```

## Entry points

| Import                    | Native addon     | Contents                                                                                                                                                                                                                             |
| ------------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `@aphrody/canvas`         | loaded on import | The upstream API (`createCanvas`, `loadImage`, `Image`, `GlobalFonts`, `Path2D`, `SKRSContext2D`, ...), `loadNativeCanvas()`, `createNativeCanvas()`, `loadNativeImage()`, `drawM3Scene()`, `drawM3Scene3d()` and the site contract. |
| `@aphrody/canvas/site`    | never            | `createM3CanvasSurface()`, `createBrowserCanvas()`, `configureBrowserCanvas()`, `selectCanvasBackend()`.                                                                                                                             |
| `@aphrody/canvas/browser` | never            | Same module as `/site`.                                                                                                                                                                                                              |

```ts
import { createCanvas, GlobalFonts, type SKRSContext2D } from "@aphrody/canvas";

const canvas = createCanvas(320, 120);
const ctx: SKRSContext2D = canvas.getContext("2d");
ctx.fillRect(0, 0, 320, 120);
const png = await canvas.encode("png"); // also "webp", "avif", "jpeg"
```

`aphrody-site` and browser bundles must use the native-free entry point, so the Skia addon never
reaches a site bundle:

```ts
import {
  createBrowserCanvas,
  createM3CanvasSurface,
} from "@aphrody/canvas/site";
```

The package ships TypeScript sources for Bun (`"default"` conditions) and hand-written
declarations (`"types"` conditions); a Next.js consumer of `/site` lists the package in
`transpilePackages`.

## Native Skia binary

The addon is resolved by the upstream loader (`vendor/js-binding.js`), first match wins:

1. `NAPI_RS_NATIVE_LIBRARY_PATH`: absolute path to a `skia.<platform>.node`, for example one
   built by Aphrody from `third_party/canvas`. When set, it is the only candidate.
2. `vendor/skia.<platform>.node` next to the loader (ignored by Git, never committed).
3. The upstream prebuilt package `@napi-rs/canvas-<platform>@1.0.9`, declared in
   `optionalDependencies`. Package managers skip the packages whose `os`/`cpu` do not match the
   host (on Linux the loader then picks `gnu` or `musl` at runtime): `win32-x64-msvc`, `win32-arm64-msvc`, `linux-x64-gnu`, `linux-x64-musl`, `linux-arm64-gnu`,
   `linux-arm64-musl`, `linux-arm-gnueabihf`, `linux-riscv64-gnu`, `darwin-x64`,
   `darwin-arm64`, `android-arm64`.

`optionalDependencies` are generated from `third_party/canvas/npm/*` at the vendored version, so
the JavaScript loader and the binary always come from the same upstream release.

## M3 scenes

`drawM3Scene()` and `drawM3Scene3d()` rasterize an M3 scene in Rust (`aphrody_render`, through
`@aphrody/bun`) and blit the PNG with the native addon. `@aphrody/bun` is an optional peer
dependency: it is imported only when one of these two functions runs, and a missing install
throws `@aphrody/canvas: drawM3Scene needs the optional peer dependency @aphrody/bun`. The scene
types (`M3Scene`, `M3Scene3d`, `M3Render3dPolicy`) come from `scene-types.d.ts`, a copy of
`packages/bun/src/scene-types.ts`, so type-checking never needs `@aphrody/bun`.

## Layout and upstream

`third_party/canvas` is a Git submodule on the non-fork upstream and is never patched in place;
Aphrody behavior goes in this facade or in the Rust render crates. The files the package needs
from other trees are copies:

| Path                                                                                        | Source                                                                       |
| ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `vendor/index.js`, `js-binding.js`, `geometry.js`, `load-image.js`, `index.d.ts`, `LICENSE` | `third_party/canvas` (MIT, upstream copyright notice kept)                   |
| `vendor/package.json`                                                                       | `{"type": "commonjs"}`: the upstream loader is CommonJS, this package is ESM |
| `vendor/UPSTREAM.md`                                                                        | Provenance: commit, version, license, SHA-256 of every copy                  |
| `scene-types.d.ts`                                                                          | `packages/bun/src/scene-types.ts`                                            |

The copies are committed rather than generated at pack time:

- `bun test`, the type-check and every workspace consumer work from a plain checkout, with no
  build step and without initializing the submodule;
- the published tarball is exactly the reviewed tree (`files` lists every shipped path);
- drift is still impossible to publish: `scripts/vendor-upstream.ts --check` runs as `prepack`
  (it fails if the submodule is missing), and `vendor.test.ts` compares every copy with its source
  when the submodule is checked out and with the SHA-256 in `vendor/UPSTREAM.md` otherwise.

Copies are byte-identical after line-ending normalization to LF.

### Updating upstream

```sh
git -C third_party/canvas fetch && git -C third_party/canvas checkout <reviewed-sha>
cd packages/canvas
bun run vendor            # rewrites vendor/, scene-types.d.ts and optionalDependencies
# keep aphrodyCanvasVersion in site.ts, site.d.ts and index.d.ts equal to the
# package version (the release-aligned Aphrody version), then run the gates below
```

## Validation

```sh
cd packages/canvas
bun test                  # contract, native encode (PNG/WebP/AVIF), vendor drift, manifest
bun run typecheck         # sources, then published declarations with skipLibCheck: false
bun run lint && bun run format:check
bun run vendor:check
bun pm pack --destination <dir>
```

Lint and format checks use Bun's native `bun lint` and `bun fmt` commands
directly, without `bunx`, standalone Oxc tools, or subprocess backends.

## Publishing

`.github/workflows/release-m3-packages.yml` publishes this package before
`@aphrody/material-web` (which depends on it) when an `m3-v*` tag is pushed. The manifest holds
no `workspace:` or `catalog:` specifier, so the packed `package.json` is the registry
`package.json`. Manual equivalent, run by the owner:

```sh
cd packages/canvas && bun publish --access public --tag latest --registry https://registry.npmjs.org
```
