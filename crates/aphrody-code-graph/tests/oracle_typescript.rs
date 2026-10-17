// SPDX-License-Identifier: Apache-2.0
//! TypeScript/JavaScript fixture parity against the committed Graphify 0.9.77 oracle.

use std::{collections::BTreeSet, path::Path};

use aphrody_code_graph::extract::{extract_file, resolve::assemble};

fn jaccard(expected: &BTreeSet<String>, actual: &BTreeSet<String>) -> f64 {
    let intersection = expected.intersection(actual).count() as f64;
    let union = expected.union(actual).count() as f64;
    if union == 0.0 {
        1.0
    } else {
        intersection / union
    }
}

#[test]
fn nodes_and_edges_match_the_graphify_oracle_on_the_fixture() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/ts");
    let files = ["main.ts", "math.ts"]
        .into_iter()
        .map(|name| {
            let path = root.join(name);
            (name.to_owned(), std::fs::read(path).unwrap())
        })
        .map(|(name, source)| extract_file(&name, &source))
        .collect();
    let (graph, _) = assemble(files);
    assert!(
        graph
            .nodes
            .iter()
            .filter(|node| node.file.is_some())
            .all(|node| node.lang.as_deref() == Some("typescript"))
    );
    let nodes: BTreeSet<String> = graph
        .nodes
        .iter()
        .filter(|node| node.file.is_some())
        .map(|node| {
            format!(
                "{}|{}|{}",
                node.file.as_deref().unwrap(),
                node.label,
                node.kind.as_str()
            )
        })
        .collect();
    let edges: BTreeSet<String> = graph
        .edges
        .iter()
        .map(|edge| {
            format!(
                "{}|{}|{}|{}",
                edge.relation,
                graph.nodes[edge.src].label,
                graph.nodes[edge.dst].label,
                edge.confidence.as_str()
            )
        })
        .collect();
    let oracle: serde_json::Value =
        serde_json::from_slice(&std::fs::read(root.with_extension("oracle.json")).unwrap())
            .unwrap();
    let expected_nodes: BTreeSet<String> = oracle["nodes"]
        .as_array()
        .unwrap()
        .iter()
        .map(|value| value.as_str().unwrap().to_owned())
        .collect();
    let expected_edges: BTreeSet<String> = oracle["edges"]
        .as_array()
        .unwrap()
        .iter()
        .map(|value| value.as_str().unwrap().to_owned())
        .collect();
    let node_score = jaccard(&expected_nodes, &nodes);
    let edge_score = jaccard(&expected_edges, &edges);
    assert!(
        node_score >= 0.95,
        "node Jaccard {node_score:.3}; expected {expected_nodes:?}; actual {nodes:?}"
    );
    assert!(
        edge_score >= 0.90,
        "edge Jaccard {edge_score:.3}; expected {expected_edges:?}; actual {edges:?}"
    );
}
