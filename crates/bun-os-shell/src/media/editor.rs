//! Screenshot editor: crop, highlight and marker annotations, export. Pixels go through ArtCraft's
//! image owner (`artcraft-images`, which re-exports the `image` crate); the canvas state is kept
//! in normalized coordinates so the Bevy view, the controller cursor and the export agree at any
//! resolution. WebP/AVIF re-encodes are the platform service's (`Bun.Image`, `media.image.export`).

use std::path::{Path, PathBuf};

use images::image::{self, Rgba, RgbaImage};

/// Normalized rectangle `[x0, y0, x1, y1]` (any corner order).
pub type Rect = [f32; 4];

pub fn normalize(r: Rect) -> Rect {
    [r[0].min(r[2]), r[1].min(r[3]), r[0].max(r[2]), r[1].max(r[3])]
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Tool {
    Crop,
    Highlight,
    Marker,
}

impl Tool {
    pub const ALL: [Tool; 3] = [Tool::Crop, Tool::Highlight, Tool::Marker];

    pub fn icon(self) -> &'static str {
        match self {
            Self::Crop => "crop",
            Self::Highlight => "highlight",
            Self::Marker => "radio_button_checked",
        }
    }

    pub fn key(self) -> &'static str {
        match self {
            Self::Crop => "media.crop",
            Self::Highlight => "media.highlight",
            Self::Marker => "media.marker",
        }
    }

    /// Tools placed with two corners (crop, highlight); markers take one point.
    pub fn two_corners(self) -> bool {
        !matches!(self, Self::Marker)
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Mark {
    Highlight(Rect),
    /// Center and radius as a fraction of the shorter side.
    Marker([f32; 2], f32),
}

/// Edit state of one picture.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Edit {
    pub crop: Option<Rect>,
    pub marks: Vec<Mark>,
    /// First corner of a two-corner gesture in progress.
    pub anchor: Option<[f32; 2]>,
}

impl Edit {
    /// Place a point with `tool` (two-corner tools complete on the second point).
    pub fn place(&mut self, tool: Tool, at: [f32; 2], marker_radius: f32) {
        if !tool.two_corners() {
            self.marks.push(Mark::Marker(at, marker_radius));
            return;
        }
        match self.anchor.take() {
            None => self.anchor = Some(at),
            Some(a) => {
                let rect = normalize([a[0], a[1], at[0], at[1]]);
                if rect[2] - rect[0] < 0.01 || rect[3] - rect[1] < 0.01 {
                    return;
                }
                match tool {
                    Tool::Crop => self.crop = Some(rect),
                    Tool::Highlight => self.marks.push(Mark::Highlight(rect)),
                    Tool::Marker => {}
                }
            }
        }
    }

    pub fn undo(&mut self) {
        if self.anchor.take().is_none() && self.marks.pop().is_none() {
            self.crop = None;
        }
    }
}

/// Annotation colours (sRGB, straight alpha), from the live theme roles.
#[derive(Clone, Copy, Debug)]
pub struct Colors {
    pub highlight: [u8; 4],
    pub marker: [u8; 4],
}

fn blend(dst: &mut Rgba<u8>, src: [u8; 4]) {
    let a = u32::from(src[3]);
    for i in 0..3 {
        dst.0[i] = ((u32::from(src[i]) * a + u32::from(dst.0[i]) * (255 - a) + 127) / 255) as u8;
    }
}

/// Apply marks then crop, in source pixels.
pub fn render(src: &Path, edit: &Edit, colors: Colors) -> Result<RgbaImage, String> {
    let mut img = image::open(src).map_err(|e| e.to_string())?.to_rgba8();
    let (w, h) = (img.width() as f32, img.height() as f32);
    let px = |x: f32, max: f32| (x.clamp(0.0, 1.0) * max) as u32;
    for mark in &edit.marks {
        match *mark {
            Mark::Highlight(r) => {
                let r = normalize(r);
                let (x0, y0, x1, y1) = (px(r[0], w), px(r[1], h), px(r[2], w), px(r[3], h));
                let border = ((w.min(h) * 0.004) as u32).max(2);
                for y in y0..y1.min(img.height()) {
                    for x in x0..x1.min(img.width()) {
                        let edge = x < x0 + border || x + border >= x1 || y < y0 + border || y + border >= y1;
                        let mut c = colors.highlight;
                        if !edge {
                            c[3] /= 4;
                        }
                        blend(img.get_pixel_mut(x, y), c);
                    }
                }
            }
            Mark::Marker(at, radius) => {
                let r = radius * w.min(h);
                let (cx, cy) = (at[0] * w, at[1] * h);
                let (x0, x1) = ((cx - r).max(0.0) as u32, ((cx + r) as u32).min(img.width()));
                let (y0, y1) = ((cy - r).max(0.0) as u32, ((cy + r) as u32).min(img.height()));
                let ring = r * 0.22;
                for y in y0..y1 {
                    for x in x0..x1 {
                        let d = ((x as f32 - cx).powi(2) + (y as f32 - cy).powi(2)).sqrt();
                        if d <= r && d >= r - ring {
                            blend(img.get_pixel_mut(x, y), colors.marker);
                        }
                    }
                }
            }
        }
    }
    if let Some(c) = edit.crop {
        let c = normalize(c);
        let (x0, y0) = (px(c[0], w), px(c[1], h));
        let (cw, ch) = (px(c[2], w).saturating_sub(x0).max(1), px(c[3], h).saturating_sub(y0).max(1));
        img = image::imageops::crop_imm(&img, x0, y0, cw, ch).to_image();
    }
    Ok(img)
}

/// Write the edited picture next to the source as `<stem>-edited-<n>.png`.
pub fn export_png(src: &Path, edit: &Edit, colors: Colors) -> Result<PathBuf, String> {
    let img = render(src, edit, colors)?;
    let stem = src.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
    let dir = src.parent().unwrap_or(Path::new("."));
    let mut n = 1;
    let out = loop {
        let candidate = dir.join(format!("{stem}-edited-{n}.png"));
        if !candidate.exists() {
            break candidate;
        }
        n += 1;
    };
    img.save_with_format(&out, image::ImageFormat::Png).map_err(|e| e.to_string())?;
    Ok(out)
}
