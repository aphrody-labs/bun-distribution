// SPDX-License-Identifier: Apache-2.0
//! `bun:ffi` bridge to `aphrody-render`'s deterministic CPU rasterizer.
//!
//! Exposes a single pixel-perfect snapshot entry point,
//! `bun_rs_render_png`, consumed by `packages/bun/src/render.ts`
//! (`m3Render`). The GPU backend (`aphrody_render::gpu`, feature `gpu`) is
//! deliberately not exposed over FFI: it is a headless, one-shot,
//! adapter-dependent parity backend meant for native Rust tests and
//! benchmarks, not for a Bun process that may have no GPU at all.

/// Render an [`aphrody_render::scene::Scene`] (given as UTF-8 JSON) to a
/// PNG-encoded RGBA8 image using the deterministic CPU rasterizer.
///
/// On success, returns a pointer to `*out_len` bytes of PNG data allocated by
/// Rust; the caller must free it with [`bun_rs_render_free`]. On any error
/// (malformed pointer, invalid UTF-8, invalid JSON, or a PNG encoding
/// failure) returns a null pointer and leaves `*out_len` at `0`.
///
/// # Safety
/// * `scene_json` must point to `len` readable bytes.
/// * `out_len` must point to a valid, writable `usize`.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn bun_rs_render_png(
    scene_json: *const u8,
    len: usize,
    out_len: *mut usize,
) -> *mut u8 {
    if out_len.is_null() {
        return std::ptr::null_mut();
    }
    // SAFETY: `out_len` was checked non-null; caller guarantees it is writable.
    unsafe {
        *out_len = 0;
    }
    if scene_json.is_null() {
        return std::ptr::null_mut();
    }
    // SAFETY: caller guarantees `scene_json` covers `len` readable bytes.
    let bytes = unsafe { std::slice::from_raw_parts(scene_json, len) };
    let Ok(text) = std::str::from_utf8(bytes) else {
        return std::ptr::null_mut();
    };
    let Ok(scene) = serde_json::from_str::<aphrody_render::scene::Scene>(text) else {
        return std::ptr::null_mut();
    };
    let Ok(png_bytes) = aphrody_render::raster::render_scene_png(&scene) else {
        return std::ptr::null_mut();
    };

    let boxed: Box<[u8]> = png_bytes.into_boxed_slice();
    // SAFETY: `out_len` was checked non-null above.
    unsafe {
        *out_len = boxed.len();
    }
    Box::into_raw(boxed).cast::<u8>()
}

/// Free a buffer returned by [`bun_rs_render_png`].
///
/// # Safety
/// * `ptr` must be a pointer returned by [`bun_rs_render_png`], with the same `len` it reported
///   through `out_len`.
/// * `ptr` must not have been freed already.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn bun_rs_render_free(ptr: *mut u8, len: usize) {
    if ptr.is_null() {
        return;
    }
    // SAFETY: caller guarantees `ptr`/`len` match a still-live allocation
    // returned by `bun_rs_render_png` (a boxed slice of exactly `len` bytes).
    unsafe {
        drop(Box::from_raw(std::ptr::slice_from_raw_parts_mut(ptr, len)));
    }
}

/// `policy` value for [`bun_rs_render3d_png`]: deterministic CPU only.
pub const RENDER3D_POLICY_CPU: u32 = 0;
/// `policy` value for [`bun_rs_render3d_png`]: GPU when available, else CPU.
pub const RENDER3D_POLICY_AUTO: u32 = 1;
/// `policy` value for [`bun_rs_render3d_png`]: GPU or failure.
pub const RENDER3D_POLICY_GPU: u32 = 2;

/// One long-lived pipeline per policy, so the GPU device, pipelines and
/// mesh buffers survive across calls instead of being rebuilt per frame.
static PIPELINES: [std::sync::LazyLock<std::sync::Mutex<aphrody_render::pipeline3d::Pipeline3d>>;
    3] = [
    std::sync::LazyLock::new(|| {
        std::sync::Mutex::new(aphrody_render::pipeline3d::Pipeline3d::new(
            aphrody_render::RenderPolicy::CpuOnly,
        ))
    }),
    std::sync::LazyLock::new(|| {
        std::sync::Mutex::new(aphrody_render::pipeline3d::Pipeline3d::new(
            if cfg!(feature = "gpu") {
                aphrody_render::RenderPolicy::Auto
            } else {
                aphrody_render::RenderPolicy::CpuOnly
            },
        ))
    }),
    std::sync::LazyLock::new(|| {
        std::sync::Mutex::new(aphrody_render::pipeline3d::Pipeline3d::new(
            aphrody_render::RenderPolicy::GpuRequired,
        ))
    }),
];

/// Render an [`aphrody_render::scene3d::Scene3d`] (UTF-8 JSON) to a
/// PNG-encoded RGBA8 image through [`aphrody_render::pipeline3d::Pipeline3d`].
///
/// `policy` is one of [`RENDER3D_POLICY_CPU`] (bit-exact, deterministic),
/// [`RENDER3D_POLICY_AUTO`] (GPU when this library was built with the `gpu`
/// feature and an adapter exists, CPU otherwise) or [`RENDER3D_POLICY_GPU`].
/// Returns a buffer to free with [`bun_rs_render_free`], or null (with
/// `*out_len == 0`) for a malformed pointer, invalid UTF-8/JSON, an invalid
/// scene, an unknown policy or an unsatisfiable GPU requirement.
///
/// # Safety
/// * `scene_json` must point to `len` readable bytes.
/// * `out_len` must point to a valid, writable `usize`.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn bun_rs_render3d_png(
    scene_json: *const u8,
    len: usize,
    policy: u32,
    out_len: *mut usize,
) -> *mut u8 {
    if out_len.is_null() {
        return std::ptr::null_mut();
    }
    // SAFETY: `out_len` is non-null and the caller guarantees it is writable.
    unsafe {
        *out_len = 0;
    }
    if scene_json.is_null() {
        return std::ptr::null_mut();
    }
    let pipeline = match policy {
        RENDER3D_POLICY_CPU => &PIPELINES[0],
        RENDER3D_POLICY_AUTO => &PIPELINES[1],
        RENDER3D_POLICY_GPU if cfg!(feature = "gpu") => &PIPELINES[2],
        _ => return std::ptr::null_mut(),
    };
    // SAFETY: caller guarantees `scene_json` covers `len` readable bytes.
    let bytes = unsafe { std::slice::from_raw_parts(scene_json, len) };
    let Ok(scene) = serde_json::from_slice::<aphrody_render::scene3d::Scene3d>(bytes) else {
        return std::ptr::null_mut();
    };
    let frame = {
        let mut pipeline = pipeline.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
        pipeline.render(&scene)
    };
    let Ok(png_bytes) = frame.map_err(|_| ()).and_then(|f| f.to_png().map_err(|_| ())) else {
        return std::ptr::null_mut();
    };
    let boxed: Box<[u8]> = png_bytes.into_boxed_slice();
    // SAFETY: `out_len` was checked non-null above.
    unsafe {
        *out_len = boxed.len();
    }
    Box::into_raw(boxed).cast::<u8>()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_scene_json() -> String {
        r#"{
            "width": 16,
            "height": 16,
            "seed_argb": 4283215012,
            "variant": "tonal-spot",
            "is_dark": false,
            "contrast_level": 0.0,
            "background": { "kind": "role", "value": "surface" },
            "nodes": [
                {
                    "node": "surface",
                    "rect": { "x": 2.0, "y": 2.0, "w": 12.0, "h": 12.0 },
                    "corners": { "tl": 4.0, "tr": 4.0, "br": 4.0, "bl": 4.0 },
                    "fill": { "kind": "role", "value": "primary" },
                    "elevation": 1
                }
            ]
        }"#
        .to_string()
    }

    #[test]
    fn renders_a_valid_scene_to_png_bytes() {
        let json = sample_scene_json();
        let mut out_len = 0_usize;
        // SAFETY: `json` is a live, valid UTF-8 buffer for its own length;
        // `out_len` is a valid local `usize`.
        let ptr = unsafe {
            bun_rs_render_png(json.as_ptr(), json.len(), std::ptr::addr_of_mut!(out_len))
        };
        assert!(!ptr.is_null());
        assert!(out_len > 8, "PNG output should be non-trivially sized");
        // SAFETY: `ptr`/`out_len` were just returned by `bun_rs_render_png`.
        let bytes = unsafe { std::slice::from_raw_parts(ptr, out_len) };
        assert_eq!(&bytes[0..8], b"\x89PNG\r\n\x1a\n");
        // SAFETY: `ptr`/`out_len` are the exact pair returned above, freed once.
        unsafe { bun_rs_render_free(ptr, out_len) };
    }

    #[test]
    fn rejects_malformed_json() {
        let json = "not json";
        let mut out_len = 0_usize;
        // SAFETY: `json` is a live, valid UTF-8 buffer for its own length;
        // `out_len` is a valid local `usize`.
        let ptr = unsafe {
            bun_rs_render_png(json.as_ptr(), json.len(), std::ptr::addr_of_mut!(out_len))
        };
        assert!(ptr.is_null());
        assert_eq!(out_len, 0);
    }

    #[test]
    fn rejects_null_input() {
        let mut out_len = 0_usize;
        // SAFETY: a null `scene_json` pointer is an explicitly documented,
        // handled input; `out_len` is a valid local `usize`.
        let ptr =
            unsafe { bun_rs_render_png(std::ptr::null(), 0, std::ptr::addr_of_mut!(out_len)) };
        assert!(ptr.is_null());
        assert_eq!(out_len, 0);
    }
}

#[cfg(test)]
mod render3d_tests {
    use super::*;

    fn render(json: &str, policy: u32) -> Option<Vec<u8>> {
        let mut out_len = 0_usize;
        // SAFETY: `json` is a live buffer for its own length; `out_len` is a
        // valid local `usize`.
        let ptr = unsafe {
            bun_rs_render3d_png(json.as_ptr(), json.len(), policy, std::ptr::addr_of_mut!(out_len))
        };
        if ptr.is_null() {
            assert_eq!(out_len, 0);
            return None;
        }
        // SAFETY: `ptr`/`out_len` were just returned by `bun_rs_render3d_png`.
        let bytes = unsafe { std::slice::from_raw_parts(ptr, out_len) }.to_vec();
        // SAFETY: the exact pair returned above, freed once.
        unsafe { bun_rs_render_free(ptr, out_len) };
        Some(bytes)
    }

    const SCENE: &str = r#"{
        "width": 24, "height": 16, "seed_argb": 4284960932,
        "background": { "kind": "role", "value": "surface" },
        "lights": [
            { "light": "hemisphere", "sky": { "kind": "role", "value": "surface-bright" },
              "ground": { "kind": "role", "value": "surface-dim" }, "intensity": 0.5 },
            { "light": "directional", "direction": [-1, -1, -1],
              "color": { "kind": "fixed", "value": { "r": 255, "g": 255, "b": 255, "a": 255 } } }
        ],
        "nodes": [{ "node": "mesh", "geometry": { "shape": "sphere", "radius": 1.2 },
                    "material": { "base": { "kind": "role", "value": "primary" } } }]
    }"#;

    #[test]
    fn renders_a_3d_scene_deterministically_on_the_cpu() {
        let a = render(SCENE, RENDER3D_POLICY_CPU).expect("cpu render");
        let b = render(SCENE, RENDER3D_POLICY_CPU).expect("cpu render");
        assert_eq!(&a[..8], b"\x89PNG\r\n\x1a\n");
        assert_eq!(a, b);
    }

    #[test]
    fn auto_policy_renders_and_invalid_input_is_rejected() {
        assert!(render(SCENE, RENDER3D_POLICY_AUTO).is_some());
        assert!(render(SCENE, 7).is_none(), "unknown policy");
        assert!(render("{", RENDER3D_POLICY_CPU).is_none(), "malformed JSON");
        let bad = SCENE.replace("\"width\": 24", "\"width\": 0");
        assert!(render(&bad, RENDER3D_POLICY_CPU).is_none(), "invalid scene");
    }

    #[cfg(not(feature = "gpu"))]
    #[test]
    fn gpu_policy_without_the_gpu_feature_fails_cleanly() {
        assert!(render(SCENE, RENDER3D_POLICY_GPU).is_none());
    }
}
