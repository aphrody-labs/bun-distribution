// SPDX-License-Identifier: Apache-2.0
//! Windows backend on top of `aphrody-capture` (GDI capture, SendInput).

use anyhow::{Result, anyhow, bail};

use super::{MouseButton, RawFrame, ScreenBackend};
use crate::keymap::{code_to_extended_scan, code_to_vk};

pub struct Win32Backend;

impl ScreenBackend for Win32Backend {
    fn name(&self) -> &'static str {
        "gdi"
    }

    fn capture(&mut self) -> Result<RawFrame> {
        aphrody_capture::capture_virtual_screen_raw().map_err(|e| anyhow!(e))
    }

    fn mouse_move(&mut self, x: i32, y: i32) -> Result<()> {
        aphrody_capture::mouse_move(x, y).map_err(|e| anyhow!(e))
    }

    fn mouse_button(&mut self, button: MouseButton, down: bool) -> Result<()> {
        aphrody_capture::mouse_button(button.as_str(), down).map_err(|e| anyhow!(e))
    }

    fn wheel(&mut self, dx: i32, dy: i32) -> Result<()> {
        aphrody_capture::mouse_wheel(dx, dy).map_err(|e| anyhow!(e))
    }

    fn key(&mut self, code: &str, down: bool) -> Result<()> {
        if let Some(scan) = code_to_extended_scan(code) {
            let action = if down { "down" } else { "up" };
            return aphrody_capture::key_scan(scan, action, true).map_err(|e| anyhow!(e));
        }
        match code_to_vk(code) {
            Some(vk) => aphrody_capture::key_vk(vk, down).map_err(|e| anyhow!(e)),
            None => bail!("unmapped key code {code}"),
        }
    }

    fn text(&mut self, text: &str) -> Result<()> {
        aphrody_capture::type_unicode(text).map_err(|e| anyhow!(e))
    }
}
