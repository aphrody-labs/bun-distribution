// SPDX-License-Identifier: Apache-2.0
//! Markdown report of a graph (summary, confidence split, relations, god nodes, communities).

use std::{collections::BTreeMap, fmt::Write as _};

use crate::graph::{Confidence, Graph};

impl Graph {
    /// Render `GRAPH_REPORT.md` for this graph.
    #[must_use]
    pub fn report(&self, name: &str, top: usize) -> String {
        let total = self.edges.len().max(1);
        let mut confidence: BTreeMap<&str, usize> = BTreeMap::new();
        let mut relations: BTreeMap<&str, usize> = BTreeMap::new();
        let mut inferred_score = (0.0_f64, 0_usize);
        for edge in &self.edges {
            *confidence.entry(edge.confidence.as_str()).or_insert(0) += 1;
            *relations.entry(edge.relation.as_str()).or_insert(0) += 1;
            if edge.confidence == Confidence::Inferred {
                inferred_score.0 += edge.score;
                inferred_score.1 += 1;
            }
        }
        let mut sizes: BTreeMap<i64, (usize, Option<&str>)> = BTreeMap::new();
        for node in &self.nodes {
            if let Some(c) = node.community {
                let entry = sizes.entry(c).or_insert((0, None));
                entry.0 += 1;
                entry.1 = entry.1.or(node.community_name.as_deref());
            }
        }
        let mut out = String::new();
        let _ = writeln!(out, "# Graph Report - {name}\n");
        let _ = writeln!(out, "## Summary");
        let _ = writeln!(
            out,
            "- {} nodes, {} edges, {} communities",
            self.nodes.len(),
            self.edges.len(),
            sizes.len()
        );
        let share = |label: &str| confidence.get(label).copied().unwrap_or(0) * 100 / total;
        let _ = writeln!(
            out,
            "- Extraction: {} % EXTRACTED, {} % INFERRED, {} % AMBIGUOUS",
            share("EXTRACTED"),
            share("INFERRED"),
            share("AMBIGUOUS")
        );
        if inferred_score.1 > 0 {
            let _ = writeln!(out, "- INFERRED average confidence: {:.2}", inferred_score.0 / inferred_score.1 as f64);
        }
        let _ = writeln!(out, "\n## Relations");
        let mut rel: Vec<_> = relations.into_iter().collect();
        rel.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(b.0)));
        for (name, n) in rel.iter().take(top) {
            let _ = writeln!(out, "- {name}: {n}");
        }
        let _ = writeln!(out, "\n## God nodes");
        for (i, degree) in self.god_nodes(top) {
            let n = &self.nodes[i];
            let _ = writeln!(out, "- {} ({degree} edges){}", n.label, n.file.as_ref().map_or_else(String::new, |f| format!(" - {f}")));
        }
        let _ = writeln!(out, "\n## Communities");
        let mut comm: Vec<_> = sizes.into_iter().collect();
        comm.sort_by(|a, b| b.1.0.cmp(&a.1.0).then_with(|| a.0.cmp(&b.0)));
        for (id, (size, name)) in comm.iter().take(top) {
            let _ = writeln!(out, "- {id}: {} ({size} nodes)", name.unwrap_or("unnamed"));
        }
        out
    }
}

#[cfg(test)]
mod tests {
    use crate::graph::sample;

    #[test]
    fn the_report_summarises_counts_confidence_and_hubs() {
        let mut g = sample();
        g.detect_communities();
        let r = g.report("sample", 5);
        assert!(r.contains("# Graph Report - sample"));
        assert!(r.contains("5 nodes, 4 edges"));
        assert!(r.contains("75 % EXTRACTED, 25 % INFERRED"));
        assert!(r.contains("INFERRED average confidence: 0.80"));
        assert!(r.contains("- .upsert_doc() (3 edges)"));
        assert!(r.contains("- calls: 2"));
    }
}
