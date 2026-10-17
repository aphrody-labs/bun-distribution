// SPDX-License-Identifier: Apache-2.0
//! Markdown report of a graph (summary, provenance, confidence split, relations, languages,
//! packages and their dependencies, top files, god nodes, communities).

use std::{
    collections::{BTreeMap, HashMap},
    fmt::Write as _,
};

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
        if let Some(root) = &self.meta.root {
            let _ = writeln!(out, "- Root: {root}");
        }
        let _ = writeln!(
            out,
            "- Built at commit: {}",
            self.meta
                .built_at_commit
                .as_deref()
                .unwrap_or("unknown (not a Git checkout)")
        );
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
            let _ = writeln!(
                out,
                "- INFERRED average confidence: {:.2}",
                inferred_score.0 / inferred_score.1 as f64
            );
        }
        let _ = writeln!(out, "\n## Relations");
        let mut rel: Vec<_> = relations.into_iter().collect();
        rel.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(b.0)));
        for (name, n) in rel.iter().take(top) {
            let _ = writeln!(out, "- {name}: {n}");
        }
        self.write_languages_and_packages(&mut out, top);
        let _ = writeln!(out, "\n## Top files");
        for (file, symbols, degree) in self.top_files(top) {
            let _ = writeln!(out, "- {file}: {symbols} nodes, {degree} edges");
        }
        let _ = writeln!(out, "\n## God nodes");
        for (i, degree) in self.god_nodes(top) {
            let n = &self.nodes[i];
            let _ = writeln!(
                out,
                "- {} ({degree} edges){}",
                n.label,
                n.file
                    .as_ref()
                    .map_or_else(String::new, |f| format!(" - {f}"))
            );
        }
        let _ = writeln!(out, "\n## Communities");
        let mut comm: Vec<_> = sizes.into_iter().collect();
        comm.sort_by(|a, b| b.1.0.cmp(&a.1.0).then_with(|| a.0.cmp(&b.0)));
        for (id, (size, name)) in comm.iter().take(top) {
            let _ = writeln!(out, "- {id}: {} ({size} nodes)", name.unwrap_or("unnamed"));
        }
        out
    }

    /// Files ranked by the edges touching their nodes: `(file, nodes, edges)`.
    fn top_files(&self, top: usize) -> Vec<(&str, usize, usize)> {
        let mut files: HashMap<&str, (usize, usize)> = HashMap::new();
        for (i, n) in self.nodes.iter().enumerate() {
            if let Some(file) = n.file.as_deref() {
                let entry = files.entry(file).or_default();
                entry.0 += 1;
                entry.1 += self.degree(i);
            }
        }
        let mut ranked: Vec<(&str, usize, usize)> =
            files.into_iter().map(|(f, (n, d))| (f, n, d)).collect();
        ranked.sort_by(|a, b| {
            b.2.cmp(&a.2)
                .then_with(|| b.1.cmp(&a.1))
                .then_with(|| a.0.cmp(b.0))
        });
        ranked.truncate(top);
        ranked
    }

    fn write_languages_and_packages(&self, out: &mut String, top: usize) {
        let mut languages: BTreeMap<&str, (usize, usize)> = BTreeMap::new();
        let mut packages: BTreeMap<&str, (usize, usize)> = BTreeMap::new();
        let mut files_seen: std::collections::HashSet<&str> = std::collections::HashSet::new();
        for n in &self.nodes {
            let Some(file) = n.file.as_deref() else {
                continue;
            };
            let new_file = usize::from(files_seen.insert(file));
            if let Some(lang) = n.lang.as_deref() {
                let entry = languages.entry(lang).or_default();
                entry.0 += new_file;
                entry.1 += 1;
            }
            if let Some(package) = n.package.as_deref() {
                let entry = packages.entry(package).or_default();
                entry.0 += new_file;
                entry.1 += 1;
            }
        }
        if !languages.is_empty() {
            let _ = writeln!(out, "\n## Languages");
            for (lang, (files, nodes)) in &languages {
                let _ = writeln!(out, "- {lang}: {files} files, {nodes} nodes");
            }
        }
        if packages.is_empty() {
            return;
        }
        let _ = writeln!(out, "\n## Packages ({})", packages.len());
        let mut ranked: Vec<_> = packages.into_iter().collect();
        ranked.sort_by(|a, b| b.1.1.cmp(&a.1.1).then_with(|| a.0.cmp(b.0)));
        for (package, (files, nodes)) in ranked.iter().take(top) {
            let _ = writeln!(out, "- {package}: {files} files, {nodes} nodes");
        }
        let mut deps: BTreeMap<(&str, &str), usize> = BTreeMap::new();
        for e in &self.edges {
            if !matches!(
                e.relation.as_str(),
                "calls" | "imports" | "imports_from" | "references"
            ) {
                continue;
            }
            if let (Some(a), Some(b)) = (
                self.nodes[e.src].package.as_deref(),
                self.nodes[e.dst].package.as_deref(),
            ) && a != b
            {
                *deps.entry((a, b)).or_insert(0) += 1;
            }
        }
        if deps.is_empty() {
            return;
        }
        let _ = writeln!(out, "\n## Package dependencies ({} pairs)", deps.len());
        let mut ranked: Vec<_> = deps.into_iter().collect();
        ranked.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(&b.0)));
        for ((from, to), n) in ranked.iter().take(top) {
            let _ = writeln!(out, "- {from} -> {to}: {n} edges");
        }
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
        assert!(r.contains("Built at commit: unknown"));
        assert!(
            r.contains("## Top files\n- store.rs: 3 nodes, 7 edges"),
            "{r}"
        );
    }

    #[test]
    fn packages_and_their_dependencies_are_listed() {
        let mut g = sample();
        for (i, package) in [(0, "rag"), (1, "rag"), (2, "rag"), (4, "other")] {
            g.nodes[i].package = Some(package.into());
        }
        g.nodes[3].package = Some("sql".into());
        g.nodes[3].file = Some("sql.rs".into());
        g.meta.built_at_commit = Some("abc123".into());
        let r = g.report("sample", 5);
        assert!(r.contains("Built at commit: abc123"));
        assert!(
            r.contains("## Packages (3)\n- rag: 1 files, 3 nodes"),
            "{r}"
        );
        assert!(r.contains("- rag -> sql: 1 edges"), "{r}");
    }
}
