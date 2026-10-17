// SPDX-License-Identifier: Apache-2.0
//! Importer and exporter of the Graphify `graph.json` contract (`directed`, `multigraph`,
//! `graph`, `nodes`, `links`, `hyperedges`, `built_at_commit`).
//!
//! The file is **streamed** (a repository graph is over 100 MB): nodes and edges are handed to a
//! sink one at a time and never held together in memory. Offline and deterministic: no model
//! and no network are involved. The native extractor (`aphrody-code-graph`) writes the same
//! tables; this importer is also the bridge used as the parity oracle.

use std::{cell::RefCell, collections::BTreeMap, fmt, io::Read, path::Path};

use rusqlite::params;
use serde::{
    Deserialize,
    de::{self, DeserializeSeed, IgnoredAny, MapAccess, SeqAccess, Visitor},
};

use super::ImportReport;
use crate::{
    db::HomeDb,
    error::{Result, StoreError},
};

/// A node of the `graph.json` contract (extra keys are kept in `extra`).
#[derive(Debug, Clone, Deserialize)]
pub struct RawNode {
    /// Stable node id.
    pub id: String,
    /// Display label.
    #[serde(default)]
    pub label: String,
    /// `code`, `document`, `concept` or `rationale`.
    #[serde(default)]
    pub file_type: Option<String>,
    /// Source file.
    #[serde(default)]
    pub source_file: Option<String>,
    /// Location in the file (`L66`).
    #[serde(default)]
    pub source_location: Option<String>,
    /// Community id.
    #[serde(default)]
    pub community: Option<i64>,
    /// Community name.
    #[serde(default)]
    pub community_name: Option<String>,
    /// Every other key.
    #[serde(flatten)]
    pub extra: serde_json::Map<String, serde_json::Value>,
}

/// An edge (`links` entry) of the contract.
#[derive(Debug, Clone, Deserialize)]
pub struct RawEdge {
    /// Source node id.
    pub source: String,
    /// Target node id.
    pub target: String,
    /// Relation (`calls`, `contains`, `imports_from`...).
    #[serde(default)]
    pub relation: String,
    /// `EXTRACTED`, `INFERRED` or `AMBIGUOUS`.
    #[serde(default)]
    pub confidence: Option<String>,
    /// Confidence score in `[0, 1]`.
    #[serde(default)]
    pub confidence_score: Option<f64>,
    /// Call context.
    #[serde(default)]
    pub context: Option<String>,
    /// File of the reference.
    #[serde(default)]
    pub source_file: Option<String>,
    /// Location of the reference.
    #[serde(default)]
    pub source_location: Option<String>,
    /// Edge weight.
    #[serde(default)]
    pub weight: Option<f64>,
}

/// One streamed item.
#[derive(Debug)]
pub enum GraphItem {
    /// A node.
    Node(RawNode),
    /// An edge.
    Edge(RawEdge),
    /// The commit the graph was built from.
    BuiltAtCommit(String),
}

type Sink<'a> = RefCell<&'a mut dyn FnMut(GraphItem) -> Result<()>>;

struct SeqSeed<'a, T> {
    sink: &'a Sink<'a>,
    wrap: fn(T) -> GraphItem,
    failure: &'a RefCell<Option<StoreError>>,
}

impl<'de, T: Deserialize<'de>> DeserializeSeed<'de> for SeqSeed<'_, T> {
    type Value = ();

    fn deserialize<D: de::Deserializer<'de>>(self, d: D) -> std::result::Result<(), D::Error> {
        struct V<'a, T>(SeqSeed<'a, T>);
        impl<'de, T: Deserialize<'de>> Visitor<'de> for V<'_, T> {
            type Value = ();
            fn expecting(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
                f.write_str("an array")
            }
            fn visit_seq<A: SeqAccess<'de>>(self, mut seq: A) -> std::result::Result<(), A::Error> {
                while let Some(item) = seq.next_element::<T>()? {
                    let result = (self.0.sink.borrow_mut())((self.0.wrap)(item));
                    if let Err(error) = result {
                        *self.0.failure.borrow_mut() = Some(error);
                        return Err(de::Error::custom("sink aborted"));
                    }
                }
                Ok(())
            }
        }
        d.deserialize_seq(V(self))
    }
}

struct TopVisitor<'a> {
    sink: &'a Sink<'a>,
    failure: &'a RefCell<Option<StoreError>>,
}

impl<'de> Visitor<'de> for TopVisitor<'_> {
    type Value = ();

    fn expecting(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("a graph.json object")
    }

    fn visit_map<A: MapAccess<'de>>(self, mut map: A) -> std::result::Result<(), A::Error> {
        while let Some(key) = map.next_key::<String>()? {
            match key.as_str() {
                "nodes" => map.next_value_seed(SeqSeed::<RawNode> {
                    sink: self.sink,
                    wrap: GraphItem::Node,
                    failure: self.failure,
                })?,
                "links" | "edges" => map.next_value_seed(SeqSeed::<RawEdge> {
                    sink: self.sink,
                    wrap: GraphItem::Edge,
                    failure: self.failure,
                })?,
                "built_at_commit" => {
                    if let Some(commit) = map.next_value::<Option<String>>()? {
                        let result = (self.sink.borrow_mut())(GraphItem::BuiltAtCommit(commit));
                        if let Err(error) = result {
                            *self.failure.borrow_mut() = Some(error);
                            return Err(de::Error::custom("sink aborted"));
                        }
                    }
                }
                _ => {
                    map.next_value::<IgnoredAny>()?;
                }
            }
        }
        Ok(())
    }
}

/// Stream a `graph.json` document to `sink`.
///
/// # Errors
///
/// [`StoreError::Json`] for malformed input, or the first error returned by `sink`.
pub fn stream_graph_json(
    reader: impl Read,
    mut sink: impl FnMut(GraphItem) -> Result<()>,
) -> Result<()> {
    let sink_ref: Sink<'_> = RefCell::new(&mut sink);
    let failure = RefCell::new(None);
    let mut de =
        serde_json::Deserializer::from_reader(std::io::BufReader::with_capacity(1 << 20, reader));
    let result = de::Deserializer::deserialize_map(
        &mut de,
        TopVisitor {
            sink: &sink_ref,
            failure: &failure,
        },
    );
    if let Some(error) = failure.into_inner() {
        return Err(error);
    }
    result?;
    Ok(())
}

fn lang_of(path: Option<&str>) -> Option<&'static str> {
    let ext = path?.rsplit_once('.')?.1.to_ascii_lowercase();
    Some(match ext.as_str() {
        "rs" => "rust",
        "ts" | "tsx" | "mts" | "cts" => "typescript",
        "js" | "jsx" | "mjs" | "cjs" => "javascript",
        "py" | "pyi" => "python",
        "go" => "go",
        "java" => "java",
        "c" | "h" => "c",
        "cc" | "cpp" | "cxx" | "hpp" => "cpp",
        "cs" => "csharp",
        "rb" => "ruby",
        "php" => "php",
        "sh" | "bash" => "bash",
        "md" | "mdx" => "markdown",
        "toml" => "toml",
        "json" => "json",
        "sql" => "sql",
        _ => return None,
    })
}

fn node_kind(raw: Option<&str>) -> &'static str {
    match raw {
        Some("code") => "code",
        Some("concept") => "concept",
        Some("rationale") => "rationale",
        _ => "document",
    }
}

fn confidence(raw: Option<&str>) -> &'static str {
    match raw {
        Some("EXTRACTED") => "EXTRACTED",
        Some("INFERRED") => "INFERRED",
        _ => "AMBIGUOUS",
    }
}

/// Import (or count, when `apply` is false) a `graph.json` into the graph tables of the source
/// `label`. A re-import replaces that source's graph rows (derived data) in one transaction.
///
/// # Errors
///
/// I/O, JSON or SQLite failures; nothing is written on error.
pub fn import_graph_json(
    db: &mut HomeDb,
    graph_json: &Path,
    label: &str,
    root: Option<&str>,
    apply: bool,
) -> Result<ImportReport> {
    let mut report = ImportReport::new("graphify", !apply);
    let file = std::fs::File::open(graph_json)?;
    let source_id = if apply {
        Some(db.upsert_source("graphify", label, root)?)
    } else {
        None
    };

    let tx = db.conn.transaction()?;
    if let Some(id) = source_id {
        tx.execute("DELETE FROM graph_edges WHERE source_id = ?1", [id])?;
        tx.execute("DELETE FROM graph_nodes WHERE source_id = ?1", [id])?;
        tx.execute("DELETE FROM graph_communities WHERE source_id = ?1", [id])?;
    }
    let mut communities: BTreeMap<i64, (Option<String>, u64)> = BTreeMap::new();
    let mut relations: BTreeMap<String, u64> = BTreeMap::new();
    let mut commit: Option<String> = None;
    {
        let mut node_stmt = tx.prepare(
            "INSERT OR IGNORE INTO graph_nodes
                (source_id, node_id, label, kind, file_path, loc, lang, community, attrs_json)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        )?;
        let mut edge_stmt = tx.prepare(
            "INSERT INTO graph_edges
                (source_id, src, dst, relation, confidence, score, file_path, loc, weight, context)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
        )?;
        stream_graph_json(file, |item| {
            match item {
                GraphItem::Node(n) => {
                    report.add("nodes", 1);
                    report.add(
                        &format!("node_kind:{}", node_kind(n.file_type.as_deref())),
                        1,
                    );
                    if let Some(c) = n.community {
                        let entry = communities.entry(c).or_insert((None, 0));
                        entry.1 += 1;
                        if entry.0.is_none() {
                            entry.0.clone_from(&n.community_name);
                        }
                    }
                    if let Some(id) = source_id {
                        let mut attrs = n.extra;
                        attrs.retain(|k, _| !matches!(k.as_str(), "norm_label"));
                        node_stmt.execute(params![
                            id,
                            n.id,
                            n.label,
                            node_kind(n.file_type.as_deref()),
                            n.source_file,
                            n.source_location,
                            lang_of(n.source_file.as_deref()),
                            n.community,
                            serde_json::to_string(&attrs)?
                        ])?;
                    }
                }
                GraphItem::Edge(e) => {
                    report.add("edges", 1);
                    report.add(
                        &format!("confidence:{}", confidence(e.confidence.as_deref())),
                        1,
                    );
                    *relations.entry(e.relation.clone()).or_insert(0) += 1;
                    if let Some(id) = source_id {
                        edge_stmt.execute(params![
                            id,
                            e.source,
                            e.target,
                            e.relation,
                            confidence(e.confidence.as_deref()),
                            e.confidence_score,
                            e.source_file,
                            e.source_location,
                            e.weight.unwrap_or(1.0),
                            e.context
                        ])?;
                    }
                }
                GraphItem::BuiltAtCommit(c) => commit = Some(c),
            }
            Ok(())
        })?;
    }
    if let Some(id) = source_id {
        let mut insert = tx.prepare(
            "INSERT INTO graph_communities (source_id, id, name, size) VALUES (?1, ?2, ?3, ?4)",
        )?;
        for (cid, (name, size)) in &communities {
            insert.execute(params![
                id,
                cid,
                name,
                i64::try_from(*size).unwrap_or(i64::MAX)
            ])?;
        }
        drop(insert);
        if let Some(c) = &commit {
            tx.execute(
                "UPDATE sources SET meta_json = json_set(meta_json, '$.built_at_commit', ?2)
                 WHERE id = ?1",
                params![id, c],
            )?;
        }
    }
    report.add("communities", communities.len() as u64);
    for (relation, n) in relations {
        report.add(&format!("relation:{relation}"), n);
    }
    if let Some(c) = commit {
        report.notes.push(format!("built_at_commit {c}"));
    }
    if apply {
        tx.commit()?;
    }
    Ok(report)
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE: &str = r#"{
      "directed": true, "multigraph": true, "graph": {}, "hyperedges": [],
      "built_at_commit": "abc123",
      "nodes": [
        {"id":"a","label":"RagStore","file_type":"code","source_file":"crates/ai/rag/src/store.rs","source_location":"L132","community":1,"community_name":"RagStore","norm_label":"ragstore","_origin":"ast"},
        {"id":"b","label":"open()","file_type":"code","source_file":"crates/ai/rag/src/store.rs","source_location":"L141","community":1,"community_name":"RagStore"},
        {"id":"c","label":"README","file_type":"document","source_file":"README.md","community":2}
      ],
      "links": [
        {"source":"a","target":"b","relation":"method","confidence":"EXTRACTED","confidence_score":1.0,"source_file":"crates/ai/rag/src/store.rs","source_location":"L141","weight":1},
        {"source":"b","target":"c","relation":"references","confidence":"INFERRED","confidence_score":0.8,"context":"call"}
      ]
    }"#;

    fn write_sample() -> (tempfile::TempDir, std::path::PathBuf) {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("graph.json");
        std::fs::write(&path, SAMPLE).unwrap();
        (dir, path)
    }

    #[test]
    fn dry_run_counts_the_contract_without_writing() {
        let (_dir, path) = write_sample();
        let mut db = HomeDb::open_in_memory().unwrap();
        let report = import_graph_json(&mut db, &path, "graph:test", None, false).unwrap();
        assert_eq!(report.counts["nodes"], 3);
        assert_eq!(report.counts["edges"], 2);
        assert_eq!(report.counts["communities"], 2);
        assert_eq!(report.counts["confidence:INFERRED"], 1);
        assert_eq!(report.counts["relation:method"], 1);
        let rows: i64 = db
            .conn()
            .query_row("SELECT count(*) FROM graph_nodes", [], |r| r.get(0))
            .unwrap();
        assert_eq!(rows, 0);
        assert!(db.source_id("graph:test").unwrap().is_none());
    }

    #[test]
    fn apply_populates_tables_and_a_reimport_replaces_instead_of_duplicating() {
        let (_dir, path) = write_sample();
        let mut db = HomeDb::open_in_memory().unwrap();
        import_graph_json(&mut db, &path, "graph:test", Some("/repo"), true).unwrap();
        import_graph_json(&mut db, &path, "graph:test", Some("/repo"), true).unwrap();
        let q = |sql: &str| -> i64 { db.conn().query_row(sql, [], |r| r.get(0)).unwrap() };
        assert_eq!(q("SELECT count(*) FROM graph_nodes"), 3);
        assert_eq!(q("SELECT count(*) FROM graph_edges"), 2);
        assert_eq!(q("SELECT count(*) FROM graph_communities"), 2);
        assert_eq!(q("SELECT count(*) FROM graph_nodes WHERE lang = 'rust'"), 2);
        assert_eq!(
            q("SELECT count(*) FROM graph_nodes_fts WHERE graph_nodes_fts MATCH 'RagStore'"),
            1
        );
        let meta: String = db
            .conn()
            .query_row(
                "SELECT meta_json FROM sources WHERE label = 'graph:test'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert!(meta.contains("abc123"));
    }

    #[test]
    fn malformed_input_fails_without_partial_writes() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("bad.json");
        std::fs::write(&path, r#"{"nodes":[{"id":"a"},{"id":}"#).unwrap();
        let mut db = HomeDb::open_in_memory().unwrap();
        assert!(import_graph_json(&mut db, &path, "graph:bad", None, true).is_err());
        let rows: i64 = db
            .conn()
            .query_row("SELECT count(*) FROM graph_nodes", [], |r| r.get(0))
            .unwrap();
        assert_eq!(rows, 0);
    }
}
