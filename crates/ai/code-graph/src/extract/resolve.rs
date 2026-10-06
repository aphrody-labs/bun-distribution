// SPDX-License-Identifier: Apache-2.0
//! Corpus assembly: merge per-file extractions, resolve call sites by name (same file first,
//! then a unique corpus-wide definition as an INFERRED edge), and fold sourceless type stubs
//! onto their unique definition.

use std::collections::{BTreeMap, HashMap, HashSet};

use super::{FileExtract, RawEdge, rust::is_blocklisted};
use crate::graph::{Confidence, Edge, Graph, Node, NodeKind};

/// Counters describing an assembly.
#[derive(Debug, Clone, Default, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct AssembleStats {
    /// Call sites seen.
    pub calls: usize,
    /// Resolved inside the same file.
    pub same_file: usize,
    /// Resolved to a unique definition elsewhere (INFERRED).
    pub cross_file: usize,
    /// Left unresolved (unknown, ambiguous or too generic).
    pub unresolved: usize,
    /// Stubs folded onto a definition.
    pub stubs_folded: usize,
}

fn lang_of(file: &str) -> Option<String> {
    Some(match file.rsplit_once('.')?.1 {
        "rs" => "rust",
        _ => return None,
    }
    .to_owned())
}

/// Assemble a graph from per-file extractions.
#[must_use]
pub fn assemble(files: Vec<FileExtract>) -> (Graph, AssembleStats) {
    let mut stats = AssembleStats::default();
    // 1. Merge nodes: a sourced definition replaces a stub with the same id.
    let mut nodes: BTreeMap<String, super::RawNode> = BTreeMap::new();
    let mut edges: Vec<RawEdge> = Vec::new();
    let mut calls = Vec::new();
    for f in files {
        for n in f.nodes {
            match nodes.get(&n.id) {
                Some(existing) if !existing.file.is_empty() || n.file.is_empty() => {},
                _ => {
                    nodes.insert(n.id.clone(), n);
                },
            }
        }
        edges.extend(f.edges);
        calls.extend(f.calls);
    }

    // 2. Fold sourceless stubs onto a unique sourced node of the same label (types only).
    let mut by_label: HashMap<String, Vec<String>> = HashMap::new();
    for n in nodes.values().filter(|n| !n.file.is_empty() && !n.label.ends_with(')') && !n.label.ends_with('!')) {
        by_label.entry(n.label.clone()).or_default().push(n.id.clone());
    }
    let mut rewire: HashMap<String, String> = HashMap::new();
    for n in nodes.values().filter(|n| n.file.is_empty()) {
        if let Some(candidates) = by_label.get(&n.label)
            && let [only] = candidates.as_slice()
        {
            rewire.insert(n.id.clone(), only.clone());
        }
    }
    stats.stubs_folded = rewire.len();
    for e in &mut edges {
        if let Some(t) = rewire.get(&e.dst) {
            e.dst.clone_from(t);
        }
    }
    for id in rewire.keys() {
        nodes.remove(id);
    }

    // 3. Resolve call sites.
    let mut defs: HashMap<(String, bool), Vec<(String, String)>> = HashMap::new(); // (name, method) -> (nid, file)
    for n in nodes.values().filter(|n| !n.file.is_empty()) {
        if let Some(inner) = n.label.strip_suffix("()") {
            if let Some(name) = inner.strip_prefix('.') {
                defs.entry((name.to_owned(), true)).or_default().push((n.id.clone(), n.file.clone()));
            } else {
                defs.entry((inner.to_owned(), false)).or_default().push((n.id.clone(), n.file.clone()));
            }
        }
    }
    let mut seen_calls: HashSet<(String, String)> = HashSet::new();
    for call in calls {
        stats.calls += 1;
        // `Type::name()` may name a free function or a method; try the stated form first.
        let mut candidates: Vec<&(String, String)> = Vec::new();
        for form in [call.method, !call.method] {
            if let Some(found) = defs.get(&(call.name.clone(), form)) {
                candidates.extend(found.iter());
                if !candidates.is_empty() {
                    break;
                }
            }
        }
        let same: Vec<&&(String, String)> = candidates.iter().filter(|(_, f)| *f == call.file).collect();
        let (target, confidence, score) = if let [only] = same.as_slice() {
            (only.0.clone(), Confidence::Extracted, 0.85)
        } else if same.is_empty() && candidates.len() == 1 && !is_blocklisted(&call.name) {
            (candidates[0].0.clone(), Confidence::Inferred, 0.8)
        } else {
            stats.unresolved += 1;
            continue;
        };
        if target == call.from || !seen_calls.insert((call.from.clone(), target.clone())) {
            continue;
        }
        if confidence == Confidence::Extracted {
            stats.same_file += 1;
        } else {
            stats.cross_file += 1;
        }
        edges.push(RawEdge {
            src: call.from,
            dst: target,
            relation: "calls".into(),
            confidence,
            score,
            file: call.file,
            loc: call.loc,
            context: Some("call".into()),
        });
    }

    // 4. Build the graph; edges to nodes that do not exist are dropped (imports to stubs stay
    // because stubs remain nodes).
    let mut index: HashMap<String, usize> = HashMap::new();
    let mut graph_nodes = Vec::new();
    for (id, n) in &nodes {
        index.insert(id.clone(), graph_nodes.len());
        let mut node = Node::code(id, &n.label, if n.file.is_empty() { None } else { Some(&n.file) });
        node.kind = NodeKind::Code;
        node.loc = if n.loc.is_empty() { None } else { Some(n.loc.clone()) };
        node.lang = lang_of(&n.file);
        graph_nodes.push(node);
    }
    let mut graph_edges = Vec::new();
    for e in edges {
        let (Some(&s), Some(&d)) = (index.get(&e.src), index.get(&e.dst)) else { continue };
        graph_edges.push(Edge {
            src: s,
            dst: d,
            relation: e.relation,
            confidence: e.confidence,
            score: e.score,
            file: Some(e.file),
            loc: Some(e.loc),
            weight: 1.0,
            context: e.context,
        });
    }
    (Graph::from_parts(graph_nodes, graph_edges), stats)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::extract::extract_file;

    #[test]
    fn calls_resolve_same_file_first_then_uniquely_across_files() {
        let a = extract_file("a.rs", b"fn run() { local(); remote(); missing(); new(); }\nfn local() {}");
        let b = extract_file("b.rs", b"pub fn remote() {}\npub fn new() {}");
        let (g, stats) = assemble(vec![a, b]);
        let edge = |from: &str, to: &str| {
            g.edges.iter().find(|e| g.nodes[e.src].label == from && g.nodes[e.dst].label == to && e.relation == "calls")
        };
        assert_eq!(edge("run()", "local()").map(|e| e.confidence), Some(Confidence::Extracted));
        assert_eq!(edge("run()", "remote()").map(|e| e.confidence), Some(Confidence::Inferred));
        assert!(edge("run()", "new()").is_none(), "generic names are not resolved across files");
        assert_eq!((stats.same_file, stats.cross_file), (1, 1));
        assert_eq!(stats.unresolved, 2);
    }

    #[test]
    fn type_stubs_fold_onto_their_unique_definition() {
        let a = extract_file("a.rs", b"pub struct Thing;");
        let b = extract_file("b.rs", b"fn use_it(t: Thing) {}");
        let (g, stats) = assemble(vec![a, b]);
        assert_eq!(stats.stubs_folded, 1);
        let r = g.edges.iter().find(|e| e.relation == "references").expect("reference edge");
        assert_eq!(g.nodes[r.dst].file.as_deref(), Some("a.rs"));
        assert!(!g.nodes.iter().any(|n| n.file.is_none() && n.label == "Thing"));
    }
}
