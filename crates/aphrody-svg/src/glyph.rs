// SPDX-License-Identifier: Apache-2.0

//! Font glyph outlines to SVG path data with `skrifa` (the fontations stack Chrome and resvg
//! use): TrueType/CFF/CFF2, variable axes, collections. The [`SvgPathPen`] is also what
//! the `icons` module of `aphrody-bun` (formerly `aphrody-icons`) walks its Material Symbols
//! ligature glyphs with.

use skrifa::{
    FontRef, GlyphId, MetadataProvider,
    instance::{Location, Size},
    outline::{DrawSettings, OutlinePen},
};

use crate::{Error, Result, format_number};

/// How path coordinates are printed.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NumberFormat {
    /// Exactly `n` decimals (`12.50`); byte-stable output for fixtures.
    Fixed(u8),
    /// At most `n` decimals, trailing zeros trimmed (`12.5`); smaller output.
    Trimmed(u8),
}

/// An [`OutlinePen`] that writes SVG path data. Font units are scaled by `scale` and the Y axis
/// is flipped (fonts are Y-up, SVG is Y-down), then `offset` is added.
#[derive(Debug, Clone)]
pub struct SvgPathPen {
    data: String,
    scale: f32,
    offset: (f32, f32),
    format: NumberFormat,
}

impl SvgPathPen {
    /// New pen with the given uniform scale and number format.
    #[must_use]
    pub fn new(scale: f32, format: NumberFormat) -> Self {
        Self {
            data: String::new(),
            scale,
            offset: (0.0, 0.0),
            format,
        }
    }

    /// Translates every point by `(dx, dy)` after scaling and flipping.
    #[must_use]
    pub fn with_offset(mut self, dx: f32, dy: f32) -> Self {
        self.offset = (dx, dy);
        self
    }

    /// The accumulated path data.
    #[must_use]
    pub fn into_path(self) -> String {
        self.data
    }

    fn num(&self, v: f32) -> String {
        match self.format {
            NumberFormat::Fixed(p) => {
                let s = format!("{v:.prec$}", prec = usize::from(p));
                if s.trim_start_matches('-')
                    .chars()
                    .all(|c| c == '0' || c == '.')
                {
                    s.trim_start_matches('-').to_owned()
                } else {
                    s
                }
            }
            NumberFormat::Trimmed(p) => format_number(f64::from(v), p),
        }
    }

    fn point(&self, x: f32, y: f32) -> String {
        let px = x * self.scale + self.offset.0;
        let py = -y * self.scale + self.offset.1;
        format!("{} {}", self.num(px), self.num(py))
    }
}

impl OutlinePen for SvgPathPen {
    fn move_to(&mut self, x: f32, y: f32) {
        let p = self.point(x, y);
        self.data.push('M');
        self.data.push_str(&p);
    }

    fn line_to(&mut self, x: f32, y: f32) {
        let p = self.point(x, y);
        self.data.push('L');
        self.data.push_str(&p);
    }

    fn quad_to(&mut self, cx0: f32, cy0: f32, x: f32, y: f32) {
        let (c, p) = (self.point(cx0, cy0), self.point(x, y));
        self.data.push_str(&format!("Q{c} {p}"));
    }

    fn curve_to(&mut self, cx0: f32, cy0: f32, cx1: f32, cy1: f32, x: f32, y: f32) {
        let (c0, c1, p) = (self.point(cx0, cy0), self.point(cx1, cy1), self.point(x, y));
        self.data.push_str(&format!("C{c0} {c1} {p}"));
    }

    fn close(&mut self) {
        self.data.push('Z');
    }
}

/// Which glyph to draw.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Glyph {
    /// Through the font's `cmap`.
    Char(char),
    /// Raw glyph id (e.g. from a `GSUB` ligature lookup).
    Id(u32),
}

/// Glyph extraction settings.
#[derive(Debug, Clone, PartialEq)]
pub struct GlyphOptions {
    /// Index inside a collection (`.ttc`/`.otc`); `0` for single fonts.
    pub font_index: u32,
    /// Variable-font axis values, e.g. `[("wght", 700.0)]`. Unknown axes are ignored.
    pub axes: Vec<(String, f32)>,
    /// Output units per em (`None` keeps the font's own `unitsPerEm`).
    pub units_per_em: Option<f32>,
    /// Coordinate format.
    pub format: NumberFormat,
}

impl Default for GlyphOptions {
    fn default() -> Self {
        Self {
            font_index: 0,
            axes: Vec::new(),
            units_per_em: None,
            format: NumberFormat::Trimmed(2),
        }
    }
}

/// An outline in SVG coordinates (baseline at `y = 0`, ascenders negative).
#[derive(Debug, Clone, PartialEq)]
pub struct GlyphOutline {
    /// Path data (`d`).
    pub path: String,
    /// Advance width in output units.
    pub advance: f32,
    /// Ascent (positive, output units).
    pub ascent: f32,
    /// Descent (positive, output units).
    pub descent: f32,
    /// Output units per em.
    pub units_per_em: f32,
}

impl GlyphOutline {
    /// Standalone SVG: `viewBox="0 -ascent advance ascent+descent"`, optional pixel height.
    #[must_use]
    pub fn to_svg(&self, height_px: Option<f32>) -> String {
        let h = self.ascent + self.descent;
        let size = height_px.map_or_else(String::new, |px| {
            let w = if h > 0.0 { px * self.advance / h } else { px };
            format!(
                r#" width="{}" height="{}""#,
                format_number(f64::from(w), 3),
                format_number(f64::from(px), 3)
            )
        });
        format!(
            r#"<svg xmlns="{}"{size} viewBox="0 {} {} {}"><path d="{}"/></svg>"#,
            crate::SVG_NS,
            format_number(f64::from(-self.ascent), 3),
            format_number(f64::from(self.advance), 3),
            format_number(f64::from(h), 3),
            self.path
        )
    }
}

/// Parses `font` (TTF/OTF bytes; decode WOFF2 first) at `options.font_index`.
///
/// # Errors
/// [`Error::Font`] when the bytes are not a font.
pub fn font_ref(font: &[u8], index: u32) -> Result<FontRef<'_>> {
    FontRef::from_index(font, index).map_err(|e| Error::Font(e.to_string()))
}

/// Normalized variation location for `axes`.
#[must_use]
pub fn location(font: &FontRef<'_>, axes: &[(String, f32)]) -> Location {
    let settings: Vec<(&str, f32)> = axes.iter().map(|(t, v)| (t.as_str(), *v)).collect();
    font.axes().location(settings)
}

/// Draws `glyph` of an already parsed font into `pen` at `location`, unhinted, unscaled.
///
/// # Errors
/// [`Error::Font`] when the glyph has no outline table entry or drawing fails.
pub fn draw(
    font: &FontRef<'_>,
    glyph: GlyphId,
    location: &Location,
    pen: &mut impl OutlinePen,
) -> Result<()> {
    let outlines = font.outline_glyphs();
    let outline = outlines
        .get(glyph)
        .ok_or_else(|| Error::Font(format!("no outline for glyph {}", glyph.to_u32())))?;
    outline
        .draw(DrawSettings::unhinted(Size::unscaled(), location), pen)
        .map(|_| ())
        .map_err(|e| Error::Font(e.to_string()))
}

/// The glyph a text shaper substitutes for the whole of `text` through the font's `GSUB`
/// ligatures (`rlig` or `liga`, `LookupType` 4, also behind a `LookupType` 7 extension), as
/// icon fonts name their glyphs: `home` -> the `home` icon. `None` when a character has no
/// `cmap` entry or no ligature covers the full sequence. Only ligature substitution is
/// applied (no reordering, no contextual lookups).
#[must_use]
pub fn ligature_glyph(font: &FontRef<'_>, text: &str) -> Option<GlyphId> {
    use skrifa::raw::{
        TableProvider,
        tables::gsub::{ExtensionSubtable, LigatureSubstFormat1, SubstitutionLookup},
        types::Tag,
    };

    let charmap = font.charmap();
    let mut chars = text.chars();
    let first = charmap.map(chars.next()?)?;
    let rest: Vec<GlyphId> = chars.map(|c| charmap.map(c)).collect::<Option<_>>()?;

    let gsub = font.gsub().ok()?;
    let scripts = gsub.script_list().ok()?;
    let features = gsub.feature_list().ok()?;
    let lookups = gsub.lookup_list().ok()?;
    let records = scripts.script_records();
    let record = records
        .iter()
        .find(|r| r.script_tag() == Tag::new(b"DFLT"))
        .or_else(|| records.iter().find(|r| r.script_tag() == Tag::new(b"latn")))
        .or_else(|| records.first())?;
    let lang_sys = record
        .script(scripts.offset_data())
        .ok()?
        .default_lang_sys()?
        .ok()?;

    // Material Symbols carries its name ligatures under `rlig` and has no `liga` at all.
    let tags = [Tag::new(b"rlig"), Tag::new(b"liga")];
    let subtables = |index: u16| -> Vec<LigatureSubstFormat1<'_>> {
        match lookups.lookups().get(usize::from(index)) {
            Ok(SubstitutionLookup::Ligature(lookup)) => {
                lookup.subtables().iter().flatten().collect()
            }
            Ok(SubstitutionLookup::Extension(lookup)) => lookup
                .subtables()
                .iter()
                .flatten()
                .filter_map(|ext| match ext {
                    ExtensionSubtable::Ligature(lig) => lig.extension().ok(),
                    _ => None,
                })
                .collect(),
            _ => Vec::new(),
        }
    };

    for index in lang_sys.feature_indices() {
        let Some(record) = features.feature_records().get(usize::from(index.get())) else {
            continue;
        };
        if !tags.contains(&record.feature_tag()) {
            continue;
        }
        let Ok(feature) = record.feature(features.offset_data()) else {
            continue;
        };
        for lookup in feature.lookup_list_indices() {
            for subtable in subtables(lookup.get()) {
                let Ok(coverage) = subtable.coverage() else {
                    continue;
                };
                let Some(at) = coverage.get(first) else {
                    continue;
                };
                let Ok(set) = subtable.ligature_sets().get(usize::from(at)) else {
                    continue;
                };
                for ligature in set.ligatures().iter().flatten() {
                    let components = ligature.component_glyph_ids();
                    if components.len() == rest.len()
                        && components
                            .iter()
                            .zip(&rest)
                            .all(|(a, b)| GlyphId::from(a.get()) == *b)
                    {
                        return Some(GlyphId::from(ligature.ligature_glyph()));
                    }
                }
            }
        }
    }
    None
}

/// Extracts one glyph as SVG path data plus metrics. `Ok(None)` when a `Char` is not mapped.
///
/// # Errors
/// [`Error::Font`] for unreadable fonts or outlines.
pub fn glyph_outline(
    font: &[u8],
    glyph: Glyph,
    options: &GlyphOptions,
) -> Result<Option<GlyphOutline>> {
    let font = font_ref(font, options.font_index)?;
    let gid = match glyph {
        Glyph::Char(c) => match font.charmap().map(c) {
            Some(g) => g,
            None => return Ok(None),
        },
        Glyph::Id(id) => GlyphId::new(id),
    };
    let loc = location(&font, &options.axes);
    let metrics = font.metrics(Size::unscaled(), &loc);
    let upem = f32::from(metrics.units_per_em.max(1));
    let target = options.units_per_em.unwrap_or(upem);
    let scale = target / upem;
    let mut pen = SvgPathPen::new(scale, options.format);
    draw(&font, gid, &loc, &mut pen)?;
    let advance = font
        .glyph_metrics(Size::unscaled(), &loc)
        .advance_width(gid)
        .unwrap_or(upem)
        * scale;
    Ok(Some(GlyphOutline {
        path: pen.into_path(),
        advance,
        ascent: metrics.ascent * scale,
        descent: -metrics.descent * scale,
        units_per_em: target,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pen_flips_scales_and_formats() {
        let mut pen = SvgPathPen::new(0.5, NumberFormat::Trimmed(2));
        pen.move_to(0.0, 100.0);
        pen.line_to(10.0, 0.0);
        pen.quad_to(1.0, 1.0, 2.0, 2.0);
        pen.close();
        assert_eq!(pen.into_path(), "M0 -50L5 0Q0.5 -0.5 1 -1Z");

        let mut fixed = SvgPathPen::new(1.0, NumberFormat::Fixed(2)).with_offset(0.0, 0.0);
        fixed.move_to(1.0, 0.0);
        assert_eq!(fixed.into_path(), "M1.00 0.00");
    }

    #[test]
    fn rejects_non_font() {
        assert!(matches!(
            glyph_outline(b"nope", Glyph::Char('a'), &GlyphOptions::default()),
            Err(Error::Font(_))
        ));
    }
}
