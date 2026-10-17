// SPDX-License-Identifier: Apache-2.0
//! `aphrody docs` & `aphrody awesome` — documentation lookup and curated awesome-list ecosystem.

use aphrody_git::{
    GitHubClient, PRESETS, fetch_awesome_list, search_awesome_ecosystem, search_github_docs,
};
use colored::Colorize;
use miette::IntoDiagnostic;

/// Documentation search and library discovery.
#[derive(clap::Subcommand, Debug, Clone)]
pub(crate) enum DocsAction {
    /// Search documentation across Context7, Microsoft Learn, and GitHub repositories with llms.txt.
    Search {
        /// Query or library name (e.g. "ratatui", "tokio", "gitingest").
        query: String,
        /// Max number of GitHub repositories to inspect (default: 3).
        #[arg(short = 'l', long, default_value_t = 3)]
        limit: usize,
        /// Search GitHub for open-source repositories, llms.txt, and READMEs.
        #[arg(short = 'g', long, default_value_t = true)]
        github: bool,
        /// Generate full GitIngest digest for discovered repositories lacking llms.txt.
        #[arg(short = 'd', long)]
        digest: bool,
        /// Output structured JSON instead of Markdown.
        #[arg(long)]
        json: bool,
    },
    /// Curated Awesome lists ecosystem.
    #[command(about = awesome_about())]
    Awesome {
        #[command(subcommand)]
        action: AwesomeAction,
    },
}

/// Commands for the Awesome list ecosystem.
#[derive(clap::Subcommand, Debug, Clone)]
pub(crate) enum AwesomeAction {
    /// List known canonical Awesome presets.
    #[command(about = format!("List known canonical Awesome presets ({})", preset_names()))]
    Presets,
    /// Fetch and parse a curated Awesome list from GitHub.
    Fetch {
        /// Preset name or "owner/repo".
        #[arg(default_value = "bun", help = preset_arg_help("Preset name"))]
        source: String,
        /// Enrich items with live GitHub star counts and llms.txt probing (up to 10 items).
        #[arg(long)]
        enrich: bool,
        /// Output structured JSON instead of Markdown.
        #[arg(long)]
        json: bool,
    },
    /// Search across canonical Awesome ecosystems or a specific list.
    Search {
        /// Search query (e.g. "framework", "terminal", "orm", "markdown").
        query: String,
        /// Scope search to a specific preset.
        #[arg(short, long, help = preset_arg_help("Scope search to a specific preset"))]
        preset: Option<String>,
        /// Output structured JSON instead of Markdown.
        #[arg(long)]
        json: bool,
    },
    /// Generate a prompt-ready LLM digest of an Awesome list.
    Digest {
        /// Preset name or "owner/repo".
        #[arg(default_value = "bun", help = preset_arg_help("Preset name"))]
        source: String,
        /// Scope digest to a specific category.
        #[arg(short, long)]
        category: Option<String>,
    },
}

/// Comma-separated preset keys, derived from the single `aphrody_git::PRESETS` table.
pub(crate) fn preset_names() -> String {
    PRESETS
        .iter()
        .map(|(key, ..)| *key)
        .collect::<Vec<_>>()
        .join(", ")
}

/// Help line for the `awesome` command group, listing every known preset.
pub(crate) fn awesome_about() -> String {
    format!(
        "Curated Awesome lists ecosystem (presets: {})",
        preset_names()
    )
}

fn preset_arg_help(prefix: &str) -> String {
    format!("{prefix}: one of [{}] or \"owner/repo\"", preset_names())
}

pub(crate) async fn execute_docs(action: DocsAction) -> miette::Result<()> {
    match action {
        DocsAction::Search {
            query,
            limit,
            github,
            digest,
            json,
        } => {
            if !github {
                eprintln!(
                    "{}",
                    "Notice: GitHub search disabled; specify a valid catalogue or enable GitHub."
                        .yellow()
                );
                return Ok(());
            }

            eprintln!(
                "{}",
                format!("Searching documentation and open-source repositories for: {query}...")
                    .cyan()
            );
            let report = search_github_docs(&query, limit, digest)
                .await
                .map_err(|e| miette::miette!("{e}"))?;

            if json {
                let serialized = serde_json::to_string_pretty(&report).into_diagnostic()?;
                println!("{serialized}");
            } else {
                println!("{}", report.to_markdown());
            }
        }
        DocsAction::Awesome { action } => {
            execute_awesome(action).await?;
        }
    }
    Ok(())
}

pub(crate) async fn execute_awesome(action: AwesomeAction) -> miette::Result<()> {
    match action {
        AwesomeAction::Presets => {
            println!("{}", "# Canonical Awesome Presets\n".bold());
            for (key, repo, branch, desc) in PRESETS {
                println!(
                    "  {} {} ({})",
                    format!("{:<10}", key).cyan().bold(),
                    format!("https://github.com/{}", repo).underline(),
                    branch.dimmed()
                );
                println!("    {}\n", desc);
            }
        }
        AwesomeAction::Fetch {
            source,
            enrich,
            json,
        } => {
            eprintln!(
                "{}",
                format!("Fetching Awesome list for '{source}'...").cyan()
            );
            let mut index = fetch_awesome_list(&source)
                .await
                .map_err(|e| miette::miette!("{e}"))?;

            if enrich {
                eprintln!(
                    "{}",
                    "Enriching top items with live GitHub stats & llms.txt probing...".yellow()
                );
                if let Ok(client) = GitHubClient::from_env() {
                    for cat in &mut index.categories {
                        client.enrich_awesome_items(&mut cat.items, 10).await;
                    }
                }
            }

            if json {
                let serialized = serde_json::to_string_pretty(&index).into_diagnostic()?;
                println!("{serialized}");
            } else {
                println!("{}", index.to_markdown());
            }
        }
        AwesomeAction::Search {
            query,
            preset,
            json,
        } => {
            eprintln!(
                "{}",
                format!("Searching Awesome ecosystem for: '{query}'...").cyan()
            );
            let items = if let Some(ref p) = preset {
                let index = fetch_awesome_list(p)
                    .await
                    .map_err(|e| miette::miette!("{e}"))?;
                index.search(&query)
            } else {
                let presets: Vec<&str> = PRESETS.iter().map(|(p, _, _, _)| *p).collect();
                search_awesome_ecosystem(&query, &presets)
                    .await
                    .map_err(|e| miette::miette!("{e}"))?
            };

            if json {
                let serialized = serde_json::to_string_pretty(&items).into_diagnostic()?;
                println!("{serialized}");
            } else {
                println!("# Awesome Search Results — `{}`\n", query);
                println!("*Found {} curated entries:*\n", items.len());
                for item in items {
                    print!("- [{}]({})", item.title.bold(), item.url);
                    if !item.category.is_empty() {
                        print!(" `[{}]`", item.category.cyan());
                    }
                    if !item.description.is_empty() {
                        print!(" — {}", item.description);
                    }
                    if let Some(ref gh) = item.github_repo {
                        print!(" ({})", gh.dimmed());
                    }
                    println!();
                }
            }
        }
        AwesomeAction::Digest { source, category } => {
            eprintln!(
                "{}",
                format!("Building Awesome LLM digest for '{source}'...").cyan()
            );
            let index = fetch_awesome_list(&source)
                .await
                .map_err(|e| miette::miette!("{e}"))?;

            let mut out = format!("# LLM Context Digest: Awesome {}\n\n", index.name);
            out.push_str(&format!(
                "Source: https://github.com/{}\n\n",
                index.repository
            ));

            for cat in &index.categories {
                if let Some(ref filter) = category
                    && !cat.name.to_lowercase().contains(&filter.to_lowercase())
                {
                    continue;
                }
                out.push_str(&format!("## {}\n\n", cat.name));
                for item in &cat.items {
                    out.push_str(&format!(
                        "- [{}]({}): {}\n",
                        item.title, item.url, item.description
                    ));
                }
                out.push('\n');
            }
            println!("{out}");
        }
    }
    Ok(())
}
