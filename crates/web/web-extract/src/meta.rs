//! Document metadata: `<title>`, `<meta>` (Open Graph, Twitter, Dublin Core,
//! schema.org microdata), `<link rel>`, `lang`, and JSON-LD (including `@graph`).

use serde_json::Value;

use crate::dom::{Arena, Kind, Tag, collapse_ws};

#[derive(Default, Debug)]
pub(crate) struct JsonLd {
    pub headline: Option<String>,
    pub date_published: Option<String>,
    pub author: Option<String>,
    pub publisher: Option<String>,
    pub description: Option<String>,
}

#[derive(Default, Debug)]
pub(crate) struct PageMeta {
    pub title_tag: Option<String>,
    /// Lowercased key (`property`, `name`, `itemprop` or `http-equiv`) → content.
    pub metas: Vec<(String, String)>,
    pub canonical_links: Vec<String>,
    pub author_links: Vec<u32>,
    pub lang: Option<String>,
    pub base_href: Option<String>,
    pub jsonld: JsonLd,
}

impl PageMeta {
    pub(crate) fn get(&self, key: &str) -> Option<&str> {
        self.metas.iter().find(|(k, v)| k == key && !v.trim().is_empty()).map(|(_, v)| v.trim())
    }

    pub(crate) fn first_of(&self, keys: &[&str]) -> Option<String> {
        keys.iter().find_map(|k| self.get(k)).map(collapse_ws)
    }
}

/// Returns `true` when the space-separated token list contains `token`
/// (ASCII case-insensitive).
pub(crate) fn has_token(list: &str, token: &str) -> bool {
    list.split_ascii_whitespace().any(|t| t.eq_ignore_ascii_case(token))
}

pub(crate) fn collect(arena: &Arena) -> PageMeta {
    let mut meta = PageMeta::default();
    let mut ld_values: Vec<Value> = Vec::new();

    for (i, n) in arena.nodes.iter().enumerate() {
        if n.kind != Kind::Element {
            continue;
        }
        let i = i as u32;
        match n.tag {
            Tag::Html => {
                if meta.lang.is_none() {
                    meta.lang = arena
                        .attr(i, "lang", |v| v.trim().to_string())
                        .or_else(|| arena.attr(i, "xml:lang", |v| v.trim().to_string()))
                        .filter(|v| !v.is_empty());
                }
            },
            Tag::Title => {
                if meta.title_tag.is_none() && !is_inside_svg(arena, i) {
                    let t = collapse_ws(&arena.raw_text(i));
                    if !t.is_empty() {
                        meta.title_tag = Some(t);
                    }
                }
            },
            Tag::Base => {
                if meta.base_href.is_none() {
                    meta.base_href = arena.attr_string(i, "href");
                }
            },
            Tag::Meta => {
                arena.tree.with_node(n.source, |node| {
                    let content = node
                        .get_attribute("content")
                        .or_else(|| node.get_attribute("value"))
                        .or_else(|| node.get_attribute("datetime"));
                    let Some(content) = content else { return };
                    for key_attr in ["property", "name", "itemprop", "http-equiv"] {
                        if let Some(k) = node.get_attribute(key_attr) {
                            for key in k.split_ascii_whitespace() {
                                meta.metas.push((key.to_ascii_lowercase(), content.to_string()));
                            }
                        }
                    }
                });
            },
            Tag::Link => {
                arena.tree.with_node(n.source, |node| {
                    let Some(rel) = node.get_attribute("rel") else { return };
                    let Some(href) = node.get_attribute("href") else { return };
                    if has_token(rel, "canonical") {
                        meta.canonical_links.push(href.to_string());
                    }
                });
            },
            Tag::Script => {
                let is_ld = arena
                    .attr(i, "type", |t| {
                        t.trim().to_ascii_lowercase().starts_with("application/ld+json")
                    })
                    .unwrap_or(false);
                if is_ld && ld_values.len() < 32 {
                    let raw = arena.raw_text(i);
                    if let Some(v) = parse_json_ld(&raw) {
                        ld_values.push(v);
                    }
                }
            },
            Tag::A => {
                if meta.author_links.len() < 8
                    && arena.attr(i, "rel", |r| has_token(r, "author")).unwrap_or(false)
                {
                    meta.author_links.push(i);
                }
            },
            _ => {},
        }
    }

    if meta.lang.is_none() {
        meta.lang = meta
            .first_of(&["content-language", "og:locale", "dc.language", "language"])
            .map(|l| l.replace('_', "-"));
    }

    let mut budget = 4096usize;
    for v in &ld_values {
        walk_json_ld(v, &mut meta.jsonld, 0, &mut budget);
    }
    meta
}

fn is_inside_svg(arena: &Arena, i: u32) -> bool {
    let mut p = arena.node(i).parent;
    while p != crate::dom::NONE {
        if arena.node(p).tag == Tag::Svg {
            return true;
        }
        p = arena.node(p).parent;
    }
    false
}

fn parse_json_ld(raw: &str) -> Option<Value> {
    let mut s = raw.trim();
    for prefix in ["<!--", "<![CDATA[", "//<![CDATA["] {
        if let Some(rest) = s.strip_prefix(prefix) {
            s = rest.trim();
        }
    }
    for suffix in ["-->", "]]>", "//]]>"] {
        if let Some(rest) = s.strip_suffix(suffix) {
            s = rest.trim();
        }
    }
    if s.is_empty() || s.len() > 2_000_000 {
        return None;
    }
    if let Ok(v) = serde_json::from_str::<Value>(s) {
        return Some(v);
    }
    // Some sites emit raw control characters (e.g. newlines) inside strings.
    let cleaned: String = s.chars().map(|c| if c.is_control() { ' ' } else { c }).collect();
    serde_json::from_str::<Value>(&cleaned).ok()
}

const ARTICLE_TYPES: &[&str] = &[
    "article",
    "newsarticle",
    "blogposting",
    "reportagenewsarticle",
    "analysisnewsarticle",
    "opinionnewsarticle",
    "techarticle",
    "scholarlyarticle",
    "socialmediaposting",
    "discussionforumposting",
    "liveblogposting",
    "recipe",
    "howto",
    "webpage",
    "qapage",
    "question",
    "product",
    "creativework",
    "report",
    "review",
];

fn type_matches(v: &Value) -> bool {
    let check = |s: &str| {
        let s = s.rsplit(['/', ':']).next().unwrap_or(s).to_ascii_lowercase();
        ARTICLE_TYPES.contains(&s.as_str())
    };
    match v.get("@type") {
        Some(Value::String(s)) => check(s),
        Some(Value::Array(a)) => a.iter().any(|x| x.as_str().is_some_and(check)),
        _ => false,
    }
}

fn string_of(v: &Value) -> Option<String> {
    match v {
        Value::String(s) => {
            let s = collapse_ws(s);
            (!s.is_empty()).then_some(s)
        },
        Value::Array(a) => {
            let names: Vec<String> = a.iter().filter_map(string_of).take(5).collect();
            (!names.is_empty()).then(|| names.join(", "))
        },
        Value::Object(o) => o.get("name").and_then(string_of),
        _ => None,
    }
}

fn walk_json_ld(v: &Value, out: &mut JsonLd, depth: usize, budget: &mut usize) {
    if depth > 12 || *budget == 0 {
        return;
    }
    *budget -= 1;
    match v {
        Value::Array(a) => {
            for x in a {
                walk_json_ld(x, out, depth + 1, budget);
            }
        },
        Value::Object(o) => {
            if type_matches(v) {
                if out.date_published.is_none() {
                    out.date_published = o
                        .get("datePublished")
                        .or_else(|| o.get("dateCreated"))
                        .or_else(|| o.get("uploadDate"))
                        .and_then(string_of);
                }
                if out.headline.is_none() {
                    out.headline = o.get("headline").and_then(string_of);
                }
                if out.author.is_none() {
                    out.author = o.get("author").or_else(|| o.get("creator")).and_then(string_of);
                }
                if out.publisher.is_none() {
                    out.publisher = o.get("publisher").and_then(string_of);
                }
                if out.description.is_none() {
                    out.description = o.get("description").and_then(string_of);
                }
            } else if out.publisher.is_none()
                && matches!(o.get("@type"), Some(Value::String(t)) if t == "WebSite" || t == "Organization" || t == "NewsMediaOrganization")
                && depth <= 2
            {
                out.publisher = o.get("name").and_then(string_of);
            }
            for (k, x) in o {
                if k == "@graph"
                    || k == "mainEntity"
                    || k == "mainEntityOfPage"
                    || k == "itemListElement"
                {
                    walk_json_ld(x, out, depth + 1, budget);
                }
            }
        },
        _ => {},
    }
}
