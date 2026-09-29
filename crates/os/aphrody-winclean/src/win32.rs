// SPDX-License-Identifier: Apache-2.0
//! Shared plumbing for the native Win32 backends: UTF-16 strings, Win32/HRESULT error mapping
//! and a scoped COM apartment. Every WinClean tool that used to spawn `reg.exe`, `sc.exe`,
//! `netstat`, `wevtutil`, `powershell.exe`, `where.exe` or `explorer.exe` now calls the
//! documented API in-process through these helpers.

use std::io;

use windows::{
    Win32::{
        Foundation::{
            ERROR_ACCESS_DENIED, ERROR_EVT_CHANNEL_NOT_FOUND, ERROR_EVT_INVALID_QUERY,
            ERROR_EVT_PUBLISHER_METADATA_NOT_FOUND, ERROR_SERVICE_DOES_NOT_EXIST,
            RPC_E_CHANGED_MODE, WIN32_ERROR,
        },
        System::Com::{COINIT, CoInitializeEx, CoUninitialize},
    },
    core::PCWSTR,
};

/// NUL-terminated UTF-16 copy of `value`, for `PCWSTR` parameters.
pub(crate) fn wide(value: &str) -> Vec<u16> {
    value.encode_utf16().chain(std::iter::once(0)).collect()
}

/// Borrow a NUL-terminated UTF-16 buffer produced by [`wide`] as a `PCWSTR`.
pub(crate) fn pcwstr(buffer: &[u16]) -> PCWSTR {
    debug_assert_eq!(buffer.last(), Some(&0), "PCWSTR buffers must be NUL-terminated");
    PCWSTR(buffer.as_ptr())
}

/// Decode UTF-16 up to the first NUL (or the whole slice when there is none).
pub(crate) fn from_wide(units: &[u16]) -> String {
    let end = units.iter().position(|&unit| unit == 0).unwrap_or(units.len());
    String::from_utf16_lossy(&units[..end])
}

/// Decode a NUL-terminated UTF-16 pointer; null pointers decode to an empty string.
///
/// # Safety
/// `pointer` must be null or point to a readable, NUL-terminated UTF-16 string.
pub(crate) unsafe fn from_wide_ptr(pointer: *const u16) -> String {
    if pointer.is_null() {
        return String::new();
    }
    // SAFETY: guaranteed by the caller.
    let length = unsafe { (0..).take_while(|&index| *pointer.add(index) != 0).count() };
    // SAFETY: `length` units were just read from the same allocation.
    String::from_utf16_lossy(unsafe { std::slice::from_raw_parts(pointer, length) })
}

fn kind_for(code: u32) -> Option<io::ErrorKind> {
    Some(match WIN32_ERROR(code) {
        ERROR_SERVICE_DOES_NOT_EXIST
        | ERROR_EVT_CHANNEL_NOT_FOUND
        | ERROR_EVT_PUBLISHER_METADATA_NOT_FOUND => io::ErrorKind::NotFound,
        ERROR_EVT_INVALID_QUERY => io::ErrorKind::InvalidInput,
        ERROR_ACCESS_DENIED => io::ErrorKind::PermissionDenied,
        _ => return None,
    })
}

/// Map a Win32 error code to an [`io::Error`] carrying the system message and `context`.
pub(crate) fn win32_error(code: WIN32_ERROR, context: &str) -> io::Error {
    let os = io::Error::from_raw_os_error(code.0 as i32);
    let kind = kind_for(code.0).unwrap_or_else(|| os.kind());
    io::Error::new(kind, format!("{context}: {os}"))
}

/// Map a `windows::core::Error` (HRESULT) to an [`io::Error`], unwrapping `HRESULT_FROM_WIN32`.
pub(crate) fn hresult_error(error: &windows::core::Error, context: &str) -> io::Error {
    let hr = error.code().0 as u32;
    if hr & 0xFFFF_0000 == 0x8007_0000 {
        return win32_error(WIN32_ERROR(hr & 0xFFFF), context);
    }
    io::Error::other(format!("{context}: {} (HRESULT 0x{hr:08X})", error.message()))
}

/// Win32 error code carried by a `windows::core::Error`, when it wraps one.
pub(crate) fn win32_code(error: &windows::core::Error) -> Option<WIN32_ERROR> {
    let hr = error.code().0 as u32;
    (hr & 0xFFFF_0000 == 0x8007_0000).then_some(WIN32_ERROR(hr & 0xFFFF))
}

/// A COM apartment entered for the current thread and left on drop.
///
/// When the thread already lives in an apartment of the other model (`RPC_E_CHANGED_MODE`) the
/// existing apartment is reused and nothing is uninitialised on drop.
pub(crate) struct ComScope {
    initialized: bool,
}

impl ComScope {
    pub(crate) fn enter(model: COINIT) -> io::Result<Self> {
        // SAFETY: plain COM initialisation for the calling thread; balanced in `Drop`.
        let hr = unsafe { CoInitializeEx(None, model) };
        if hr.is_ok() {
            Ok(Self { initialized: true })
        } else if hr == RPC_E_CHANGED_MODE {
            Ok(Self { initialized: false })
        } else {
            Err(io::Error::other(format!("CoInitializeEx failed: HRESULT 0x{:08X}", hr.0 as u32)))
        }
    }
}

impl Drop for ComScope {
    fn drop(&mut self) {
        if self.initialized {
            // SAFETY: balances the successful `CoInitializeEx` of `enter` on this thread.
            unsafe { CoUninitialize() };
        }
    }
}

#[cfg(test)]
mod tests {
    use windows::Win32::Foundation::{ERROR_ACCESS_DENIED, ERROR_SERVICE_DOES_NOT_EXIST};

    use super::{from_wide, from_wide_ptr, wide, win32_error};

    #[test]
    fn utf16_round_trip_stops_at_nul() {
        let buffer = wide("clé\u{1F600}");
        assert_eq!(buffer.last(), Some(&0));
        assert_eq!(from_wide(&buffer), "clé\u{1F600}");
        // SAFETY: `buffer` is NUL-terminated.
        assert_eq!(unsafe { from_wide_ptr(buffer.as_ptr()) }, "clé\u{1F600}");
        // SAFETY: null pointers are accepted.
        assert_eq!(unsafe { from_wide_ptr(std::ptr::null()) }, "");
    }

    #[test]
    fn win32_errors_keep_their_kind() {
        assert_eq!(
            win32_error(ERROR_SERVICE_DOES_NOT_EXIST, "open").kind(),
            std::io::ErrorKind::NotFound
        );
        assert_eq!(
            win32_error(ERROR_ACCESS_DENIED, "open").kind(),
            std::io::ErrorKind::PermissionDenied
        );
    }
}
