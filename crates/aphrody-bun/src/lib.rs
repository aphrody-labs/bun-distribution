// SPDX-License-Identifier: Apache-2.0
#![deny(clippy::all, clippy::undocumented_unsafe_blocks)]

//! Bun-RS FFI module. Exposes C-ABI functions to Bun applications
//! through `bun:ffi`.

use std::ffi::c_char;

pub mod icons;
mod icons_ffi;
mod render;
mod reproduce;
mod svg;
mod symbols;
mod validator;
pub use icons_ffi::icon_svg_json;
pub use icons_ffi::{bun_rs_icon_names, bun_rs_icon_svg};
pub use render::{bun_rs_render_free, bun_rs_render_png, bun_rs_render3d_png};
pub use reproduce::{bun_rs_m3_reproduce, bun_rs_m3_seed_from_image};
pub use svg::bun_rs_svg;

/// Get the version of the wrapper crate as a C-string.
///
/// # Safety
/// The returned pointer points to static read-only memory and must not be freed.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn bun_rs_version() -> *const c_char {
    c"1.0.0-canary".as_ptr()
}

/// ABI version of the exported bun_rs symbol set.
#[unsafe(no_mangle)]
pub extern "C" fn bun_rs_abi_version() -> u32 {
    1
}

/// Simple addition function to benchmark FFI round-trip overhead.
#[unsafe(no_mangle)]
pub extern "C" fn bun_rs_add(a: i32, b: i32) -> i32 {
    a.wrapping_add(b)
}

/// Count occurrences of a specific character in a byte buffer.
/// Uses SIMD acceleration via the `memchr` crate.
///
/// # Safety
/// * `data` must be a valid pointer to a memory region of at least `len` bytes.
/// * The memory must be readable.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn bun_rs_count_char(data: *const u8, len: usize, needle: u8) -> usize {
    if data.is_null() || len == 0 {
        return 0;
    }
    // SAFETY: caller guarantees `data` points to at least `len` valid readable bytes.
    let slice = unsafe { std::slice::from_raw_parts(data, len) };
    memchr::memchr_iter(needle, slice).count()
}

/// Find the byte offset of a substring (needle) inside a larger buffer (haystack).
/// Returns `-1` if the needle is not found.
///
/// # Safety
/// * `haystack` must be a valid pointer to at least `haystack_len` readable bytes.
/// * `needle` must be a valid pointer to at least `needle_len` readable bytes.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn bun_rs_find_bytes(
    haystack: *const u8,
    haystack_len: usize,
    needle: *const u8,
    needle_len: usize,
) -> isize {
    if needle_len == 0 {
        return 0;
    }
    if haystack.is_null() || needle.is_null() || haystack_len < needle_len {
        return -1;
    }
    // SAFETY: caller guarantees pointers are valid for their respective lengths.
    let h = unsafe { std::slice::from_raw_parts(haystack, haystack_len) };
    // SAFETY: caller guarantees pointers are valid for their respective lengths.
    let n = unsafe { std::slice::from_raw_parts(needle, needle_len) };

    // Simple substring search using memchr to find first byte matches
    let first = n[0];
    let mut offset = 0;
    while offset + n.len() <= h.len() {
        if let Some(pos) = memchr::memchr(first, &h[offset..h.len() - n.len() + 1]) {
            let actual_pos = offset + pos;
            if &h[actual_pos..actual_pos + n.len()] == n {
                return actual_pos as isize;
            }
            offset = actual_pos + 1;
        } else {
            break;
        }
    }
    -1
}

/// Convert HCT coordinates to packed ARGB u32.
#[unsafe(no_mangle)]
pub extern "C" fn bun_rs_hct_to_argb(hue: f32, chroma: f32, tone: f32) -> u32 {
    aphrody_m3_tokens::hct::Hct::new(hue as f64, chroma as f64, tone as f64).to_argb()
}

/// Convert packed ARGB u32 to HCT coordinates.
///
/// # Safety
/// * `hue`, `chroma`, and `tone` must be valid, writable pointers to f32.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn bun_rs_argb_to_hct(
    argb: u32,
    hue: *mut f32,
    chroma: *mut f32,
    tone: *mut f32,
) {
    if hue.is_null() || chroma.is_null() || tone.is_null() {
        return;
    }
    let hct = aphrody_m3_tokens::hct::Hct::from_argb(argb);
    // SAFETY: caller guarantees pointers are valid and writable.
    unsafe {
        *hue = hct.hue as f32;
        *chroma = hct.chroma as f32;
        *tone = hct.tone as f32;
    }
}

/// Generate the 13-stop tonal palette from HCT coordinates, writing the resulting
/// 13 ARGB values (u32 each) into the buffer `out_palette`.
///
/// # Safety
/// * `out_palette` must be a valid, writable pointer to at least 13 u32s.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn bun_rs_hct_tones(
    hue: f32,
    chroma: f32,
    _tone: f32,
    out_palette: *mut u32,
) {
    if out_palette.is_null() {
        return;
    }
    let tones_list = [
        0.0, 10.0, 20.0, 30.0, 40.0, 50.0, 60.0, 70.0, 80.0, 90.0, 95.0, 99.0, 100.0,
    ];
    // SAFETY: caller guarantees out_palette has capacity for 13 elements.
    unsafe {
        for (i, tone) in tones_list.iter().enumerate() {
            *out_palette.add(i) =
                aphrody_m3_tokens::hct::Hct::new(hue as f64, chroma as f64, *tone).to_argb();
        }
    }
}

/// Role order of `bun_rs_derive_scheme` (`ROLES` in packages/bun/src/index.ts).
const DERIVE_SCHEME_ROLES: [&str; 49] = [
    "background",
    "on-background",
    "surface",
    "surface-dim",
    "surface-bright",
    "surface-container-lowest",
    "surface-container-low",
    "surface-container",
    "surface-container-high",
    "surface-container-highest",
    "on-surface",
    "surface-variant",
    "on-surface-variant",
    "inverse-surface",
    "inverse-on-surface",
    "outline",
    "outline-variant",
    "shadow",
    "scrim",
    "surface-tint",
    "primary",
    "on-primary",
    "primary-container",
    "on-primary-container",
    "inverse-primary",
    "secondary",
    "on-secondary",
    "secondary-container",
    "on-secondary-container",
    "tertiary",
    "on-tertiary",
    "tertiary-container",
    "on-tertiary-container",
    "error",
    "on-error",
    "error-container",
    "on-error-container",
    "primary-fixed",
    "primary-fixed-dim",
    "on-primary-fixed",
    "on-primary-fixed-variant",
    "secondary-fixed",
    "secondary-fixed-dim",
    "on-secondary-fixed",
    "on-secondary-fixed-variant",
    "tertiary-fixed",
    "tertiary-fixed-dim",
    "on-tertiary-fixed",
    "on-tertiary-fixed-variant",
];

/// The 49 roles of the M3 tonal-spot scheme for a source hue, in `DERIVE_SCHEME_ROLES` order.
fn derive_scheme(hue: f64, chroma: f64, is_dark: bool) -> [u32; 49] {
    use aphrody_m3_tokens::scheme::{DynamicScheme, Palettes, Role, Variant};
    let palettes = Palettes::from_hue(Variant::TonalSpot, hue);
    let source = aphrody_m3_tokens::hct::Hct::new(hue, chroma, 50.0);
    let scheme = DynamicScheme::with_palettes(source, Variant::TonalSpot, is_dark, 0.0, palettes);
    DERIVE_SCHEME_ROLES.map(|name| scheme.argb(Role::from_name(name).expect("known M3 role")))
}

/// Derive the 49 M3 colour roles of the tonal-spot scheme (the M3 default) for a source hue, in
/// one mode. Exact port of material-color-utilities (see `aphrody_m3_tokens::scheme`); `chroma`
/// is kept for ABI compatibility, tonal spot only uses the hue.
///
/// # Safety
/// * `out_colors` must be a valid, writable pointer to at least 49 u32s.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn bun_rs_derive_scheme(
    hue: f32,
    chroma: f32,
    is_dark: bool,
    out_colors: *mut u32,
) {
    if out_colors.is_null() {
        return;
    }
    let colors = derive_scheme(f64::from(hue), f64::from(chroma), is_dark);
    // SAFETY: caller guarantees out_colors has capacity for 49 elements.
    unsafe { std::ptr::copy_nonoverlapping(colors.as_ptr(), out_colors, colors.len()) };
}

/// Request accepted by `bun_rs_m3_css` (JSON).
#[derive(serde::Deserialize, ts_rs::TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct M3CssRequest {
    /// `tokens`, `tailwind`, `spaceui` or `scheme`.
    pub sheet: String,
    /// Source colour (`#rrggbb`); defaults to the M3 baseline `#6750a4`.
    #[ts(optional)]
    pub seed: Option<String>,
    /// Scheme variant (`tonal-spot`, `vibrant`, ...); defaults to `tonal-spot`.
    #[ts(optional)]
    pub variant: Option<String>,
    /// Dark mode, for the single-mode `scheme` sheet.
    #[ts(optional)]
    pub dark: Option<bool>,
    /// Contrast level, -1..=1.
    #[ts(optional)]
    pub contrast: Option<f64>,
}

/// Render an M3 sheet from a JSON [`M3CssRequest`].
///
/// # Errors
/// Invalid JSON, sheet, seed, variant or contrast.
pub fn m3_css(request_json: &str) -> Result<String, String> {
    let request: M3CssRequest =
        serde_json::from_str(request_json).map_err(|e| format!("invalid request: {e}"))?;
    let request = aphrody_m3_tokens::sheets::SheetRequest::parse(
        &request.sheet,
        request.seed.as_deref(),
        request.variant.as_deref(),
        request.dark,
        request.contrast,
    )?;
    Ok(aphrody_m3_tokens::sheets::render(&request))
}

/// Render an M3 CSS sheet. `request` is a UTF-8 JSON [`M3CssRequest`]. Returns a JSON envelope,
/// `{"ok":true,"css":...}` or `{"ok":false,"error":...}`, to free with `bun_rs_free_string`.
///
/// # Safety
/// * `request` must point to `len` readable bytes.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn bun_rs_m3_css(request: *const u8, len: usize) -> *mut c_char {
    let result = if request.is_null() {
        Err("null request".to_owned())
    } else {
        // SAFETY: caller guarantees the pointer covers `len` bytes.
        let bytes = unsafe { std::slice::from_raw_parts(request, len) };
        std::str::from_utf8(bytes)
            .map_err(|e| e.to_string())
            .and_then(m3_css)
    };
    let envelope = match result {
        Ok(css) => serde_json::json!({ "ok": true, "css": css }),
        Err(error) => serde_json::json!({ "ok": false, "error": error }),
    };
    std::ffi::CString::new(envelope.to_string())
        .expect("JSON has no NUL")
        .into_raw()
}

/// Compile a Sass/SCSS string into CSS.
///
/// # Safety
/// * `source` must be a valid pointer to a UTF-8 encoded string of length `len`.
/// * Returns a pointer to a null-terminated C-style string containing either the compiled CSS or an
///   error message.
/// * The returned pointer is allocated by Rust (using `CString::into_raw`) and MUST be freed by JS
///   calling `bun_rs_free_string`.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn bun_rs_compile_sass(
    source: *const u8,
    len: usize,
    load_paths: *const u8,
    load_paths_len: usize,
    style_val: i32,
    quiet: bool,
    error_occurred: *mut bool,
) -> *mut c_char {
    if source.is_null() || len == 0 {
        if !error_occurred.is_null() {
            // SAFETY: pointer check is non-null.
            unsafe {
                *error_occurred = true;
            }
        }
        return std::ffi::CString::new("Error: empty or null source")
            .unwrap()
            .into_raw();
    }

    // SAFETY: caller guarantees the pointer is valid and contains at least `len` bytes.
    let slice = unsafe { std::slice::from_raw_parts(source, len) };
    let sass_str = match std::str::from_utf8(slice) {
        Ok(s) => s,
        Err(e) => {
            if !error_occurred.is_null() {
                // SAFETY: pointer check is non-null.
                unsafe {
                    *error_occurred = true;
                }
            }
            return std::ffi::CString::new(format!("UTF-8 error: {}", e))
                .unwrap()
                .into_raw();
        }
    };

    let mut options = grass::Options::default();
    if style_val == 1 {
        options = options.style(grass::OutputStyle::Compressed);
    } else {
        options = options.style(grass::OutputStyle::Expanded);
    }
    options = options.quiet(quiet);

    if !load_paths.is_null() && load_paths_len > 0 {
        // SAFETY: the caller contract guarantees a valid byte slice of this length.
        let l_slice = unsafe { std::slice::from_raw_parts(load_paths, load_paths_len) };
        if let Ok(s) = std::str::from_utf8(l_slice) {
            let paths: Vec<std::path::PathBuf> = s
                .split(';')
                .filter(|p| !p.is_empty())
                .map(std::path::PathBuf::from)
                .collect();
            options = options.load_paths(&paths);
        }
    }

    let options = std::panic::AssertUnwindSafe(options);

    // Use catch_unwind to prevent Rust panics from crashing Bun.
    let result =
        std::panic::catch_unwind(move || grass::from_string(sass_str.to_owned(), &options));

    match result {
        Ok(Ok(css)) => {
            if !error_occurred.is_null() {
                // SAFETY: pointer check is non-null.
                unsafe {
                    *error_occurred = false;
                }
            }
            std::ffi::CString::new(css).unwrap().into_raw()
        }
        Ok(Err(e)) => {
            if !error_occurred.is_null() {
                // SAFETY: pointer check is non-null.
                unsafe {
                    *error_occurred = true;
                }
            }
            std::ffi::CString::new(format!("Sass error: {}", e))
                .unwrap()
                .into_raw()
        }
        Err(_) => {
            if !error_occurred.is_null() {
                // SAFETY: pointer check is non-null.
                unsafe {
                    *error_occurred = true;
                }
            }
            std::ffi::CString::new("Rust panic during Sass compilation")
                .unwrap()
                .into_raw()
        }
    }
}

/// Compile a Sass/SCSS file into CSS.
///
/// # Safety
/// * `path` must be a valid pointer to a UTF-8 encoded string of length `len`.
/// * Returns a pointer to a null-terminated C-style string containing either the compiled CSS or an
///   error message.
/// * The returned pointer is allocated by Rust (using `CString::into_raw`) and MUST be freed by JS
///   calling `bun_rs_free_string`.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn bun_rs_compile_sass_file(
    path: *const u8,
    len: usize,
    load_paths: *const u8,
    load_paths_len: usize,
    style_val: i32,
    quiet: bool,
    error_occurred: *mut bool,
) -> *mut c_char {
    if path.is_null() || len == 0 {
        if !error_occurred.is_null() {
            // SAFETY: pointer check is non-null.
            unsafe {
                *error_occurred = true;
            }
        }
        return std::ffi::CString::new("Error: empty or null path")
            .unwrap()
            .into_raw();
    }

    // SAFETY: caller guarantees the pointer is valid and contains at least `len` bytes.
    let slice = unsafe { std::slice::from_raw_parts(path, len) };
    let path_str = match std::str::from_utf8(slice) {
        Ok(s) => s,
        Err(e) => {
            if !error_occurred.is_null() {
                // SAFETY: pointer check is non-null.
                unsafe {
                    *error_occurred = true;
                }
            }
            return std::ffi::CString::new(format!("UTF-8 error: {}", e))
                .unwrap()
                .into_raw();
        }
    };

    let mut options = grass::Options::default();
    if style_val == 1 {
        options = options.style(grass::OutputStyle::Compressed);
    } else {
        options = options.style(grass::OutputStyle::Expanded);
    }
    options = options.quiet(quiet);

    if !load_paths.is_null() && load_paths_len > 0 {
        // SAFETY: the caller contract guarantees a valid byte slice of this length.
        let l_slice = unsafe { std::slice::from_raw_parts(load_paths, load_paths_len) };
        if let Ok(s) = std::str::from_utf8(l_slice) {
            let paths: Vec<std::path::PathBuf> = s
                .split(';')
                .filter(|p| !p.is_empty())
                .map(std::path::PathBuf::from)
                .collect();
            options = options.load_paths(&paths);
        }
    }

    let options = std::panic::AssertUnwindSafe(options);

    // Use catch_unwind to prevent Rust panics from crashing Bun.
    let result = std::panic::catch_unwind(move || grass::from_path(path_str, &options));

    match result {
        Ok(Ok(css)) => {
            if !error_occurred.is_null() {
                // SAFETY: pointer check is non-null.
                unsafe {
                    *error_occurred = false;
                }
            }
            std::ffi::CString::new(css).unwrap().into_raw()
        }
        Ok(Err(e)) => {
            if !error_occurred.is_null() {
                // SAFETY: pointer check is non-null.
                unsafe {
                    *error_occurred = true;
                }
            }
            std::ffi::CString::new(format!("Sass error: {}", e))
                .unwrap()
                .into_raw()
        }
        Err(_) => {
            if !error_occurred.is_null() {
                // SAFETY: pointer check is non-null.
                unsafe {
                    *error_occurred = true;
                }
            }
            std::ffi::CString::new("Rust panic during Sass compilation")
                .unwrap()
                .into_raw()
        }
    }
}

/// Validate a source code string against M3 design system specifications.
/// Returns a pointer to a null-terminated C-style JSON string containing the validation score and
/// issues.
///
/// # Safety
/// * `source` must be a valid pointer to a UTF-8 encoded string of length `len`.
/// * The returned pointer is allocated by Rust and must be freed by JS using `bun_rs_free_string`.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn bun_rs_validate_spec(source: *const u8, len: usize) -> *mut c_char {
    if source.is_null() || len == 0 {
        return std::ffi::CString::new("{\"score\":100,\"issues\":[]}")
            .unwrap()
            .into_raw();
    }

    // SAFETY: caller guarantees the pointer is valid and contains at least `len` bytes.
    let slice = unsafe { std::slice::from_raw_parts(source, len) };
    let code_str = match std::str::from_utf8(slice) {
        Ok(s) => s,
        Err(_) => {
            return std::ffi::CString::new(
                "{\"score\":0,\"issues\":[{\"level\":\"error\",\"rule\":\"invalid-utf8\",\"\
                 message\":\"Invalid UTF-8 source code\",\"line\":1,\"matched\":\"\"}]}",
            )
            .unwrap()
            .into_raw();
        }
    };

    let (score, issues) = validator::validate_m3_spec(code_str);

    let json = serde_json::json!({
        "score": score,
        "issues": issues.iter().map(|issue| serde_json::json!({
            "level": issue.level,
            "rule": issue.rule,
            "message": issue.message,
            "line": issue.line,
            "matched": issue.matched,
        })).collect::<Vec<_>>(),
    });

    std::ffi::CString::new(json.to_string())
        .expect("JSON serialization escapes NUL")
        .into_raw()
}

/// Free a string allocated by Rust (returned by `bun_rs_compile_sass`).
///
/// # Safety
/// * `ptr` must be a pointer returned by `bun_rs_compile_sass`.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn bun_rs_free_string(ptr: *mut c_char) {
    if ptr.is_null() {
        return;
    }
    // SAFETY: retake ownership of the pointer to let CString drop and deallocate.
    unsafe {
        let _ = std::ffi::CString::from_raw(ptr);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn max_channel_delta(left: u32, right: u32) -> u32 {
        [0, 8, 16]
            .into_iter()
            .map(|shift| {
                (((left >> shift) & 0xff) as i32 - ((right >> shift) & 0xff) as i32).unsigned_abs()
            })
            .max()
            .expect("RGB always has three channels")
    }

    #[test]
    fn test_ffi_version() {
        // SAFETY: testing FFI version function with valid static pointer.
        unsafe {
            let ptr = bun_rs_version();
            let cstr = std::ffi::CStr::from_ptr(ptr);
            assert_eq!(cstr.to_str().unwrap(), "1.0.0-canary");
        }
    }

    #[test]
    fn test_ffi_add() {
        assert_eq!(bun_rs_add(10, 20), 30);
        assert_eq!(bun_rs_add(i32::MAX, 1), i32::MIN);
    }

    #[test]
    fn test_ffi_count_char() {
        let data = b"hello world, this is a test buffer!";
        // SAFETY: testing FFI count_char function with valid buffer pointer and length.
        unsafe {
            assert_eq!(bun_rs_count_char(data.as_ptr(), data.len(), b'o'), 2);
            assert_eq!(bun_rs_count_char(data.as_ptr(), data.len(), b'z'), 0);
            assert_eq!(bun_rs_count_char(std::ptr::null(), 0, b'a'), 0);
        }
    }

    #[test]
    fn test_ffi_find_bytes() {
        let haystack = b"supercalifragilisticexpialidocious";
        let needle = b"fragil";
        // SAFETY: testing FFI find_bytes function with valid haystack and needle pointers.
        unsafe {
            assert_eq!(
                bun_rs_find_bytes(
                    haystack.as_ptr(),
                    haystack.len(),
                    needle.as_ptr(),
                    needle.len()
                ),
                9
            );
            assert_eq!(
                bun_rs_find_bytes(haystack.as_ptr(), haystack.len(), std::ptr::null(), 0),
                0
            );
            assert_eq!(
                bun_rs_find_bytes(std::ptr::null(), 0, std::ptr::null(), 0),
                0
            );
            let not_found = b"missing";
            assert_eq!(
                bun_rs_find_bytes(
                    haystack.as_ptr(),
                    haystack.len(),
                    not_found.as_ptr(),
                    not_found.len()
                ),
                -1
            );
        }
    }

    #[test]
    fn test_ffi_color_space() {
        let seed = 0xFF6750A4;
        let expected = aphrody_m3_tokens::hct::Hct::from_argb(seed);
        let mut h = 0.0_f32;
        let mut c = 0.0_f32;
        let mut t = 0.0_f32;
        // SAFETY: testing with valid mutable pointers
        unsafe {
            bun_rs_argb_to_hct(seed, &mut h, &mut c, &mut t);
        }
        assert_eq!(
            (h, c, t),
            (
                expected.hue as f32,
                expected.chroma as f32,
                expected.tone as f32
            )
        );

        let reconstructed = bun_rs_hct_to_argb(h, c, t);
        assert!(
            max_channel_delta(reconstructed, seed) <= 2,
            "{seed:#010X} -> {reconstructed:#010X}"
        );
    }

    #[test]
    fn test_ffi_hct_tones() {
        let seed = aphrody_m3_tokens::hct::Hct::from_argb(0xFF6750A4);
        let mut p = [0_u32; 13];
        // SAFETY: testing with valid pointer to 13 u32s
        unsafe {
            bun_rs_hct_tones(
                seed.hue as f32,
                seed.chroma as f32,
                seed.tone as f32,
                p.as_mut_ptr(),
            );
        }
        assert_eq!(p[0], 0xFF000000);
        assert_eq!(p[12], 0xFFFFFFFF);
        assert_eq!(
            p[4],
            bun_rs_hct_to_argb(seed.hue as f32, seed.chroma as f32, 40.0)
        );
    }

    #[test]
    fn test_m3_css_renders_and_reports_errors() {
        let css =
            m3_css(r##"{"sheet":"scheme","seed":"#1a73e8","variant":"vibrant","dark":true}"##)
                .unwrap();
        assert!(css.contains("color-scheme: dark;") && css.contains("--md-sys-color-primary: #"));
        assert!(
            m3_css(r#"{"sheet":"tokens"}"#)
                .unwrap()
                .contains(":root.dark,")
        );
        assert!(
            m3_css(r#"{"sheet":"nope"}"#)
                .unwrap_err()
                .contains("unknown sheet")
        );
        assert!(
            m3_css(r##"{"sheet":"tokens","seed":"#zz"}"##)
                .unwrap_err()
                .contains("invalid seed")
        );
        assert!(
            m3_css(r#"{"sheet":"tokens","contrast":3}"#)
                .unwrap_err()
                .contains("contrast")
        );
        let request = br#"{"sheet":"tailwind"}"#;
        // SAFETY: valid buffer; the returned string is freed below.
        unsafe {
            let ptr = bun_rs_m3_css(request.as_ptr(), request.len());
            let json = std::ffi::CStr::from_ptr(ptr).to_str().unwrap().to_owned();
            bun_rs_free_string(ptr);
            assert!(
                json.starts_with(r#"{"css":"#) || json.contains(r#""ok":true"#),
                "{json}"
            );
        }
    }

    #[test]
    fn test_ffi_derive_scheme_matches_the_scheme() {
        let seed = aphrody_m3_tokens::hct::Hct::from_argb(0xFF67_50A4);
        let scheme = aphrody_m3_tokens::scheme::DynamicScheme::from_argb(
            0xFF67_50A4,
            aphrody_m3_tokens::scheme::Variant::TonalSpot,
            false,
            0.0,
        );
        let mut c = [0_u32; 49];
        // SAFETY: valid pointer to 49 u32s.
        unsafe { bun_rs_derive_scheme(seed.hue as f32, seed.chroma as f32, false, c.as_mut_ptr()) };
        let primary = scheme.argb(aphrody_m3_tokens::scheme::Role::Primary);
        assert!(
            max_channel_delta(c[20], primary) <= 1,
            "{:#010x} vs {primary:#010x}",
            c[20]
        );
    }

    #[test]
    fn test_ffi_derive_scheme() {
        let mut c = [0_u32; 49];
        // SAFETY: testing with valid pointer to 49 u32s
        unsafe {
            bun_rs_derive_scheme(277.0, 40.0, false, c.as_mut_ptr());
            assert_eq!(c[20] >> 24, 0xFF); // valid alpha
            assert_eq!(c[21], 0xFFFFFFFF); // onPrimary light
        }
    }

    #[test]
    fn test_ffi_compile_sass() {
        let scss = b"a { b { color: red; } }";
        let mut err = false;
        // SAFETY: testing compile with valid pointer
        unsafe {
            let css_ptr = bun_rs_compile_sass(
                scss.as_ptr(),
                scss.len(),
                std::ptr::null(),
                0,
                0,
                false,
                &mut err,
            );
            assert!(!err);
            let css_cstr = std::ffi::CStr::from_ptr(css_ptr);
            let css_str = css_cstr.to_str().unwrap();
            assert!(css_str.contains("a b"));
            assert!(css_str.contains("color: red"));
            bun_rs_free_string(css_ptr);
        }
    }

    #[test]
    fn test_ffi_validate_spec() {
        let code = r#"
            // Valid icon and curve
            const style = "transition: transform 300ms cubic-bezier(0.42, 1.67, 0.21, 0.9);";
            const icon = <md-icon>check</md-icon>;
            const button = <md-icon-button aria-label="Validate"></md-icon-button>;

            // Violations
            const bad_color = "color: #ff0077;";
            const bad_role = "--md-sys-color-invalid-primary";
            const bad_icon = <md-icon>non_existent_icon_name</md-icon>;
            const bad_curve = "transition: opacity 150ms cubic-bezier(0.1, 0.2, 0.3, 0.4);";
            const bad_btn = <md-icon-button></md-icon-button>;
        "#;
        let (score, issues) = validator::validate_m3_spec(code);
        assert!(score < 100);
        assert!(issues.len() >= 5);
    }
}
