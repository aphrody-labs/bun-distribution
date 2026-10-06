// SPDX-License-Identifier: Apache-2.0
//! Command line of the code graph: build, query, explain, path, report, export. JSON on stdout
//! for `build`, plain text for the readers. Offline, no model, no network.

use std::{fmt::Write as _, path::PathBuf, process::ExitCode};

use aphrody_store::{HomeDb, HomeLayout, HomeScope, scan::ScanOptions};
use clap::{Parser, Subcommand};

use crate::{
    error::{GraphError, Result},
    graph::Graph,
    pipeline::build_graph,
    query::QueryOptions,
};

/// Code graph tooling.
#[derive(Debug, Parser)]
#[command(name = "aphrody-graph", version, about)]
pub struct Cli {
    /// Domain profile (omitted selects the global home).
    #[arg(long, global = true)]
    profile: Option<String>,
    /// Explicit state root (default: `$APHRODY_HOME` or `~/.aphrody`).
    #[arg(long, global = true)]
    state: Option<PathBuf>,
    /// Graph source label (default: the only graph of the database).
    #[arg(long, global = true)]
    source: Option<String>,
    #[command(subcommand)]
    command: Command,
}

#[derive(Debug, Subcommand)]
enum Command {
    /// Scan a tree and (re)build its graph incrementally.
    Build {
        /// Tree root.
        root: PathBuf,
        /// Also write a Graphify-compatible `graph.json` here.
        #[arg(long)]
        json: Option<PathBuf>,
        /// Also write `GRAPH_REPORT.md` here.
        #[arg(long)]
        report: Option<PathBuf>,
    },
    /// Budgeted breadth-first retrieval for a question.
    Query {
        /// The question.
        question: String,
        /// Traversal depth.
        #[arg(long, default_value_t = 2)]
        depth: usize,
        /// Output budget in estimated tokens.
        #[arg(long, default_value_t = 2000)]
        budget: usize,
    },
    /// Describe a node and its connections.
    Explain {
        /// Node id or label.
        node: String,
    },
    /// Shortest path between two nodes.
    Path {
        /// Start node.
        from: String,
        /// End node.
        to: String,
    },
    /// Print the markdown report.
    Report,
    /// Write `graph.json`.
    Export {
        /// Output file.
        out: PathBuf,
    },
}

fn layout(cli: &Cli) -> Result<HomeLayout> {
    let scope = HomeScope::from_profile(cli.profile.as_deref());
    Ok(match &cli.state {
        Some(state) => HomeLayout::in_state(state, &scope)?,
        None => HomeLayout::resolve(&scope)?,
    })
}

fn pick_source(db: &HomeDb, wanted: Option<&str>) -> Result<String> {
    if let Some(label) = wanted {
        return Ok(label.to_owned());
    }
    let mut statement = db
        .conn()
        .prepare("SELECT label FROM sources WHERE kind IN ('code-graph', 'graphify') ORDER BY label")?;
    let labels: Vec<String> = statement.query_map([], |r| r.get(0))?.collect::<std::result::Result<_, _>>()?;
    match labels.as_slice() {
        [only] => Ok(only.clone()),
        [] => Err(GraphError::UnknownSource("(no graph in this database)".into())),
        many => Err(GraphError::UnknownSource(format!("several graphs, pass --source: {}", many.join(", ")))),
    }
}

fn run(cli: &Cli) -> Result<String> {
    let layout = layout(cli)?;
    if let Command::Build { root, json, report } = &cli.command {
        let mut db = HomeDb::open(&layout)?;
        db.interrupt_stale_runs()?;
        let label = cli.source.clone().unwrap_or_else(|| {
            let name = std::fs::canonicalize(root)
                .ok()
                .and_then(|p| p.file_name().map(|n| n.to_string_lossy().into_owned()))
                .unwrap_or_else(|| "tree".to_owned());
            format!("graph:{name}")
        });
        let (graph, summary) = build_graph(&mut db, &label, root, &ScanOptions::default())?;
        if let Some(path) = json {
            graph.write_graph_json(std::io::BufWriter::new(std::fs::File::create(path).map_err(|e| GraphError::Json(serde_json::Error::io(e)))?), None)?;
        }
        if let Some(path) = report {
            std::fs::write(path, graph.report(&label, 15)).map_err(|e| GraphError::Json(serde_json::Error::io(e)))?;
        }
        let mut value = serde_json::to_value(&summary)?;
        value["source"] = label.into();
        return Ok(serde_json::to_string_pretty(&value)?);
    }
    let db = HomeDb::open_read_only(&layout.db_path)?;
    let label = pick_source(&db, cli.source.as_deref())?;
    let graph = Graph::load(&db, &label)?;
    Ok(match &cli.command {
        Command::Build { .. } => unreachable!("handled above"),
        Command::Query { question, depth, budget } => {
            let result = graph.query(question, &QueryOptions { depth: *depth, budget_tokens: *budget, ..QueryOptions::default() });
            let mut out = result.text;
            if result.truncated > 0 {
                let _ = writeln!(out, "[truncated: {} more nodes within depth {depth}]", result.truncated);
            }
            out
        },
        Command::Explain { node } => graph.explain(node)?.to_string(),
        Command::Path { from, to } => match graph.shortest_path(from, to)? {
            None => "no path".to_owned(),
            Some(path) => {
                let mut out = String::new();
                for hop in &path {
                    let n = &graph.nodes[hop.node];
                    match hop.via {
                        None => {
                            let _ = writeln!(out, "{}", n.label);
                        },
                        Some((e, forward)) => {
                            let edge = &graph.edges[e];
                            let arrow = if forward { "-->" } else { "<--" };
                            let _ = writeln!(out, "  {arrow} [{}] {}", edge.relation, n.label);
                        },
                    }
                }
                out
            },
        },
        Command::Report => graph.report(&label, 15),
        Command::Export { out } => {
            graph.write_graph_json(std::io::BufWriter::new(std::fs::File::create(out).map_err(|e| GraphError::Json(serde_json::Error::io(e)))?), None)?;
            format!("wrote {}", out.display())
        },
    })
}

/// Entry point shared by the transitional binary and the multi-call dispatcher.
#[must_use]
pub fn cli_main() -> ExitCode {
    let cli = Cli::parse();
    match run(&cli) {
        Ok(text) => {
            println!("{}", text.trim_end());
            ExitCode::SUCCESS
        },
        Err(error) => {
            eprintln!("aphrody-graph: {error}");
            ExitCode::FAILURE
        },
    }
}
