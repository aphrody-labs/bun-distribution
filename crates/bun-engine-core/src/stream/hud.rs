//! Frame-time and latency HUD text, rasterized with GDI into a premultiplied RGBA bitmap that the
//! presenter blends over the stream.

use windows::{
    Win32::{
        Foundation::COLORREF,
        Graphics::Gdi::{
            ANTIALIASED_QUALITY, BI_RGB, BITMAPINFO, BITMAPINFOHEADER, BLACKNESS, CLIP_DEFAULT_PRECIS,
            CreateCompatibleDC, CreateDIBSection, CreateFontW, DEFAULT_CHARSET, DIB_RGB_COLORS, DeleteDC,
            DeleteObject, FF_MODERN, FIXED_PITCH, FW_BOLD, GdiFlush, HBITMAP, HDC, HFONT, HGDIOBJ,
            OPAQUE, OUT_DEFAULT_PRECIS, PatBlt, SelectObject, SetBkColor, SetBkMode, SetTextColor,
            TextOutW,
        },
    },
    core::w,
};

pub const HUD_WIDTH: u32 = 760;
pub const LINE_HEIGHT: u32 = 18;
pub const HUD_LINES: u32 = 7;
pub const HUD_HEIGHT: u32 = LINE_HEIGHT * HUD_LINES + 8;

pub struct HudRaster {
    dc: HDC,
    bitmap: HBITMAP,
    font: HFONT,
    old_bitmap: HGDIOBJ,
    old_font: HGDIOBJ,
    bits: *mut u8,
}

// SAFETY: owned and used on the render thread only.
unsafe impl Send for HudRaster {}

impl HudRaster {
    pub fn new() -> Option<Self> {
        // SAFETY: GDI object creation; every object is released in Drop.
        unsafe {
            let dc = CreateCompatibleDC(None);
            if dc.is_invalid() {
                return None;
            }
            let info = BITMAPINFO {
                bmiHeader: BITMAPINFOHEADER {
                    biSize: size_of::<BITMAPINFOHEADER>() as u32,
                    biWidth: HUD_WIDTH as i32,
                    biHeight: -(HUD_HEIGHT as i32),
                    biPlanes: 1,
                    biBitCount: 32,
                    biCompression: BI_RGB.0,
                    ..Default::default()
                },
                ..Default::default()
            };
            let mut bits = std::ptr::null_mut();
            let bitmap = CreateDIBSection(Some(dc), &info, DIB_RGB_COLORS, &mut bits, None, 0).ok()?;
            let font = CreateFontW(
                -(LINE_HEIGHT as i32 - 3),
                0,
                0,
                0,
                FW_BOLD.0 as i32,
                0,
                0,
                0,
                DEFAULT_CHARSET,
                OUT_DEFAULT_PRECIS,
                CLIP_DEFAULT_PRECIS,
                ANTIALIASED_QUALITY,
                (FIXED_PITCH.0 | FF_MODERN.0) as u32,
                w!("Consolas"),
            );
            let old_bitmap = SelectObject(dc, bitmap.into());
            let old_font = SelectObject(dc, font.into());
            SetTextColor(dc, COLORREF(0x00FF_FFFF));
            SetBkColor(dc, COLORREF(0));
            SetBkMode(dc, OPAQUE);
            Some(Self { dc, bitmap, font, old_bitmap, old_font, bits: bits.cast() })
        }
    }

    /// Rasterize `lines`; returns premultiplied RGBA (`HUD_WIDTH` x `HUD_HEIGHT`).
    pub fn render(&mut self, lines: &[String]) -> Vec<u8> {
        // SAFETY: drawing into our DIB section; GdiFlush makes the bits current before reading
        // exactly HUD_WIDTH * HUD_HEIGHT * 4 bytes from the section.
        unsafe {
            let _ = PatBlt(self.dc, 0, 0, HUD_WIDTH as i32, HUD_HEIGHT as i32, BLACKNESS);
            for (i, line) in lines.iter().take(HUD_LINES as usize).enumerate() {
                let wide: Vec<u16> = line.encode_utf16().collect();
                let _ = TextOutW(self.dc, 6, 4 + (i as u32 * LINE_HEIGHT) as i32, &wide);
            }
            let _ = GdiFlush();
            let len = (HUD_WIDTH * HUD_HEIGHT * 4) as usize;
            let bgra = std::slice::from_raw_parts(self.bits, len);
            let rows = lines.len().min(HUD_LINES as usize) as u32;
            let used_height = (4 + rows * LINE_HEIGHT + 4).min(HUD_HEIGHT);
            let mut rgba = vec![0u8; len];
            for y in 0..HUD_HEIGHT {
                for x in 0..HUD_WIDTH {
                    let i = ((y * HUD_WIDTH + x) * 4) as usize;
                    let text = bgra[i + 1];
                    // Text over a translucent dark panel, premultiplied.
                    let panel = if y < used_height { 150u16 } else { 0 };
                    let a = (u16::from(text) + panel * (255 - u16::from(text)) / 255).min(255) as u8;
                    let lum = text;
                    rgba[i] = (u16::from(lum) * 230 / 255) as u8;
                    rgba[i + 1] = lum;
                    rgba[i + 2] = (u16::from(lum) * 140 / 255) as u8;
                    rgba[i + 3] = a;
                }
            }
            rgba
        }
    }
}

impl Drop for HudRaster {
    fn drop(&mut self) {
        // SAFETY: restoring the original selections, then deleting the objects created in new().
        unsafe {
            SelectObject(self.dc, self.old_font);
            SelectObject(self.dc, self.old_bitmap);
            let _ = DeleteObject(self.font.into());
            let _ = DeleteObject(self.bitmap.into());
            let _ = DeleteDC(self.dc);
        }
    }
}
