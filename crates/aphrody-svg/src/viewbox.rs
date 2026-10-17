// SPDX-License-Identifier: Apache-2.0

//! `viewBox` and intrinsic size: read them, synthesize a missing `viewBox` from
//! `width`/`height`, and resize a document without touching its coordinates.

use roxmltree::Node;
use svgtypes::{Length, LengthUnit};

use crate::{
    Error, Result, format_number,
    xml::{self, Rules},
};

/// A parsed `viewBox`.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ViewBox {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

impl ViewBox {
    /// Parses a `viewBox` attribute value; `None` for invalid or non-positive boxes.
    #[must_use]
    pub fn parse(value: &str) -> Option<Self> {
        let vb: svgtypes::ViewBox = value.parse().ok()?;
        (vb.w > 0.0 && vb.h > 0.0).then_some(Self {
            x: vb.x,
            y: vb.y,
            width: vb.w,
            height: vb.h,
        })
    }

    /// `min-x min-y width height`, numbers trimmed to `precision` decimals.
    #[must_use]
    pub fn to_attribute(&self, precision: u8) -> String {
        [self.x, self.y, self.width, self.height]
            .iter()
            .map(|n| format_number(*n, precision))
            .collect::<Vec<_>>()
            .join(" ")
    }
}

/// Converts an absolute SVG length to CSS pixels (96 dpi). Percentages return `None`.
#[must_use]
pub fn length_to_px(value: &str) -> Option<f64> {
    let len: Length = value.trim().parse().ok()?;
    let n = len.number;
    let px = match len.unit {
        LengthUnit::None | LengthUnit::Px => n,
        LengthUnit::In => n * 96.0,
        LengthUnit::Cm => n * 96.0 / 2.54,
        LengthUnit::Mm => n * 96.0 / 25.4,
        LengthUnit::Pt => n * 4.0 / 3.0,
        LengthUnit::Pc => n * 16.0,
        LengthUnit::Em => n * 16.0,
        LengthUnit::Ex => n * 8.0,
        LengthUnit::Percent => return None,
    };
    (px > 0.0 && px.is_finite()).then_some(px)
}

/// Geometry read from the root element.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Geometry {
    pub view_box: Option<ViewBox>,
    /// `width` in px when absolute.
    pub width: Option<f64>,
    /// `height` in px when absolute.
    pub height: Option<f64>,
}

impl Geometry {
    /// Intrinsic size: explicit `width`/`height`, the missing side derived from the `viewBox`
    /// aspect ratio, else the `viewBox` size.
    #[must_use]
    pub fn size(&self) -> Option<(f64, f64)> {
        let ratio = self.view_box.map(|vb| vb.width / vb.height);
        match (self.width, self.height, ratio) {
            (Some(w), Some(h), _) => Some((w, h)),
            (Some(w), None, Some(r)) => Some((w, w / r)),
            (None, Some(h), Some(r)) => Some((h * r, h)),
            (None, None, _) => self.view_box.map(|vb| (vb.width, vb.height)),
            _ => None,
        }
    }
}

fn geometry_of(root: Node<'_, '_>) -> Geometry {
    Geometry {
        view_box: root.attribute("viewBox").and_then(ViewBox::parse),
        width: root.attribute("width").and_then(length_to_px),
        height: root.attribute("height").and_then(length_to_px),
    }
}

/// Reads the root `viewBox`, `width` and `height`.
///
/// # Errors
/// Malformed XML or non-SVG root.
pub fn geometry(svg: &str) -> Result<Geometry> {
    let doc = xml::parse(svg)?;
    Ok(geometry_of(doc.root_element()))
}

/// How [`normalize`] sizes the root element.
#[derive(Debug, Clone, Copy, Default, PartialEq)]
pub enum Sizing {
    /// Keep `width`/`height` as they are.
    #[default]
    Keep,
    /// Remove `width`/`height` so the SVG scales to its container.
    Responsive,
    /// Set `width`/`height` in px (a missing side follows the `viewBox` ratio).
    Fixed {
        width: Option<f64>,
        height: Option<f64>,
    },
}

struct Normalizer {
    view_box: ViewBox,
    width: Option<f64>,
    height: Option<f64>,
    sizing: Sizing,
}

impl Rules for Normalizer {
    fn attribute(
        &self,
        node: Node<'_, '_>,
        local: &str,
        ns: Option<&str>,
        value: &str,
    ) -> Option<String> {
        if node.parent_element().is_some() || ns.is_some() {
            return Some(value.to_owned());
        }
        match local {
            "viewBox" => None,
            "width" | "height" if !matches!(self.sizing, Sizing::Keep) => None,
            _ => Some(value.to_owned()),
        }
    }

    fn extra_attributes(&self, node: Node<'_, '_>) -> Vec<(String, String)> {
        if node.parent_element().is_some() {
            return Vec::new();
        }
        let mut extra = vec![("viewBox".to_owned(), self.view_box.to_attribute(6))];
        if matches!(self.sizing, Sizing::Fixed { .. }) {
            if let Some(w) = self.width {
                extra.push(("width".to_owned(), format_number(w, 3)));
            }
            if let Some(h) = self.height {
                extra.push(("height".to_owned(), format_number(h, 3)));
            }
        }
        extra
    }

    fn keep_comments(&self) -> bool {
        true
    }
}

/// Guarantees a root `viewBox` (synthesized from `width`/`height` when absent) and applies
/// `sizing`. Coordinates are never rewritten.
///
/// # Errors
/// [`Error::NoSize`] when neither a `viewBox` nor absolute `width`/`height` exist.
pub fn normalize(svg: &str, sizing: Sizing) -> Result<String> {
    let doc = xml::parse(svg)?;
    let geo = geometry_of(doc.root_element());
    let view_box = match geo.view_box {
        Some(vb) => vb,
        None => {
            let (w, h) = match (geo.width, geo.height) {
                (Some(w), Some(h)) => (w, h),
                _ => return Err(Error::NoSize),
            };
            ViewBox {
                x: 0.0,
                y: 0.0,
                width: w,
                height: h,
            }
        }
    };
    let ratio = view_box.width / view_box.height;
    let (width, height) = match sizing {
        Sizing::Fixed {
            width: Some(w),
            height: Some(h),
        } => (Some(w), Some(h)),
        Sizing::Fixed {
            width: Some(w),
            height: None,
        } => (Some(w), Some(w / ratio)),
        Sizing::Fixed {
            width: None,
            height: Some(h),
        } => (Some(h * ratio), Some(h)),
        Sizing::Fixed {
            width: None,
            height: None,
        } => (Some(view_box.width), Some(view_box.height)),
        _ => (None, None),
    };
    Ok(xml::write_document(
        &doc,
        &Normalizer {
            view_box,
            width,
            height,
            sizing,
        },
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn synthesizes_view_box_from_size() {
        let out = normalize(
            r#"<svg xmlns="http://www.w3.org/2000/svg" width="1in" height="48"><rect/></svg>"#,
            Sizing::Responsive,
        )
        .expect("ok");
        assert_eq!(
            out,
            r#"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 48"><rect/></svg>"#
        );
    }

    #[test]
    fn fixed_size_follows_ratio() {
        let out = normalize(
            r#"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -960 960 960" width="24" height="24"/>"#,
            Sizing::Fixed { width: Some(48.0), height: None },
        )
        .expect("ok");
        assert!(
            out.contains(r#"viewBox="0 -960 960 960" width="48" height="48""#),
            "{out}"
        );
    }

    #[test]
    fn geometry_and_missing_size() {
        let g = geometry(
            r#"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100" width="50"/>"#,
        )
        .expect("ok");
        assert_eq!(g.size(), Some((50.0, 25.0)));
        assert!(matches!(
            normalize(
                r#"<svg xmlns="http://www.w3.org/2000/svg" width="50%"/>"#,
                Sizing::Keep
            ),
            Err(Error::NoSize)
        ));
    }
}
