// SPDX-License-Identifier: Apache-2.0
//! Linux backend: pure-Rust X11 (GetImage capture, XTest input).
//!
//! Wayland-only sessions have no `DISPLAY` and are reported as unsupported.

use anyhow::{Context, Result, anyhow, bail};
use x11rb::connection::Connection;
use x11rb::protocol::xproto::{
    BUTTON_PRESS_EVENT, BUTTON_RELEASE_EVENT, ConnectionExt as _, ImageFormat, ImageOrder,
    KEY_PRESS_EVENT, KEY_RELEASE_EVENT, MOTION_NOTIFY_EVENT, Window,
};
use x11rb::protocol::xtest::ConnectionExt as _;
use x11rb::rust_connection::RustConnection;

use super::{MouseButton, RawFrame, ScreenBackend};
use crate::keymap::{char_to_keysym, code_to_keysym};

const KEYSYM_SHIFT_L: u32 = 0xFFE1;

pub struct X11Backend {
    conn: RustConnection,
    root: Window,
    min_keycode: u8,
    per_keycode: usize,
    keysyms: Vec<u32>,
}

impl X11Backend {
    pub fn connect() -> Result<Self> {
        let display = std::env::var("DISPLAY").unwrap_or_default();
        if display.trim().is_empty() {
            let wayland = std::env::var("WAYLAND_DISPLAY").is_ok_and(|v| !v.is_empty());
            bail!(
                "unsupported: no X11 display (DISPLAY unset{})",
                if wayland {
                    "; Wayland-only session"
                } else {
                    ""
                }
            );
        }
        let (conn, screen_num) = RustConnection::connect(None)
            .with_context(|| format!("cannot connect to X11 display {display}"))?;
        let setup = conn.setup();
        if setup.image_byte_order != ImageOrder::LSB_FIRST {
            bail!("unsupported: big-endian X11 image byte order");
        }
        let screen = setup
            .roots
            .get(screen_num)
            .context("X11 screen not found")?;
        let root = screen.root;
        let depth = screen.root_depth;
        let ok = setup
            .pixmap_formats
            .iter()
            .any(|f| f.depth == depth && f.bits_per_pixel == 32);
        if !ok {
            bail!("unsupported: root depth {depth} has no 32 bpp pixmap format");
        }
        let (min, max) = (setup.min_keycode, setup.max_keycode);
        conn.xtest_get_version(2, 2)?
            .reply()
            .context("XTEST extension unavailable")?;
        let map = conn.get_keyboard_mapping(min, max - min + 1)?.reply()?;
        Ok(Self {
            conn,
            root,
            min_keycode: min,
            per_keycode: usize::from(map.keysyms_per_keycode).max(1),
            keysyms: map.keysyms,
        })
    }

    /// Keycode producing `keysym`, and whether Shift is needed.
    fn find_keycode(&self, keysym: u32) -> Option<(u8, bool)> {
        let n = self.keysyms.len() / self.per_keycode;
        let col = |kc: usize, c: usize| self.keysyms.get(kc * self.per_keycode + c).copied();
        let code = |kc: usize| u8::try_from(kc).ok().map(|k| k + self.min_keycode);
        for kc in 0..n {
            if col(kc, 0) == Some(keysym) {
                return code(kc).map(|k| (k, false));
            }
        }
        if self.per_keycode > 1 {
            for kc in 0..n {
                if col(kc, 1) == Some(keysym) {
                    return code(kc).map(|k| (k, true));
                }
            }
        }
        None
    }

    fn fake(&self, kind: u8, detail: u8, x: i16, y: i16) -> Result<()> {
        self.conn
            .xtest_fake_input(kind, detail, 0, self.root, x, y, 0)?;
        self.conn.flush()?;
        Ok(())
    }

    fn click_button(&self, detail: u8) -> Result<()> {
        self.fake(BUTTON_PRESS_EVENT, detail, 0, 0)?;
        self.fake(BUTTON_RELEASE_EVENT, detail, 0, 0)
    }
}

impl ScreenBackend for X11Backend {
    fn name(&self) -> &'static str {
        "x11"
    }

    fn capture(&mut self) -> Result<RawFrame> {
        let g = self.conn.get_geometry(self.root)?.reply()?;
        let (w, h) = (g.width, g.height);
        let reply = self
            .conn
            .get_image(ImageFormat::Z_PIXMAP, self.root, 0, 0, w, h, u32::MAX)?
            .reply()
            .context("GetImage failed")?;
        let mut bgra = reply.data;
        if bgra.len() != usize::from(w) * usize::from(h) * 4 {
            bail!("unexpected GetImage size {} for {w}x{h}", bgra.len());
        }
        for px in bgra.as_chunks_mut::<4>().0 {
            px[3] = 0xFF;
        }
        Ok(RawFrame {
            origin_x: 0,
            origin_y: 0,
            width: u32::from(w),
            height: u32::from(h),
            bgra,
        })
    }

    fn mouse_move(&mut self, x: i32, y: i32) -> Result<()> {
        let c = |v: i32| v.clamp(i32::from(i16::MIN), i32::from(i16::MAX)) as i16;
        self.fake(MOTION_NOTIFY_EVENT, 0, c(x), c(y))
    }

    fn mouse_button(&mut self, button: MouseButton, down: bool) -> Result<()> {
        let detail = match button {
            MouseButton::Left => 1,
            MouseButton::Middle => 2,
            MouseButton::Right => 3,
        };
        self.fake(
            if down {
                BUTTON_PRESS_EVENT
            } else {
                BUTTON_RELEASE_EVENT
            },
            detail,
            0,
            0,
        )
    }

    fn wheel(&mut self, dx: i32, dy: i32) -> Result<()> {
        let notches = |d: i32| (d.unsigned_abs() / 120).clamp(1, 20);
        if dy != 0 {
            for _ in 0..notches(dy) {
                self.click_button(if dy > 0 { 4 } else { 5 })?;
            }
        }
        if dx != 0 {
            for _ in 0..notches(dx) {
                self.click_button(if dx > 0 { 7 } else { 6 })?;
            }
        }
        Ok(())
    }

    fn key(&mut self, code: &str, down: bool) -> Result<()> {
        let keysym = code_to_keysym(code).ok_or_else(|| anyhow!("unmapped key code {code}"))?;
        let (kc, _) = self
            .find_keycode(keysym)
            .ok_or_else(|| anyhow!("no keycode for keysym {keysym:#x}"))?;
        self.fake(
            if down {
                KEY_PRESS_EVENT
            } else {
                KEY_RELEASE_EVENT
            },
            kc,
            0,
            0,
        )
    }

    fn keysym(&mut self, keysym: u32, down: bool) -> Result<()> {
        let (kc, _) = self
            .find_keycode(keysym)
            .ok_or_else(|| anyhow!("no keycode for keysym {keysym:#x}"))?;
        self.fake(
            if down {
                KEY_PRESS_EVENT
            } else {
                KEY_RELEASE_EVENT
            },
            kc,
            0,
            0,
        )
    }

    fn text(&mut self, text: &str) -> Result<()> {
        let shift = self.find_keycode(KEYSYM_SHIFT_L).map(|(k, _)| k);
        for ch in text.chars() {
            let Some((kc, needs_shift)) = self.find_keycode(char_to_keysym(ch)) else {
                continue; // glyph absent from the active keyboard layout
            };
            let shift = if needs_shift { shift } else { None };
            if let Some(s) = shift {
                self.fake(KEY_PRESS_EVENT, s, 0, 0)?;
            }
            self.fake(KEY_PRESS_EVENT, kc, 0, 0)?;
            self.fake(KEY_RELEASE_EVENT, kc, 0, 0)?;
            if let Some(s) = shift {
                self.fake(KEY_RELEASE_EVENT, s, 0, 0)?;
            }
        }
        Ok(())
    }
}
