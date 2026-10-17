// SPDX-License-Identifier: Apache-2.0
//! Incremental code-graph build over the home database.
//!
//! scan (store, BLAKE3, deny list) -> extract (tree-sitter, only files without a valid cache
//! row) -> assemble (call resolution, stub folding, communities) -> save. The per-file raw
//! extraction is cached by content hash, so a second run with no change parses nothing and
//! rewrites an identical graph, and an interrupted run resumes at the files still missing a
//! cache row.

use aphrody_proc::NoWindow as _;
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
};

use aphrody_store::{
    HomeDb,
    files::Stage,
    scan::{ScanOptions, ScanOutcome, scan_tree},
};
use rusqlite::params;
use serde::{Deserialize, Serialize};

use crate::{
    error::Result,
    extract::{
        EXTRACT_VERSION, FileExtract, Language, extract_file,
        resolve::{AssembleContext, AssembleStats, assemble_with},
    },
    graph::{Graph, GraphMeta},
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
    /// `HEAD` of the tree when it is a Git checkout.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub built_at_commit: Option<String>,
}

/// Absolute form of `root` without the Windows verbatim prefix, so the stored root is usable.
#[must_use]
pub fn absolute_root(root: &Path) -> PathBuf {
    let absolute = std::fs::canonicalize(root).unwrap_or_else(|_| root.to_path_buf());
    let text = absolute.to_string_lossy();
    if let Some(rest) = text.strip_prefix(r"\\?\UNC\") {
        return PathBuf::from(format!(r"\\{rest}"));
    }
    text.strip_prefix(r"\\?\")
        .map_or_else(|| absolute.clone(), PathBuf::from)
}

/// `git rev-parse HEAD` of `root`, when it is a Git checkout.
#[must_use]
pub fn head_commit(root: &Path) -> Option<String> {
    let out = std::process::Command::new("git")
        .no_window()
        .arg("-C")
        .arg(root)
        .args(["rev-parse", "HEAD"])
        .stderr(std::process::Stdio::null())
        .output()
        .ok()?;
    let sha = String::from_utf8(out.stdout).ok()?.trim().to_owned();
    (out.status.success() && sha.len() >= 40).then_some(sha)
}

/// Value of `key = "value"` inside the `[section]` of a TOML manifest (enough for Cargo
/// `[package] name` and `[lib] name`).
fn toml_key(manifest: &str, section: &str, key: &str) -> Option<String> {
    let mut inside = false;
    for line in manifest.lines() {
        let line = line.trim();
        if line.starts_with('[') {
            inside = line == format!("[{section}]");
            continue;
        }
        if inside
            && let Some((k, v)) = line.split_once('=')
            && k.trim() == key
        {
            let v = v.trim();
            if let Some(v) = v.strip_prefix('"').and_then(|v| v.split('"').next()) {
                return Some(v.to_owned());
            }
        }
    }
    None
}

/// Package declared by the manifest of `dir`: the Rust crate identifier, else the npm name.
fn manifest_package(dir: &Path) -> Option<String> {
    if let Ok(cargo) = std::fs::read_to_string(dir.join("Cargo.toml")) {
        if let Some(lib) = toml_key(&cargo, "lib", "name") {
            return Some(lib);
        }
        if let Some(name) = toml_key(&cargo, "package", "name") {
            return Some(name.replace('-', "_"));
        }
    }
    let json = std::fs::read_to_string(dir.join("package.json")).ok()?;
    let value: serde_json::Value = serde_json::from_str(&json).ok()?;
    value
        .get("name")?
        .as_str()
        .filter(|n| !n.is_empty())
        .map(str::to_owned)
}

/// Package of every file (its nearest enclosing Cargo or npm manifest inside `root`) and the
/// directory of every package manifest.
#[must_use]
pub fn packages_of(root: &Path, files: &[String]) -> AssembleContext {
    let mut by_dir: HashMap<String, Option<(String, String)>> = HashMap::new();
    let mut out = AssembleContext::default();
    for file in files {
        let mut dir = file.rsplit_once('/').map_or("", |(d, _)| d).to_owned();
        let mut walked = Vec::new();
        let found = loop {
            if let Some(hit) = by_dir.get(&dir) {
                break hit.clone();
            }
            walked.push(dir.clone());
            if let Some(package) = manifest_package(&root.join(&dir)) {
                break Some((package, dir.clone()));
            }
            if dir.is_empty() {
                break None;
            }
            dir = dir.rsplit_once('/').map_or("", |(d, _)| d).to_owned();
        };
        for d in walked {
            by_dir.insert(d, found.clone());
        }
        if let Some((package, dir)) = found {
            out.package_dir.entry(package.clone()).or_insert(dir);
            out.package_of.insert(file.clone(), package);
        }
    }
    out
}

/// Build (or refresh) the graph of the tree at `root` into the source `label`.
///
/// # Errors
///
/// Database failures; unparsable files are counted, not fatal.
pub fn build_graph(
    db: &mut HomeDb,
    label: &str,
    root: &Path,
    options: &ScanOptions,
) -> Result<(Graph, BuildReport)> {
    let root = &absolute_root(root);
    let source = db.upsert_source("code-graph", label, Some(&root.to_string_lossy()))?;
    let run = db.begin_run(Some(source), "graph")?;
    let result = build_inner(db, source, label, root, options);
    match &result {
        Ok((_, report)) => db.finish_run(
            run,
            aphrody_store::RunStatus::Succeeded,
            &serde_json::to_value(report)?,
            None,
        )?,
        Err(error) => db.finish_run(
            run,
            aphrody_store::RunStatus::Failed,
            &serde_json::json!({}),
            Some(&error.to_string()),
        )?,
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
    let mut report = BuildReport {
        scan: scan_tree(db, source, root, options)?,
        ..BuildReport::default()
    };

    // Drop cache rows of files that are gone or whose hash changed.
    db.conn().execute(
        "DELETE FROM graph_file_cache WHERE source_id = ?1 AND NOT EXISTS (
             SELECT 1 FROM files f WHERE f.source_id = graph_file_cache.source_id
               AND f.rel_path = graph_file_cache.rel_path AND f.blake3 = graph_file_cache.blake3)",
        [source],
    )?;
    db.conn().execute(
        "DELETE FROM graph_file_cache WHERE source_id = ?1
           AND COALESCE(json_extract(extract_json, '$.version'), 0) <> ?2",
        params![source, EXTRACT_VERSION],
    )?;

    let wanted: Vec<(String, String)> = db
        .stored_files(source)?
        .into_iter()
        .filter(
            |(path, (_, _, _, class, _))| match Language::of_path(path) {
                Some(Language::Markdown) => class == "doc",
                Some(_) => class == "code",
                None => false,
            },
        )
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
    let mut paths: Vec<String> = Vec::new();
    {
        let mut statement = db.conn().prepare(
            "SELECT extract_json FROM graph_file_cache WHERE source_id = ?1 ORDER BY rel_path",
        )?;
        let rows = statement.query_map([source], |r| r.get::<_, String>(0))?;
        for row in rows {
            let extract: FileExtract = serde_json::from_str(&row?)?;
            if let Some(file) = extract
                .nodes
                .iter()
                .find(|n| n.class == crate::extract::NodeClass::File)
            {
                paths.push(file.file.clone());
            }
            files.push(extract);
        }
    }
    report.cached = files.len().saturating_sub(report.extracted);
    let context = packages_of(root, &paths);
    let (mut graph, stats) = assemble_with(files, &context);
    report.assemble = stats;
    report.modularity = graph.detect_communities();
    report.nodes = graph.nodes.len();
    report.edges = graph.edges.len();
    let source = graph.save(db, label, Some(&root.to_string_lossy()))?;
    report.built_at_commit = head_commit(root);
    db.conn().execute(
        "UPDATE sources SET meta_json = CASE WHEN ?2 IS NULL THEN json_remove(meta_json, '$.built_at_commit')
                                              ELSE json_set(meta_json, '$.built_at_commit', ?2) END
         WHERE id = ?1",
        params![source, report.built_at_commit],
    )?;
    graph.meta = GraphMeta {
        root: Some(root.to_string_lossy().into_owned()),
        built_at_commit: report.built_at_commit.clone(),
    };
    Ok((graph, report))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn repo() -> tempfile::TempDir {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(dir.path().join("src")).unwrap();
        std::fs::write(
            dir.path().join("src/a.rs"),
            "pub struct Thing;\nfn run() { helper(); }\nfn helper() {}\n",
        )
        .unwrap();
        std::fs::write(
            dir.path().join("src/b.rs"),
            "fn use_it(t: Thing) { remote(); }\n",
        )
        .unwrap();
        std::fs::write(dir.path().join("src/c.rs"), "pub fn remote() {}\n").unwrap();
        std::fs::write(dir.path().join("README.md"), "# not code").unwrap();
        dir
    }

    #[test]
    fn the_first_build_extracts_everything_and_the_second_parses_nothing() {
        let dir = repo();
        let mut db = HomeDb::open_in_memory().unwrap();
        let (g1, r1) =
            build_graph(&mut db, "graph:t", dir.path(), &ScanOptions::default()).unwrap();
        assert_eq!(r1.extracted, 4, "three Rust files and README.md");
        assert!(
            g1.nodes
                .iter()
                .any(|n| n.label == "not code" && n.kind == crate::graph::NodeKind::Document)
        );
        assert!(g1.nodes.iter().any(|n| n.label == "run()"));
        assert!(
            g1.edges
                .iter()
                .any(|e| e.relation == "calls" && g1.nodes[e.dst].label == "remote()")
        );
        let (g2, r2) =
            build_graph(&mut db, "graph:t", dir.path(), &ScanOptions::default()).unwrap();
        assert_eq!((r2.extracted, r2.cached), (0, 4));
        assert_eq!(
            (g1.nodes.len(), g1.edges.len()),
            (g2.nodes.len(), g2.edges.len())
        );
        let stored: i64 = db
            .conn()
            .query_row("SELECT count(*) FROM graph_nodes", [], |r| r.get(0))
            .unwrap();
        assert_eq!(stored as usize, g2.nodes.len());
        assert_eq!(
            db.last_run("graph").unwrap().unwrap().status,
            aphrody_store::RunStatus::Succeeded
        );
    }

    #[test]
    fn only_changed_files_are_parsed_again() {
        let dir = repo();
        let mut db = HomeDb::open_in_memory().unwrap();
        build_graph(&mut db, "graph:t", dir.path(), &ScanOptions::default()).unwrap();
        std::fs::write(
            dir.path().join("src/c.rs"),
            "pub fn remote() {}\npub fn extra() {}\n",
        )
        .unwrap();
        let (g, r) = build_graph(&mut db, "graph:t", dir.path(), &ScanOptions::default()).unwrap();
        assert_eq!(r.extracted, 1);
        assert_eq!(r.cached, 3);
        assert!(g.nodes.iter().any(|n| n.label == "extra()"));
        std::fs::remove_file(dir.path().join("src/c.rs")).unwrap();
        let (g, _) = build_graph(&mut db, "graph:t", dir.path(), &ScanOptions::default()).unwrap();
        assert!(!g.nodes.iter().any(|n| n.label == "remote()"));
    }

    #[test]
    fn rows_of_an_older_extractor_are_parsed_again_and_packages_come_from_manifests() {
        let dir = repo();
        std::fs::write(
            dir.path().join("Cargo.toml"),
            "[package]
name = \"my-crate\"
",
        )
        .unwrap();
        std::fs::create_dir_all(dir.path().join("web")).unwrap();
        std::fs::write(dir.path().join("web/package.json"), r#"{"name":"@x/web"}"#).unwrap();
        std::fs::write(
            dir.path().join("web/main.ts"),
            "export function go() {}
",
        )
        .unwrap();
        let mut db = HomeDb::open_in_memory().unwrap();
        let (g, _) = build_graph(&mut db, "graph:t", dir.path(), &ScanOptions::default()).unwrap();
        let package = |label: &str| {
            g.nodes
                .iter()
                .find(|n| n.label == label)
                .and_then(|n| n.package.clone())
        };
        assert_eq!(package("run()").as_deref(), Some("my_crate"));
        assert_eq!(package("go()").as_deref(), Some("@x/web"));
        let reloaded = Graph::load(&db, "graph:t").unwrap();
        assert!(
            reloaded
                .nodes
                .iter()
                .any(|n| n.package.as_deref() == Some("@x/web"))
        );
        db.conn()
            .execute(
                "UPDATE graph_file_cache SET extract_json = json_set(extract_json, '$.version', 1)",
                [],
            )
            .unwrap();
        let (_, r) = build_graph(&mut db, "graph:t", dir.path(), &ScanOptions::default()).unwrap();
        assert_eq!(r.cached, 0);
        let root: String = db
            .conn()
            .query_row(
                "SELECT root FROM sources WHERE label = 'graph:t'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert!(
            Path::new(&root).is_absolute() && !root.starts_with(r"\\?\"),
            "{root}"
        );
    }

    #[test]
    fn a_resumed_build_parses_only_files_missing_a_cache_row() {
        let dir = repo();
        let mut db = HomeDb::open_in_memory().unwrap();
        build_graph(&mut db, "graph:t", dir.path(), &ScanOptions::default()).unwrap();
        db.conn()
            .execute(
                "DELETE FROM graph_file_cache WHERE rel_path = 'src/b.rs'",
                [],
            )
            .unwrap();
        let (_, r) = build_graph(&mut db, "graph:t", dir.path(), &ScanOptions::default()).unwrap();
        assert_eq!(r.extracted, 1);
    }
}
