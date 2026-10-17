// SPDX-License-Identifier: Apache-2.0
//! Deterministic CPU rasterizer: the pixel-perfect reference backend.
//!
//! [`render_scene_rgba`] paints a [`Scene`] to a straight-alpha RGBA8 buffer
//! using the same analytic rounded-rect / shadow math the GPU backend
//! implements in WGSL (`src/gpu.rs`, `src/gpu.wgsl`), and the same
//! CPU-rasterized text/icon coverage bitmaps the GPU backend uploads as
//! textures. This is what keeps the two backends within the documented
//! per-pixel tolerance while remaining entirely dependency-light and
//! GPU-free by default.

use crate::{
    geometry::{parse_svg_path, rasterize_polylines, sd_rounded_box, shadow_alpha, shadow_params},
    scene::{Node, Rect, Rgba8, Scene},
    text::rasterize_line,
};

/// A straight-alpha RGBA8 canvas.
#[derive(Clone, Debug)]
pub struct Canvas {
    /// Width, in pixels.
    pub width: u32,
    /// Height, in pixels.
    pub height: u32,
    /// Row-major RGBA8 pixels, `width * height * 4` bytes.
    pub pixels: Vec<u8>,
}

impl Canvas {
    fn new(width: u32, height: u32) -> Self {
        Self {
            width,
            height,
            pixels: vec![0; (width as usize) * (height as usize) * 4],
        }
    }

    #[inline]
    fn blend_pixel(&mut self, x: i64, y: i64, src: Rgba8) {
        if x < 0 || y < 0 || x >= i64::from(self.width) || y >= i64::from(self.height) {
            return;
        }
        if src.a == 0 {
            return;
        }
        let idx = ((y as usize) * (self.width as usize) + x as usize) * 4;
        let sa = f32::from(src.a) / 255.0;
        let da = f32::from(self.pixels[idx + 3]) / 255.0;
        let out_a = sa + da * (1.0 - sa);
        if out_a <= 0.0 {
            self.pixels[idx..idx + 4].copy_from_slice(&[0, 0, 0, 0]);
            return;
        }
        for c in 0..3 {
            let s = f32::from(src.as_channel(c));
            let d = f32::from(self.pixels[idx + c]);
            let out = (s * sa + d * da * (1.0 - sa)) / out_a;
            self.pixels[idx + c] = out.round().clamp(0.0, 255.0) as u8;
        }
        self.pixels[idx + 3] = (out_a * 255.0).round().clamp(0.0, 255.0) as u8;
    }

    /// Composite `coverage` (single-channel alpha) tinted by `color` at
    /// integer offset `(x0, y0)`.
    fn blit_coverage(
        &mut self,
        x0: i64,
        y0: i64,
        width: u32,
        height: u32,
        coverage: &[u8],
        color: Rgba8,
    ) {
        for row in 0..height {
            for col in 0..width {
                let a = coverage[(row as usize) * (width as usize) + col as usize];
                if a == 0 {
                    continue;
                }
                let px =
                    color.with_alpha_factor(f32::from(a) / 255.0 * (f32::from(color.a) / 255.0));
                self.blend_pixel(x0 + i64::from(col), y0 + i64::from(row), px);
            }
        }
    }
}

impl Rgba8 {
    #[inline]
    const fn as_channel(self, index: usize) -> u8 {
        match index {
            0 => self.r,
            1 => self.g,
            _ => self.b,
        }
    }
}

/// Render `scene` to a straight-alpha RGBA8 [`Canvas`].
#[must_use]
pub fn render_scene(scene: &Scene) -> Canvas {
    let scheme = scene.scheme();
    let mut canvas = Canvas::new(scene.width.max(1), scene.height.max(1));
    if let Some(bg) = scene.background {
        let color = bg.resolve(&scheme);
        for y in 0..canvas.height {
            for x in 0..canvas.width {
                canvas.blend_pixel(i64::from(x), i64::from(y), color);
            }
        }
    }
    for node in &scene.nodes {
        paint_node(&mut canvas, node, &scheme);
    }
    canvas
}

/// Render `scene` to a straight-alpha RGBA8 [`Canvas`] and PNG-encode it.
///
/// # Errors
/// Returns an error if PNG encoding fails (e.g. an inconsistent buffer size).
pub fn render_scene_png(scene: &Scene) -> Result<Vec<u8>, png::EncodingError> {
    let canvas = render_scene(scene);
    encode_png(canvas.width, canvas.height, &canvas.pixels)
}

/// PNG-encode a straight-alpha RGBA8 buffer (shared by the 2D and 3D lanes).
///
/// # Errors
/// Returns an error if `pixels` does not hold `width * height * 4` bytes.
pub fn encode_png(width: u32, height: u32, pixels: &[u8]) -> Result<Vec<u8>, png::EncodingError> {
    let mut out = Vec::new();
    {
        let mut encoder = png::Encoder::new(&mut out, width, height);
        encoder.set_color(png::ColorType::Rgba);
        encoder.set_depth(png::BitDepth::Eight);
        let mut writer = encoder.write_header()?;
        writer.write_image_data(pixels)?;
    }
    Ok(out)
}

fn paint_node(
    canvas: &mut Canvas,
    node: &Node,
    scheme: &aphrody_m3_tokens::facade::color::DynamicScheme,
) {
    match node {
        Node::Surface {
            rect,
            corners,
            fill,
            elevation,
            outline,
        } => {
            if *elevation > 0 {
                paint_shadow(canvas, *rect, *corners, *elevation);
            }
            paint_rounded_rect(canvas, *rect, *corners, fill.resolve(scheme));
            if let Some(outline) = outline {
                paint_outline(
                    canvas,
                    *rect,
                    *corners,
                    outline.width,
                    outline.color.resolve(scheme),
                );
            }
        }
        Node::StateLayer {
            rect,
            corners,
            content,
            state,
        } => {
            let base = content.resolve(scheme);
            let tinted = base.with_alpha_factor(state.opacity());
            paint_rounded_rect(canvas, *rect, *corners, tinted);
        }
        Node::Ripple {
            cx,
            cy,
            radius,
            color,
            alpha,
        } => {
            paint_ripple(
                canvas,
                *cx,
                *cy,
                *radius,
                color.resolve(scheme).with_alpha_factor(*alpha),
            );
        }
        Node::Text {
            rect,
            text,
            style,
            color,
        } => {
            paint_text(canvas, *rect, text, *style, color.resolve(scheme));
        }
        Node::Icon { rect, path, color } => {
            paint_icon(canvas, *rect, path, color.resolve(scheme));
        }
        Node::Image {
            rect,
            width,
            height,
            rgba,
        } => {
            paint_image(canvas, *rect, *width, *height, rgba);
        }
    }
}

fn paint_rounded_rect(
    canvas: &mut Canvas,
    rect: Rect,
    corners: crate::scene::Corners,
    color: Rgba8,
) {
    if rect.is_empty() || color.a == 0 {
        return;
    }
    let corners = corners.clamped(rect.w, rect.h);
    let (hw, hh) = (rect.w / 2.0, rect.h / 2.0);
    let (cx, cy) = (rect.x + hw, rect.y + hh);
    let x0 = rect.x.floor().max(0.0) as i64;
    let y0 = rect.y.floor().max(0.0) as i64;
    let x1 = (rect.x + rect.w).ceil() as i64;
    let y1 = (rect.y + rect.h).ceil() as i64;
    for y in y0..y1 {
        for x in x0..x1 {
            let px = (x as f32 + 0.5) - cx;
            let py = (y as f32 + 0.5) - cy;
            let d = sd_rounded_box(
                px,
                py,
                hw,
                hh,
                (corners.tl, corners.tr, corners.br, corners.bl),
            );
            let coverage = (0.5 - d).clamp(0.0, 1.0);
            if coverage <= 0.0 {
                continue;
            }
            canvas.blend_pixel(x, y, color.with_alpha_factor(coverage));
        }
    }
}

fn paint_outline(
    canvas: &mut Canvas,
    rect: Rect,
    corners: crate::scene::Corners,
    stroke_width: f32,
    color: Rgba8,
) {
    if rect.is_empty() || color.a == 0 || stroke_width <= 0.0 {
        return;
    }
    let corners = corners.clamped(rect.w, rect.h);
    let (hw, hh) = (rect.w / 2.0, rect.h / 2.0);
    let (cx, cy) = (rect.x + hw, rect.y + hh);
    let x0 = (rect.x - stroke_width).floor().max(0.0) as i64;
    let y0 = (rect.y - stroke_width).floor().max(0.0) as i64;
    let x1 = (rect.x + rect.w + stroke_width).ceil() as i64;
    let y1 = (rect.y + rect.h + stroke_width).ceil() as i64;
    for y in y0..y1 {
        for x in x0..x1 {
            let px = (x as f32 + 0.5) - cx;
            let py = (y as f32 + 0.5) - cy;
            let d = sd_rounded_box(
                px,
                py,
                hw,
                hh,
                (corners.tl, corners.tr, corners.br, corners.bl),
            )
            .abs()
                - stroke_width / 2.0;
            let coverage = (0.5 - d).clamp(0.0, 1.0);
            if coverage <= 0.0 {
                continue;
            }
            canvas.blend_pixel(x, y, color.with_alpha_factor(coverage));
        }
    }
}

fn paint_shadow(canvas: &mut Canvas, rect: Rect, corners: crate::scene::Corners, elevation: u8) {
    let scale = 1.0; // Scene geometry is already in physical pixels.
    let (offset_y, sigma) = shadow_params(elevation, scale);
    let corners = corners.clamped(rect.w, rect.h);
    let (hw, hh) = (rect.w / 2.0, rect.h / 2.0);
    let (cx, cy) = (rect.x + hw, rect.y + hh + offset_y);
    let pad = (sigma * 3.0).ceil() as i64;
    let x0 = (rect.x.floor() as i64 - pad).max(0);
    let y0 = (rect.y.floor() as i64 - pad).max(0);
    let x1 = (rect.x + rect.w).ceil() as i64 + pad;
    let y1 = (rect.y + rect.h).ceil() as i64 + pad;
    let shadow_color = Rgba8 {
        r: 0,
        g: 0,
        b: 0,
        a: 255,
    };
    for y in y0..y1 {
        for x in x0..x1 {
            let px = (x as f32 + 0.5) - cx;
            let py = (y as f32 + 0.5) - cy;
            let d = sd_rounded_box(
                px,
                py,
                hw,
                hh,
                (corners.tl, corners.tr, corners.br, corners.bl),
            );
            let alpha = shadow_alpha(d, sigma) * 0.30;
            if alpha <= 0.003 {
                continue;
            }
            canvas.blend_pixel(x, y, shadow_color.with_alpha_factor(alpha));
        }
    }
}

fn paint_ripple(canvas: &mut Canvas, cx: f32, cy: f32, radius: f32, color: Rgba8) {
    if radius <= 0.0 || color.a == 0 {
        return;
    }
    let x0 = (cx - radius).floor().max(0.0) as i64;
    let y0 = (cy - radius).floor().max(0.0) as i64;
    let x1 = (cx + radius).ceil() as i64;
    let y1 = (cy + radius).ceil() as i64;
    for y in y0..y1 {
        for x in x0..x1 {
            let dx = (x as f32 + 0.5) - cx;
            let dy = (y as f32 + 0.5) - cy;
            let d = (dx * dx + dy * dy).sqrt() - radius;
            let coverage = (0.5 - d).clamp(0.0, 1.0);
            if coverage <= 0.0 {
                continue;
            }
            canvas.blend_pixel(x, y, color.with_alpha_factor(coverage));
        }
    }
}

fn paint_text(
    canvas: &mut Canvas,
    rect: Rect,
    text: &str,
    style: crate::scene::TypeStyleName,
    color: Rgba8,
) {
    let bitmap = rasterize_line(text, style, 1.0);
    canvas.blit_coverage(
        rect.x.round() as i64,
        rect.y.round() as i64,
        bitmap.width,
        bitmap.height,
        &bitmap.coverage,
        color,
    );
}

fn paint_icon(canvas: &mut Canvas, rect: Rect, path: &str, color: Rgba8) {
    if rect.is_empty() {
        return;
    }
    let subpaths = parse_svg_path(path);
    if subpaths.is_empty() {
        return;
    }
    let width = rect.w.round().max(1.0) as u32;
    let height = rect.h.round().max(1.0) as u32;
    // Material Symbols glyphs use a 24x24 viewBox by convention.
    let scale_x = f32::from(width as u16) / 24.0;
    let scale_y = f32::from(height as u16) / 24.0;
    let scaled: Vec<Vec<(f32, f32)>> = subpaths
        .into_iter()
        .map(|line| {
            line.into_iter()
                .map(|(x, y)| (x * scale_x, y * scale_y))
                .collect()
        })
        .collect();
    let coverage = rasterize_polylines(&scaled, width, height, 4);
    canvas.blit_coverage(
        rect.x.round() as i64,
        rect.y.round() as i64,
        width,
        height,
        &coverage,
        color,
    );
}

fn paint_image(canvas: &mut Canvas, rect: Rect, src_w: u32, src_h: u32, rgba: &[u8]) {
    if rect.is_empty() || src_w == 0 || src_h == 0 {
        return;
    }
    let dst_w = rect.w.round().max(1.0) as u32;
    let dst_h = rect.h.round().max(1.0) as u32;
    for dy in 0..dst_h {
        for dx in 0..dst_w {
            let sx = (dx * src_w / dst_w).min(src_w - 1);
            let sy = (dy * src_h / dst_h).min(src_h - 1);
            let idx = ((sy as usize) * (src_w as usize) + sx as usize) * 4;
            if idx + 4 > rgba.len() {
                continue;
            }
            let color = Rgba8 {
                r: rgba[idx],
                g: rgba[idx + 1],
                b: rgba[idx + 2],
                a: rgba[idx + 3],
            };
            canvas.blend_pixel(
                rect.x.round() as i64 + i64::from(dx),
                rect.y.round() as i64 + i64::from(dy),
                color,
            );
        }
    }
}

#[cfg(test)]
mod tests {
    use aphrody_m3_tokens::facade::color::{Role, Variant};

    use super::*;
    use crate::scene::{Corners, Node, Paint, Rect, Scene, StateKind};

    fn simple_scene() -> Scene {
        Scene {
            width: 64,
            height: 64,
            seed_argb: 0xFF67_50A4,
            variant: Variant::TonalSpot,
            is_dark: false,
            contrast_level: 0.0,
            background: Some(Paint::Role(Role::Surface)),
            nodes: vec![Node::Surface {
                rect: Rect::new(8.0, 8.0, 48.0, 32.0),
                corners: Corners::uniform(8.0),
                fill: Paint::Role(Role::PrimaryContainer),
                elevation: 2,
                outline: None,
            }],
        }
    }

    #[test]
    fn renders_correct_canvas_dimensions() {
        let canvas = render_scene(&simple_scene());
        assert_eq!(canvas.width, 64);
        assert_eq!(canvas.height, 64);
        assert_eq!(canvas.pixels.len(), 64 * 64 * 4);
    }

    #[test]
    fn background_fills_corners_and_surface_fills_center() {
        let canvas = render_scene(&simple_scene());
        let scheme = simple_scene().scheme();
        let bg = Rgba8::from_argb(scheme.argb(Role::Surface));
        let fill = Rgba8::from_argb(scheme.argb(Role::PrimaryContainer));
        let corner_idx = 0;
        assert_eq!(
            &canvas.pixels[corner_idx..corner_idx + 3],
            &[bg.r, bg.g, bg.b]
        );
        let center = ((32 * 64 + 32) * 4) as usize;
        assert_eq!(
            &canvas.pixels[center..center + 3],
            &[fill.r, fill.g, fill.b]
        );
    }

    #[test]
    fn rendering_is_deterministic() {
        let a = render_scene(&simple_scene());
        let b = render_scene(&simple_scene());
        assert_eq!(a.pixels, b.pixels);
    }

    #[test]
    fn png_encoding_round_trips_dimensions() {
        let png_bytes = render_scene_png(&simple_scene()).expect("encode");
        let decoder = png::Decoder::new(std::io::Cursor::new(png_bytes));
        let reader = decoder.read_info().expect("read header");
        let info = reader.info();
        assert_eq!(info.width, 64);
        assert_eq!(info.height, 64);
    }

    #[test]
    fn state_layer_lightens_opacity_only() {
        let mut scene = simple_scene();
        scene.nodes.push(Node::StateLayer {
            rect: Rect::new(8.0, 8.0, 48.0, 32.0),
            corners: Corners::uniform(8.0),
            content: Paint::Role(Role::OnPrimaryContainer),
            state: StateKind::Hover,
        });
        let canvas = render_scene(&scene);
        assert_eq!(canvas.pixels.len(), 64 * 64 * 4);
    }

    #[test]
    fn icon_path_paints_visible_pixels() {
        let mut scene = simple_scene();
        scene.nodes.push(Node::Icon {
            rect: Rect::new(4.0, 4.0, 24.0, 24.0),
            path: "M4 4 L20 4 L20 20 L4 20 Z".to_string(),
            color: Paint::Fixed(Rgba8 {
                r: 255,
                g: 0,
                b: 0,
                a: 255,
            }),
        });
        let canvas = render_scene(&scene);
        let idx = ((12 * 64 + 12) * 4) as usize;
        assert_eq!(canvas.pixels[idx], 255);
    }

    #[test]
    fn text_paints_visible_pixels() {
        let mut scene = simple_scene();
        scene.nodes.push(Node::Text {
            rect: Rect::new(2.0, 2.0, 60.0, 24.0),
            text: "M3".to_string(),
            style: crate::scene::TypeStyleName::TitleLarge,
            color: Paint::Fixed(Rgba8 {
                r: 0,
                g: 0,
                b: 0,
                a: 255,
            }),
        });
        let canvas = render_scene(&scene);
        assert!(
            canvas
                .pixels
                .chunks_exact(4)
                .any(|p| p[3] > 0 && p[0] < 200)
        );
    }
}
