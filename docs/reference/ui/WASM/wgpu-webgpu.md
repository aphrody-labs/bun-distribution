<!-- SPDX-License-Identifier: Apache-2.0 -->
# wgpu and WASM pins

Pins referenced by the root `Cargo.toml`. For API usage, query the current wgpu and
wasm-bindgen docs (Context7) instead of copying snippets.

## Pins

| Crate / tool | Pin | Rule |
| --- | --- | --- |
| `wgpu` | `26` (`default-features = false`) | Production line until the 26 -> 29 migration below lands in one change. |
| `wasm-bindgen` | `=0.2.128` | Exact pin; `wasm-bindgen-cli` must be the same version (`cargo install wasm-bindgen-cli --version =0.2.128 --locked`). Same pin in `nie`. |
| `web-sys` | `0.3` | WebGPU bindings need `--cfg=web_sys_unstable_apis`. |
| `wee_alloc` | banned | Archived and leaks memory; use the default allocator and `wasm-opt -Oz`. |

## Browser notes

- Enable `webgpu` and `webgl` features for browser targets; wgpu falls back to WebGL2 when the
  adapter lacks compute shaders. Use `Limits::downlevel_webgl2_defaults()` on WebGL2.
- Drive rendering from `requestAnimationFrame`; the surface is not ready before the first paint.
- Next.js with Turbopack does not bundle WASM; use `next dev --webpack` where WASM is needed.

## Migration 26 -> 29 (breaking)

1. `Surface::get_current_texture` returns the `CurrentSurfaceTexture` enum (`Success`, `Timeout`,
   `Occluded`, `Outdated`, `Suboptimal`, `Lost`, `Validation`) instead of a `Result`.
2. `InstanceDescriptor` lost `Default`; use `new_without_display_handle()` or
   `new_with_display_handle(..)`.
3. `SurfaceTexture::present()` became `Queue::present(surface_texture)`.
4. `PipelineLayoutDescriptor::bind_group_layouts` and `VertexState::buffers` take `Option`s.
5. `Features::CLIP_DISTANCE` is `CLIP_DISTANCES`; `dispatch` / `dispatch_indirect` are
   `dispatch_workgroups` / `dispatch_workgroups_indirect`.

Run `cargo check` on Windows, Linux and wasm32 after the switch.
