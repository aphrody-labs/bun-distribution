use aphrody_ctr_emu::{BOTTOM_SIZE, TOP_SIZE};

/// A rectangle in window pixels.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Rect {
    pub x: f32,
    pub y: f32,
    pub width: f32,
    pub height: f32,
}

/// Both screens stacked vertically (top above bottom) and scaled to fit a window.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Layout {
    pub top: Rect,
    pub bottom: Rect,
    scale: f32,
}

impl Layout {
    pub fn new(window_width: u32, window_height: u32) -> Self {
        let (w, h) = (window_width.max(1) as f32, window_height.max(1) as f32);
        let (tw, th) = (TOP_SIZE.0 as f32, TOP_SIZE.1 as f32);
        let (bw, bh) = (BOTTOM_SIZE.0 as f32, BOTTOM_SIZE.1 as f32);
        let scale = (w / tw).min(h / (th + bh));
        let y0 = (h - (th + bh) * scale) / 2.0;
        let top = Rect {
            x: (w - tw * scale) / 2.0,
            y: y0,
            width: tw * scale,
            height: th * scale,
        };
        let bottom = Rect {
            x: (w - bw * scale) / 2.0,
            y: y0 + th * scale,
            width: bw * scale,
            height: bh * scale,
        };
        Self { top, bottom, scale }
    }

    /// Maps a window position to a bottom-screen touch coordinate, if it lies on the screen.
    pub fn touch(&self, x: f32, y: f32) -> Option<(u16, u16)> {
        let b = self.bottom;
        if x < b.x || y < b.y || x >= b.x + b.width || y >= b.y + b.height {
            return None;
        }
        let px = ((x - b.x) / self.scale).clamp(0.0, (BOTTOM_SIZE.0 - 1) as f32);
        let py = ((y - b.y) / self.scale).clamp(0.0, (BOTTOM_SIZE.1 - 1) as f32);
        Some((px as u16, py as u16))
    }
}
