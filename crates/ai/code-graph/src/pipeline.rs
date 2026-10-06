// SPDX-License-Identifier: Apache-2.0
//! Incremental code-graph build over the home database.
//!
//! scan (store, BLAKE3, deny list) -> extract (tree-sitter, only files without a valid cache
//! row) -> assemble (call resolution, stub folding, communities) -> save. The per-file raw
//! extraction is cached by content hash, so a second run with no change parses nothing and
//! rewrites an identical graph, and an interrupted run resumes at the files still missing a
//! cache row.

use std::path::Path;

use aphrody_store::{
    HomeDb,
    files::Stage,
    scan::{ScanOptions, ScanOutcome, scan_tree},
};
use rusqlite::params;
use serde::{Deserialize, Serialize};

use crate::{
    error::Result,
    extract::{FileExtract, Language, extract_file, resolve::{AssembleStats, assemble}},
    graph::Graph,
};

/// Counters of one build.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct BuildReport {
    /// Scan counters.
    pub scan: ScanOutcome,
    /// Files parsed in this run.
    pub extracted: usize,
    /// Files served from the cache.
    pub cached: usize,
    /// Files with a parse problem.
    pub errors: usize,
    /// Assembly counters.
    pub assemble: AssembleStats,
    /// Nodes of the saved graph.
    pub nodes: usize,
    /// Edges of the saved graph.
    pub edges: usize,
    /// Modularity of the detected communities.
    pub modularity: f64,
}

/// Build (or refresh) the graph of the tree at `root` into the source `label`.
///
/// # Errors
///
/// Database failures; unparsable files are counted, not fatal.
pub fn build_graph(db: &mut HomeDb, label: &str, root: &Path, options: &ScanOptions) -> Result<(Graph, BuildReport)> {
    let source = db.upsert_source("code-graph", label, Some(&root.to_string_lossy()))?;
    let run = db.begin_run(Some(source), "graph")?;
    let result = build_inner(db, source, label, root, options);
    match &result {
        Ok((_, report)) => db.finish_run(run, aphrody_store::RunStatus::Succeeded, &serde_json::to_value(report)?, None)?,
        Err(error) => db.finish_run(run, aphrody_store::RunStatus::Failed, &serde_json::json!({}), Some(&error.to_string()))?,
    }
    result
}

fn build_inner(
    db: &mut HomeDb,
    source: i64,
    label: &str,
    root: &Path,
    options: &ScanOptions,
) -> Result<(Graph, BuildReport)> {
    let mut report = BuildReport { scan: scan_tree(db, source, root, options)?, ..BuildReport::default() };

    // Drop cache rows of files that are gone or whose hash changed.
    db.conn().execute(
        "DELETE FROM graph_file_cache WHERE source_id = ?1 AND NOT EXISTS (
             SELECT 1 FROM files f WHERE f.source_id = graph_file_cache.source_id
               AND f.rel_path = graph_file_cache.rel_path AND f.blake3 = graph_file_cache.blake3)",
        [source],
    )?;

    let wanted: Vec<(String, String)> = db
        .stored_files(source)?
        .into_iter()
        .filter(|(path, (_, _, _, class, _))| class == "code" && Language::of_path(path).is_some())
        .map(|(path, (hash, ..))| (path, hash))
        .collect();
    let mut todo: Vec<(String, String)> = Vec::new();
    for (rel_path, blake3) in wanted {
        let cached: bool = db.conn().query_row(
            "SELECT count(*) > 0 FROM graph_file_cache WHERE source_id = ?1 AND rel_path = ?2 AND blake3 = ?3",
            params![source, rel_path, blake3],
            |r| r.get(0),
        )?;
        if !cached {
            todo.push((rel_path, blake3));
        }
    }
    for (rel_path, blake3) in todo {
        let Ok(bytes) = std::fs::read(root.join(&rel_path)) else {
            report.errors += 1;
            continue;
        };
        let extract = extract_file(&rel_path, &bytes);
        if extract.error.is_some() {
            report.errors += 1;
        }
        db.conn().execute(
            "INSERT OR REPLACE INTO graph_file_cache (source_id, rel_path, blake3, extract_json)
             VALUES (?1, ?2, ?3, ?4)",
            params![source, rel_path, blake3, serde_json::to_string(&extract)?],
        )?;
        db.complete_stage(source, &rel_path, &blake3, Stage::Extract)?;
        report.extracted += 1;
    }

    let mut files: Vec<FileExtract> = Vec::new();
    {
        let mut statement = db
            .conn()
            .prepare("SELECT extract_json FROM graph_file_cache WHERE source_id = ?1 ORDER BY rel_path")?;
        let rows = statement.query_map([source], |r| r.get::<_, String>(0))?;
        for row in rows {
            files.push(serde_json::from_str(&row?)?);
        }
    }
    report.cached = files.len().saturating_sub(report.extracted);
    let (mut graph, stats) = assemble(files);
    report.assemble = stats;
    report.modularity = graph.detect_communities();
    report.nodes = graph.nodes.len();
    report.edges = graph.edges.len();
    graph.save(db, label, Some(&root.to_string_lossy()))?;
    Ok((graph, report))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn repo() -> tempfile::TempDir {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(dir.path().join("src")).unwrap();
        std::fs::write(dir.path().join("src/a.rs"), "pub struct Thing;\nfn run() { helper(); }\nfn helper() {}\n").unwrap();
        std::fs::write(dir.path().join("src/b.rs"), "fn use_it(t: Thing) { remote(); }\n").unwrap();
        std::fs::write(dir.path().join("src/c.rs"), "pub fn remote() {}\n").unwrap();
        std::fs::write(dir.path().join("README.md"), "# not code").unwrap();
        dir
    }

    #[test]
    fn the_first_build_extracts_everything_and_the_second_parses_nothing() {
        let dir = repo();
        let mut db = HomeDb::open_in_memory().unwrap();
        let (g1, r1) = build_graph(&mut db, "graph:t", dir.path(), &ScanOptions::default()).unwrap();
        assert_eq!(r1.extracted, 3);
        assert!(g1.nodes.iter().any(|n| n.label == "run()"));
        assert!(g1.edges.iter().any(|e| e.relation == "calls" && g1.nodes[e.dst].label == "remote()"));
        let (g2, r2) = build_graph(&mut db, "graph:t", dir.path(), &ScanOptions::default()).unwrap();
        assert_eq!((r2.extracted, r2.cached), (0, 3));
        assert_eq!((g1.nodes.len(), g1.edges.len()), (g2.nodes.len(), g2.edges.len()));
        let stored: i64 = db.conn().query_row("SELECT count(*) FROM graph_nodes", [], |r| r.get(0)).unwrap();
        assert_eq!(stored as usize, g2.nodes.len());
        assert_eq!(db.last_run("graph").unwrap().unwrap().status, aphrody_store::RunStatus::Succeeded);
    }

    #[test]
    fn only_changed_files_are_parsed_again() {
        let dir = repo();
        let mut db = HomeDb::open_in_memory().unwrap();
        build_graph(&mut db, "graph:t", dir.path(), &ScanOptions::default()).unwrap();
        std::fs::write(dir.path().join("src/c.rs"), "pub fn remote() {}\npub fn extra() {}\n").unwrap();
        let (g, r) = build_graph(&mut db, "graph:t", dir.path(), &ScanOptions::default()).unwrap();
        assert_eq!(r.extracted, 1);
        assert_eq!(r.cached, 2);
        assert!(g.nodes.iter().any(|n| n.label == "extra()"));
        std::fs::remove_file(dir.path().join("src/c.rs")).unwrap();
        let (g, _) = build_graph(&mut db, "graph:t", dir.path(), &ScanOptions::default()).unwrap();
        assert!(!g.nodes.iter().any(|n| n.label == "remote()"));
    }

    #[test]
    fn a_resumed_build_parses_only_files_missing_a_cache_row() {
        let dir = repo();
        let mut db = HomeDb::open_in_memory().unwrap();
        build_graph(&mut db, "graph:t", dir.path(), &ScanOptions::default()).unwrap();
        db.conn().execute("DELETE FROM graph_file_cache WHERE rel_path = 'src/b.rs'", []).unwrap();
        let (_, r) = build_graph(&mut db, "graph:t", dir.path(), &ScanOptions::default()).unwrap();
        assert_eq!(r.extracted, 1);
    }
}
