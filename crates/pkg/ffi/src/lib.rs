// SPDX-License-Identifier: Apache-2.0
//! ABI 1: synchronous, thread-safe store operations; numeric handles never expose
//! Rust pointers. Store handles may be shared; close does not cancel an in-flight
//! operation. Owned result buffers are immutable until released by their owner.
//! No callbacks or worker threads. All UTF-8 paths are explicit host inputs.

use aphrody_pkg_store::{BlobId, Store};
use std::{
    cell::RefCell,
    collections::HashMap,
    io,
    panic::AssertUnwindSafe,
    path::Path,
    sync::{Arc, Mutex, OnceLock},
};

pub const APHRODY_PKG_ABI_VERSION: u32 = 1;
pub const APHRODY_PKG_OK: i32 = 0;
pub const APHRODY_PKG_INVALID: i32 = 1;
pub const APHRODY_PKG_IO: i32 = 2;
pub const APHRODY_PKG_INTEGRITY: i32 = 3;
pub const APHRODY_PKG_NOT_FOUND: i32 = 4;
pub const APHRODY_PKG_EXISTS: i32 = 5;
pub const APHRODY_PKG_PANIC: i32 = 6;

enum Resource {
    Store(Arc<Store>),
    Buffer(Arc<[u8]>),
}
struct Registry {
    next: u64,
    entries: HashMap<u64, Resource>,
}
static REGISTRY: OnceLock<Mutex<Registry>> = OnceLock::new();
thread_local! { static ERROR: RefCell<String> = const { RefCell::new(String::new()) }; }

fn registry() -> &'static Mutex<Registry> {
    REGISTRY.get_or_init(|| Mutex::new(Registry { next: 1, entries: HashMap::new() }))
}
fn invalid(message: &str) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidInput, message)
}
fn insert(resource: Resource) -> io::Result<u64> {
    let mut guard = registry().lock().map_err(|_| io::Error::other("registry poisoned"))?;
    let id = guard.next;
    guard.next = id.checked_add(1).ok_or_else(|| io::Error::other("handles exhausted"))?;
    guard.entries.insert(id, resource);
    Ok(id)
}
fn store(id: u64) -> io::Result<Arc<Store>> {
    let guard = registry().lock().map_err(|_| io::Error::other("registry poisoned"))?;
    match guard.entries.get(&id) {
        Some(Resource::Store(value)) => Ok(value.clone()),
        _ => Err(invalid("invalid store handle")),
    }
}
fn buffer(id: u64) -> io::Result<Arc<[u8]>> {
    let guard = registry().lock().map_err(|_| io::Error::other("registry poisoned"))?;
    match guard.entries.get(&id) {
        Some(Resource::Buffer(value)) => Ok(value.clone()),
        _ => Err(invalid("invalid buffer handle")),
    }
}
fn boundary(operation: impl FnOnce() -> io::Result<()>) -> i32 {
    match std::panic::catch_unwind(AssertUnwindSafe(operation)) {
        Ok(Ok(())) => {
            ERROR.with(|error| error.borrow_mut().clear());
            APHRODY_PKG_OK
        },
        Ok(Err(error)) => {
            let status = match error.kind() {
                io::ErrorKind::InvalidInput => APHRODY_PKG_INVALID,
                io::ErrorKind::InvalidData => APHRODY_PKG_INTEGRITY,
                io::ErrorKind::NotFound => APHRODY_PKG_NOT_FOUND,
                io::ErrorKind::AlreadyExists => APHRODY_PKG_EXISTS,
                _ => APHRODY_PKG_IO,
            };
            ERROR.with(|slot| *slot.borrow_mut() = error.to_string());
            status
        },
        Err(_) => {
            ERROR.with(|slot| *slot.borrow_mut() = "native operation panicked".into());
            APHRODY_PKG_PANIC
        },
    }
}
unsafe fn bytes<'a>(data: *const u8, len: usize) -> io::Result<&'a [u8]> {
    if len == 0 {
        return Ok(&[]);
    }
    if data.is_null() || len > isize::MAX as usize {
        return Err(invalid("invalid input buffer"));
    }
    // SAFETY: foreign caller guarantees readable memory for the declared length.
    Ok(unsafe { std::slice::from_raw_parts(data, len) })
}
unsafe fn text<'a>(data: *const u8, len: usize) -> io::Result<&'a str> {
    std::str::from_utf8(unsafe { bytes(data, len)? }).map_err(|_| invalid("input must be UTF-8"))
}
unsafe fn output(out: *mut u64) -> io::Result<()> {
    if out.is_null() || !(out as usize).is_multiple_of(std::mem::align_of::<u64>()) {
        return Err(invalid("invalid output pointer"));
    }
    unsafe {
        out.write(0);
    }
    Ok(())
}

#[unsafe(no_mangle)]
pub extern "C" fn aphrody_pkg_abi_version() -> u32 {
    APHRODY_PKG_ABI_VERSION
}

/// # Safety
/// Input spans must remain readable for the call; out must point to a writable,
/// aligned u64. Passing foreign/dangling memory is outside this ABI contract.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn aphrody_pkg_store_open(root: *const u8, len: usize, out: *mut u64) -> i32 {
    boundary(|| {
        unsafe {
            output(out)?;
        }
        let root = unsafe { text(root, len)? };
        if root.is_empty() || root.contains('\0') {
            return Err(invalid("root must be a nonempty UTF-8 path"));
        }
        let id = insert(Resource::Store(Arc::new(Store::new(root))))?;
        unsafe {
            out.write(id);
        }
        Ok(())
    })
}

/// Release either a store or buffer handle exactly once. Never frees caller memory.
#[unsafe(no_mangle)]
pub extern "C" fn aphrody_pkg_release(handle: u64) -> i32 {
    boundary(|| {
        let resource = registry()
            .lock()
            .map_err(|_| io::Error::other("registry poisoned"))?
            .entries
            .remove(&handle);
        if resource.is_none() {
            return Err(invalid("invalid or released handle"));
        }
        Ok(())
    })
}

/// Stores bytes and returns an owned ASCII lowercase SHA-256 buffer handle.
/// A zero expected_len means no expected digest (pointer may be NULL).
/// # Safety
/// Input spans are readable; out is writable and aligned for u64.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn aphrody_pkg_store_put(
    handle: u64,
    data: *const u8,
    len: usize,
    expected: *const u8,
    expected_len: usize,
    out: *mut u64,
) -> i32 {
    boundary(|| {
        unsafe {
            output(out)?;
        }
        let store = store(handle)?;
        let expected = if expected_len == 0 {
            None
        } else {
            Some(BlobId::parse(unsafe { text(expected, expected_len)? })?)
        };
        let id = store.put(unsafe { bytes(data, len)? }, expected.as_ref())?;
        let result = insert(Resource::Buffer(Arc::from(id.as_str().as_bytes())))?;
        unsafe {
            out.write(result);
        }
        Ok(())
    })
}

/// # Safety
/// The digest span is readable for len bytes during the call.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn aphrody_pkg_store_verify(
    handle: u64,
    digest: *const u8,
    len: usize,
) -> i32 {
    boundary(|| store(handle)?.verify(&BlobId::parse(unsafe { text(digest, len)? })?))
}

/// Independent writable materialization; existing destinations are never replaced.
/// # Safety
/// Digest and destination spans must be readable for their declared lengths.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn aphrody_pkg_store_materialize(
    handle: u64,
    digest: *const u8,
    len: usize,
    destination: *const u8,
    destination_len: usize,
) -> i32 {
    boundary(|| {
        let destination = unsafe { text(destination, destination_len)? };
        if destination.is_empty() || destination.contains('\0') {
            return Err(invalid("invalid destination path"));
        }
        store(handle)?
            .materialize(&BlobId::parse(unsafe { text(digest, len)? })?, Path::new(destination))
    })
}

/// # Safety
/// Both outputs are distinct writable aligned u64 pointers.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn aphrody_pkg_store_stats(
    handle: u64,
    blobs: *mut u64,
    bytes: *mut u64,
) -> i32 {
    boundary(|| {
        unsafe {
            output(blobs)?;
            output(bytes)?;
        }
        if blobs == bytes {
            return Err(invalid("outputs must be distinct"));
        }
        let stats = store(handle)?.stats()?;
        unsafe {
            blobs.write(stats.blobs);
            bytes.write(stats.bytes);
        }
        Ok(())
    })
}

/// # Safety
/// Out is a writable aligned u64 pointer.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn aphrody_pkg_buffer_len(handle: u64, out: *mut u64) -> i32 {
    boundary(|| {
        unsafe {
            output(out)?;
        }
        let value = buffer(handle)?;
        unsafe {
            out.write(value.len() as u64);
        }
        Ok(())
    })
}

/// Copy the full buffer into caller memory; no NUL terminator is appended.
/// # Safety
/// Destination must be writable for capacity bytes and not alias native storage.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn aphrody_pkg_buffer_copy(
    handle: u64,
    destination: *mut u8,
    capacity: usize,
) -> i32 {
    boundary(|| {
        let value = buffer(handle)?;
        if capacity < value.len() || (destination.is_null() && !value.is_empty()) {
            return Err(invalid("output buffer too small"));
        }
        if !value.is_empty() {
            unsafe {
                std::ptr::copy_nonoverlapping(value.as_ptr(), destination, value.len());
            }
        }
        Ok(())
    })
}

/// Captures the calling thread's last error as an owned UTF-8 buffer handle.
/// Read before any subsequent status-returning call clears/replaces the error.
/// # Safety
/// Out is a writable aligned u64 pointer.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn aphrody_pkg_error_message(out: *mut u64) -> i32 {
    let message = ERROR.with(|slot| slot.borrow().clone());
    boundary(|| {
        unsafe {
            output(out)?;
        }
        let id = insert(Resource::Buffer(Arc::from(message.as_bytes())))?;
        unsafe {
            out.write(id);
        }
        Ok(())
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn foreign_calls_roundtrip_and_reject_stale_handles() {
        let root = tempfile::tempdir().unwrap();
        let path = root.path().to_str().unwrap().as_bytes();
        let (mut store, mut digest) = (0, 0);
        unsafe {
            assert_eq!(aphrody_pkg_store_open(path.as_ptr(), path.len(), &mut store), 0);
            assert_eq!(
                aphrody_pkg_store_put(store, b"blob".as_ptr(), 4, std::ptr::null(), 0, &mut digest),
                0
            );
            let mut length = 0;
            assert_eq!(aphrody_pkg_buffer_len(digest, &mut length), 0);
            assert_eq!(length, 64);
            let mut bytes = [0; 64];
            assert_eq!(
                aphrody_pkg_buffer_copy(digest, bytes.as_mut_ptr(), 63),
                APHRODY_PKG_INVALID
            );
            assert_eq!(aphrody_pkg_buffer_copy(digest, bytes.as_mut_ptr(), 64), 0);
            assert_eq!(aphrody_pkg_store_verify(store, bytes.as_ptr(), 64), 0);
            let destination = root.path().join("materialized");
            let destination = destination.to_str().unwrap().as_bytes();
            assert_eq!(
                aphrody_pkg_store_materialize(
                    store,
                    bytes.as_ptr(),
                    64,
                    destination.as_ptr(),
                    destination.len()
                ),
                0
            );
            assert_eq!(
                aphrody_pkg_store_materialize(
                    store,
                    bytes.as_ptr(),
                    64,
                    destination.as_ptr(),
                    destination.len()
                ),
                APHRODY_PKG_EXISTS
            );
            let (mut count, mut size) = (0, 0);
            assert_eq!(aphrody_pkg_store_stats(store, &mut count, &mut size), 0);
            assert_eq!((count, size), (1, 4));
            assert_eq!(aphrody_pkg_release(digest), 0);
            assert_eq!(aphrody_pkg_release(digest), APHRODY_PKG_INVALID);
            assert_eq!(aphrody_pkg_release(store), 0);
            assert_eq!(aphrody_pkg_store_verify(store, bytes.as_ptr(), 64), APHRODY_PKG_INVALID);
        }
    }
    #[test]
    fn null_and_integrity_failures_are_explicit_and_panic_is_contained() {
        unsafe {
            assert_eq!(
                aphrody_pkg_store_open(std::ptr::null(), 1, std::ptr::null_mut()),
                APHRODY_PKG_INVALID
            );
        }
        assert_eq!(boundary(|| panic!("boundary test")), APHRODY_PKG_PANIC);
        assert_eq!(
            boundary(|| Err(io::Error::new(io::ErrorKind::InvalidData, "mismatch"))),
            APHRODY_PKG_INTEGRITY
        );
    }
}
