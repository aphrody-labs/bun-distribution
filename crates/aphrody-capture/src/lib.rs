// SPDX-License-Identifier: Apache-2.0
//! `aphrody-capture` — native Windows screen and window capture to PNG.
//!
//! Uses the Win32 GDI BitBlt pipeline (GetDC / CreateCompatibleDC /
//! CreateCompatibleBitmap / BitBlt / GetDIBits) to capture pixels, converts
//! the BGRA buffer to RGBA, and encodes it as PNG via the `image` crate. The [`gpu`] module
//! captures windows on the GPU through Windows.Graphics.Capture and observes frame pacing.
//!
//! # Platform gating
//!
//! All capture logic is `#[cfg(windows)]`.  On non-Windows targets every
//! public function returns [`CaptureError::Unsupported`].
//!
//! # Example
//!
//! ```no_run
//! # #[cfg(windows)]
//! # {
//! use aphrody_capture::capture_primary_screen;
//! let png_bytes = capture_primary_screen().expect("capture failed");
//! std::fs::write("screen.png", &png_bytes).unwrap();
//! # }
//! ```

#![deny(unsafe_op_in_unsafe_fn)]

mod error;
pub use error::CaptureError;

/// Convenience `Result` alias.
pub type Result<T> = std::result::Result<T, CaptureError>;

/// Metadata for an enumerated top-level window.
#[derive(Debug, Clone)]
pub struct WindowInfo {
    /// Window title text.
    pub title: String,
    /// Raw HWND value cast to `usize` (opaque handle, not dereferenced outside
    /// of this crate).
    pub handle: usize,
}

/// Detailed visible top-level window metadata shared by computer-use callers.
#[derive(Debug, Clone)]
pub struct DetailedWindowInfo {
    pub handle: usize,
    pub process_id: u32,
    pub title: String,
    pub x: i32,
    pub y: i32,
    pub width: i32,
    pub height: i32,
    pub is_foreground: bool,
}

/// Raw top-down BGRA frame of the virtual screen (no encoding).
#[derive(Debug, Clone)]
pub struct RawFrame {
    pub origin_x: i32,
    pub origin_y: i32,
    pub width: u32,
    pub height: u32,
    pub bgra: Vec<u8>,
}

// ─── platform impl ──────────────────────────────────────────────────────────

#[cfg(windows)]
mod capture_impl;
/// GPU window capture (Windows.Graphics.Capture on Direct3D 11) and frame pacing.
#[cfg(windows)]
pub mod gpu;

// ─── public API — Windows ────────────────────────────────────────────────────

/// Capture the primary monitor (SM_CXSCREEN × SM_CYSCREEN) to PNG bytes.
///
/// Returns the complete PNG-encoded image as a `Vec<u8>`.
#[cfg(windows)]
pub fn capture_primary_screen() -> Result<Vec<u8>> {
    capture_impl::capture_primary_screen()
}

/// Capture the full virtual screen spanning all monitors to PNG bytes.
///
/// Uses `SM_XVIRTUALSCREEN`, `SM_YVIRTUALSCREEN`, `SM_CXVIRTUALSCREEN`,
/// `SM_CYVIRTUALSCREEN`.
#[cfg(windows)]
pub fn capture_virtual_screen() -> Result<Vec<u8>> {
    capture_impl::capture_virtual_screen()
}

/// Find the first visible window whose title contains `substr` (case-sensitive)
/// and capture its full window to PNG bytes.
///
/// Uses `GetWindowRect` on the matched HWND to determine the region, then
/// renders the exact window with PrintWindow at physical pixel resolution.
///
/// # Errors
///
/// Returns [`CaptureError::NotFound`] when no window title matches.
#[cfg(windows)]
pub fn capture_window_by_title(substr: &str) -> Result<Vec<u8>> {
    capture_impl::capture_window_by_title(substr)
}

/// Render an exact HWND at physical pixel resolution, excluding overlapping windows.
#[cfg(windows)]
pub fn capture_window(handle: usize) -> Result<Vec<u8>> {
    capture_impl::capture_window(handle)
}
#[cfg(not(windows))]
pub fn capture_window(_handle: usize) -> Result<Vec<u8>> {
    Err(CaptureError::Unsupported)
}

/// Enumerate all visible top-level windows that have a non-empty title.
///
/// The returned order matches `EnumWindows` (Z-order, top-most first).
#[cfg(windows)]
pub fn list_windows() -> Vec<WindowInfo> {
    capture_impl::list_windows()
}

#[cfg(windows)]
pub fn list_detailed_windows() -> Vec<DetailedWindowInfo> {
    capture_impl::list_detailed_windows()
}

#[cfg(windows)]
pub fn window_text(handle: usize) -> Result<String> {
    capture_impl::window_text(handle)
}
#[cfg(windows)]
pub fn close_window(handle: usize) -> Result<()> {
    capture_impl::close_window(handle)
}
#[cfg(windows)]
pub fn move_window(handle: usize, x: i32, y: i32, width: i32, height: i32) -> Result<()> {
    capture_impl::move_window(handle, x, y, width, height)
}
#[cfg(windows)]
pub fn set_window_text(handle: usize, text: &str) -> Result<()> {
    capture_impl::set_window_text(handle, text)
}
#[cfg(windows)]
pub fn set_topmost(handle: usize, topmost: bool) -> Result<()> {
    capture_impl::set_topmost(handle, topmost)
}
#[cfg(windows)]
pub fn switch_to_window(handle: usize) -> Result<()> {
    capture_impl::switch_to_window(handle)
}
#[cfg(windows)]
pub fn enum_children(parent: usize) -> Vec<(usize, String)> {
    capture_impl::enum_children(parent)
}
#[cfg(windows)]
pub fn window_class(handle: usize) -> Result<String> {
    capture_impl::window_class(handle)
}
#[cfg(windows)]
pub fn post_message(handle: usize, msg: u32, wparam: usize, lparam: isize) -> Result<()> {
    capture_impl::post_message(handle, msg, wparam, lparam)
}
#[cfg(windows)]
pub fn send_message(handle: usize, msg: u32, wparam: usize, lparam: isize) -> isize {
    capture_impl::send_message(handle, msg, wparam, lparam)
}
#[cfg(windows)]
pub fn minimize_all() -> Result<()> {
    capture_impl::minimize_all()
}
#[cfg(windows)]
pub fn set_opacity(handle: usize, alpha: u8, click_through: bool) -> Result<()> {
    capture_impl::set_opacity(handle, alpha, click_through)
}
#[cfg(windows)]
pub fn mouse_move(x: i32, y: i32) -> Result<()> {
    capture_impl::mouse_move(x, y)
}
#[cfg(windows)]
pub fn mouse_click(button: &str, clicks: u32) -> Result<()> {
    capture_impl::mouse_click(button, clicks)
}
/// Capture the full virtual screen as raw BGRA pixels.
#[cfg(windows)]
pub fn capture_virtual_screen_raw() -> Result<RawFrame> {
    capture_impl::capture_virtual_screen_raw()
}
/// Press (`down`) or release a mouse button (`left`, `right`, `middle`).
#[cfg(windows)]
pub fn mouse_button(button: &str, down: bool) -> Result<()> {
    capture_impl::mouse_button(button, down)
}
/// Raw wheel deltas (120 per notch); `dy` vertical, `dx` horizontal.
#[cfg(windows)]
pub fn mouse_wheel(dx: i32, dy: i32) -> Result<()> {
    capture_impl::mouse_wheel(dx, dy)
}
#[cfg(windows)]
pub fn mouse_scroll(axis: &str, direction: &str, times: u32) -> Result<()> {
    capture_impl::mouse_scroll(axis, direction, times)
}
#[cfg(windows)]
pub fn type_unicode(text: &str) -> Result<()> {
    capture_impl::type_unicode(text)
}
#[cfg(windows)]
pub fn key_scan(scan: u16, action: &str, extended: bool) -> Result<()> {
    capture_impl::key_scan(scan, action, extended)
}
/// Relative mouse motion through `SendInput` (`MOUSEEVENTF_MOVE` without `ABSOLUTE`): games that
/// read raw input receive exactly `(dx, dy)` counts.
#[cfg(windows)]
pub fn mouse_move_relative(dx: i32, dy: i32) -> Result<()> {
    capture_impl::mouse_move_relative(dx, dy)
}
/// Mouse button down/up through `SendInput`.
#[cfg(windows)]
pub fn mouse_button_input(button: &str, down: bool) -> Result<()> {
    capture_impl::mouse_button_input(button, down)
}
#[cfg(windows)]
pub fn key_vk(vk: u8, down: bool) -> Result<()> {
    capture_impl::key_vk(vk, down)
}
#[cfg(windows)]
pub fn key_shortcut(shortcut: &str) -> Result<()> {
    capture_impl::key_shortcut(shortcut)
}
#[cfg(windows)]
pub fn key_shortcut_unrestricted(shortcut: &str) -> Result<()> {
    capture_impl::key_shortcut_unrestricted(shortcut)
}
#[cfg(windows)]
pub fn mouse_drag(
    x1: i32,
    y1: i32,
    x2: i32,
    y2: i32,
    button: &str,
    steps: u32,
    duration_ms: u64,
) -> Result<()> {
    capture_impl::mouse_drag(x1, y1, x2, y2, button, steps, duration_ms)
}

// ─── public API — non-Windows stubs ─────────────────────────────────────────

/// Capture the primary monitor.  Returns [`CaptureError::Unsupported`] on
/// non-Windows targets.
#[cfg(not(windows))]
pub fn capture_primary_screen() -> Result<Vec<u8>> {
    Err(CaptureError::Unsupported)
}

/// Capture the virtual screen.  Returns [`CaptureError::Unsupported`] on
/// non-Windows targets.
#[cfg(not(windows))]
pub fn capture_virtual_screen() -> Result<Vec<u8>> {
    Err(CaptureError::Unsupported)
}

/// Find and capture a window by title substring.  Returns
/// [`CaptureError::Unsupported`] on non-Windows targets.
#[cfg(not(windows))]
pub fn capture_window_by_title(_substr: &str) -> Result<Vec<u8>> {
    Err(CaptureError::Unsupported)
}

/// Enumerate visible windows.  Returns an empty `Vec` on non-Windows targets.
#[cfg(not(windows))]
pub fn list_windows() -> Vec<WindowInfo> {
    Vec::new()
}

#[cfg(not(windows))]
pub fn list_detailed_windows() -> Vec<DetailedWindowInfo> {
    Vec::new()
}

#[cfg(not(windows))]
pub fn window_text(_handle: usize) -> Result<String> {
    Err(CaptureError::Unsupported)
}
#[cfg(not(windows))]
pub fn close_window(_handle: usize) -> Result<()> {
    Err(CaptureError::Unsupported)
}
#[cfg(not(windows))]
pub fn move_window(_handle: usize, _x: i32, _y: i32, _width: i32, _height: i32) -> Result<()> {
    Err(CaptureError::Unsupported)
}
#[cfg(not(windows))]
pub fn set_window_text(_handle: usize, _text: &str) -> Result<()> {
    Err(CaptureError::Unsupported)
}
#[cfg(not(windows))]
pub fn set_topmost(_handle: usize, _topmost: bool) -> Result<()> {
    Err(CaptureError::Unsupported)
}
#[cfg(not(windows))]
pub fn switch_to_window(_handle: usize) -> Result<()> {
    Err(CaptureError::Unsupported)
}
#[cfg(not(windows))]
pub fn enum_children(_parent: usize) -> Vec<(usize, String)> {
    Vec::new()
}
#[cfg(not(windows))]
pub fn window_class(_handle: usize) -> Result<String> {
    Err(CaptureError::Unsupported)
}
#[cfg(not(windows))]
pub fn post_message(_handle: usize, _msg: u32, _wparam: usize, _lparam: isize) -> Result<()> {
    Err(CaptureError::Unsupported)
}
#[cfg(not(windows))]
pub fn send_message(_handle: usize, _msg: u32, _wparam: usize, _lparam: isize) -> isize {
    0
}
#[cfg(not(windows))]
pub fn minimize_all() -> Result<()> {
    Err(CaptureError::Unsupported)
}
#[cfg(not(windows))]
pub fn set_opacity(_handle: usize, _alpha: u8, _click_through: bool) -> Result<()> {
    Err(CaptureError::Unsupported)
}
#[cfg(not(windows))]
pub fn mouse_move(_x: i32, _y: i32) -> Result<()> {
    Err(CaptureError::Unsupported)
}
#[cfg(not(windows))]
pub fn mouse_click(_button: &str, _clicks: u32) -> Result<()> {
    Err(CaptureError::Unsupported)
}
#[cfg(not(windows))]
pub fn capture_virtual_screen_raw() -> Result<RawFrame> {
    Err(CaptureError::Unsupported)
}
#[cfg(not(windows))]
pub fn mouse_button(_button: &str, _down: bool) -> Result<()> {
    Err(CaptureError::Unsupported)
}
#[cfg(not(windows))]
pub fn mouse_wheel(_dx: i32, _dy: i32) -> Result<()> {
    Err(CaptureError::Unsupported)
}
#[cfg(not(windows))]
pub fn mouse_scroll(_axis: &str, _direction: &str, _times: u32) -> Result<()> {
    Err(CaptureError::Unsupported)
}
#[cfg(not(windows))]
pub fn type_unicode(_text: &str) -> Result<()> {
    Err(CaptureError::Unsupported)
}
#[cfg(not(windows))]
pub fn key_scan(_scan: u16, _action: &str, _extended: bool) -> Result<()> {
    Err(CaptureError::Unsupported)
}
#[cfg(not(windows))]
pub fn mouse_move_relative(_dx: i32, _dy: i32) -> Result<()> {
    Err(CaptureError::Unsupported)
}
#[cfg(not(windows))]
pub fn mouse_button_input(_button: &str, _down: bool) -> Result<()> {
    Err(CaptureError::Unsupported)
}
#[cfg(not(windows))]
pub fn key_vk(_vk: u8, _down: bool) -> Result<()> {
    Err(CaptureError::Unsupported)
}
#[cfg(not(windows))]
pub fn key_shortcut(_shortcut: &str) -> Result<()> {
    Err(CaptureError::Unsupported)
}
#[cfg(not(windows))]
pub fn key_shortcut_unrestricted(_shortcut: &str) -> Result<()> {
    Err(CaptureError::Unsupported)
}
#[cfg(not(windows))]
pub fn mouse_drag(
    _x1: i32,
    _y1: i32,
    _x2: i32,
    _y2: i32,
    _button: &str,
    _steps: u32,
    _duration_ms: u64,
) -> Result<()> {
    Err(CaptureError::Unsupported)
}

// ─── pure helper (all platforms) ─────────────────────────────────────────────

/// Convert a mutable BGRA byte slice in-place to RGBA.
///
/// The Win32 GDI produces pixels in `[B, G, R, A]` order.  This swaps the
/// blue and red channels and forces alpha to `0xFF` (the alpha byte returned
/// by `GetDIBits` for a 32 bpp RGB bitmap is always 0 and must be fixed up).
///
/// # Panics
///
/// Panics if `buf.len()` is not a multiple of 4.
///
/// # Example
///
/// ```
/// use aphrody_capture::bgra_to_rgba;
/// let mut px = [0xBB_u8, 0x00, 0xFF, 0x00]; // B=0xBB, G=0x00, R=0xFF, A=0x00
/// bgra_to_rgba(&mut px);
/// assert_eq!(px, [0xFF, 0x00, 0xBB, 0xFF]); // R=0xFF, G=0x00, B=0xBB, A=0xFF
/// ```
pub fn bgra_to_rgba(buf: &mut [u8]) {
    assert!(
        buf.len().is_multiple_of(4),
        "bgra_to_rgba: buffer length must be a multiple of 4"
    );
    for px in buf.as_chunks_mut::<4>().0 {
        px.swap(0, 2); // swap B <-> R
        px[3] = 0xFF; // fix up alpha
    }
}

// ─── tests ───────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bgra_single_pixel() {
        let mut buf = [0x12_u8, 0x34, 0x56, 0x00]; // B=0x12, G=0x34, R=0x56, A=0
        bgra_to_rgba(&mut buf);
        assert_eq!(buf, [0x56, 0x34, 0x12, 0xFF]); // R=0x56, G=0x34, B=0x12, A=0xFF
    }

    #[test]
    fn bgra_four_pixels() {
        let mut buf: Vec<u8> = vec![
            0xFF, 0x00, 0x00, 0x00, // blue pixel: B=0xFF, G=0, R=0, A=0
            0x00, 0xFF, 0x00, 0x00, // green pixel
            0x00, 0x00, 0xFF, 0x00, // red pixel
            0x80, 0x80, 0x80, 0x00, // grey pixel
        ];
        bgra_to_rgba(&mut buf);
        // blue pixel -> R=0, G=0, B=0xFF
        assert_eq!(&buf[0..4], &[0x00, 0x00, 0xFF, 0xFF]);
        // green pixel -> R=0, G=0xFF, B=0
        assert_eq!(&buf[4..8], &[0x00, 0xFF, 0x00, 0xFF]);
        // red pixel -> R=0xFF, G=0, B=0
        assert_eq!(&buf[8..12], &[0xFF, 0x00, 0x00, 0xFF]);
        // grey pixel unchanged hue
        assert_eq!(&buf[12..16], &[0x80, 0x80, 0x80, 0xFF]);
    }

    #[test]
    fn bgra_all_zeros_sets_alpha() {
        let mut buf = [0u8; 8];
        bgra_to_rgba(&mut buf);
        assert!(buf.iter().step_by(4).skip(3).all(|&a| a == 0xFF));
    }

    #[test]
    #[should_panic(expected = "multiple of 4")]
    fn bgra_odd_length_panics() {
        bgra_to_rgba(&mut [0u8; 3]);
    }

    #[test]
    fn unsupported_on_non_windows() {
        // On non-Windows the functions compile to stubs.
        #[cfg(not(windows))]
        {
            assert!(matches!(
                capture_primary_screen(),
                Err(CaptureError::Unsupported)
            ));
            assert!(matches!(
                capture_virtual_screen(),
                Err(CaptureError::Unsupported)
            ));
            assert!(matches!(
                capture_window_by_title("anything"),
                Err(CaptureError::Unsupported)
            ));
            assert!(list_windows().is_empty());
        }
        #[cfg(windows)]
        {
            // On Windows we can't assert success (might be headless CI), but
            // the functions exist and the Unsupported variant is not returned.
            let _ = list_windows(); // must not panic
        }
    }

    #[test]
    fn error_display_not_found() {
        let e = CaptureError::NotFound("notepad".to_owned());
        let s = e.to_string();
        assert!(s.contains("notepad"));
    }

    #[test]
    fn error_display_win32() {
        let e = CaptureError::Win32("GetDC returned NULL".to_owned());
        assert!(e.to_string().contains("GetDC"));
    }
}
