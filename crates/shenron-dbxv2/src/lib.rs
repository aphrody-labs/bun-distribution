// SPDX-License-Identifier: Apache-2.0
//! # shenron-dbxv2 - DBXV2 reverse engineering as a C ABI.
//!
//! Every function takes borrowed input bytes and returns an owned [`ShBuf`] through an out
//! parameter; free it with [`shenron_dbxv2_buf_free`]. Status is `0` on success, `-1` on error
//! (message in [`shenron_dbxv2_last_error`], thread-local, never freed by the caller) and `-2`
//! when the call panicked. JSON results are UTF-8 without a trailing NUL.
//!
//! | Symbol | Output |
//! |---|---|
//! | `shenron_dbxv2_abi_version() -> u32` | ABI version |
//! | `shenron_dbxv2_identify(data, len, name, out)` | `{format, category, parsable}` JSON |
//! | `shenron_dbxv2_cpk_list(data, len, out)` | CPK entry table JSON |
//! | `shenron_dbxv2_cpk_extract(data, len, name, out)` | raw bytes of one entry |
//! | `shenron_dbxv2_summarize(data, len, name, out)` | EMB/EMD/ESK/gameplay JSON |
//! | `shenron_dbxv2_audio_to_wav(data, len, out)` | packed WAVs: `u32 count`, then `u32 len` + bytes each (LE) |

use std::{
    cell::RefCell,
    ffi::{CStr, c_char, c_int},
    panic::{AssertUnwindSafe, catch_unwind},
    ptr, slice,
};

use bun_re::game::api;

/// ABI version of this library; bumped on any incompatible signature change.
pub const ABI_VERSION: u32 = 1;

/// Owned byte buffer handed to the host.
#[repr(C)]
pub struct ShBuf {
    pub ptr: *mut u8,
    pub len: usize,
}

thread_local! {
    static LAST_ERROR: RefCell<Vec<u8>> = const { RefCell::new(Vec::new()) };
}

fn set_error(message: impl std::fmt::Display) {
    let mut bytes = message.to_string().into_bytes();
    bytes.retain(|byte| *byte != 0);
    bytes.push(0);
    LAST_ERROR.with(|slot| *slot.borrow_mut() = bytes);
}

fn give(out: *mut ShBuf, bytes: Vec<u8>) {
    let boxed = bytes.into_boxed_slice();
    let len = boxed.len();
    let ptr = Box::into_raw(boxed).cast::<u8>();
    // SAFETY: `run` checked `out` is non-null; the host owns the allocation until buf_free.
    unsafe { *out = ShBuf { ptr, len } };
}

/// Run `body`, publish its bytes through `out`, and map errors and panics to a status code.
fn run(out: *mut ShBuf, body: impl FnOnce() -> Result<Vec<u8>, String>) -> c_int {
    if out.is_null() {
        set_error("null output pointer");
        return -1;
    }
    // SAFETY: non-null checked above; reset so a failed call never leaves a stale buffer.
    unsafe { *out = ShBuf { ptr: ptr::null_mut(), len: 0 } };
    match catch_unwind(AssertUnwindSafe(body)) {
        Ok(Ok(bytes)) => {
            give(out, bytes);
            0
        },
        Ok(Err(message)) => {
            set_error(message);
            -1
        },
        Err(_) => {
            set_error("internal panic");
            -2
        },
    }
}

/// # Safety
/// `data` must be valid for `len` bytes (or null with `len == 0`).
unsafe fn input<'a>(data: *const u8, len: usize) -> &'a [u8] {
    if data.is_null() || len == 0 {
        return &[];
    }
    // SAFETY: guaranteed by the caller contract above.
    unsafe { slice::from_raw_parts(data, len) }
}

/// # Safety
/// `name` must be null or a NUL-terminated string.
unsafe fn text<'a>(name: *const c_char) -> &'a str {
    if name.is_null() {
        return "";
    }
    // SAFETY: guaranteed by the caller contract above.
    unsafe { CStr::from_ptr(name) }.to_str().unwrap_or("")
}

fn json_bytes(value: &impl serde::Serialize) -> Result<Vec<u8>, String> {
    serde_json::to_vec(value).map_err(|error| error.to_string())
}

#[unsafe(no_mangle)]
pub extern "C" fn shenron_dbxv2_abi_version() -> u32 {
    ABI_VERSION
}

/// Library version (static NUL-terminated string, never freed).
#[unsafe(no_mangle)]
pub extern "C" fn shenron_dbxv2_version() -> *const c_char {
    concat!(env!("CARGO_PKG_VERSION"), "\0").as_ptr().cast()
}

/// Last error message of this thread (NUL-terminated, valid until the next call on the thread).
#[unsafe(no_mangle)]
pub extern "C" fn shenron_dbxv2_last_error() -> *const c_char {
    LAST_ERROR.with(|slot| {
        let bytes = slot.borrow();
        if bytes.is_empty() { c"".as_ptr() } else { bytes.as_ptr().cast() }
    })
}

/// Free a buffer returned by this library. Safe on an empty or already-reset buffer.
///
/// # Safety
/// `buf` must come from this library and must not be freed twice.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn shenron_dbxv2_buf_free(buf: ShBuf) {
    if buf.ptr.is_null() {
        return;
    }
    // SAFETY: `ptr`/`len` describe the boxed slice leaked by `give`.
    drop(unsafe { Box::from_raw(ptr::slice_from_raw_parts_mut(buf.ptr, buf.len)) });
}

/// Identify a buffer; `name` (optional) supplies the extension fallback.
///
/// # Safety
/// `data` valid for `len` bytes, `name` null or NUL-terminated, `out` writable.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn shenron_dbxv2_identify(
    data: *const u8,
    len: usize,
    name: *const c_char,
    out: *mut ShBuf,
) -> c_int {
    // SAFETY: forwarded caller contract.
    let (bytes, name) = unsafe { (input(data, len), text(name)) };
    run(out, || json_bytes(&api::identify(bytes, name)))
}

/// File table of a plain in-memory CPK.
///
/// # Safety
/// `data` valid for `len` bytes, `out` writable.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn shenron_dbxv2_cpk_list(
    data: *const u8,
    len: usize,
    out: *mut ShBuf,
) -> c_int {
    // SAFETY: forwarded caller contract.
    let bytes = unsafe { input(data, len) };
    run(out, || {
        let entries = api::cpk_list(bytes).map_err(|error| error.to_string())?;
        json_bytes(&entries)
    })
}

/// Extract one CPK entry by path or name (CRILAYLA decompressed).
///
/// # Safety
/// `data` valid for `len` bytes, `name` NUL-terminated, `out` writable.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn shenron_dbxv2_cpk_extract(
    data: *const u8,
    len: usize,
    name: *const c_char,
    out: *mut ShBuf,
) -> c_int {
    // SAFETY: forwarded caller contract.
    let (bytes, name) = unsafe { (input(data, len), text(name)) };
    run(out, || api::cpk_extract(bytes, name).map_err(|error| error.to_string()))
}

/// JSON summary of an EMB/EMD/ESK/EMM/BAC/BCM/BCS/BDM/BSA/EAN/CMS/CUS/PUP/MSG buffer.
///
/// # Safety
/// `data` valid for `len` bytes, `name` null or NUL-terminated, `out` writable.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn shenron_dbxv2_summarize(
    data: *const u8,
    len: usize,
    name: *const c_char,
    out: *mut ShBuf,
) -> c_int {
    // SAFETY: forwarded caller contract.
    let (bytes, name) = unsafe { (input(data, len), text(name)) };
    run(out, || {
        let value = api::summarize(bytes, name).map_err(|error| error.to_string())?;
        json_bytes(&value)
    })
}

fn pack_u32(value: usize) -> Result<[u8; 4], String> {
    u32::try_from(value).map(u32::to_le_bytes).map_err(|error| error.to_string())
}

/// Decode HCA/ADX/AWB/ACB to WAV; see the module table for the packed output layout.
///
/// # Safety
/// `data` valid for `len` bytes, `out` writable.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn shenron_dbxv2_audio_to_wav(
    data: *const u8,
    len: usize,
    out: *mut ShBuf,
) -> c_int {
    // SAFETY: forwarded caller contract.
    let bytes = unsafe { input(data, len) };
    run(out, || {
        let waves = api::audio_to_wav(bytes).map_err(|error| error.to_string())?;
        let mut packed = Vec::from(pack_u32(waves.len())?);
        for wave in &waves {
            packed.extend_from_slice(&pack_u32(wave.len())?);
            packed.extend_from_slice(wave);
        }
        Ok(packed)
    })
}
