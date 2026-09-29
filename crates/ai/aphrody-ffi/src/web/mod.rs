//! Web ABI adapters hosted by the single Aphrody native library.
//!
//! These are a compatible subset of the BXC v4 symbol catalog. Do not expose
//! `aphrody_web_bridge_abi_version` until the entire v4 catalog is present.

mod dom;
mod extract;
mod ffi_util;
mod index;
mod text;

pub use dom::*;
pub use extract::*;
pub use index::*;
pub use text::*;

use std::ffi::c_char;

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
}
