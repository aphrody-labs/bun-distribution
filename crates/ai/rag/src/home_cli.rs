// SPDX-License-Identifier: Apache-2.0
//! `aphrody home`: the single command line of the agent home. The store verbs (`status`,
//! `backup`, `import`) come from `aphrody-store`; `index` runs the ingestion pipeline and `query`
//! runs the unified retrieval over chunks, code graph and memories.

use std::{ffi::OsString, path::PathBuf};

use aphrody_store::{
    HomeDb,
    cli::{Command as StoreCommand, StoreArgs, run as run_store},
};
use clap::{Parser, Subcommand, ValueEnum};

use crate::{
    error::{RagError, Result},
    home::{HitKind, UnifiedOptions, unified_search},
    pipeline::run_pipeline,
};

/// Agent home tooling.
#[derive(Debug, Parser)]
#[command(name = "aphrody home", version, about)]
struct Cli {
    #[command(flatten)]
    store: StoreArgs,
    #[command(subcommand)]
    command: Command,
}

#[derive(Debug, Clone, Copy, ValueEnum)]
enum KindArg {
    Chunk,
    Node,
    Memory,
}

#[derive(Debug, Subcommand)]
enum Command {
    #[command(flatten)]
    Store(StoreCommand),
    /// Scan, extract the code graph, chunk and index a tree (incremental by content hash).
    Index {
        /// Tree root (default: the current directory).
        #[arg(default_value = ".")]
        root: PathBuf,
        /// Source label (default: the directory name).
        #[arg(long)]
        label: Option<String>,
    },
    /// Import the documents of a legacy `knowledge.db` into the retrieval index (dry run unless
    /// `--apply`; the legacy file is opened read-only).
    ImportKnowledge {
        /// Legacy `knowledge.db`.
        path: PathBuf,
        /// Source label (default `knowledge`).
        #[arg(long, default_value = "knowledge")]
        label: String,
        /// Write instead of counting.
        #[arg(long)]
        apply: bool,
    },
    /// Hybrid retrieval over document chunks, code-graph nodes and memories.
    Query {
        /// Free-text query.
        text: String,
        /// Results returned.
        #[arg(long, default_value_t = 10)]
        limit: usize,
        /// Restrict to these kinds (repeatable).
        #[arg(long = "kind", value_enum)]
        kinds: Vec<KindArg>,
    },
}

fn other(error: impl std::fmt::Display) -> RagError {
    RagError::Other(error.to_string())
}

fn run(cli: &Cli) -> Result<serde_json::Value> {
    match &cli.command {
        Command::Store(command) => run_store(&cli.store, command).map_err(other),
        Command::Index { root, label } => {
            let layout = cli.store.layout().map_err(other)?;
            let root = std::fs::canonicalize(root)?;
            let label = label.clone().unwrap_or_else(|| {
                root.file_name().map_or_else(|| "tree".to_owned(), |n| n.to_string_lossy().into_owned())
            });
            let runtime = tokio::runtime::Builder::new_current_thread().build()?;
            let report = runtime.block_on(run_pipeline(&layout, &label, &root))?;
            Ok(serde_json::to_value(report)?)
        },
        Command::ImportKnowledge { path, label, apply } => {
            let layout = cli.store.layout().map_err(other)?;
            let runtime = tokio::runtime::Builder::new_current_thread().build()?;
            runtime.block_on(crate::pipeline::import_knowledge(&layout, path, label, *apply))
        },
        Command::Query { text, limit, kinds } => {
            let layout = cli.store.layout().map_err(other)?;
            let db = HomeDb::open_read_only(&layout.db_path).map_err(other)?;
            let options = UnifiedOptions {
                limit: *limit,
                kinds: kinds
                    .iter()
                    .map(|k| match k {
                        KindArg::Chunk => HitKind::Chunk,
                        KindArg::Node => HitKind::Node,
                        KindArg::Memory => HitKind::Memory,
                    })
                    .collect(),
                ..UnifiedOptions::default()
            };
            Ok(serde_json::json!({ "query": text, "hits": unified_search(&db, text, &options)? }))
        },
    }
}

/// Entry point of `aphrody home` (multi-call convention: `args[0]` is the invocation name).
#[must_use]
pub fn cli_main(args: Vec<OsString>) -> i32 {
    let cli = match Cli::try_parse_from(args) {
        Ok(cli) => cli,
        Err(error) => {
            let _ = error.print();
            return i32::from(error.use_stderr());
        },
    };
    match run(&cli) {
        Ok(value) => {
            println!("{}", serde_json::to_string_pretty(&value).unwrap_or_default());
            0
        },
        Err(error) => {
            eprintln!("aphrody home: {error}");
            1
        },
    }
}
