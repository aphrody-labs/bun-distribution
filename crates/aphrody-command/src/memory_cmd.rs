// SPDX-License-Identifier: Apache-2.0
// `aphrody memory migrate` — Tier-1 provider-to-provider migration (R3.4 wire).
//
// Wraps the dyn-compatible `aphrody_memory::migrate` lib API into a CLI surface
// that callers can drive without writing Rust. The three shipped Tier-1
// providers (Mem0, Honcho, SqliteLocal) all implement `MemoryProvider`,
// so any pair can be wired up — HTTP creds come from environment variables
// documented in the per-provider modules.
//
// Verify: `aphrody memory migrate --from sqlite_local --to honcho
//         --from-sqlite-path ./var/memory.sqlite
//         --agent-id agent-A --dry-run` returns a MigrationDiff JSON.

use std::path::{Path, PathBuf};

use aphrody_config::CliOverrides;
use aphrody_memory::{
    HonchoProvider, Mem0Provider, MemoryProvider, SqliteLocalProvider, migrate_provider,
};
use async_trait::async_trait;
use miette::{IntoDiagnostic, WrapErr};

use crate::context::{GoogleContext, TerminalCommand};

/// Picker mirroring the Tier-1 `MemoryProvider` implementations.
///
/// The kebab-case rename matches `aphrody_memory::ProviderKind` snake_case
/// (`mem0`, `honcho`, `sqlite_local`) so the CLI surface stays
/// consistent with the discriminator returned by `provider_kind()`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, clap::ValueEnum)]
pub(crate) enum MemoryProviderArg {
    /// Hosted Mem0 cloud — reads `MEM0_API_KEY` from the environment.
    Mem0,
    /// Hosted Honcho v1 — reads `HONCHO_API_KEY` from the environment.
    Honcho,
    /// Offline rusqlite store — `--from-sqlite-path` / `--to-sqlite-path`.
    SqliteLocal,
    /// Removed LanceDB provider; selecting it fails with an explanatory error.
    LanceDb,
}

/// `aphrody memory migrate` dispatch.
pub(crate) struct MigrateCommand {
    pub from: MemoryProviderArg,
    pub to: MemoryProviderArg,
    pub agent_id: String,
    pub dry_run: bool,
    pub json: bool,
    pub pretty: bool,
    pub from_sqlite_path: Option<PathBuf>,
    pub to_sqlite_path: Option<PathBuf>,
    /// Filesystem path for the source LanceDB store (lancedb only).
    pub from_lancedb_path: Option<PathBuf>,
    /// Filesystem path for the target LanceDB store (lancedb only).
    pub to_lancedb_path: Option<PathBuf>,
    /// Embedding dimensionality for LanceDB backends (required when either end
    /// is `lancedb`; defaults to 768 which matches standard embedding models).
    pub lancedb_ndims: usize,
}

#[async_trait]
impl TerminalCommand for MigrateCommand {
    async fn execute(&self, _ctx: &GoogleContext) -> miette::Result<()> {
        if self.agent_id.trim().is_empty() {
            return Err(miette::miette!(
                "memory migrate: --agent-id is required and cannot be empty"
            ));
        }
        if self.from == MemoryProviderArg::SqliteLocal
            && self.to == MemoryProviderArg::SqliteLocal
            && self.from_sqlite_path == self.to_sqlite_path
        {
            return Err(miette::miette!(
                "memory migrate: when --from and --to are both sqlite-local, --from-sqlite-path \
                 and --to-sqlite-path must point to distinct files (refusing to copy a sqlite \
                 onto itself)"
            ));
        }
        if self.from == MemoryProviderArg::LanceDb
            && self.to == MemoryProviderArg::LanceDb
            && self.from_lancedb_path == self.to_lancedb_path
        {
            return Err(miette::miette!(
                "memory migrate: when --from and --to are both lancedb, --from-lancedb-path and \
                 --to-lancedb-path must point to distinct directories (refusing to copy a lancedb \
                 store onto itself)"
            ));
        }

        let from: Box<dyn MemoryProvider> = build_provider(
            self.from,
            self.from_sqlite_path.as_deref(),
            self.from_lancedb_path.as_deref(),
            self.lancedb_ndims,
        )
        .await
        .wrap_err("failed to build --from provider")?;
        let to: Box<dyn MemoryProvider> = build_provider(
            self.to,
            self.to_sqlite_path.as_deref(),
            self.to_lancedb_path.as_deref(),
            self.lancedb_ndims,
        )
        .await
        .wrap_err("failed to build --to provider")?;

        let diff = migrate_provider(from.as_ref(), to.as_ref(), &self.agent_id, self.dry_run)
            .await
            .map_err(|e| miette::miette!("memory migrate: {e}"))?;

        if self.json {
            let out = if self.pretty {
                serde_json::to_string_pretty(&diff)
            } else {
                serde_json::to_string(&diff)
            }
            .into_diagnostic()
            .wrap_err("JSON encode failed")?;
            println!("{out}");
        } else {
            // Human-readable summary — keeps the structured diff one line
            // away so jq still works on the stdout stream when --json is set.
            println!(
                "memory migrate {} → {} [agent={}] {}",
                diff.from.as_str(),
                diff.to.as_str(),
                diff.agent_id,
                if diff.dry_run { "(dry-run)" } else { "(applied)" },
            );
            println!("  source   : {} records", diff.source_count);
            println!("  target   : {} records before", diff.target_count_before);
            println!(
                "  migrated : {}{}",
                diff.migrated,
                if diff.dry_run { " (intent only)" } else { "" }
            );
            if diff.skipped > 0 {
                println!("  skipped  : {}", diff.skipped);
                for (id, reason) in diff.skipped_ids.iter().take(10) {
                    println!("    - {id}: {reason}");
                }
                if diff.skipped_ids.len() > 10 {
                    println!("    … {} more", diff.skipped_ids.len() - 10);
                }
            }
        }
        Ok(())
    }
}

/// Build a `Box<dyn MemoryProvider>` from a CLI selector + optional backend paths.
///
/// HTTP providers read their credentials from env vars (documented per module
/// in `aphrody-memory`); failure to find a key surfaces as a structured
/// `MemoryError::MissingConfig` that bubbles up here as a `miette::Report`.
///
/// `lancedb_ndims` is only used when `kind == LanceDb`.
async fn build_provider(
    kind: MemoryProviderArg,
    sqlite_path: Option<&Path>,
    lancedb_path: Option<&Path>,
    lancedb_ndims: usize,
) -> miette::Result<Box<dyn MemoryProvider>> {
    match kind {
        MemoryProviderArg::Mem0 => {
            let p = Mem0Provider::from_env().map_err(|e| miette::miette!("mem0: {e}"))?;
            Ok(Box::new(p))
        },
        MemoryProviderArg::Honcho => {
            let p = HonchoProvider::from_env().map_err(|e| miette::miette!("honcho: {e}"))?;
            Ok(Box::new(p))
        },
        MemoryProviderArg::SqliteLocal => {
            let path = sqlite_path.map(Path::to_path_buf).unwrap_or_else(default_sqlite_path);
            // Ensure parent dir exists so `~/.aphrody/memory.sqlite` works
            // on a fresh install without `mkdir -p` first.
            if let Some(parent) = path.parent()
                && !parent.as_os_str().is_empty()
            {
                std::fs::create_dir_all(parent).into_diagnostic().wrap_err_with(|| {
                    format!("failed to create parent dir {}", parent.display())
                })?;
            }
            let p = SqliteLocalProvider::open(&path)
                .map_err(|e| miette::miette!("sqlite_local: {e} (path={})", path.display()))?;
            Ok(Box::new(p))
        },
        MemoryProviderArg::LanceDb => {
            let _ = (lancedb_path, lancedb_ndims);
            Err(miette::miette!(
                "the LanceDB memory provider was removed; use sqlite_local, mem0 or honcho"
            ))
        },
    }
}

/// Where a local memory operation reads and writes.
#[derive(clap::Args, Debug, Clone)]
pub(crate) struct LocalStoreArgs {
    /// SQLite memory file, created when absent (mode 0600 on Unix). Default: the
    /// local memory database of the active profile.
    #[arg(long)]
    pub db: Option<PathBuf>,
    /// Logical owner of the records (one agent, one user).
    #[arg(long)]
    pub agent_id: String,
    /// Pretty-print the JSON answer.
    #[arg(long)]
    pub pretty: bool,
}

/// `aphrody memory write|recall|list|delete|clear`: an application's local
/// memory file, as JSON on stdout (`aphrody_memory::local_ops`).
#[derive(clap::Subcommand, Debug, Clone)]
pub(crate) enum LocalMemoryAction {
    /// Store one memory; prints `{"id": …}`. An existing `--id` is replaced.
    Write {
        #[command(flatten)]
        store: LocalStoreArgs,
        /// Memory text; `-` reads it from stdin.
        #[arg(long)]
        content: String,
        /// Label, repeatable.
        #[arg(long = "tag")]
        tags: Vec<String>,
        /// JSON object kept with the record.
        #[arg(long)]
        metadata: Option<String>,
        /// Record id to create or replace.
        #[arg(long)]
        id: Option<String>,
    },
    /// Records best matching `--query` (lexical); prints `{"records": [… "score"]}`.
    Recall {
        #[command(flatten)]
        store: LocalStoreArgs,
        /// What to remember.
        #[arg(long)]
        query: String,
        /// Only records carrying every tag.
        #[arg(long = "tag")]
        tags: Vec<String>,
        /// Maximum records (default 20).
        #[arg(long)]
        limit: Option<u32>,
    },
    /// Records newest first; prints `{"records": […]}`.
    List {
        #[command(flatten)]
        store: LocalStoreArgs,
        /// Only records carrying every tag.
        #[arg(long = "tag")]
        tags: Vec<String>,
        /// Maximum records (default 20).
        #[arg(long)]
        limit: Option<u32>,
    },
    /// Delete one record; prints `{"deleted": bool}`.
    Delete {
        /// SQLite memory file. Default: the local memory database of the active profile.
        #[arg(long)]
        db: Option<PathBuf>,
        /// Record id.
        #[arg(long)]
        id: String,
        /// Refuse a record owned by another agent.
        #[arg(long)]
        agent_id: Option<String>,
        /// Pretty-print the JSON answer.
        #[arg(long)]
        pretty: bool,
    },
    /// Delete every record of `--agent-id`; prints `{"deleted": n}`.
    Clear {
        #[command(flatten)]
        store: LocalStoreArgs,
    },
}

fn open_local(
    db: Option<PathBuf>,
    overrides: &CliOverrides,
) -> miette::Result<SqliteLocalProvider> {
    let path = match db {
        Some(path) => path,
        None => profile_sqlite_path(overrides)?,
    };
    if let Some(parent) = path.parent().filter(|parent| !parent.as_os_str().is_empty()) {
        std::fs::create_dir_all(parent)
            .into_diagnostic()
            .wrap_err_with(|| format!("failed to create {}", parent.display()))?;
    }
    let created = !path.exists();
    let provider = SqliteLocalProvider::open(&path)
        .map_err(|e| miette::miette!("memory: {e} (path={})", path.display()))?;
    #[cfg(unix)]
    if created {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600));
    }
    #[cfg(not(unix))]
    let _ = created;
    Ok(provider)
}

fn print_json(value: &serde_json::Value, pretty: bool) -> miette::Result<()> {
    let text =
        if pretty { serde_json::to_string_pretty(value) } else { serde_json::to_string(value) }
            .into_diagnostic()?;
    println!("{text}");
    Ok(())
}

/// Run one local memory operation.
pub(crate) async fn execute_local(
    action: LocalMemoryAction,
    overrides: &CliOverrides,
) -> miette::Result<()> {
    use aphrody_memory::local_ops;
    let fail = |e: aphrody_memory::ProviderMemoryError| miette::miette!("memory: {e}");
    match action {
        LocalMemoryAction::Write { store, content, tags, metadata, id } => {
            let content = if content == "-" {
                std::io::read_to_string(std::io::stdin()).into_diagnostic()?
            } else {
                content
            };
            let metadata = metadata
                .map(|text| serde_json::from_str::<serde_json::Value>(&text))
                .transpose()
                .into_diagnostic()
                .wrap_err("--metadata must be JSON")?;
            let provider = open_local(store.db, overrides)?;
            let id = local_ops::write(&provider, &store.agent_id, &content, tags, metadata, id)
                .await
                .map_err(fail)?;
            print_json(&serde_json::json!({ "id": id }), store.pretty)
        },
        LocalMemoryAction::Recall { store, query, tags, limit } => {
            let provider = open_local(store.db, overrides)?;
            let records = local_ops::recall(&provider, &store.agent_id, &query, tags, limit)
                .await
                .map_err(fail)?;
            print_json(&serde_json::json!({ "records": records }), store.pretty)
        },
        LocalMemoryAction::List { store, tags, limit } => {
            let provider = open_local(store.db, overrides)?;
            let records =
                local_ops::list(&provider, &store.agent_id, tags, limit).await.map_err(fail)?;
            print_json(&serde_json::json!({ "records": records }), store.pretty)
        },
        LocalMemoryAction::Delete { db, id, agent_id, pretty } => {
            let provider = open_local(db, overrides)?;
            let deleted =
                local_ops::delete(&provider, &id, agent_id.as_deref()).await.map_err(fail)?;
            print_json(&serde_json::json!({ "deleted": deleted }), pretty)
        },
        LocalMemoryAction::Clear { store } => {
            let provider = open_local(store.db, overrides)?;
            let deleted = local_ops::clear(&provider, &store.agent_id).await.map_err(fail)?;
            print_json(&serde_json::json!({ "deleted": deleted }), store.pretty)
        },
    }
}

/// Default offline SQLite store location — `$HOME/.aphrody/memory.sqlite`.
/// Falls back to `./memory.sqlite` if the home directory cannot be resolved.
fn default_sqlite_path() -> PathBuf {
    // Root from `aphrody_models::paths`, the single authority.
    aphrody_models::paths::state_file("memory.sqlite")
        .unwrap_or_else(|_| PathBuf::from("memory.sqlite"))
}

/// Resolve the implicit local-memory database for the selected Home Agent
/// profile. The legacy global path remains stable when no profile is active.
pub(crate) fn profile_sqlite_path(overrides: &CliOverrides) -> miette::Result<PathBuf> {
    let mut overrides = overrides.clone();
    overrides.profile = aphrody_config::profile::select_profile(
        overrides.profile.as_deref(),
        std::env::var(aphrody_config::profile::ENV_APHRODY_PROFILE).ok().as_deref(),
    );
    let config = crate::profile::load_config(&overrides)?;
    if config.active_profile.is_none() {
        return Ok(default_sqlite_path());
    }
    let root = crate::profile::profile_state_root(&config)?;
    let services = aphrody_agent_home::ProfileServiceContext::from_config(root, &config)
        .map_err(|error| miette::miette!("memory profile: {error}"))?;
    services.local_memory_path().map(Path::to_path_buf).ok_or_else(|| {
        miette::miette!(
            "memory profile: database.cache=sqlite_wal is required for local memory with \
             PostgreSQL"
        )
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_sqlite_path_under_home_when_available() {
        let p = default_sqlite_path();
        assert_eq!(p.file_name().and_then(|s| s.to_str()), Some("memory.sqlite"));
    }

    fn make_cmd(
        from: MemoryProviderArg,
        to: MemoryProviderArg,
        agent_id: &str,
        from_sqlite_path: Option<PathBuf>,
        to_sqlite_path: Option<PathBuf>,
        from_lancedb_path: Option<PathBuf>,
        to_lancedb_path: Option<PathBuf>,
    ) -> MigrateCommand {
        MigrateCommand {
            from,
            to,
            agent_id: agent_id.into(),
            dry_run: true,
            json: true,
            pretty: false,
            from_sqlite_path,
            to_sqlite_path,
            from_lancedb_path,
            to_lancedb_path,
            lancedb_ndims: 768,
        }
    }

    #[tokio::test]
    async fn migrate_rejects_empty_agent_id() {
        let cmd = make_cmd(
            MemoryProviderArg::SqliteLocal,
            MemoryProviderArg::SqliteLocal,
            "   ",
            Some(PathBuf::from("a.db")),
            Some(PathBuf::from("b.db")),
            None,
            None,
        );
        assert!(cmd.agent_id.trim().is_empty());
    }

    #[test]
    fn migrate_rejects_same_sqlite_path_both_ends() {
        let same = PathBuf::from("only.db");
        let cmd = make_cmd(
            MemoryProviderArg::SqliteLocal,
            MemoryProviderArg::SqliteLocal,
            "agent-A",
            Some(same.clone()),
            Some(same),
            None,
            None,
        );
        let both_sqlite =
            cmd.from == MemoryProviderArg::SqliteLocal && cmd.to == MemoryProviderArg::SqliteLocal;
        assert!(both_sqlite);
        assert_eq!(cmd.from_sqlite_path, cmd.to_sqlite_path);
    }

    #[test]
    fn migrate_rejects_same_lancedb_path_both_ends() {
        let same = PathBuf::from("./data/lancedb");
        let cmd = make_cmd(
            MemoryProviderArg::LanceDb,
            MemoryProviderArg::LanceDb,
            "agent-A",
            None,
            None,
            Some(same.clone()),
            Some(same),
        );
        let both_lance =
            cmd.from == MemoryProviderArg::LanceDb && cmd.to == MemoryProviderArg::LanceDb;
        assert!(both_lance);
        assert_eq!(cmd.from_lancedb_path, cmd.to_lancedb_path);
    }
}
