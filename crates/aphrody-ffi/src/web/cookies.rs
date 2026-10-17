// SPDX-License-Identifier: Apache-2.0
//! Chromium cookie store access (local file I/O, synchronous by design).

use std::{ffi::CStr, os::raw::c_char};

use super::ffi_util::{guard, into_c_string};

/// Read Chromium cookies and return them as JSON.
///
/// # Safety
///
/// Every non-null pointer argument must point to a readable, NUL-terminated C
/// string for the duration of this call. The returned string must be released
/// exactly once with `web_internal_free_string`.
pub unsafe extern "C" fn web_internal_get_chromium_cookies(
    user_data_path_ptr: *const c_char,
    profile_ptr: *const c_char,
    host_key_ptr: *const c_char,
) -> *mut c_char {
    guard(std::ptr::null_mut(), || {
        if user_data_path_ptr.is_null() || profile_ptr.is_null() || host_key_ptr.is_null() {
            return into_c_string("[]".to_string());
        }

        let user_data_path = unsafe { CStr::from_ptr(user_data_path_ptr) };
        let profile = unsafe { CStr::from_ptr(profile_ptr) };
        let host_key = unsafe { CStr::from_ptr(host_key_ptr) };

        let user_data_path_str = match user_data_path.to_str() {
            Ok(s) => s,
            Err(_) => return into_c_string("[]".to_string()),
        };
        let profile_str = match profile.to_str() {
            Ok(s) => s,
            Err(_) => return into_c_string("[]".to_string()),
        };
        let host_key_str = match host_key.to_str() {
            Ok(s) => s,
            Err(_) => return into_c_string("[]".to_string()),
        };

        let parser =
            crate::web::chromium::ChromiumParser::new(std::path::PathBuf::from(user_data_path_str));
        match parser.get_cookies_full(profile_str, host_key_str) {
            Ok(cookies) => {
                let json = serde_json::to_string(&cookies).unwrap_or_else(|_| "[]".to_string());
                into_c_string(json)
            }
            Err(e) => {
                let err_json = serde_json::json!({
                    "error": format!("Failed to extract cookies: {}", e)
                });
                into_c_string(err_json.to_string())
            }
        }
    })
}
