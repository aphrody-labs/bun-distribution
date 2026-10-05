// SPDX-License-Identifier: Apache-2.0
//! Command line of the home database (`aphrody-store`): status, verified backups and the
//! legacy importers. JSON on stdout, never row content. Every importer is a dry run unless
//! `--apply` is given, and `--apply` always takes a verified backup of an existing database
//! first.

use std::{path::PathBuf, process::ExitCode};

use clap::{Parser, Subcommand};

use crate::{
    HomeDb, HomeLayout, HomeScope,
    error::Result,
    import::{graphify, memory, rag, sessions},
    time::now_ms,
};

/// Home database tooling.
#[derive(Debug, Parser)]
#[command(name = "aphrody-store", version, about)]
pub struct Cli {
    /// Domain profile (`aphrody`, `dbfr`, `ie`...); omitted selects the global home.
    #[arg(long, global = true)]
    profile: Option<String>,
    /// Explicit state root (default: `$APHRODY_HOME` or `~/.aphrody`).
    #[arg(long, global = true)]
    state: Option<PathBuf>,
    #[command(subcommand)]
    command: Command,
}

#[derive(Debug, Subcommand)]
enum Command {
    /// Print the layout, schema version and table counts.
    Status,
    /// Write a checksum-verified backup into the unique backup tree.
    Backup {
        /// Free text recorded in the ledger.
        #[arg(long, default_value = "manual")]
        reason: String,
    },
    /// Import legacy stores (dry run unless `--apply`).
    Import {
        /// Write instead of counting.
        #[arg(long)]
        apply: bool,
        #[command(subcommand)]
        what: ImportWhat,
    },
}

#[derive(Debug, Subcommand)]
enum ImportWhat {
    /// A Graphify `graph.json`.
    Graphify {
        /// Path of `graph.json`.
        path: PathBuf,
        /// Source label (default `graph:<file stem of the parent>`).
        #[arg(long)]
        label: Option<String>,
    },
    /// A memory database (`memory_records` or `memory_items`).
    Memory {
        /// Legacy SQLite file.
        path: PathBuf,
    },
    /// A legacy RAG database.
    Rag {
        /// Legacy SQLite file.
        path: PathBuf,
    },
    /// A sessions directory (metadata only).
    Sessions {
        /// Directory (default: `<home>/sessions`).
        path: Option<PathBuf>,
    },
}

fn layout(cli: &Cli) -> Result<HomeLayout> {
    let scope = HomeScope::from_profile(cli.profile.as_deref());
    match &cli.state {
        Some(state) => HomeLayout::in_state(state, &scope),
        None => HomeLayout::resolve(&scope),
    }
}

fn open_for_write(layout: &HomeLayout, apply: bool) -> Result<HomeDb> {
    if !apply {
        // Dry runs never touch the real file: they migrate a private in-memory copy.
        return HomeDb::open_in_memory();
    }
    if layout.db_path.exists() {
        let existing = HomeDb::open_path(&layout.db_path)?;
        existing.backup(&layout.backup_dir(now_ms()), &layout.scope.label(), "pre-import")?;
        return Ok(existing);
    }
    HomeDb::open_path(&layout.db_path)
}

fn run(cli: &Cli) -> Result<serde_json::Value> {
    let layout = layout(cli)?;
    match &cli.command {
        Command::Status => {
            let exists = layout.db_path.exists();
            let mut out = serde_json::json!({
                "scope": layout.scope.label(),
                "home": layout.home,
                "db": layout.db_path,
                "exists": exists,
            });
            if exists {
                let db = HomeDb::open_read_only(&layout.db_path)?;
                out["schema_version"] = db.schema_version()?.into();
                let mut tables = serde_json::Map::new();
                for table in [
                    "sources", "files", "docs", "chunks", "vectors", "graph_nodes", "graph_edges",
                    "memories", "sessions", "messages", "backups",
                ] {
                    let n: Option<i64> = db
                        .conn()
                        .query_row(&format!("SELECT count(*) FROM {table}"), [], |r| r.get(0))
                        .ok();
                    if let Some(n) = n {
                        tables.insert(table.to_owned(), n.into());
                    }
                }
                out["tables"] = tables.into();
            }
            Ok(out)
        },
        Command::Backup { reason } => {
            let db = HomeDb::open_path(&layout.db_path)?;
            let report = db.backup(&layout.backup_dir(now_ms()), &layout.scope.label(), reason)?;
            Ok(serde_json::to_value(report)?)
        },
        Command::Import { apply, what } => {
            let mut db = open_for_write(&layout, *apply)?;
            let report = match what {
                ImportWhat::Graphify { path, label } => {
                    let label = label.clone().unwrap_or_else(|| {
                        let name = path
                            .parent()
                            .and_then(|p| p.parent())
                            .and_then(|p| p.file_name())
                            .map_or_else(|| "graph".to_owned(), |n| n.to_string_lossy().into_owned());
                        format!("graph:{name}")
                    });
                    graphify::import_graph_json(&mut db, path, &label, None, *apply)?
                },
                ImportWhat::Memory { path } => {
                    let origin = format!("legacy:{}", path.file_name().map_or_else(String::new, |n| n.to_string_lossy().into_owned()));
                    memory::import_memories(&mut db, path, &origin, *apply)?
                },
                ImportWhat::Rag { path } => {
                    let label = format!("legacy-rag:{}", path.file_name().map_or_else(String::new, |n| n.to_string_lossy().into_owned()));
                    rag::import_rag(&mut db, path, &label, *apply)?
                },
                ImportWhat::Sessions { path } => {
                    let dir = path.clone().unwrap_or_else(|| layout.home.join("sessions"));
                    sessions::import_sessions(&mut db, &dir, cli.profile.as_deref(), *apply)?
                },
            };
            Ok(serde_json::to_value(report)?)
        },
    }
}

/// Entry point shared by the transitional binary and the multi-call dispatcher.
#[must_use]
pub fn cli_main() -> ExitCode {
    let cli = Cli::parse();
    match run(&cli) {
        Ok(value) => {
            println!("{}", serde_json::to_string_pretty(&value).unwrap_or_default());
            ExitCode::SUCCESS
        },
        Err(error) => {
            eprintln!("aphrody-store: {error}");
            ExitCode::FAILURE
        },
    }
}
