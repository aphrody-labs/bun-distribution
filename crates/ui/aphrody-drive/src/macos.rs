// SPDX-License-Identifier: FSL-1.1-ALv2
// Derived from Spacedrive (drive/apps/tauri/crates/macos/src/lib.rs), adopted as the Aphrody Drive
// file explorer.
//! macOS bridge to the `aphrody-drive-macos` Swift package (`macos/desktop/src-swift`): native
//! drag sessions with an overlay window, the transparent titlebar, the share sheet.

use std::sync::OnceLock;

use swift_rs::{Bool, SRString, swift};

/// An `NSWindow *` / `NSView *` handed to Swift.
pub(crate) type NSObject = *mut std::ffi::c_void;

swift!(pub(crate) fn set_titlebar_style(window: &NSObject, is_fullscreen: Bool));
swift!(pub(crate) fn share_items(paths: &SRString) -> Bool);
swift!(pub(crate) fn begin_native_drag(
    window: &NSObject,
    items: &SRString,
    overlay_window: &NSObject,
    session_id: &SRString
) -> Bool);
swift!(pub(crate) fn end_native_drag(session_id: &SRString));

type DragEndedCallback = Box<dyn Fn(&str, bool) + Send + Sync>;

static DRAG_ENDED_CALLBACK: OnceLock<DragEndedCallback> = OnceLock::new();

/// Register the handler Swift calls when a native drag session ends (first registration wins).
pub(crate) fn set_drag_ended_callback(callback: impl Fn(&str, bool) + Send + Sync + 'static) {
    let _ = DRAG_ENDED_CALLBACK.set(Box::new(callback));
}

/// Called from Swift (`drag.swift`) when a drag session ends.
///
/// # Safety
/// `session_id` must be a valid NUL-terminated C string for the duration of the call.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn rust_drag_ended_callback(
    session_id: *const std::ffi::c_char,
    was_dropped: Bool,
) {
    // SAFETY: guaranteed by the caller (Swift passes `withCString`).
    let session_id = unsafe { std::ffi::CStr::from_ptr(session_id) }.to_string_lossy().into_owned();
    if let Some(callback) = DRAG_ENDED_CALLBACK.get() {
        callback(&session_id, was_dropped);
    }
}
