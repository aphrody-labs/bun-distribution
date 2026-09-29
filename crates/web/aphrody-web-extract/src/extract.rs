//! Main-content extraction (Readability / trafilatura class).
//!
//! Pipeline, all linear in the number of DOM nodes:
//! 1. Arena build (single parse) and metadata collection.
//! 2. Feature pass (top-down): attribute signatures → boilerplate / positive / negative classes,
//!    hidden state, link ancestry.
//! 3. Statistics pass (bottom-up): text chars, link chars, commas, tag and structure counts per
//!    subtree.
//! 4. Boilerplate removal (top-down, outermost first) guarded by protection (`article`, `main`,
//!    `[itemprop=articleBody]`, `h1` holders) and by a dominance test: an element holding nearly
//!    all readable text of the page is a layout wrapper, not boilerplate.
//! 5. Paragraph scoring with propagation to ancestors, link-density and text-density adjustment,
//!    top candidate refinement (shared ancestor of strong alternatives, score climbing) and sibling
//!    merging with DOM-distance gap filling.
//! 6. Conditional cleaning inside the selected content (bottom-up).
//! 7. Rendering with the shared Markdown renderer.

use url::Url;

use crate::{
    date::normalize_date,
    dom::{Arena, Kind, NONE, Tag, collapse_ws},
    meta::{self, PageMeta},
    patterns::{patterns, signature},
    render::{RenderOptions, render},
    simhash::simhash64,
    types::Extracted,
};

/// Options for [`crate::extract_main_with_options`].
#[derive(Clone, Copy, Debug)]
pub struct ExtractOptions {
    /// Keep comment sections (default `false`).
    pub include_comments: bool,
    /// Emit `![alt](src)` images in the Markdown output (default `false`).
    pub include_images: bool,
    /// Keep links in the Markdown output (default `true`).
    pub include_links: bool,
}

impl Default for ExtractOptions {
    fn default() -> Self {
        ExtractOptions { include_comments: false, include_images: false, include_links: true }
    }
}

#[derive(Clone, Copy, Default)]
struct Stats {
    chars: u32,
    link_chars: u32,
    commas: u32,
    tags: u32,
    p: u32,
    img: u32,
    li: u32,
    input: u32,
    embed: u32,
    headings: u32,
    h1: u32,
}

impl Stats {
    fn add(&mut self, o: &Stats) {
        self.chars = self.chars.saturating_add(o.chars);
        self.link_chars = self.link_chars.saturating_add(o.link_chars);
        self.commas = self.commas.saturating_add(o.commas);
        self.tags = self.tags.saturating_add(o.tags);
        self.p = self.p.saturating_add(o.p);
        self.img = self.img.saturating_add(o.img);
        self.li = self.li.saturating_add(o.li);
        self.input = self.input.saturating_add(o.input);
        self.embed = self.embed.saturating_add(o.embed);
        self.headings = self.headings.saturating_add(o.headings);
        self.h1 = self.h1.saturating_add(o.h1);
    }

    fn sub(&mut self, o: &Stats) {
        self.chars = self.chars.saturating_sub(o.chars);
        self.link_chars = self.link_chars.saturating_sub(o.link_chars);
        self.commas = self.commas.saturating_sub(o.commas);
        self.tags = self.tags.saturating_sub(o.tags);
        self.p = self.p.saturating_sub(o.p);
        self.img = self.img.saturating_sub(o.img);
        self.li = self.li.saturating_sub(o.li);
        self.input = self.input.saturating_sub(o.input);
        self.embed = self.embed.saturating_sub(o.embed);
        self.headings = self.headings.saturating_sub(o.headings);
        self.h1 = self.h1.saturating_sub(o.h1);
    }

    fn link_density(&self) -> f32 {
        if self.chars == 0 { 0.0 } else { (self.link_chars as f32 / self.chars as f32).min(1.0) }
    }

    fn plain(&self) -> u32 {
        self.chars.saturating_sub(self.link_chars)
    }
}

const F_HARD: u16 = 1;
const F_SOFT: u16 = 1 << 1;
const F_OVERRIDE: u16 = 1 << 2;
const F_COMMENT: u16 = 1 << 3;
const F_HIDDEN: u16 = 1 << 4;
const F_PROTECTED: u16 = 1 << 5;
const F_IN_LINK: u16 = 1 << 6;
const F_BLOCK_CHILD: u16 = 1 << 7;
const F_IN_ARTICLE: u16 = 1 << 8;
const F_NON_CONTENT: u16 = 1 << 9;
/// Set on an element that has a protected descendant holding real text.
const F_PROT_DESC: u16 = 1 << 10;

#[derive(Clone)]
struct Analysis<'a> {
    arena: &'a Arena,
    flags: Vec<u16>,
    weight: Vec<i16>,
    stats: Vec<Stats>,
    excluded: Vec<bool>,
    sigs: Vec<Option<Box<str>>>,
}

/// FNV-1a hasher for the per-document signature cache (keys are short,
/// attacker-controlled strings but the cache lives for one document only).
#[derive(Default)]
struct FnvHasher(u64);

impl std::hash::Hasher for FnvHasher {
    fn finish(&self) -> u64 {
        self.0
    }
    fn write(&mut self, bytes: &[u8]) {
        let mut h = if self.0 == 0 { 0xcbf2_9ce4_8422_2325 } else { self.0 };
        for &b in bytes {
            h ^= u64::from(b);
            h = h.wrapping_mul(0x0000_0100_0000_01b3);
        }
        self.0 = h;
    }
}

type BuildFnv = std::hash::BuildHasherDefault<FnvHasher>;

fn is_comma(c: char) -> bool {
    matches!(
        c,
        ',' | '\u{060C}'
            | '\u{FE50}'
            | '\u{FE10}'
            | '\u{FE11}'
            | '\u{2E41}'
            | '\u{2E34}'
            | '\u{2E32}'
            | '\u{FF0C}'
            | '\u{3001}'
    )
}

/// Approximate length of whitespace-collapsed text and number of commas.
fn text_metrics(s: &str) -> (u32, u32) {
    let mut chars = 0u32;
    let mut commas = 0u32;
    let mut in_ws = true;
    for c in s.chars() {
        if c.is_whitespace() {
            if !in_ws {
                chars += 1;
                in_ws = true;
            }
        } else {
            in_ws = false;
            chars += 1;
            if is_comma(c) {
                commas += 1;
            }
        }
    }
    (chars, commas)
}

fn is_style_hidden(style: &str) -> bool {
    let compact: String =
        style.chars().filter(|c| !c.is_whitespace()).collect::<String>().to_ascii_lowercase();
    compact.contains("display:none") || compact.contains("visibility:hidden")
}

impl<'a> Analysis<'a> {
    fn new(arena: &'a Arena) -> Self {
        let n = arena.nodes.len();
        let mut a = Analysis {
            arena,
            flags: vec![0; n],
            weight: vec![0; n],
            stats: vec![Stats::default(); n],
            excluded: vec![false; n],
            sigs: vec![None; n],
        };
        a.features();
        a.statistics();
        a
    }

    /// Top-down: attribute classification and inherited flags.
    fn features(&mut self) {
        let pats = patterns();
        let mut cache: std::collections::HashMap<String, (u16, i32), BuildFnv> =
            std::collections::HashMap::default();
        for i in 0..self.arena.nodes.len() {
            let node = &self.arena.nodes[i];
            let parent = node.parent;
            let mut f = 0u16;
            if parent != NONE {
                let pf = self.flags[parent as usize];
                f |= pf & (F_IN_LINK | F_IN_ARTICLE | F_NON_CONTENT);
                if self.arena.nodes[parent as usize].tag == Tag::A {
                    f |= F_IN_LINK;
                }
            }
            if node.kind != Kind::Element {
                self.flags[i] = f;
                continue;
            }
            let tag = node.tag;
            if tag.is_non_content()
                || matches!(
                    tag,
                    Tag::Input | Tag::Select | Tag::Textarea | Tag::Option | Tag::Button
                )
            {
                f |= F_NON_CONTENT;
            }
            let mut weight: i32 = 0;
            let mut sig_owned: Option<String> = None;
            let mut hidden = false;
            let mut article_body = false;
            let mut role_main = false;
            self.arena.tree.with_node(node.source, |n| {
                let (mut id, mut class, mut role, mut aria, mut itemprop) =
                    (None, None, None, None, None);
                for attr in n.attrs().unwrap_or(&[]) {
                    let v = attr.value.as_str();
                    match attr.name.local.as_ref() {
                        "id" => id = Some(v),
                        "class" => class = Some(v),
                        "role" => role = Some(v),
                        "aria-label" => aria = Some(v),
                        "itemprop" => itemprop = Some(v),
                        "hidden" => hidden = true,
                        "aria-hidden" => hidden |= v.trim().eq_ignore_ascii_case("true"),
                        "style" => hidden |= is_style_hidden(v),
                        _ => {},
                    }
                }
                if let Some(ip) = itemprop {
                    let ip = ip.to_ascii_lowercase();
                    if ip.contains("articlebody") || ip.contains("reviewbody") || ip == "text" {
                        article_body = true;
                    }
                }
                if let Some(r) = role {
                    let r = r.trim().to_ascii_lowercase();
                    if r == "main" || r == "article" {
                        role_main = true;
                    }
                }
                if id.is_some()
                    || class.is_some()
                    || role.is_some()
                    || aria.is_some()
                    || itemprop.is_some()
                {
                    let s = signature(&[id, class, role, aria, itemprop]);
                    if !s.is_empty() {
                        sig_owned = Some(s);
                    }
                }
            });
            if let Some(sig) = &sig_owned {
                // Class lists repeat heavily within a page; classify each
                // distinct signature once.
                let (sig_flags, sig_weight) = match cache.get(sig.as_str()) {
                    Some(&v) => v,
                    None => {
                        let mut sf = 0u16;
                        let mut sw = 0i32;
                        if pats.hard.is_match(sig) {
                            sf |= F_HARD;
                            sw -= 25;
                        }
                        if pats.comments.is_match(sig) {
                            sw -= 25;
                            sf |= F_COMMENT;
                        }
                        if pats.soft.is_match(sig) {
                            sf |= F_SOFT;
                            sw -= 25;
                        }
                        // A positive word cancels a layout-chrome match only
                        // when it is the head (last segment) of a class or id
                        // token: `sidebar-and-content` is content, while
                        // `entry-meta` or `post__footer` is chrome.
                        let head_override = sig.split_ascii_whitespace().any(|tok| {
                            let head = tok
                                .rsplit(['-', '_', ':'])
                                .find(|seg| {
                                    !seg.is_empty() && !seg.bytes().all(|b| b.is_ascii_digit())
                                })
                                .unwrap_or(tok);
                            pats.overrides.is_match(head)
                        });
                        if head_override {
                            sf |= F_OVERRIDE;
                        }
                        if pats.positive.is_match(sig) {
                            sw += 25;
                        }
                        if pats.negative.is_match(sig) {
                            sw -= 25;
                        }
                        cache.insert(sig.clone(), (sf, sw));
                        (sf, sw)
                    },
                };
                f |= sig_flags;
                weight += sig_weight;
            }
            match tag {
                Tag::Nav | Tag::Footer | Tag::Dialog => {
                    f |= F_SOFT;
                    weight -= 25;
                },
                Tag::Aside => {
                    weight -= 25;
                    if f & F_IN_ARTICLE == 0 {
                        f |= F_SOFT;
                    }
                },
                Tag::Header => {
                    if f & F_IN_ARTICLE == 0 {
                        f |= F_SOFT;
                    }
                },
                Tag::Form => weight -= 3,
                Tag::Article | Tag::Main => {
                    weight += 10;
                },
                _ => {},
            }
            if tag == Tag::Article || tag == Tag::Main || article_body || role_main {
                f |= F_PROTECTED | F_IN_ARTICLE;
                if article_body {
                    weight += 25;
                }
            }
            if hidden {
                f |= F_HIDDEN;
            }
            self.flags[i] = f;
            self.weight[i] = weight.clamp(-100, 100) as i16;
            self.sigs[i] = sig_owned.map(String::into_boxed_str);
        }
    }

    /// Bottom-up: subtree statistics (reverse pre-order visits children first).
    fn statistics(&mut self) {
        let n = self.arena.nodes.len();
        for i in (0..n).rev() {
            let node = &self.arena.nodes[i];
            let f = self.flags[i];
            if f & F_NON_CONTENT != 0 {
                self.stats[i] = Stats::default();
                let p = node.parent;
                if p != NONE
                    && node.kind == Kind::Element
                    && (f & F_NON_CONTENT) != self.flags[p as usize] & F_NON_CONTENT
                {
                    match node.tag {
                        Tag::Iframe | Tag::Object | Tag::Embed => self.stats[p as usize].embed += 1,
                        Tag::Input | Tag::Select | Tag::Textarea => {
                            self.stats[p as usize].input += 1
                        },
                        _ => {},
                    }
                }
                continue;
            }
            let mut s = self.stats[i];
            match node.kind {
                Kind::Text => {
                    let (chars, commas) = text_metrics(self.arena.text_of(i as u32));
                    s.chars = s.chars.saturating_add(chars);
                    s.commas = s.commas.saturating_add(commas);
                    if f & F_IN_LINK != 0 {
                        s.link_chars = s.link_chars.saturating_add(chars);
                    }
                },
                Kind::Element => {
                    s.tags = s.tags.saturating_add(1);
                    match node.tag {
                        Tag::P => s.p += 1,
                        Tag::Img => s.img += 1,
                        Tag::Li => s.li += 1,
                        Tag::Video | Tag::Audio => s.embed += 1,
                        Tag::H(l) => {
                            s.headings += 1;
                            if l == 1 {
                                s.h1 += 1;
                            }
                        },
                        _ => {},
                    }
                },
                Kind::Other => {},
            }
            self.stats[i] = s;
            let p = node.parent;
            if p != NONE {
                let (lo, hi) = self.stats.split_at_mut(i);
                lo[p as usize].add(&hi[0]);
                if node.kind == Kind::Element && node.tag.is_block() {
                    self.flags[p as usize] |= F_BLOCK_CHILD;
                }
                if (f & F_PROTECTED != 0 && s.plain() >= 200) || f & F_PROT_DESC != 0 {
                    self.flags[p as usize] |= F_PROT_DESC;
                }
            }
        }
    }

    fn remove(&mut self, i: u32) {
        if self.excluded[i as usize] {
            return;
        }
        self.excluded[i as usize] = true;
        let s = self.stats[i as usize];
        let mut p = self.arena.node(i).parent;
        while p != NONE {
            self.stats[p as usize].sub(&s);
            p = self.arena.node(p).parent;
        }
    }

    /// Top-down boilerplate removal, outermost match first. Returns the
    /// readable text mass removed as comment sections.
    fn drop_boilerplate(&mut self, aggressive: bool, drop_comments: bool) -> u32 {
        let root = if self.arena.body != NONE { self.arena.body } else { 0 };
        let total_plain = self.stats[root as usize].plain();
        let n = self.arena.nodes.len() as u32;
        let mut comment_mass = 0u32;
        let mut i = 0u32;
        while i < n {
            let node = self.arena.node(i);
            if node.kind != Kind::Element {
                i += 1;
                continue;
            }
            let f = self.flags[i as usize];
            if f & F_NON_CONTENT != 0 {
                self.excluded[i as usize] = true;
                i = self.arena.subtree_end(i);
                continue;
            }
            if f & F_PROTECTED != 0 || matches!(node.tag, Tag::Html | Tag::Body) {
                i += 1;
                continue;
            }
            let s = self.stats[i as usize];
            let soft = f & F_SOFT != 0 && f & F_OVERRIDE == 0 && s.h1 == 0;
            let comment = drop_comments && f & F_COMMENT != 0;
            let candidate =
                f & F_HIDDEN != 0 || (aggressive && (f & F_HARD != 0 || comment || soft));
            if candidate {
                // Dominance test: an element that holds (almost) all readable
                // text of the page is a wrapper, never boilerplate.
                let outside = total_plain.saturating_sub(s.plain());
                let dominant = s.plain() >= 200 && outside < 400 && s.plain() > outside * 2;
                let holds_protected = f & F_PROT_DESC != 0;
                if !dominant && !holds_protected {
                    if comment && f & (F_HARD | F_HIDDEN) == 0 && !soft {
                        comment_mass = comment_mass.saturating_add(s.plain());
                    }
                    self.remove(i);
                    i = self.arena.subtree_end(i);
                    continue;
                }
            }
            i += 1;
        }
        comment_mass
    }
}

fn tag_prior(tag: Tag) -> f32 {
    match tag {
        Tag::Div => 5.0,
        Tag::Article => 10.0,
        Tag::Main => 5.0,
        Tag::Section => 3.0,
        Tag::Pre | Tag::Td | Tag::Blockquote => 3.0,
        Tag::Address | Tag::Ol | Tag::Ul | Tag::Dl | Tag::Dd | Tag::Dt | Tag::Li | Tag::Form => {
            -3.0
        },
        Tag::H(_) | Tag::Th => -5.0,
        Tag::Nav | Tag::Aside | Tag::Footer => -20.0,
        _ => 0.0,
    }
}

struct Selection {
    roots: Vec<u32>,
    top: u32,
}

fn select_content(a: &Analysis<'_>) -> Selection {
    let arena = a.arena;
    let n = arena.nodes.len();
    let root = if arena.body != NONE { arena.body } else { 0 };

    // `dead` = excluded or inside an excluded subtree (top-down).
    let mut dead = vec![false; n];
    for i in 0..n {
        let p = arena.nodes[i].parent;
        dead[i] = a.excluded[i] || (p != NONE && dead[p as usize]);
    }

    let mut score = vec![0f32; n];
    let mut scored = vec![false; n];

    for i in 0..n {
        if dead[i] || arena.nodes[i].kind != Kind::Element {
            continue;
        }
        let tag = arena.nodes[i].tag;
        let f = a.flags[i];
        let paragraph_like = match tag {
            Tag::P | Tag::Pre | Tag::Td | Tag::Dd => true,
            Tag::Div
            | Tag::Section
            | Tag::Article
            | Tag::Li
            | Tag::Blockquote
            | Tag::Other
            | Tag::Span
            | Tag::Font
            | Tag::Center
            | Tag::Figcaption => f & F_BLOCK_CHILD == 0,
            _ => false,
        };
        if !paragraph_like {
            continue;
        }
        // A span/other inside a paragraph-like parent is scored via the parent.
        if matches!(tag, Tag::Span | Tag::Other | Tag::Font) {
            let p = arena.nodes[i].parent;
            if p != NONE && a.flags[p as usize] & F_BLOCK_CHILD == 0 {
                continue;
            }
        }
        let s = a.stats[i];
        if s.chars < 25 {
            continue;
        }
        let ld = s.link_density();
        if ld > 0.5 {
            continue;
        }
        let mut content = 1.0 + s.commas.min(30) as f32 + (s.chars as f32 / 100.0).floor().min(3.0);
        content *= 1.0 - ld;
        // Propagate to ancestors (Readability dividers: 1, 2, then level * 3).
        let mut anc = arena.nodes[i].parent;
        let mut level = 0u32;
        while anc != NONE && level < 5 {
            let ai = anc as usize;
            if arena.nodes[ai].kind != Kind::Element {
                break;
            }
            if !scored[ai] {
                scored[ai] = true;
                score[ai] = tag_prior(arena.nodes[ai].tag) + f32::from(a.weight[ai]);
            }
            let divider = match level {
                0 => 1.0,
                1 => 2.0,
                l => l as f32 * 3.0,
            };
            score[ai] += content / divider;
            anc = arena.nodes[ai].parent;
            level += 1;
        }
    }

    // Final scores: scale by (1 - link density) and a mild text-density factor.
    let mut finals: Vec<(u32, f32)> = Vec::new();
    for i in 0..n {
        if !scored[i] || dead[i] {
            continue;
        }
        let s = a.stats[i];
        let density = s.chars as f32 / (s.tags.max(1)) as f32;
        let density_factor = 0.85 + 0.15 * (density / 60.0).min(1.0);
        let f = score[i] * (1.0 - s.link_density()) * density_factor;
        score[i] = f;
        finals.push((i as u32, f));
    }
    finals.sort_by(|x, y| y.1.partial_cmp(&x.1).unwrap_or(std::cmp::Ordering::Equal));

    let Some(&(mut top, top_score)) = finals.first() else {
        return fallback_selection(a, &dead, root);
    };

    // Shared ancestor of strong alternative candidates.
    let alternatives: Vec<u32> = finals
        .iter()
        .skip(1)
        .take(4)
        .filter(|(_, s)| *s >= top_score * 0.75)
        .map(|(i, _)| *i)
        .collect();
    if alternatives.len() >= 2 {
        let mut anc = arena.node(top).parent;
        while anc != NONE && anc != root && arena.node(anc).kind == Kind::Element {
            let end = arena.subtree_end(anc);
            let contained = alternatives.iter().filter(|&&x| x > anc && x < end).count();
            if contained >= 2 {
                top = anc;
                break;
            }
            anc = arena.node(anc).parent;
        }
    }
    if !scored[top as usize] {
        scored[top as usize] = true;
        score[top as usize] = tag_prior(arena.node(top).tag);
    }

    // Climb while the parent is a better candidate.
    let mut last = score[top as usize];
    let threshold = last / 3.0;
    let mut parent = arena.node(top).parent;
    while parent != NONE && parent != root && arena.node(parent).kind == Kind::Element {
        let pi = parent as usize;
        if !scored[pi] {
            parent = arena.node(parent).parent;
            continue;
        }
        if score[pi] < threshold {
            break;
        }
        if score[pi] > last {
            top = parent;
            break;
        }
        last = score[pi];
        parent = arena.node(parent).parent;
    }

    // Article promotion: a candidate inside an `<article>` / articleBody
    // container that holds a substantial share of that container's readable
    // text stands for the whole article (multi-part articles split by ads or
    // layout grids are not truncated).
    let top_plain = a.stats[top as usize].plain();
    let mut anc = arena.node(top).parent;
    while anc != NONE && anc != root {
        let ai = anc as usize;
        if a.flags[ai] & F_PROTECTED != 0 && arena.node(anc).tag != Tag::Main {
            let s = a.stats[ai];
            if s.plain() <= top_plain.saturating_mul(4) && s.link_density() < 0.3 {
                top = anc;
            }
            break;
        }
        anc = arena.node(anc).parent;
    }

    // Mass promotion (DOM distance): the deepest element holding at least
    // 60% of the page's remaining readable text is where the content lives.
    // When the scored candidate covers only a small part of it (forums,
    // recipe cards, deeply nested templates beyond score propagation), the
    // candidate is replaced by that element.
    let total_plain = a.stats[root as usize].plain();
    if total_plain >= 500 {
        let mut center = root;
        loop {
            let best = arena
                .children(center)
                .filter(|&c| !dead[c as usize] && arena.node(c).kind == Kind::Element)
                .max_by_key(|&c| a.stats[c as usize].plain());
            match best {
                Some(c)
                    if f64::from(a.stats[c as usize].plain()) >= 0.6 * f64::from(total_plain) =>
                {
                    center = c
                },
                _ => break,
            }
        }
        if center != root {
            let cs = a.stats[center as usize];
            let top_now = a.stats[top as usize].plain();
            let inside = top >= center && top < arena.subtree_end(center);
            let weak = if inside {
                f64::from(top_now) < 0.5 * f64::from(cs.plain())
            } else {
                !(center > top && center < arena.subtree_end(top))
                    && f64::from(top_now) < 0.25 * f64::from(cs.plain())
            };
            if weak && cs.link_density() < 0.3 {
                top = center;
            }
        }
    }

    // Climb through single-child wrappers.
    loop {
        let p = arena.node(top).parent;
        if p == NONE || p == root || arena.node(p).kind != Kind::Element {
            break;
        }
        let element_children = arena
            .children(p)
            .filter(|&c| {
                !dead[c as usize]
                    && (arena.node(c).kind == Kind::Element || a.stats[c as usize].chars > 0)
            })
            .count();
        if element_children != 1 {
            break;
        }
        top = p;
    }

    // Sibling merging.
    let top_final = score[top as usize];
    let parent = arena.node(top).parent;
    if parent == NONE || top == root {
        return Selection { roots: vec![top], top };
    }
    let sib_threshold = (top_final * 0.2).max(10.0);
    let top_sig = a.sigs[top as usize].clone();
    let siblings: Vec<u32> = arena
        .children(parent)
        .filter(|&c| !dead[c as usize] && arena.node(c).kind == Kind::Element)
        .collect();
    let mut include: Vec<bool> = vec![false; siblings.len()];
    for (k, &s) in siblings.iter().enumerate() {
        if s == top {
            include[k] = true;
            continue;
        }
        let node = arena.node(s);
        let st = a.stats[s as usize];
        if node.kind == Kind::Text {
            continue;
        }
        if node.kind != Kind::Element {
            continue;
        }
        let mut bonus = 0.0;
        if let (Some(ts), Some(ss)) = (&top_sig, &a.sigs[s as usize]) {
            if ts == ss {
                bonus = top_final * 0.2;
            }
        }
        if scored[s as usize] && score[s as usize] + bonus >= sib_threshold {
            include[k] = true;
            continue;
        }
        let ld = st.link_density();
        let para_like = node.tag == Tag::P
            || (a.flags[s as usize] & F_BLOCK_CHILD == 0
                && matches!(node.tag, Tag::Div | Tag::Section));
        if para_like {
            if st.chars > 80 && ld < 0.25 {
                include[k] = true;
            } else if st.chars > 0 && st.chars <= 80 && ld == 0.0 {
                let t = arena.raw_text(s);
                let t = t.trim();
                if t.ends_with('.') || t.contains(". ") {
                    include[k] = true;
                }
            }
        }
    }
    // Gap filling: content-ish elements between included siblings (DOM
    // distance <= 3), and a heading right before the first included sibling.
    let first_inc = include.iter().position(|&b| b);
    let last_inc = include.iter().rposition(|&b| b);
    if let (Some(fi), Some(li)) = (first_inc, last_inc) {
        let mut k = fi;
        while k < li {
            if include[k] {
                k += 1;
                continue;
            }
            let gap_end = (k..li).find(|&j| include[j]).unwrap_or(li);
            if gap_end - k <= 3 {
                for j in k..gap_end {
                    if content_ish(a, siblings[j]) {
                        include[j] = true;
                    }
                }
            }
            k = gap_end;
        }
        let mut k = fi;
        let mut steps = 0;
        while k > 0 && steps < 2 {
            k -= 1;
            steps += 1;
            let s = siblings[k];
            let node = arena.node(s);
            if node.kind != Kind::Element {
                continue;
            }
            if matches!(node.tag, Tag::H(_))
                || (a.stats[s as usize].h1 > 0 && a.stats[s as usize].chars < 400)
            {
                include[k] = true;
            } else if a.stats[s as usize].chars > 0 {
                break;
            }
        }
        // Trailing structured content right after the last included sibling
        // (specification tables, code listings, tab panels), DOM distance <= 2.
        let mut steps = 0;
        let mut k = li + 1;
        while k < siblings.len() && steps < 2 {
            let s = siblings[k];
            let st = a.stats[s as usize];
            let tag = arena.node(s).tag;
            let structured =
                matches!(tag, Tag::Table | Tag::Pre | Tag::Dl) && st.link_density() < 0.3;
            if structured && content_ish(a, s) {
                include[k] = true;
            } else if st.chars > 0 {
                break;
            }
            k += 1;
            steps += 1;
        }
    }
    let mut roots: Vec<u32> = siblings
        .iter()
        .zip(include.iter())
        .filter(|&(_, &inc)| inc)
        .map(|(&s, _)| s)
        .filter(|&s| arena.node(s).kind == Kind::Element)
        .collect();
    if roots.is_empty() {
        roots.push(top);
    }
    Selection { roots, top }
}

/// Finds the page headline (`h1`) when the selected content does not contain
/// one: the first live `h1` located before the content whose text matches the
/// document title. Returned as an extra leading root.
fn leading_headline(a: &Analysis<'_>, roots: &[u32], title_hint: Option<&str>) -> Option<u32> {
    let arena = a.arena;
    let first = *roots.first()?;
    for &r in roots {
        let end = arena.subtree_end(r);
        if (r..end).any(|i| {
            arena.node(i).kind == Kind::Element
                && arena.node(i).tag == Tag::H(1)
                && !a.excluded[i as usize]
        }) {
            return None;
        }
    }
    let hint = title_hint?;
    let mut i = 0u32;
    while i < first {
        let n = arena.node(i);
        if a.excluded[i as usize] {
            i = arena.subtree_end(i);
            continue;
        }
        if n.kind == Kind::Element && n.tag == Tag::H(1) {
            let text = collapse_ws(&arena.raw_text(i));
            if !text.is_empty()
                && token_overlap(&text, hint) >= 0.6
                && token_overlap(hint, &text) >= 0.6
            {
                // Must not be an ancestor of the content.
                if arena.subtree_end(i) <= first {
                    return Some(i);
                }
            }
        }
        i += 1;
    }
    None
}

fn content_ish(a: &Analysis<'_>, s: u32) -> bool {
    let node = a.arena.node(s);
    if node.kind != Kind::Element {
        return false;
    }
    let st = a.stats[s as usize];
    if st.chars == 0 && st.img == 0 {
        return false;
    }
    match node.tag {
        Tag::H(_) | Tag::Pre | Tag::Blockquote | Tag::Figure | Tag::Table | Tag::Dl => true,
        Tag::Ul | Tag::Ol => st.link_density() < 0.5,
        Tag::P | Tag::Div | Tag::Section => st.link_density() < 0.33 && a.weight[s as usize] >= 0,
        _ => false,
    }
}

fn fallback_selection(a: &Analysis<'_>, dead: &[bool], root: u32) -> Selection {
    // No scoreable paragraph: prefer the protected element with most text.
    let mut best: Option<(u32, u32)> = None;
    for (i, &d) in dead.iter().enumerate() {
        if d || a.flags[i] & F_PROTECTED == 0 {
            continue;
        }
        let c = a.stats[i].plain();
        if best.is_none_or(|(_, bc)| c > bc) {
            best = Some((i as u32, c));
        }
    }
    let top = best.filter(|(_, c)| *c > 0).map(|(i, _)| i).unwrap_or(root);
    Selection { roots: vec![top], top }
}

/// Readability-style conditional cleaning inside the selected content.
fn clean_conditionally(a: &mut Analysis<'_>, sel: &Selection) {
    let arena = a.arena;
    for &r in &sel.roots {
        let end = arena.subtree_end(r);
        let mut i = end;
        while i > r {
            i -= 1;
            let node = arena.node(i);
            if node.kind != Kind::Element || a.excluded[i as usize] {
                continue;
            }
            let tag = node.tag;
            if !matches!(
                tag,
                Tag::Div
                    | Tag::Section
                    | Tag::Ul
                    | Tag::Ol
                    | Tag::Table
                    | Tag::Form
                    | Tag::Fieldset
                    | Tag::Aside
                    | Tag::Header
                    | Tag::Footer
                    | Tag::Nav
                    | Tag::Figure
            ) {
                continue;
            }
            if a.flags[i as usize] & F_PROTECTED != 0 || i == sel.top || sel.roots.contains(&i) {
                continue;
            }
            let s = a.stats[i as usize];
            let weight = i32::from(a.weight[i as usize]);
            let ld = s.link_density();
            let is_list = matches!(tag, Tag::Ul | Tag::Ol)
                || (s.li > 0
                    && s.p == 0
                    && s.headings == 0
                    && s.li as f32 >= 0.9 * (s.tags as f32 / 2.0).max(1.0));
            let mut remove = false;
            if weight < 0 && s.chars < 1000 && s.commas < 10 {
                remove = weight + (s.chars as i32 / 100) < 0;
            }
            if !remove && s.commas < 10 {
                let p = s.p as f32;
                let img = s.img as f32;
                let li = s.li as f32 - 100.0;
                let has_structure = s.p > 0 || s.headings > 0 || s.li > 0;
                if img > 1.0 && p / img < 0.5 && tag != Tag::Figure {
                    remove = s.chars < 200;
                } else if !is_list && tag != Tag::Table && li > p {
                    remove = true;
                } else if s.input as f32 > (p / 3.0).floor() && s.input > 0 {
                    remove = s.chars < 500;
                } else if !is_list
                    && !has_structure
                    && s.chars < 25
                    && (s.img == 0 || s.img > 2)
                    && tag != Tag::Figure
                    && tag != Tag::Table
                {
                    remove = s.chars == 0 && s.img == 0;
                } else if !is_list
                    && weight < 25
                    && ld > 0.33
                    && s.chars < 2000
                    && s.p < 3
                    && s.plain() < 150
                {
                    remove = true;
                } else if weight >= 25 && ld > 0.5 {
                    remove = true;
                } else if (s.embed == 1 && s.chars < 75) || s.embed > 1 {
                    remove = s.chars < 400;
                } else if is_list && ld > 0.6 && s.chars < 3000 {
                    remove = true;
                }
            }
            if remove {
                a.remove(i);
            }
        }
    }
}

fn clean_title(raw: &str, site_name: Option<&str>) -> String {
    let t = collapse_ws(raw);
    if t.is_empty() {
        return t;
    }
    const SEPS: [&str; 9] = [" | ", " - ", " – ", " — ", " :: ", " · ", " • ", " » ", " ~ "];
    let site = site_name.map(|s| s.to_lowercase());
    let matches_site = |part: &str| {
        let p = part.trim().to_lowercase();
        site.as_deref().is_some_and(|s| {
            !s.is_empty() && (p == s || p.contains(s) || (s.contains(&p) && p.len() >= 3))
        })
    };
    let words = |s: &str| s.split_whitespace().count();
    // Suffix: last separator.
    let mut best_suffix: Option<usize> = None;
    for sep in SEPS {
        if let Some(pos) = t.rfind(sep) {
            if best_suffix.is_none_or(|b| pos > b) {
                best_suffix = Some(pos);
            }
        }
    }
    if let Some(pos) = best_suffix {
        let left = &t[..pos];
        let right_start = t[pos..].char_indices().nth(3).map(|(k, _)| pos + k).unwrap_or(t.len());
        let right = t[right_start..]
            .trim_start_matches(|c: char| c.is_whitespace() || c == '|' || c == '-');
        if matches_site(right) || (words(right) <= 4 && words(left) >= 3) {
            return left.trim().to_string();
        }
    }
    // Prefix: first separator.
    let mut best_prefix: Option<(usize, usize)> = None;
    for sep in SEPS {
        if let Some(pos) = t.find(sep) {
            if best_prefix.is_none_or(|(b, _)| pos < b) {
                best_prefix = Some((pos, sep.len()));
            }
        }
    }
    if let Some((pos, len)) = best_prefix {
        let left = &t[..pos];
        let right = &t[pos + len..];
        if matches_site(left) && words(right) >= 2 {
            return right.trim().to_string();
        }
    }
    t
}

fn token_overlap(a: &str, b: &str) -> f32 {
    let ta: Vec<String> = crate::simhash::tokens(a).collect();
    let tb: Vec<String> = crate::simhash::tokens(b).collect();
    if ta.is_empty() || tb.is_empty() {
        return 0.0;
    }
    let hits = ta.iter().filter(|t| tb.contains(t)).count();
    hits as f32 / ta.len() as f32
}

fn first_h1(a: &Analysis<'_>, roots: &[u32]) -> Option<String> {
    let arena = a.arena;
    for &r in roots {
        let end = arena.subtree_end(r);
        for i in r..end {
            if arena.node(i).tag == Tag::H(1) && arena.node(i).kind == Kind::Element {
                let t = collapse_ws(&arena.raw_text(i));
                if !t.is_empty() {
                    return Some(t);
                }
            }
        }
    }
    let mut found: Option<String> = None;
    for (i, n) in arena.nodes.iter().enumerate() {
        if n.kind == Kind::Element && n.tag == Tag::H(1) && a.flags[i] & F_NON_CONTENT == 0 {
            let t = collapse_ws(&arena.raw_text(i as u32));
            if t.is_empty() {
                continue;
            }
            if found.is_some() {
                return found; // Several h1: keep the first one.
            }
            found = Some(t);
        }
    }
    found
}

fn clean_byline(raw: &str) -> Option<String> {
    let mut t = collapse_ws(raw);
    for prefix in
        ["By ", "by ", "BY ", "Par ", "par ", "PAR ", "Written by ", "Posted by ", "Publié par "]
    {
        if let Some(rest) = t.strip_prefix(prefix) {
            t = rest.trim().to_string();
        }
    }
    let t =
        t.trim_matches(|c: char| c == '|' || c == '-' || c == ',' || c.is_whitespace()).to_string();
    if t.is_empty()
        || t.chars().count() > 120
        || t.starts_with("http://")
        || t.starts_with("https://")
    {
        return None;
    }
    Some(t)
}

fn find_byline(a: &Analysis<'_>, meta: &PageMeta) -> Option<String> {
    if let Some(v) = meta.first_of(&[
        "author",
        "article:author",
        "dc.creator",
        "dcterms.creator",
        "parsely-author",
        "sailthru.author",
        "byl",
    ]) {
        if let Some(b) = clean_byline(&v) {
            return Some(b);
        }
    }
    if let Some(v) = &meta.jsonld.author {
        if let Some(b) = clean_byline(v) {
            return Some(b);
        }
    }
    let arena = a.arena;
    for &l in &meta.author_links {
        if let Some(b) = clean_byline(&arena.raw_text(l)) {
            return Some(b);
        }
    }
    let pats = patterns();
    for (i, n) in arena.nodes.iter().enumerate() {
        if n.kind != Kind::Element || a.flags[i] & F_NON_CONTENT != 0 {
            continue;
        }
        let is_author_prop = arena
            .attr(i as u32, "itemprop", |v| v.to_ascii_lowercase().contains("author"))
            .unwrap_or(false);
        let sig_match = a.sigs[i].as_deref().is_some_and(|s| pats.byline.is_match(s));
        if !(is_author_prop || sig_match) {
            continue;
        }
        let chars = a.stats[i].chars;
        if chars == 0 || chars > 100 {
            continue;
        }
        if n.tag == Tag::Meta {
            continue;
        }
        if let Some(b) = clean_byline(&arena.raw_text(i as u32)) {
            return Some(b);
        }
    }
    None
}

fn find_published(a: &Analysis<'_>, meta: &PageMeta, roots: &[u32]) -> Option<String> {
    let raw = meta
        .first_of(&[
            "article:published_time",
            "og:published_time",
            "published_time",
            "datepublished",
            "article.published",
            "pubdate",
            "publishdate",
            "publish-date",
            "publish_date",
            "publication_date",
            "dc.date.issued",
            "dcterms.issued",
            "dcterms.created",
            "dc.date",
            "dcterms.date",
            "date",
            "sailthru.date",
            "parsely-pub-date",
            "citation_publication_date",
        ])
        .or_else(|| meta.jsonld.date_published.clone())
        .or_else(|| dom_date(a, roots));
    raw.map(|r| normalize_date(&r).unwrap_or(r))
}

fn dom_date(a: &Analysis<'_>, roots: &[u32]) -> Option<String> {
    let arena = a.arena;
    for (i, n) in arena.nodes.iter().enumerate() {
        if n.kind != Kind::Element || n.tag == Tag::Meta {
            continue;
        }
        let is_pub = arena
            .attr(i as u32, "itemprop", |v| v.to_ascii_lowercase().contains("datepublished"))
            .unwrap_or(false);
        if is_pub {
            let v = arena
                .attr_string(i as u32, "datetime")
                .or_else(|| arena.attr_string(i as u32, "content"))
                .unwrap_or_else(|| collapse_ws(&arena.raw_text(i as u32)));
            if !v.trim().is_empty() {
                return Some(v.trim().to_string());
            }
        }
    }
    // First <time datetime> inside the content (or anywhere, if none there).
    let mut ranges: Vec<(u32, u32)> = roots.iter().map(|&r| (r, arena.subtree_end(r))).collect();
    ranges.push((0, arena.nodes.len() as u32));
    for (start, end) in ranges {
        for i in start..end {
            let n = arena.node(i);
            if n.kind == Kind::Element && n.tag == Tag::Time {
                if let Some(v) = arena.attr_string(i, "datetime") {
                    if !v.trim().is_empty() {
                        return Some(v.trim().to_string());
                    }
                }
            }
        }
    }
    None
}

pub(crate) fn extract(html: &str, page_url: Option<&str>, opts: &ExtractOptions) -> Extracted {
    #[cfg(feature = "profiling")]
    let mut t0 = std::time::Instant::now();
    #[cfg(feature = "profiling")]
    let mut lap = |name: &str| {
        eprintln!("  {name}: {:.3} ms", t0.elapsed().as_secs_f64() * 1000.0);
        t0 = std::time::Instant::now();
    };
    #[cfg(not(feature = "profiling"))]
    let lap = |_: &str| {};
    let arena = Arena::from_html(html);
    lap("parse+arena");
    let meta = meta::collect(&arena);
    lap("meta");
    let page = page_url.and_then(|p| Url::parse(p.trim()).ok());
    let base = match (&page, meta.base_href.as_deref()) {
        (Some(p), Some(b)) => p.join(b.trim()).ok().or_else(|| page.clone()),
        (None, Some(b)) => Url::parse(b.trim()).ok(),
        (p, None) => p.clone(),
    };

    let render_opts = RenderOptions {
        images: opts.include_images,
        fragment_links: false,
        links: opts.include_links,
    };

    let base_analysis = Analysis::new(&arena);
    let root = if arena.body != NONE { arena.body } else { 0 };
    let page_plain = base_analysis.stats[root as usize].plain() as usize;
    lap("analysis");

    let site_name = meta
        .first_of(&["og:site_name", "application-name", "twitter:site", "publisher"])
        .map(|s| s.trim_start_matches('@').to_string())
        .or_else(|| meta.jsonld.publisher.clone())
        .filter(|s| !s.is_empty());
    let og_title = meta
        .first_of(&["og:title", "twitter:title"])
        .or_else(|| meta.jsonld.headline.clone())
        .map(|t| clean_title(&t, site_name.as_deref()))
        .filter(|t| !t.is_empty());
    let tag_title = meta
        .title_tag
        .as_deref()
        .map(|t| clean_title(t, site_name.as_deref()))
        .filter(|t| !t.is_empty());
    let title_hint = og_title.clone().or_else(|| tag_title.clone());

    let attempt = |aggressive: bool, drop_comments: bool| {
        let mut a = base_analysis.clone();
        if !drop_comments {
            // Comments are content in this attempt: lift their penalty.
            for (w, f) in a.weight.iter_mut().zip(a.flags.iter()) {
                if f & F_COMMENT != 0 {
                    *w = w.saturating_add(25);
                }
            }
        }
        let comment_mass = a.drop_boilerplate(aggressive, drop_comments);
        let sel = select_content(&a);
        clean_conditionally(&mut a, &sel);
        let mut roots = sel.roots;
        if let Some(h1) = leading_headline(&a, &roots, title_hint.as_deref()) {
            roots.insert(0, h1);
        }
        let rendered = render(&arena, &roots, &a.excluded, base.as_ref(), render_opts);
        (rendered, roots, comment_mass as usize)
    };

    // First attempt: full boilerplate removal.
    let drop_comments = !opts.include_comments;
    let (mut rendered, mut roots, comment_mass) = attempt(true, drop_comments);
    lap("attempt");
    // Discussion pages (forum threads, link aggregators): when the removed
    // comment sections dwarf what is left, the discussion is the content.
    let len = rendered.text.chars().count();
    if drop_comments && len < 2000 && len * 4 < comment_mass {
        let (r2, roots2, _) = attempt(true, false);
        if r2.text.chars().count() > len * 2 {
            rendered = r2;
            roots = roots2;
        }
    }
    // Readability-style retry with only hidden / non-content nodes removed
    // when the result kept too little of the page's readable text.
    let len = rendered.text.chars().count();
    if len < 250 && len * 3 < page_plain {
        let (r2, roots2, _) = attempt(false, drop_comments);
        if r2.text.chars().count() > len * 2 {
            rendered = r2;
            roots = roots2;
        }
    }

    let a = &base_analysis;
    let title = {
        let h1 = first_h1(a, &roots);
        match (og_title, h1, tag_title) {
            (Some(o), ..) => o,
            (None, Some(h), Some(t)) => {
                if token_overlap(&h, &t) >= 0.5 || token_overlap(&t, &h) >= 0.5 { h } else { t }
            },
            (None, Some(h), None) => h,
            (None, None, Some(t)) => t,
            (None, None, None) => rendered
                .blocks
                .iter()
                .find(|b| b.kind == crate::types::BlockKind::Heading)
                .map(|b| b.text.clone())
                .unwrap_or_default(),
        }
    };
    lap("title");
    let byline = find_byline(a, &meta);
    let published = find_published(a, &meta, &roots);
    let description = meta
        .first_of(&["og:description", "description", "twitter:description", "dc.description"])
        .or_else(|| meta.jsonld.description.clone());
    let canonical = crate::canonical::from_meta(&meta, page_url);
    let word_count = rendered.text.split_whitespace().count();
    lap("byline+date+meta");
    let simhash = format!("{:016x}", simhash64(&rendered.text));
    lap("simhash");

    Extracted {
        title,
        byline,
        published,
        lang: meta.lang.clone(),
        canonical,
        site_name,
        description,
        text: rendered.text,
        markdown: rendered.markdown,
        blocks: rendered.blocks,
        simhash,
        word_count,
    }
}

/// Development aid: explains why the text containing `needle` was or was not
/// selected (ancestor chain with flags, weights, statistics and scores).
#[cfg(feature = "profiling")]
pub fn debug_trace(html: &str, needle: &str, drop_comments: bool) -> String {
    use std::fmt::Write;
    let arena = Arena::from_html(html);
    let mut a = Analysis::new(&arena);
    if !drop_comments {
        for (w, f) in a.weight.iter_mut().zip(a.flags.iter()) {
            if f & F_COMMENT != 0 {
                *w = w.saturating_add(25);
            }
        }
    }
    a.drop_boilerplate(true, drop_comments);
    let sel = select_content(&a);
    let excluded_after_drop = a.excluded.clone();
    clean_conditionally(&mut a, &sel);
    let mut out = String::new();
    let _ = writeln!(out, "top={} roots={:?}", sel.top, sel.roots);
    let target = (0..arena.nodes.len() as u32).find(|&i| {
        arena.node(i).kind == Kind::Text
            && a.flags[i as usize] & F_NON_CONTENT == 0
            && arena.text_of(i).contains(needle)
    });
    let Some(t) = target else {
        let _ = writeln!(out, "needle not found");
        return out;
    };
    let mut chain = vec![t];
    let mut p = arena.node(t).parent;
    while p != NONE {
        chain.push(p);
        p = arena.node(p).parent;
    }
    for &i in chain.iter().rev() {
        let n = arena.node(i);
        let s = a.stats[i as usize];
        let _ = writeln!(
            out,
            "{i:>6} {:?} sig={:?} flags={:#06x} w={} chars={} ld={:.2} p={} dropped={} cleaned={} \
             root={}",
            n.tag,
            a.sigs[i as usize].as_deref().map(|s| s.chars().take(60).collect::<String>()),
            a.flags[i as usize],
            a.weight[i as usize],
            s.chars,
            s.link_density(),
            s.p,
            excluded_after_drop[i as usize],
            a.excluded[i as usize] && !excluded_after_drop[i as usize],
            sel.roots.contains(&i)
        );
    }
    out
}
