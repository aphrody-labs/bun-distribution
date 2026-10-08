// SPDX-License-Identifier: Apache-2.0
//! C-ABI exports for Bun Native FFI integration (`bun:ffi` and `aphrody-ffi`).

use std::ffi::{CStr, CString, c_char};

use crate::jsc::eval_structured;
use crate::shell::run_shell;
use crate::simd::{validate_ascii, validate_utf8};

/// Evaluate a Bun Shell script or pipeline in-process.
///
/// # Safety
/// `script` must be a valid, readable, NUL-terminated C string.
/// The returned pointer must be freed with [`bun_bridge_free_string`].
#[unsafe(no_mangle)]
pub unsafe extern "C" fn bun_shell_eval(script: *const c_char, json_out: bool) -> *mut c_char {
    if script.is_null() {
        return std::ptr::null_mut();
    }
    // SAFETY: caller guarantees `script` is a valid NUL-terminated C string.
    let s = unsafe { CStr::from_ptr(script) }.to_string_lossy();
    let res = match run_shell(&s, None) {
        Ok(out) => {
            if json_out {
                serde_json::to_string(&out).unwrap_or_else(|_| "{}".to_string())
            } else {
                out.stdout
            }
        }
        Err(e) => {
            if json_out {
                format!(r#"{{"exit_code":1,"stdout":"","stderr":{:?},"in_process":true,"duration_ms":0.0}}"#, e)
            } else {
                e
            }
        }
    };

    CString::new(res).map(CString::into_raw).unwrap_or(std::ptr::null_mut())
}

/// Evaluate structured JSON querying or transformation using the native JSC engine.
///
/// # Safety
/// `expr` and `input_json` must be valid NUL-terminated C strings.
/// The returned pointer must be freed with [`bun_bridge_free_string`].
#[unsafe(no_mangle)]
pub unsafe extern "C" fn bun_jsc_eval(expr: *const c_char, input_json: *const c_char) -> *mut c_char {
    if expr.is_null() {
        return std::ptr::null_mut();
    }
    // SAFETY: caller guarantees strings are valid NUL-terminated C strings.
    let expr_str = unsafe { CStr::from_ptr(expr) }.to_string_lossy();
    let json_val = if !input_json.is_null() {
        let raw = unsafe { CStr::from_ptr(input_json) }.to_string_lossy();
        serde_json::from_str::<serde_json::Value>(&raw).unwrap_or(serde_json::Value::Null)
    } else {
        serde_json::Value::Null
    };

    let result = match eval_structured(&expr_str, &json_val) {
        Ok(v) => serde_json::to_string(&v).unwrap_or_else(|_| "null".to_string()),
        Err(e) => format!(r#"{{"error":{:?}}}"#, e),
    };

    CString::new(result).map(CString::into_raw).unwrap_or(std::ptr::null_mut())
}

/// Validate UTF-8 byte buffer using SIMD instructions.
///
/// # Safety
/// `data` must point to at least `len` valid readable bytes.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn bun_simd_validate_utf8(data: *const u8, len: usize) -> bool {
    if data.is_null() || len == 0 {
        return true;
    }
    // SAFETY: caller guarantees validity of the memory range.
    let slice = unsafe { std::slice::from_raw_parts(data, len) };
    validate_utf8(slice)
}

/// Validate ASCII byte buffer using SIMD instructions.
///
/// # Safety
/// `data` must point to at least `len` valid readable bytes.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn bun_simd_validate_ascii(data: *const u8, len: usize) -> bool {
    if data.is_null() || len == 0 {
        return true;
    }
    // SAFETY: caller guarantees validity of the memory range.
    let slice = unsafe { std::slice::from_raw_parts(data, len) };
    validate_ascii(slice)
}

/// Free a string returned by any `bun_bridge_*` FFI function.
///
/// # Safety
/// `ptr` must be a pointer obtained from [`bun_shell_eval`] or [`bun_jsc_eval`],
/// or null (which is a no-op).
#[unsafe(no_mangle)]
pub unsafe extern "C" fn bun_bridge_free_string(ptr: *mut c_char) {
    if !ptr.is_null() {
        // SAFETY: `ptr` was allocated by `CString::into_raw`.
        unsafe {
            drop(CString::from_raw(ptr));
        }
    }
}

/// Calculate 64-bit WyHash using Bun's native algorithm.
///
/// # Safety
/// `data` must point to at least `len` valid readable bytes.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn bun_hash_wyhash(data: *const u8, len: usize, seed: u64) -> u64 {
    if data.is_null() || len == 0 {
        return crate::hash::wyhash(&[], seed);
    }
    let slice = unsafe { std::slice::from_raw_parts(data, len) };
    crate::hash::wyhash(slice, seed)
}

/// Parse a .env content string into a JSON string map.
///
/// # Safety
/// `content` must be a valid NUL-terminated C string.
/// The returned pointer must be freed with [`bun_bridge_free_string`].
#[unsafe(no_mangle)]
pub unsafe extern "C" fn bun_dotenv_parse(content: *const c_char) -> *mut c_char {
    if content.is_null() {
        return std::ptr::null_mut();
    }
    let raw = unsafe { CStr::from_ptr(content) }.to_string_lossy();
    let map = crate::dotenv::parse_dotenv(&raw);
    let json = serde_json::to_string(&map).unwrap_or_else(|_| "{}".to_string());
    CString::new(json).map(CString::into_raw).unwrap_or(std::ptr::null_mut())
}

/// Check if a semantic version string satisfies a requirement string.
///
/// # Safety
/// `version` and `req` must be valid NUL-terminated C strings.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn bun_semver_satisfies(version: *const c_char, req: *const c_char) -> bool {
    if version.is_null() || req.is_null() {
        return false;
    }
    let ver_str = unsafe { CStr::from_ptr(version) }.to_string_lossy();
    let req_str = unsafe { CStr::from_ptr(req) }.to_string_lossy();

    if let (Some(v), Some(r)) = (
        crate::semver::Version::parse(&ver_str),
        crate::semver::VersionReq::parse(&req_str),
    ) {
        r.matches(&v)
    } else {
        false
    }
}

/// Match a path against a glob pattern.
///
/// # Safety
/// `pattern` and `path` must be valid NUL-terminated C strings.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn bun_glob_match(pattern: *const c_char, path: *const c_char) -> bool {
    if pattern.is_null() || path.is_null() {
        return false;
    }
    let pat_str = unsafe { CStr::from_ptr(pattern) }.to_string_lossy();
    let path_str = unsafe { CStr::from_ptr(path) }.to_string_lossy();

    if let Ok(matcher) = crate::glob::GlobMatcher::compile(&pat_str) {
        matcher.is_match(&path_str)
    } else {
        false
    }
}

/// Base64 encode byte buffer.
///
/// # Safety
/// `data` must point to at least `len` valid readable bytes.
/// The returned pointer must be freed with [`bun_bridge_free_string`].
#[unsafe(no_mangle)]
pub unsafe extern "C" fn bun_base64_encode(data: *const u8, len: usize, url_safe: bool) -> *mut c_char {
    if data.is_null() || len == 0 {
        return CString::new("").unwrap().into_raw();
    }
    let slice = unsafe { std::slice::from_raw_parts(data, len) };
    let res = if url_safe {
        crate::base64::encode_url_safe(slice)
    } else {
        crate::base64::encode(slice)
    };
    CString::new(res).map(CString::into_raw).unwrap_or(std::ptr::null_mut())
}
