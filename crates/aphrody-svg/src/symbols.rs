// SPDX-License-Identifier: Apache-2.0

//! Material Symbols from the variable fonts: icon name to SVG path on Google's
//! `viewBox="0 -960 960 960"` grid, at any `FILL`/`wght`/`GRAD`/`opsz`, and the gstatic SVG
//! layout of the same variants.
//!
//! The name resolves through the font's own `GSUB` ligatures ([`crate::glyph::ligature_glyph`]),
//! never through a `.codepoints` table: Google reassigns codepoints between releases, the
//! ligatures follow the bytes actually loaded. Shared by `aphrody-bun` (`bun_rs::icons`, fonts
//! embedded) and `aphrody-identity` (`loader`, fonts read at run time).

use std::borrow::Cow;

use skrifa::{FontRef, MetadataProvider, instance::Size};

use crate::{
    Error, Result,
    glyph::{NumberFormat, SvgPathPen, draw, ligature_glyph},
};

/// Side of Google's Material Symbols SVG grid.
pub const GRID: f32 = 960.0;

/// The three Material Symbols families.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum SymbolStyle {
    Outlined,
    Rounded,
    Sharp,
}

impl SymbolStyle {
    /// Every style, in the order fonts and CDN list them.
    pub const ALL: [Self; 3] = [Self::Outlined, Self::Rounded, Self::Sharp];

    /// Lowercase name: `outlined`, `rounded`, `sharp`.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Outlined => "outlined",
            Self::Rounded => "rounded",
            Self::Sharp => "sharp",
        }
    }

    /// Parses a lowercase style name.
    #[must_use]
    pub fn parse(value: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|s| s.as_str() == value)
    }

    /// File name of the variable font in the `material-symbols` npm package.
    #[must_use]
    pub fn font_file(self) -> String {
        format!("material-symbols-{}.woff2", self.as_str())
    }
}

/// Variable axes: `FILL` 0..1, `wght` 100..700, `GRAD` -25..200, `opsz` 20..48.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct SymbolAxes {
    pub fill: f32,
    pub weight: f32,
    pub grade: f32,
    pub optical_size: f32,
}

impl Default for SymbolAxes {
    fn default() -> Self {
        Self {
            fill: 0.0,
            weight: 400.0,
            grade: 0.0,
            optical_size: 24.0,
        }
    }
}

impl SymbolAxes {
    /// Every axis brought into its published range.
    #[must_use]
    pub fn clamped(self) -> Self {
        Self {
            fill: self.fill.clamp(0.0, 1.0),
            weight: self.weight.clamp(100.0, 700.0),
            grade: self.grade.clamp(-25.0, 200.0),
            optical_size: self.optical_size.clamp(20.0, 48.0),
        }
    }

    /// The gstatic variant directory and file of these axes (`wght300gradN25fill1`, `48px.svg`),
    /// `None` when the CDN does not publish them: `FILL` 0 or 1, `wght` a multiple of 100,
    /// `GRAD` -25, 0 or 200, `opsz` 20, 24, 40 or 48.
    #[must_use]
    pub fn cdn_variant(self) -> Option<(String, String)> {
        let exact = |v: f32, allowed: &[f32]| allowed.iter().any(|a| (v - a).abs() < f32::EPSILON);
        if !exact(self.fill, &[0.0, 1.0])
            || !exact(
                self.weight,
                &[100.0, 200.0, 300.0, 400.0, 500.0, 600.0, 700.0],
            )
            || !exact(self.grade, &[-25.0, 0.0, 200.0])
            || !exact(self.optical_size, &[20.0, 24.0, 40.0, 48.0])
        {
            return None;
        }
        let mut variant = String::new();
        if (self.weight - 400.0).abs() > f32::EPSILON {
            variant.push_str(&format!("wght{}", self.weight));
        }
        if self.grade < 0.0 {
            variant.push_str("gradN25");
        } else if self.grade > 0.0 {
            variant.push_str("grad200");
        }
        if self.fill > 0.5 {
            variant.push_str("fill1");
        }
        if variant.is_empty() {
            variant.push_str("default");
        }
        Some((variant, format!("{}px.svg", self.optical_size)))
    }
}

/// The gstatic-layout path of a variant under an origin
/// (`s/i/short-term/release/materialsymbols<style>/<name>/<variant>/<opsz>px.svg`), `None` when
/// the axes have no published variant (see [`SymbolAxes::cdn_variant`]) or the name is not a
/// Material Symbols name (`[a-z0-9_]+`).
#[must_use]
pub fn cdn_path(name: &str, style: SymbolStyle, axes: SymbolAxes) -> Option<String> {
    if !is_symbol_name(name) {
        return None;
    }
    let (variant, file) = axes.cdn_variant()?;
    Some(format!(
        "s/i/short-term/release/materialsymbols{}/{name}/{variant}/{file}",
        style.as_str()
    ))
}

/// `true` for a Material Symbols name: non-empty, `[a-z0-9_]` only.
#[must_use]
pub fn is_symbol_name(name: &str) -> bool {
    !name.is_empty()
        && name
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'_')
}

/// TTF bytes of a font given as WOFF2 (decoded) or as TTF/OTF (borrowed as is).
///
/// # Errors
/// [`Error::Font`] when WOFF2 decoding fails, or for WOFF1, which this crate does not decode.
pub fn decode_font(bytes: &[u8]) -> Result<Cow<'_, [u8]>> {
    match bytes.get(..4) {
        Some(b"wOF2") => {
            let mut input = bytes;
            woff2::convert_woff2_to_ttf(&mut input)
                .map(Cow::Owned)
                .map_err(|e| Error::Font(format!("WOFF2: {e}")))
        }
        Some(b"wOFF") => Err(Error::Font(
            "WOFF1 is not supported, use WOFF2 or TTF".into(),
        )),
        _ => Ok(Cow::Borrowed(bytes)),
    }
}

/// Path data of icon `name` in a Material Symbols font (TTF bytes, see [`decode_font`]) on the
/// `0 -960 960 960` grid, the axes clamped. `Ok(None)` when no ligature names that icon.
///
/// # Errors
/// [`Error::Font`] for an unreadable font or outline.
pub fn symbol_path(
    ttf: &[u8],
    name: &str,
    axes: SymbolAxes,
    format: NumberFormat,
) -> Result<Option<String>> {
    if !name.is_ascii() || name.is_empty() {
        return Ok(None);
    }
    let font = FontRef::new(ttf).map_err(|e| Error::Font(e.to_string()))?;
    let Some(glyph) = ligature_glyph(&font, name) else {
        return Ok(None);
    };
    let axes = axes.clamped();
    let location = font.axes().location([
        ("wght", axes.weight),
        ("FILL", axes.fill),
        ("GRAD", axes.grade),
        ("opsz", axes.optical_size),
    ]);
    let upem = f32::from(font.metrics(Size::unscaled(), &location).units_per_em);
    let scale = if upem > 0.0 { GRID / upem } else { 1.0 };
    let mut pen = SvgPathPen::new(scale, format);
    draw(&font, glyph, &location, &mut pen)?;
    Ok(Some(pen.into_path()))
}

/// Standalone icon SVG, Google's convention: `width`/`height` of `size` CSS px, `viewBox`
/// `0 -960 960 960`, one `<path>`; `fill` sets the root `fill` (default black when `None`).
#[must_use]
pub fn symbol_svg(path: &str, size: f32, fill: Option<&str>) -> String {
    let size = crate::format_number(f64::from(size), 3);
    let fill = fill.map_or_else(String::new, |f| format!(r#" fill="{f}""#));
    format!(
        r#"<svg xmlns="{}" width="{size}" height="{size}" viewBox="0 -960 960 960"{fill}><path d="{path}"/></svg>"#,
        crate::SVG_NS
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cdn_variants_follow_gstatic() {
        let v = |fill, weight, grade, optical_size| SymbolAxes {
            fill,
            weight,
            grade,
            optical_size,
        };
        assert_eq!(
            cdn_path("home", SymbolStyle::Outlined, SymbolAxes::default()).as_deref(),
            Some("s/i/short-term/release/materialsymbolsoutlined/home/default/24px.svg")
        );
        assert_eq!(
            cdn_path("home", SymbolStyle::Outlined, v(1.0, 300.0, -25.0, 48.0)).as_deref(),
            Some(
                "s/i/short-term/release/materialsymbolsoutlined/home/wght300gradN25fill1/48px.svg"
            )
        );
        assert_eq!(
            v(1.0, 400.0, 200.0, 20.0).cdn_variant(),
            Some(("grad200fill1".into(), "20px.svg".into()))
        );
        assert_eq!(v(0.5, 400.0, 0.0, 24.0).cdn_variant(), None);
        assert_eq!(v(0.0, 450.0, 0.0, 24.0).cdn_variant(), None);
        assert_eq!(v(0.0, 400.0, 0.0, 32.0).cdn_variant(), None);
        assert_eq!(
            cdn_path("Home", SymbolStyle::Rounded, SymbolAxes::default()),
            None
        );
        assert_eq!(
            cdn_path("../x", SymbolStyle::Rounded, SymbolAxes::default()),
            None
        );
    }

    #[test]
    fn styles_and_fonts() {
        assert_eq!(SymbolStyle::parse("rounded"), Some(SymbolStyle::Rounded));
        assert_eq!(SymbolStyle::parse("bold"), None);
        assert_eq!(
            SymbolStyle::Sharp.font_file(),
            "material-symbols-sharp.woff2"
        );
        assert!(matches!(decode_font(b"wOF2\0\0"), Err(Error::Font(_))));
        assert!(matches!(decode_font(b"wOFF"), Err(Error::Font(_))));
        assert!(matches!(decode_font(b"\0\x01\0\0"), Ok(Cow::Borrowed(_))));
        assert!(matches!(
            symbol_path(
                b"nope",
                "home",
                SymbolAxes::default(),
                NumberFormat::Fixed(2)
            ),
            Err(Error::Font(_))
        ));
    }
}
