// SPDX-License-Identifier: Apache-2.0
//! Windows GDI capture implementation.
//!
//! Follows the Microsoft Learn "Capturing an Image" example (Win32 C→Rust
//! port).  All GDI handles are wrapped in RAII guards so they are released
//! even on early-return error paths.
//!
//! # Safety invariants (module-wide)
//!
//! * Every `unsafe` block calls exactly one foreign function whose preconditions are documented
//!   inline.
//! * GDI handles are never stored in `&` references; ownership passes through the RAII guards.
//! * `HWND` values that arrive via `EnumWindows` callback are valid for the duration of the
//!   callback; after it returns they are only used as an opaque `usize` in `WindowInfo`.

#![deny(unsafe_op_in_unsafe_fn)]

use std::mem;

use windows::Win32::{
    Foundation::{HWND, LPARAM, RECT},
    Graphics::Gdi::{
        BI_RGB, BITMAPINFO, BITMAPINFOHEADER, BitBlt, CreateCompatibleBitmap, CreateCompatibleDC,
        DIB_RGB_COLORS, DeleteDC, DeleteObject, GetDC, GetDIBits, HBITMAP, HDC, HGDIOBJ, ReleaseDC,
        SRCCOPY, SelectObject,
    },
    UI::WindowsAndMessaging::{
        EnumWindows, GetDesktopWindow, GetForegroundWindow, GetSystemMetrics, GetWindowRect,
        GetWindowTextLengthW, GetWindowTextW, GetWindowThreadProcessId, IsWindowVisible,
        SM_CXSCREEN, SM_CXVIRTUALSCREEN, SM_CYSCREEN, SM_CYVIRTUALSCREEN, SM_XVIRTUALSCREEN,
        SM_YVIRTUALSCREEN,
    },
};

use crate::{CaptureError, DetailedWindowInfo, Result, WindowInfo};

// ─── RAII guards ─────────────────────────────────────────────────────────────

/// Owns a screen DC obtained from `GetDC(hwnd)`.  Releases it on drop via
/// `ReleaseDC(hwnd, hdc)`.
struct ScreenDc {
    hwnd: Option<HWND>,
    hdc: HDC,
}

impl ScreenDc {
    /// Acquire a screen DC.
    ///
    /// # Safety
    ///
    /// `hwnd` must be `None` (desktop) or a valid top-level window handle.
    /// The returned DC is device-context for that window's client area or, for
    /// `None`, the entire screen.
    unsafe fn acquire(hwnd: Option<HWND>) -> Result<Self> {
        // Safety: GetDC(None) always succeeds on Windows; GetDC(hwnd) succeeds
        // if hwnd is a valid window handle.  NULL return indicates failure.
        let hdc = unsafe { GetDC(hwnd) };
        if hdc.is_invalid() {
            return Err(CaptureError::Win32("GetDC returned NULL".to_owned()));
        }
        Ok(Self { hwnd, hdc })
    }
}

impl Drop for ScreenDc {
    fn drop(&mut self) {
        if !self.hdc.is_invalid() {
            // Safety: hdc was obtained from GetDC(self.hwnd) and has not been
            // released yet.  self.hwnd is the same handle passed to GetDC.
            unsafe { ReleaseDC(self.hwnd, self.hdc) };
        }
    }
}

/// Owns a memory-compatible DC created with `CreateCompatibleDC`.
struct MemDc {
    hdc: HDC,
}

impl MemDc {
    /// Create a memory DC compatible with `src`.
    ///
    /// # Safety
    ///
    /// `src` must be a valid, non-released device context.
    unsafe fn create(src: HDC) -> Result<Self> {
        // Safety: src is a valid screen DC provided by the caller.
        let hdc = unsafe { CreateCompatibleDC(Some(src)) };
        if hdc.is_invalid() {
            return Err(CaptureError::Win32("CreateCompatibleDC returned NULL".to_owned()));
        }
        Ok(Self { hdc })
    }
}

impl Drop for MemDc {
    fn drop(&mut self) {
        if !self.hdc.is_invalid() {
            // Safety: hdc was created by CreateCompatibleDC and has not been
            // deleted yet.
            let _ = unsafe { DeleteDC(self.hdc) };
        }
    }
}

/// Owns a GDI bitmap created with `CreateCompatibleBitmap`.
struct CompatBitmap {
    hbm: HBITMAP,
}

impl CompatBitmap {
    /// Create a bitmap compatible with `src_dc` of dimensions `w × h`.
    ///
    /// # Safety
    ///
    /// `src_dc` must be the *screen* DC (NOT the memory DC) so the bitmap
    /// acquires colour depth information from the display device.  `w` and `h`
    /// must be positive.
    unsafe fn create(src_dc: HDC, w: i32, h: i32) -> Result<Self> {
        // Safety: src_dc is a valid screen DC; w/h are caller-validated > 0.
        let hbm = unsafe { CreateCompatibleBitmap(src_dc, w, h) };
        if hbm.is_invalid() {
            return Err(CaptureError::Win32("CreateCompatibleBitmap returned NULL".to_owned()));
        }
        Ok(Self { hbm })
    }
}

impl Drop for CompatBitmap {
    fn drop(&mut self) {
        if !self.hbm.is_invalid() {
            // Safety: hbm was created by CreateCompatibleBitmap and has not
            // been deleted yet.  HGDIOBJ conversion is safe (same pointer).
            let _ = unsafe { DeleteObject(HGDIOBJ::from(self.hbm)) };
        }
    }
}

// ─── Core blit helper ────────────────────────────────────────────────────────

/// Capture a rectangle of the screen starting at `(x, y)` with size `w × h`
/// and return it as PNG-encoded bytes.
///
/// # Safety
///
/// `screen_dc` must be a valid screen DC for the entire virtual desktop
/// (i.e. obtained from `GetDC(None)`).  `x`, `y` must be in virtual screen
/// coordinates.  `w` and `h` must be > 0.
unsafe fn blit_region_to_png(
    screen_dc: &ScreenDc,
    x: i32,
    y: i32,
    w: i32,
    h: i32,
) -> Result<Vec<u8>> {
    // Safety: forwarded from this function's contract.
    let mut buf = unsafe { blit_region_to_bgra(screen_dc, x, y, w, h)? };
    // The buffer is BGRA top-down; convert to RGBA for the `image` crate.
    crate::bgra_to_rgba(&mut buf);
    encode_rgba_to_png(&buf, w as u32, h as u32)
}

/// Blit a screen rectangle and return the raw top-down BGRA pixels.
///
/// # Safety
///
/// Same contract as [`blit_region_to_png`].
unsafe fn blit_region_to_bgra(
    screen_dc: &ScreenDc,
    x: i32,
    y: i32,
    w: i32,
    h: i32,
) -> Result<Vec<u8>> {
    // 1. Create a memory DC compatible with the screen DC.
    // Safety: screen_dc.hdc is a valid screen DC.
    let mem_dc = unsafe { MemDc::create(screen_dc.hdc)? };

    // 2. Create a colour bitmap compatible with the screen DC (NOT the memory DC — using the memory
    //    DC would yield a 1-bit monochrome bitmap).
    // Safety: screen_dc.hdc is a valid screen DC; w/h are > 0.
    let bm = unsafe { CompatBitmap::create(screen_dc.hdc, w, h)? };

    // 3. Select the bitmap into the memory DC. SelectObject returns the previously selected object;
    //    we discard it because the memory DC was freshly created and holds only a stock 1×1
    //    monochrome bitmap we do not need to restore.
    //
    // Safety: mem_dc.hdc and bm.hbm are valid and compatible handles.
    unsafe { SelectObject(mem_dc.hdc, HGDIOBJ::from(bm.hbm)) };

    // 4. Blit the requested region from the screen DC into the memory DC.
    //
    // Safety: mem_dc.hdc is the destination (valid memory DC), screen_dc.hdc
    // is the source (valid screen DC), coordinates are in-bounds for the
    // virtual desktop, SRCCOPY is a valid ROP code.
    unsafe {
        BitBlt(mem_dc.hdc, 0, 0, w, h, Some(screen_dc.hdc), x, y, SRCCOPY)
            .map_err(|e| CaptureError::Win32(format!("BitBlt failed: {e}")))?;
    }

    // 5. Set up a BITMAPINFO for a top-down 32-bpp RGB DIB. biHeight < 0 requests a top-down
    //    (natural scan-line order) bitmap.
    let mut bmi = BITMAPINFO {
        bmiHeader: BITMAPINFOHEADER {
            biSize: mem::size_of::<BITMAPINFOHEADER>() as u32,
            biWidth: w,
            biHeight: -h, // negative = top-down
            biPlanes: 1,
            biBitCount: 32,
            biCompression: BI_RGB.0, // 0 = uncompressed RGB
            biSizeImage: 0,
            biXPelsPerMeter: 0,
            biYPelsPerMeter: 0,
            biClrUsed: 0,
            biClrImportant: 0,
        },
        ..Default::default()
    };

    // 6. Allocate the pixel buffer (4 bytes per pixel, BGRA layout).
    let pixel_count = (w as usize).saturating_mul(h as usize);
    let mut buf: Vec<u8> = vec![0u8; pixel_count.saturating_mul(4)];

    // 7. Retrieve DIB bits from the memory DC into our buffer.
    //
    // Safety:
    //   * mem_dc.hdc is a valid memory DC with bm.hbm selected into it.
    //   * bm.hbm is the selected HBITMAP.
    //   * buf has exactly (w * h * 4) bytes — correct for 32-bpp DIB.
    //   * &mut bmi outlives the call.
    let rows = unsafe {
        GetDIBits(
            mem_dc.hdc,
            bm.hbm,
            0,
            h as u32,
            Some(buf.as_mut_ptr().cast()),
            &mut bmi,
            DIB_RGB_COLORS,
        )
    };
    if rows == 0 {
        return Err(CaptureError::Win32("GetDIBits returned 0 scan lines".to_owned()));
    }

    Ok(buf)
}

// ─── PNG encoding ────────────────────────────────────────────────────────────

fn encode_rgba_to_png(rgba: &[u8], w: u32, h: u32) -> Result<Vec<u8>> {
    use image::{ImageFormat, RgbaImage};
    let img = RgbaImage::from_raw(w, h, rgba.to_vec()).ok_or_else(|| {
        CaptureError::Encode("RgbaImage::from_raw: dimensions mismatch".to_owned())
    })?;
    let mut out = Vec::new();
    img.write_to(&mut std::io::Cursor::new(&mut out), ImageFormat::Png)
        .map_err(|e| CaptureError::Encode(e.to_string()))?;
    Ok(out)
}

// ─── Public capture functions ─────────────────────────────────────────────────

pub(crate) fn capture_primary_screen() -> Result<Vec<u8>> {
    // Safety: GetSystemMetrics is always safe to call; SM_* constants are valid.
    let w = unsafe { GetSystemMetrics(SM_CXSCREEN) };
    let h = unsafe { GetSystemMetrics(SM_CYSCREEN) };
    if w <= 0 || h <= 0 {
        return Err(CaptureError::Win32(
            "GetSystemMetrics(SM_CXSCREEN/SM_CYSCREEN) returned non-positive value".to_owned(),
        ));
    }
    // Safety: GetDC(None) acquires the screen DC for the entire desktop.
    let dc = unsafe { ScreenDc::acquire(None)? };
    // Safety: dc.hdc is a valid screen DC; 0,0 is the origin; w,h > 0.
    unsafe { blit_region_to_png(&dc, 0, 0, w, h) }
}

pub(crate) fn capture_virtual_screen_raw() -> Result<crate::RawFrame> {
    // Safety: GetSystemMetrics is always safe to call.
    let x = unsafe { GetSystemMetrics(SM_XVIRTUALSCREEN) };
    let y = unsafe { GetSystemMetrics(SM_YVIRTUALSCREEN) };
    let w = unsafe { GetSystemMetrics(SM_CXVIRTUALSCREEN) };
    let h = unsafe { GetSystemMetrics(SM_CYVIRTUALSCREEN) };
    if w <= 0 || h <= 0 {
        return Err(CaptureError::Win32(
            "GetSystemMetrics(SM_CXVIRTUALSCREEN/SM_CYVIRTUALSCREEN) returned non-positive value"
                .to_owned(),
        ));
    }
    // Safety: GetDC(None) acquires the screen DC.
    let dc = unsafe { ScreenDc::acquire(None)? };
    // Safety: dc.hdc is valid; w,h > 0.
    let bgra = unsafe { blit_region_to_bgra(&dc, x, y, w, h)? };
    Ok(crate::RawFrame { origin_x: x, origin_y: y, width: w as u32, height: h as u32, bgra })
}

pub(crate) fn capture_virtual_screen() -> Result<Vec<u8>> {
    // Safety: GetSystemMetrics is always safe to call.
    let x = unsafe { GetSystemMetrics(SM_XVIRTUALSCREEN) };
    let y = unsafe { GetSystemMetrics(SM_YVIRTUALSCREEN) };
    let w = unsafe { GetSystemMetrics(SM_CXVIRTUALSCREEN) };
    let h = unsafe { GetSystemMetrics(SM_CYVIRTUALSCREEN) };
    if w <= 0 || h <= 0 {
        return Err(CaptureError::Win32(
            "GetSystemMetrics(SM_CXVIRTUALSCREEN/SM_CYVIRTUALSCREEN) returned non-positive value"
                .to_owned(),
        ));
    }
    // Safety: GetDC(None) acquires the screen DC.
    let dc = unsafe { ScreenDc::acquire(None)? };
    // Safety: dc.hdc is valid; x,y are virtual-screen offsets; w,h > 0.
    unsafe { blit_region_to_png(&dc, x, y, w, h) }
}

pub(crate) fn capture_window_by_title(substr: &str) -> Result<Vec<u8>> {
    let hwnd = find_window_by_title_substr(substr)
        .ok_or_else(|| CaptureError::NotFound(substr.to_owned()))?;

    let mut rect = RECT::default();
    // Safety: hwnd was found by EnumWindows and is a valid top-level window.
    // GetWindowRect stores the window rectangle (screen coordinates) in rect.
    unsafe {
        GetWindowRect(hwnd, &mut rect)
            .map_err(|e| CaptureError::Win32(format!("GetWindowRect failed: {e}")))?;
    }

    let x = rect.left;
    let y = rect.top;
    let w = rect.right - rect.left;
    let h = rect.bottom - rect.top;

    if w <= 0 || h <= 0 {
        return Err(CaptureError::Win32(format!(
            "window '{substr}' has zero or negative dimensions ({w}×{h})"
        )));
    }

    // Capture from the screen DC (includes window decorations + any composited
    // content visible through the window rectangle).
    // Safety: GetDC(None) acquires the screen DC.
    let dc = unsafe { ScreenDc::acquire(None)? };
    // Safety: dc.hdc is valid; x,y are screen coordinates; w,h > 0.
    unsafe { blit_region_to_png(&dc, x, y, w, h) }
}

// ─── Window enumeration ───────────────────────────────────────────────────────

/// Collect all visible top-level windows with a non-empty title.
pub(crate) fn list_windows() -> Vec<WindowInfo> {
    let mut out: Vec<WindowInfo> = Vec::new();
    let ptr = &mut out as *mut Vec<WindowInfo>;

    // Safety: EnumWindows iterates every top-level window and calls our
    // callback for each.  The LPARAM carries a raw pointer to `out`; it is
    // valid for the entire duration of the EnumWindows call because `out` is
    // on the current stack frame and EnumWindows is synchronous.
    let _ = unsafe { EnumWindows(Some(enum_windows_callback), LPARAM(ptr as isize)) };

    out
}

pub(crate) fn list_detailed_windows() -> Vec<DetailedWindowInfo> {
    let mut out = Vec::new();
    let ptr = &mut out as *mut Vec<DetailedWindowInfo>;
    let _ = unsafe { EnumWindows(Some(detailed_windows_callback), LPARAM(ptr as isize)) };
    out
}

unsafe extern "system" fn detailed_windows_callback(
    hwnd: HWND,
    lparam: LPARAM,
) -> windows::core::BOOL {
    let out = unsafe { &mut *(lparam.0 as *mut Vec<DetailedWindowInfo>) };
    if !unsafe { IsWindowVisible(hwnd) }.as_bool() {
        return true.into();
    }
    let len = unsafe { GetWindowTextLengthW(hwnd) };
    if len <= 0 {
        return true.into();
    }
    let mut title_buf = vec![0u16; len as usize + 1];
    let copied = unsafe { GetWindowTextW(hwnd, &mut title_buf) };
    if copied <= 0 {
        return true.into();
    }
    title_buf.truncate(copied as usize);
    let mut rect = RECT::default();
    if unsafe { GetWindowRect(hwnd, &mut rect) }.is_err() {
        return true.into();
    }
    let mut process_id = 0u32;
    unsafe {
        GetWindowThreadProcessId(hwnd, Some(&mut process_id));
    }
    let foreground = unsafe { GetForegroundWindow() } == hwnd;
    out.push(DetailedWindowInfo {
        handle: hwnd.0 as usize,
        process_id,
        title: String::from_utf16_lossy(&title_buf),
        x: rect.left,
        y: rect.top,
        width: rect.right - rect.left,
        height: rect.bottom - rect.top,
        is_foreground: foreground,
    });
    true.into()
}

/// `EnumWindows` callback: collect visible windows with non-empty titles.
///
/// # Safety
///
/// Called by the OS.  `lparam` must be a valid `*mut Vec<WindowInfo>`.
/// `hwnd` is a valid window handle for the duration of this call.
unsafe extern "system" fn enum_windows_callback(hwnd: HWND, lparam: LPARAM) -> windows::core::BOOL {
    // Safety: lparam was set to a `*mut Vec<WindowInfo>` in list_windows().
    let out = unsafe { &mut *(lparam.0 as *mut Vec<WindowInfo>) };

    // Skip invisible windows.
    // Safety: hwnd is a valid window handle provided by EnumWindows.
    let visible = unsafe { IsWindowVisible(hwnd) };
    if !visible.as_bool() {
        return true.into();
    }

    // Query title length (excludes NUL terminator).
    // Safety: hwnd is valid.
    let len = unsafe { GetWindowTextLengthW(hwnd) };
    if len <= 0 {
        return true.into();
    }

    // Retrieve the title text.
    let mut title_buf: Vec<u16> = vec![0u16; (len as usize) + 1];
    // Safety: hwnd is valid; title_buf has capacity len+1.
    let copied = unsafe { GetWindowTextW(hwnd, &mut title_buf) };
    if copied <= 0 {
        return true.into();
    }
    title_buf.truncate(copied as usize);
    let title = String::from_utf16_lossy(&title_buf);

    out.push(WindowInfo { title, handle: hwnd.0 as usize });

    true.into() // continue enumeration
}

/// Find the first visible top-level window whose title contains `substr`.
fn find_window_by_title_substr(substr: &str) -> Option<HWND> {
    // Re-use list_windows() for simplicity; avoids a second EnumWindows
    // callback implementation.
    list_windows().into_iter().find(|w| w.title.contains(substr)).map(|w| HWND(w.handle as *mut _))
}

// suppress unused import warning for GetDesktopWindow (available for future use)
#[allow(dead_code)]
fn _desktop_window() -> HWND {
    // Safety: GetDesktopWindow always succeeds and returns the desktop HWND.
    unsafe { GetDesktopWindow() }
}

pub(crate) fn window_text(handle: usize) -> Result<String> {
    let hwnd = HWND(handle as *mut _);
    let len = unsafe { GetWindowTextLengthW(hwnd) };
    if len < 0 {
        return Err(CaptureError::Win32("GetWindowTextLengthW failed".into()));
    }
    let mut buffer = vec![0u16; len as usize + 1];
    let copied = unsafe { GetWindowTextW(hwnd, &mut buffer) };
    if copied < 0 {
        return Err(CaptureError::Win32("GetWindowTextW failed".into()));
    }
    buffer.truncate(copied as usize);
    Ok(String::from_utf16_lossy(&buffer))
}

pub(crate) fn close_window(handle: usize) -> Result<()> {
    let ok = unsafe {
        windows::Win32::UI::WindowsAndMessaging::PostMessageW(
            Some(HWND(handle as *mut _)),
            windows::Win32::UI::WindowsAndMessaging::WM_CLOSE,
            windows::Win32::Foundation::WPARAM(0),
            windows::Win32::Foundation::LPARAM(0),
        )
    };
    if ok.is_ok() {
        Ok(())
    } else {
        Err(CaptureError::Win32("PostMessageW(WM_CLOSE) failed".into()))
    }
}

pub(crate) fn move_window(handle: usize, x: i32, y: i32, width: i32, height: i32) -> Result<()> {
    let hwnd = HWND(handle as *mut _);
    let ok = unsafe {
        windows::Win32::UI::WindowsAndMessaging::SetWindowPos(
            hwnd,
            None,
            x,
            y,
            width,
            height,
            windows::Win32::UI::WindowsAndMessaging::SET_WINDOW_POS_FLAGS(0),
        )
    };
    if ok.is_ok() { Ok(()) } else { Err(CaptureError::Win32("SetWindowPos failed".into())) }
}

pub(crate) fn set_window_text(handle: usize, text: &str) -> Result<()> {
    let wide: Vec<u16> = text.encode_utf16().chain(std::iter::once(0)).collect();
    let ok = unsafe {
        windows::Win32::UI::WindowsAndMessaging::SetWindowTextW(
            HWND(handle as *mut _),
            windows::core::PCWSTR(wide.as_ptr()),
        )
    };
    if ok.is_ok() { Ok(()) } else { Err(CaptureError::Win32("SetWindowTextW failed".into())) }
}

pub(crate) fn set_topmost(handle: usize, topmost: bool) -> Result<()> {
    let insert_after = if topmost {
        windows::Win32::UI::WindowsAndMessaging::HWND_TOPMOST
    } else {
        windows::Win32::UI::WindowsAndMessaging::HWND_NOTOPMOST
    };
    let flags = windows::Win32::UI::WindowsAndMessaging::SWP_NOMOVE
        | windows::Win32::UI::WindowsAndMessaging::SWP_NOSIZE
        | windows::Win32::UI::WindowsAndMessaging::SWP_NOACTIVATE;
    let ok = unsafe {
        windows::Win32::UI::WindowsAndMessaging::SetWindowPos(
            HWND(handle as *mut _),
            Some(insert_after),
            0,
            0,
            0,
            0,
            flags,
        )
    };
    if ok.is_ok() { Ok(()) } else { Err(CaptureError::Win32("SetWindowPos topmost failed".into())) }
}

pub(crate) fn switch_to_window(handle: usize) -> Result<()> {
    let hwnd = HWND(handle as *mut _);
    unsafe {
        let _ = windows::Win32::UI::WindowsAndMessaging::ShowWindow(
            hwnd,
            windows::Win32::UI::WindowsAndMessaging::SW_RESTORE,
        );
    }
    let ok = unsafe { windows::Win32::UI::WindowsAndMessaging::SetForegroundWindow(hwnd) };
    if ok.as_bool() {
        Ok(())
    } else {
        Err(CaptureError::Win32("SetForegroundWindow failed".into()))
    }
}

pub(crate) fn enum_children(parent: usize) -> Vec<(usize, String)> {
    let mut out = Vec::new();
    let ptr = &mut out as *mut Vec<(usize, String)>;
    unsafe extern "system" fn callback(hwnd: HWND, lparam: LPARAM) -> windows::core::BOOL {
        let out = unsafe { &mut *(lparam.0 as *mut Vec<(usize, String)>) };
        let len = unsafe { GetWindowTextLengthW(hwnd) };
        let mut buf = vec![0u16; len.max(0) as usize + 1];
        let copied = unsafe { GetWindowTextW(hwnd, &mut buf) };
        buf.truncate(copied.max(0) as usize);
        out.push((hwnd.0 as usize, String::from_utf16_lossy(&buf)));
        true.into()
    }
    let _ = unsafe {
        windows::Win32::UI::WindowsAndMessaging::EnumChildWindows(
            Some(HWND(parent as *mut _)),
            Some(callback),
            LPARAM(ptr as isize),
        )
    };
    out
}

pub(crate) fn window_class(handle: usize) -> Result<String> {
    let hwnd = HWND(handle as *mut _);
    let mut buf = vec![0u16; 256];
    let copied = unsafe { windows::Win32::UI::WindowsAndMessaging::GetClassNameW(hwnd, &mut buf) };
    if copied <= 0 {
        return Err(CaptureError::Win32("GetClassNameW failed".into()));
    }
    buf.truncate(copied as usize);
    Ok(String::from_utf16_lossy(&buf))
}

pub(crate) fn post_message(handle: usize, msg: u32, wparam: usize, lparam: isize) -> Result<()> {
    let ok = unsafe {
        windows::Win32::UI::WindowsAndMessaging::PostMessageW(
            Some(HWND(handle as *mut _)),
            msg,
            windows::Win32::Foundation::WPARAM(wparam),
            windows::Win32::Foundation::LPARAM(lparam),
        )
    };
    if ok.is_ok() { Ok(()) } else { Err(CaptureError::Win32("PostMessageW failed".into())) }
}

pub(crate) fn send_message(handle: usize, msg: u32, wparam: usize, lparam: isize) -> isize {
    unsafe {
        windows::Win32::UI::WindowsAndMessaging::SendMessageW(
            HWND(handle as *mut _),
            msg,
            Some(windows::Win32::Foundation::WPARAM(wparam)),
            Some(windows::Win32::Foundation::LPARAM(lparam)),
        )
        .0
    }
}

pub(crate) fn minimize_all() -> Result<()> {
    for window in list_detailed_windows() {
        unsafe {
            let _ = windows::Win32::UI::WindowsAndMessaging::ShowWindow(
                HWND(window.handle as *mut _),
                windows::Win32::UI::WindowsAndMessaging::SW_MINIMIZE,
            );
        }
    }
    Ok(())
}

pub(crate) fn set_opacity(handle: usize, alpha: u8, click_through: bool) -> Result<()> {
    use windows::Win32::UI::WindowsAndMessaging::{
        GWL_EXSTYLE, GetWindowLongPtrW, LWA_ALPHA, SetLayeredWindowAttributes, SetWindowLongPtrW,
        WS_EX_LAYERED, WS_EX_TRANSPARENT,
    };
    let hwnd = HWND(handle as *mut _);
    let mut style = unsafe { GetWindowLongPtrW(hwnd, GWL_EXSTYLE) } as u32;
    style |= WS_EX_LAYERED.0;
    if click_through {
        style |= WS_EX_TRANSPARENT.0;
    } else {
        style &= !WS_EX_TRANSPARENT.0;
    }
    unsafe {
        SetWindowLongPtrW(hwnd, GWL_EXSTYLE, style as isize);
    }
    unsafe {
        SetLayeredWindowAttributes(hwnd, windows::Win32::Foundation::COLORREF(0), alpha, LWA_ALPHA)
    }
    .map_err(|e| CaptureError::Win32(e.to_string()))
}

pub(crate) fn mouse_move(x: i32, y: i32) -> Result<()> {
    unsafe { windows::Win32::UI::WindowsAndMessaging::SetCursorPos(x, y) }
        .map_err(|e| CaptureError::Win32(e.to_string()))
}

pub(crate) fn mouse_click(button: &str, clicks: u32) -> Result<()> {
    use windows::Win32::UI::Input::KeyboardAndMouse::{
        MOUSEEVENTF_LEFTDOWN, MOUSEEVENTF_LEFTUP, MOUSEEVENTF_MIDDLEDOWN, MOUSEEVENTF_MIDDLEUP,
        MOUSEEVENTF_RIGHTDOWN, MOUSEEVENTF_RIGHTUP, mouse_event,
    };
    let (down, up) = match button.to_ascii_lowercase().as_str() {
        "right" => (MOUSEEVENTF_RIGHTDOWN, MOUSEEVENTF_RIGHTUP),
        "middle" => (MOUSEEVENTF_MIDDLEDOWN, MOUSEEVENTF_MIDDLEUP),
        _ => (MOUSEEVENTF_LEFTDOWN, MOUSEEVENTF_LEFTUP),
    };
    for _ in 0..clicks.min(2) {
        unsafe {
            mouse_event(down, 0, 0, 0, 0);
            mouse_event(up, 0, 0, 0, 0);
        }
        if clicks > 1 {
            std::thread::sleep(std::time::Duration::from_millis(40));
        }
    }
    Ok(())
}

pub(crate) fn mouse_button(button: &str, down: bool) -> Result<()> {
    use windows::Win32::UI::Input::KeyboardAndMouse::{
        MOUSEEVENTF_LEFTDOWN, MOUSEEVENTF_LEFTUP, MOUSEEVENTF_MIDDLEDOWN, MOUSEEVENTF_MIDDLEUP,
        MOUSEEVENTF_RIGHTDOWN, MOUSEEVENTF_RIGHTUP, mouse_event,
    };
    let flag = match (button.to_ascii_lowercase().as_str(), down) {
        ("right", true) => MOUSEEVENTF_RIGHTDOWN,
        ("right", false) => MOUSEEVENTF_RIGHTUP,
        ("middle", true) => MOUSEEVENTF_MIDDLEDOWN,
        ("middle", false) => MOUSEEVENTF_MIDDLEUP,
        (_, true) => MOUSEEVENTF_LEFTDOWN,
        (_, false) => MOUSEEVENTF_LEFTUP,
    };
    unsafe {
        mouse_event(flag, 0, 0, 0, 0);
    }
    Ok(())
}

pub(crate) fn mouse_wheel(dx: i32, dy: i32) -> Result<()> {
    use windows::Win32::UI::Input::KeyboardAndMouse::{
        MOUSEEVENTF_HWHEEL, MOUSEEVENTF_WHEEL, mouse_event,
    };
    unsafe {
        if dy != 0 {
            mouse_event(MOUSEEVENTF_WHEEL, 0, 0, dy, 0);
        }
        if dx != 0 {
            mouse_event(MOUSEEVENTF_HWHEEL, 0, 0, dx, 0);
        }
    }
    Ok(())
}

pub(crate) fn mouse_scroll(axis: &str, direction: &str, times: u32) -> Result<()> {
    use windows::Win32::UI::Input::KeyboardAndMouse::{
        MOUSEEVENTF_HWHEEL, MOUSEEVENTF_WHEEL, mouse_event,
    };
    let amount = (times.clamp(1, 40) as i32)
        * 120
        * if matches!(direction.to_ascii_lowercase().as_str(), "up" | "left") { 1 } else { -1 };
    let flag = if axis.eq_ignore_ascii_case("horizontal") {
        MOUSEEVENTF_HWHEEL
    } else {
        MOUSEEVENTF_WHEEL
    };
    unsafe {
        mouse_event(flag, 0, 0, amount, 0);
    }
    Ok(())
}

pub(crate) fn type_unicode(text: &str) -> Result<()> {
    use windows::Win32::UI::Input::KeyboardAndMouse::{
        INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYEVENTF_KEYUP, KEYEVENTF_UNICODE, SendInput,
        VIRTUAL_KEY,
    };
    if text.chars().count() > 4096 {
        return Err(CaptureError::Win32("text exceeds 4096 characters".into()));
    }
    let mut inputs = Vec::with_capacity(text.encode_utf16().count() * 2);
    for unit in text.encode_utf16() {
        inputs.push(INPUT {
            r#type: INPUT_KEYBOARD,
            Anonymous: INPUT_0 {
                ki: KEYBDINPUT {
                    wVk: VIRTUAL_KEY(0),
                    wScan: unit,
                    dwFlags: KEYEVENTF_UNICODE,
                    time: 0,
                    dwExtraInfo: 0,
                },
            },
        });
        inputs.push(INPUT {
            r#type: INPUT_KEYBOARD,
            Anonymous: INPUT_0 {
                ki: KEYBDINPUT {
                    wVk: VIRTUAL_KEY(0),
                    wScan: unit,
                    dwFlags: KEYEVENTF_UNICODE | KEYEVENTF_KEYUP,
                    time: 0,
                    dwExtraInfo: 0,
                },
            },
        });
    }
    let sent = unsafe { SendInput(&inputs, std::mem::size_of::<INPUT>() as i32) };
    if sent == inputs.len() as u32 {
        Ok(())
    } else {
        Err(CaptureError::Win32(format!("SendInput sent {sent}/{} events", inputs.len())))
    }
}

pub(crate) fn key_scan(scan: u16, action: &str, extended: bool) -> Result<()> {
    use windows::Win32::UI::Input::KeyboardAndMouse::{
        INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYEVENTF_EXTENDEDKEY, KEYEVENTF_KEYUP,
        KEYEVENTF_SCANCODE, SendInput, VIRTUAL_KEY,
    };
    let mut flags = KEYEVENTF_SCANCODE;
    if extended {
        flags |= KEYEVENTF_EXTENDEDKEY;
    }
    let down = INPUT {
        r#type: INPUT_KEYBOARD,
        Anonymous: INPUT_0 {
            ki: KEYBDINPUT {
                wVk: VIRTUAL_KEY(0),
                wScan: scan,
                dwFlags: flags,
                time: 0,
                dwExtraInfo: 0,
            },
        },
    };
    let up = INPUT {
        r#type: INPUT_KEYBOARD,
        Anonymous: INPUT_0 {
            ki: KEYBDINPUT {
                wVk: VIRTUAL_KEY(0),
                wScan: scan,
                dwFlags: flags | KEYEVENTF_KEYUP,
                time: 0,
                dwExtraInfo: 0,
            },
        },
    };
    let inputs = match action {
        "down" => vec![down],
        "up" => vec![up],
        "tap" => vec![down, up],
        _ => return Err(CaptureError::Win32("action must be down, up or tap".into())),
    };
    let sent = unsafe { SendInput(&inputs, std::mem::size_of::<INPUT>() as i32) };
    if sent == inputs.len() as u32 {
        Ok(())
    } else {
        Err(CaptureError::Win32(format!("SendInput sent {sent}/{} events", inputs.len())))
    }
}

pub(crate) fn key_vk(vk: u8, down: bool) -> Result<()> {
    use windows::Win32::UI::Input::KeyboardAndMouse::{KEYEVENTF_KEYUP, keybd_event};
    unsafe {
        keybd_event(
            vk,
            0,
            if down {
                windows::Win32::UI::Input::KeyboardAndMouse::KEYBD_EVENT_FLAGS(0)
            } else {
                KEYEVENTF_KEYUP
            },
            0,
        );
    }
    Ok(())
}

fn virtual_key(token: &str) -> Option<u8> {
    let lower = token.trim().to_ascii_lowercase();
    if lower.len() == 1 {
        let c = lower.as_bytes()[0];
        if c.is_ascii_alphanumeric() {
            return Some(c.to_ascii_uppercase());
        }
    }
    Some(match lower.as_str() {
        "ctrl" | "control" => 0x11,
        "shift" => 0x10,
        "alt" => 0x12,
        "win" | "windows" => 0x5b,
        "enter" | "return" => 0x0d,
        "tab" => 0x09,
        "escape" | "esc" => 0x1b,
        "space" => 0x20,
        "backspace" => 0x08,
        "delete" | "del" => 0x2e,
        "up" => 0x26,
        "down" => 0x28,
        "left" => 0x25,
        "right" => 0x27,
        "home" => 0x24,
        "end" => 0x23,
        "pageup" => 0x21,
        "pagedown" => 0x22,
        "f1" => 0x70,
        "f2" => 0x71,
        "f3" => 0x72,
        "f4" => 0x73,
        "f5" => 0x74,
        "f6" => 0x75,
        "f7" => 0x76,
        "f8" => 0x77,
        "f9" => 0x78,
        "f10" => 0x79,
        "f11" => 0x7a,
        "f12" => 0x7b,
        _ => return None,
    })
}

fn key_shortcut_impl(shortcut: &str, allow_windows: bool) -> Result<()> {
    let tokens = shortcut.split('+').filter(|v| !v.trim().is_empty()).collect::<Vec<_>>();
    if tokens.is_empty()
        || (!allow_windows
            && tokens
                .iter()
                .any(|v| v.eq_ignore_ascii_case("win") || v.eq_ignore_ascii_case("windows")))
    {
        return Err(CaptureError::Win32("invalid or Windows-key shortcut".into()));
    }
    let keys = tokens
        .iter()
        .map(|v| virtual_key(v).ok_or_else(|| CaptureError::Win32(format!("unknown key {v}"))))
        .collect::<Result<Vec<_>>>()?;
    for key in &keys[..keys.len() - 1] {
        key_vk(*key, true)?;
    }
    key_vk(*keys.last().unwrap(), true)?;
    key_vk(*keys.last().unwrap(), false)?;
    for key in keys[..keys.len() - 1].iter().rev() {
        key_vk(*key, false)?;
    }
    Ok(())
}

pub(crate) fn key_shortcut(shortcut: &str) -> Result<()> {
    key_shortcut_impl(shortcut, false)
}

pub(crate) fn key_shortcut_unrestricted(shortcut: &str) -> Result<()> {
    key_shortcut_impl(shortcut, true)
}

pub(crate) fn mouse_drag(
    x1: i32,
    y1: i32,
    x2: i32,
    y2: i32,
    button: &str,
    steps: u32,
    duration_ms: u64,
) -> Result<()> {
    use windows::Win32::UI::Input::KeyboardAndMouse::{
        MOUSEEVENTF_LEFTDOWN, MOUSEEVENTF_LEFTUP, MOUSEEVENTF_MIDDLEDOWN, MOUSEEVENTF_MIDDLEUP,
        MOUSEEVENTF_RIGHTDOWN, MOUSEEVENTF_RIGHTUP, mouse_event,
    };
    let (down, up) = match button.to_ascii_lowercase().as_str() {
        "right" => (MOUSEEVENTF_RIGHTDOWN, MOUSEEVENTF_RIGHTUP),
        "middle" => (MOUSEEVENTF_MIDDLEDOWN, MOUSEEVENTF_MIDDLEUP),
        _ => (MOUSEEVENTF_LEFTDOWN, MOUSEEVENTF_LEFTUP),
    };
    mouse_move(x1, y1)?;
    unsafe { mouse_event(down, 0, 0, 0, 0) };
    let n = steps.clamp(8, 200);
    let sleep = std::time::Duration::from_millis(duration_ms.clamp(50, 5000) / n as u64);
    for i in 1..=n {
        let t = i as f64 / n as f64;
        mouse_move(
            (x1 as f64 + (x2 - x1) as f64 * t) as i32,
            (y1 as f64 + (y2 - y1) as f64 * t) as i32,
        )?;
        std::thread::sleep(sleep);
    }
    unsafe { mouse_event(up, 0, 0, 0, 0) };
    Ok(())
}
