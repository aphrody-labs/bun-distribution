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
