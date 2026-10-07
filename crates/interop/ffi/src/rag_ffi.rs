// SPDX-License-Identifier: Apache-2.0
//! C ABI over [`aphrody_rag_core::api`], the single source of truth of the RAG capabilities.
//!
//! This crate declares no capability: it forwards the three entry points of the call surface
//! (`manifest`, `call_json`, `call_vec`) through caller-owned buffers, the convention of the
//! zero-copy exports of `aphrody-ffi`:
//!
//! * Inputs are `(pointer, length)` pairs over caller memory; no NUL terminator.
//! * Outputs go to a caller buffer `(out, out_cap)`; the return value is the number of bytes of
//!   the result. When it exceeds `out_cap` nothing is written and the result is kept in a
//!   thread-local stash: the caller reallocates and reads it with [`aphrody_rag_take`], without
//!   recomputing.
//! * `call_json` always yields a document: `{"ok": <result>}` or `{"error": "<message>"}`.
//! * `call_vec` yields raw bytes; an operation failure returns [`RAG_OP_ERROR`] and the message
//!   is read with [`aphrody_rag_last_error`].
//! * Negative returns: [`RAG_INVALID`] (null/misaligned pointer, size overflow, invalid UTF-8),
//!   [`RAG_OP_ERROR`], [`RAG_PANIC`] (a Rust panic was caught at the boundary).
//!
//! Nothing library-owned is returned, so there is no free function.

use std::{
    cell::RefCell,
    panic::{AssertUnwindSafe, catch_unwind},
    slice,
};

/// ABI version of these symbols (the operation set is versioned separately by the manifest).
pub const RAG_FFI_ABI_VERSION: u32 = 1;
/// Status: invalid argument.
pub const RAG_INVALID: i32 = -1;
/// Status: the operation failed; see [`aphrody_rag_last_error`].
pub const RAG_OP_ERROR: i32 = -2;
/// Status: a Rust panic was caught at the boundary.
pub const RAG_PANIC: i32 = -3;

thread_local! {
    static STASH: RefCell<Vec<u8>> = const { RefCell::new(Vec::new()) };
    static LAST_ERROR: RefCell<String> = const { RefCell::new(String::new()) };
}

/// ABI version of the `aphrody_rag_*` symbols.
#[unsafe(no_mangle)]
pub extern "C" fn aphrody_rag_abi_version() -> u32 {
    RAG_FFI_ABI_VERSION
}

/// Borrow `(ptr, len)` as bytes; a null pointer is accepted only when `len == 0`.
///
/// # Safety
/// `ptr` must be null or valid for `len` readable bytes.
unsafe fn borrow<'a>(ptr: *const u8, len: usize) -> Option<&'a [u8]> {
    if ptr.is_null() {
        return (len == 0).then_some(&[]);
    }
    // SAFETY: guaranteed by the caller.
    Some(unsafe { slice::from_raw_parts(ptr, len) })
}

/// # Safety
/// As [`borrow`].
unsafe fn borrow_str<'a>(ptr: *const u8, len: usize) -> Option<&'a str> {
    // SAFETY: guaranteed by the caller.
    std::str::from_utf8(unsafe { borrow(ptr, len) }?).ok()
}

/// Copy `bytes` into `out` when it fits, else stash it; return its length.
///
/// # Safety
/// `out` must be null or valid for `cap` writable bytes.
unsafe fn deliver(bytes: Vec<u8>, out: *mut u8, cap: usize) -> i64 {
    let Ok(len) = i64::try_from(bytes.len()) else {
        return i64::from(RAG_INVALID);
    };
    if !out.is_null() && bytes.len() <= cap {
        // SAFETY: `out` is valid for `cap >= len` bytes; `bytes` is a distinct allocation.
        unsafe { std::ptr::copy_nonoverlapping(bytes.as_ptr(), out, bytes.len()) };
        STASH.with_borrow_mut(Vec::clear);
    } else {
        STASH.with_borrow_mut(|s| *s = bytes);
    }
    len
}

fn fail(message: String) -> i64 {
    LAST_ERROR.with_borrow_mut(|e| *e = message);
    i64::from(RAG_OP_ERROR)
}

/// Write the manifest (JSON: ABI, crate, version, operation names) into `out`.
///
/// # Safety
/// `out` must be null or valid for `out_cap` writable bytes.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn aphrody_rag_manifest(out: *mut u8, out_cap: usize) -> i64 {
    catch_unwind(AssertUnwindSafe(|| {
        // SAFETY: pointer contract documented above.
        unsafe { deliver(aphrody_rag_core::api::manifest().into_bytes(), out, out_cap) }
    }))
    .unwrap_or(i64::from(RAG_PANIC))
}

/// Run a structured operation. Writes `{"ok": ...}` or `{"error": "..."}` and returns its length.
///
/// # Safety
/// `op`/`input` must be valid for their lengths; `out` null or valid for `out_cap` writable
/// bytes; the output must not overlap the inputs.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn aphrody_rag_call_json(
    op: *const u8,
    op_len: usize,
    input: *const u8,
    input_len: usize,
    out: *mut u8,
    out_cap: usize,
) -> i64 {
    catch_unwind(AssertUnwindSafe(|| {
        // SAFETY: pointer contract documented above.
        let (Some(op), Some(input)) =
            (unsafe { borrow_str(op, op_len) }, unsafe { borrow_str(input, input_len) })
        else {
            return i64::from(RAG_INVALID);
        };
        let doc = match aphrody_rag_core::api::call_json(op, input) {
            Ok(value) => format!("{{\"ok\":{value}}}"),
            Err(message) => json_error(&message),
        };
        // SAFETY: pointer contract documented above.
        unsafe { deliver(doc.into_bytes(), out, out_cap) }
    }))
    .unwrap_or(i64::from(RAG_PANIC))
}

/// Run a dense-vector operation over byte buffers `a` and `b` with JSON `params`.
/// Writes the raw result bytes and returns their length.
///
/// # Safety
/// Every `(ptr, len)` pair must be valid; `out` null or valid for `out_cap` writable bytes; the
/// output must not overlap the inputs.
#[unsafe(no_mangle)]
#[allow(clippy::too_many_arguments)]
pub unsafe extern "C" fn aphrody_rag_call_vec(
    op: *const u8,
    op_len: usize,
    params: *const u8,
    params_len: usize,
    a: *const u8,
    a_len: usize,
    b: *const u8,
    b_len: usize,
    out: *mut u8,
    out_cap: usize,
) -> i64 {
    catch_unwind(AssertUnwindSafe(|| {
        // SAFETY: pointer contract documented above.
        let (Some(op), Some(params), Some(a), Some(b)) = (
            unsafe { borrow_str(op, op_len) },
            unsafe { borrow_str(params, params_len) },
            unsafe { borrow(a, a_len) },
            unsafe { borrow(b, b_len) },
        ) else {
            return i64::from(RAG_INVALID);
        };
        match aphrody_rag_core::api::call_vec(op, params, a, b) {
            // SAFETY: pointer contract documented above.
            Ok(bytes) => unsafe { deliver(bytes, out, out_cap) },
            Err(message) => fail(message),
        }
    }))
    .unwrap_or(i64::from(RAG_PANIC))
}

/// Copy the result kept by the last call that did not fit its buffer, then clear it.
/// Returns its length (`0` when nothing is stashed); copies only when it fits.
///
/// # Safety
/// `out` must be null or valid for `out_cap` writable bytes.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn aphrody_rag_take(out: *mut u8, out_cap: usize) -> i64 {
    catch_unwind(AssertUnwindSafe(|| {
        STASH.with_borrow_mut(|stash| {
            let len = stash.len();
            if !out.is_null() && len <= out_cap && len > 0 {
                // SAFETY: `out` is valid for `out_cap >= len` bytes; the stash is a distinct allocation.
                unsafe { std::ptr::copy_nonoverlapping(stash.as_ptr(), out, len) };
                stash.clear();
            }
            i64::try_from(len).unwrap_or(i64::from(RAG_INVALID))
        })
    }))
    .unwrap_or(i64::from(RAG_PANIC))
}

/// Copy the message of the last [`RAG_OP_ERROR`] on this thread into `out`; returns its length.
///
/// # Safety
/// `out` must be null or valid for `out_cap` writable bytes.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn aphrody_rag_last_error(out: *mut u8, out_cap: usize) -> i64 {
    catch_unwind(AssertUnwindSafe(|| {
        let message = LAST_ERROR.with_borrow(Clone::clone).into_bytes();
        // SAFETY: pointer contract documented above.
        unsafe { deliver(message, out, out_cap) }
    }))
    .unwrap_or(i64::from(RAG_PANIC))
}

/// `{"error": <message>}` with the message JSON-escaped.
fn json_error(message: &str) -> String {
    let mut escaped = String::with_capacity(message.len() + 2);
    escaped.push('"');
    for c in message.chars() {
        match c {
            '"' => escaped.push_str("\\\""),
            '\\' => escaped.push_str("\\\\"),
            '\n' => escaped.push_str("\\n"),
            '\r' => escaped.push_str("\\r"),
            '\t' => escaped.push_str("\\t"),
            c if (c as u32) < 0x20 => escaped.push_str(&format!("\\u{:04x}", c as u32)),
            c => escaped.push(c),
        }
    }
    escaped.push('"');
    format!("{{\"error\":{escaped}}}")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn json(op: &str, input: &str, cap: usize) -> (i64, Vec<u8>) {
        let mut buf = vec![0u8; cap];
        // SAFETY: all pointers are valid for their lengths.
        let n = unsafe {
            aphrody_rag_call_json(
                op.as_ptr(),
                op.len(),
                input.as_ptr(),
                input.len(),
                buf.as_mut_ptr(),
                cap,
            )
        };
        (n, buf)
    }

    #[test]
    fn json_roundtrip_and_stash() {
        let (n, buf) = json("rrf", r#"{"lists":[["a","b"],["b"]]}"#, 4096);
        let text = std::str::from_utf8(&buf[..usize::try_from(n).unwrap()]).unwrap();
        assert!(text.starts_with("{\"ok\":["), "{text}");
        // Too small: nothing written, result stashed and recovered without recompute.
        let (need, small) = json("rrf", r#"{"lists":[["a","b"],["b"]]}"#, 4);
        assert_eq!(need, n);
        assert_eq!(small, vec![0u8; 4]);
        let mut again = vec![0u8; usize::try_from(need).unwrap()];
        // SAFETY: valid buffer.
        assert_eq!(unsafe { aphrody_rag_take(again.as_mut_ptr(), again.len()) }, need);
        assert_eq!(&again[..], &buf[..again.len()]);
    }

    #[test]
    fn errors_are_documents_or_codes() {
        let (n, buf) = json("nope", "{}", 256);
        let text = std::str::from_utf8(&buf[..usize::try_from(n).unwrap()]).unwrap();
        assert!(text.starts_with("{\"error\":\"unknown json operation"), "{text}");
        // SAFETY: a null pointer with a non-zero length is the invalid case under test.
        assert_eq!(
            unsafe {
                aphrody_rag_call_json(
                    std::ptr::null(),
                    3,
                    std::ptr::null(),
                    0,
                    std::ptr::null_mut(),
                    0,
                )
            },
            i64::from(RAG_INVALID)
        );
        let op = b"dot_f32";
        let mut out = [0u8; 8];
        // SAFETY: valid pointers; odd-length buffer is rejected by the operation.
        let code = unsafe {
            aphrody_rag_call_vec(
                op.as_ptr(),
                op.len(),
                std::ptr::null(),
                0,
                [1u8, 2, 3].as_ptr(),
                3,
                std::ptr::null(),
                0,
                out.as_mut_ptr(),
                out.len(),
            )
        };
        assert_eq!(code, i64::from(RAG_OP_ERROR));
        let mut msg = [0u8; 128];
        // SAFETY: valid buffer.
        let m = unsafe { aphrody_rag_last_error(msg.as_mut_ptr(), msg.len()) };
        assert!(
            std::str::from_utf8(&msg[..usize::try_from(m).unwrap()])
                .unwrap()
                .contains("multiple of 4")
        );
    }

    #[test]
    fn vec_roundtrip_and_manifest() {
        let a: Vec<u8> = [1.0_f32, 2.0].iter().flat_map(|v| v.to_le_bytes()).collect();
        let b: Vec<u8> = [3.0_f32, 4.0].iter().flat_map(|v| v.to_le_bytes()).collect();
        let op = b"dot_f32";
        let mut out = [0u8; 4];
        // SAFETY: valid pointers.
        let n = unsafe {
            aphrody_rag_call_vec(
                op.as_ptr(),
                op.len(),
                std::ptr::null(),
                0,
                a.as_ptr(),
                a.len(),
                b.as_ptr(),
                b.len(),
                out.as_mut_ptr(),
                out.len(),
            )
        };
        assert_eq!(n, 4);
        assert_eq!(f32::from_le_bytes(out), 11.0);
        let mut m = vec![0u8; 8192];
        // SAFETY: valid buffer.
        let len = unsafe { aphrody_rag_manifest(m.as_mut_ptr(), m.len()) };
        assert!(len > 0);
        assert!(
            std::str::from_utf8(&m[..usize::try_from(len).unwrap()]).unwrap().contains("\"abi\":1")
        );
        assert_eq!(aphrody_rag_abi_version(), RAG_FFI_ABI_VERSION);
    }
}
