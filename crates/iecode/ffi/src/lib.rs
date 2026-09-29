#![deny(unsafe_op_in_unsafe_fn)]

use std::ffi::{c_char, c_void};
use std::slice;

/// Owned byte buffer returned by IECODE. The matching free function must be
/// called with all three fields; no allocation crosses the ABI unowned.
#[repr(C)]
#[derive(Debug, Default)]
pub struct IecodeBytes {
    pub ptr: *mut u8,
    pub len: usize,
    pub cap: usize,
}

const VERSION: &[u8] = concat!(env!("CARGO_PKG_VERSION"), "\0").as_bytes();
const SCHEMA: &[u8] = b"iecode.ffi/v1\0";

#[unsafe(no_mangle)]
pub extern "C" fn iecode_core_version() -> *const c_char {
    VERSION.as_ptr().cast()
}

#[unsafe(no_mangle)]
pub extern "C" fn iecode_ffi_schema() -> *const c_char {
    SCHEMA.as_ptr().cast()
}

#[unsafe(no_mangle)]
/// Write the registry into caller-provided writable `IecodeBytes` storage.
///
/// # Safety
/// `out` must be null or point to a valid, writable `IecodeBytes` value for the
/// duration of the call.
pub unsafe extern "C" fn iecode_emu_registry_json_out(out: *mut IecodeBytes) -> i32 {
    if out.is_null() {
        return 1;
    }

    let bytes = match serde_json::to_vec(&iecode_core::emu::REGISTRY.all()) {
        Ok(bytes) => bytes,
        Err(_) => return 2,
    };
    let (ptr, len, cap) = bytes.into_raw_parts();
    // SAFETY: `out` was checked for null and points to caller-owned writable
    // storage described by the ABI contract.
    unsafe {
        (*out).ptr = ptr;
        (*out).len = len;
        (*out).cap = cap;
    }
    0
}

/// Validate one UTF-8 JSON pipeline manifest and return a JSON result in `out`.
///
/// Return codes are `0` for a valid manifest, `3` for invalid JSON and `4` for a valid JSON
/// document that violates the pipeline contract. The result buffer is always owned by IECODE and
/// must be released with [`iecode_bytes_free_fields`].
///
/// # Safety
/// `input` must be null only when `input_len` is zero; otherwise it must point to `input_len`
/// readable bytes. `out` must be null or point to a valid, writable [`IecodeBytes`] value.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn iecode_pipeline_validate_json(
    input: *const u8,
    input_len: usize,
    out: *mut IecodeBytes,
) -> i32 {
    if out.is_null() || (input.is_null() && input_len != 0) {
        return 1;
    }

    // SAFETY: the caller contract guarantees that the byte range is readable when non-empty.
    let bytes = if input_len == 0 {
        &[]
    } else {
        // SAFETY: the caller contract guarantees that the byte range is readable when non-empty.
        unsafe { slice::from_raw_parts(input, input_len) }
    };
    let manifest = match serde_json::from_slice::<iecode_core::pipeline::PipelineManifest>(bytes) {
        Ok(manifest) => manifest,
        Err(error) => {
            write_json_result(
                out,
                serde_json::json!({ "valid": false, "error": error.to_string() }),
            );
            return 3;
        },
    };

    match manifest.validate() {
        Ok(()) => {
            write_json_result(out, serde_json::json!({ "valid": true }));
            0
        },
        Err(error) => {
            write_json_result(
                out,
                serde_json::json!({ "valid": false, "error": error.to_string() }),
            );
            4
        },
    }
}

fn write_json_result(out: *mut IecodeBytes, value: serde_json::Value) {
    let Ok(bytes) = serde_json::to_vec(&value) else {
        return;
    };
    let (ptr, len, cap) = bytes.into_raw_parts();
    // SAFETY: all callers validate `out` before calling this helper.
    unsafe {
        (*out).ptr = ptr;
        (*out).len = len;
        (*out).cap = cap;
    }
}

#[unsafe(no_mangle)]
/// Release a byte allocation previously returned by this library.
///
/// # Safety
/// The three fields must be the exact values returned by an IECODE byte
/// function, and must not have been released already.
pub unsafe extern "C" fn iecode_bytes_free_fields(ptr: *mut u8, len: usize, cap: usize) {
    if ptr.is_null() || cap == 0 {
        return;
    }
    // SAFETY: fields originate from `Vec::into_raw_parts` in this library.
    unsafe {
        drop(Vec::from_raw_parts(ptr, len, cap));
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn iecode_ffi_free(_ptr: *mut c_void) {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn abi_strings_are_nul_terminated() {
        assert_eq!(VERSION.last(), Some(&0));
        assert_eq!(SCHEMA.last(), Some(&0));
    }

    #[test]
    fn null_output_is_rejected() {
        assert_eq!(unsafe { iecode_emu_registry_json_out(std::ptr::null_mut()) }, 1);
    }

    #[test]
    fn registry_round_trips() {
        let mut output = IecodeBytes::default();
        assert_eq!(unsafe { iecode_emu_registry_json_out(&mut output) }, 0);
        assert!(output.len > 2);
        // SAFETY: the buffer was returned by the preceding function.
        let bytes = unsafe { std::slice::from_raw_parts(output.ptr, output.len) };
        assert!(serde_json::from_slice::<serde_json::Value>(bytes).is_ok());
        // SAFETY: the fields are the allocation returned above.
        unsafe { iecode_bytes_free_fields(output.ptr, output.len, output.cap) };
    }

    #[test]
    fn pipeline_validation_round_trips() {
        let input = br#"{"id":"ds-inspect","platform":"ds","stages":[{"id":"inspect","kind":"inspect","owner":"iecode-formats"}]}"#;
        let mut output = IecodeBytes::default();
        assert_eq!(
            unsafe { iecode_pipeline_validate_json(input.as_ptr(), input.len(), &mut output) },
            0
        );
        let bytes = unsafe { std::slice::from_raw_parts(output.ptr, output.len) };
        assert_eq!(bytes, br#"{"valid":true}"#);
        unsafe { iecode_bytes_free_fields(output.ptr, output.len, output.cap) };
    }

    #[test]
    fn pipeline_validation_rejects_invalid_json() {
        let input = b"not-json";
        let mut output = IecodeBytes::default();
        assert_eq!(
            unsafe { iecode_pipeline_validate_json(input.as_ptr(), input.len(), &mut output) },
            3
        );
        assert!(output.len > 0);
        unsafe { iecode_bytes_free_fields(output.ptr, output.len, output.cap) };
    }
}
