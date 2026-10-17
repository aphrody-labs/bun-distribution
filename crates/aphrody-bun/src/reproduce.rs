// SPDX-License-Identifier: Apache-2.0
//! FFI for `aphrody-m3-reproduce`: reproduce a site in M3 from a screenshot or a crawl.
//! JSON in/out envelope, freed with `bun_rs_free_string`.

use std::ffi::{CString, c_char};

use aphrody_m3_reproduce::{ReproductionPlan, plan::ReproductionSource};

/// Which input `bun_rs_m3_reproduce` was given.
#[repr(u8)]
enum InputKind {
    Url = 0,
    Image = 1,
    Html = 2,
}

impl TryFrom<u8> for InputKind {
    type Error = String;

    fn try_from(value: u8) -> Result<Self, Self::Error> {
        match value {
            0 => Ok(Self::Url),
            1 => Ok(Self::Image),
            2 => Ok(Self::Html),
            other => Err(format!(
                "unknown input kind {other} (expected 0=url, 1=image, 2=html)"
            )),
        }
    }
}

fn reproduce(kind: InputKind, input: &[u8]) -> Result<ReproductionPlan, String> {
    match kind {
        InputKind::Url => {
            let url = std::str::from_utf8(input).map_err(|e| e.to_string())?;
            #[cfg(not(target_arch = "wasm32"))]
            {
                aphrody_m3_reproduce::fetch::plan_from_url(url).map_err(|e| e.to_string())
            }
            // wasm32 has no blocking HTTP client: the JS host fetches and sends `kind = 2`.
            #[cfg(target_arch = "wasm32")]
            {
                Err(format!(
                    "cannot fetch {url} from wasm32 (no blocking HTTP client); fetch the HTML in \
                     the host and pass it with kind=2 (html)"
                ))
            }
        }
        InputKind::Image => ReproductionPlan::from_image_bytes(input).map_err(|e| e.to_string()),
        InputKind::Html => {
            let html = std::str::from_utf8(input).map_err(|e| e.to_string())?;
            Ok(ReproductionPlan::from_html(html, ReproductionSource::Html))
        }
    }
}

/// Reproduce a site in M3 from `input`: a URL (`kind = 0`, UTF-8), a PNG/JPEG screenshot
/// (`kind = 1`, raw bytes) or already-fetched HTML (`kind = 2`, UTF-8). Returns a JSON envelope,
/// `{"ok":true,"plan":<ReproductionPlan>}` or `{"ok":false,"error":...}`, to free with
/// `bun_rs_free_string`.
///
/// # Safety
/// * `input` must point to `len` readable bytes (or be null with `len == 0`).
#[unsafe(no_mangle)]
pub unsafe extern "C" fn bun_rs_m3_reproduce(
    kind: u8,
    input: *const u8,
    len: usize,
) -> *mut c_char {
    let result = InputKind::try_from(kind).and_then(|kind| {
        if input.is_null() && len > 0 {
            return Err("null input with non-zero length".to_owned());
        }
        let bytes = if input.is_null() {
            &[][..]
        } else {
            // SAFETY: the caller guarantees a non-null `input` covers `len` readable bytes.
            unsafe { std::slice::from_raw_parts(input, len) }
        };
        reproduce(kind, bytes)
    });

    let envelope = match result {
        Ok(plan) => serde_json::json!({ "ok": true, "plan": plan }),
        Err(error) => serde_json::json!({ "ok": false, "error": error }),
    };
    CString::new(envelope.to_string())
        .expect("JSON has no NUL")
        .into_raw()
}

/// The color most suitable for a UI theme (`sourceColorFromImage`-equivalent) from PNG/JPEG bytes,
/// as opaque ARGB. Returns Google Blue (`0xFF4285F4`) — the reference's own fallback — on decode
/// failure, so this function never needs an out-of-band error channel.
///
/// # Safety
/// * `image` must point to `len` readable bytes (or be null with `len == 0`).
#[unsafe(no_mangle)]
pub unsafe extern "C" fn bun_rs_m3_seed_from_image(image: *const u8, len: usize) -> u32 {
    const FALLBACK: u32 = 0xFF42_85F4;
    if image.is_null() {
        return FALLBACK;
    }
    // SAFETY: caller guarantees `image` covers `len` readable bytes.
    let bytes = unsafe { std::slice::from_raw_parts(image, len) };
    aphrody_m3_tokens::image::source_color_from_image_bytes(bytes).unwrap_or(FALLBACK)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::bun_rs_free_string;

    #[test]
    fn reproduce_html_round_trips_through_the_envelope() {
        let html = br##"<meta name="theme-color" content="#6750a4"><header>Top</header>"##;
        // SAFETY: `html` points to `html.len()` readable bytes for the call's duration.
        let ptr = unsafe { bun_rs_m3_reproduce(2, html.as_ptr(), html.len()) };
        // SAFETY: `ptr` is the well-formed, NUL-terminated `CString` `bun_rs_m3_reproduce` just
        // returned, not yet freed.
        let json = unsafe { std::ffi::CStr::from_ptr(ptr) }
            .to_str()
            .unwrap()
            .to_owned();
        // SAFETY: `ptr` was returned by `bun_rs_m3_reproduce` and is freed exactly once, here.
        unsafe { bun_rs_free_string(ptr) };

        let value: serde_json::Value = serde_json::from_str(&json).expect("valid JSON envelope");
        assert_eq!(value["ok"], true);
        assert_eq!(value["plan"]["theme"]["seedHex"], "#6750a4");
    }

    #[test]
    fn reproduce_rejects_unknown_kind() {
        // SAFETY: null pointer with a zero length is an explicitly allowed input.
        let ptr = unsafe { bun_rs_m3_reproduce(9, std::ptr::null(), 0) };
        // SAFETY: `ptr` is the well-formed, NUL-terminated `CString` `bun_rs_m3_reproduce` just
        // returned, not yet freed.
        let json = unsafe { std::ffi::CStr::from_ptr(ptr) }
            .to_str()
            .unwrap()
            .to_owned();
        // SAFETY: `ptr` was returned by `bun_rs_m3_reproduce` and is freed exactly once, here.
        unsafe { bun_rs_free_string(ptr) };

        let value: serde_json::Value = serde_json::from_str(&json).expect("valid JSON envelope");
        assert_eq!(value["ok"], false);
    }

    #[test]
    fn seed_from_image_falls_back_on_garbage_bytes() {
        let garbage = [0u8, 1, 2, 3];
        // SAFETY: `garbage` points to `garbage.len()` readable bytes for the call's duration.
        let argb = unsafe { bun_rs_m3_seed_from_image(garbage.as_ptr(), garbage.len()) };
        assert_eq!(argb, 0xFF42_85F4);
    }
}
