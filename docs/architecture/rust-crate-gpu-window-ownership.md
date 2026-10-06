# Rust crate, GPU, and window ownership

**Audit date:** 2026-09-30  
**Scope:** first-party Cargo workspace in this repository; upstream snapshots under `docs/reference/` are reference material, not active workspace members.

## Current structure

- First-party crates live in domain directories under `crates/`. The IECODE import is grouped in `crates/iecode/` (not in repo); Koharu in `crates/koharu/` (not in repo); Obscura in `crates/web/`.
- The workspace has one direct `wgpu` dependency (30.0.1) and one shared context/adapter policy crate, `aphrody-gpu-backend`. GPU dependencies remain optional for CPU-only and WASM consumers.
- `nie-render3d` uses the shared GPU crate for adapter/device creation and surface policy. `aphrody-render` still creates its own context in addition to accepting an externally supplied device and queue. Its rendering pipeline and shaders are renderer-owned and should stay there.
- No active first-party Cargo member directly depends on Bevy, winit, SDL, glutin, or tao. The NIE reference design selects Bevy as a future game host and keeps emulation headless. This is a design decision, not an active windowing integration.
- Koharu's Tauri host is a separate existing product surface. Obscura is headless and does not own a native window.

## Convergence rules

1. Keep emulator scheduling, device models, frame data, and input contracts independent of GPU and window types.
2. Route GPU instance, adapter, device, and surface policy through the shared GPU owner. Keep renderer-specific pipelines local. Preserve externally supplied `Device`/`Queue` constructors during migration.
3. Choose one window owner per product host. If the NIE game host adopts Bevy, Bevy owns its window and event loop; do not add a parallel winit/SDL host. This does not imply moving the Koharu Tauri host into Bevy.
4. Keep upstream-derived package identities and notices intact unless a compatibility facade and a measured migration explicitly authorize a rename. A directory namespace alone does not establish crate ownership.

## Remaining work

- Done 2026-10-04: `aphrody-gpu-backend` now lives at `crates/native/gpu-backend` and IECODE consumes it by path (`../aphrody/crates/native/gpu-backend`). Remaining: route `aphrody-render` context creation through it without exposing GPU types in emulator-core APIs.
- Add a production NIE window host only when its owner and frame/input boundary are implemented and tested. The current workspace has no active Bevy/winit member.
- ~~Resolve the `aphrody-logo` workspace path~~ Done 2026-10-01: the crate is merged into `aphrody-identity` (module `logo`, `crates/ui/identity/src/logo.rs`, asset `crates/ui/identity/assets/logo/aphrody.webp`), so no sibling-checkout path dependency remains. Not yet compiled; verify with `cargo check -p aphrody-identity -p aphrody`.
- Treat `iecode-*`, `nie-*`, `koharu-*`, and `obscura-*` naming as separate compatibility decisions. A bulk package rename would affect Cargo selectors, dependency keys, documentation, and downstream imports; upstream-compatible package identities must not be changed mechanically.

## Validation evidence

`cargo metadata --no-deps --format-version 1` succeeded on 2026-09-30. The workspace has one direct `wgpu` version, and no active first-party Rust windowing dependency. A manifest scan found no missing in-repository Cargo path dependencies; the logo path above is a sibling-checkout dependency and is therefore not clone-portable.
