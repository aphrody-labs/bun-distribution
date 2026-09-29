//! Compact, read-only arena built from an `obscura_dom::DomTree` in a single
//! iterative pass. All later stages (metadata, scoring, rendering) work on this
//! arena so they never touch the `RefCell`-backed tree again and never recurse
//! (deeply nested markup cannot overflow the stack).

use obscura_dom::{DomTree, NodeData, NodeId};

pub(crate) const NONE: u32 = u32::MAX;

/// Element tags the extractor cares about. Everything else is `Other`
/// (treated as a generic inline or container element depending on content).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Tag {
    Html,
    Head,
    Body,
    Title,
    Meta,
    Link,
    Base,
    Script,
    Style,
    Noscript,
    Template,
    Svg,
    Math,
    Iframe,
    Object,
    Embed,
    Canvas,
    Video,
    Audio,
    Picture,
    Source,
    Input,
    Select,
    Option,
    Textarea,
    Button,
    Label,
    Form,
    Fieldset,
    Dialog,
    Article,
    Main,
    Section,
    Div,
    Nav,
    Aside,
    Header,
    Footer,
    P,
    H(u8),
    Ul,
    Ol,
    Li,
    Dl,
    Dt,
    Dd,
    Pre,
    Code,
    Kbd,
    Samp,
    Blockquote,
    Table,
    Thead,
    Tbody,
    Tfoot,
    Tr,
    Td,
    Th,
    Caption,
    Figure,
    Figcaption,
    Details,
    Summary,
    Address,
    Hr,
    Br,
    A,
    Img,
    Strong,
    B,
    Em,
    I,
    Del,
    S,
    Sup,
    Sub,
    Span,
    Time,
    Center,
    Font,
    Other,
}

impl Tag {
    pub(crate) fn from_name(name: &str) -> Tag {
        match name {
            "html" => Tag::Html,
            "head" => Tag::Head,
            "body" => Tag::Body,
            "title" => Tag::Title,
            "meta" => Tag::Meta,
            "link" => Tag::Link,
            "base" => Tag::Base,
            "script" => Tag::Script,
            "style" => Tag::Style,
            "noscript" => Tag::Noscript,
            "template" => Tag::Template,
            "svg" => Tag::Svg,
            "math" => Tag::Math,
            "iframe" | "frame" | "frameset" => Tag::Iframe,
            "object" | "applet" => Tag::Object,
            "embed" => Tag::Embed,
            "canvas" => Tag::Canvas,
            "video" => Tag::Video,
            "audio" => Tag::Audio,
            "picture" => Tag::Picture,
            "source" | "track" => Tag::Source,
            "input" => Tag::Input,
            "select" | "datalist" => Tag::Select,
            "option" | "optgroup" => Tag::Option,
            "textarea" => Tag::Textarea,
            "button" => Tag::Button,
            "label" => Tag::Label,
            "form" => Tag::Form,
            "fieldset" => Tag::Fieldset,
            "dialog" => Tag::Dialog,
            "article" => Tag::Article,
            "main" => Tag::Main,
            "section" => Tag::Section,
            "div" => Tag::Div,
            "nav" => Tag::Nav,
            "aside" => Tag::Aside,
            "header" | "hgroup" => Tag::Header,
            "footer" => Tag::Footer,
            "p" => Tag::P,
            "h1" => Tag::H(1),
            "h2" => Tag::H(2),
            "h3" => Tag::H(3),
            "h4" => Tag::H(4),
            "h5" => Tag::H(5),
            "h6" => Tag::H(6),
            "ul" | "menu" | "dir" => Tag::Ul,
            "ol" => Tag::Ol,
            "li" => Tag::Li,
            "dl" => Tag::Dl,
            "dt" => Tag::Dt,
            "dd" => Tag::Dd,
            "pre" | "listing" | "xmp" | "plaintext" => Tag::Pre,
            "code" | "tt" | "var" => Tag::Code,
            "kbd" => Tag::Kbd,
            "samp" => Tag::Samp,
            "blockquote" => Tag::Blockquote,
            "table" => Tag::Table,
            "thead" => Tag::Thead,
            "tbody" => Tag::Tbody,
            "tfoot" => Tag::Tfoot,
            "tr" => Tag::Tr,
            "td" => Tag::Td,
            "th" => Tag::Th,
            "caption" => Tag::Caption,
            "figure" => Tag::Figure,
            "figcaption" => Tag::Figcaption,
            "details" => Tag::Details,
            "summary" => Tag::Summary,
            "address" => Tag::Address,
            "hr" => Tag::Hr,
            "br" | "wbr" => Tag::Br,
            "a" => Tag::A,
            "img" => Tag::Img,
            "strong" => Tag::Strong,
            "b" => Tag::B,
            "em" => Tag::Em,
            "i" | "cite" | "dfn" => Tag::I,
            "del" | "strike" => Tag::Del,
            "s" => Tag::S,
            "sup" => Tag::Sup,
            "sub" => Tag::Sub,
            "span" => Tag::Span,
            "time" => Tag::Time,
            "center" => Tag::Center,
            "font" => Tag::Font,
            _ => Tag::Other,
        }
    }

    /// Elements that start a new block of flow content when rendered.
    pub(crate) fn is_block(self) -> bool {
        matches!(
            self,
            Tag::Html
                | Tag::Body
                | Tag::Article
                | Tag::Main
                | Tag::Section
                | Tag::Div
                | Tag::Nav
                | Tag::Aside
                | Tag::Header
                | Tag::Footer
                | Tag::P
                | Tag::H(_)
                | Tag::Ul
                | Tag::Ol
                | Tag::Li
                | Tag::Dl
                | Tag::Dt
                | Tag::Dd
                | Tag::Pre
                | Tag::Blockquote
                | Tag::Table
                | Tag::Thead
                | Tag::Tbody
                | Tag::Tfoot
                | Tag::Tr
                | Tag::Td
                | Tag::Th
                | Tag::Caption
                | Tag::Figure
                | Tag::Figcaption
                | Tag::Details
                | Tag::Summary
                | Tag::Address
                | Tag::Hr
                | Tag::Form
                | Tag::Fieldset
                | Tag::Dialog
                | Tag::Center
        )
    }

    /// Elements whose subtree never carries readable content.
    pub(crate) fn is_non_content(self) -> bool {
        matches!(
            self,
            Tag::Head
                | Tag::Title
                | Tag::Meta
                | Tag::Link
                | Tag::Base
                | Tag::Script
                | Tag::Style
                | Tag::Noscript
                | Tag::Template
                | Tag::Svg
                | Tag::Math
                | Tag::Iframe
                | Tag::Object
                | Tag::Embed
                | Tag::Canvas
                | Tag::Source
        )
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Kind {
    Element,
    Text,
    Other,
}

#[derive(Clone, Debug)]
pub(crate) struct ANode {
    pub source: NodeId,
    pub kind: Kind,
    pub tag: Tag,
    pub parent: u32,
    pub first_child: u32,
    pub next_sibling: u32,
    /// Byte range of the text in `Arena::text` (text nodes only).
    pub text_start: u32,
    pub text_len: u32,
}

pub(crate) struct Arena {
    pub tree: DomTree,
    pub nodes: Vec<ANode>,
    pub text: String,
    pub body: u32,
    pub html: u32,
}

/// Maximum element nesting handed to the HTML parser. Tree construction in
/// html5ever is O(depth) per start tag (scope checks walk the stack of open
/// elements), so adversarial nesting would be quadratic. Browsers cap depth
/// in a similar way; real pages stay far below this limit.
pub(crate) const MAX_NESTING: usize = 512;

fn is_void(name: &[u8]) -> bool {
    matches!(
        name,
        b"area"
            | b"base"
            | b"br"
            | b"col"
            | b"embed"
            | b"hr"
            | b"img"
            | b"input"
            | b"link"
            | b"meta"
            | b"param"
            | b"source"
            | b"track"
            | b"wbr"
            | b"keygen"
            | b"basefont"
            | b"bgsound"
            | b"frame"
            | b"image"
    )
}

/// Elements whose end tag is optional: they are implicitly closed by the
/// parser, so they do not reliably increase nesting depth.
fn has_optional_end(name: &[u8]) -> bool {
    matches!(
        name,
        b"p" | b"li"
            | b"dt"
            | b"dd"
            | b"option"
            | b"optgroup"
            | b"tr"
            | b"td"
            | b"th"
            | b"tbody"
            | b"thead"
            | b"tfoot"
            | b"colgroup"
            | b"rb"
            | b"rt"
            | b"rp"
            | b"rtc"
            | b"html"
            | b"head"
            | b"body"
    )
}

fn is_raw_text(name: &[u8]) -> bool {
    matches!(
        name,
        b"script"
            | b"style"
            | b"textarea"
            | b"title"
            | b"xmp"
            | b"iframe"
            | b"noembed"
            | b"noframes"
            | b"plaintext"
    )
}

fn find_ci(hay: &[u8], from: usize, needle: &[u8]) -> Option<usize> {
    if needle.is_empty() || hay.len() < needle.len() || from > hay.len() - needle.len() {
        return None;
    }
    // All needles used here start with a non-letter byte, so the first byte
    // can be searched exactly before the case-insensitive comparison.
    let first = needle[0];
    let last_start = hay.len() - needle.len();
    let mut i = from;
    while i <= last_start {
        i = find_any(hay, i, &[first])?;
        if i > last_start {
            return None;
        }
        if hay[i + 1..i + needle.len()].eq_ignore_ascii_case(&needle[1..]) {
            return Some(i);
        }
        i += 1;
    }
    None
}

enum ScanEvent {
    /// A start or end tag that affects nesting; `depth` is the depth before
    /// a start tag / after an end tag.
    Tag { start: usize, end: usize, depth: usize },
    /// A byte range that carries no readable content and can be removed
    /// before parsing (comments, scripts except JSON-LD, styles, inline SVG).
    Strip { start: usize, end: usize },
}

const LO: u64 = 0x0101_0101_0101_0101;
const HI: u64 = 0x8080_8080_8080_8080;

/// SWAR mask with the high bit set in every byte of `word` equal to `byte`
/// (may contain false positives only above a true match, which callers
/// re-check byte by byte).
#[inline]
fn byte_mask(word: u64, byte: u8) -> u64 {
    let x = word ^ (LO * u64::from(byte));
    x.wrapping_sub(LO) & !x & HI
}

/// Position of the first byte in `hay[from..]` that is one of `needles`
/// (1 to 3 bytes), scanning eight bytes at a time.
#[inline]
pub(crate) fn find_any(hay: &[u8], from: usize, needles: &[u8]) -> Option<usize> {
    let mut i = from;
    while i + 8 <= hay.len() {
        let mut chunk = [0u8; 8];
        chunk.copy_from_slice(&hay[i..i + 8]);
        let w = u64::from_le_bytes(chunk);
        let mut m = 0u64;
        for &n in needles {
            m |= byte_mask(w, n);
        }
        if m != 0 {
            break;
        }
        i += 8;
    }
    hay.get(i..)?.iter().position(|c| needles.contains(c)).map(|p| i + p)
}

fn tag_end(b: &[u8], from: usize) -> usize {
    let mut j = from;
    loop {
        let Some(p) = find_any(b, j, b">\"'") else {
            return b.len();
        };
        if b[p] == b'>' {
            return p + 1;
        }
        let Some(close) = find_any(b, p + 1, &[b[p]]) else {
            return b.len();
        };
        j = close + 1;
    }
}

/// Lightweight tag scanner (not a full tokenizer). Returns the maximum
/// nesting depth estimate.
fn scan(html: &str, on_event: &mut dyn FnMut(ScanEvent)) -> usize {
    let b = html.as_bytes();
    let mut i = 0usize;
    let mut depth = 0usize;
    let mut max_depth = 0usize;
    while i < b.len() {
        let Some(pos) = find_any(b, i, b"<") else {
            break;
        };
        i = pos;
        if b[i..].starts_with(b"<!--") {
            let end = if b[i + 4..].starts_with(b">") {
                i + 5
            } else if b[i + 4..].starts_with(b"->") {
                i + 6
            } else {
                find_ci(b, i + 4, b"-->").map(|p| p + 3).unwrap_or(b.len())
            };
            on_event(ScanEvent::Strip { start: i, end });
            i = end;
            continue;
        }
        let is_end = b.get(i + 1) == Some(&b'/');
        let name_start = if is_end { i + 2 } else { i + 1 };
        if !b.get(name_start).is_some_and(u8::is_ascii_alphabetic) {
            i += 1;
            continue;
        }
        let mut name_end = name_start;
        while name_end < b.len()
            && (b[name_end].is_ascii_alphanumeric() || b[name_end] == b'-' || b[name_end] == b':')
        {
            name_end += 1;
        }
        // Lowercase the tag name into a stack buffer (names longer than the
        // buffer are never special).
        let mut name_buf = [0u8; 12];
        let raw_name = &b[name_start..name_end];
        let name: &[u8] = if raw_name.len() <= name_buf.len() {
            for (dst, src) in name_buf.iter_mut().zip(raw_name) {
                *dst = src.to_ascii_lowercase();
            }
            &name_buf[..raw_name.len()]
        } else {
            b"-"
        };
        let end = tag_end(b, name_end);
        if is_void(name) || has_optional_end(name) {
            i = end;
            continue;
        }
        if is_end {
            depth = depth.saturating_sub(1);
            on_event(ScanEvent::Tag { start: i, end, depth });
            i = end;
            continue;
        }
        let self_closing = end >= 2 && b[end - 2] == b'/';
        match name {
            b"svg" if !self_closing => {
                if let Some(close) = find_ci(b, end, b"</svg") {
                    let close_end = tag_end(b, close + 5);
                    on_event(ScanEvent::Strip { start: i, end: close_end });
                    i = close_end;
                    continue;
                }
            },
            b"script" | b"style" => {
                let close_pat: &[u8] = if name == b"script" { b"</script" } else { b"</style" };
                let close = find_ci(b, end, close_pat);
                let tag_lower = b[i..end].to_ascii_lowercase();
                let is_json_ld = name == b"script" && tag_lower.windows(7).any(|w| w == b"ld+json");
                // Scripts in the "escaped" state (`<!--` inside) are left to
                // the real tokenizer, whose end-tag rules differ.
                let escaped = close
                    .is_some_and(|c| name == b"script" && find_ci(&b[..c], end, b"<!--").is_some());
                if let Some(c) = close {
                    if !is_json_ld && !escaped {
                        let close_end = tag_end(b, c + close_pat.len());
                        on_event(ScanEvent::Strip { start: i, end: close_end });
                        i = close_end;
                        continue;
                    }
                }
            },
            _ => {},
        }
        on_event(ScanEvent::Tag { start: i, end, depth });
        depth += 1;
        max_depth = max_depth.max(depth);
        if is_raw_text(name) {
            let mut close = [0u8; 14];
            close[0] = b'<';
            close[1] = b'/';
            close[2..2 + name.len()].copy_from_slice(name);
            i = find_ci(b, end, &close[..2 + name.len()]).unwrap_or(b.len());
            continue;
        }
        i = end;
    }
    max_depth
}

/// Prepares HTML for parsing: removes non-content byte ranges (comments,
/// scripts other than JSON-LD, styles, inline SVG) and, for adversarial
/// documents, start / end tags nested deeper than `limit` (text is kept).
/// Returns `None` when nothing worth rewriting was found.
pub(crate) fn preprocess(html: &str, limit: usize) -> Option<String> {
    let mut strip_bytes = 0usize;
    let max_depth = scan(html, &mut |ev| {
        if let ScanEvent::Strip { start, end } = ev {
            strip_bytes += end.saturating_sub(start);
        }
    });
    let too_deep = max_depth > limit;
    if !too_deep && strip_bytes < 2048 {
        return None;
    }
    let mut out = String::with_capacity(html.len().saturating_sub(strip_bytes) + 64);
    let mut last = 0usize;
    scan(html, &mut |ev| {
        let (start, end, remove) = match ev {
            ScanEvent::Strip { start, end } => (start, end, true),
            ScanEvent::Tag { start, end, depth } => (start, end, too_deep && depth >= limit),
        };
        if remove && start >= last && html.is_char_boundary(start) && html.is_char_boundary(end) {
            out.push_str(&html[last..start]);
            // Keep a separator so that words around the removed range do not merge.
            out.push(' ');
            last = end;
        }
    });
    out.push_str(&html[last..]);
    Some(out)
}

impl Arena {
    pub(crate) fn from_html(html: &str) -> Arena {
        let tree = match preprocess(html, MAX_NESTING) {
            Some(clean) => obscura_dom::parse_html(&clean),
            None => obscura_dom::parse_html(html),
        };
        Arena::from_tree(tree, html.len())
    }

    pub(crate) fn from_tree(tree: DomTree, size_hint: usize) -> Arena {
        let mut nodes: Vec<ANode> = Vec::with_capacity(size_hint / 24 + 16);
        let mut text = String::with_capacity(size_hint / 2);
        let doc = tree.document();

        // Iterative pre-order traversal. Stack holds (source id, arena parent).
        let mut stack: Vec<(NodeId, u32)> = vec![(doc, NONE)];
        // Last child appended per arena parent, to link siblings in O(1).
        let mut last_child: Vec<u32> = Vec::with_capacity(size_hint / 24 + 16);

        while let Some((sid, parent)) = stack.pop() {
            let idx = nodes.len() as u32;
            let mut children_last: Option<NodeId> = None;
            let mut text_start = 0u32;
            let mut tlen = 0u32;
            let info = tree.with_node(sid, |n| {
                children_last = n.last_child;
                match &n.data {
                    NodeData::Element { name, .. } => {
                        (Kind::Element, Tag::from_name(name.local.as_ref()))
                    },
                    NodeData::Text { contents } => {
                        text_start = text.len() as u32;
                        tlen = contents.len() as u32;
                        text.push_str(contents);
                        (Kind::Text, Tag::Other)
                    },
                    _ => (Kind::Other, Tag::Other),
                }
            });
            let Some((kind, tag)) = info else {
                continue;
            };
            nodes.push(ANode {
                source: sid,
                kind,
                tag,
                parent,
                first_child: NONE,
                next_sibling: NONE,
                text_start,
                text_len: tlen,
            });
            last_child.push(NONE);
            if parent != NONE {
                let p = parent as usize;
                let prev = last_child[p];
                if prev == NONE {
                    nodes[p].first_child = idx;
                } else {
                    nodes[prev as usize].next_sibling = idx;
                }
                last_child[p] = idx;
            }
            // Comments, doctypes and processing instructions have no children
            // worth visiting; template contents live in a detached document.
            if kind == Kind::Text {
                continue;
            }
            // Push children last-to-first so they pop in document order.
            let mut cur = children_last;
            while let Some(c) = cur {
                stack.push((c, idx));
                cur = tree.with_node(c, |n| n.prev_sibling).flatten();
            }
        }

        let mut arena = Arena { tree, nodes, text, body: NONE, html: NONE };
        for (i, n) in arena.nodes.iter().enumerate() {
            if n.tag == Tag::Html && arena.html == NONE {
                arena.html = i as u32;
            }
            if n.tag == Tag::Body && arena.body == NONE {
                arena.body = i as u32;
                break;
            }
        }
        arena
    }

    #[inline]
    pub(crate) fn node(&self, i: u32) -> &ANode {
        &self.nodes[i as usize]
    }

    #[inline]
    pub(crate) fn text_of(&self, i: u32) -> &str {
        let n = &self.nodes[i as usize];
        let s = n.text_start as usize;
        self.text.get(s..s + n.text_len as usize).unwrap_or("")
    }

    /// Reads an attribute value (ASCII case-insensitive name match is not
    /// needed: html5ever lowercases attribute names in HTML content).
    pub(crate) fn attr<R>(&self, i: u32, name: &str, f: impl FnOnce(&str) -> R) -> Option<R> {
        let n = &self.nodes[i as usize];
        if n.kind != Kind::Element {
            return None;
        }
        self.tree.with_node(n.source, |node| node.get_attribute(name).map(f)).flatten()
    }

    pub(crate) fn attr_string(&self, i: u32, name: &str) -> Option<String> {
        self.attr(i, name, str::to_string)
    }

    /// Iterates over the arena indices of the children of `i`.
    pub(crate) fn children(&self, i: u32) -> ChildIter<'_> {
        ChildIter { arena: self, cur: self.nodes[i as usize].first_child }
    }

    /// End (exclusive) of the pre-order index range covered by the subtree of `i`.
    /// Arena indices are assigned in pre-order, so a subtree is a contiguous range.
    pub(crate) fn subtree_end(&self, i: u32) -> u32 {
        let mut cur = i;
        loop {
            let n = &self.nodes[cur as usize];
            if n.next_sibling != NONE {
                return n.next_sibling;
            }
            if n.parent == NONE {
                return self.nodes.len() as u32;
            }
            cur = n.parent;
        }
    }

    /// Plain text of a subtree (no whitespace normalization), iterative.
    pub(crate) fn raw_text(&self, i: u32) -> String {
        let end = self.subtree_end(i);
        let mut out = String::new();
        let mut j = i;
        while j < end {
            let n = &self.nodes[j as usize];
            if n.kind == Kind::Text {
                out.push_str(self.text_of(j));
            }
            j += 1;
        }
        out
    }
}

pub(crate) struct ChildIter<'a> {
    arena: &'a Arena,
    cur: u32,
}

impl Iterator for ChildIter<'_> {
    type Item = u32;
    fn next(&mut self) -> Option<u32> {
        if self.cur == NONE {
            return None;
        }
        let c = self.cur;
        self.cur = self.arena.nodes[c as usize].next_sibling;
        Some(c)
    }
}

/// Collapses runs of whitespace to single spaces and trims the result.
pub(crate) fn collapse_ws(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut pending_space = false;
    for c in s.chars() {
        if c.is_whitespace() || c == '\u{0}' {
            pending_space = true;
        } else {
            if pending_space && !out.is_empty() {
                out.push(' ');
            }
            pending_space = false;
            out.push(c);
        }
    }
    out
}
