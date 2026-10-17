// SPDX-License-Identifier: Apache-2.0

//! FFI surface for [`crate::icons`] (formerly the `aphrody-icons` crate, `svg` feature):
//! pixel-perfect Material Symbols SVG path/document generation for `bun:ffi` and WebAssembly
//! consumers. No icon font is shipped or loaded at runtime by the caller: [`crate::icons`] embeds
//! the pinned `material-symbols` fonts and name list at compile time, and both calls answer
//! `{"ok":false}` with [`crate::icons::SvgError::FontsUnavailable`] in a build without them.

use std::ffi::c_char;

use crate::icons::{Axes, Style};
use serde::Deserialize;

/// JSON request body for [`bun_rs_icon_svg`].
#[derive(Debug, Deserialize)]
struct IconRequest {
    name: String,
    #[serde(default)]
    style: Option<String>,
    #[serde(default)]
    fill: Option<f32>,
    #[serde(default)]
    weight: Option<f32>,
    #[serde(default)]
    grade: Option<f32>,
    #[serde(rename = "opticalSize", default)]
    optical_size: Option<f32>,
    #[serde(default)]
    size: Option<f32>,
}

fn parse_style(style: Option<&str>) -> Result<Style, String> {
    match style.unwrap_or("outlined").to_ascii_lowercase().as_str() {
        "outlined" => Ok(Style::Outlined),
        "rounded" => Ok(Style::Rounded),
        "sharp" => Ok(Style::Sharp),
        other => Err(format!(
            "unknown style: {other} (expected outlined|rounded|sharp)"
        )),
    }
}

/// Renders a Material Symbols icon to an SVG document string from a JSON [`IconRequest`]:
/// `{name, style?, fill?, weight?, grade?, opticalSize?, size?}`.
///
/// # Errors
/// Invalid JSON, unknown style, or unknown icon name for the resolved style.
pub fn icon_svg_json(request_json: &str) -> Result<String, String> {
    let request: IconRequest =
        serde_json::from_str(request_json).map_err(|e| format!("invalid request: {e}"))?;
    let style = parse_style(request.style.as_deref())?;
    if !crate::icons::available() {
        return Err(crate::icons::SvgError::FontsUnavailable.to_string());
    }
    let axes = Axes {
        fill: request.fill.unwrap_or(0.0),
        weight: request.weight.unwrap_or(400.0),
        grade: request.grade.unwrap_or(0.0),
        optical_size: request.optical_size.unwrap_or(24.0),
    };
    crate::icons::icon_svg(&request.name, style, axes, request.size)
        .ok_or_else(|| format!("unknown icon: {}", request.name))
}

/// Render a Material Symbols icon as an SVG document. `request` is a UTF-8 JSON
/// [`IconRequest`]. Returns a JSON envelope, `{"ok":true,"svg":...}` or
/// `{"ok":false,"error":...}`, to free with `bun_rs_free_string`.
///
/// # Safety
/// * `request` must point to `len` readable bytes.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn bun_rs_icon_svg(request: *const u8, len: usize) -> *mut c_char {
    let result = if request.is_null() {
        Err("null request".to_owned())
    } else {
        // SAFETY: caller guarantees the pointer covers `len` bytes.
        let bytes = unsafe { std::slice::from_raw_parts(request, len) };
        std::str::from_utf8(bytes)
            .map_err(|e| e.to_string())
            .and_then(icon_svg_json)
    };
    let envelope = match result {
        Ok(svg) => serde_json::json!({ "ok": true, "svg": svg }),
        Err(error) => serde_json::json!({ "ok": false, "error": error }),
    };
    std::ffi::CString::new(envelope.to_string())
        .expect("JSON has no NUL")
        .into_raw()
}

/// Lists every known icon name for `style` (`"outlined"|"rounded"|"sharp"`) as a JSON array.
///
/// # Safety
/// * `style` must point to `len` readable UTF-8 bytes.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn bun_rs_icon_names(style: *const u8, len: usize) -> *mut c_char {
    let result = if style.is_null() {
        Err("null style".to_owned())
    } else {
        // SAFETY: caller guarantees the pointer covers `len` bytes.
        let bytes = unsafe { std::slice::from_raw_parts(style, len) };
        std::str::from_utf8(bytes)
            .map_err(|e| e.to_string())
            .and_then(|s| parse_style(Some(s)))
            .and_then(|style| {
                crate::icons::available()
                    .then_some(style)
                    .ok_or_else(|| crate::icons::SvgError::FontsUnavailable.to_string())
            })
    };
    let envelope = match result {
        Ok(style) => {
            let names: Vec<&str> = crate::icons::icon_names(style).collect();
            serde_json::json!({ "ok": true, "names": names })
        }
        Err(error) => serde_json::json!({ "ok": false, "error": error }),
    };
    std::ffi::CString::new(envelope.to_string())
        .expect("JSON has no NUL")
        .into_raw()
}
