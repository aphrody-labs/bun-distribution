// SPDX-License-Identifier: Apache-2.0

//! `aphrody-svg`: the single SVG owner of the Aphrody ecosystem.
//!
//! Every repository that reads, writes, cleans, recolours or rasterizes SVG goes through this
//! crate instead of carrying its own `resvg` call, sanitizer, sprite builder or glyph pen. The
//! inventory of the implementations it replaces lives in `m3/docs/reference/SVG.md`.
//!
//! | Module | Capability | Backend |
//! | --- | --- | --- |
//! | [`sanitize`] | strip scripts, event handlers, `javascript:`/external references, editor metadata | `roxmltree` |
//! | [`viewbox`] | read the `viewBox`, synthesize it from `width`/`height`, resize | `svgtypes` |
//! | [`theme`] | resolve `currentColor`, `var(--md-sys-color-*)` and explicit colour remaps | `svgtypes` |
//! | [`sprite`] | `<symbol>` sheets with collision-free ids | `roxmltree` |
//! | [`glyph`] (feature `glyph`) | font glyph outline to SVG path data, variable axes, `GSUB` ligatures | `skrifa` |
//! | [`symbols`] (feature `symbols`) | Material Symbols by name: 960-grid paths, gstatic layout, WOFF2 | `skrifa`, `woff2` |
//! | [`optimize`] (feature `raster`) | usvg-normalized, precision-bounded output | `usvg` |
//! | [`raster`] (feature `raster`) | SVG to RGBA, PNG, multi-size ICO | `resvg`, `tiny-skia` |
//! | [`diff`] (feature `raster`) | pixel comparison of two SVGs or two RGBA buffers | `resvg` |
//!
//! Everything works on `&str` in memory; no module touches the filesystem, so the crate is safe
//! for FFI (`aphrody-bun`), WebAssembly and servers alike.

mod error;
mod xml;

pub mod sanitize;
pub mod sprite;
pub mod theme;
pub mod viewbox;

#[cfg(feature = "glyph")]
pub mod glyph;
#[cfg(feature = "symbols")]
pub mod symbols;

#[cfg(feature = "raster")]
pub mod diff;
#[cfg(feature = "raster")]
pub mod optimize;
#[cfg(feature = "raster")]
pub mod raster;

pub use error::{Error, Result};

/// The SVG namespace.
pub const SVG_NS: &str = "http://www.w3.org/2000/svg";
/// The XLink namespace (legacy `xlink:href`).
pub const XLINK_NS: &str = "http://www.w3.org/1999/xlink";

/// Formats a number with at most `precision` decimals and no trailing zeros (`1.50` -> `1.5`,
/// `-0.00` -> `0`). Shared by every module that writes coordinates.
#[must_use]
pub fn format_number(value: f64, precision: u8) -> String {
    let mut out = format!("{value:.prec$}", prec = usize::from(precision));
    if out.contains('.') {
        while out.ends_with('0') {
            out.pop();
        }
        if out.ends_with('.') {
            out.pop();
        }
    }
    if out == "-0" {
        out.remove(0);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::format_number;

    #[test]
    fn numbers_are_trimmed() {
        assert_eq!(format_number(1.5, 2), "1.5");
        assert_eq!(format_number(2.0, 3), "2");
        assert_eq!(format_number(-0.0001, 2), "0");
        assert_eq!(format_number(-12.345, 2), "-12.35");
        assert_eq!(format_number(7.0, 0), "7");
    }
}
