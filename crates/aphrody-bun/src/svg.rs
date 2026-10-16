// SPDX-License-Identifier: Apache-2.0

//! FFI surface of `aphrody-svg` for `bun:ffi` (`@aphrody/svg`). One JSON-in / JSON-out entry
//! point, `bun_rs_svg`, dispatches on `op`; binary outputs (PNG, ICO, RGBA) and font inputs are
//! base64. All behaviour lives in `aphrody-svg`; this module only (de)serializes.

use std::ffi::c_char;

use aphrody_svg::{
    diff, glyph,
    optimize::{self, OptimizeOptions},
    raster::{self, RenderOptions},
    sanitize::{self, SanitizeOptions},
    sprite::{self, SpriteEntry},
    theme::{self, Theme},
    viewbox::{self, Sizing},
};
use base64::{Engine as _, engine::general_purpose::STANDARD as B64};
use serde::Deserialize;
use serde_json::{Value, json};

#[derive(Debug, Deserialize)]
#[serde(tag = "op", rename_all = "camelCase")]
enum Request {
    Sanitize {
        svg: String,
        #[serde(default, rename = "allowExternalRefs")]
        allow_external_refs: bool,
        #[serde(default = "yes", rename = "stripMetadata")]
        strip_metadata: bool,
    },
    Geometry {
        svg: String,
    },
    Normalize {
        svg: String,
        /// `"keep" | "responsive" | "fixed"`.
        #[serde(default)]
        sizing: Option<String>,
        #[serde(default)]
        width: Option<f64>,
        #[serde(default)]
        height: Option<f64>,
    },
    Theme {
        svg: String,
        #[serde(default, rename = "currentColor")]
        current_color: Option<String>,
        #[serde(default)]
        vars: std::collections::BTreeMap<String, String>,
        #[serde(default)]
        remap: std::collections::BTreeMap<String, String>,
        /// Baseline M3 roles as `--md-sys-color-*` (applied before `vars`).
        #[serde(default)]
        m3: bool,
    },
    Sprite {
        entries: Vec<SpriteItem>,
    },
    Optimize {
        svg: String,
        #[serde(default, rename = "coordinatesPrecision")]
        coordinates_precision: Option<u8>,
        #[serde(default, rename = "preserveText")]
        preserve_text: bool,
        #[serde(default)]
        pretty: bool,
    },
    Render {
        svg: String,
        #[serde(default)]
        width: Option<u32>,
        #[serde(default)]
        height: Option<u32>,
        #[serde(default)]
        background: Option<[u8; 4]>,
        #[serde(default, rename = "systemFonts")]
        system_fonts: bool,
        /// `"png"` (default) or `"rgba"`.
        #[serde(default)]
        format: Option<String>,
    },
    Ico {
        svg: String,
        #[serde(default)]
        sizes: Option<Vec<u32>>,
    },
    Diff {
        a: String,
        b: String,
        #[serde(default = "default_diff_size")]
        size: u32,
        #[serde(default)]
        tolerance: u8,
    },
    Glyph {
        /// Base64 TTF/OTF bytes.
        font: String,
        #[serde(default)]
        char: Option<String>,
        #[serde(default, rename = "glyphId")]
        glyph_id: Option<u32>,
        #[serde(default)]
        axes: std::collections::BTreeMap<String, f32>,
        #[serde(default, rename = "unitsPerEm")]
        units_per_em: Option<f32>,
        #[serde(default, rename = "fontIndex")]
        font_index: u32,
        #[serde(default)]
        height: Option<f32>,
    },
}

#[derive(Debug, Deserialize)]
struct SpriteItem {
    id: String,
    svg: String,
}

const fn yes() -> bool {
    true
}
const fn default_diff_size() -> u32 {
    256
}

fn run(request: Request) -> Result<Value, String> {
    let e = |e: aphrody_svg::Error| e.to_string();
    Ok(match request {
        Request::Sanitize { svg, allow_external_refs, strip_metadata } => {
            let opts = SanitizeOptions { allow_external_refs, strip_metadata };
            json!({ "svg": sanitize::sanitize(&svg, opts).map_err(e)? })
        },
        Request::Geometry { svg } => {
            let g = viewbox::geometry(&svg).map_err(e)?;
            json!({
                "viewBox": g.view_box.map(|v| [v.x, v.y, v.width, v.height]),
                "width": g.width,
                "height": g.height,
                "size": g.size().map(|(w, h)| [w, h]),
            })
        },
        Request::Normalize { svg, sizing, width, height } => {
            let sizing = match sizing.as_deref().unwrap_or("keep") {
                "keep" => Sizing::Keep,
                "responsive" => Sizing::Responsive,
                "fixed" => Sizing::Fixed { width, height },
                other => return Err(format!("unknown sizing {other} (keep|responsive|fixed)")),
            };
            json!({ "svg": viewbox::normalize(&svg, sizing).map_err(e)? })
        },
        Request::Theme { svg, current_color, vars, remap, m3 } => {
            let mut t =
                if m3 { Theme::m3(&aphrody_m3_tokens::color::BASELINE) } else { Theme::new() };
            if let Some(c) = current_color {
                t = t.current_color(c);
            }
            t = t.vars(vars);
            for (from, to) in remap {
                t = t.remap(&from, to);
            }
            json!({ "svg": theme::apply(&svg, &t).map_err(e)? })
        },
        Request::Sprite { entries } => {
            let items: Vec<SpriteEntry<'_>> =
                entries.iter().map(|i| SpriteEntry { id: &i.id, svg: &i.svg }).collect();
            json!({ "svg": sprite::sprite(&items).map_err(e)? })
        },
        Request::Optimize { svg, coordinates_precision, preserve_text, pretty } => {
            let mut opts = OptimizeOptions { preserve_text, pretty, ..OptimizeOptions::default() };
            if let Some(p) = coordinates_precision {
                opts.coordinates_precision = p;
            }
            json!({ "svg": optimize::optimize(&svg, opts).map_err(e)? })
        },
        Request::Render { svg, width, height, background, system_fonts, format } => {
            let opts = RenderOptions { width, height, background, system_fonts };
            match format.as_deref().unwrap_or("png") {
                "png" => json!({ "png": B64.encode(raster::render_png(&svg, opts).map_err(e)?) }),
                "rgba" => {
                    let r = raster::render(&svg, opts).map_err(e)?;
                    json!({ "width": r.width, "height": r.height, "rgba": B64.encode(r.rgba) })
                },
                other => return Err(format!("unknown format {other} (png|rgba)")),
            }
        },
        Request::Ico { svg, sizes } => {
            let sizes = sizes.unwrap_or_else(|| raster::FAVICON_ICO_SIZES.to_vec());
            json!({ "ico": B64.encode(raster::render_ico(&svg, &sizes).map_err(e)?) })
        },
        Request::Diff { a, b, size, tolerance } => {
            let d = diff::diff_svg(&a, &b, size, tolerance).map_err(e)?;
            json!({
                "width": d.width, "height": d.height, "mismatchedPixels": d.mismatched_pixels,
                "mismatchedPct": d.mismatched_pct, "maxDelta": d.max_delta, "meanDelta": d.mean_delta,
                "match": d.is_match(),
            })
        },
        Request::Glyph { font, char, glyph_id, axes, units_per_em, font_index, height } => {
            let bytes = B64.decode(font).map_err(|err| format!("font is not base64: {err}"))?;
            let which = match (char.as_deref().and_then(|s| s.chars().next()), glyph_id) {
                (Some(c), _) => glyph::Glyph::Char(c),
                (None, Some(id)) => glyph::Glyph::Id(id),
                (None, None) => return Err("glyph needs `char` or `glyphId`".into()),
            };
            let opts = glyph::GlyphOptions {
                font_index,
                axes: axes.into_iter().collect(),
                units_per_em,
                ..glyph::GlyphOptions::default()
            };
            match glyph::glyph_outline(&bytes, which, &opts).map_err(e)? {
                Some(g) => json!({
                    "path": g.path, "advance": g.advance, "ascent": g.ascent, "descent": g.descent,
                    "unitsPerEm": g.units_per_em, "svg": g.to_svg(height),
                }),
                None => Value::Null,
            }
        },
    })
}

/// Runs one JSON request (see [`Request`]) and returns the JSON envelope string.
#[must_use]
pub fn svg_json(request: &str) -> String {
    let result = serde_json::from_str::<Request>(request)
        .map_err(|e| format!("invalid request: {e}"))
        .and_then(run);
    match result {
        Ok(value) => json!({ "ok": true, "value": value }),
        Err(error) => json!({ "ok": false, "error": error }),
    }
    .to_string()
}

/// `aphrody-svg` over `bun:ffi`: `request` is a UTF-8 JSON object with an `op` field
/// (`sanitize`, `geometry`, `normalize`, `theme`, `sprite`, `optimize`, `render`, `ico`,
/// `diff`, `glyph`). Returns `{"ok":true,"value":...}` or `{"ok":false,"error":...}`, to free
/// with `bun_rs_free_string`.
///
/// # Safety
/// * `request` must point to `len` readable bytes.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn bun_rs_svg(request: *const u8, len: usize) -> *mut c_char {
    let envelope = if request.is_null() {
        json!({ "ok": false, "error": "null request" }).to_string()
    } else {
        // SAFETY: caller guarantees the pointer covers `len` bytes.
        let bytes = unsafe { std::slice::from_raw_parts(request, len) };
        match std::str::from_utf8(bytes) {
            Ok(text) => svg_json(text),
            Err(err) => json!({ "ok": false, "error": err.to_string() }).to_string(),
        }
    };
    std::ffi::CString::new(envelope).expect("JSON has no NUL").into_raw()
}

#[cfg(test)]
mod tests {
    use super::svg_json;

    #[test]
    fn dispatches_ops() {
        let svg = r#"<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 4 4\" onload=\"x()\"><rect width=\"4\" height=\"4\" fill=\"currentColor\"/></svg>"#;
        let out = svg_json(&format!(r#"{{"op":"sanitize","svg":"{svg}"}}"#));
        assert!(out.contains(r#""ok":true"#) && !out.contains("onload"), "{out}");
        let out = svg_json(&format!(r#"{{"op":"render","svg":"{svg}","width":8}}"#));
        assert!(out.contains(r#""png":"iVBOR"#), "{out}");
        let out = svg_json(&format!(r##"{{"op":"theme","svg":"{svg}","m3":true}}"##));
        assert!(out.contains("#1D1B20") || out.contains("#1C1B1F"), "{out}");
        assert!(svg_json(r#"{"op":"nope"}"#).contains(r#""ok":false"#));
    }
}
