<!-- SPDX-License-Identifier: Apache-2.0 -->
# M3 render: the native rendering layer

`crates/ui/render` owns the retained M3 scene model and its backends: a deterministic CPU
rasterizer (default, `#![forbid(unsafe_code)]`) and a headless `wgpu` backend behind the `gpu`
feature. Pins: [`../WASM/wgpu-webgpu.md`](../../reference/WASM/wgpu-webgpu.md). Agent guide: the
`render-pipeline` skill.

Current lanes: the Tauri webview (DOM, M3 components) proves desktop integration;
canvas, 3D and high-frequency visuals go through `aphrody-render`; tests, exports
and headless hosts use the CPU backend. The product desktop target is native
`wgpu` presentation, not the webview; see [`NATIVE-DESKTOP.md`](../../reference/NATIVE-DESKTOP.md).

## 2D scene (`src/scene.rs`)

`Scene` is a flat, ordered `Vec<Node>` painted back to front, plus the seed, variant, dark flag
and contrast of its `DynamicScheme`. Colours are `Paint::Role(..)` (resolved at render time, so
one scene renders light or dark without a rebuild) or `Paint::Fixed(Rgba8)`. JSON round-trips
through `serde` with kebab-case role names matching the CSS properties.

| Node | Meaning |
| --- | --- |
| `Surface` | Rounded rect with per-corner radii, elevation 0-5, optional outline. |
| `StateLayer` | Content-role overlay at the M3 hover/focus/pressed/dragged opacity. |
| `Ripple` | One frame of an expanding circle; the caller drives the animation. |
| `Text` | Single-line text at one of the 15 M3 type roles (Google Sans Flex, `fontdue`). |
| `Icon` | SVG path from a 24x24 viewBox, nonzero fill. |
| `Image` | Pre-decoded RGBA8, nearest-scaled. |

- Geometry (`src/geometry.rs`) defines the rounded-box SDF and a logistic shadow falloff once in
  Rust and identically in WGSL (`src/gpu.wgsl`); `erf` is avoided because WGSL lacks it.
- Both backends composite the same CPU-rasterized glyph coverage; no shaping, wrapping or BiDi.
- Malformed SVG paths are skipped, never panic.
- Parity: `gpu_matches_cpu_within_tolerance` requires <= 2/255 per channel on >= 99.5 % of pixels.
- GPU tests and benches skip (not fail) when no adapter exists (CI, VPS, WSL).
- All GPU work goes through one process-wide device (`gpu::shared_device()` /
  `shared_context()`), recreated on device loss; never open a device per frame.

## 3D lane (`scene3d`, `mesh3d`, `raster3d`, `gpu3d`, `pipeline3d`)

- `Scene3d`: groups with TRS transforms (three.js conventions), meshes (box, rounded box,
  sphere, plane, cylinder, torus, indexed), look-at camera, up to 16 lights, metallic/roughness
  PBR materials whose colours are M3 `Paint`s, one shadow-casting directional light, 4x MSAA.
- `Scene3d::prepare_with` is the single interpreter (validation, flattening, culling, batching);
  the CPU reference (`raster3d`) and the persistent GPU renderer (`gpu3d::Renderer3d`, one
  instanced draw per batch) consume the same `Prepared3d`.
- `pipeline3d::Pipeline3d` policies: `CpuOnly`, `Auto` (GPU with CPU fallback), `GpuRequired`
  (fails loudly).
- Models (`model`): `gltf` and `tobj` import, `inspect`, `write_glb`, `studio_scene`.
- Browser twin: `@aphrody/material-web` `md-3d-scene` renders the same JSON with three.js.

Native hosts:

- `crates/aphrody-tauri-3d` (not in repo) (plugin `aphrody-3d`): a wgpu layer under a transparent webview
  (DirectComposition visual on Windows, window surface elsewhere). The page sends intents only
  (`attach`, `set_scene`, `load_model`, `set_viewport`, `orbit`, `info`); `md-native-3d` is the
  element that reports its rect.
- `crates/aphrody-model-view` (not in repo): frameless transparent viewer with live reload.
- Retired 2026-10-03: `aphrody-render3d` (kernel subsystem `render3d`), removed from the repository; `aphrody-render` is the single render owner. Its former agent tools `render3d_model_inspect`,
  `render3d_model_scene`, `render3d_render`, `render3d_model_render`, `render3d_export_glb`,
  `render3d_view` were removed with it.

## FFI

- `bun_rs_render_png` (CPU 2D) and `bun_rs_render3d_png` (policy 0 CPU, 1 auto, 2 GPU), freed
  with `bun_rs_render_free`; exposed as `m3Render(scene)` and `m3Render3d(scene, policy)` by
  `@aphrody/bun`. Wire types in `packages/interop/native/src/scene-types.ts` mirror `scene.rs` by hand
  (kept honest by the JSON round-trip test).
- `@aphrody/canvas` `drawM3Scene` / `drawM3Scene3d` import `@aphrody/bun` lazily (optional peer);
  `packages/canvas/scene-types.d.ts` is a drift-checked copy of the wire types.

## Known limits

2D GPU draws are not batched (one uniform buffer per node) and the CPU path re-rasterizes icons
every frame; text is single-line.

## Validation

```sh
cargo test -p aphrody-render --locked
cargo test -p aphrody-render --locked --features gpu
cargo clippy -p aphrody-render --locked --all-targets --features gpu -- -D warnings
cargo test -p aphrody-bun --locked
(cd packages/canvas && bun test)
```
