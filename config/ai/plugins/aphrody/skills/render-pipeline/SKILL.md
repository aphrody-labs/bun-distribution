---
name: render-pipeline
description: Use for Aphrody's unified 2D/3D rendering pipeline, CPU raster safety, M3 geometry, native canvas, Tauri/Wry, Obscura, WASM, and browser rendering.
---

# Aphrody render pipeline

Use `crates/aphrody-render` as the single OS-level rendering contract.
`RenderSurface` owns surface kind, logical dimensions, scale factor and the
canonical M3 adaptive layout. `NativeCanvas` and `NativeScene3d` are separate
lanes, while sharing geometry and validation.

## Boundaries

- Native consumers use `packages/canvas`.
- Browser/site consumers use `packages/canvas/site` and
  `packages/material-web`.
- Tauri/Wry and Obscura host native or web surfaces; they do not duplicate
  backend policy.
- `aphrody-m3` and `aphrody-m3-tokens` remain the source of M3 layout, theme,
  typography and accessibility contracts.
- The `gpu` feature is real (wgpu, DX12 first on Windows): every GPU user goes
  through `gpu::shared_context()`; never open a second device. CPU
  (`raster3d`, `raster`) stays the deterministic reference and GPU output must
  keep pixel parity with it (`gpu3d_matches_cpu_reference`).
- 3D enters through `pipeline3d::Pipeline3d` (`CpuOnly` / `Auto` /
  `GpuRequired`); models through `model` (`gltf`, `tobj`, `write_glb`,
  `studio_scene`). Do not add another 3D engine or model parser.
- Native 3D in Tauri is `crates/aphrody-tauri-3d` (DirectComposition layer
  under a transparent webview, `md-native-3d` on the page); agents use the
  `render3d_*` kernel tools (`crates/aphrody-render3d`).
- No IEVR dependency belongs in Aphrody OS.

## CPU safety invariants

Before allocating RGBA8 storage, call `rgba8_len`. It rejects zero dimensions
and checked multiplication overflow. Use `fill_rgba8_rows` for background
initialisation; it validates the exact buffer length and writes contiguous rows.
Invalid input returns `false` without modifying the buffer. Keep the crate
`unsafe`-free and never silently truncate dimensions.

## Verification

Run the narrowest gates first:

```text
cargo test -p aphrody-render --locked
cargo clippy -p aphrody-render --locked --all-targets -- -D warnings
cargo test -p aphrody-render --features gpu --locked
cargo test -p aphrody-render3d
bun test ./packages/canvas/index.test.ts
```

Then run the package's typecheck/lint and the repository's scoped web
verification. Do not make unrelated workspace formatting changes to conceal
pre-existing drift.
