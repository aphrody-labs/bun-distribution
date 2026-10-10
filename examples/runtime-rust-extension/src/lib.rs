// SPDX-License-Identifier: Apache-2.0
//! Minimal consumer of the yolo_* ABI published in `aphrody.h`. No engine rlib is linked.

use std::ptr;

/// Library-owned buffer from `aphrody.h`; release through the same SDK.
#[repr(C)]
pub struct YoloBuffer {
    pub data: *mut u8,
    pub len: usize,
    pub cap: usize,
}

unsafe extern "C" {
    fn yolo_abi_version() -> u32;
    fn yolo_system_stats(runtime: u64, output: *mut YoloBuffer) -> i32;
}

fn compatible(version: u32) -> bool {
    version >> 16 == 1 && version & 0xffff >= 4
}

/// Read native statistics using a runtime owned by the caller.
///
/// Returns the SDK status, or ABI_MISMATCH (2) / INVALID_ARGUMENT (1) before
/// invoking a resource API. The extension neither creates nor destroys the runtime.
///
/// # Safety
/// `output` must point to a writable, aligned, empty `YoloBuffer` for this call.
/// The caller must keep a live runtime handle and SDK loaded until the returned
/// buffer is released with that SDK's `yolo_buffer_free`.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn yolo_extension_system_stats(runtime: u64, output: *mut YoloBuffer) -> i32 {
    if output.is_null() || runtime == 0 {
        return 1;
    }
    // SAFETY: this SDK query has no arguments or resource ownership requirement.
    if !compatible(unsafe { yolo_abi_version() }) {
        return 2;
    }
    // SAFETY: the caller guarantees the output buffer's lifetime and validity.
    unsafe { yolo_system_stats(runtime, output) }
}

impl Default for YoloBuffer {
    fn default() -> Self {
        Self { data: ptr::null_mut(), len: 0, cap: 0 }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn negotiates_before_resource_calls() {
        assert!(compatible((1 << 16) | 4));
        assert!(compatible((1 << 16) | 5));
        assert!(!compatible((1 << 16) | 3));
        assert!(!compatible((2 << 16) | 4));
        assert!(!compatible(0));
    }

    #[test]
    fn refuses_missing_runtime_or_output() {
        let mut output = YoloBuffer::default();
        // SAFETY: no SDK resource call occurs for invalid arguments.
        unsafe {
            assert_eq!(yolo_extension_system_stats(0, &mut output), 1);
            assert_eq!(yolo_extension_system_stats(1, ptr::null_mut()), 1);
        }
        assert!(output.data.is_null());
    }
}
