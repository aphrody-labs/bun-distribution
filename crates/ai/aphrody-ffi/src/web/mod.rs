//! Web ABI adapters hosted by the single Aphrody native library.
//!
//! The source Web v4 symbol catalog is hosted by this one native library.
//! Historical aliases remain during consumer migration.

mod cookies;
mod dom;
mod embed;
mod extract;
mod ffi_util;
mod index;
mod jobs;
mod native_http;
mod net;
mod net_aliases;
mod text;

pub use cookies::*;
pub use dom::*;
pub use embed::*;
pub use extract::*;
pub use index::*;
pub use jobs::*;
pub use native_http::*;
pub use net::*;
pub use net_aliases::*;
pub use text::*;

use std::ffi::c_char;

pub const APHRODY_WEB_BRIDGE_ABI_VERSION: u32 = 4;

#[unsafe(no_mangle)]
pub extern "C" fn aphrody_web_bridge_abi_version() -> u32 {
    APHRODY_WEB_BRIDGE_ABI_VERSION
}

#[unsafe(no_mangle)]
pub extern "C" fn bxc_bridge_abi_version() -> u32 {
    APHRODY_WEB_BRIDGE_ABI_VERSION
}

/// Free an owned string returned by a Web ABI function in this library.
///
/// # Safety
/// `ptr` must be null or a live string pointer returned by this library.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn bxc_free_string(ptr: *mut c_char) {
    // SAFETY: both symbol names use the same CString allocator in this cdylib.
    unsafe { crate::aphrody_string_free(ptr) };
}

/// Canonical alias for [`bxc_free_string`].
///
/// # Safety
/// `ptr` must be null or a live string pointer returned by this library.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn aphrody_web_free_string(ptr: *mut c_char) {
    // SAFETY: alias of the same deallocator.
    unsafe { bxc_free_string(ptr) };
}

/// Canonical title extractor over the shared Web text adapter.
///
/// # Safety
/// `html` must be null or a readable, NUL-terminated C string.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn aphrody_web_extract_title(html: *const c_char) -> *mut c_char {
    unsafe { text::bxc_extract_title(html) }
}

/// Canonical tag stripping adapter.
///
/// # Safety
/// `html` must be null or a readable, NUL-terminated C string.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn aphrody_web_strip_tags(html: *const c_char) -> *mut c_char {
    unsafe { text::bxc_strip_tags(html) }
}

/// Canonical DOM parser. Destroy its result with `aphrody_web_tree_destroy`.
///
/// # Safety
/// `html` must be null or a readable, NUL-terminated C string.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn aphrody_web_parse_html(html: *const c_char) -> *mut obscura_dom::DomTree {
    unsafe { dom::bxc_parse_html(html) }
}

/// Destroy a DOM tree allocated by this library.
///
/// # Safety
/// `tree` must be null or a live pointer returned by this library's DOM parser.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn aphrody_web_tree_destroy(tree: *mut obscura_dom::DomTree) {
    unsafe { dom::bxc_tree_destroy(tree) };
}

/// Query one matching element from an owned DOM tree.
///
/// # Safety
/// `tree` must be live and `selector` a readable, NUL-terminated C string.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn aphrody_web_query_selector(
    tree: *mut obscura_dom::DomTree,
    selector: *const c_char,
) -> *mut c_char {
    unsafe { dom::bxc_query_selector(tree, selector) }
}

/// Query every matching element from an owned DOM tree.
///
/// # Safety
/// `tree` must be live and `selector` a readable, NUL-terminated C string.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn aphrody_web_query_selector_all(
    tree: *mut obscura_dom::DomTree,
    selector: *const c_char,
) -> *mut c_char {
    unsafe { dom::bxc_query_selector_all(tree, selector) }
}

#[unsafe(no_mangle)]
pub extern "C" fn aphrody_web_job_completed_seq() -> u64 {
    jobs::bxc_job_completed_seq()
}

#[unsafe(no_mangle)]
pub extern "C" fn aphrody_web_job_pending_count() -> u32 {
    jobs::bxc_job_pending_count()
}

#[unsafe(no_mangle)]
pub extern "C" fn aphrody_web_job_status(id: u64) -> i32 {
    jobs::bxc_job_status(id)
}

#[unsafe(no_mangle)]
pub extern "C" fn aphrody_web_job_take(id: u64) -> *mut c_char {
    jobs::bxc_job_take(id)
}

#[unsafe(no_mangle)]
pub extern "C" fn aphrody_web_job_cancel(id: u64) -> i32 {
    jobs::bxc_job_cancel(id)
}

/// Submit an embedding job on the shared FFI runtime.
///
/// # Safety
/// Input pointers must be null or readable, NUL-terminated C strings.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn aphrody_web_embed_submit(
    texts_json: *const c_char,
    kind: *const c_char,
    timeout_ms: u32,
) -> u64 {
    unsafe { embed::bxc_embed_submit(texts_json, kind, timeout_ms) }
}

/// Submit a reranking job on the shared FFI runtime.
///
/// # Safety
/// Input pointers must be null or readable, NUL-terminated C strings.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn aphrody_web_rerank_submit(
    query: *const c_char,
    passages_json: *const c_char,
    timeout_ms: u32,
) -> u64 {
    unsafe { embed::bxc_rerank_submit(query, passages_json, timeout_ms) }
}

#[unsafe(no_mangle)]
pub extern "C" fn aphrody_web_embed_info() -> *mut c_char {
    embed::bxc_embed_info()
}

/// Submit a model installation job on the shared FFI runtime.
///
/// # Safety
/// `model_id` must be null or a readable, NUL-terminated C string.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn aphrody_web_embed_install_submit(
    model_id: *const c_char,
    timeout_ms: u32,
) -> u64 {
    unsafe { embed::bxc_embed_install_submit(model_id, timeout_ms) }
}

/// Read Chromium cookies using the shared Rust profile parser.
///
/// # Safety
/// Input pointers must be null or readable, NUL-terminated C strings.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn aphrody_web_get_chromium_cookies(
    user_data_path: *const c_char,
    profile: *const c_char,
    host_key: *const c_char,
) -> *mut c_char {
    unsafe { cookies::bxc_get_chromium_cookies(user_data_path, profile, host_key) }
}

/// Fetch a URL with the shared native Obscura HTTP transport.
///
/// # Safety
/// `url` must be null or a readable, NUL-terminated C string.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn aphrody_web_obscura_fetch(
    url: *const c_char,
    stealth: u8,
    timeout_ms: u32,
) -> *mut c_char {
    unsafe { native_http::bxc_obscura_fetch(url, stealth, timeout_ms) }
}

#[cfg(test)]
mod tests {
    use std::ffi::{CStr, CString};

    use super::*;

    #[test]
    fn canonical_dom_and_text_symbols_share_one_allocator() {
        let html =
            CString::new("<title>Page</title><main><p class='item'>Hello</p></main>").unwrap();
        let selector = CString::new("p.item").unwrap();
        // SAFETY: the input C strings stay live; every returned pointer is
        // released by its matching destructor from this same library.
        unsafe {
            let title = aphrody_web_extract_title(html.as_ptr());
            assert_eq!(CStr::from_ptr(title).to_str().unwrap(), "Page");
            crate::aphrody_string_free(title);

            let tree = aphrody_web_parse_html(html.as_ptr());
            assert!(!tree.is_null());
            let found = aphrody_web_query_selector(tree, selector.as_ptr());
            assert!(CStr::from_ptr(found).to_str().unwrap().contains("Hello"));
            aphrody_web_free_string(found);
            aphrody_web_tree_destroy(tree);
        }
    }

    #[test]
    fn web_jobs_reuse_the_ffi_runtime() {
        let web = super::ffi_util::shared_runtime().unwrap();
        assert!(std::ptr::eq(web, crate::native::runtime()));
    }

    #[test]
    fn cookie_adapter_rejects_missing_arguments_without_profile_access() {
        // SAFETY: all inputs are null, a supported case returning an empty
        // JSON array without opening any profile database.
        unsafe {
            let result = aphrody_web_get_chromium_cookies(
                std::ptr::null(),
                std::ptr::null(),
                std::ptr::null(),
            );
            assert_eq!(CStr::from_ptr(result).to_str().unwrap(), "[]");
            aphrody_web_free_string(result);
        }
    }

    #[test]
    fn web_v4_version_and_network_jobs_share_one_library() {
        assert_eq!(aphrody_web_bridge_abi_version(), 4);
        assert_eq!(bxc_bridge_abi_version(), aphrody_web_bridge_abi_version());

        // SAFETY: null pointers are rejected before network or credential access.
        let ids = unsafe {
            [
                aphrody_web_dns_recon_submit(std::ptr::null(), 1000),
                aphrody_web_gemini_web_ask_submit(
                    std::ptr::null(),
                    std::ptr::null(),
                    std::ptr::null(),
                    1000,
                ),
                aphrody_web_x_user_by_screen_name_submit(
                    std::ptr::null(),
                    std::ptr::null(),
                    std::ptr::null(),
                    1000,
                ),
            ]
        };
        for id in ids {
            assert!(id > 0);
            assert_eq!(aphrody_web_job_status(id), 1);
            let result = aphrody_web_job_take(id);
            assert!(!result.is_null());
            assert!(unsafe { CStr::from_ptr(result) }.to_string_lossy().contains("error"));
            unsafe { aphrody_web_free_string(result) };
        }
    }
}
