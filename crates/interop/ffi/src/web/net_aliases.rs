// SPDX-License-Identifier: Apache-2.0
//! Canonical Aphrody Web names for the source network ABI.
//! The old exports remain only until all consumers use these names.

use std::ffi::c_char;

/// Canonical alias for `web_internal_dns_recon`.
///
/// # Safety
/// Every non-null pointer must reference a readable, NUL-terminated C string
/// for the duration of this call. Returned strings belong to `aphrody-ffi`
/// and must be released with `aphrody_string_free`.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn aphrody_web_dns_recon(domain_ptr: *const c_char) -> *mut c_char {
    unsafe { super::net::web_internal_dns_recon(domain_ptr) }
}

/// Canonical alias for `web_internal_dns_recon_submit`.
///
/// # Safety
/// Every non-null pointer must reference a readable, NUL-terminated C string
/// for the duration of this call. Returned strings belong to `aphrody-ffi`
/// and must be released with `aphrody_string_free`.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn aphrody_web_dns_recon_submit(
    domain_ptr: *const c_char,
    timeout_ms: u32,
) -> u64 {
    unsafe { super::net::web_internal_dns_recon_submit(domain_ptr, timeout_ms) }
}

/// Canonical alias for `web_internal_gemini_web_ask`.
///
/// # Safety
/// Every non-null pointer must reference a readable, NUL-terminated C string
/// for the duration of this call. Returned strings belong to `aphrody-ffi`
/// and must be released with `aphrody_string_free`.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn aphrody_web_gemini_web_ask(
    cookie_path_ptr: *const c_char,
    prompt_ptr: *const c_char,
    model_ptr: *const c_char,
) -> *mut c_char {
    unsafe { super::net::web_internal_gemini_web_ask(cookie_path_ptr, prompt_ptr, model_ptr) }
}

/// Canonical alias for `web_internal_gemini_web_ask_submit`.
///
/// # Safety
/// Every non-null pointer must reference a readable, NUL-terminated C string
/// for the duration of this call. Returned strings belong to `aphrody-ffi`
/// and must be released with `aphrody_string_free`.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn aphrody_web_gemini_web_ask_submit(
    cookie_path_ptr: *const c_char,
    prompt_ptr: *const c_char,
    model_ptr: *const c_char,
    timeout_ms: u32,
) -> u64 {
    unsafe {
        super::net::web_internal_gemini_web_ask_submit(
            cookie_path_ptr,
            prompt_ptr,
            model_ptr,
            timeout_ms,
        )
    }
}

/// Canonical alias for `web_internal_x_user_by_screen_name`.
///
/// # Safety
/// Every non-null pointer must reference a readable, NUL-terminated C string
/// for the duration of this call. Returned strings belong to `aphrody-ffi`
/// and must be released with `aphrody_string_free`.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn aphrody_web_x_user_by_screen_name(
    auth_token_ptr: *const c_char,
    ct0_ptr: *const c_char,
    handle_ptr: *const c_char,
) -> *mut c_char {
    unsafe { super::net::web_internal_x_user_by_screen_name(auth_token_ptr, ct0_ptr, handle_ptr) }
}

/// Canonical alias for `web_internal_x_user_by_screen_name_submit`.
///
/// # Safety
/// Every non-null pointer must reference a readable, NUL-terminated C string
/// for the duration of this call. Returned strings belong to `aphrody-ffi`
/// and must be released with `aphrody_string_free`.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn aphrody_web_x_user_by_screen_name_submit(
    auth_token_ptr: *const c_char,
    ct0_ptr: *const c_char,
    handle_ptr: *const c_char,
    timeout_ms: u32,
) -> u64 {
    unsafe {
        super::net::web_internal_x_user_by_screen_name_submit(
            auth_token_ptr,
            ct0_ptr,
            handle_ptr,
            timeout_ms,
        )
    }
}

/// Canonical alias for `web_internal_x_user_tweets`.
///
/// # Safety
/// Every non-null pointer must reference a readable, NUL-terminated C string
/// for the duration of this call. Returned strings belong to `aphrody-ffi`
/// and must be released with `aphrody_string_free`.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn aphrody_web_x_user_tweets(
    auth_token_ptr: *const c_char,
    ct0_ptr: *const c_char,
    handle_ptr: *const c_char,
    count: u32,
) -> *mut c_char {
    unsafe { super::net::web_internal_x_user_tweets(auth_token_ptr, ct0_ptr, handle_ptr, count) }
}

/// Canonical alias for `web_internal_x_user_tweets_submit`.
///
/// # Safety
/// Every non-null pointer must reference a readable, NUL-terminated C string
/// for the duration of this call. Returned strings belong to `aphrody-ffi`
/// and must be released with `aphrody_string_free`.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn aphrody_web_x_user_tweets_submit(
    auth_token_ptr: *const c_char,
    ct0_ptr: *const c_char,
    handle_ptr: *const c_char,
    count: u32,
    timeout_ms: u32,
) -> u64 {
    unsafe {
        super::net::web_internal_x_user_tweets_submit(
            auth_token_ptr,
            ct0_ptr,
            handle_ptr,
            count,
            timeout_ms,
        )
    }
}

/// Canonical alias for `web_internal_x_community_by_rest_id`.
///
/// # Safety
/// Every non-null pointer must reference a readable, NUL-terminated C string
/// for the duration of this call. Returned strings belong to `aphrody-ffi`
/// and must be released with `aphrody_string_free`.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn aphrody_web_x_community_by_rest_id(
    auth_token_ptr: *const c_char,
    ct0_ptr: *const c_char,
    community_id_ptr: *const c_char,
) -> *mut c_char {
    unsafe {
        super::net::web_internal_x_community_by_rest_id(auth_token_ptr, ct0_ptr, community_id_ptr)
    }
}

/// Canonical alias for `web_internal_x_community_by_rest_id_submit`.
///
/// # Safety
/// Every non-null pointer must reference a readable, NUL-terminated C string
/// for the duration of this call. Returned strings belong to `aphrody-ffi`
/// and must be released with `aphrody_string_free`.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn aphrody_web_x_community_by_rest_id_submit(
    auth_token_ptr: *const c_char,
    ct0_ptr: *const c_char,
    community_id_ptr: *const c_char,
    timeout_ms: u32,
) -> u64 {
    unsafe {
        super::net::web_internal_x_community_by_rest_id_submit(
            auth_token_ptr,
            ct0_ptr,
            community_id_ptr,
            timeout_ms,
        )
    }
}

/// Canonical alias for `web_internal_x_community_tweets`.
///
/// # Safety
/// Every non-null pointer must reference a readable, NUL-terminated C string
/// for the duration of this call. Returned strings belong to `aphrody-ffi`
/// and must be released with `aphrody_string_free`.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn aphrody_web_x_community_tweets(
    auth_token_ptr: *const c_char,
    ct0_ptr: *const c_char,
    community_id_ptr: *const c_char,
    count: u32,
) -> *mut c_char {
    unsafe {
        super::net::web_internal_x_community_tweets(
            auth_token_ptr,
            ct0_ptr,
            community_id_ptr,
            count,
        )
    }
}

/// Canonical alias for `web_internal_x_community_tweets_submit`.
///
/// # Safety
/// Every non-null pointer must reference a readable, NUL-terminated C string
/// for the duration of this call. Returned strings belong to `aphrody-ffi`
/// and must be released with `aphrody_string_free`.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn aphrody_web_x_community_tweets_submit(
    auth_token_ptr: *const c_char,
    ct0_ptr: *const c_char,
    community_id_ptr: *const c_char,
    count: u32,
    timeout_ms: u32,
) -> u64 {
    unsafe {
        super::net::web_internal_x_community_tweets_submit(
            auth_token_ptr,
            ct0_ptr,
            community_id_ptr,
            count,
            timeout_ms,
        )
    }
}

/// Canonical alias for `web_internal_x_community_info_and_tweets`.
///
/// # Safety
/// Every non-null pointer must reference a readable, NUL-terminated C string
/// for the duration of this call. Returned strings belong to `aphrody-ffi`
/// and must be released with `aphrody_string_free`.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn aphrody_web_x_community_info_and_tweets(
    auth_token_ptr: *const c_char,
    ct0_ptr: *const c_char,
    community_id_ptr: *const c_char,
    count: u32,
) -> *mut c_char {
    unsafe {
        super::net::web_internal_x_community_info_and_tweets(
            auth_token_ptr,
            ct0_ptr,
            community_id_ptr,
            count,
        )
    }
}

/// Canonical alias for `web_internal_x_community_info_and_tweets_submit`.
///
/// # Safety
/// Every non-null pointer must reference a readable, NUL-terminated C string
/// for the duration of this call. Returned strings belong to `aphrody-ffi`
/// and must be released with `aphrody_string_free`.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn aphrody_web_x_community_info_and_tweets_submit(
    auth_token_ptr: *const c_char,
    ct0_ptr: *const c_char,
    community_id_ptr: *const c_char,
    count: u32,
    timeout_ms: u32,
) -> u64 {
    unsafe {
        super::net::web_internal_x_community_info_and_tweets_submit(
            auth_token_ptr,
            ct0_ptr,
            community_id_ptr,
            count,
            timeout_ms,
        )
    }
}

/// Canonical alias for `web_internal_x_algorithm_rank`.
///
/// # Safety
/// Every non-null pointer must reference a readable, NUL-terminated C string
/// for the duration of this call. Returned strings belong to `aphrody-ffi`
/// and must be released with `aphrody_string_free`.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn aphrody_web_x_algorithm_rank(
    candidates_json_ptr: *const c_char,
    context_json_ptr: *const c_char,
    top_k: u32,
) -> *mut c_char {
    unsafe {
        super::net::web_internal_x_algorithm_rank(candidates_json_ptr, context_json_ptr, top_k)
    }
}
