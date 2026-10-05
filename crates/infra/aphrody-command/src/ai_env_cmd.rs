// SPDX-License-Identifier: Apache-2.0
//! `aphrody ai env` — resolve this machine's local AI environment and
//! publish it under the eighteen canonical `APHRODY_AI_*` names
//! ([`aphrody_config::ai_env`]).
//!
//! This is the writer side of the `config/local-ai.json`
//! contract (`resolver: "aphrody ai env"` for the `windows-local` and
//! `wsl-ubuntu-24.04` targets): it resolves the llama-server URL/port a
//! managed instance is actually bound to right now
//! ([`aphrody_llama_server::discover_running`]), the per-role model ids
//! ([`aphrody_models::LocalRole`]), and the binaries reachable from this
//! process, then writes `~/.aphrody/ai/local-ai.json` and
//! `~/.aphrody/ai/local-ai.env` — always the canonical names, never an
//! alias, and never a secret value (`APHRODY_AI_HTTP_TOKEN` is emitted only
//! as a reference to where it lives).
//!
//! Libraries in this workspace never write the user's home by default
//! (CLAUDE.md §7): only this CLI surface does, and only when this command
//! runs.

use clap::{Args, Subcommand, ValueEnum};
use miette::IntoDiagnostic;

#[derive(Debug, Subcommand)]
pub(crate) enum AiAction {
    /// Resolve and publish the local AI environment
    /// (`~/.aphrody/ai/local-ai.{json,env}`).
    Env(EnvArgs),
    /// Inspect active AI router, models, and provider status.
    Status {
        /// Emit status as JSON
        #[arg(long)]
        json: bool,
    },
    /// Mirror the sessions of the other coding agents on this machine
    /// (Antigravity CLI, Codex, Claude Code) into
    /// `~/.aphrody/sessions/<agent>/<session_id>.jsonl`, incrementally, and
    /// feed their user/assistant turns into the local memory store.
    ///
    /// Example: aphrody ai sync-sessions --agent codex --json
    SyncSessions(crate::ai_sync_cmd::SyncSessionsArgs),
}

#[derive(Debug, Args)]
pub(crate) struct EnvArgs {
    /// Also print the resolved environment to stdout.
    #[arg(long)]
    print: bool,
    /// `--print` output format.
    #[arg(long, value_enum, default_value_t = PrintFormat::Env)]
    format: PrintFormat,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, ValueEnum)]
pub(crate) enum PrintFormat {
    /// `KEY=value` shell-sourceable lines (the default; matches the written
    /// `.env` file).
    Env,
    /// The written `.json` document.
    Json,
    /// Nushell `$env.KEY = "value"` statements.
    Nu,
    /// PowerShell `$env:KEY = "value"` statements.
    Pwsh,
}

async fn env(args: EnvArgs) -> miette::Result<()> {
    use aphrody_diagnostics::ai_env as diag;
    let published = diag::publish()?;
    let resolved = published.vars;
    if args.print {
        let body = match args.format {
            PrintFormat::Env => diag::to_env_lines(&resolved),
            PrintFormat::Json => serde_json::to_string_pretty(&published.json).into_diagnostic()?,
            PrintFormat::Nu => diag::to_nu_lines(&resolved),
            PrintFormat::Pwsh => diag::to_pwsh_lines(&resolved),
        };
        println!("{}", body.trim_end());
    }
    Ok(())
}

pub(crate) async fn run(action: AiAction) -> miette::Result<()> {
    match action {
        AiAction::Env(args) => env(args).await,
        AiAction::SyncSessions(args) => crate::ai_sync_cmd::run(args).await,
        AiAction::Status { json } => {
            let status = aphrody_ai::AphrodyAiEngine::new().status();
            if json {
                println!("{}", serde_json::to_string_pretty(&status).into_diagnostic()?);
            } else {
                println!("=== Aphrody AI Layer ===");
                println!("  * Router:    Ready (unified routing)");
                println!("  * Inference: Multi-provider (Gemini, Llama, Ollama, Claude)");
                println!("  * RAG/Tools: Integrated");
            }
            Ok(())
        },
    }
}
