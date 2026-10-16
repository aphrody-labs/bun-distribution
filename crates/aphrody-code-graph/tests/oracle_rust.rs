// SPDX-License-Identifier: Apache-2.0
//! Parity of the native Rust extractor against the Graphify oracle (criterion P2 of
//! docs/plans/agent-home-pipeline/PLAN.md) on the committed fixture crate. The expected sets in
//! `fixtures/rust.oracle.json` were produced by Graphify 0.9.77 (`graphify update`); the test
//! needs no Graphify installation.

use std::{collections::BTreeSet, path::Path};

use aphrody_code_graph::extract::{extract_file, resolve::assemble};

fn fixture_files() -> Vec<(String, Vec<u8>)> {
    fn walk(dir: &Path, root: &Path, out: &mut Vec<(String, Vec<u8>)>) {
        let mut entries: Vec<_> = std::fs::read_dir(dir).unwrap().flatten().collect();
        entries.sort_by_key(std::fs::DirEntry::file_name);
        for e in entries {
            let p = e.path();
            if p.is_dir() {
                walk(&p, root, out);
            } else if p.extension().is_some_and(|x| x == "rs") {
                let rel = p.strip_prefix(root).unwrap().to_string_lossy().replace('\\', "/");
                out.push((rel, std::fs::read(&p).unwrap()));
            }
        }
    }
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/rust");
    let mut out = Vec::new();
    walk(&root, &root, &mut out);
    out
}

fn jaccard(a: &BTreeSet<String>, b: &BTreeSet<String>) -> f64 {
    let inter = a.intersection(b).count() as f64;
    let union = a.union(b).count() as f64;
    if union == 0.0 { 1.0 } else { inter / union }
}

#[test]
fn nodes_and_edges_match_the_graphify_oracle_on_the_fixture() {
    let oracle: serde_json::Value = serde_json::from_slice(
        &std::fs::read(
            Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/rust.oracle.json"),
        )
        .unwrap(),
    )
    .unwrap();
    let expected_nodes: BTreeSet<String> = oracle["nodes"]
        .as_array()
        .unwrap()
        .iter()
        .map(|v| v.as_str().unwrap().to_owned())
        .collect();
    let expected_edges: BTreeSet<String> = oracle["edges"]
        .as_array()
        .unwrap()
        .iter()
        .map(|v| v.as_str().unwrap().to_owned())
        .collect();

    let files = fixture_files().into_iter().map(|(rel, src)| extract_file(&rel, &src)).collect();
    let (graph, _) = assemble(files);

    let nodes: BTreeSet<String> = graph
        .nodes
        .iter()
        .filter(|n| n.file.is_some())
        .map(|n| format!("{}|{}|{}", n.file.as_deref().unwrap(), n.label, n.kind.as_str()))
        .collect();
    let edges: BTreeSet<String> = graph
        .edges
        .iter()
        .map(|e| {
            format!(
                "{}|{}|{}|{}",
                e.relation,
                graph.nodes[e.src].label,
                graph.nodes[e.dst].label,
                e.confidence.as_str()
            )
        })
        .collect();

    let node_j = jaccard(&nodes, &expected_nodes);
    let edge_j = jaccard(&edges, &expected_edges);
    let missing_nodes: Vec<_> = expected_nodes.difference(&nodes).collect();
    let extra_nodes: Vec<_> = nodes.difference(&expected_nodes).collect();
    let missing_edges: Vec<_> = expected_edges.difference(&edges).collect();
    let extra_edges: Vec<_> = edges.difference(&expected_edges).collect();
    println!("node jaccard {node_j:.3}, edge jaccard {edge_j:.3}");
    println!("missing nodes {missing_nodes:#?}\nextra nodes {extra_nodes:#?}");
    println!("missing edges {missing_edges:#?}\nextra edges {extra_edges:#?}");
    assert!(
        node_j >= 0.95,
        "node jaccard {node_j:.3}: missing {missing_nodes:?} extra {extra_nodes:?}"
    );
    // Graphify resolves neither qualified (`store::Store::open`, `net::client::fetch_into`) nor
    // typed-receiver (`store.insert`) calls, nor every name of a `use` list; these edges are
    // checked by hand against the fixture and are the only extras allowed.
    let enrichment: BTreeSet<&str> = [
        "calls|fetch_into()|.put()|INFERRED",
        "calls|helper()|.insert()|INFERRED",
        "calls|run()|.insert()|INFERRED",
        "calls|run()|.open()|INFERRED",
        "calls|run()|fetch_into()|INFERRED",
        "imports_from|client.rs|Backend|EXTRACTED",
        "imports_from|client.rs|count|EXTRACTED",
    ]
    .into_iter()
    .collect();
    assert!(missing_edges.is_empty(), "edge jaccard {edge_j:.3}: missing {missing_edges:?}");
    let unexpected: Vec<_> =
        extra_edges.iter().filter(|e| !enrichment.contains(e.as_str())).collect();
    assert!(unexpected.is_empty(), "edge jaccard {edge_j:.3}: unexpected extra {unexpected:?}");
}
