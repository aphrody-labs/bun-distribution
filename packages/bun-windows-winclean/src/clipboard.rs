// SPDX-License-Identifier: Apache-2.0
//! Clipboard text through the Win32 clipboard API (`OpenClipboard`, `GetClipboardData`,
//! `SetClipboardData` with `CF_UNICODETEXT`). No PowerShell process is started.
//!
//! The clipboard is a single, system-wide lock: another process can hold it for a few
//! milliseconds, in which case `OpenClipboard` fails with `ERROR_ACCESS_DENIED`. Opening is
//! therefore retried with a short backoff before the call reports the clipboard as busy.

use std::io;

/// Read the Unicode text currently on the clipboard. An empty string means the clipboard holds
/// no text.
pub fn get_clipboard_text() -> io::Result<String> {
    imp::get_text()
}

/// Replace the clipboard content with `text` (as `CF_UNICODETEXT`).
pub fn set_clipboard_text(text: &str) -> io::Result<String> {
    if text.contains('\0') {
        return Err(io::Error::new(io::ErrorKind::InvalidInput, "clipboard text contains NUL"));
    }
    imp::set_text(text)?;
    Ok(format!("Copied {} characters to the clipboard.", text.chars().count()))
}

#[cfg(windows)]
mod imp {
    use std::{io, time::Duration};

    use windows::Win32::{
        Foundation::{GlobalFree, HANDLE, HGLOBAL},
        System::{
            DataExchange::{
                CloseClipboard, EmptyClipboard, GetClipboardData, IsClipboardFormatAvailable,
                OpenClipboard, SetClipboardData,
            },
            Memory::{GMEM_MOVEABLE, GlobalAlloc, GlobalLock, GlobalSize, GlobalUnlock},
            Ole::CF_UNICODETEXT,
        },
    };

    use crate::win32::{from_wide, hresult_error};

    /// Attempts to open the clipboard before reporting it as busy (about one second in total).
    const OPEN_ATTEMPTS: u32 = 20;

    /// The clipboard is open for this thread until the guard is dropped.
    struct OpenGuard;

    impl OpenGuard {
        fn open() -> io::Result<Self> {
            let mut last_error = None;
            for attempt in 0..OPEN_ATTEMPTS {
                // SAFETY: no owner window; the clipboard is closed again by `Drop`.
                match unsafe { OpenClipboard(None) } {
                    Ok(()) => return Ok(Self),
                    Err(error) => {
                        last_error = Some(error);
                        std::thread::sleep(Duration::from_millis(
                            10 * u64::from(attempt.min(9) + 1),
                        ));
                    },
                }
            }
            let detail = last_error.map(|error| error.message()).unwrap_or_default();
            Err(io::Error::new(
                io::ErrorKind::ResourceBusy,
                format!("clipboard is held by another process: {detail}"),
            ))
        }
    }

    impl Drop for OpenGuard {
        fn drop(&mut self) {
            // SAFETY: the clipboard was opened by `OpenGuard::open` on this thread.
            let _ = unsafe { CloseClipboard() };
        }
    }

    fn format() -> u32 {
        u32::from(CF_UNICODETEXT.0)
    }

    pub(super) fn get_text() -> io::Result<String> {
        let _open = OpenGuard::open()?;
        // SAFETY: the clipboard is open.
        if unsafe { IsClipboardFormatAvailable(format()) }.is_err() {
            return Ok(String::new());
        }
        // SAFETY: the clipboard is open and the format is available.
        let handle = unsafe { GetClipboardData(format()) }
            .map_err(|error| hresult_error(&error, "GetClipboardData"))?;
        let memory = HGLOBAL(handle.0);
        // SAFETY: `memory` is the clipboard-owned global memory block of the text.
        let pointer = unsafe { GlobalLock(memory) }.cast::<u16>();
        if pointer.is_null() {
            return Err(io::Error::last_os_error());
        }
        // SAFETY: the block is locked and `GlobalSize` bytes are readable.
        let text = unsafe {
            let units = GlobalSize(memory) / std::mem::size_of::<u16>();
            from_wide(std::slice::from_raw_parts(pointer, units))
        };
        // SAFETY: balances the `GlobalLock` above. The API reports an "error" with code 0 when
        // the lock count reaches zero, which is the expected outcome.
        let _ = unsafe { GlobalUnlock(memory) };
        Ok(text)
    }

    pub(super) fn set_text(text: &str) -> io::Result<()> {
        let units: Vec<u16> = text.encode_utf16().chain(std::iter::once(0)).collect();
        let bytes = units.len() * std::mem::size_of::<u16>();
        let _open = OpenGuard::open()?;
        // SAFETY: the clipboard is open.
        unsafe { EmptyClipboard() }.map_err(|error| hresult_error(&error, "EmptyClipboard"))?;
        // SAFETY: plain movable allocation, ownership passes to the system on success.
        let memory = unsafe { GlobalAlloc(GMEM_MOVEABLE, bytes) }
            .map_err(|error| hresult_error(&error, "GlobalAlloc"))?;
        // SAFETY: `memory` was just allocated with `bytes` bytes.
        let pointer = unsafe { GlobalLock(memory) }.cast::<u16>();
        if pointer.is_null() {
            let error = io::Error::last_os_error();
            // SAFETY: the block is still owned by this function.
            let _ = unsafe { GlobalFree(Some(memory)) };
            return Err(error);
        }
        // SAFETY: the destination holds exactly `units.len()` UTF-16 units.
        unsafe {
            std::ptr::copy_nonoverlapping(units.as_ptr(), pointer, units.len());
            let _ = GlobalUnlock(memory);
        }
        // SAFETY: the clipboard is open and emptied; on success the system owns `memory`.
        match unsafe { SetClipboardData(format(), Some(HANDLE(memory.0))) } {
            Ok(_) => Ok(()),
            Err(error) => {
                // SAFETY: ownership did not transfer, so the block is freed here.
                let _ = unsafe { GlobalFree(Some(memory)) };
                Err(hresult_error(&error, "SetClipboardData"))
            },
        }
    }
}

#[cfg(not(windows))]
mod imp {
    use std::io;

    pub(super) fn get_text() -> io::Result<String> {
        Err(io::Error::new(io::ErrorKind::Unsupported, "clipboard is Windows-only"))
    }

    pub(super) fn set_text(_text: &str) -> io::Result<()> {
        Err(io::Error::new(io::ErrorKind::Unsupported, "clipboard is Windows-only"))
    }
}

#[cfg(test)]
mod tests {
    use super::{get_clipboard_text, set_clipboard_text};

    #[test]
    fn text_with_nul_is_rejected_before_touching_the_clipboard() {
        let error = set_clipboard_text("a\0b").expect_err("NUL must be rejected");
        assert_eq!(error.kind(), std::io::ErrorKind::InvalidInput);
    }

    #[cfg(not(windows))]
    #[test]
    fn clipboard_is_unsupported_off_windows() {
        assert_eq!(
            get_clipboard_text().expect_err("unsupported").kind(),
            std::io::ErrorKind::Unsupported
        );
    }

    #[cfg(windows)]
    #[test]
    #[ignore = "needs an interactive desktop"]
    fn clipboard_round_trip_preserves_unicode_text() {
        let previous = get_clipboard_text().expect("read the current clipboard");
        let sample =
            format!("aphrody clipboard \u{e9}\u{1F600} {}\r\nline two", std::process::id());
        let message = set_clipboard_text(&sample).expect("write the clipboard");
        assert!(message.starts_with("Copied "));
        let read = get_clipboard_text().expect("read the clipboard back");
        // Restore what the user had before asserting, so a failure does not eat their data.
        if !previous.is_empty() {
            set_clipboard_text(&previous).expect("restore the previous clipboard text");
        }
        assert_eq!(read, sample);
    }
}
