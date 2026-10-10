// SPDX-License-Identifier: Apache-2.0
//! Approximate nearest-neighbour vector index (`aphrody-web-index`: HNSW with int8
//! quantisation, mmap persistence) exposed over the C ABI.
//!
//! Indexes are addressed by opaque `u64` handles kept in a registry rather
//! than raw pointers: a stale or double-closed handle is an error code, never
//! a use-after-free. Vectors cross the boundary as `f32` arrays passed by
//! pointer + length (a `Float32Array` on the Bun side).

use std::{
    collections::HashMap,
    os::raw::c_char,
    sync::{
        Arc, Mutex, MutexGuard, OnceLock,
        atomic::{AtomicU64, Ordering},
    },
};

use aphrody_web_index::ffi_api::{self, Handle};

use super::ffi_util::{borrow_str, error_json, guard, into_c_string};

type Registry = Mutex<HashMap<u64, Arc<Handle>>>;

fn registry() -> &'static Registry {
    static REGISTRY: OnceLock<Registry> = OnceLock::new();
    REGISTRY.get_or_init(|| Mutex::new(HashMap::new()))
}

fn lock() -> MutexGuard<'static, HashMap<u64, Arc<Handle>>> {
    registry().lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn next_id() -> u64 {
    static NEXT: AtomicU64 = AtomicU64::new(1);
    NEXT.fetch_add(1, Ordering::SeqCst)
}

fn handle(id: u64) -> Option<Arc<Handle>> {
    lock().get(&id).cloned()
}

thread_local! {
    #[allow(clippy::missing_const_for_thread_local)]
    static LAST_ERROR: std::cell::RefCell<String> = const { std::cell::RefCell::new(String::new()) };
}

fn set_error(message: impl std::fmt::Display) {
    LAST_ERROR.with(|cell| *cell.borrow_mut() = message.to_string());
}

/// Error codes returned by the integer-returning index symbols.
pub const INDEX_OK: i32 = 0;
pub const INDEX_ERROR: i32 = -1;
pub const INDEX_UNKNOWN_HANDLE: i32 = -2;

unsafe fn f32_slice<'a>(ptr: *const f32, len: usize) -> Option<&'a [f32]> {
    if ptr.is_null() {
        return None;
    }
    Some(unsafe { std::slice::from_raw_parts(ptr, len) })
}

/// Message of the last failed index call on this thread (JSON `{"error"}` or
/// `{"error": null}`).
pub extern "C" fn web_internal_index_last_error() -> *mut c_char {
    guard(std::ptr::null_mut(), || {
        LAST_ERROR.with(|cell| {
            let message = cell.borrow();
            if message.is_empty() {
                into_c_string("{\"error\":null}".to_string())
            } else {
                error_json(message.as_str())
            }
        })
    })
}

/// Open the index file at `path` (created on first save), with `dim` (0 =
/// accept the stored dimension) and optional JSON params. Corrupt files are
/// replaced by a fresh index when `rebuild_if_corrupt` is non-zero; the call
/// then reports `corrupt` through `web_internal_index_last_error` while succeeding.
/// Returns a handle (> 0) or 0 on error.
///
/// # Safety
///
/// `path_ptr` must point to a readable NUL-terminated C string;
/// `params_json_ptr` may be null.
pub unsafe extern "C" fn web_internal_index_open(
    path_ptr: *const c_char,
    dim: u32,
    params_json_ptr: *const c_char,
    rebuild_if_corrupt: i32,
) -> u64 {
    guard(0, || {
        set_error("");
        let Some(path) = (unsafe { borrow_str(path_ptr) }) else {
            set_error("invalid path");
            return 0;
        };
        let params = unsafe { borrow_str(params_json_ptr) }.unwrap_or("");
        let opened = match ffi_api::open_or_create(path, dim as usize, params) {
            Ok(h) => h,
            Err(err) if rebuild_if_corrupt != 0 && err.is_corrupt_file() => {
                set_error(format!("corrupt: {err}"));
                match ffi_api::create(path, dim as usize, params) {
                    Ok(h) => h,
                    Err(e) => {
                        set_error(e);
                        return 0;
                    },
                }
            },
            Err(err) => {
                set_error(err);
                return 0;
            },
        };
        let id = next_id();
        lock().insert(id, Arc::new(opened));
        id
    })
}

/// Number of live vectors, or -1 for an unknown handle.
pub extern "C" fn web_internal_index_len(handle_id: u64) -> i64 {
    guard(-1, || handle(handle_id).map(|h| ffi_api::len(&h) as i64).unwrap_or(-1))
}

/// Vector dimension, or 0 for an unknown handle.
pub extern "C" fn web_internal_index_dim(handle_id: u64) -> u32 {
    guard(0, || handle(handle_id).map(|h| ffi_api::dim(&h) as u32).unwrap_or(0))
}

/// Insert or replace one vector.
///
/// # Safety
///
/// `vector_ptr` must point to `dim` readable `f32` values.
pub unsafe extern "C" fn web_internal_index_add(
    handle_id: u64,
    key: u64,
    vector_ptr: *const f32,
    dim: u32,
) -> i32 {
    guard(INDEX_ERROR, || {
        let Some(h) = handle(handle_id) else { return INDEX_UNKNOWN_HANDLE };
        let Some(vector) = (unsafe { f32_slice(vector_ptr, dim as usize) }) else {
            set_error("null vector");
            return INDEX_ERROR;
        };
        match ffi_api::add(&h, key, vector) {
            Ok(()) => INDEX_OK,
            Err(e) => {
                set_error(e);
                INDEX_ERROR
            },
        }
    })
}

/// Insert or replace `count` vectors (`flat` holds `count * dim` values).
///
/// # Safety
///
/// `keys_ptr` must point to `count` readable `u64` values and `flat_ptr` to
/// `count * dim` readable `f32` values.
pub unsafe extern "C" fn web_internal_index_add_batch(
    handle_id: u64,
    keys_ptr: *const u64,
    flat_ptr: *const f32,
    count: u32,
    dim: u32,
) -> i32 {
    guard(INDEX_ERROR, || {
        let Some(h) = handle(handle_id) else { return INDEX_UNKNOWN_HANDLE };
        if keys_ptr.is_null() || flat_ptr.is_null() {
            set_error("null batch pointer");
            return INDEX_ERROR;
        }
        let keys = unsafe { std::slice::from_raw_parts(keys_ptr, count as usize) };
        let Some(flat) = (unsafe { f32_slice(flat_ptr, count as usize * dim as usize) }) else {
            return INDEX_ERROR;
        };
        match ffi_api::add_batch_flat(&h, keys, flat) {
            Ok(()) => INDEX_OK,
            Err(e) => {
                set_error(e);
                INDEX_ERROR
            },
        }
    })
}

/// k-NN search; returns JSON `[{"key","score"}]` (cosine similarity), or an
/// `{"error"}` payload.
///
/// # Safety
///
/// `query_ptr` must point to `dim` readable `f32` values. The returned string
/// must be released with `web_internal_free_string`.
pub unsafe extern "C" fn web_internal_index_search(
    handle_id: u64,
    query_ptr: *const f32,
    dim: u32,
    k: u32,
    ef: u32,
) -> *mut c_char {
    guard(std::ptr::null_mut(), || {
        let Some(h) = handle(handle_id) else { return error_json("unknown index handle") };
        let Some(query) = (unsafe { f32_slice(query_ptr, dim as usize) }) else {
            return error_json("null query");
        };
        match ffi_api::search_json(&h, query, k as usize, ef as usize) {
            Ok(json) => into_c_string(json),
            Err(e) => error_json(e),
        }
    })
}

/// Tombstone `key`. Returns 1 when removed, 0 when absent, -2 for an unknown handle.
pub extern "C" fn web_internal_index_remove(handle_id: u64, key: u64) -> i32 {
    guard(INDEX_ERROR, || match handle(handle_id) {
        Some(h) => i32::from(ffi_api::remove(&h, key)),
        None => INDEX_UNKNOWN_HANDLE,
    })
}

/// Persist the index to its path (atomic replace).
pub extern "C" fn web_internal_index_save(handle_id: u64) -> i32 {
    guard(INDEX_ERROR, || {
        let Some(h) = handle(handle_id) else { return INDEX_UNKNOWN_HANDLE };
        match ffi_api::save(&h) {
            Ok(()) => INDEX_OK,
            Err(e) => {
                set_error(e);
                INDEX_ERROR
            },
        }
    })
}

/// Rebuild without tombstones.
pub extern "C" fn web_internal_index_compact(handle_id: u64) -> i32 {
    guard(INDEX_ERROR, || {
        let Some(h) = handle(handle_id) else { return INDEX_UNKNOWN_HANDLE };
        match ffi_api::compact(&h) {
            Ok(()) => INDEX_OK,
            Err(e) => {
                set_error(e);
                INDEX_ERROR
            },
        }
    })
}

/// JSON statistics (count, tombstones, dim, memory bytes, params).
pub extern "C" fn web_internal_index_stats(handle_id: u64) -> *mut c_char {
    guard(std::ptr::null_mut(), || match handle(handle_id) {
        Some(h) => into_c_string(ffi_api::stats_json(&h)),
        None => error_json("unknown index handle"),
    })
}

/// Release a handle. The index is dropped once in-flight calls finish.
/// Returns 0, or -2 when the handle is unknown (already closed).
pub extern "C" fn web_internal_index_close(handle_id: u64) -> i32 {
    guard(INDEX_ERROR, || match lock().remove(&handle_id) {
        Some(_) => INDEX_OK,
        None => INDEX_UNKNOWN_HANDLE,
    })
}

// Canonical index symbols. These forward to the existing handle registry, so
// the transition does not create a second index implementation or file format.
#[unsafe(no_mangle)]
pub extern "C" fn aphrody_web_index_last_error() -> *mut c_char {
    web_internal_index_last_error()
}

/// # Safety
/// Same pointer contract as [`web_internal_index_open`].
#[unsafe(no_mangle)]
pub unsafe extern "C" fn aphrody_web_index_open(
    path_ptr: *const c_char,
    dim: u32,
    params_json_ptr: *const c_char,
    rebuild_if_corrupt: i32,
) -> u64 {
    unsafe { web_internal_index_open(path_ptr, dim, params_json_ptr, rebuild_if_corrupt) }
}

#[unsafe(no_mangle)]
pub extern "C" fn aphrody_web_index_len(handle_id: u64) -> i64 {
    web_internal_index_len(handle_id)
}

#[unsafe(no_mangle)]
pub extern "C" fn aphrody_web_index_dim(handle_id: u64) -> u32 {
    web_internal_index_dim(handle_id)
}

/// # Safety
/// Same pointer contract as [`web_internal_index_add`].
#[unsafe(no_mangle)]
pub unsafe extern "C" fn aphrody_web_index_add(
    handle_id: u64,
    key: u64,
    vector_ptr: *const f32,
    dim: u32,
) -> i32 {
    unsafe { web_internal_index_add(handle_id, key, vector_ptr, dim) }
}

/// # Safety
/// Same pointer contract as [`web_internal_index_add_batch`].
#[unsafe(no_mangle)]
pub unsafe extern "C" fn aphrody_web_index_add_batch(
    handle_id: u64,
    keys_ptr: *const u64,
    flat_ptr: *const f32,
    count: u32,
    dim: u32,
) -> i32 {
    unsafe { web_internal_index_add_batch(handle_id, keys_ptr, flat_ptr, count, dim) }
}

/// # Safety
/// Same pointer contract as [`web_internal_index_search`].
#[unsafe(no_mangle)]
pub unsafe extern "C" fn aphrody_web_index_search(
    handle_id: u64,
    query_ptr: *const f32,
    dim: u32,
    k: u32,
    ef: u32,
) -> *mut c_char {
    unsafe { web_internal_index_search(handle_id, query_ptr, dim, k, ef) }
}

#[unsafe(no_mangle)]
pub extern "C" fn aphrody_web_index_remove(handle_id: u64, key: u64) -> i32 {
    web_internal_index_remove(handle_id, key)
}

#[unsafe(no_mangle)]
pub extern "C" fn aphrody_web_index_save(handle_id: u64) -> i32 {
    web_internal_index_save(handle_id)
}

#[unsafe(no_mangle)]
pub extern "C" fn aphrody_web_index_compact(handle_id: u64) -> i32 {
    web_internal_index_compact(handle_id)
}

#[unsafe(no_mangle)]
pub extern "C" fn aphrody_web_index_stats(handle_id: u64) -> *mut c_char {
    web_internal_index_stats(handle_id)
}

#[unsafe(no_mangle)]
pub extern "C" fn aphrody_web_index_close(handle_id: u64) -> i32 {
    web_internal_index_close(handle_id)
}

#[cfg(test)]
mod tests {
    use std::ffi::{CStr, CString};

    use super::*;

    #[test]
    fn open_add_search_save_reopen_close() {
        let dir =
            std::env::temp_dir().join(format!("aphrody-web-index-ffi-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = CString::new(dir.join("t.hnsw").to_string_lossy().into_owned()).unwrap();
        unsafe {
            let id = web_internal_index_open(path.as_ptr(), 3, std::ptr::null(), 1);
            assert!(id > 0);
            assert_eq!(web_internal_index_add(id, 7, [1.0f32, 0.0, 0.0].as_ptr(), 3), INDEX_OK);
            let keys = [8u64, 9];
            let flat = [0.0f32, 1.0, 0.0, 0.0, 0.0, 1.0];
            assert_eq!(
                web_internal_index_add_batch(id, keys.as_ptr(), flat.as_ptr(), 2, 3),
                INDEX_OK
            );
            assert_eq!(web_internal_index_len(id), 3);
            let hits = web_internal_index_search(id, [0.9f32, 0.1, 0.0].as_ptr(), 3, 1, 64);
            let json = CStr::from_ptr(hits).to_string_lossy().into_owned();
            crate::web_internal_free_string(hits);
            assert!(json.contains("\"key\":7"), "{json}");
            assert_eq!(web_internal_index_save(id), INDEX_OK);
            assert_eq!(web_internal_index_close(id), INDEX_OK);
            assert_eq!(web_internal_index_close(id), INDEX_UNKNOWN_HANDLE);
            assert_eq!(web_internal_index_len(id), -1);

            let reopened = web_internal_index_open(path.as_ptr(), 0, std::ptr::null(), 0);
            assert_eq!(web_internal_index_len(reopened), 3);
            assert_eq!(web_internal_index_dim(reopened), 3);
            assert_eq!(web_internal_index_remove(reopened, 8), 1);
            web_internal_index_close(reopened);

            std::fs::write(dir.join("t.hnsw"), b"garbage").unwrap();
            assert_eq!(web_internal_index_open(path.as_ptr(), 3, std::ptr::null(), 0), 0);
            let rebuilt = web_internal_index_open(path.as_ptr(), 3, std::ptr::null(), 1);
            assert!(rebuilt > 0);
            assert_eq!(web_internal_index_len(rebuilt), 0);
            let err = web_internal_index_last_error();
            assert!(CStr::from_ptr(err).to_string_lossy().contains("corrupt"));
            crate::web_internal_free_string(err);
            web_internal_index_close(rebuilt);
        }
        let _ = std::fs::remove_dir_all(dir);
    }
}
