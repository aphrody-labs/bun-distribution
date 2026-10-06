// SPDX-License-Identifier: Apache-2.0
//! Rust extraction with tree-sitter: files, functions, methods, types, traits, impl blocks,
//! macros, `use` imports, type references of signatures and call sites.

use std::collections::HashSet;

use tree_sitter::{Node, Parser};

use super::{FileExtract, RawCall, RawEdge, RawNode, ids::{file_stem, make_id}};
use crate::graph::Confidence;

/// Std and prelude names that would otherwise become hubs of every Rust corpus.
const BUILTIN_TYPES: &[&str] = &[
    "String", "str", "Option", "Result", "Vec", "VecDeque", "Box", "Rc", "Arc", "Weak", "RefCell",
    "Cell", "Cow", "Pin", "HashMap", "HashSet", "BTreeMap", "BTreeSet", "BinaryHeap", "Path",
    "PathBuf", "OsStr", "OsString", "CStr", "CString", "Duration", "Instant", "SystemTime",
    "Ordering", "Range", "RangeInclusive", "PhantomData", "Some", "None", "Ok", "Err", "Self",
    "Default", "Clone", "Copy", "Debug", "Display", "Error", "From", "Into", "TryFrom", "TryInto",
    "AsRef", "AsMut", "Iterator", "IntoIterator", "Extend", "PartialEq", "Eq", "PartialOrd", "Ord",
    "Hash", "Send", "Sync", "Sized", "Drop", "Deref", "DerefMut", "Future", "Fn", "FnMut", "FnOnce",
];

/// Method names too generic to resolve across files (every type has one).
const TRAIT_METHOD_BLOCKLIST: &[&str] = &[
    "new", "default", "parse", "from_str", "now", "clone", "into", "from", "to_string", "to_owned",
    "len", "is_empty", "iter", "next", "build", "start", "run", "init", "app", "get", "set", "push",
    "pop", "insert", "remove", "contains", "collect", "map", "filter", "unwrap", "expect", "ok",
    "err", "some", "none", "send", "recv", "lock", "read", "write",
];

/// Whether a callee name is too generic to be resolved across files.
#[must_use]
pub fn is_blocklisted(name: &str) -> bool {
    TRAIT_METHOD_BLOCKLIST.contains(&name)
}

struct Ctx<'a> {
    rel: &'a str,
    stem: &'a str,
    src: &'a [u8],
    file_nid: String,
    out: FileExtract,
    seen: HashSet<String>,
    local_types: HashSet<String>,
    bodies: Vec<(String, Node<'a>)>,
}

fn text<'a>(node: Node<'_>, src: &'a [u8]) -> &'a str {
    std::str::from_utf8(&src[node.start_byte()..node.end_byte()]).unwrap_or("")
}

fn line(node: Node<'_>) -> usize {
    node.start_position().row + 1
}

impl<'a> Ctx<'a> {
    fn add_node(&mut self, id: &str, label: &str, line: usize) {
        if self.seen.insert(id.to_owned()) {
            self.out.nodes.push(RawNode { id: id.to_owned(), label: label.to_owned(), file: self.rel.to_owned(), loc: format!("L{line}") });
        }
    }

    fn add_edge(&mut self, src: &str, dst: &str, relation: &str, line: usize, context: Option<&str>) {
        self.out.edges.push(RawEdge {
            src: src.to_owned(),
            dst: dst.to_owned(),
            relation: relation.to_owned(),
            confidence: Confidence::Extracted,
            score: 1.0,
            file: self.rel.to_owned(),
            loc: format!("L{line}"),
            context: context.map(str::to_owned),
        });
    }

    /// Node id for a type or function name: local when defined in this file, otherwise a
    /// sourceless stub resolved at corpus level.
    fn named(&mut self, name: &str) -> String {
        let local = make_id(&[self.stem, name]);
        if self.seen.contains(&local) || self.local_types.contains(name) {
            return local;
        }
        let stub = make_id(&[name]);
        if self.seen.insert(stub.clone()) {
            self.out.nodes.push(RawNode { id: stub.clone(), label: name.to_owned(), file: String::new(), loc: String::new() });
        }
        stub
    }

    fn type_refs(&self, node: Option<Node<'_>>, generic: bool, out: &mut Vec<(String, bool)>) {
        let Some(node) = node else { return };
        let keep = |t: &str| !t.is_empty() && (!BUILTIN_TYPES.contains(&t) || self.local_types.contains(t));
        match node.kind() {
            "primitive_type" => {},
            "type_identifier" => {
                let t = text(node, self.src);
                if keep(t) {
                    out.push((t.to_owned(), generic));
                }
            },
            "scoped_type_identifier" => {
                let t = text(node, self.src).rsplit("::").next().unwrap_or("");
                if keep(t) {
                    out.push((t.to_owned(), generic));
                }
            },
            "generic_type" => {
                if let Some(name) = node.child_by_field_name("type") {
                    let t = text(name, self.src).rsplit("::").next().unwrap_or("");
                    if keep(t) {
                        out.push((t.to_owned(), generic));
                    }
                }
                let mut cursor = node.walk();
                for child in node.children(&mut cursor) {
                    if child.kind() == "type_arguments" {
                        let mut inner = child.walk();
                        for arg in child.children(&mut inner) {
                            if arg.is_named() {
                                self.type_refs(Some(arg), true, out);
                            }
                        }
                    }
                }
            },
            _ if node.is_named() => {
                let mut cursor = node.walk();
                for child in node.children(&mut cursor) {
                    if child.is_named() {
                        self.type_refs(Some(child), generic, out);
                    }
                }
            },
            _ => {},
        }
    }

    fn signature_refs(&mut self, func: Node<'a>, func_nid: &str, at: usize) {
        let mut refs: Vec<(String, bool)> = Vec::new();
        let mut contexts: Vec<&str> = Vec::new();
        if let Some(params) = func.child_by_field_name("parameters") {
            let mut cursor = params.walk();
            for p in params.children(&mut cursor) {
                if p.kind() == "parameter" {
                    let before = refs.len();
                    self.type_refs(p.child_by_field_name("type"), false, &mut refs);
                    contexts.extend(std::iter::repeat_n("parameter_type", refs.len() - before));
                }
            }
        }
        let before = refs.len();
        self.type_refs(func.child_by_field_name("return_type"), false, &mut refs);
        contexts.extend(std::iter::repeat_n("return_type", refs.len() - before));
        for ((name, generic), ctx) in refs.into_iter().zip(contexts) {
            let target = self.named(&name);
            if target != func_nid {
                self.add_edge(func_nid, &target, "references", at, Some(if generic { "generic_arg" } else { ctx }));
            }
        }
    }

    fn scan_local_types(&mut self, node: Node<'a>) {
        if matches!(node.kind(), "struct_item" | "enum_item" | "trait_item" | "union_item" | "type_item")
            && let Some(name) = node.child_by_field_name("name")
        {
            self.local_types.insert(text(name, self.src).to_owned());
        }
        let mut cursor = node.walk();
        for child in node.children(&mut cursor) {
            self.scan_local_types(child);
        }
    }

    fn emit_type_refs(&mut self, owner: &str, node: Option<Node<'a>>, at: usize) {
        let mut refs = Vec::new();
        self.type_refs(node, false, &mut refs);
        for (name, generic) in refs {
            let target = self.named(&name);
            if target != owner {
                self.add_edge(owner, &target, "references", at, Some(if generic { "generic_arg" } else { "field" }));
            }
        }
    }

    fn struct_field_refs(&mut self, node: Node<'a>, owner: &str) {
        let mut cursor = node.walk();
        let children: Vec<Node<'a>> = node.children(&mut cursor).collect();
        for c in children {
            match c.kind() {
                "field_declaration_list" => {
                    let mut inner = c.walk();
                    let fields: Vec<Node<'a>> = c.children(&mut inner).collect();
                    for field in fields {
                        if field.kind() == "field_declaration" {
                            self.emit_type_refs(owner, field.child_by_field_name("type"), line(field));
                        }
                    }
                },
                "ordered_field_declaration_list" => {
                    let at = line(c);
                    let mut inner = c.walk();
                    let types: Vec<Node<'a>> = c.children(&mut inner).filter(|n| n.is_named()).collect();
                    for ty in types {
                        self.emit_type_refs(owner, Some(ty), at);
                    }
                },
                _ => {},
            }
        }
    }

    fn enum_variants(&mut self, node: Node<'a>, owner: &str) {
        let mut cursor = node.walk();
        let lists: Vec<Node<'a>> = node.children(&mut cursor).filter(|c| c.kind() == "enum_variant_list").collect();
        for list in lists {
            let mut inner = list.walk();
            let variants: Vec<Node<'a>> = list.children(&mut inner).filter(|v| v.kind() == "enum_variant").collect();
            for variant in variants {
                let at = line(variant);
                let mut vc = variant.walk();
                let parts: Vec<Node<'a>> = variant.children(&mut vc).collect();
                if let Some(id) = parts.iter().find(|p| p.kind() == "identifier") {
                    let name = text(*id, self.src).to_owned();
                    if !name.is_empty() {
                        let nid = make_id(&[owner, &name]);
                        self.add_node(&nid, &name, at);
                        self.add_edge(owner, &nid, "case_of", at, None);
                    }
                }
                for part in parts {
                    match part.kind() {
                        "ordered_field_declaration_list" => {
                            let mut pc = part.walk();
                            let types: Vec<Node<'a>> = part.children(&mut pc).filter(|n| n.is_named()).collect();
                            for ty in types {
                                self.emit_type_refs(owner, Some(ty), at);
                            }
                        },
                        "field_declaration_list" => {
                            let mut pc = part.walk();
                            let fields: Vec<Node<'a>> = part.children(&mut pc).collect();
                            for field in fields {
                                if field.kind() == "field_declaration" {
                                    self.emit_type_refs(owner, field.child_by_field_name("type"), line(field));
                                }
                            }
                        },
                        _ => {},
                    }
                }
            }
        }
    }

    fn walk(&mut self, node: Node<'a>, impl_nid: Option<&str>) {
        match node.kind() {
            "function_item" | "function_signature_item" => {
                if let Some(name) = node.child_by_field_name("name") {
                    let name = text(name, self.src).to_owned();
                    let at = line(node);
                    let nid = if let Some(parent) = impl_nid {
                        let nid = make_id(&[parent, &name]);
                        self.add_node(&nid, &format!(".{name}()"), at);
                        self.add_edge(parent, &nid, "method", at, None);
                        nid
                    } else {
                        let nid = make_id(&[self.stem, &name]);
                        self.add_node(&nid, &format!("{name}()"), at);
                        let file = self.file_nid.clone();
                        self.add_edge(&file, &nid, "contains", at, None);
                        nid
                    };
                    self.signature_refs(node, &nid, at);
                    if let Some(body) = node.child_by_field_name("body") {
                        self.bodies.push((nid, body));
                    }
                }
            },
            "macro_definition" => {
                if let Some(name) = node.child_by_field_name("name") {
                    let name = text(name, self.src).to_owned();
                    let at = line(node);
                    let nid = make_id(&[self.stem, "macro", &name]);
                    self.add_node(&nid, &format!("{name}!"), at);
                    let file = self.file_nid.clone();
                    self.add_edge(&file, &nid, "contains", at, None);
                }
            },
            "struct_item" | "enum_item" | "trait_item" | "union_item" => {
                if let Some(name) = node.child_by_field_name("name") {
                    let name = text(name, self.src).to_owned();
                    let at = line(node);
                    let nid = make_id(&[self.stem, &name]);
                    self.add_node(&nid, &name, at);
                    let file = self.file_nid.clone();
                    self.add_edge(&file, &nid, "contains", at, None);
                    if node.kind() == "struct_item" {
                        self.struct_field_refs(node, &nid);
                    }
                    if node.kind() == "enum_item" {
                        self.enum_variants(node, &nid);
                    }
                    if node.kind() == "trait_item" {
                        let mut cursor = node.walk();
                        for child in node.children(&mut cursor) {
                            if child.kind() == "trait_bounds" {
                                let mut refs = Vec::new();
                                self.type_refs(Some(child), false, &mut refs);
                                for (base, _) in refs {
                                    let target = self.named(&base);
                                    if target != nid {
                                        self.add_edge(&nid, &target, "inherits", at, None);
                                    }
                                }
                            }
                        }
                        if let Some(body) = node.child_by_field_name("body") {
                            self.walk_children(body, Some(&nid));
                        }
                    }
                }
            },
            "impl_item" => {
                let Some(ty) = node.child_by_field_name("type") else { return };
                let at = line(node);
                let type_name = text(ty, self.src).trim().to_owned();
                let nid = make_id(&[self.stem, &type_name]);
                self.add_node(&nid, &type_name, at);
                let file = self.file_nid.clone();
                if !self.out.edges.iter().any(|e| e.src == file && e.dst == nid && e.relation == "contains") {
                    self.add_edge(&file, &nid, "contains", at, None);
                }
                if let Some(tr) = node.child_by_field_name("trait") {
                    let mut trefs = Vec::new();
                    self.type_refs(Some(tr), false, &mut trefs);
                    if let Some((name, _)) = trefs.first() {
                        let target = self.named(name);
                        self.add_edge(&nid, &target, "implements", at, None);
                    }
                }
                if let Some(body) = node.child_by_field_name("body") {
                    self.walk_children(body, Some(&nid));
                }
            },
            "static_item" | "const_item" => {
                if let Some(name) = node.child_by_field_name("name") {
                    let name = text(name, self.src).to_owned();
                    if name == "_" {
                        return;
                    }
                    let at = line(node);
                    let nid = if let Some(parent) = impl_nid {
                        let nid = make_id(&[parent, &name]);
                        self.add_node(&nid, &format!(".{name}"), at);
                        self.add_edge(parent, &nid, "contains", at, None);
                        nid
                    } else {
                        let nid = make_id(&[self.stem, &name]);
                        self.add_node(&nid, &name, at);
                        let file = self.file_nid.clone();
                        self.add_edge(&file, &nid, "contains", at, None);
                        nid
                    };
                    self.emit_type_refs(&nid, node.child_by_field_name("type"), at);
                }
            },
            "use_declaration" => {
                if let Some(arg) = node.child_by_field_name("argument") {
                    let path = text(arg, self.src);
                    let module = path.split(['{', ',']).next().unwrap_or(path).trim().trim_end_matches("::").trim_end_matches('*').trim_end_matches("::");
                    let module = match module.rsplit_once("::") {
                        Some((m, _)) if !path.contains('{') && !path.ends_with("::*") => m,
                        _ => module,
                    };
                    if !module.is_empty() {
                        let label = module.rsplit("::").next().unwrap_or(module);
                        let target = make_id(&[module]);
                        if self.seen.insert(target.clone()) {
                            self.out.nodes.push(RawNode { id: target.clone(), label: label.to_owned(), file: String::new(), loc: String::new() });
                        }
                        let file = self.file_nid.clone();
                        self.add_edge(&file, &target, "imports_from", line(node), Some("import"));
                    }
                }
            },
            "mod_item" => {
                if let Some(body) = node.child_by_field_name("body") {
                    self.walk_children(body, None);
                }
            },
            _ => self.walk_children(node, impl_nid),
        }
    }

    fn walk_children(&mut self, node: Node<'a>, impl_nid: Option<&str>) {
        let mut cursor = node.walk();
        let children: Vec<Node<'a>> = node.children(&mut cursor).collect();
        for child in children {
            self.walk(child, impl_nid);
        }
    }

    fn collect_calls(&mut self, from: &str, node: Node<'a>) {
        if node.kind() == "call_expression"
            && let Some(func) = node.child_by_field_name("function")
        {
            {
                let (name, method) = match func.kind() {
                    "identifier" => (text(func, self.src).to_owned(), false),
                    "scoped_identifier" => (
                        func.child_by_field_name("name").map_or_else(String::new, |n| text(n, self.src).to_owned()),
                        true,
                    ),
                    "field_expression" => (
                        func.child_by_field_name("field").map_or_else(String::new, |n| text(n, self.src).to_owned()),
                        true,
                    ),
                    "generic_function" => (
                        func.child_by_field_name("function")
                            .map(|f| text(f, self.src).rsplit("::").next().unwrap_or("").to_owned())
                            .unwrap_or_default(),
                        false,
                    ),
                    _ => (String::new(), false),
                };
                if !name.is_empty() {
                    self.out.calls.push(RawCall { from: from.to_owned(), name, method, file: self.rel.to_owned(), loc: format!("L{}", line(node)) });
                }
            }
        }
        let mut cursor = node.walk();
        let children: Vec<Node<'a>> = node.children(&mut cursor).collect();
        for child in children {
            self.collect_calls(from, child);
        }
    }
}

/// Extract one Rust file.
#[must_use]
pub fn extract(rel_path: &str, source: &[u8]) -> FileExtract {
    let mut parser = Parser::new();
    if let Err(error) = parser.set_language(&tree_sitter_rust::LANGUAGE.into()) {
        return FileExtract { error: Some(error.to_string()), ..FileExtract::default() };
    }
    let Some(tree) = parser.parse(source, None) else {
        return FileExtract { error: Some("parse failed".into()), ..FileExtract::default() };
    };
    let stem = file_stem(rel_path);
    let file_nid = make_id(&[rel_path]);
    let mut ctx = Ctx {
        rel: rel_path,
        stem,
        src: source,
        file_nid: file_nid.clone(),
        out: FileExtract::default(),
        seen: HashSet::new(),
        local_types: HashSet::new(),
        bodies: Vec::new(),
    };
    let file_name = rel_path.rsplit('/').next().unwrap_or(rel_path);
    ctx.add_node(&file_nid, file_name, 1);
    let root = tree.root_node();
    ctx.scan_local_types(root);
    ctx.walk(root, None);
    let bodies = std::mem::take(&mut ctx.bodies);
    for (nid, body) in bodies {
        ctx.collect_calls(&nid, body);
    }
    ctx.out
}

#[cfg(test)]
mod tests {
    use super::*;

    const SRC: &str = r#"
use std::collections::HashMap;
use aphrody_sql::sqlite::{self, OpenPolicy};

pub struct RagStore { conn: Connection }
pub trait Embedder: Send { fn embed(&self, t: &str) -> Vec<f32>; }
macro_rules! shout { () => {}; }

impl RagStore {
    pub fn open(path: &Path) -> Result<Self> {
        let conn = sqlite::open(path)?;
        init(&conn);
        Ok(Self { conn })
    }
    pub fn search(&self, q: &str) -> Vec<Hit> { self.open_reader(); helper(q) }
}
impl Embedder for RagStore { fn embed(&self, t: &str) -> Vec<f32> { vec![] } }
fn init(c: &Connection) {}
fn helper(q: &str) -> Hit { Hit }
"#;

    fn labels(f: &FileExtract) -> Vec<&str> {
        f.nodes.iter().map(|n| n.label.as_str()).collect()
    }

    #[test]
    fn symbols_get_graphify_style_ids_and_labels() {
        let f = extract("crates/ai/rag/src/store.rs", SRC.as_bytes());
        assert!(f.error.is_none());
        let l = labels(&f);
        for expected in ["store.rs", "RagStore", "Embedder", "shout!", ".open()", ".search()", "init()", "helper()", ".embed()"] {
            assert!(l.contains(&expected), "missing {expected} in {l:?}");
        }
        assert!(f.nodes.iter().any(|n| n.id == "crates_ai_rag_src_store_ragstore"));
        assert!(f.nodes.iter().any(|n| n.id == "crates_ai_rag_src_store_rs"));
    }

    #[test]
    fn structure_edges_are_contains_method_implements_inherits_imports() {
        let f = extract("crates/ai/rag/src/store.rs", SRC.as_bytes());
        let has = |s: &str, d: &str, r: &str| f.edges.iter().any(|e| e.src == s && e.dst == d && e.relation == r);
        assert!(has("crates_ai_rag_src_store_rs", "crates_ai_rag_src_store_ragstore", "contains"));
        assert!(has("crates_ai_rag_src_store_rs", "crates_ai_rag_src_store_init", "contains"));
        assert!(has("crates_ai_rag_src_store_ragstore", "crates_ai_rag_src_store_ragstore_open", "method"));
        assert!(f.edges.iter().any(|e| e.relation == "implements" && e.dst == "crates_ai_rag_src_store_embedder"));
        assert!(f.edges.iter().any(|e| e.relation == "imports_from"));
        // `Embedder: Send` — Send is a builtin and does not become an edge.
        assert!(!f.edges.iter().any(|e| e.relation == "inherits"));
    }

    #[test]
    fn signature_types_become_references_but_builtins_do_not() {
        let f = extract("a.rs", SRC.as_bytes());
        let refs: Vec<&RawEdge> = f.edges.iter().filter(|e| e.relation == "references").collect();
        assert!(refs.iter().any(|e| e.dst == "a_connection" || e.dst == "connection"), "{refs:?}");
        assert!(refs.iter().any(|e| e.context.as_deref() == Some("return_type")));
        assert!(!refs.iter().any(|e| e.dst == "string" || e.dst == "vec" || e.dst == "option"));
    }

    #[test]
    fn call_sites_are_recorded_with_their_form() {
        let f = extract("a.rs", SRC.as_bytes());
        let find = |n: &str| f.calls.iter().find(|c| c.name == n);
        assert!(find("init").is_some_and(|c| !c.method && c.from == "a_ragstore_open"));
        assert!(find("open").is_some_and(|c| c.method));
        assert!(find("open_reader").is_some_and(|c| c.method));
        assert!(find("helper").is_some());
    }

    #[test]
    fn syntax_errors_do_not_panic_and_non_rust_is_ignored() {
        let broken = extract("b.rs", b"fn (((");
        assert!(broken.error.is_none()); // tree-sitter recovers; no panic
        assert!(super::super::extract_file("x.txt", b"hello").nodes.is_empty());
    }

    #[test]
    fn enum_variants_constants_and_field_types_become_nodes_and_edges() {
        let src = b"pub const LIMIT: usize = 3;\nstruct Holder { inner: Inner, list: Vec<Item> }\nenum Shape { Circle(Radius), Square { side: Side }, Empty }\n";
        let f = extract("s.rs", src);
        let labels: Vec<&str> = f.nodes.iter().map(|n| n.label.as_str()).collect();
        for expected in ["LIMIT", "Holder", "Shape", "Circle", "Square", "Empty"] {
            assert!(labels.contains(&expected), "missing {expected} in {labels:?}");
        }
        let case_of = f.edges.iter().filter(|e| e.relation == "case_of").count();
        assert_eq!(case_of, 3);
        let ctx_field: Vec<&str> = f.edges.iter().filter(|e| e.context.as_deref() == Some("field")).map(|e| e.dst.as_str()).collect();
        for expected in ["inner", "radius", "side"] {
            assert!(ctx_field.iter().any(|d| d.ends_with(expected)), "missing field ref {expected} in {ctx_field:?}");
        }
        assert!(f.edges.iter().any(|e| e.context.as_deref() == Some("generic_arg") && e.dst.ends_with("item")));
    }
}
