// SPDX-License-Identifier: Apache-2.0
//! Rust extraction with tree-sitter: files, functions, methods, types, traits, impl blocks,
//! macros, `use` imports, type references of signatures and call sites.

use std::collections::{HashMap, HashSet};

use tree_sitter::{Node, Parser};

use super::{
    FileExtract, NodeClass, RawCall, RawEdge, RawNode,
    ids::{file_stem, make_id},
};
use crate::graph::Confidence;

/// Std and prelude names that would otherwise become hubs of every Rust corpus.
const BUILTIN_TYPES: &[&str] = &[
    "String",
    "str",
    "Option",
    "Result",
    "Vec",
    "VecDeque",
    "Box",
    "Rc",
    "Arc",
    "Weak",
    "RefCell",
    "Cell",
    "Cow",
    "Pin",
    "HashMap",
    "HashSet",
    "BTreeMap",
    "BTreeSet",
    "BinaryHeap",
    "Path",
    "PathBuf",
    "OsStr",
    "OsString",
    "CStr",
    "CString",
    "Duration",
    "Instant",
    "SystemTime",
    "Ordering",
    "Range",
    "RangeInclusive",
    "PhantomData",
    "Some",
    "None",
    "Ok",
    "Err",
    "Self",
    "Default",
    "Clone",
    "Copy",
    "Debug",
    "Display",
    "Error",
    "From",
    "Into",
    "TryFrom",
    "TryInto",
    "AsRef",
    "AsMut",
    "Iterator",
    "IntoIterator",
    "Extend",
    "PartialEq",
    "Eq",
    "PartialOrd",
    "Ord",
    "Hash",
    "Send",
    "Sync",
    "Sized",
    "Drop",
    "Deref",
    "DerefMut",
    "Future",
    "Fn",
    "FnMut",
    "FnOnce",
];

/// Method names too generic to resolve across files (every type has one).
const TRAIT_METHOD_BLOCKLIST: &[&str] = &[
    "new",
    "default",
    "parse",
    "from_str",
    "now",
    "clone",
    "into",
    "from",
    "to_string",
    "to_owned",
    "len",
    "is_empty",
    "iter",
    "next",
    "build",
    "start",
    "run",
    "init",
    "app",
    "get",
    "set",
    "push",
    "pop",
    "insert",
    "remove",
    "contains",
    "collect",
    "map",
    "filter",
    "unwrap",
    "expect",
    "ok",
    "err",
    "some",
    "none",
    "send",
    "recv",
    "lock",
    "read",
    "write",
];

/// Whether a callee name is too generic to be resolved across files.
#[must_use]
pub fn is_blocklisted(name: &str) -> bool {
    TRAIT_METHOD_BLOCKLIST.contains(&name)
}

/// Path roots of the standard library; calls through them are never corpus calls.
const STD_QUALIFIERS: &[&str] = &["std", "core", "alloc"];

/// Associated functions whose result is the type they are called on (`T::new()`).
fn is_constructor(name: &str) -> bool {
    name.starts_with("new")
        || name.starts_with("with_")
        || matches!(name, "default" | "create" | "open" | "init" | "builder")
}

/// `&mut Foo<T>` or `Foo::<T>` gives `Foo`; generic arguments anywhere in a path are dropped.
#[must_use]
pub fn strip_generics(path: &str) -> String {
    let mut s = path.trim();
    loop {
        let next = s.trim_start_matches('&').trim_start();
        let next = ["mut ", "dyn ", "impl ", "'static "]
            .iter()
            .fold(next, |acc, p| acc.strip_prefix(p).unwrap_or(acc))
            .trim_start();
        if next == s {
            break;
        }
        s = next;
    }
    let mut out = String::with_capacity(s.len());
    let mut depth = 0usize;
    for c in s.chars() {
        match c {
            '<' => depth += 1,
            '>' => depth = depth.saturating_sub(1),
            _ if depth == 0 && !c.is_whitespace() => out.push(c),
            _ => {},
        }
    }
    out.trim_end_matches("::").to_owned()
}

fn last_segment(path: &str) -> &str {
    path.rsplit("::").next().unwrap_or(path)
}

/// `std::fs`, `core::mem::take`, or a bare std/prelude type such as `Vec`.
fn is_std_path(path: &str) -> bool {
    let first = path.split("::").next().unwrap_or(path);
    STD_QUALIFIERS.contains(&first) || (!path.contains("::") && BUILTIN_TYPES.contains(&path))
}

fn join_path(head: &str, rest: &str) -> String {
    let rest = rest
        .strip_prefix("self")
        .filter(|r| r.is_empty() || r.starts_with("::"))
        .map_or(rest, |r| r.trim_start_matches("::"));
    match (head.is_empty(), rest.is_empty()) {
        (true, _) => rest.to_owned(),
        (_, true) => head.to_owned(),
        _ => format!("{head}::{rest}"),
    }
}

/// Record the `use` aliases of a declaration (local name to full path) and its glob roots.
fn collect_uses(
    node: Node<'_>,
    src: &[u8],
    prefix: &str,
    aliases: &mut HashMap<String, String>,
    globs: &mut Vec<String>,
) {
    match node.kind() {
        "scoped_use_list" => {
            let path = node.child_by_field_name("path").map_or("", |n| text(n, src));
            let full = join_path(prefix, path);
            if let Some(list) = node.child_by_field_name("list") {
                collect_uses(list, src, &full, aliases, globs);
            }
        },
        "use_list" => {
            let mut cursor = node.walk();
            for child in node.named_children(&mut cursor) {
                collect_uses(child, src, prefix, aliases, globs);
            }
        },
        "use_as_clause" => {
            if let (Some(path), Some(alias)) =
                (node.child_by_field_name("path"), node.child_by_field_name("alias"))
            {
                let full = join_path(prefix, text(path, src));
                aliases.insert(text(alias, src).to_owned(), full);
            }
        },
        "use_wildcard" => {
            let path = text(node, src).trim_end_matches('*').trim_end_matches("::");
            globs.push(join_path(prefix, path));
        },
        "scoped_identifier" | "identifier" => {
            let full = join_path(prefix, text(node, src));
            let name = last_segment(&full).to_owned();
            if !matches!(name.as_str(), "crate" | "super" | "self") {
                aliases.insert(name, full);
            }
        },
        "self" => {
            let name = last_segment(prefix).to_owned();
            if !prefix.is_empty() && !matches!(name.as_str(), "crate" | "super" | "self") {
                aliases.insert(name, prefix.to_owned());
            }
        },
        _ => {},
    }
}

/// A function body whose calls are collected once every node of the file is known.
struct Body<'a> {
    nid: String,
    func: Node<'a>,
    body: Node<'a>,
    impl_type: Option<String>,
}

struct Ctx<'a> {
    rel: &'a str,
    stem: &'a str,
    src: &'a [u8],
    file_nid: String,
    out: FileExtract,
    seen: HashSet<String>,
    local_types: HashSet<String>,
    bodies: Vec<Body<'a>>,
    macros: HashMap<String, String>,
    labels: HashMap<String, String>,
    type_nids: HashSet<String>,
    pairs: HashSet<(String, String)>,
    /// `use` aliases: local name to full path.
    aliases: HashMap<String, String>,
    /// Types of the bindings of the current body (`self`, typed parameters, typed `let`s).
    locals: HashMap<String, String>,
    /// Base type of the impl block being walked.
    impl_type: Option<String>,
}

fn text<'a>(node: Node<'_>, src: &'a [u8]) -> &'a str {
    std::str::from_utf8(&src[node.start_byte()..node.end_byte()]).unwrap_or("")
}

fn line(node: Node<'_>) -> usize {
    node.start_position().row + 1
}

fn import_targets(node: Node<'_>, src: &[u8], prefix: &str, out: &mut Vec<String>) {
    match node.kind() {
        "scoped_use_list" => {
            let path = node.child_by_field_name("path").map(|n| text(n, src)).unwrap_or("");
            let full =
                if prefix.is_empty() { path.to_owned() } else { format!("{prefix}::{path}") };
            if let Some(list) = node.child_by_field_name("list") {
                import_targets(list, src, &full, out);
            }
        },
        "use_list" => {
            let mut cursor = node.walk();
            for child in node.named_children(&mut cursor) {
                import_targets(child, src, prefix, out);
            }
        },
        "use_as_clause" => {
            if let Some(path) = node.child_by_field_name("path") {
                import_targets(path, src, prefix, out);
            }
        },
        "use_wildcard" => {
            if !prefix.is_empty() {
                out.push(prefix.to_owned());
            } else {
                let path = text(node, src).trim_end_matches("::*");
                if !path.is_empty() {
                    out.push(path.to_owned());
                }
            }
        },
        "scoped_identifier" => {
            let value = text(node, src);
            out.push(value.rsplit("::").next().unwrap_or(value).to_owned());
        },
        "identifier" | "self" | "super" | "crate" => {
            let value = text(node, src);
            out.push(value.to_owned());
        },
        _ => {},
    }
}

impl<'a> Ctx<'a> {
    fn add_node(&mut self, id: &str, label: &str, line: usize, class: NodeClass) {
        if self.seen.insert(id.to_owned()) {
            self.out.nodes.push(RawNode {
                id: id.to_owned(),
                label: label.to_owned(),
                file: self.rel.to_owned(),
                loc: format!("L{line}"),
                class,
            });
        }
    }

    fn add_edge(
        &mut self,
        src: &str,
        dst: &str,
        relation: &str,
        line: usize,
        context: Option<&str>,
    ) {
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
            self.out.nodes.push(RawNode {
                id: stub.clone(),
                label: name.to_owned(),
                file: String::new(),
                loc: String::new(),
                class: NodeClass::Stub,
            });
        } else if let Some(node) =
            self.out.nodes.iter_mut().find(|n| n.id == stub && n.file.is_empty() && n.label == stub)
        {
            node.label = name.to_owned();
        }
        stub
    }

    fn type_refs(&self, node: Option<Node<'_>>, generic: bool, out: &mut Vec<(String, bool)>) {
        let Some(node) = node else { return };
        let keep = |t: &str| {
            !t.is_empty() && (!BUILTIN_TYPES.contains(&t) || self.local_types.contains(t))
        };
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
                self.add_edge(
                    func_nid,
                    &target,
                    "references",
                    at,
                    Some(if generic { "generic_arg" } else { ctx }),
                );
            }
        }
    }

    fn scan_local_types(&mut self, node: Node<'a>) {
        if matches!(
            node.kind(),
            "struct_item" | "enum_item" | "trait_item" | "union_item" | "type_item"
        ) && let Some(name) = node.child_by_field_name("name")
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
                self.add_edge(
                    owner,
                    &target,
                    "references",
                    at,
                    Some(if generic { "generic_arg" } else { "field" }),
                );
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
                            self.emit_type_refs(
                                owner,
                                field.child_by_field_name("type"),
                                line(field),
                            );
                        }
                    }
                },
                "ordered_field_declaration_list" => {
                    let at = line(c);
                    let mut inner = c.walk();
                    let types: Vec<Node<'a>> =
                        c.children(&mut inner).filter(|n| n.is_named()).collect();
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
        let lists: Vec<Node<'a>> =
            node.children(&mut cursor).filter(|c| c.kind() == "enum_variant_list").collect();
        for list in lists {
            let mut inner = list.walk();
            let variants: Vec<Node<'a>> =
                list.children(&mut inner).filter(|v| v.kind() == "enum_variant").collect();
            for variant in variants {
                let at = line(variant);
                let mut vc = variant.walk();
                let parts: Vec<Node<'a>> = variant.children(&mut vc).collect();
                if let Some(id) = parts.iter().find(|p| p.kind() == "identifier") {
                    let name = text(*id, self.src).to_owned();
                    if !name.is_empty() {
                        let nid = make_id(&[owner, &name]);
                        self.add_node(&nid, &name, at, NodeClass::Variant);
                        self.add_edge(owner, &nid, "case_of", at, None);
                    }
                }
                for part in parts {
                    match part.kind() {
                        "ordered_field_declaration_list" => {
                            let mut pc = part.walk();
                            let types: Vec<Node<'a>> =
                                part.children(&mut pc).filter(|n| n.is_named()).collect();
                            for ty in types {
                                self.emit_type_refs(owner, Some(ty), at);
                            }
                        },
                        "field_declaration_list" => {
                            let mut pc = part.walk();
                            let fields: Vec<Node<'a>> = part.children(&mut pc).collect();
                            for field in fields {
                                if field.kind() == "field_declaration" {
                                    self.emit_type_refs(
                                        owner,
                                        field.child_by_field_name("type"),
                                        line(field),
                                    );
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
                        self.add_node(&nid, &format!(".{name}()"), at, NodeClass::Function);
                        self.add_edge(parent, &nid, "method", at, None);
                        nid
                    } else {
                        let nid = make_id(&[self.stem, &name]);
                        self.add_node(&nid, &format!("{name}()"), at, NodeClass::Function);
                        let file = self.file_nid.clone();
                        self.add_edge(&file, &nid, "contains", at, None);
                        nid
                    };
                    self.signature_refs(node, &nid, at);
                    if let Some(body) = node.child_by_field_name("body") {
                        let impl_type = impl_nid.and_then(|_| self.impl_type.clone());
                        self.bodies.push(Body { nid, func: node, body, impl_type });
                    }
                }
            },
            "macro_definition" => {
                if let Some(name) = node.child_by_field_name("name") {
                    let name = text(name, self.src).to_owned();
                    let at = line(node);
                    let nid = make_id(&[self.stem, "macro", &name]);
                    self.add_node(&nid, &format!("{name}!"), at, NodeClass::Macro);
                    self.macros.entry(name.clone()).or_insert_with(|| nid.clone());
                    let file = self.file_nid.clone();
                    self.add_edge(&file, &nid, "contains", at, None);
                }
            },
            "struct_item" | "enum_item" | "trait_item" | "union_item" => {
                if let Some(name) = node.child_by_field_name("name") {
                    let name = text(name, self.src).to_owned();
                    let at = line(node);
                    let nid = make_id(&[self.stem, &name]);
                    self.add_node(&nid, &name, at, NodeClass::Type);
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
                self.add_node(&nid, &type_name, at, NodeClass::Type);
                if let Some(tr) = node.child_by_field_name("trait") {
                    let mut trefs = Vec::new();
                    self.type_refs(Some(tr), false, &mut trefs);
                    for (idx, (name, _)) in trefs.iter().enumerate() {
                        let target = self.named(name);
                        if target == nid {
                            continue;
                        }
                        if idx == 0 {
                            self.add_edge(&nid, &target, "implements", at, None);
                        } else {
                            self.add_edge(&nid, &target, "references", at, Some("generic_arg"));
                        }
                    }
                }
                if let Some(body) = node.child_by_field_name("body") {
                    let outer = self.impl_type.replace(strip_generics(&type_name));
                    self.walk_children(body, Some(&nid));
                    self.impl_type = outer;
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
                        self.add_node(&nid, &format!(".{name}"), at, NodeClass::Const);
                        self.add_edge(parent, &nid, "contains", at, None);
                        nid
                    } else {
                        let nid = make_id(&[self.stem, &name]);
                        self.add_node(&nid, &name, at, NodeClass::Const);
                        let file = self.file_nid.clone();
                        self.add_edge(&file, &nid, "contains", at, None);
                        nid
                    };
                    self.emit_type_refs(&nid, node.child_by_field_name("type"), at);
                }
            },
            "use_declaration" => {
                if let Some(arg) = node.child_by_field_name("argument") {
                    let mut globs = Vec::new();
                    collect_uses(arg, self.src, "", &mut self.aliases, &mut globs);
                    for glob in globs {
                        if !glob.is_empty() && !self.out.globs.contains(&glob) {
                            self.out.globs.push(glob);
                        }
                    }
                    let mut targets = Vec::new();
                    import_targets(arg, self.src, "", &mut targets);
                    targets.sort();
                    targets.dedup();
                    for name in targets.into_iter().filter(|name| !name.is_empty()) {
                        // The target is resolved at corpus level (a type, a file, or a concept
                        // node); it is not a node of this file, so calls never match it.
                        let target = make_id(&[&name]);
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

    fn prepare_resolution(&mut self) {
        for n in &self.out.nodes {
            let normalised =
                n.label.trim_matches(|c| c == '(' || c == ')').trim_start_matches('.').to_owned();
            self.labels.insert(normalised, n.id.clone());
            if !n.label.ends_with(')') {
                self.type_nids.insert(n.id.clone());
            }
        }
    }

    fn call_edge(&mut self, from: &str, target: &str, relation: &str, context: &str, at: usize) {
        if target == from || !self.pairs.insert((from.to_owned(), target.to_owned())) {
            return;
        }
        self.add_edge(from, target, relation, at, Some(context));
    }

    fn expand(&self, path: &str) -> String {
        let path = strip_generics(path);
        let (first, rest) = path.split_once("::").map_or((path.as_str(), ""), |(f, r)| (f, r));
        let first =
            if first == "Self" { self.impl_type.as_deref().unwrap_or(first) } else { first };
        let head = self.aliases.get(first).map_or(first, String::as_str);
        join_path(head, rest)
    }

    /// Whether a type path names a type defined in this file (or the current impl type).
    fn is_local_type(&self, path: &str) -> bool {
        let last = last_segment(path);
        !path.contains("::")
            && (self.local_types.contains(last) || self.impl_type.as_deref() == Some(last))
    }

    /// Type path of a type node (`&mut Foo<T>` gives `Foo`), `None` for std or primitive types.
    fn type_path(&self, node: Node<'_>) -> Option<String> {
        let raw = match node.kind() {
            "reference_type" | "pointer_type" => {
                return self.type_path(node.child_by_field_name("type")?);
            },
            "generic_type" => text(node.child_by_field_name("type")?, self.src),
            "type_identifier" | "scoped_type_identifier" => text(node, self.src),
            _ => return None,
        };
        let path = strip_generics(raw);
        let path = if path == "Self" { self.impl_type.clone()? } else { path };
        let last = last_segment(&path);
        if path.is_empty()
            || is_std_path(&path)
            || (BUILTIN_TYPES.contains(&last) && !self.local_types.contains(last))
        {
            return None;
        }
        Some(path)
    }

    /// Type of a `let` initialiser when it is obvious: `T { .. }`, `T::new(..)` (also behind `?`,
    /// `.await`, `.unwrap()`), or another typed binding.
    fn value_type(&self, node: Node<'_>) -> Option<String> {
        match node.kind() {
            "try_expression"
            | "await_expression"
            | "parenthesized_expression"
            | "reference_expression" => {
                let mut cursor = node.walk();
                let inner = node.named_children(&mut cursor).last()?;
                self.value_type(inner)
            },
            "struct_expression" => self.type_path(node.child_by_field_name("name")?),
            "identifier" => self.locals.get(text(node, self.src)).cloned(),
            "call_expression" => {
                let func = node.child_by_field_name("function")?;
                match func.kind() {
                    "scoped_identifier" => {
                        let name = text(func.child_by_field_name("name")?, self.src);
                        let path =
                            strip_generics(text(func.child_by_field_name("path")?, self.src));
                        let path = if path == "Self" { self.impl_type.clone()? } else { path };
                        let last = last_segment(&path);
                        (is_constructor(name)
                            && last.starts_with(char::is_uppercase)
                            && !is_std_path(&path))
                        .then_some(path)
                    },
                    "field_expression" => {
                        let field = text(func.child_by_field_name("field")?, self.src);
                        if matches!(field, "unwrap" | "expect" | "unwrap_or_default") {
                            self.value_type(func.child_by_field_name("value")?)
                        } else {
                            None
                        }
                    },
                    _ => None,
                }
            },
            _ => None,
        }
    }

    fn bind_pattern(&mut self, pattern: Node<'_>, ty: String) {
        match pattern.kind() {
            "identifier" => {
                self.locals.insert(text(pattern, self.src).to_owned(), ty);
            },
            "mut_pattern" | "ref_pattern" => {
                let mut cursor = pattern.walk();
                let inner = pattern.named_children(&mut cursor).find(|n| n.kind() == "identifier");
                if let Some(inner) = inner {
                    self.locals.insert(text(inner, self.src).to_owned(), ty);
                }
            },
            _ => {},
        }
    }

    fn bind_parameters(&mut self, func: Node<'_>) {
        self.locals.clear();
        if let Some(t) = self.impl_type.clone() {
            self.locals.insert("self".into(), t);
        }
        let Some(params) = func.child_by_field_name("parameters") else { return };
        let mut cursor = params.walk();
        let children: Vec<Node<'_>> = params.named_children(&mut cursor).collect();
        for p in children {
            if p.kind() == "parameter"
                && let (Some(pattern), Some(ty)) =
                    (p.child_by_field_name("pattern"), p.child_by_field_name("type"))
                && let Some(t) = self.type_path(ty)
            {
                self.bind_pattern(pattern, t);
            }
        }
    }

    fn defer_call(
        &mut self,
        from: &str,
        name: &str,
        method: bool,
        path: Option<String>,
        at: usize,
    ) {
        self.out.calls.push(RawCall {
            from: from.to_owned(),
            name: name.to_owned(),
            method,
            file: self.rel.to_owned(),
            loc: format!("L{at}"),
            path,
            module: None,
        });
    }

    /// A method of a type defined in this file, when that method is in this file too.
    fn local_method(&self, type_name: &str, name: &str) -> Option<String> {
        let id = make_id(&[&make_id(&[self.stem, type_name]), name]);
        self.seen.contains(&id).then_some(id)
    }

    fn label_edge(&mut self, from: &str, name: &str, at: usize) -> bool {
        let Some(target) = self.labels.get(name).cloned() else { return false };
        let constructor = self.type_nids.contains(&target);
        let (relation, context) =
            if constructor { ("references", "constructor") } else { ("calls", "call") };
        self.call_edge(from, &target, relation, context, at);
        true
    }

    /// Resolve the calls of one function body: a name defined in this file is an EXTRACTED
    /// `calls` edge (a `references` edge for a type used as a constructor). Everything else is
    /// kept for corpus resolution with what the file knows about it: the `use` path of a plain
    /// call, the expanded qualifier of `path::name()`, or the receiver type of `x.name()` when
    /// `x` is `self`, a typed parameter or an obviously typed `let` binding.
    fn collect_calls(&mut self, from: &str, node: Node<'a>) {
        if node.kind() == "function_item" {
            return;
        }
        if node.kind() == "let_declaration"
            && let Some(pattern) = node.child_by_field_name("pattern")
        {
            let ty = node
                .child_by_field_name("type")
                .and_then(|t| self.type_path(t))
                .or_else(|| node.child_by_field_name("value").and_then(|v| self.value_type(v)));
            if let Some(ty) = ty {
                self.bind_pattern(pattern, ty);
            }
        }
        if node.kind() == "macro_invocation"
            && let Some(m) = node.child_by_field_name("macro")
            && m.kind() == "identifier"
        {
            let name = text(m, self.src).to_owned();
            if let Some(target) = self.macros.get(&name).cloned() {
                self.call_edge(from, &target, "calls", "call", line(node));
            }
        }
        if node.kind() == "call_expression"
            && let Some(func) = node.child_by_field_name("function")
        {
            let func = if func.kind() == "generic_function" {
                func.child_by_field_name("function").unwrap_or(func)
            } else {
                func
            };
            self.call_site(from, func, line(node));
        }
        let mut cursor = node.walk();
        let children: Vec<Node<'a>> = node.children(&mut cursor).collect();
        for child in children {
            self.collect_calls(from, child);
        }
    }

    fn call_site(&mut self, from: &str, func: Node<'a>, at: usize) {
        match func.kind() {
            "identifier" => {
                let name = text(func, self.src).to_owned();
                let builtin =
                    BUILTIN_TYPES.contains(&name.as_str()) && !self.local_types.contains(&name);
                if !name.is_empty() && !builtin && !self.label_edge(from, &name, at) {
                    let path = self
                        .aliases
                        .get(&name)
                        .and_then(|full| full.rsplit_once("::").map(|(p, _)| p.to_owned()));
                    if path.is_some() || !is_blocklisted(&name.to_lowercase()) {
                        self.defer_call(from, &name, false, path, at);
                    }
                }
            },
            "scoped_identifier" => {
                let name =
                    func.child_by_field_name("name").map_or("", |n| text(n, self.src)).to_owned();
                let qualifier = strip_generics(
                    func.child_by_field_name("path").map_or("", |n| text(n, self.src)),
                );
                if name.is_empty() || qualifier.is_empty() {
                    return;
                }
                if self.is_local_type(&qualifier) || qualifier == "Self" {
                    let ty = if qualifier == "Self" {
                        self.impl_type.clone().unwrap_or_default()
                    } else {
                        qualifier
                    };
                    if let Some(target) = self.local_method(&ty, &name) {
                        self.call_edge(from, &target, "calls", "call", at);
                    } else if !ty.is_empty() {
                        self.defer_call(from, &name, true, Some(ty), at);
                    }
                    return;
                }
                let path = self.expand(&qualifier);
                if !is_std_path(&path) {
                    let method = last_segment(&path).starts_with(char::is_uppercase);
                    self.defer_call(from, &name, method, Some(path), at);
                }
            },
            "field_expression" => {
                let name =
                    func.child_by_field_name("field").map_or("", |n| text(n, self.src)).to_owned();
                if name.is_empty() {
                    return;
                }
                let receiver =
                    func.child_by_field_name("value").and_then(|recv| match recv.kind() {
                        "self" | "identifier" => self.locals.get(text(recv, self.src)).cloned(),
                        _ => None,
                    });
                match receiver {
                    Some(ty) if self.is_local_type(&ty) => {
                        if let Some(target) = self.local_method(&ty, &name) {
                            self.call_edge(from, &target, "calls", "call", at);
                        } else {
                            self.defer_call(from, &name, true, Some(ty), at);
                        }
                    },
                    Some(ty) => {
                        let path = self.expand(&ty);
                        self.defer_call(from, &name, true, Some(path), at);
                    },
                    None => {
                        if !is_blocklisted(&name) {
                            self.label_edge(from, &name, at);
                        }
                    },
                }
            },
            _ => {},
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
        macros: HashMap::new(),
        labels: HashMap::new(),
        type_nids: HashSet::new(),
        pairs: HashSet::new(),
        aliases: HashMap::new(),
        locals: HashMap::new(),
        impl_type: None,
    };
    let file_name = rel_path.rsplit('/').next().unwrap_or(rel_path);
    ctx.add_node(&file_nid, file_name, 1, NodeClass::File);
    let root = tree.root_node();
    ctx.scan_local_types(root);
    ctx.walk(root, None);
    ctx.prepare_resolution();
    let bodies = std::mem::take(&mut ctx.bodies);
    for body in bodies {
        ctx.impl_type = body.impl_type;
        ctx.bind_parameters(body.func);
        ctx.collect_calls(&body.nid, body.body);
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
        for expected in [
            "store.rs",
            "RagStore",
            "Embedder",
            "shout!",
            ".open()",
            ".search()",
            "init()",
            "helper()",
            ".embed()",
        ] {
            assert!(l.contains(&expected), "missing {expected} in {l:?}");
        }
        assert!(f.nodes.iter().any(|n| n.id == "crates_ai_rag_src_store_ragstore"));
        assert!(f.nodes.iter().any(|n| n.id == "crates_ai_rag_src_store_rs"));
    }

    #[test]
    fn structure_edges_are_contains_method_implements_inherits_imports() {
        let f = extract("crates/ai/rag/src/store.rs", SRC.as_bytes());
        let has = |s: &str, d: &str, r: &str| {
            f.edges.iter().any(|e| e.src == s && e.dst == d && e.relation == r)
        };
        assert!(has("crates_ai_rag_src_store_rs", "crates_ai_rag_src_store_ragstore", "contains"));
        assert!(has("crates_ai_rag_src_store_rs", "crates_ai_rag_src_store_init", "contains"));
        assert!(has(
            "crates_ai_rag_src_store_ragstore",
            "crates_ai_rag_src_store_ragstore_open",
            "method"
        ));
        assert!(
            f.edges
                .iter()
                .any(|e| e.relation == "implements" && e.dst == "crates_ai_rag_src_store_embedder")
        );
        assert!(f.edges.iter().any(|e| e.relation == "imports_from"));
        // `Embedder: Send` — Send is a builtin and does not become an edge.
        assert!(!f.edges.iter().any(|e| e.relation == "inherits"));
    }

    #[test]
    fn grouped_imports_emit_each_leaf_and_wildcards_keep_their_module() {
        let src = b"use std::path::{Path, PathBuf};\nuse crate::{model::Model, store::Store as KvStore};\nuse std::fmt::*;\n";
        let f = extract("imports.rs", src);
        let mut targets: Vec<&str> = f
            .edges
            .iter()
            .filter(|e| e.relation == "imports_from")
            .map(|e| e.dst.as_str())
            .collect();
        targets.sort_unstable();
        assert_eq!(targets, ["model", "path", "pathbuf", "std_fmt", "store"]);
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
    fn calls_inside_the_file_are_edges_and_unknown_plain_calls_wait_for_the_corpus() {
        let f = extract(
            "a.rs",
            format!("{SRC}\nfn caller() {{ outside(); self_less::scoped(); x.member(); }}")
                .as_bytes(),
        );
        let has = |s: &str, d: &str, r: &str| {
            f.edges.iter().any(|e| e.src == s && e.dst == d && e.relation == r)
        };
        assert!(has("a_ragstore_open", "a_init", "calls"));
        assert!(has("a_ragstore_search", "a_helper", "calls"));
        // A plain unknown call and a qualified call wait for the corpus with their path; a member
        // call on a receiver of unknown type does not.
        let pending: Vec<(&str, Option<&str>)> = f
            .calls
            .iter()
            .filter(|c| c.from == "a_caller")
            .map(|c| (c.name.as_str(), c.path.as_deref()))
            .collect();
        assert_eq!(pending, [("outside", None), ("scoped", Some("self_less"))]);
    }

    #[test]
    fn use_aliases_self_and_typed_receivers_give_call_paths() {
        let src = "use bun_sys::{self as sys, File};\nuse crate::store::*;\nstruct Local;\nimpl Local {\n fn a(&self) { self.b(); Self::c(); sys::open(); File::new(); }\n fn b(&self) {}\n fn c() {}\n}\nfn f(file: &mut File<'_>) { let l = Local; l.a(); file.read(); std::mem::take(); Vec::new(); }\n";
        let f = extract("src/x.rs", src.as_bytes());
        let has = |s: &str, d: &str| {
            f.edges.iter().any(|e| e.src == s && e.dst == d && e.relation == "calls")
        };
        assert!(has("src_x_local_a", "src_x_local_b"));
        assert!(has("src_x_local_a", "src_x_local_c"));
        assert!(has("src_x_f", "src_x_local_a"));
        let pending: Vec<(&str, bool, Option<&str>)> =
            f.calls.iter().map(|c| (c.name.as_str(), c.method, c.path.as_deref())).collect();
        assert_eq!(
            pending,
            [
                ("open", false, Some("bun_sys")),
                ("new", true, Some("bun_sys::File")),
                ("read", true, Some("bun_sys::File"))
            ]
        );
        assert_eq!(f.globs, ["crate::store"]);
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
        let ctx_field: Vec<&str> = f
            .edges
            .iter()
            .filter(|e| e.context.as_deref() == Some("field"))
            .map(|e| e.dst.as_str())
            .collect();
        for expected in ["inner", "radius", "side"] {
            assert!(
                ctx_field.iter().any(|d| d.ends_with(expected)),
                "missing field ref {expected} in {ctx_field:?}"
            );
        }
        assert!(
            f.edges
                .iter()
                .any(|e| e.context.as_deref() == Some("generic_arg") && e.dst.ends_with("item"))
        );
    }
}
