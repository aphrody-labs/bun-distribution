// SPDX-License-Identifier: Apache-2.0
//! Graphify-compatible `graph.json` writer (streamed: nothing but one element is ever
//! serialised at a time).

use std::io::Write;

use serde_json::json;

use crate::{error::Result, graph::Graph};

impl Graph {
    /// Write the graph as `graph.json` (`directed`, `multigraph`, `graph`, `nodes`, `links`,
    /// `hyperedges`, `built_at_commit`).
    ///
    /// # Errors
    ///
    /// I/O or JSON failures.
    pub fn write_graph_json(&self, mut w: impl Write, built_at_commit: Option<&str>) -> Result<()> {
        let io = |e: std::io::Error| crate::error::GraphError::Json(serde_json::Error::io(e));
        w.write_all(b"{\"directed\":true,\"multigraph\":true,\"graph\":{},\"nodes\":[").map_err(io)?;
        for (i, n) in self.nodes.iter().enumerate() {
            if i > 0 {
                w.write_all(b",").map_err(io)?;
            }
            let value = json!({
                "id": n.id,
                "label": n.label,
                "norm_label": n.norm_label,
                "file_type": n.kind.as_str(),
                "source_file": n.file,
                "source_location": n.loc,
                "community": n.community,
                "community_name": n.community_name,
            });
            serde_json::to_writer(&mut w, &value)?;
        }
        w.write_all(b"],\"links\":[").map_err(io)?;
        for (i, e) in self.edges.iter().enumerate() {
            if i > 0 {
                w.write_all(b",").map_err(io)?;
            }
            let value = json!({
                "source": self.nodes[e.src].id,
                "target": self.nodes[e.dst].id,
                "relation": e.relation,
                "confidence": e.confidence.as_str(),
                "confidence_score": e.score,
                "context": e.context,
                "source_file": e.file,
                "source_location": e.loc,
                "weight": e.weight,
            });
            serde_json::to_writer(&mut w, &value)?;
        }
        w.write_all(b"],\"hyperedges\":[],\"built_at_commit\":").map_err(io)?;
        serde_json::to_writer(&mut w, &built_at_commit)?;
        w.write_all(b"}").map_err(io)?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use aphrody_store::{HomeDb, import::graphify::import_graph_json};

    use crate::graph::{Graph, sample};

    #[test]
    fn exported_json_is_valid_and_imports_back_with_the_same_counts() {
        let mut buffer = Vec::new();
        sample().write_graph_json(&mut buffer, Some("abc")).unwrap();
        let value: serde_json::Value = serde_json::from_slice(&buffer).unwrap();
        assert_eq!(value["nodes"].as_array().unwrap().len(), 5);
        assert_eq!(value["links"].as_array().unwrap().len(), 4);
        assert_eq!(value["built_at_commit"], "abc");

        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("graph.json");
        std::fs::write(&path, &buffer).unwrap();
        let mut db = HomeDb::open_in_memory().unwrap();
        let report = import_graph_json(&mut db, &path, "graph:rt", None, true).unwrap();
        assert_eq!((report.counts["nodes"], report.counts["edges"]), (5, 4));
        let loaded = Graph::load(&db, "graph:rt").unwrap();
        assert_eq!(loaded.nodes.len(), 5);
        assert_eq!(loaded.edges.len(), 4);
        assert_eq!(loaded.edges[2].confidence, crate::graph::Confidence::Inferred);
    }
}
