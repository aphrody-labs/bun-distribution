// SPDX-License-Identifier: Apache-2.0
//! Compile the browser surface constructors required by IECODE's WASM renderers.
#![cfg(all(target_arch = "wasm32", any(feature = "webgpu", feature = "webgl")))]

use aphrody_gpu_backend::wgpu;

#[test]
fn web_features_export_canvas_surface_targets() {
    let _ = wgpu::SurfaceTarget::Canvas;
    let _ = wgpu::SurfaceTarget::OffscreenCanvas;
}
