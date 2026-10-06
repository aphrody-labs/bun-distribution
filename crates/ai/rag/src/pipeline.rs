// SPDX-License-Identifier: Apache-2.0
//! The home ingestion pipeline: scan, classify, extract (code graph), chunk, index.
//!
//! One run over a tree records file fingerprints (BLAKE3, deny list, `.gitignore` and
//! `.graphifyignore`), builds the code graph incrementally, chunks and indexes code and
//! documents into the same database and removes the documents of files that disappeared. It is
//! incremental by content hash (an unchanged file is never re-read by the indexer), idempotent and
//! resumable (a file's completed stage is stored; an interrupted run continues with the files
//! that did not reach `index`). Embedding is a separate, optional stage that needs a configured
//! model; without one the index is lexical and the graph is complete.

use std::{path::Path, sync::Arc};

use aphrody_code_graph::pipeline::{BuildReport, build_graph};
use aphrody_store::{
    HomeDb, HomeLayout,
    files::Stage,
    scan::ScanOptions,
};
use rusqlite::params;
use serde::{Deserialize, Serialize};

use crate::{
    error::{RagError, Result},
    indexer::{IndexOptions, RagIndexer},
    store::RagStore,
};

/// Counters of one pipeline run.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct PipelineReport {
    /// Source label.
    pub source: String,
    /// Scan, extraction and graph counters.
    pub graph: BuildReport,
    /// Documents (re)indexed in this run.
    pub indexed: usize,
    /// Documents skipped because their content hash is unchanged.
    pub unchanged: usize,
    /// Documents removed because their file disappeared.
    pub removed: usize,
    /// Chunks written in this run.
    pub chunks: usize,
    /// Per-file problems (paths only).
    pub errors: Vec<String>,
}

fn other(error: impl std::fmt::Display) -> RagError {
    RagError::Other(error.to_string())
}

/// Run the pipeline over `root` for the source `label` in the home `layout`.
///
/// # Errors
///
/// Database failures; unreadable files are reported in [`PipelineReport::errors`].
pub async fn run_pipeline(layout: &HomeLayout, label: &str, root: &Path) -> Result<PipelineReport> {
    let mut db = HomeDb::open(layout).map_err(other)?;
    db.interrupt_stale_runs().map_err(other)?;
    let run = db.begin_run(None, "index").map_err(other)?;
    let result = run_inner(layout, &mut db, label, root).await;
    match &result {
        Ok(report) => db
            .finish_run(run, aphrody_store::RunStatus::Succeeded, &serde_json::to_value(report)?, None)
            .map_err(other)?,
        Err(error) => db
            .finish_run(run, aphrody_store::RunStatus::Failed, &serde_json::json!({}), Some(&error.to_string()))
            .map_err(other)?,
    }
    result
}

async fn run_inner(layout: &HomeLayout, db: &mut HomeDb, label: &str, root: &Path) -> Result<PipelineReport> {
    let mut report = PipelineReport { source: label.to_owned(), ..PipelineReport::default() };
    let (_graph, graph_report) = build_graph(db, label, root, &ScanOptions::default()).map_err(other)?;
    report.graph = graph_report;
    let source = db.source_id(label).map_err(other)?.ok_or_else(|| other("source vanished"))?;

    // Remove documents of files that are no longer in the fingerprint table.
    let prefix = format!("{label}:");
    let stale: Vec<i64> = {
        let known: std::collections::HashSet<String> =
            db.stored_files(source).map_err(other)?.into_keys().map(|rel| format!("{prefix}{rel}")).collect();
        let mut statement = db.conn().prepare("SELECT id, path FROM docs WHERE substr(path, 1, ?1) = ?2")?;
        let rows = statement.query_map(params![i64::try_from(prefix.chars().count()).unwrap_or(0), prefix], |r| {
            Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?))
        })?;
        let mut stale = Vec::new();
        for row in rows {
            let (id, path) = row?;
            if !known.contains(&path) {
                stale.push(id);
            }
        }
        stale
    };

    let store = Arc::new(RagStore::open(&layout.db_path)?);
    for id in stale {
        store.delete_doc(id).await?;
        report.removed += 1;
    }

    let indexer = RagIndexer::new(Arc::clone(&store));
    let options = IndexOptions::default();
    let queue: Vec<_> = db
        .pending(source, Stage::Index)
        .map_err(other)?
        .into_iter()
        .filter(|f| matches!(f.class, aphrody_store::FileClass::Code | aphrody_store::FileClass::Doc))
        .collect();
    for file in queue {
        let path = root.join(&file.rel_path);
        let Ok(content) = std::fs::read_to_string(&path) else {
            report.errors.push(file.rel_path.clone());
            continue;
        };
        let key = format!("{prefix}{}", file.rel_path);
        match indexer
            .index_document(&key, &content, i64::try_from(file.size_bytes).unwrap_or(i64::MAX), file.mtime_ms, &options)
            .await
        {
            Ok(Some((chunks, _vectors))) => {
                report.indexed += 1;
                report.chunks += chunks;
            },
            Ok(None) => report.unchanged += 1,
            Err(error) => {
                report.errors.push(format!("{}: {error}", file.rel_path));
                continue;
            },
        }
        db.conn().execute("UPDATE docs SET source_id = ?1 WHERE path = ?2", params![source, key])?;
        db.complete_stage(source, &file.rel_path, &file.blake3, Stage::Index).map_err(other)?;
    }
    store.checkpoint().await?;
    Ok(report)
}

#[cfg(test)]
mod tests {
    use aphrody_store::HomeScope;

    use super::*;

    fn tree() -> tempfile::TempDir {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(dir.path().join("src")).unwrap();
        std::fs::write(
            dir.path().join("src/lib.rs"),
            "/// Reciprocal rank fusion merges channels.\npub fn fuse() { helper(); }\nfn helper() {}\n",
        )
        .unwrap();
        std::fs::write(dir.path().join("README.md"), "# Notes\n\nThe pipeline is incremental by content hash.\n").unwrap();
        std::fs::write(dir.path().join(".env"), "TOKEN=secret-value").unwrap();
        dir
    }

    #[tokio::test]
    async fn one_run_fills_files_graph_and_index_and_a_second_run_does_no_work() {
        let state = tempfile::tempdir().unwrap();
        let layout = HomeLayout::in_state(state.path(), &HomeScope::Profile("ie".into())).unwrap();
        let repo = tree();

        let first = run_pipeline(&layout, "repo", repo.path()).await.unwrap();
        assert_eq!(first.indexed, 2, "{first:?}");
        assert!(first.chunks >= 2);
        assert!(first.graph.nodes >= 3);
        assert!(first.errors.is_empty());

        let db = HomeDb::open_read_only(&layout.db_path).unwrap();
        let docs: Vec<String> = {
            let mut s = db.conn().prepare("SELECT path FROM docs ORDER BY path").unwrap();
            s.query_map([], |r| r.get(0)).unwrap().map(Result::unwrap).collect()
        };
        assert_eq!(docs, ["repo:README.md", "repo:src/lib.rs"]);
        // The secret file never entered any table.
        let leaked: i64 = db
            .conn()
            .query_row("SELECT count(*) FROM files WHERE rel_path = '.env'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(leaked, 0);

        // One query reaches the chunk and the graph node.
        let hits = crate::home::unified_search(&db, "fuse", &crate::home::UnifiedOptions::default()).unwrap();
        assert!(hits.iter().any(|h| h.kind == crate::home::HitKind::Chunk));
        assert!(hits.iter().any(|h| h.kind == crate::home::HitKind::Node));

        let second = run_pipeline(&layout, "repo", repo.path()).await.unwrap();
        assert_eq!((second.indexed, second.chunks), (0, 0), "{second:?}");
        assert_eq!(second.graph.extracted, 0);
        assert_eq!(second.graph.scan.hashed, 0);
    }

    #[tokio::test]
    async fn changes_and_removals_propagate_to_the_index() {
        let state = tempfile::tempdir().unwrap();
        let layout = HomeLayout::in_state(state.path(), &HomeScope::Global).unwrap();
        let repo = tree();
        run_pipeline(&layout, "repo", repo.path()).await.unwrap();
        std::fs::write(repo.path().join("README.md"), "# Notes\n\nChanged text about vectors.\n").unwrap();
        std::fs::remove_file(repo.path().join("src/lib.rs")).unwrap();
        let report = run_pipeline(&layout, "repo", repo.path()).await.unwrap();
        assert_eq!(report.indexed, 1);
        assert_eq!(report.removed, 1);
        let db = HomeDb::open_read_only(&layout.db_path).unwrap();
        let docs: i64 = db.conn().query_row("SELECT count(*) FROM docs", [], |r| r.get(0)).unwrap();
        assert_eq!(docs, 1);
        let hits = crate::home::unified_search(&db, "vectors", &crate::home::UnifiedOptions::default()).unwrap();
        assert!(!hits.is_empty());
        let gone = crate::home::unified_search(&db, "fuse", &crate::home::UnifiedOptions::default()).unwrap();
        assert!(gone.iter().all(|h| h.kind != crate::home::HitKind::Chunk));
    }
}
