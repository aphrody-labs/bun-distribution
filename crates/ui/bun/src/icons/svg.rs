// SPDX-License-Identifier: Apache-2.0

//! Pixel-perfect SVG path generation from the embedded Material Symbols variable fonts.
//!
//! This module never rasterizes and never ships a font at runtime: it decodes the WOFF2
//! bytes already embedded by this crate once (pure-Rust `woff2` decoder, itself backed by
//! the pure-Rust `brotli` decompressor), instances the variable font at the requested axis
//! values with `skrifa`/`read-fonts` (the [fontations](https://github.com/googlefonts/fontations)
//! stack used by Chrome, Android and `resvg`), and walks the resulting outline into an SVG
//! path string with the same coordinate convention Google ships in its own
//! `materialsymbols*` SVG exports: `viewBox="0 -960 960 960"`, i.e. `x_svg = x_font`,
//! `y_svg = -y_font`, with the variable font's `unitsPerEm` equal to `1000` (verified by
//! `tests/icons_svg_parity.rs` against real Google-exported fixtures).
//!
//! Name resolution resolves the glyph for an icon name the same way a browser does: through
//! the font's own `GSUB` ligature lookup, substituting the sequence of glyphs for the ASCII
//! name (e.g. `h`, `o`, `m`, `e`) with the single glyph that carries the
//! `wght`/`FILL`/`GRAD`/`opsz` deltas for that icon. Material Symbols implements this under the
//! `rlig` ("Required Ligatures", always applied by a shaper) feature rather than the optional
//! `liga` feature its own CSS references (there is no `liga` feature in these fonts at all);
//! both tags are accepted defensively. This was chosen over a fixed name -> Private Use Area
//! codepoint table after empirically finding that Google's published `.codepoints` files (one
//! per font *release*) drift out of sync with specific embedded font builds — e.g. `search`'s
//! codepoint in the upstream table has no `cmap` entry at all in the `material-symbols`
//! 0.44.8 fonts embedded here, because Google reassigns a few codepoints between releases as
//! icons are added. Reading `GSUB` directly is exact for whatever font bytes are actually
//! embedded, at the cost of implementing a small ligature-substitution-only subset of OpenType
//! shaping (`LookupType 4`, optionally indirected through `LookupType 7`, single-script `liga`
//! feature; Material Symbols does not need base "reordering" glyph shaping otherwise).
//!
//! [`Style::icon_names`] lists the names the same package release declares in its `index.d.ts`.

use std::sync::{Arc, OnceLock};

use aphrody_svg::glyph::{NumberFormat, SvgPathPen};

use read_fonts::{
    TableProvider,
    tables::gsub::SubstitutionLookup,
    types::{GlyphId, Tag},
};
use skrifa::{FontRef, MetadataProvider, instance::Size, outline::DrawSettings};

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
        let mut cursor = std::io::Cursor::new(self.woff2_data().ok_or(SvgError::FontsUnavailable)?);
        let ttf = woff2::convert_woff2_to_ttf(&mut cursor)
            .map_err(|e| SvgError::Woff2(format!("{e}")))?;
        let arc: Arc<[u8]> = Arc::from(ttf);
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
        Self { fill: 0.0, weight: 400.0, grade: 0.0, optical_size: 24.0 }
    }
}

impl Axes {
    fn clamped(self) -> Self {
        Self {
            fill: self.fill.clamp(0.0, 1.0),
            weight: self.weight.clamp(100.0, 700.0),
            grade: self.grade.clamp(-25.0, 200.0),
            optical_size: self.optical_size.clamp(20.0, 48.0),
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
                "Material Symbols fonts are not embedded: run `bun m3/scripts/fonts-sync.ts` or set \
                 APHRODY_SYMBOLS_DIR, then rebuild aphrody-bun",
            ),
            Self::Woff2(msg) => write!(f, "WOFF2 decode failed: {msg}"),
            Self::Font(msg) => write!(f, "font parse failed: {msg}"),
        }
    }
}

impl std::error::Error for SvgError {}

/// The Google Material Symbols SVG grid: `viewBox="0 -960 960 960"`.
const GRID_UNITS: f32 = 960.0;

/// Resolves `name` (an ASCII icon name, e.g. `"home"`) to the glyph its `GSUB` `liga` lookup
/// substitutes the per-character glyph sequence with, exactly like a text shaper (HarfBuzz,
/// DirectWrite, CoreText) would when rendering the name string with `font-feature-settings:
/// "liga"` as Material Symbols' own CSS does. Returns `None` if any character has no `cmap`
/// entry, or no ligature rule matches the full sequence.
fn ligature_glyph_for_name(font: &FontRef, name: &str) -> Option<GlyphId> {
    let charmap = font.charmap();
    let mut chars = name.chars();
    let first_glyph = charmap.map(chars.next()?)?;
    let rest_glyphs: Vec<GlyphId> = chars.map(|c| charmap.map(c)).collect::<Option<_>>()?;

    let gsub = font.gsub().ok()?;
    let script_list = gsub.script_list().ok()?;
    let feature_list = gsub.feature_list().ok()?;
    let lookup_list = gsub.lookup_list().ok()?;

    let script_record = script_list
        .script_records()
        .iter()
        .find(|r| r.script_tag() == Tag::new(b"DFLT"))
        .or_else(|| {
            script_list.script_records().iter().find(|r| r.script_tag() == Tag::new(b"latn"))
        })
        .or_else(|| script_list.script_records().first())?;
    let script = script_record.script(script_list.offset_data()).ok()?;
    let lang_sys = script.default_lang_sys()?.ok()?;

    // Material Symbols implements its name ligatures under `rlig` ("Required Ligatures", always
    // applied by a shaper, unlike optional `liga`) rather than `liga` itself; there is no `liga`
    // feature in these fonts at all (verified against the embedded `material-symbols` 0.44.8
    // fonts). Accept either tag defensively.
    let ligature_feature_tags = [Tag::new(b"rlig"), Tag::new(b"liga")];
    let lookup_indices = lang_sys.feature_indices().iter().filter_map(|idx| {
        let record = feature_list.feature_records().get(idx.get() as usize)?;
        ligature_feature_tags
            .contains(&record.feature_tag())
            .then(|| record.feature(feature_list.offset_data()).ok())
            .flatten()
    });

    // Every non-extension ligature subtable found, from either a direct `LookupType 4` lookup
    // or a `LookupType 7` (`Extension`) indirection (used when the subtable's own offset would
    // not fit in 16 bits, common in large variable fonts like Material Symbols).
    let ligature_subtables =
        |lookup_idx: u16| -> Vec<read_fonts::tables::gsub::LigatureSubstFormat1<'_>> {
            let Ok(lookup) = lookup_list.lookups().get(lookup_idx as usize) else {
                return Vec::new();
            };
            match lookup {
                SubstitutionLookup::Ligature(lookup) => {
                    lookup.subtables().iter().flatten().collect()
                },
                SubstitutionLookup::Extension(lookup) => lookup
                    .subtables()
                    .iter()
                    .flatten()
                    .filter_map(|ext| match ext {
                        read_fonts::tables::gsub::ExtensionSubtable::Ligature(ligature_ext) => {
                            ligature_ext.extension().ok()
                        },
                        _ => None,
                    })
                    .collect(),
                _ => Vec::new(),
            }
        };

    for feature in lookup_indices {
        for lookup_idx in feature.lookup_list_indices() {
            for subtable in ligature_subtables(lookup_idx.get()) {
                let Ok(coverage) = subtable.coverage() else { continue };
                let Some(coverage_index) = coverage.get(first_glyph) else { continue };
                let Ok(ligature_set) = subtable.ligature_sets().get(coverage_index as usize) else {
                    continue;
                };
                for ligature in ligature_set.ligatures().iter().flatten() {
                    let matches = ligature.component_glyph_ids().len() == rest_glyphs.len()
                        && ligature
                            .component_glyph_ids()
                            .iter()
                            .zip(&rest_glyphs)
                            .all(|(a, b)| GlyphId::from(a.get()) == *b);
                    if matches {
                        return Some(GlyphId::from(ligature.ligature_glyph()));
                    }
                }
            }
        }
    }
    None
}

/// Returns just the SVG path `d` attribute value for `name`, in the font's own
/// `unitsPerEm` grid renormalized to Google's `0 -960 960 960` convention
/// (i.e. independent of `size`; `size` only changes the `width`/`height` returned
/// by [`icon_svg`]).
pub fn icon_path(name: &str, style: Style, axes: Axes) -> Result<Option<String>, SvgError> {
    if !name.is_ascii() || name.is_empty() {
        return Ok(None);
    }
    let ttf = style.ttf_bytes()?;
    let font = FontRef::new(&ttf).map_err(|e| SvgError::Font(format!("{e}")))?;

    let Some(glyph_id) = ligature_glyph_for_name(&font, name) else {
        return Ok(None);
    };

    let axes = axes.clamped();
    let location = font.axes().location(&[
        ("wght", axes.weight),
        ("FILL", axes.fill),
        ("GRAD", axes.grade),
        ("opsz", axes.optical_size),
    ]);

    let units_per_em = font.metrics(Size::unscaled(), &location).units_per_em as f32;
    let scale = if units_per_em > 0.0 { GRID_UNITS / units_per_em } else { 1.0 };

    let outlines = font.outline_glyphs();
    let Some(glyph) = outlines.get(glyph_id) else {
        return Ok(None);
    };
    let settings = DrawSettings::unhinted(Size::unscaled(), &location);

    // The pen is the shared `aphrody-svg` glyph pen (scale + Y flip), kept at fixed two-decimal
    // output so generated paths stay byte-stable.
    let mut pen = SvgPathPen::new(scale, NumberFormat::Fixed(2));
    glyph.draw(settings, &mut pen).map_err(|e| SvgError::Font(format!("{e}")))?;

    Ok(Some(pen.into_path()))
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
