// SPDX-License-Identifier: Apache-2.0

//! Pixel-perfect SVG paths from the embedded Material Symbols variable fonts.
//!
//! The fonts embedded by this crate are decoded once per process (WOFF2 -> TTF); the name ->
//! glyph resolution through the font's `GSUB` ligatures (`rlig`; Google's `.codepoints` tables
//! drift between releases), axis instancing and the `0 -960 960 960` pen live in
//! `aphrody_svg::symbols`, shared with `aphrody-identity`. `tests/icons_svg_parity.rs` checks
//! the output against Google's own SVG exports.
//!
//! [`Style::icon_names`] lists the names the same package release declares in its `index.d.ts`.

use std::sync::{Arc, OnceLock};

use aphrody_svg::{
    glyph::NumberFormat,
    symbols::{SymbolAxes, decode_font, symbol_path},
};

/// The three Material Symbols variable-font styles this module can render.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, serde::Serialize, serde::Deserialize)]
pub enum Style {
    Outlined,
    Rounded,
    Sharp,
}

impl Style {
    fn slot(self) -> &'static OnceLock<Arc<[u8]>> {
        static OUTLINED: OnceLock<Arc<[u8]>> = OnceLock::new();
        static ROUNDED: OnceLock<Arc<[u8]>> = OnceLock::new();
        static SHARP: OnceLock<Arc<[u8]>> = OnceLock::new();
        match self {
            Self::Outlined => &OUTLINED,
            Self::Rounded => &ROUNDED,
            Self::Sharp => &SHARP,
        }
    }

    /// Decoded (WOFF2 -> TTF) bytes for this style, decoded once per process.
    fn ttf_bytes(self) -> Result<Arc<[u8]>, SvgError> {
        if let Some(bytes) = self.slot().get() {
            return Ok(bytes.clone());
        }
        let woff2 = self.woff2_data().ok_or(SvgError::FontsUnavailable)?;
        let ttf = decode_font(woff2).map_err(|e| SvgError::Woff2(e.to_string()))?;
        let arc: Arc<[u8]> = Arc::from(ttf.into_owned());
        // Another thread may have raced us; `OnceLock::get_or_init` would need a closure that
        // can fail, so settle for `set` and re-read on the (rare, harmless) loss.
        let _ = self.slot().set(arc);
        Ok(self.slot().get().expect("just set").clone())
    }

    /// Iterates every icon name of the embedded package, in lexicographic order (the three
    /// styles of one release ship the same names; empty without the fonts).
    pub fn icon_names(self) -> impl Iterator<Item = &'static str> {
        let _ = self;
        static NAMES: OnceLock<Vec<&'static str>> = OnceLock::new();
        NAMES
            .get_or_init(|| {
                let mut names: Vec<&'static str> = super::package_names().collect();
                names.sort_unstable();
                names.dedup();
                names
            })
            .iter()
            .copied()
    }
}

/// Variable-font axis values understood by the Material Symbols family.
///
/// Ranges follow the published Material Symbols variable font axes:
/// `FILL` 0..1, `wght` 100..700, `GRAD` -25..200, `opsz` 20..48.
#[derive(Debug, Clone, Copy, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct Axes {
    pub fill: f32,
    pub weight: f32,
    pub grade: f32,
    pub optical_size: f32,
}

impl Default for Axes {
    fn default() -> Self {
        Self {
            fill: 0.0,
            weight: 400.0,
            grade: 0.0,
            optical_size: 24.0,
        }
    }
}

impl From<Axes> for SymbolAxes {
    fn from(a: Axes) -> Self {
        Self {
            fill: a.fill,
            weight: a.weight,
            grade: a.grade,
            optical_size: a.optical_size,
        }
    }
}

/// Errors that can occur while decoding a font or rendering an icon.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub enum SvgError {
    /// The build does not embed the Material Symbols fonts (see `build.rs`).
    FontsUnavailable,
    Woff2(String),
    Font(String),
}

impl core::fmt::Display for SvgError {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        match self {
            Self::FontsUnavailable => f.write_str(
                "Material Symbols fonts are not embedded: from Material run `bun packages/m3/scripts/fonts-sync.ts` or set \
                 APHRODY_SYMBOLS_DIR, then rebuild aphrody-bun",
            ),
            Self::Woff2(msg) => write!(f, "WOFF2 decode failed: {msg}"),
            Self::Font(msg) => write!(f, "font parse failed: {msg}"),
        }
    }
}

impl std::error::Error for SvgError {}

/// Returns just the SVG path `d` attribute value for `name`, in the font's own
/// `unitsPerEm` grid renormalized to Google's `0 -960 960 960` convention
/// (i.e. independent of `size`; `size` only changes the `width`/`height` returned
/// by [`icon_svg`]).
pub fn icon_path(name: &str, style: Style, axes: Axes) -> Result<Option<String>, SvgError> {
    if !name.is_ascii() || name.is_empty() {
        return Ok(None);
    }
    let ttf = style.ttf_bytes()?;
    // Ligature lookup, axis clamping and the 960-grid pen live in `aphrody_svg::symbols`; fixed
    // two-decimal output keeps generated paths byte-stable.
    symbol_path(&ttf, name, axes.into(), NumberFormat::Fixed(2))
        .map_err(|e| SvgError::Font(e.to_string()))
}

/// Renders `name` (a Material Symbols icon name, e.g. `"home"`, `"favorite"`) as a
/// standalone SVG document string, pixel-perfect against Google's own
/// `materialsymbols{style}` SVG exports for the same axis values.
///
/// `size` sets the `width`/`height` attributes in CSS pixels (defaults to `24.0`); the
/// `viewBox` always stays `0 -960 960 960` to match the upstream convention regardless of
/// requested size. Returns `Ok(None)` if `name` is not a known icon for `style`.
pub fn icon_svg(name: &str, style: Style, axes: Axes, size: Option<f32>) -> Option<String> {
    let path = icon_path(name, style, axes).ok().flatten()?;
    let size = size.unwrap_or(24.0);
    Some(format!(
        "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"{size}\" height=\"{size}\" viewBox=\"0 \
         -960 960 960\"><path d=\"{path}\"/></svg>",
    ))
}

/// Iterates every icon name known for `style`.
pub fn icon_names(style: Style) -> impl Iterator<Item = &'static str> {
    style.icon_names()
}
