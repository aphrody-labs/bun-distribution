// SPDX-License-Identifier: Apache-2.0

//! Vector `<symbol>` sprite sheets: many standalone SVGs merged into one document referenced
//! with `<use href="#id"/>`. Internal ids (gradients, clip paths, masks) are prefixed per symbol
//! so two icons never collide. Raster atlases (`<symbol>` over PNG regions) stay in
//! `aphrody-sprite-sheet`; this module is for vector sources.

use roxmltree::Node;

use crate::{
    Error, Result, SVG_NS, XLINK_NS,
    viewbox::{Geometry, ViewBox},
    xml::{self, Rules, escape_attr},
};

/// Root attributes that describe the viewport, not the drawing; not copied onto `<symbol>`.
const VIEWPORT_ATTRIBUTES: &[&str] = &[
    "width",
    "height",
    "viewBox",
    "id",
    "x",
    "y",
    "version",
    "baseProfile",
];

/// One sprite member.
#[derive(Debug, Clone, Copy)]
pub struct SpriteEntry<'a> {
    /// `id` of the `<symbol>`; must be a valid XML id.
    pub id: &'a str,
    /// Standalone SVG document.
    pub svg: &'a str,
}

struct Prefixer<'p> {
    prefix: &'p str,
}

impl Prefixer<'_> {
    fn rewrite_urls(&self, value: &str) -> String {
        value.replace("url(#", &format!("url(#{}-", self.prefix))
    }
}

impl Rules for Prefixer<'_> {
    fn attribute(
        &self,
        _node: Node<'_, '_>,
        local: &str,
        _ns: Option<&str>,
        value: &str,
    ) -> Option<String> {
        Some(match local {
            "id" => format!("{}-{value}", self.prefix),
            "href" if value.starts_with('#') => format!("#{}-{}", self.prefix, &value[1..]),
            _ => self.rewrite_urls(value),
        })
    }

    fn text(&self, parent: Node<'_, '_>, text: &str) -> Option<String> {
        Some(if parent.tag_name().name() == "style" {
            self.rewrite_urls(text)
        } else {
            text.to_owned()
        })
    }
}

fn is_valid_id(id: &str) -> bool {
    let mut chars = id.chars();
    chars
        .next()
        .is_some_and(|c| c.is_ascii_alphabetic() || c == '_')
        && chars.all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
}

/// Builds one `<symbol>` for `entry`.
///
/// # Errors
/// Invalid id, malformed SVG, or a document without `viewBox` nor absolute size.
pub fn symbol(entry: SpriteEntry<'_>) -> Result<String> {
    if !is_valid_id(entry.id) {
        return Err(Error::Invalid(format!("invalid symbol id {:?}", entry.id)));
    }
    let doc = xml::parse(entry.svg)?;
    let root = doc.root_element();
    let geometry = Geometry {
        view_box: root.attribute("viewBox").and_then(ViewBox::parse),
        width: root
            .attribute("width")
            .and_then(crate::viewbox::length_to_px),
        height: root
            .attribute("height")
            .and_then(crate::viewbox::length_to_px),
    };
    let view_box = match geometry.view_box {
        Some(vb) => vb,
        None => {
            let (w, h) = geometry.size().ok_or(Error::NoSize)?;
            ViewBox {
                x: 0.0,
                y: 0.0,
                width: w,
                height: h,
            }
        }
    };
    let mut out = format!(
        r#"<symbol id="{}" viewBox="{}""#,
        escape_attr(entry.id),
        view_box.to_attribute(6)
    );
    for attr in root.attributes() {
        if attr.namespace().is_none() && !VIEWPORT_ATTRIBUTES.contains(&attr.name()) {
            out.push_str(&format!(
                r#" {}="{}""#,
                attr.name(),
                escape_attr(attr.value())
            ));
        }
    }
    out.push('>');
    let inherited = [(None, SVG_NS), (Some("xlink"), XLINK_NS)];
    out.push_str(&xml::write_children(
        root,
        &Prefixer { prefix: entry.id },
        &inherited,
    ));
    out.push_str("</symbol>");
    Ok(out)
}

/// Merges `entries` into one hidden sprite document.
///
/// # Errors
/// Duplicate ids, or any error from [`symbol`].
pub fn sprite(entries: &[SpriteEntry<'_>]) -> Result<String> {
    let mut seen = std::collections::HashSet::new();
    let mut out =
        format!(r#"<svg xmlns="{SVG_NS}" xmlns:xlink="{XLINK_NS}" style="display:none">"#);
    for entry in entries {
        if !seen.insert(entry.id) {
            return Err(Error::Invalid(format!(
                "duplicate symbol id {:?}",
                entry.id
            )));
        }
        out.push_str(&symbol(*entry)?);
    }
    out.push_str("</svg>");
    Ok(out)
}

/// `<svg><use href="#id"/></svg>` referencing a symbol of an inline sprite.
#[must_use]
pub fn use_ref(id: &str, size: Option<f64>) -> String {
    let size = size.map(|s| {
        let s = crate::format_number(s, 3);
        format!(r#" width="{s}" height="{s}""#)
    });
    format!(
        r##"<svg xmlns="{SVG_NS}"{}><use href="#{}"/></svg>"##,
        size.unwrap_or_default(),
        escape_attr(id)
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prefixes_internal_ids_and_keeps_paint() {
        let a = r#"<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="none" stroke="currentColor"><defs><linearGradient id="g"/></defs><path fill="url(#g)" d="M0 0"/></svg>"#;
        let b = r##"<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 -960 960 960"><path id="p" d="M1 1"/><use xlink:href="#p"/></svg>"##;
        let out = sprite(&[
            SpriteEntry { id: "a", svg: a },
            SpriteEntry { id: "b", svg: b },
        ])
        .expect("ok");
        assert!(
            out.contains(
                r#"<symbol id="a" viewBox="0 0 24 24" fill="none" stroke="currentColor">"#
            ),
            "{out}"
        );
        assert!(out.contains(r#"<linearGradient id="a-g"/>"#));
        assert!(out.contains(r#"fill="url(#a-g)""#));
        assert!(out.contains(r##"<use xlink:href="#b-p"/>"##), "{out}");
        assert!(
            !out.contains("xmlns:xlink=\"http://www.w3.org/1999/xlink\"><path"),
            "no redundant ns"
        );
        assert!(roxmltree::Document::parse(&out).is_ok());
    }

    #[test]
    fn rejects_duplicates_and_bad_ids() {
        let s = r#"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"/>"#;
        assert!(
            sprite(&[
                SpriteEntry { id: "x", svg: s },
                SpriteEntry { id: "x", svg: s }
            ])
            .is_err()
        );
        assert!(
            symbol(SpriteEntry {
                id: "1\"bad",
                svg: s
            })
            .is_err()
        );
        assert_eq!(
            use_ref("x", Some(24.0)),
            r##"<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><use href="#x"/></svg>"##
        );
    }
}
