// SPDX-License-Identifier: Apache-2.0
//! Deterministic text rasterization shared by every backend.
//!
//! Both the CPU rasterizer and the GPU backend composite the *same* glyph
//! coverage bitmaps: this module rasterizes text once, on the CPU, using
//! `fontdue` (a pure-Rust TrueType rasterizer). The GPU backend uploads the
//! resulting coverage as a texture instead of re-rasterizing glyphs, which is
//! what keeps the two backends within the documented per-pixel tolerance.
//!
//! The default embedded face is Google Sans Flex
//! (`aphrody_m3_tokens::google_sans_flex::TTF_DATA`).

use std::sync::OnceLock;

use crate::scene::TypeStyleName;

/// Bytes of the embedded Google Sans Flex variable font.
static GOOGLE_SANS_FLEX_BYTES: &[u8] = aphrody_m3_tokens::google_sans_flex::TTF_DATA;

fn face() -> &'static fontdue::Font {
    static FACE: OnceLock<fontdue::Font> = OnceLock::new();
    FACE.get_or_init(|| {
        fontdue::Font::from_bytes(GOOGLE_SANS_FLEX_BYTES, fontdue::FontSettings::default())
            .expect("embedded Google Sans Flex must parse")
    })
}

/// A single-channel (alpha) coverage bitmap for one shaped run.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RasterizedText {
    /// Bitmap width, in pixels.
    pub width: u32,
    /// Bitmap height, in pixels.
    pub height: u32,
    /// Row-major coverage, one byte per pixel (`0` transparent, `255` opaque).
    pub coverage: Vec<u8>,
}

/// Rasterize `text` in `style` at the M3 dp size scaled by `scale` (physical
/// pixels per dp). Layout is a single line, left-to-right, using the font's
/// horizontal advance metrics; it does not perform BiDi or line wrapping.
#[must_use]
pub fn rasterize_line(text: &str, style: TypeStyleName, scale: f32) -> RasterizedText {
    if text.contains('\n') {
        return rasterize_multiline(text, style, scale);
    }
    let type_style = style.style();
    let px = (type_style.size_dp * scale).max(1.0);
    let font = face();

    struct Placed {
        coverage: Vec<u8>,
        cursor_x: f32,
        w: usize,
        h: usize,
        ymin: f32,
    }
    let mut placed: Vec<Placed> = Vec::with_capacity(text.chars().count());
    let mut cursor = 0.0_f32;
    for ch in text.chars() {
        let (metrics, coverage) = font.rasterize(ch, px);
        placed.push(Placed {
            coverage,
            cursor_x: cursor,
            w: metrics.width,
            h: metrics.height,
            ymin: metrics.ymin as f32,
        });
        cursor += metrics.advance_width;
    }
    let total_width = cursor.ceil().max(1.0) as u32;
    let line_height = (type_style.line_height_dp * scale).max(1.0);
    let ascent_px = px; // baseline placed one em from the top, a stable and
    // deterministic approximation shared by both backends.
    let total_height = line_height.ceil().max(1.0) as u32;

    let mut canvas = vec![0_u8; (total_width as usize) * (total_height as usize)];
    for glyph in &placed {
        if glyph.w == 0 || glyph.h == 0 {
            continue;
        }
        let baseline_y = ascent_px - glyph.ymin - glyph.h as f32;
        let dst_x0 = glyph.cursor_x.round() as i64;
        let dst_y0 = baseline_y.round() as i64;
        for row in 0..glyph.h {
            let dy = dst_y0 + row as i64;
            if dy < 0 || dy >= i64::from(total_height) {
                continue;
            }
            for col in 0..glyph.w {
                let dx = dst_x0 + col as i64;
                if dx < 0 || dx >= i64::from(total_width) {
                    continue;
                }
                let src = glyph.coverage[row * glyph.w + col];
                if src == 0 {
                    continue;
                }
                let idx = (dy as usize) * (total_width as usize) + dx as usize;
                canvas[idx] = canvas[idx].max(src);
            }
        }
    }

    RasterizedText { width: total_width, height: total_height, coverage: canvas }
}

/// Rasterize `text` in `style` at the M3 dp size scaled by `scale` (physical
/// pixels per dp). If the text contains newline characters (`\n`), lines are
/// laid out vertically according to M3 line-height metrics.
#[must_use]
pub fn rasterize_multiline(text: &str, style: TypeStyleName, scale: f32) -> RasterizedText {
    let type_style = style.style();
    let px = (type_style.size_dp * scale).max(1.0);
    let line_height = (type_style.line_height_dp * scale).max(1.0);
    let font = face();

    struct Placed {
        coverage: Vec<u8>,
        cursor_x: f32,
        w: usize,
        h: usize,
        ymin: f32,
        line_idx: usize,
    }

    let lines: Vec<&str> = text.lines().collect();
    if lines.is_empty() {
        return RasterizedText {
            width: 1,
            height: line_height.ceil().max(1.0) as u32,
            coverage: vec![0; line_height.ceil().max(1.0) as usize],
        };
    }

    let mut placed: Vec<Placed> = Vec::with_capacity(text.chars().count());
    let mut max_width = 0.0_f32;

    for (line_idx, line) in lines.iter().enumerate() {
        let mut cursor = 0.0_f32;
        for ch in line.chars() {
            let (metrics, coverage) = font.rasterize(ch, px);
            placed.push(Placed {
                coverage,
                cursor_x: cursor,
                w: metrics.width,
                h: metrics.height,
                ymin: metrics.ymin as f32,
                line_idx,
            });
            cursor += metrics.advance_width;
        }
        if cursor > max_width {
            max_width = cursor;
        }
    }

    let total_width = max_width.ceil().max(1.0) as u32;
    let total_height = (line_height * lines.len() as f32).ceil().max(1.0) as u32;
    let ascent_px = px;

    let mut canvas = vec![0_u8; (total_width as usize) * (total_height as usize)];
    for glyph in &placed {
        if glyph.w == 0 || glyph.h == 0 {
            continue;
        }
        let baseline_y =
            ascent_px + (glyph.line_idx as f32 * line_height) - glyph.ymin - glyph.h as f32;
        let dst_x0 = glyph.cursor_x.round() as i64;
        let dst_y0 = baseline_y.round() as i64;
        for row in 0..glyph.h {
            let dy = dst_y0 + row as i64;
            if dy < 0 || dy >= i64::from(total_height) {
                continue;
            }
            for col in 0..glyph.w {
                let dx = dst_x0 + col as i64;
                if dx < 0 || dx >= i64::from(total_width) {
                    continue;
                }
                let src = glyph.coverage[row * glyph.w + col];
                if src == 0 {
                    continue;
                }
                let idx = (dy as usize) * (total_width as usize) + dx as usize;
                canvas[idx] = canvas[idx].max(src);
            }
        }
    }

    RasterizedText { width: total_width, height: total_height, coverage: canvas }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_string_yields_minimal_canvas() {
        let text = rasterize_line("", TypeStyleName::BodyMedium, 1.0);
        assert!(text.width >= 1);
        assert!(text.height >= 1);
        assert!(text.coverage.iter().all(|&b| b == 0));
    }

    #[test]
    fn non_empty_string_paints_some_coverage() {
        let text = rasterize_line("Aphrody", TypeStyleName::TitleLarge, 2.0);
        assert!(text.coverage.iter().any(|&b| b > 0), "expected non-zero glyph coverage");
    }

    #[test]
    fn rasterization_is_deterministic() {
        let a = rasterize_line("M3", TypeStyleName::LabelLarge, 1.5);
        let b = rasterize_line("M3", TypeStyleName::LabelLarge, 1.5);
        assert_eq!(a, b);
    }

    #[test]
    fn multiline_rasterization_stacks_lines() {
        let single = rasterize_line("Aphrody", TypeStyleName::BodyMedium, 1.0);
        let multi = rasterize_multiline("Aphrody\nOS", TypeStyleName::BodyMedium, 1.0);
        assert!(multi.height > single.height, "multiline height must exceed single line");
        assert!(
            multi.coverage.iter().any(|&b| b > 0),
            "multiline coverage must contain painted pixels"
        );
    }
}
