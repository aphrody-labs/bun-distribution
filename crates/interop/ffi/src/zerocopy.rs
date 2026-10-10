// SPDX-License-Identifier: Apache-2.0
//! Zero-copy exports: the caller (Bun) owns every buffer.
//!
//! Conventions shared by every function in this module:
//!
//! * Inputs are `(pointer, length)` pairs over caller memory (`Uint8Array`,
//!   `Float32Array`); no NUL terminator is required and nothing is copied
//!   beyond what the wrapped crate itself needs.
//! * Raster functions mutate the caller's pixel and depth buffers in place and
//!   return a status code (`0` success, negative failure). They never
//!   allocate and never return a library-owned pointer.
//! * Text-producing functions write UTF-8 JSON into a caller buffer
//!   `(out, out_cap)` and return the number of bytes of the document. When the
//!   result is larger than `out_cap` nothing is written, so the caller retries
//!   with a buffer of the returned size. Nothing library-owned is returned, so
//!   there is no matching free function. A negative value is an argument error
//!   (`-1`) or a caught panic (`-3`); Rust-side failures are reported inside the
//!   document as `{"error": "..."}`.

use std::{
    panic::{AssertUnwindSafe, catch_unwind},
    slice,
};

use serde_json::{Value, json};

/// ABI version of this module's symbols.
pub const ZEROCOPY_ABI_VERSION: u32 = 1;

/// Status: success.
pub const ZC_OK: i32 = 0;
/// Status: null pointer, misaligned pointer, size overflow or invalid UTF-8.
pub const ZC_INVALID: i32 = -1;
/// Status: a Rust panic was caught at the boundary.
pub const ZC_PANIC: i32 = -3;

/// ABI version of the zero-copy exports.
#[unsafe(no_mangle)]
pub extern "C" fn aphrody_zerocopy_abi_version() -> u32 {
    ZEROCOPY_ABI_VERSION
}

/// Copy `doc` into the caller buffer when it fits; always return its length.
///
/// # Safety
/// `out` must be null or valid for `cap` writable bytes.
unsafe fn write_doc(doc: &str, out: *mut u8, cap: usize) -> i64 {
    let len = doc.len();
    let Ok(ret) = i64::try_from(len) else {
        return i64::from(ZC_INVALID);
    };
    if !out.is_null() && len <= cap {
        // SAFETY: `out` is valid for `cap >= len` bytes and `doc` is a distinct
        // Rust allocation, so the ranges cannot overlap.
        unsafe { std::ptr::copy_nonoverlapping(doc.as_ptr(), out, len) };
    }
    ret
}

/// Borrow `(ptr, len)` as UTF-8.
///
/// # Safety
/// `ptr` must be null or valid for `len` readable bytes.
unsafe fn borrow_utf8<'a>(ptr: *const u8, len: usize) -> Option<&'a str> {
    if ptr.is_null() {
        return None;
    }
    // SAFETY: guaranteed by the caller.
    std::str::from_utf8(unsafe { slice::from_raw_parts(ptr, len) }).ok()
}

/// Repair malformed model-emitted JSON (markdown fences, trailing commas,
/// single quotes, unquoted keys, Python literals, truncation, double encoding).
///
/// Writes `{"value": <json>, "repairs": ["TrailingComma", ...]}` or
/// `{"error": "..."}` into `out` and returns the document length.
///
/// # Safety
/// `input` must be valid for `input_len` readable bytes and `out` must be null
/// or valid for `out_cap` writable bytes; the two ranges must not overlap.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn aphrody_toolcall_repair_json(
    input: *const u8,
    input_len: usize,
    out: *mut u8,
    out_cap: usize,
) -> i64 {
    catch_unwind(AssertUnwindSafe(|| {
        // SAFETY: pointer contract documented above.
        let Some(text) = (unsafe { borrow_utf8(input, input_len) }) else {
            return i64::from(ZC_INVALID);
        };
        let doc = match aphrody_toolcall_repair::repair_json_with_report(text) {
            Ok(report) => json!({
                "value": report.value,
                "repairs": report.repairs.iter().map(|kind| format!("{kind:?}")).collect::<Vec<_>>(),
            }),
            Err(error) => json!({ "error": error.to_string() }),
        };
        // SAFETY: pointer contract documented above.
        unsafe { write_doc(&doc.to_string(), out, out_cap) }
    }))
    .unwrap_or(i64::from(ZC_PANIC))
}

/// Validate tool-call arguments against a JSON-Schema subset.
///
/// Writes `{"violations": [{"pointer": "...", "message": "..."}]}` or
/// `{"error": "..."}` into `out` and returns the document length.
///
/// # Safety
/// `args`/`schema` must be valid for their lengths and `out` null or valid for
/// `out_cap` writable bytes; the output must not overlap the inputs.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn aphrody_toolcall_validate_json(
    args: *const u8,
    args_len: usize,
    schema: *const u8,
    schema_len: usize,
    out: *mut u8,
    out_cap: usize,
) -> i64 {
    catch_unwind(AssertUnwindSafe(|| {
        // SAFETY: pointer contract documented above.
        let (Some(args_text), Some(schema_text)) =
            (unsafe { borrow_utf8(args, args_len) }, unsafe { borrow_utf8(schema, schema_len) })
        else {
            return i64::from(ZC_INVALID);
        };
        let doc = match (
            serde_json::from_str::<Value>(args_text),
            serde_json::from_str::<Value>(schema_text),
        ) {
            (Ok(args), Ok(schema)) => {
                let violations = aphrody_toolcall_repair::validate_arguments(&args, &schema);
                json!({
                    "violations": violations
                        .iter()
                        .map(|v| json!({ "pointer": v.pointer, "message": v.message }))
                        .collect::<Vec<_>>(),
                })
            },
            (Err(error), _) => json!({ "error": format!("args: {error}") }),
            (_, Err(error)) => json!({ "error": format!("schema: {error}") }),
        };
        // SAFETY: pointer contract documented above.
        unsafe { write_doc(&doc.to_string(), out, out_cap) }
    }))
    .unwrap_or(i64::from(ZC_PANIC))
}

/// Rasterize one screen-space triangle into caller-owned buffers, in place.
///
/// * `px`: RGBA8, `width * height * 4` bytes.
/// * `zbuf`: `width * height` `f32` depths (4-byte aligned; fill with
///   `Infinity` before the first triangle).
/// * `verts`: 9 `f32` = `[ax, ay, az, bx, by, bz, cx, cy, cz]` (pixels, depth > 0).
/// * `uv`: 6 `f32` = `[u0, v0, u1, v1, u2, v2]`, or null for zeros.
/// * `tex`/`tex_w`/`tex_h`: optional RGBA8 texture of `tex_w * tex_h * 4`
///   bytes; null selects flat shading with `base_rgb`.
/// * `base_rgb`: 3 `f32` in `0..=255`, or null for white.
///
/// Returns `0`, `-1` on invalid arguments or `-3` on a caught panic. A call
/// with inconsistent sizes draws nothing.
///
/// # Safety
/// Every non-null pointer must be valid for the sizes stated above; `px`,
/// `zbuf` and `tex` must not overlap.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn aphrody_raster_fill_triangle(
    px: *mut u8,
    zbuf: *mut f32,
    width: u32,
    height: u32,
    verts: *const f32,
    uv: *const f32,
    tex: *const u8,
    tex_w: u32,
    tex_h: u32,
    shade: f32,
    base_rgb: *const f32,
) -> i32 {
    catch_unwind(AssertUnwindSafe(|| {
        if px.is_null() || zbuf.is_null() || verts.is_null() || !(zbuf as usize).is_multiple_of(4) {
            return ZC_INVALID;
        }
        let Some(pixels) = (width as usize).checked_mul(height as usize) else {
            return ZC_INVALID;
        };
        let Some(px_len) = pixels.checked_mul(4) else {
            return ZC_INVALID;
        };
        // SAFETY: pointer contract documented above; `verts`, `uv` and `base_rgb`
        // are read unaligned element by element.
        let read = |p: *const f32, i: usize| unsafe { p.add(i).read_unaligned() };
        let vertex =
            |i: usize| (read(verts, i * 3), read(verts, i * 3 + 1), read(verts, i * 3 + 2));
        let mut uvs = [[0.0_f32; 2]; 3];
        if !uv.is_null() {
            for (i, pair) in uvs.iter_mut().enumerate() {
                *pair = [read(uv, i * 2), read(uv, i * 2 + 1)];
            }
        }
        let base = if base_rgb.is_null() {
            [255.0; 3]
        } else {
            [read(base_rgb, 0), read(base_rgb, 1), read(base_rgb, 2)]
        };
        let texture = if tex.is_null() {
            None
        } else {
            let Some(tex_len) =
                (tex_w as usize).checked_mul(tex_h as usize).and_then(|n| n.checked_mul(4))
            else {
                return ZC_INVALID;
            };
            // SAFETY: `tex` is valid for `tex_w * tex_h * 4` bytes.
            Some(crate::softraster::TextureView {
                width: tex_w,
                height: tex_h,
                rgba: unsafe { slice::from_raw_parts(tex, tex_len) },
            })
        };
        // SAFETY: `px`/`zbuf` are valid, non-overlapping and exclusively borrowed
        // for the duration of this call by the contract above.
        let (px, zbuf) = unsafe {
            (slice::from_raw_parts_mut(px, px_len), slice::from_raw_parts_mut(zbuf, pixels))
        };
        crate::softraster::fill_triangle(
            px,
            zbuf,
            width,
            height,
            vertex(0),
            vertex(1),
            vertex(2),
            uvs,
            texture.as_ref(),
            shade,
            base,
        );
        ZC_OK
    }))
    .unwrap_or(ZC_PANIC)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn repair(input: &str) -> Value {
        let mut out = vec![0_u8; 4096];
        let n = unsafe {
            aphrody_toolcall_repair_json(input.as_ptr(), input.len(), out.as_mut_ptr(), out.len())
        };
        assert!(n > 0);
        serde_json::from_slice(&out[..n as usize]).unwrap()
    }

    #[test]
    fn repair_fixes_trailing_comma_and_reports_it() {
        let doc = repair(r#"{"a": 1,}"#);
        assert_eq!(doc["value"]["a"], 1);
        assert!(!doc["repairs"].as_array().unwrap().is_empty());
    }

    #[test]
    fn repair_reports_required_size_without_writing() {
        let input = r#"{"k":"v"}"#;
        let mut out = [0xAA_u8; 2];
        let n = unsafe {
            aphrody_toolcall_repair_json(input.as_ptr(), input.len(), out.as_mut_ptr(), out.len())
        };
        assert!(n > 2);
        assert_eq!(out, [0xAA; 2]);
    }

    #[test]
    fn repair_rejects_null_input() {
        let n =
            unsafe { aphrody_toolcall_repair_json(std::ptr::null(), 0, std::ptr::null_mut(), 0) };
        assert_eq!(n, i64::from(ZC_INVALID));
    }

    #[test]
    fn validate_flags_missing_required_property() {
        let args = "{}";
        let schema = r#"{"type":"object","required":["x"],"properties":{"x":{"type":"string"}}}"#;
        let mut out = vec![0_u8; 1024];
        let n = unsafe {
            aphrody_toolcall_validate_json(
                args.as_ptr(),
                args.len(),
                schema.as_ptr(),
                schema.len(),
                out.as_mut_ptr(),
                out.len(),
            )
        };
        let doc: Value = serde_json::from_slice(&out[..n as usize]).unwrap();
        assert!(!doc["violations"].as_array().unwrap().is_empty());
    }

    #[test]
    fn raster_fills_pixels_in_place() {
        let (w, h) = (8_u32, 8_u32);
        let mut px = vec![0_u8; (w * h * 4) as usize];
        let mut z = vec![f32::INFINITY; (w * h) as usize];
        let verts = [0.0_f32, 0.0, 1.0, 8.0, 0.0, 1.0, 0.0, 8.0, 1.0];
        let base = [255.0_f32, 0.0, 0.0];
        let status = unsafe {
            aphrody_raster_fill_triangle(
                px.as_mut_ptr(),
                z.as_mut_ptr(),
                w,
                h,
                verts.as_ptr(),
                std::ptr::null(),
                std::ptr::null(),
                0,
                0,
                1.0,
                base.as_ptr(),
            )
        };
        assert_eq!(status, ZC_OK);
        assert!(z[0].is_finite());
        assert_eq!(&px[0..4], &[255, 0, 0, 255]);
    }

    #[test]
    fn raster_rejects_null_buffers() {
        let verts = [0.0_f32; 9];
        let status = unsafe {
            aphrody_raster_fill_triangle(
                std::ptr::null_mut(),
                std::ptr::null_mut(),
                1,
                1,
                verts.as_ptr(),
                std::ptr::null(),
                std::ptr::null(),
                0,
                0,
                1.0,
                std::ptr::null(),
            )
        };
        assert_eq!(status, ZC_INVALID);
    }
}
