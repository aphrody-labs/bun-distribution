# Aphrody graphics dependency boundary

Checked on 2026-09-29 against the Aphrody UI renderer manifests, Bevy
`v0.19.1`, Dust and Gecko fork heads. These are *measured pins*, not an
instruction to change an emulator's graphics implementation by search/replace.

| Dependency | Aphrody UI renderer | Bevy 0.19.1 | Gecko | Dust | Decision |
| --- | --- | --- | --- | --- | --- |
| Rust toolchain | 1.98.1 | Aphrody fork 1.98.1; upstream MSRV 1.95 | 1.96 upstream | nightly-only dependencies | Pin the Bevy fork and qualify each emulator separately |
| Edition | 2024 | 2024 | 2024 | 2021 | Do not perform an edition migration without full core tests |
| `wgpu` | 26.x production | 29.0.3 manifest | 29.0.3 | 23.0 | No cross-version `Device`, `Queue`, `Texture` or `Surface` in public APIs |
| `image` | 0.25.8 compatible line | 0.25.2 compatible line | internal crate | independent | Reuse compatible semver resolution; no forced major change |
| `bytemuck` | 1.x | 1.x | 1.x | not a common renderer contract | Compatible family; keep feature sets local |
| `serde` / `tracing` | 1.x / 0.1.x | 1.x / 0.1.x | 1.x / 0.1.x | core `serde` optional | Share schemas, not a copied runtime |

The current Aphrody UI [`aphrody-render`](https://github.com/aphrody-code/aphrody-ui/tree/main/crates/aphrody-render)
already has a backend-independent `RenderedFrame` with width, height and
straight-alpha sRGB RGBA8 pixels, plus a persistent GPU renderer and CPU
fallback. Do not import that renderer into Bevy or copy its rasterizer. The
first interop seam is an owned RGBA8 frame/scene payload; the UI-owned adapter
can upload it on its own `wgpu` 26 device. A direct GPU-resource handoff is
blocked until the UI's documented 26-to-29 migration and native/browser parity
gates pass. Bevy and Gecko already share the `wgpu` 29 API family but still
require an explicit lifecycle/ownership adapter, not duplicate render loops.

Dust's `wgpu` 23 renderer and nightly SIMD utility dependency are independent
migration tracks. Dust's DS CPU/bus correctness must be validated before any
renderer replacement. None of these version mismatches is resolved by pinning
all manifests to the newest `wgpu` release.
