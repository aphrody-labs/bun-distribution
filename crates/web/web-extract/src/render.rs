//! The single HTML → GitHub-flavoured Markdown / plain text / block renderer.
//!
//! Used both for whole-document conversion ([`crate::html_to_markdown`]) and
//! for the main-content output of [`crate::extract_main`]. The walk is
//! iterative (explicit stack) so pathological nesting cannot overflow the
//! stack, and output size is linear in input size (tables are never padded to
//! column widths).

use url::Url;

use crate::{
    dom::{Arena, Kind, NONE, Tag, collapse_ws},
    types::{Block, BlockKind},
};

#[derive(Clone, Copy, Debug)]
pub(crate) struct RenderOptions {
    /// Emit `![alt](src)` for images (otherwise images are dropped).
    pub images: bool,
    /// Keep links whose href is a same-document fragment (`#section`).
    pub fragment_links: bool,
    /// Emit links at all (otherwise only their text is kept).
    pub links: bool,
}

pub(crate) struct Rendered {
    pub markdown: String,
    pub text: String,
    pub blocks: Vec<Block>,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum MarkKind {
    Bold,
    Italic,
    Strike,
    Link,
}

struct Mark {
    kind: MarkKind,
    open: &'static str,
    close: String,
    emitted: bool,
}

#[derive(Default)]
struct InlineBuf {
    md: String,
    text: String,
    pending_space: bool,
    pending_break: bool,
}

enum Container {
    Quote,
    List { ordered: bool, next: u64 },
    Item { marker: String, used: bool },
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Ctx {
    Heading(u8),
    Item,
    Quote,
}

struct RBlock {
    kind: BlockKind,
    level: Option<u8>,
    md: String,
    text: String,
    first_prefix: String,
    rest_prefix: String,
    tight: bool,
    in_item: bool,
    public: bool,
}

struct TableCtx {
    rows: Vec<Vec<String>>,
    text_rows: Vec<Vec<String>>,
    caption_md: String,
    caption_text: String,
    row_open: bool,
    /// Inline buffer saved while a cell or caption is being rendered.
    saved: Option<InlineBuf>,
    saved_marks: Vec<Mark>,
    cell_colspan: usize,
}

enum Frame {
    Enter(u32),
    ExitFlush,
    ExitMark,
    ExitList,
    ExitItem,
    ExitQuote,
    ExitHeading,
    ExitTable,
    ExitRow,
    ExitCell,
    ExitCaption,
    ExitCellSpace,
}

struct Renderer<'a> {
    arena: &'a Arena,
    excluded: &'a [bool],
    base: Option<&'a Url>,
    opts: RenderOptions,
    buf: InlineBuf,
    marks: Vec<Mark>,
    containers: Vec<Container>,
    ctx: Vec<Ctx>,
    blocks: Vec<RBlock>,
    tables: Vec<TableCtx>,
    /// Depth of table cells being rendered (block structure is flattened inside cells).
    cell_depth: usize,
}

const MAX_COLSPAN: usize = 8;

pub(crate) fn resolve_href(raw: &str, base: Option<&Url>) -> Option<String> {
    let raw = raw.trim();
    if raw.is_empty() {
        return None;
    }
    let lower: String = raw.chars().take(12).collect::<String>().to_ascii_lowercase();
    let lower: String = lower.chars().filter(|c| !c.is_whitespace() && !c.is_control()).collect();
    if lower.starts_with("javascript:")
        || lower.starts_with("vbscript:")
        || lower.starts_with("data:")
    {
        return None;
    }
    match base {
        Some(b) => Some(b.join(raw).map(|u| u.to_string()).unwrap_or_else(|_| raw.to_string())),
        None => Some(raw.to_string()),
    }
}

fn md_url(url: &str) -> String {
    let mut out = String::with_capacity(url.len());
    for c in url.chars() {
        match c {
            ' ' => out.push_str("%20"),
            '(' => out.push_str("%28"),
            ')' => out.push_str("%29"),
            '<' => out.push_str("%3C"),
            '>' => out.push_str("%3E"),
            '\n' | '\r' | '\t' => {},
            _ => out.push(c),
        }
    }
    out
}

/// Escapes Markdown-significant characters inside a single word.
fn escape_word(word: &str, out: &mut String) {
    if !word.bytes().any(|b| matches!(b, b'*' | b'`' | b'\\' | b'_' | b'[' | b']')) {
        out.push_str(word);
        return;
    }
    let chars: Vec<char> = word.chars().collect();
    let last = chars.len().saturating_sub(1);
    for (i, &c) in chars.iter().enumerate() {
        match c {
            '*' | '`' | '\\' => {
                out.push('\\');
                out.push(c);
            },
            '_' if i == 0
                || i == last
                || !chars[i - 1].is_alphanumeric()
                || !chars[i + 1].is_alphanumeric() =>
            {
                out.push('\\');
                out.push(c);
            },
            '[' | ']' => {
                out.push('\\');
                out.push(c);
            },
            _ => out.push(c),
        }
    }
}

/// Escapes a leading character that would otherwise start a block construct.
fn escape_block_start(md: &mut String) {
    let bytes = md.as_bytes();
    let Some(&first) = bytes.first() else { return };
    let needs = match first {
        b'#' | b'>' | b'=' | b'|' => true,
        b'-' | b'+' => matches!(bytes.get(1), None | Some(b' ')) || md.starts_with("---"),
        b'0'..=b'9' => {
            let digits = bytes.iter().take_while(|b| b.is_ascii_digit()).count();
            digits <= 9
                && matches!(bytes.get(digits), Some(b'.') | Some(b')'))
                && matches!(bytes.get(digits + 1), None | Some(b' '))
        },
        _ => false,
    };
    if needs {
        if first.is_ascii_digit() {
            let digits = bytes.iter().take_while(|b| b.is_ascii_digit()).count();
            md.insert(digits, '\\');
        } else {
            md.insert(0, '\\');
        }
    }
}

fn class_language(class: &str) -> Option<String> {
    for token in class.split(|c: char| c.is_whitespace() || c == ';') {
        let t = token.trim();
        for prefix in ["language-", "lang-", "highlight-source-", "brush:", "sourceCode "] {
            if let Some(rest) = t.strip_prefix(prefix) {
                if !rest.is_empty() {
                    return Some(rest.to_string());
                }
            }
        }
    }
    None
}

fn sanitize_lang(lang: &str) -> String {
    lang.chars()
        .filter(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '+' | '-' | '.' | '#'))
        .take(32)
        .collect::<String>()
        .to_ascii_lowercase()
}

impl<'a> Renderer<'a> {
    fn is_excluded(&self, i: u32) -> bool {
        self.excluded.get(i as usize).copied().unwrap_or(false)
    }

    // ---- inline emission -------------------------------------------------

    fn emit_atom(&mut self, md: &str, text: &str) {
        if md.is_empty() && text.is_empty() {
            return;
        }
        if self.buf.pending_break && !self.buf.md.is_empty() {
            self.buf.md.push_str("  \n");
            self.buf.text.push('\n');
        } else if self.buf.pending_space && !self.buf.md.is_empty() {
            self.buf.md.push(' ');
            if !self.buf.text.is_empty() && !self.buf.text.ends_with('\n') {
                self.buf.text.push(' ');
            }
        }
        self.buf.pending_space = false;
        self.buf.pending_break = false;
        for m in self.marks.iter_mut() {
            if !m.emitted {
                self.buf.md.push_str(m.open);
                m.emitted = true;
            }
        }
        self.buf.md.push_str(md);
        self.buf.text.push_str(text);
    }

    fn emit_text(&mut self, s: &str) {
        let mut word_md = String::new();
        let mut started = false;
        for (idx, word) in s.split(|c: char| c.is_whitespace()).enumerate() {
            if idx > 0 {
                self.buf.pending_space = true;
            }
            if word.is_empty() {
                continue;
            }
            started = true;
            word_md.clear();
            escape_word(word, &mut word_md);
            let md = std::mem::take(&mut word_md);
            self.emit_atom(&md, word);
            word_md = md;
        }
        let _ = started;
    }

    fn open_mark(&mut self, kind: MarkKind, open: &'static str, close: String) -> bool {
        if kind != MarkKind::Link && self.marks.iter().any(|m| m.kind == kind) {
            return false;
        }
        if kind == MarkKind::Link && self.marks.iter().any(|m| m.kind == MarkKind::Link) {
            return false;
        }
        self.marks.push(Mark { kind, open, close, emitted: false });
        true
    }

    fn close_mark(&mut self) {
        if let Some(m) = self.marks.pop() {
            if m.emitted {
                self.buf.md.push_str(&m.close);
            }
        }
    }

    /// Closes all emitted marks at a block boundary; they reopen lazily.
    fn suspend_marks(&mut self) {
        for idx in (0..self.marks.len()).rev() {
            if self.marks[idx].emitted {
                let close = self.marks[idx].close.clone();
                self.buf.md.push_str(&close);
                self.marks[idx].emitted = false;
            }
        }
    }

    // ---- block emission --------------------------------------------------

    fn prefixes(&mut self) -> (String, String, bool, bool) {
        let mut first = String::new();
        let mut rest = String::new();
        let mut new_item = false;
        let mut in_item = false;
        for c in self.containers.iter_mut() {
            match c {
                Container::Quote => {
                    first.push_str("> ");
                    rest.push_str("> ");
                },
                Container::List { .. } => {},
                Container::Item { marker, used } => {
                    in_item = true;
                    let pad = " ".repeat(marker.len());
                    if *used {
                        first.push_str(&pad);
                    } else {
                        first.push_str(marker);
                        *used = true;
                        new_item = true;
                    }
                    rest.push_str(&pad);
                },
            }
        }
        (first, rest, new_item, in_item)
    }

    fn push_block(
        &mut self,
        kind: BlockKind,
        level: Option<u8>,
        md: String,
        text: String,
        public: bool,
    ) {
        let (first_prefix, rest_prefix, new_item, in_item) = self.prefixes();
        let tight = new_item && self.blocks.last().is_some_and(|b| b.in_item);
        self.blocks.push(RBlock {
            kind,
            level,
            md,
            text,
            first_prefix,
            rest_prefix,
            tight,
            in_item,
            public,
        });
    }

    fn current_kind(&self) -> (BlockKind, Option<u8>) {
        if let Some(c) = self.ctx.iter().rev().next() {
            match c {
                Ctx::Heading(l) => return (BlockKind::Heading, Some(*l)),
                Ctx::Item => return (BlockKind::ListItem, None),
                Ctx::Quote => return (BlockKind::Quote, None),
            }
        }
        (BlockKind::Paragraph, None)
    }

    fn flush(&mut self) {
        if self.cell_depth > 0 {
            self.buf.pending_space = true;
            return;
        }
        self.suspend_marks();
        let mut buf = std::mem::take(&mut self.buf);
        let text = buf.text.trim().to_string();
        if text.is_empty() && buf.md.trim().is_empty() {
            // Nothing to render (e.g. only an empty link); drop it.
            return;
        }
        let (kind, level) = self.current_kind();
        let mut md = buf.md.trim().to_string();
        buf.md.clear();
        if kind == BlockKind::Heading {
            let l = level.unwrap_or(1).clamp(1, 6) as usize;
            let single = md.replace("  \n", " ").replace('\n', " ");
            md = format!("{} {}", "#".repeat(l), single);
            let text_single = collapse_ws(&text);
            self.push_block(kind, level, md, text_single, true);
        } else {
            escape_block_start(&mut md);
            self.push_block(kind, level, md, text, true);
        }
    }

    fn emit_code_block(&mut self, code: &str, lang: &str) {
        let mut code = code.replace("\r\n", "\n").replace('\r', "\n");
        if code.starts_with('\n') {
            code.remove(0);
        }
        let trimmed_len = code.trim_end().len();
        code.truncate(trimmed_len);
        if code.trim().is_empty() {
            return;
        }
        if self.cell_depth > 0 {
            let flat = collapse_ws(&code);
            let md = inline_code(&flat);
            self.emit_atom(&md, &flat);
            return;
        }
        self.flush();
        let mut longest = 0;
        let mut run = 0;
        for c in code.chars() {
            if c == '`' {
                run += 1;
                longest = longest.max(run);
            } else {
                run = 0;
            }
        }
        let fence = "`".repeat((longest + 1).max(3));
        let md = format!("{fence}{lang}\n{code}\n{fence}");
        self.push_block(BlockKind::Code, None, md, code, true);
    }

    // ---- subtree helpers -------------------------------------------------

    /// Collects preformatted text of a subtree, honouring exclusions and
    /// turning `<br>` and block boundaries into newlines.
    fn collect_pre(&self, i: u32) -> String {
        let end = self.arena.subtree_end(i);
        let mut out = String::new();
        let mut j = i + 1;
        while j < end {
            if self.is_excluded(j) {
                j = self.arena.subtree_end(j);
                continue;
            }
            let n = self.arena.node(j);
            match n.kind {
                Kind::Text => out.push_str(self.arena.text_of(j)),
                Kind::Element => {
                    if n.tag == Tag::Br {
                        out.push('\n');
                    } else if n.tag.is_non_content() {
                        j = self.arena.subtree_end(j);
                        continue;
                    } else if matches!(n.tag, Tag::Div | Tag::P | Tag::Li | Tag::Tr)
                        && !out.is_empty()
                        && !out.ends_with('\n')
                    {
                        out.push('\n');
                    }
                },
                Kind::Other => {},
            }
            j += 1;
        }
        out
    }

    fn code_language(&self, pre: u32) -> String {
        let mut candidates: Vec<u32> = vec![pre];
        if let Some(first) =
            self.arena.children(pre).find(|&c| self.arena.node(c).kind == Kind::Element)
        {
            candidates.push(first);
        }
        let parent = self.arena.node(pre).parent;
        if parent != NONE {
            candidates.push(parent);
        }
        for c in candidates {
            for attr in ["data-lang", "data-language"] {
                if let Some(l) = self.arena.attr_string(c, attr) {
                    let l = sanitize_lang(&l);
                    if !l.is_empty() {
                        return l;
                    }
                }
            }
            if let Some(l) = self.arena.attr(c, "class", class_language).flatten() {
                let l = sanitize_lang(&l);
                if !l.is_empty() {
                    return l;
                }
            }
        }
        String::new()
    }

    fn image_atom(&mut self, i: u32) {
        let alt = self.arena.attr(i, "alt", collapse_ws).unwrap_or_default();
        let mut src: Option<String> = None;
        for attr in ["src", "data-src", "data-lazy-src", "data-original"] {
            if let Some(v) = self.arena.attr_string(i, attr) {
                let v = v.trim();
                if !v.is_empty() && !v.to_ascii_lowercase().starts_with("data:") {
                    src = Some(v.to_string());
                    break;
                }
            }
        }
        if src.is_none() {
            src = self
                .arena
                .attr(i, "srcset", |s| {
                    s.split(',')
                        .next()
                        .and_then(|c| c.split_whitespace().next())
                        .map(str::to_string)
                })
                .flatten()
                .filter(|s| !s.to_ascii_lowercase().starts_with("data:"));
        }
        let Some(url) = src.and_then(|s| resolve_href(&s, self.base)) else {
            return;
        };
        let alt_md = alt.replace('[', "\\[").replace(']', "\\]");
        let md = format!("![{alt_md}]({})", md_url(&url));
        self.emit_atom(&md, "");
    }

    /// Classifies a table as a data table (rendered as GFM) or a layout table
    /// (rendered transparently as blocks).
    fn is_layout_table(&self, i: u32) -> bool {
        if self
            .arena
            .attr(i, "role", |r| {
                let r = r.trim().to_ascii_lowercase();
                r == "presentation" || r == "none"
            })
            .unwrap_or(false)
        {
            return true;
        }
        let end = self.arena.subtree_end(i);
        let mut max_cells = 0usize;
        let mut rows = 0usize;
        let mut cells = 0usize;
        let mut blocks = 0usize;
        let mut text_len = 0usize;
        let mut j = i + 1;
        let mut row_cells = 0usize;
        while j < end {
            let n = self.arena.node(j);
            match n.kind {
                Kind::Element => match n.tag {
                    Tag::Table => return true,
                    Tag::Tr => {
                        rows += 1;
                        max_cells = max_cells.max(row_cells);
                        row_cells = 0;
                    },
                    Tag::Td | Tag::Th => {
                        row_cells += 1;
                        cells += 1;
                    },
                    Tag::P | Tag::H(_) | Tag::Pre | Tag::Blockquote | Tag::Ul | Tag::Ol => {
                        blocks += 1
                    },
                    _ => {},
                },
                Kind::Text => text_len += n.text_len as usize,
                Kind::Other => {},
            }
            j += 1;
        }
        max_cells = max_cells.max(row_cells);
        rows == 0 || max_cells <= 1 || (blocks >= 2 && text_len / cells.max(1) > 150)
    }

    fn inline_code_atom(&mut self, i: u32) {
        let raw = self.collect_pre(i);
        let flat = collapse_ws(&raw);
        if flat.is_empty() {
            return;
        }
        let md = inline_code(&flat);
        self.emit_atom(&md, &flat);
    }

    // ---- tables ----------------------------------------------------------

    fn table_start_cell(&mut self, colspan: usize) {
        let buf = std::mem::take(&mut self.buf);
        let marks = std::mem::take(&mut self.marks);
        if let Some(t) = self.tables.last_mut() {
            t.saved = Some(buf);
            t.saved_marks = marks;
            t.cell_colspan = colspan;
            if !t.row_open {
                t.rows.push(Vec::new());
                t.text_rows.push(Vec::new());
                t.row_open = true;
            }
        }
        self.cell_depth += 1;
    }

    fn table_take_cell(&mut self) -> (String, String) {
        while !self.marks.is_empty() {
            self.close_mark();
        }
        let buf = std::mem::take(&mut self.buf);
        self.cell_depth = self.cell_depth.saturating_sub(1);
        if let Some(t) = self.tables.last_mut() {
            if let Some(saved) = t.saved.take() {
                self.buf = saved;
            }
            self.marks = std::mem::take(&mut t.saved_marks);
        }
        let md = buf.md.trim().replace("  \n", " ").replace('\n', " ").replace('|', "\\|");
        let text = collapse_ws(&buf.text);
        (md, text)
    }

    fn table_end_cell(&mut self) {
        let (md, text) = self.table_take_cell();
        if let Some(t) = self.tables.last_mut() {
            let span = t.cell_colspan.clamp(1, MAX_COLSPAN);
            if let (Some(row), Some(trow)) = (t.rows.last_mut(), t.text_rows.last_mut()) {
                row.push(md);
                trow.push(text);
                for _ in 1..span {
                    row.push(String::new());
                }
            }
        }
    }

    fn table_end_caption(&mut self) {
        let (md, text) = self.table_take_cell();
        if let Some(t) = self.tables.last_mut() {
            t.caption_md = md;
            t.caption_text = text;
            // A caption does not open a row.
            if t.rows.last().is_some_and(Vec::is_empty) && t.row_open {
                t.rows.pop();
                t.text_rows.pop();
                t.row_open = false;
            }
        }
    }

    fn table_end(&mut self) {
        let Some(t) = self.tables.pop() else { return };
        if !t.caption_text.is_empty() {
            self.push_block(
                BlockKind::Paragraph,
                None,
                t.caption_md.clone(),
                t.caption_text.clone(),
                true,
            );
        }
        let rows: Vec<&Vec<String>> = t.rows.iter().filter(|r| !r.is_empty()).collect();
        if rows.is_empty() || t.text_rows.iter().all(|r| r.iter().all(String::is_empty)) {
            return;
        }
        let cols = rows.iter().map(|r| r.len()).max().unwrap_or(0).max(1);
        let mut md = String::new();
        for (ri, row) in rows.iter().enumerate() {
            md.push('|');
            for ci in 0..cols {
                let cell = row.get(ci).map(String::as_str).unwrap_or("");
                md.push(' ');
                md.push_str(cell);
                md.push_str(if cell.is_empty() { "|" } else { " |" });
            }
            md.push('\n');
            if ri == 0 {
                md.push('|');
                for _ in 0..cols {
                    md.push_str(" --- |");
                }
                md.push('\n');
            }
        }
        md.pop();
        let text = t
            .text_rows
            .iter()
            .filter(|r| r.iter().any(|c| !c.is_empty()))
            .map(|r| r.iter().filter(|c| !c.is_empty()).cloned().collect::<Vec<_>>().join(" | "))
            .collect::<Vec<_>>()
            .join("\n");
        self.push_block(BlockKind::Table, None, md, text, true);
    }

    // ---- walk ------------------------------------------------------------

    fn run(&mut self, roots: &[u32]) {
        let mut stack: Vec<Frame> = Vec::with_capacity(256);
        for &r in roots.iter().rev() {
            stack.push(Frame::ExitFlush);
            stack.push(Frame::Enter(r));
        }
        while let Some(frame) = stack.pop() {
            match frame {
                Frame::Enter(i) => self.enter(i, &mut stack),
                Frame::ExitFlush => self.flush(),
                Frame::ExitMark => self.close_mark(),
                Frame::ExitList => {
                    self.flush();
                    self.containers.pop();
                },
                Frame::ExitItem => {
                    self.flush();
                    self.containers.pop();
                    self.ctx.pop();
                },
                Frame::ExitQuote => {
                    self.flush();
                    self.containers.pop();
                    self.ctx.pop();
                },
                Frame::ExitHeading => {
                    self.flush();
                    self.ctx.pop();
                },
                Frame::ExitTable => self.table_end(),
                Frame::ExitRow => {
                    if let Some(t) = self.tables.last_mut() {
                        t.row_open = false;
                    }
                },
                Frame::ExitCell => self.table_end_cell(),
                Frame::ExitCaption => self.table_end_caption(),
                Frame::ExitCellSpace => self.buf.pending_space = true,
            }
        }
        self.flush();
    }

    fn push_children(&self, i: u32, stack: &mut Vec<Frame>) {
        let start = stack.len();
        for c in self.arena.children(i) {
            stack.push(Frame::Enter(c));
        }
        stack[start..].reverse();
    }

    fn enter(&mut self, i: u32, stack: &mut Vec<Frame>) {
        if self.is_excluded(i) {
            return;
        }
        let node = self.arena.node(i);
        match node.kind {
            Kind::Text => {
                let t = self.arena.text_of(i);
                self.emit_text(t);
                return;
            },
            Kind::Other => {
                if node.parent == NONE {
                    self.push_children(i, stack);
                }
                return;
            },
            Kind::Element => {},
        }
        let tag = node.tag;
        if tag.is_non_content() {
            return;
        }
        let in_cell = self.cell_depth > 0;
        match tag {
            Tag::Pre => {
                let code = self.collect_pre(i);
                let lang = self.code_language(i);
                self.emit_code_block(&code, &lang);
                return;
            },
            Tag::Code | Tag::Kbd | Tag::Samp => {
                self.inline_code_atom(i);
                return;
            },
            Tag::Img => {
                if self.opts.images {
                    self.image_atom(i);
                }
                return;
            },
            Tag::Br => {
                if in_cell {
                    self.buf.pending_space = true;
                } else {
                    self.buf.pending_break = true;
                }
                return;
            },
            Tag::Hr => {
                if in_cell {
                    self.buf.pending_space = true;
                } else {
                    self.flush();
                    self.push_block(
                        BlockKind::Paragraph,
                        None,
                        "---".to_string(),
                        String::new(),
                        false,
                    );
                }
                return;
            },
            Tag::Input | Tag::Select | Tag::Textarea => return,
            _ => {},
        }

        if in_cell {
            // Flatten any structure inside table cells to inline content.
            match tag {
                Tag::Strong | Tag::B => self.inline_mark(i, MarkKind::Bold, stack),
                Tag::Em | Tag::I => self.inline_mark(i, MarkKind::Italic, stack),
                Tag::Del | Tag::S => self.inline_mark(i, MarkKind::Strike, stack),
                Tag::A => self.link(i, stack),
                t if t.is_block() => {
                    self.buf.pending_space = true;
                    stack.push(Frame::ExitCellSpace);
                    self.push_children(i, stack);
                },
                _ => self.push_children(i, stack),
            }
            return;
        }

        match tag {
            Tag::Table => {
                if self.is_layout_table(i) {
                    self.flush();
                    stack.push(Frame::ExitFlush);
                } else {
                    self.flush();
                    self.tables.push(TableCtx {
                        rows: Vec::new(),
                        text_rows: Vec::new(),
                        caption_md: String::new(),
                        caption_text: String::new(),
                        row_open: false,
                        saved: None,
                        saved_marks: Vec::new(),
                        cell_colspan: 1,
                    });
                    stack.push(Frame::ExitTable);
                }
                self.push_children(i, stack);
            },
            Tag::Tr if !self.tables.is_empty() => {
                if let Some(t) = self.tables.last_mut() {
                    t.rows.push(Vec::new());
                    t.text_rows.push(Vec::new());
                    t.row_open = true;
                }
                stack.push(Frame::ExitRow);
                self.push_children(i, stack);
            },
            Tag::Td | Tag::Th if !self.tables.is_empty() => {
                let colspan = self
                    .arena
                    .attr(i, "colspan", |v| v.trim().parse::<usize>().unwrap_or(1))
                    .unwrap_or(1);
                self.table_start_cell(colspan);
                stack.push(Frame::ExitCell);
                self.push_children(i, stack);
            },
            Tag::Caption if !self.tables.is_empty() => {
                self.table_start_cell(1);
                stack.push(Frame::ExitCaption);
                self.push_children(i, stack);
            },
            Tag::Ul | Tag::Ol => {
                self.flush();
                let start = if tag == Tag::Ol {
                    self.arena
                        .attr(i, "start", |v| v.trim().parse::<u64>().unwrap_or(1))
                        .unwrap_or(1)
                        .min(999_999_999)
                } else {
                    1
                };
                self.containers.push(Container::List { ordered: tag == Tag::Ol, next: start });
                stack.push(Frame::ExitList);
                self.push_children(i, stack);
            },
            Tag::Li => {
                self.flush();
                let marker = match self.containers.last_mut() {
                    Some(Container::List { ordered: true, next }) => {
                        let m = format!("{next}. ");
                        *next = next.saturating_add(1);
                        m
                    },
                    _ => "- ".to_string(),
                };
                self.containers.push(Container::Item { marker, used: false });
                self.ctx.push(Ctx::Item);
                stack.push(Frame::ExitItem);
                self.push_children(i, stack);
            },
            Tag::Blockquote => {
                self.flush();
                self.containers.push(Container::Quote);
                self.ctx.push(Ctx::Quote);
                stack.push(Frame::ExitQuote);
                self.push_children(i, stack);
            },
            Tag::H(level) => {
                self.flush();
                self.ctx.push(Ctx::Heading(level));
                stack.push(Frame::ExitHeading);
                self.push_children(i, stack);
            },
            Tag::Strong | Tag::B => self.inline_mark(i, MarkKind::Bold, stack),
            Tag::Em | Tag::I => self.inline_mark(i, MarkKind::Italic, stack),
            Tag::Del | Tag::S => self.inline_mark(i, MarkKind::Strike, stack),
            Tag::A => self.link(i, stack),
            t if t.is_block() => {
                self.flush();
                stack.push(Frame::ExitFlush);
                self.push_children(i, stack);
            },
            _ => self.push_children(i, stack),
        }
    }

    fn inline_mark(&mut self, i: u32, kind: MarkKind, stack: &mut Vec<Frame>) {
        let (open, close) = match kind {
            MarkKind::Bold => ("**", "**"),
            MarkKind::Italic => ("*", "*"),
            MarkKind::Strike => ("~~", "~~"),
            MarkKind::Link => ("[", "]"),
        };
        if self.open_mark(kind, open, close.to_string()) {
            stack.push(Frame::ExitMark);
        }
        self.push_children(i, stack);
    }

    fn link(&mut self, i: u32, stack: &mut Vec<Frame>) {
        if !self.opts.links {
            self.push_children(i, stack);
            return;
        }
        let href = self.arena.attr_string(i, "href");
        let target = href.as_deref().and_then(|h| {
            if !self.opts.fragment_links && h.trim_start().starts_with('#') {
                return None;
            }
            resolve_href(h, self.base)
        });
        if let Some(url) = target {
            if self.open_mark(MarkKind::Link, "[", format!("]({})", md_url(&url))) {
                stack.push(Frame::ExitMark);
            }
        }
        self.push_children(i, stack);
    }
}

fn inline_code(flat: &str) -> String {
    if flat.contains('`') { format!("`` {flat} ``") } else { format!("`{flat}`") }
}

/// Renders `roots` (in document order) to Markdown, plain text and blocks.
pub(crate) fn render(
    arena: &Arena,
    roots: &[u32],
    excluded: &[bool],
    base: Option<&Url>,
    opts: RenderOptions,
) -> Rendered {
    let mut r = Renderer {
        arena,
        excluded,
        base,
        opts,
        buf: InlineBuf::default(),
        marks: Vec::new(),
        containers: Vec::new(),
        ctx: Vec::new(),
        blocks: Vec::new(),
        tables: Vec::new(),
        cell_depth: 0,
    };
    r.run(roots);

    let mut markdown = String::new();
    let mut text = String::new();
    let mut blocks: Vec<Block> = Vec::new();
    let mut heading_stack: Vec<(u8, String)> = Vec::new();

    for (bi, b) in r.blocks.iter().enumerate() {
        if bi > 0 {
            if b.tight {
                markdown.push('\n');
            } else {
                // The blank separator line keeps only the quote markers shared
                // by both neighbouring blocks.
                let prev = &r.blocks[bi - 1].rest_prefix;
                let common = prev
                    .char_indices()
                    .zip(b.rest_prefix.chars())
                    .take_while(|((_, x), y)| x == y)
                    .last()
                    .map(|((i, c), _)| i + c.len_utf8())
                    .unwrap_or(0);
                markdown.push('\n');
                markdown.push_str(prev[..common].trim_end());
                markdown.push('\n');
            }
        }
        for (li, line) in b.md.split('\n').enumerate() {
            if li == 0 {
                markdown.push_str(&b.first_prefix);
            } else {
                markdown.push('\n');
                if line.is_empty() {
                    markdown.push_str(b.rest_prefix.trim_end());
                } else {
                    markdown.push_str(&b.rest_prefix);
                }
            }
            markdown.push_str(line);
        }

        if !b.public || b.text.is_empty() {
            continue;
        }
        // Contract with the FFI bridge: every block text appears verbatim in
        // `text`, blocks separated by exactly one blank line.
        if !text.is_empty() {
            text.push_str("\n\n");
        }
        text.push_str(&b.text);

        let heading_path: Vec<String> = heading_stack.iter().map(|(_, t)| t.clone()).collect();
        if b.kind == BlockKind::Heading {
            let level = b.level.unwrap_or(1);
            while heading_stack.last().is_some_and(|(l, _)| *l >= level) {
                heading_stack.pop();
            }
            let path: Vec<String> = heading_stack.iter().map(|(_, t)| t.clone()).collect();
            heading_stack.push((level, b.text.clone()));
            blocks.push(Block {
                kind: b.kind,
                level: b.level,
                heading_path: path,
                text: b.text.clone(),
            });
        } else {
            blocks.push(Block { kind: b.kind, level: None, heading_path, text: b.text.clone() });
        }
    }
    if !markdown.is_empty() {
        markdown.push('\n');
    }
    Rendered { markdown, text, blocks }
}
