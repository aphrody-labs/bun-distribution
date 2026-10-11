// SPDX-License-Identifier: Apache-2.0
//! `aphrody git` — native Git inspection, GitHub API, and ecosystem rollout.

use std::{path::PathBuf, str::FromStr};

use aphrody_git::{
    ApiMethod, GitHubClient, GitHubRepository, HistoryOptions, InstallMode,
    audit_ecosystem_workflows, inspect_repository, install_consumer_workflow, repository_history,
    rollout_ecosystem_workflows,
};
use serde_json::{Value, json};

/// Native Git/GitHub operations.
#[derive(clap::Subcommand, Debug, Clone)]
pub(crate) enum GitAction {
    /// Inspect branch, HEAD, remotes, status, ahead/behind remote branches, recent log and
    /// change hotspots with pure-Rust gix.
    Inspect {
        /// Any path inside the repository.
        #[arg(default_value = ".")]
        path: PathBuf,
        /// Recent first-parent commits to list.
        #[arg(long, default_value_t = 10)]
        log: usize,
        /// Most changed files to list (0 disables the scan).
        #[arg(long, default_value_t = 10)]
        hotspots: usize,
        /// First-parent commits scanned for hotspots.
        #[arg(long, default_value_t = 200)]
        window: usize,
        /// Revision to count ahead/behind against (repeatable, e.g. upstream/main). Default:
        /// the tracking branch and every <remote>/<branch> of the current branch.
        #[arg(long)]
        against: Vec<String>,
        /// Pretty-print JSON.
        #[arg(long)]
        pretty: bool,
    },
    /// Fetch canonical GitHub repository metadata.
    Repo {
        /// `owner/name` or GitHub remote URL. Inferred from `--path` if omitted.
        repository: Option<String>,
        /// Local repository used for inference.
        #[arg(long, default_value = ".")]
        path: PathBuf,
        /// Pretty-print JSON.
        #[arg(long)]
        pretty: bool,
    },
    /// Call any GitHub REST endpoint through authenticated Octocrab.
    Api {
        /// HTTP method: GET, POST, PATCH, PUT, DELETE.
        #[arg(long, default_value = "GET")]
        method: String,
        /// API route such as `/repos/aphrody-code/aphrody-ai/actions/runs`.
        route: String,
        /// JSON body, or `@path/to/body.json`.
        #[arg(long)]
        body: Option<String>,
        /// Apply a mutating method. Without this flag, emit a plan only.
        #[arg(long)]
        apply: bool,
        /// Pretty-print JSON.
        #[arg(long)]
        pretty: bool,
    },
    /// Call the GitHub GraphQL endpoint.
    Graphql {
        /// JSON payload, or `@path/to/payload.json`.
        payload: String,
        /// Required when the payload contains a GraphQL mutation.
        #[arg(long)]
        apply: bool,
        /// Pretty-print JSON.
        #[arg(long)]
        pretty: bool,
    },
    /// Install the thin reusable-workflow caller into local repositories.
    Install {
        /// Repository roots to configure.
        #[arg(required = true)]
        repositories: Vec<PathBuf>,
        /// Aphrody ref used by the reusable workflow (`main`, tag, or SHA).
        #[arg(long, default_value = "main")]
        source_ref: String,
        /// Write changes. Without this flag, emit a plan only.
        #[arg(long)]
        apply: bool,
        /// Pretty-print JSON.
        #[arg(long)]
        pretty: bool,
    },
    /// Audit managed CI coverage across all active repositories owned by an account.
    Audit {
        /// GitHub user or organization that owns the repositories.
        #[arg(default_value = "aphrody-code")]
        owner: String,
        /// Aphrody ref expected by the reusable workflow.
        #[arg(long, default_value = "main")]
        source_ref: String,
        /// Include forked repositories in the audit.
        #[arg(long)]
        include_forks: bool,
        /// Pretty-print JSON.
        #[arg(long)]
        pretty: bool,
    },
    /// Roll out managed CI to active GitHub repositories owned by an account.
    Rollout {
        /// GitHub user or organization that owns the repositories.
        #[arg(default_value = "aphrody-code")]
        owner: String,
        /// Limit rollout to these repository names; omitted means every eligible repository.
        #[arg(long = "repository")]
        repositories: Vec<String>,
        /// Aphrody ref used by the reusable workflow (`main`, tag, or SHA).
        #[arg(long, default_value = "main")]
        source_ref: String,
        /// Include forked repositories in the rollout.
        #[arg(long)]
        include_forks: bool,
        /// Commit workflow changes through the GitHub Contents API.
        #[arg(long)]
        apply: bool,
        /// Pretty-print JSON.
        #[arg(long)]
        pretty: bool,
    },
    /// Ingest a Git repository or local directory into a prompt-ready LLM digest (GitIngest standard).
    Ingest {
        /// Git repository URL or local directory path.
        #[arg(default_value = ".")]
        source: String,
        /// Maximum allowed file size in bytes (default: 10MB).
        #[arg(short = 's', long, default_value_t = 10_485_760)]
        max_size: u64,
        /// Include file patterns (e.g. --include "*.py" --include "*.rs").
        #[arg(long = "include")]
        include: Vec<String>,
        /// Exclude file patterns (e.g. -e "tests/*").
        #[arg(short = 'e', long = "exclude")]
        exclude: Vec<String>,
        /// Git branch to ingest.
        #[arg(short = 'b', long)]
        branch: Option<String>,
        /// Git tag to ingest.
        #[arg(long)]
        tag: Option<String>,
        /// Subpath within the repository.
        #[arg(long)]
        subpath: Option<String>,
        /// Personal access token for private repositories.
        #[arg(short = 't', long)]
        token: Option<String>,
        /// Output file path, or "-" for stdout (default: stdout).
        #[arg(short = 'o', long)]
        output: Option<String>,
        /// Output structured JSON metadata instead of raw digest text.
        #[arg(long)]
        json: bool,
    },
    /// Search GitHub repositories for documentation, llms.txt, and code digests.
    Search {
        /// Search query (e.g. "gitingest", "ratatui", "tokio-rs").
        query: String,
        /// Max number of top repositories to inspect (default: 3).
        #[arg(short = 'l', long, default_value_t = 3)]
        limit: usize,
        /// Include full GitIngest digest for repositories lacking llms.txt.
        #[arg(short = 'd', long)]
        digest: bool,
        /// Pretty-print JSON instead of Markdown.
        #[arg(long)]
        json: bool,
    },
    /// Upstream source checkouts outside the repository (tools/config/upstream-sources.json).
    Source {
        /// `status` and `verify` inspect natively; `sync` runs the @aphrody/workspace restorer.
        #[arg(value_enum, default_value = "status")]
        action: SourceAction,
        /// Repository root holding the manifest.
        #[arg(long, default_value = ".")]
        path: PathBuf,
        /// Override the source root (also APHRODY_SOURCE_ROOT).
        #[arg(long)]
        source_root: Option<PathBuf>,
        /// `sync` only: clone, extract and patch instead of printing a plan.
        #[arg(long)]
        apply: bool,
        /// Pretty-print JSON.
        #[arg(long)]
        pretty: bool,
    },
    /// Live read-only access to the upstream catalogue (tools/config/upstream-sources.json), no clone needed.
    Upstream {
        /// `list` the catalogue, or `info`, `tree`, `read`, `search` one upstream through the GitHub API.
        #[arg(value_enum, default_value = "list")]
        action: UpstreamAction,
        /// Upstream id (see `list`).
        id: Option<String>,
        /// Directory or file path (`tree`, `read`) or the query (`search`).
        arg: Option<String>,
        /// Repository root holding the manifest.
        #[arg(long, default_value = ".")]
        path: PathBuf,
        /// Pretty-print JSON.
        #[arg(long)]
        pretty: bool,
    },
    /// Audit and strip AI attributions, co-authors, and trailers from Git commits.
    Attribution {
        /// Repository path (ops.ts is resolved from `APHRODY_ROOT`, else the current directory).
        #[arg(long, default_value = ".")]
        repo: PathBuf,
        /// Branch name.
        #[arg(long, default_value = "main")]
        branch: String,
        /// Filter commits starting from this reference.
        #[arg(long)]
        since: Option<String>,
        /// Rewrite author and committer to canonical Aphrody identities.
        #[arg(long)]
        canonical_author: bool,
        /// Target canonical author name (owner identity).
        #[arg(long, default_value = "aphrody-code")]
        author_name: String,
        /// Target canonical author email (defaults to contact@aphrody.com).
        #[arg(long, default_value = "contact@aphrody.com")]
        author_email: String,
        /// Apply branch rewrite. Without this flag, emit a dry-run plan only.
        #[arg(long)]
        apply: bool,
    },
    /// Audit public web surfaces, products and repositories for private AI leaks.
    CleanPublic {
        /// Monorepo root.
        #[arg(long, default_value = ".")]
        root: PathBuf,
    },
}

/// Operation on the upstream catalogue.
#[derive(clap::ValueEnum, Debug, Clone, Copy)]
pub(crate) enum UpstreamAction {
    /// Every catalogue entry with its tier and purpose.
    List,
    /// Repository facts, head of the followed ref, latest release, gap to the observed commit.
    Info,
    /// Directory listing at the followed ref.
    Tree,
    /// One file at the followed ref.
    Read,
    /// Code search inside the upstream.
    Search,
}

/// Operation on the upstream source manifest.
#[derive(clap::ValueEnum, Debug, Clone, Copy)]
pub(crate) enum SourceAction {
    /// Report every checkout.
    Status,
    /// Report and fail unless every checkout is healthy.
    Verify,
    /// Restore missing checkouts and patches.
    Sync,
}

pub(crate) async fn run(action: GitAction) -> miette::Result<()> {
    match action {
        GitAction::Inspect { path, log, hotspots, window, against, pretty } => {
            let snapshot = inspect_repository(&path).map_err(to_report)?;
            let history = repository_history(
                &path,
                &HistoryOptions {
                    log,
                    hotspots,
                    window: if hotspots == 0 { 0 } else { window },
                    against,
                },
            )
            .map_err(to_report)?;
            let mut value = serde_json::to_value(snapshot).map_err(to_report)?;
            if let (Some(object), Value::Object(extra)) =
                (value.as_object_mut(), serde_json::to_value(history).map_err(to_report)?)
            {
                object.extend(extra);
            }
            emit(&value, pretty)?;
        },
        GitAction::Repo { repository, path, pretty } => {
            let repository = match repository {
                Some(value) => GitHubRepository::parse(&value).map_err(to_report)?,
                None => inspect_repository(path)
                    .map_err(to_report)?
                    .github
                    .ok_or_else(|| miette::miette!("no GitHub remote found"))?,
            };
            let client = GitHubClient::from_env().map_err(to_report)?;
            let metadata = client.repository(&repository).await.map_err(to_report)?;
            emit(&metadata, pretty)?;
        },
        GitAction::Api { method, route, body, apply, pretty } => {
            let method = ApiMethod::from_str(&method).map_err(to_report)?;
            let body = body.as_deref().map(read_json).transpose()?;
            if method.is_mutating() && !apply {
                emit(
                    &json!({
                        "planned": true,
                        "method": method,
                        "route": route,
                        "body": body,
                        "hint": "pass --apply to execute this mutating request"
                    }),
                    pretty,
                )?;
            } else {
                let client = GitHubClient::from_env().map_err(to_report)?;
                let response =
                    client.request(method, &route, body.as_ref()).await.map_err(to_report)?;
                emit(&serde_json::to_value(response).map_err(to_report)?, pretty)?;
            }
        },
        GitAction::Graphql { payload, apply, pretty } => {
            let payload = read_json(&payload)?;
            let is_mutation = graphql_may_mutate(&payload);
            if is_mutation && !apply {
                emit(
                    &json!({
                        "planned": true,
                        "payload": payload,
                        "hint": "pass --apply to execute this GraphQL mutation"
                    }),
                    pretty,
                )?;
            } else {
                let client = GitHubClient::from_env().map_err(to_report)?;
                let response = client.graphql(&payload).await.map_err(to_report)?;
                emit(&response, pretty)?;
            }
        },
        GitAction::Install { repositories, source_ref, apply, pretty } => {
            let mode = if apply { InstallMode::Apply } else { InstallMode::Plan };
            let outcomes = repositories
                .into_iter()
                .map(|repository| {
                    install_consumer_workflow(repository, &source_ref, mode).map_err(to_report)
                })
                .collect::<miette::Result<Vec<_>>>()?;
            emit(&serde_json::to_value(outcomes).map_err(to_report)?, pretty)?;
        },
        GitAction::Audit { owner, source_ref, include_forks, pretty } => {
            let client = GitHubClient::from_env().map_err(to_report)?;
            let outcomes = audit_ecosystem_workflows(&client, &owner, &source_ref, include_forks)
                .await
                .map_err(to_report)?;
            emit(&serde_json::to_value(outcomes).map_err(to_report)?, pretty)?;
        },
        GitAction::Rollout { owner, repositories, source_ref, include_forks, apply, pretty } => {
            let client = GitHubClient::from_env().map_err(to_report)?;
            let mode = if apply { InstallMode::Apply } else { InstallMode::Plan };
            let outcomes = rollout_ecosystem_workflows(
                &client,
                &owner,
                &source_ref,
                include_forks,
                &repositories,
                mode,
            )
            .await
            .map_err(to_report)?;
            emit(&serde_json::to_value(outcomes).map_err(to_report)?, pretty)?;
        },
        GitAction::Ingest {
            source,
            max_size,
            include,
            exclude,
            branch,
            tag,
            subpath,
            token,
            output,
            json,
        } => {
            let options = aphrody_git::IngestOptions {
                max_file_size: max_size,
                include_patterns: include,
                exclude_patterns: exclude,
                branch,
                tag,
                subpath,
                token,
                include_gitignored: false,
                include_submodules: false,
            };
            if !aphrody_git::is_remote_source(&source) {
                return Err(miette::miette!(
                    "local directory ingestion moved to the `git_ingest` tool of `bun mcp` (Bun fork)"
                ));
            }
            let ingest_result =
                aphrody_git::ingest_remote(source.trim(), &options).map_err(to_report)?;
            if json {
                emit(&serde_json::to_value(&ingest_result).map_err(to_report)?, true)?;
            } else {
                let context = ingest_result.full_context();
                if let Some(out_path) = output {
                    if out_path == "-" {
                        print!("{context}");
                    } else {
                        std::fs::write(&out_path, &context)
                            .map_err(|e| miette::miette!("write output to `{out_path}`: {e}"))?;
                        eprintln!(
                            "Digest written to {} ({} files, {} tokens)",
                            out_path, ingest_result.file_count, ingest_result.formatted_tokens
                        );
                    }
                } else {
                    print!("{context}");
                }
            }
        },
        GitAction::Search { query, limit, digest, json } => {
            let report =
                aphrody_git::search_github_docs(&query, limit, digest).await.map_err(to_report)?;
            if json {
                emit(&serde_json::to_value(&report).map_err(to_report)?, true)?;
            } else {
                println!("{}", report.to_markdown());
            }
        },
        GitAction::Source { action, path, source_root, apply, pretty } => {
            if matches!(action, SourceAction::Sync) {
                let mut command = std::process::Command::new("bun");
                command
                    .arg(path.join("packages/infra/workspace/src/ops.ts"))
                    .args(["upstream-sources", "sync", "--root"])
                    .arg(&path);
                if let Some(root) = &source_root {
                    command.arg("--source-root").arg(root);
                }
                if apply {
                    command.arg("--apply");
                }
                let status =
                    command.status().map_err(|error| miette::miette!("run bun: {error}"))?;
                if !status.success() {
                    return Err(miette::miette!("upstream-sources sync failed ({status})"));
                }
                return Ok(());
            }
            let report =
                aphrody_git::source_report(&path, source_root.as_deref()).map_err(to_report)?;
            emit(&serde_json::to_value(&report).map_err(to_report)?, pretty)?;
            if matches!(action, SourceAction::Verify) && !report.is_healthy() {
                return Err(miette::miette!("upstream sources are not all healthy"));
            }
        },
        GitAction::Upstream { action, id, arg, path, pretty } => {
            let entries = aphrody_git::upstream::catalogue(&path).map_err(to_report)?;
            if matches!(action, UpstreamAction::List) {
                emit(&serde_json::to_value(&entries).map_err(to_report)?, pretty)?;
                return Ok(());
            }
            let id =
                id.ok_or_else(|| miette::miette!("an upstream id is required (see `list`)"))?;
            let entry = aphrody_git::upstream::find(&entries, &id).map_err(to_report)?;
            let client = GitHubClient::from_env().map_err(to_report)?;
            let value = match action {
                UpstreamAction::List => unreachable!("handled above"),
                UpstreamAction::Info => aphrody_git::upstream::info(&client, entry).await,
                UpstreamAction::Tree => {
                    aphrody_git::upstream::tree(&client, entry, arg.as_deref().unwrap_or("")).await
                },
                UpstreamAction::Read => {
                    let file = arg.ok_or_else(|| miette::miette!("`read` needs a file path"))?;
                    aphrody_git::upstream::read(&client, entry, &file).await
                },
                UpstreamAction::Search => {
                    let query = arg.ok_or_else(|| miette::miette!("`search` needs a query"))?;
                    aphrody_git::upstream::search(&client, entry, &query).await
                },
            }
            .map_err(to_report)?;
            emit(&value, pretty)?;
        },
        GitAction::Attribution {
            repo,
            branch,
            since,
            canonical_author,
            author_name,
            author_email,
            apply,
        } => {
            let ops = std::env::var_os("APHRODY_ROOT")
                .map(PathBuf::from)
                .unwrap_or_else(|| PathBuf::from("."))
                .join("packages/infra/workspace/src/ops.ts");
            let mut command = std::process::Command::new("bun");
            command
                .arg(ops)
                .arg("git-attribution")
                .arg("--repo")
                .arg(&repo)
                .arg("--branch")
                .arg(&branch);
            if let Some(s) = since {
                command.arg("--since").arg(s);
            }
            if canonical_author {
                command.arg("--canonical-author");
            }
            command.arg("--author-name").arg(&author_name).arg("--author-email").arg(&author_email);
            if apply {
                command.arg("--apply");
            }
            let status = command
                .status()
                .map_err(|error| miette::miette!("run bun git-attribution: {error}"))?;
            if !status.success() {
                return Err(miette::miette!("git attribution check/strip failed ({status})"));
            }
        },
        GitAction::CleanPublic { root } => {
            let mut command = std::process::Command::new("bun");
            command
                .arg(root.join("packages/infra/workspace/src/ops.ts"))
                .arg("clean-public-ai")
                .arg("--root")
                .arg(&root);
            let status = command
                .status()
                .map_err(|error| miette::miette!("run bun clean-public-ai: {error}"))?;
            if !status.success() {
                return Err(miette::miette!("clean-public-ai check failed ({status})"));
            }
        },
    }
    Ok(())
}

fn read_json(input: &str) -> miette::Result<Value> {
    let text = if let Some(path) = input.strip_prefix('@') {
        std::fs::read_to_string(path)
            .map_err(|error| miette::miette!("read JSON file `{path}`: {error}"))?
    } else {
        input.to_owned()
    };
    serde_json::from_str(&text).map_err(|error| miette::miette!("parse JSON: {error}"))
}

fn graphql_may_mutate(payload: &Value) -> bool {
    let Some(query) = payload.get("query").and_then(Value::as_str) else {
        // Persisted queries cannot be classified locally, so require the explicit gate.
        return true;
    };
    query
        .split(|character: char| !(character.is_ascii_alphanumeric() || character == '_'))
        .any(|token| token == "mutation")
}

fn emit(value: &Value, pretty: bool) -> miette::Result<()> {
    let rendered =
        if pretty { serde_json::to_string_pretty(value) } else { serde_json::to_string(value) }
            .map_err(|error| miette::miette!("serialize JSON: {error}"))?;
    println!("{rendered}");
    Ok(())
}

fn to_report(error: impl std::fmt::Display) -> miette::Report {
    miette::miette!("{error}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn graphql_mutation_gate_is_conservative() {
        assert!(graphql_may_mutate(&json!({"extensions": {"persistedQuery": {}}})));
        assert!(graphql_may_mutate(&json!({
            "query": "# operation follows\nmutation Update { addStar(input: {}) { clientMutationId } }"
        })));
        assert!(graphql_may_mutate(&json!({
            "query": "query Read { viewer { login } } mutation Write { __typename }"
        })));
        assert!(!graphql_may_mutate(&json!({"query": "{ viewer { login } }"})));
    }
}
