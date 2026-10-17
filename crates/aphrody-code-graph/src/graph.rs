// SPDX-License-Identifier: Apache-2.0
//! The in-memory graph and its persistence in the home database.

use std::collections::HashMap;

use aphrody_store::HomeDb;
use rusqlite::params;
use serde::{Deserialize, Serialize};

use crate::error::{GraphError, Result};

/// What a node represents.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum NodeKind {
    /// A symbol or file of source code.
    Code,
    /// A document.
    Document,
    /// A concept.
    Concept,
    /// A design rationale.
    Rationale,
}

impl NodeKind {
    /// Database and `graph.json` label.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Code => "code",
            Self::Document => "document",
            Self::Concept => "concept",
            Self::Rationale => "rationale",
        }
    }

    pub(crate) fn parse(label: &str) -> Self {
        match label {
            "code" => Self::Code,
            "concept" => Self::Concept,
            "rationale" => Self::Rationale,
            _ => Self::Document,
        }
    }
}

/// How an edge was established.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum Confidence {
    /// Read directly from the syntax tree.
    #[serde(rename = "EXTRACTED")]
    Extracted,
    /// Resolved by a heuristic (name matching, call resolution).
    #[serde(rename = "INFERRED")]
    Inferred,
    /// Several equally plausible targets.
    #[serde(rename = "AMBIGUOUS")]
    Ambiguous,
}

impl Confidence {
    /// Database and `graph.json` label.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Extracted => "EXTRACTED",
            Self::Inferred => "INFERRED",
            Self::Ambiguous => "AMBIGUOUS",
        }
    }

    pub(crate) fn parse(label: &str) -> Self {
        match label {
            "EXTRACTED" => Self::Extracted,
            "INFERRED" => Self::Inferred,
            _ => Self::Ambiguous,
        }
    }
}

/// A graph node.
#[derive(Debug, Clone, PartialEq)]
pub struct Node {
    /// Stable id (unique in the graph).
    pub id: String,
    /// Display label.
    pub label: String,
    /// Lower-case label used for matching.
    pub norm_label: String,
    /// Kind.
    pub kind: NodeKind,
    /// Source file.
    pub file: Option<String>,
    /// Location (`L132`).
    pub loc: Option<String>,
    /// Language.
    pub lang: Option<String>,
    /// Community id.
    pub community: Option<i64>,
    /// Community name.
    pub community_name: Option<String>,
    /// Package of the node file: Rust crate identifier or npm package name.
    pub package: Option<String>,
}

impl Node {
    /// A code node with the given id, label and file.
    #[must_use]
    pub fn code(id: &str, label: &str, file: Option<&str>) -> Self {
        Self {
            id: id.to_owned(),
            label: label.to_owned(),
            norm_label: label.to_lowercase(),
            kind: NodeKind::Code,
            file: file.map(str::to_owned),
            loc: None,
            lang: None,
            community: None,
            community_name: None,
            package: None,
        }
    }
}

/// A directed edge between two node indices.
#[derive(Debug, Clone, PartialEq)]
pub struct Edge {
    /// Source node index.
    pub src: usize,
    /// Target node index.
    pub dst: usize,
    /// Relation (`calls`, `contains`...).
    pub relation: String,
    /// Confidence class.
    pub confidence: Confidence,
    /// Confidence score in `[0, 1]`.
    pub score: f64,
    /// File of the reference.
    pub file: Option<String>,
    /// Location of the reference.
    pub loc: Option<String>,
    /// Weight.
    pub weight: f64,
    /// Context (`call`, `import`...).
    pub context: Option<String>,
}

impl Edge {
    /// An EXTRACTED edge of weight 1 and score 1.
    #[must_use]
    pub fn extracted(src: usize, dst: usize, relation: &str) -> Self {
        Self {
            src,
            dst,
            relation: relation.to_owned(),
            confidence: Confidence::Extracted,
            score: 1.0,
            file: None,
            loc: None,
            weight: 1.0,
            context: None,
        }
    }
}

/// Facts about the tree a graph was built from.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct GraphMeta {
    /// Absolute root of the tree.
    pub root: Option<String>,
    /// `HEAD` of the tree at build time.
    pub built_at_commit: Option<String>,
}

/// A graph with adjacency lists in both directions.
#[derive(Debug, Clone, Default)]
pub struct Graph {
    /// Nodes, indexed by position.
    pub nodes: Vec<Node>,
    /// Edges.
    pub edges: Vec<Edge>,
    /// Source facts (filled by [`Graph::load`]).
    pub meta: GraphMeta,
    pub(crate) by_id: HashMap<String, usize>,
    pub(crate) out_adj: Vec<Vec<usize>>,
    pub(crate) in_adj: Vec<Vec<usize>>,
}

impl Graph {
    /// Build a graph from nodes and edges (edges reference node positions). Edges with an
    /// out-of-range endpoint are dropped; duplicate node ids keep the first.
    #[must_use]
    pub fn from_parts(nodes: Vec<Node>, edges: Vec<Edge>) -> Self {
        let mut graph = Self::default();
        for node in nodes {
            if graph.by_id.contains_key(&node.id) {
                continue;
            }
            graph.by_id.insert(node.id.clone(), graph.nodes.len());
            graph.nodes.push(node);
        }
        graph.out_adj = vec![Vec::new(); graph.nodes.len()];
        graph.in_adj = vec![Vec::new(); graph.nodes.len()];
        for edge in edges {
            if edge.src >= graph.nodes.len() || edge.dst >= graph.nodes.len() {
                continue;
            }
            let index = graph.edges.len();
            graph.out_adj[edge.src].push(index);
            graph.in_adj[edge.dst].push(index);
            graph.edges.push(edge);
        }
        graph
    }

    /// Index of a node id.
    #[must_use]
    pub fn index_of(&self, id: &str) -> Option<usize> {
        self.by_id.get(id).copied()
    }

    /// Total degree (in plus out) of a node.
    #[must_use]
    pub fn degree(&self, node: usize) -> usize {
        self.out_adj[node].len() + self.in_adj[node].len()
    }

    /// Indices of the edges leaving a node.
    #[must_use]
    pub fn out_edges(&self, node: usize) -> &[usize] {
        &self.out_adj[node]
    }

    /// Indices of the edges entering a node.
    #[must_use]
    pub fn in_edges(&self, node: usize) -> &[usize] {
        &self.in_adj[node]
    }

    /// Load the graph of the source `label` from the home database.
    ///
    /// # Errors
    ///
    /// [`GraphError::UnknownSource`] or database failures.
    pub fn load(db: &HomeDb, label: &str) -> Result<Self> {
        let source = db
            .source_id(label)?
            .ok_or_else(|| GraphError::UnknownSource(label.to_owned()))?;
        let mut nodes = Vec::new();
        {
            let mut stmt = db.conn().prepare(
                "SELECT n.node_id, n.label, n.kind, n.file_path, n.loc, n.lang, n.community, c.name,
                        json_extract(n.attrs_json, '$.package')
                 FROM graph_nodes n
                 LEFT JOIN graph_communities c ON c.source_id = n.source_id AND c.id = n.community
                 WHERE n.source_id = ?1 ORDER BY n.pk",
            )?;
            let rows = stmt.query_map([source], |r| {
                let label: String = r.get(1)?;
                Ok(Node {
                    id: r.get(0)?,
                    norm_label: label.to_lowercase(),
                    label,
                    kind: NodeKind::parse(&r.get::<_, String>(2)?),
                    file: r.get(3)?,
                    loc: r.get(4)?,
                    lang: r.get(5)?,
                    community: r.get(6)?,
                    community_name: r.get(7)?,
                    package: r.get(8)?,
                })
            })?;
            for row in rows {
                nodes.push(row?);
            }
        }
        let index: HashMap<&str, usize> = nodes
            .iter()
            .enumerate()
            .map(|(i, n)| (n.id.as_str(), i))
            .collect();
        let mut edges = Vec::new();
        {
            let mut stmt = db.conn().prepare(
                "SELECT src, dst, relation, confidence, score, file_path, loc, weight, context
                 FROM graph_edges WHERE source_id = ?1 ORDER BY pk",
            )?;
            let mut rows = stmt.query([source])?;
            while let Some(r) = rows.next()? {
                let (Some(&src), Some(&dst)) = (
                    index.get(r.get::<_, String>(0)?.as_str()),
                    index.get(r.get::<_, String>(1)?.as_str()),
                ) else {
                    continue;
                };
                edges.push(Edge {
                    src,
                    dst,
                    relation: r.get(2)?,
                    confidence: Confidence::parse(&r.get::<_, String>(3)?),
                    score: r.get::<_, Option<f64>>(4)?.unwrap_or(1.0),
                    file: r.get(5)?,
                    loc: r.get(6)?,
                    weight: r.get(7)?,
                    context: r.get(8)?,
                });
            }
        }
        drop(index);
        let meta = db.conn().query_row(
            "SELECT root, json_extract(meta_json, '$.built_at_commit') FROM sources WHERE id = ?1",
            [source],
            |r| {
                Ok(GraphMeta {
                    root: r.get(0)?,
                    built_at_commit: r.get(1)?,
                })
            },
        )?;
        let mut graph = Self::from_parts(nodes, edges);
        graph.meta = meta;
        Ok(graph)
    }

    /// Replace the graph of the source `label` (created when missing) with this graph, in one
    /// transaction. Returns the source id.
    ///
    /// # Errors
    ///
    /// Database failures; nothing is written on error.
    pub fn save(&self, db: &mut HomeDb, label: &str, root: Option<&str>) -> Result<i64> {
        let source = db.upsert_source("code-graph", label, root)?;
        let tx = db.conn_mut().transaction()?;
        tx.execute("DELETE FROM graph_edges WHERE source_id = ?1", [source])?;
        tx.execute("DELETE FROM graph_nodes WHERE source_id = ?1", [source])?;
        tx.execute(
            "DELETE FROM graph_communities WHERE source_id = ?1",
            [source],
        )?;
        {
            let mut node = tx.prepare(
                "INSERT INTO graph_nodes (source_id, node_id, label, kind, file_path, loc, lang, community, attrs_json)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, CASE WHEN ?9 IS NULL THEN '{}' ELSE json_object('package', ?9) END)",
            )?;
            for n in &self.nodes {
                node.execute(params![
                    source,
                    n.id,
                    n.label,
                    n.kind.as_str(),
                    n.file,
                    n.loc,
                    n.lang,
                    n.community,
                    n.package
                ])?;
            }
            let mut edge = tx.prepare(
                "INSERT INTO graph_edges
                    (source_id, src, dst, relation, confidence, score, file_path, loc, weight, context)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            )?;
            for e in &self.edges {
                edge.execute(params![
                    source,
                    self.nodes[e.src].id,
                    self.nodes[e.dst].id,
                    e.relation,
                    e.confidence.as_str(),
                    e.score,
                    e.file,
                    e.loc,
                    e.weight,
                    e.context
                ])?;
            }
            let mut sizes: std::collections::BTreeMap<i64, (Option<&str>, i64)> =
                Default::default();
            for n in &self.nodes {
                if let Some(c) = n.community {
                    let entry = sizes.entry(c).or_insert((None, 0));
                    entry.1 += 1;
                    if entry.0.is_none() {
                        entry.0 = n.community_name.as_deref();
                    }
                }
            }
            let mut community = tx.prepare(
                "INSERT INTO graph_communities (source_id, id, name, size) VALUES (?1, ?2, ?3, ?4)",
            )?;
            for (id, (name, size)) in sizes {
                community.execute(params![source, id, name, size])?;
            }
        }
        tx.commit()?;
        Ok(source)
    }
}

#[cfg(test)]
pub(crate) fn sample() -> Graph {
    // a -contains-> b, a -contains-> c, b -calls-> c (INFERRED), c -calls-> d, e isolated.
    let nodes = vec![
        Node::code("a", "RagStore", Some("store.rs")),
        Node::code("b", ".open()", Some("store.rs")),
        Node::code("c", ".upsert_doc()", Some("store.rs")),
        Node::code("d", "Connection", None),
        Node::code("e", "Lonely", Some("other.rs")),
    ];
    let mut call = Edge::extracted(1, 2, "calls");
    call.confidence = Confidence::Inferred;
    call.score = 0.8;
    let edges = vec![
        Edge::extracted(0, 1, "contains"),
        Edge::extracted(0, 2, "contains"),
        call,
        Edge::extracted(2, 3, "calls"),
    ];
    Graph::from_parts(nodes, edges)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn adjacency_and_degree() {
        let g = sample();
        assert_eq!(g.degree(0), 2);
        assert_eq!(g.degree(2), 3);
        assert_eq!(g.degree(4), 0);
        assert_eq!(g.index_of("c"), Some(2));
    }

    #[test]
    fn invalid_edges_and_duplicate_nodes_are_dropped() {
        let nodes = vec![Node::code("a", "A", None), Node::code("a", "dup", None)];
        let g = Graph::from_parts(nodes, vec![Edge::extracted(0, 5, "calls")]);
        assert_eq!((g.nodes.len(), g.edges.len()), (1, 0));
    }

    #[test]
    fn save_then_load_round_trips() {
        let mut db = HomeDb::open_in_memory().unwrap();
        let mut g = sample();
        g.nodes[0].community = Some(1);
        g.save(&mut db, "graph:test", Some("/repo")).unwrap();
        g.save(&mut db, "graph:test", Some("/repo")).unwrap(); // replace, not duplicate
        let loaded = Graph::load(&db, "graph:test").unwrap();
        assert_eq!(loaded.nodes.len(), 5);
        assert_eq!(loaded.edges.len(), 4);
        assert_eq!(loaded.edges[2].confidence, Confidence::Inferred);
        assert_eq!(loaded.nodes[0].community, Some(1));
        assert!(matches!(
            Graph::load(&db, "missing"),
            Err(GraphError::UnknownSource(_))
        ));
    }
}
