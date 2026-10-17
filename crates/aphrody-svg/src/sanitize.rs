// SPDX-License-Identifier: Apache-2.0

//! Allow-by-default SVG sanitizer for untrusted input (uploads, scraped pages, model output).
//!
//! Removed unconditionally: `<script>`, `<foreignObject>` and embedding elements
//! (`iframe`, `embed`, `object`, `audio`, `video`, `handler`, `listener`), every `on*` event
//! attribute, `javascript:`/`vbscript:` URLs, `data:` URLs other than raster images, CSS
//! `expression(`/`@import`/`javascript:`, processing instructions, comments and DTDs (the
//! parser rejects DTDs, so entity-expansion bombs never reach the tree).
//!
//! Optional: external references (`href="https://..."`, `url(https://...)`) and editor
//! metadata (`<metadata>`, Inkscape/Sodipodi/Illustrator/Sketch/Figma namespaces).

use roxmltree::Node;

use crate::{
    Result,
    xml::{self, Rules},
};

/// What the sanitizer keeps.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SanitizeOptions {
    /// Keep `href`/`url()` references to other documents (`http:`, `https:`, relative paths).
    /// Same-document (`#id`) and raster `data:image/*` references are always kept.
    pub allow_external_refs: bool,
    /// Drop `<metadata>` and editor namespaces (`<title>`/`<desc>` are kept for accessibility).
    pub strip_metadata: bool,
}

impl Default for SanitizeOptions {
    fn default() -> Self {
        Self {
            allow_external_refs: false,
            strip_metadata: true,
        }
    }
}

const BLOCKED_ELEMENTS: &[&str] = &[
    "script",
    "foreignObject",
    "iframe",
    "embed",
    "object",
    "audio",
    "video",
    "handler",
    "listener",
];

/// Namespaces written by editors that carry no rendering information.
pub const EDITOR_NAMESPACES: &[&str] = &[
    "http://www.inkscape.org/namespaces/inkscape",
    "http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd",
    "http://ns.adobe.com/AdobeIllustrator/10.0/",
    "http://ns.adobe.com/AdobeSVGViewerExtensions/3.0/",
    "http://ns.adobe.com/Extensibility/1.0/",
    "http://ns.adobe.com/Graphs/1.0/",
    "http://ns.adobe.com/SaveForWeb/1.0/",
    "http://ns.adobe.com/Variables/1.0/",
    "http://ns.adobe.com/xap/1.0/",
    "http://www.bohemiancoding.com/sketch/ns",
    "http://www.figma.com/figma/ns",
    "http://purl.org/dc/elements/1.1/",
    "http://creativecommons.org/ns#",
    "http://www.w3.org/1999/02/22-rdf-syntax-ns#",
];

/// `true` when a URL value is safe under `options`.
#[must_use]
pub fn is_safe_url(value: &str, options: SanitizeOptions) -> bool {
    let compact: String = value
        .chars()
        .filter(|c| !c.is_whitespace() && !c.is_control())
        .collect::<String>()
        .to_ascii_lowercase();
    if compact.is_empty() || compact.starts_with('#') {
        return true;
    }
    if compact.starts_with("javascript:") || compact.starts_with("vbscript:") {
        return false;
    }
    if let Some(rest) = compact.strip_prefix("data:") {
        return [
            "image/png",
            "image/jpeg",
            "image/jpg",
            "image/gif",
            "image/webp",
            "image/avif",
        ]
        .iter()
        .any(|mime| rest.starts_with(mime));
    }
    options.allow_external_refs
}

/// Checks every `url(...)` in a CSS value.
fn css_is_safe(css: &str, options: SanitizeOptions) -> bool {
    let lower = css.to_ascii_lowercase();
    if lower.contains("expression(")
        || lower.contains("javascript:")
        || lower.contains("@import")
        || lower.contains("-moz-binding")
        || lower.contains("behavior:")
    {
        return false;
    }
    let mut rest = lower.as_str();
    while let Some(start) = rest.find("url(") {
        let after = &rest[start + 4..];
        let end = after.find(')').unwrap_or(after.len());
        let inner = after[..end].trim().trim_matches(|c| c == '"' || c == '\'');
        if !is_safe_url(inner, options) {
            return false;
        }
        rest = &after[end..];
    }
    true
}

struct Sanitizer(SanitizeOptions);

impl Rules for Sanitizer {
    fn keep_element(&self, node: Node<'_, '_>) -> bool {
        let tag = node.tag_name();
        if BLOCKED_ELEMENTS
            .iter()
            .any(|b| b.eq_ignore_ascii_case(tag.name()))
        {
            return false;
        }
        if self.0.strip_metadata {
            if tag.name() == "metadata" {
                return false;
            }
            if tag
                .namespace()
                .is_some_and(|ns| EDITOR_NAMESPACES.contains(&ns))
            {
                return false;
            }
        }
        true
    }

    fn keep_namespace(&self, uri: &str) -> bool {
        !(self.0.strip_metadata && EDITOR_NAMESPACES.contains(&uri))
    }

    fn attribute(
        &self,
        _node: Node<'_, '_>,
        local: &str,
        _ns: Option<&str>,
        value: &str,
    ) -> Option<String> {
        if local.len() > 2 && local[..2].eq_ignore_ascii_case("on") {
            return None;
        }
        match local {
            "href" | "src" | "action" | "formaction" => {
                is_safe_url(value, self.0).then(|| value.to_owned())
            }
            "style" => css_is_safe(value, self.0).then(|| value.to_owned()),
            _ if value.contains("url(") => css_is_safe(value, self.0).then(|| value.to_owned()),
            _ => {
                let lower = value.to_ascii_lowercase();
                (!lower.trim_start().starts_with("javascript:")).then(|| value.to_owned())
            }
        }
    }

    fn text(&self, parent: Node<'_, '_>, text: &str) -> Option<String> {
        if parent.tag_name().name() == "style" && !css_is_safe(text, self.0) {
            return None;
        }
        Some(text.to_owned())
    }
}

/// Returns a sanitized copy of `svg`.
///
/// # Errors
/// [`crate::Error::Xml`] for malformed XML or a DTD, [`crate::Error::NotSvg`] for a non-SVG root.
pub fn sanitize(svg: &str, options: SanitizeOptions) -> Result<String> {
    let doc = xml::parse(svg)?;
    Ok(xml::write_document(&doc, &Sanitizer(options)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strips_active_content() {
        let svg = r##"<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><script>alert(2)</script><a href="javascript:alert(3)"><rect width="1" height="1" onclick="x()"/></a><foreignObject><div/></foreignObject><use href="#ok"/><image href="https://evil/x.png"/><image href="data:image/png;base64,AAAA"/><image href="data:text/html,x"/><rect style="fill:url(https://evil/x)"/><style>@import url(x.css);</style><!-- c --></svg>"##;
        let out = sanitize(svg, SanitizeOptions::default()).expect("sanitize");
        for bad in [
            "onload",
            "script",
            "javascript",
            "onclick",
            "foreignObject",
            "evil",
            "text/html",
            "@import",
            "<!--",
        ] {
            assert!(!out.contains(bad), "{bad} survived in {out}");
        }
        assert!(out.contains(r##"<use href="#ok"/>"##));
        assert!(out.contains("data:image/png;base64,AAAA"));
    }

    #[test]
    fn external_refs_are_opt_in() {
        let svg =
            r#"<svg xmlns="http://www.w3.org/2000/svg"><image href="https://cdn/x.png"/></svg>"#;
        let opts = SanitizeOptions {
            allow_external_refs: true,
            ..SanitizeOptions::default()
        };
        assert!(
            sanitize(svg, opts)
                .expect("ok")
                .contains("https://cdn/x.png")
        );
    }

    #[test]
    fn strips_editor_metadata() {
        let svg = r#"<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" inkscape:version="1"><metadata>m</metadata><inkscape:grid/><path d="M0 0"/></svg>"#;
        let out = sanitize(svg, SanitizeOptions::default()).expect("ok");
        assert_eq!(
            out,
            r#"<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0"/></svg>"#
        );
    }
}
