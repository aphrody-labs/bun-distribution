// SPDX-License-Identifier: Apache-2.0

//! One namespace-correct XML writer over a `roxmltree` tree, driven by [`Rules`]. Sanitizing,
//! theming, `viewBox` normalization and sprite extraction are all rule sets over this walker, so
//! escaping and namespace handling exist exactly once.

use roxmltree::{Document, Node, ParsingOptions};

use crate::{Error, Result, SVG_NS, XLINK_NS};

const XML_NS: &str = "http://www.w3.org/XML/1998/namespace";

/// Hooks applied while writing. Every default keeps the node unchanged.
pub(crate) trait Rules {
    fn keep_element(&self, _node: Node<'_, '_>) -> bool {
        true
    }
    fn keep_namespace(&self, _uri: &str) -> bool {
        true
    }
    /// New value for an attribute, or `None` to drop it.
    fn attribute(
        &self,
        _node: Node<'_, '_>,
        _local: &str,
        _ns: Option<&str>,
        value: &str,
    ) -> Option<String> {
        Some(value.to_owned())
    }
    /// Attributes appended after the original ones (already-present names are the caller's job).
    fn extra_attributes(&self, _node: Node<'_, '_>) -> Vec<(String, String)> {
        Vec::new()
    }
    /// New content for a text node whose parent is `parent`, or `None` to drop it.
    fn text(&self, _parent: Node<'_, '_>, text: &str) -> Option<String> {
        Some(text.to_owned())
    }
    fn keep_comments(&self) -> bool {
        false
    }
}

/// Parses `svg` without DTD support (no entity expansion) and checks the root is `<svg>`.
pub(crate) fn parse(svg: &str) -> Result<Document<'_>> {
    let options = ParsingOptions {
        allow_dtd: false,
        ..ParsingOptions::default()
    };
    let doc = Document::parse_with_options(svg, options).map_err(|e| Error::Xml(e.to_string()))?;
    let root = doc.root_element();
    if root.tag_name().name() != "svg" || root.tag_name().namespace().is_some_and(|ns| ns != SVG_NS)
    {
        return Err(Error::NotSvg);
    }
    Ok(doc)
}

/// Writes the whole document rooted at `doc.root_element()`.
pub(crate) fn write_document(doc: &Document<'_>, rules: &dyn Rules) -> String {
    let mut out = String::with_capacity(doc.input_text().len());
    write_element(&mut out, doc.root_element(), rules, &[]);
    out
}

/// Writes the element children (and text) of `node`, assuming `inherited` namespaces are
/// already declared by the enclosing output.
pub(crate) fn write_children(
    node: Node<'_, '_>,
    rules: &dyn Rules,
    inherited: &[(Option<&str>, &str)],
) -> String {
    let mut out = String::new();
    let owned: Vec<(Option<String>, String)> = inherited
        .iter()
        .map(|(p, u)| (p.map(str::to_owned), (*u).to_owned()))
        .collect();
    for child in node.children() {
        write_node(&mut out, child, rules, &owned);
    }
    out
}

fn write_node(
    out: &mut String,
    node: Node<'_, '_>,
    rules: &dyn Rules,
    inherited: &[(Option<String>, String)],
) {
    if node.is_element() {
        let inherited: Vec<(Option<&str>, &str)> = inherited
            .iter()
            .map(|(p, u)| (p.as_deref(), u.as_str()))
            .collect();
        write_element(out, node, rules, &inherited);
    } else if node.is_text() {
        let parent = node.parent().unwrap_or(node);
        if let Some(text) = node.text().and_then(|t| rules.text(parent, t)) {
            escape_into(out, &text, false);
        }
    } else if node.is_comment()
        && rules.keep_comments()
        && let Some(text) = node.text()
    {
        out.push_str("<!--");
        out.push_str(&text.replace("--", "- -"));
        out.push_str("-->");
    }
}

fn qualified(node: Node<'_, '_>, ns: Option<&str>, local: &str, is_attribute: bool) -> String {
    let prefix = match ns {
        None => None,
        Some(XML_NS) => Some("xml"),
        Some(uri) => match node.lookup_prefix(uri) {
            Some(p) if !p.is_empty() => Some(p),
            _ if is_attribute && uri == XLINK_NS => Some("xlink"),
            _ => None,
        },
    };
    match prefix {
        Some(p) => format!("{p}:{local}"),
        None => local.to_owned(),
    }
}

fn write_element(
    out: &mut String,
    node: Node<'_, '_>,
    rules: &dyn Rules,
    inherited: &[(Option<&str>, &str)],
) {
    if !rules.keep_element(node) {
        return;
    }
    let tag = node.tag_name();
    let name = qualified(node, tag.namespace(), tag.name(), false);
    out.push('<');
    out.push_str(&name);

    let mut scope: Vec<(Option<String>, String)> = inherited
        .iter()
        .map(|(p, u)| (p.map(str::to_owned), (*u).to_owned()))
        .collect();
    for ns in node.namespaces() {
        let (prefix, uri) = (ns.name(), ns.uri());
        if uri == XML_NS || !rules.keep_namespace(uri) {
            continue;
        }
        if inherited.iter().any(|(p, u)| *p == prefix && *u == uri) {
            continue;
        }
        match prefix {
            Some(p) => push_attr(out, &format!("xmlns:{p}"), uri),
            None => push_attr(out, "xmlns", uri),
        }
        scope.push((prefix.map(str::to_owned), uri.to_owned()));
    }
    for attr in node.attributes() {
        if attr
            .namespace()
            .is_some_and(|uri| uri != XML_NS && !rules.keep_namespace(uri))
        {
            continue;
        }
        if let Some(value) = rules.attribute(node, attr.name(), attr.namespace(), attr.value()) {
            push_attr(
                out,
                &qualified(node, attr.namespace(), attr.name(), true),
                &value,
            );
        }
    }
    for (key, value) in rules.extra_attributes(node) {
        push_attr(out, &key, &value);
    }

    let mut body = String::new();
    for child in node.children() {
        write_node(&mut body, child, rules, &scope);
    }
    if body.is_empty() {
        out.push_str("/>");
    } else {
        out.push('>');
        out.push_str(&body);
        out.push_str("</");
        out.push_str(&name);
        out.push('>');
    }
}

fn push_attr(out: &mut String, name: &str, value: &str) {
    out.push(' ');
    out.push_str(name);
    out.push_str("=\"");
    escape_into(out, value, true);
    out.push('"');
}

/// XML-escapes `text` (and `"` when `attribute`).
pub(crate) fn escape_into(out: &mut String, text: &str, attribute: bool) {
    for c in text.chars() {
        match c {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' if attribute => out.push_str("&quot;"),
            _ => out.push(c),
        }
    }
}

/// Owned XML-escaped copy of `text`, for attribute values.
pub(crate) fn escape_attr(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    escape_into(&mut out, text, true);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Keep;
    impl Rules for Keep {}

    #[test]
    fn round_trips_namespaces_and_escaping() {
        let svg = r##"<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"><text xml:space="preserve">a &amp; b &lt; c</text><use xlink:href="#x"/></svg>"##;
        let doc = parse(svg).expect("parse");
        let out = write_document(&doc, &Keep);
        assert_eq!(out, svg);
    }

    #[test]
    fn rejects_non_svg_and_dtd() {
        assert!(matches!(parse("<html/>"), Err(Error::NotSvg)));
        let bomb = r#"<!DOCTYPE svg [<!ENTITY a "aaaa">]><svg xmlns="http://www.w3.org/2000/svg">&a;</svg>"#;
        assert!(matches!(parse(bomb), Err(Error::Xml(_))));
    }
}
