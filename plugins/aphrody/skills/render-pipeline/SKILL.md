---
name: render-pipeline
description: "Aphrody OS rendering (crate aphrody-render, @aphrody/canvas): surfaces, CPU raster safety, wgpu GPU parity, Pipeline3d and RenderPolicy, glTF/OBJ models, Tauri/Obscura/web hosts. Use for 2D/3D rendering work in the Aphrody monorepo."
version: "1.1.0"
---

# Aphrody render pipeline

Applies to the Aphrody monorepo (root `package.json` named `aphrody`). Elsewhere, treat this
as a design reference only.

Crate `aphrody-render` (`crates/ui/render`) is the single OS-level rendering contract.
`RenderSurface` owns surface kind, logical dimensions, scale factor and the canonical M3
adaptive layout. `SurfaceKind::NativeCanvas` (2D) and `SurfaceKind::NativeScene3d` (3D) are
separate lanes that share geometry and validation; `RenderPolicy` (`lib.rs`) decides CPU vs GPU.

## Layout of the crate

| Module | Role |
| --- | --- |
| `lib.rs` | `RenderSurface`, `SurfaceKind`, `Backend`, `RenderPolicy`, `rgba8_len`, `fill_rgba8_rows` |
| `canvas.rs`, `raster.rs`, `text.rs`, `geometry.rs` | 2D canvas and CPU raster |
| `scene3d.rs`, `mesh3d.rs`, `math3d.rs`, `raster3d.rs` | 3D scene model and CPU reference rasterizer |
| `pipeline3d.rs` | `Pipeline3d` with `RenderPolicy::{CpuOnly, Auto, GpuRequired}`; reports `RenderedBy` |
| `gpu.rs`, `gpu3d.rs` (+ `.wgsl`) | headless wgpu backend behind the `gpu` feature |
| `model.rs` | glTF and OBJ import (`gltf`, `tobj`), `write_glb`, `studio_scene` |
| `src/bin/aphrody-canvas.rs` | CLI front end |

Features: `default = ["cpu", "parallel"]` (`parallel` = rayon, bit-identical output);
`gpu` enables wgpu; `vulkan` / `dx12` / `metal` are aliases of `gpu` (wgpu picks the backend
at adapter time).

## Boundaries

- Bun/TS consumers use `@aphrody/canvas` (`packages/ui/canvas`): `.` for native (FFI through
  `@aphrody/bun`, which exposes `bun_rs_render3d_png` with the same three policies), `./site`
  (alias `./browser`) for browser/site rendering; web components come from
  `@aphrody/material-web`.
- Tauri/Wry (`crates/ui/app`) and Obscura (`obscura-render`) host native or web surfaces; they
  do not duplicate backend policy.
- `aphrody-m3-tokens` (`crates/ui/m3-tokens`, including its `facade` module) is the source of
  M3 layout, theme, typography and accessibility contracts.
- Every GPU user goes through `gpu::shared_context()`; never open a second device. The CPU
  path stays the deterministic reference and GPU output must keep pixel parity with it
  (test `gpu3d_matches_cpu_reference` in `gpu3d.rs`, which skips when no adapter exists).
- 3D enters through `pipeline3d::Pipeline3d`; models through `model`. Do not add another 3D
  engine or model parser.
- No game-specific (NIE/IEVR) dependency belongs in Aphrody OS rendering.

## CPU safety invariants

Before allocating RGBA8 storage, call `rgba8_len`: it rejects zero dimensions and checked
multiplication overflow. Use `fill_rgba8_rows` for background initialisation; it validates
the exact buffer length and writes contiguous rows. Invalid input returns `false` without
modifying the buffer. Keep the crate `unsafe`-free and never silently truncate dimensions.

## Verification

Narrowest gates first (respect the project rule on who runs cargo; if builds are reserved
for the lead or CI, hand these commands over instead of running them):

```text
cargo test -p aphrody-render --locked
cargo clippy -p aphrody-render --locked --all-targets -- -D warnings
cargo test -p aphrody-render --features gpu --locked
bun test ./packages/ui/canvas
```

Then run the package's typecheck/lint. Do not make unrelated formatting changes to hide
pre-existing drift.
