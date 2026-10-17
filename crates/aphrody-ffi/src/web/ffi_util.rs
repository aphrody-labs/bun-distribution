// SPDX-License-Identifier: Apache-2.0
//! Shared Web ABI pointer, panic and JSON helpers.

use std::{
    ffi::{CStr, CString, c_char},
    fmt::Display,
};

pub(super) fn guard<T>(fallback: T, body: impl FnOnce() -> T) -> T {
    std::panic::catch_unwind(std::panic::AssertUnwindSafe(body)).unwrap_or(fallback)
}

/// # Safety
/// `ptr` must be null or a readable, NUL-terminated C string.
pub(super) unsafe fn borrow_str<'a>(ptr: *const c_char) -> Option<&'a str> {
    if ptr.is_null() {
        None
    } else {
        // SAFETY: required by the caller's pointer contract.
        unsafe { CStr::from_ptr(ptr) }.to_str().ok()
    }
}

pub(super) fn into_c_string(value: String) -> *mut c_char {
    let owned = match CString::new(value) {
        Ok(value) => value,
        Err(err) => {
            let mut bytes = err.into_vec();
            bytes.retain(|byte| *byte != 0);
            CString::new(bytes).unwrap_or_default()
        }
    };
    owned.into_raw()
}

pub(super) fn error_json_string(message: impl Display) -> String {
    serde_json::json!({ "error": message.to_string() }).to_string()
}

pub(super) fn error_json(message: impl Display) -> *mut c_char {
    into_c_string(error_json_string(message))
}

pub(super) fn to_json_string<T: serde::Serialize>(value: &T) -> String {
    serde_json::to_string(value)
        .unwrap_or_else(|err| error_json_string(format!("serialization failed: {err}")))
}

/// Reuse the one process-wide runtime already owned by `aphrody-ffi`.
pub(super) fn shared_runtime() -> Result<&'static tokio::runtime::Runtime, String> {
    Ok(crate::native::runtime())
}
