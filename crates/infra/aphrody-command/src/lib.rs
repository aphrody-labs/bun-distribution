// SPDX-License-Identifier: Apache-2.0
//! `aphrody` — the cross-platform AI-layer CLI, exposed as a library.
//!
//! The binary, FFI bridge and tests share the same command parser and dispatch
//! paths. Native targets compile the real integrations; wasm targets retain a
//! compatible lightweight help/version surface because native process, network
//! and system dependencies are not linkable there.

#[cfg(not(target_arch = "wasm32"))]
mod agent_cmd;
#[cfg(not(target_arch = "wasm32"))]
mod agent_run;
#[cfg(not(target_arch = "wasm32"))]
mod agy_backend;
#[cfg(not(target_arch = "wasm32"))]
mod agy_loop;
#[cfg(not(target_arch = "wasm32"))]
mod agy_provision;
#[cfg(not(target_arch = "wasm32"))]
mod ai_env_cmd;
#[cfg(not(target_arch = "wasm32"))]
mod ai_sync_cmd;
#[cfg(not(target_arch = "wasm32"))]
mod antigravity_cmd;
#[cfg(not(target_arch = "wasm32"))]
mod app_server_cmd;
#[cfg(not(target_arch = "wasm32"))]
pub(crate) mod auto_command;
#[cfg(not(target_arch = "wasm32"))]
mod bxc_compat;
#[cfg(not(target_arch = "wasm32"))]
mod codex_provision;
#[cfg(not(target_arch = "wasm32"))]
mod commands;
#[cfg(not(target_arch = "wasm32"))]
mod config_cmd;
#[cfg(not(target_arch = "wasm32"))]
mod context;
#[cfg(not(target_arch = "wasm32"))]
mod design_cmd;
#[cfg(not(target_arch = "wasm32"))]
mod discord_cmd;
#[cfg(not(target_arch = "wasm32"))]
mod docs_cmd;
#[cfg(not(target_arch = "wasm32"))]
mod exec_cmd;
#[cfg(all(not(target_arch = "wasm32"), feature = "firefly"))]
mod firefly_cmd;
#[cfg(all(not(target_arch = "wasm32"), feature = "forensics"))]
mod forensics_cmd;
#[cfg(not(target_arch = "wasm32"))]
mod gateway_cmd;
#[cfg(not(target_arch = "wasm32"))]
mod git_cmd;
#[cfg(not(target_arch = "wasm32"))]
mod ide_cmd;
#[cfg(all(not(target_arch = "wasm32"), feature = "index"))]
mod index_cmd;
#[cfg(all(not(target_arch = "wasm32"), feature = "infer"))]
mod infer_cmd;
#[cfg(all(not(target_arch = "wasm32"), feature = "jobs"))]
mod job_cmd;
#[cfg(not(target_arch = "wasm32"))]
mod mcp_cmd;
#[cfg(not(target_arch = "wasm32"))]
mod memory_cmd;
#[cfg(not(target_arch = "wasm32"))]
pub(crate) mod model_cmd;
#[cfg(not(target_arch = "wasm32"))]
mod multicall;
#[cfg(not(target_arch = "wasm32"))]
pub(crate) mod nl_tokens;
#[cfg(not(target_arch = "wasm32"))]
mod oc_cmd;
#[cfg(all(not(target_arch = "wasm32"), feature = "ocr"))]
mod ocr_cmd;
#[cfg(not(target_arch = "wasm32"))]
mod oss_cmd;
#[cfg(not(target_arch = "wasm32"))]
mod package_cmd;
#[cfg(not(target_arch = "wasm32"))]
mod pillars_cmd;
#[cfg(not(target_arch = "wasm32"))]
mod platform;
#[cfg(all(not(target_arch = "wasm32"), feature = "rag"))]
mod rag_cmd;
#[cfg(not(target_arch = "wasm32"))]
mod re_auto;
#[cfg(not(target_arch = "wasm32"))]
mod runtime_cmd;
#[cfg(not(target_arch = "wasm32"))]
mod scan_cmd;
#[cfg(not(target_arch = "wasm32"))]
mod self_cmd;
#[cfg(not(target_arch = "wasm32"))]
mod session_cmd;
#[cfg(all(not(target_arch = "wasm32"), feature = "train"))]
mod train_cmd;
#[cfg(not(target_arch = "wasm32"))]
mod vpn_cmd;
#[cfg(not(target_arch = "wasm32"))]
mod winclean_cmd;

use std::path::PathBuf;

#[cfg(not(target_arch = "wasm32"))]
use clap::CommandFactory;
use clap::{Parser, Subcommand};

#[cfg(not(target_arch = "wasm32"))]
use crate::{
    commands::{DoctorCommand, MirrorCommand, SubprocessExit, VersionCommand},
    context::{GoogleContext, TerminalCommand},
};

/// Shell selector for `aphrody completions`.
///
/// Wraps [`clap_complete::Shell`] so we can expose user-friendly aliases —
/// `pwsh` and `powershell` both map to PowerShell, matching how Windows users
/// invoke pwsh.exe in practice.
#[derive(Debug, Clone, Copy, PartialEq, Eq, clap::ValueEnum)]
pub(crate) enum CompletionsShell {
    Bash,
    Elvish,
    Fish,
    #[value(alias = "pwsh")]
    Powershell,
    Zsh,
}

#[cfg(not(target_arch = "wasm32"))]
impl From<CompletionsShell> for clap_complete::Shell {
    fn from(s: CompletionsShell) -> Self {
        match s {
            CompletionsShell::Bash => Self::Bash,
            CompletionsShell::Elvish => Self::Elvish,
            CompletionsShell::Fish => Self::Fish,
            CompletionsShell::Powershell => Self::PowerShell,
            CompletionsShell::Zsh => Self::Zsh,
        }
    }
}

/// Messaging-channel selector for `aphrody notify`.
///
/// Mirrors the production adapters in `aphrody-channels` (Slack, Telegram,
/// Matrix, Discord). Declared at the top level (not gated) so the clap surface
/// is identical on native and wasm32 builds.
#[derive(Debug, Clone, Copy, PartialEq, Eq, clap::ValueEnum)]
pub(crate) enum NotifyChannel {
    /// Slack Bot API (chat.postMessage). Reads `SLACK_BOT_TOKEN` + `SLACK_CHANNEL`.
    Slack,
    /// Telegram Bot API (sendMessage). Reads `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID`.
    Telegram,
    /// Matrix Client-Server API v3. Reads `MATRIX_HOMESERVER`, `MATRIX_ACCESS_TOKEN`,
    /// `MATRIX_USER_ID` + `MATRIX_ROOM_ID`.
    Matrix,
    /// Discord REST v10 (`channels/{id}/messages`). Reads `DISCORD_BOT_TOKEN` +
    /// `DISCORD_DM_CHANNEL_ID`. A room written `@<user id>` opens (or reuses) the
    /// private DM channel with that user before sending.
    Discord,
}

/// Actions for the environment-configured transactional mail connector.
#[cfg(not(target_arch = "wasm32"))]
#[derive(Subcommand, Debug, Clone)]
pub(crate) enum MailAction {
    /// Verify provider credentials and connectivity without sending a message.
    Health,
    /// Send one plain-text email using the configured provider.
    Send {
        /// Recipient address, optionally in `Name <address>` form.
        #[arg(long, short)]
        to: String,
        /// Subject line.
        #[arg(long, short)]
        subject: String,
        /// Plain-text message body.
        #[arg(long, short)]
        message: String,
        /// Optional friendly sender override.
        #[arg(long)]
        from: Option<String>,
        /// Stable key used by Resend to deduplicate retries.
        #[arg(long)]
        idempotency_key: Option<String>,
    },
}

/// Channel selector for `aphrody hermes`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, clap::ValueEnum)]
pub(crate) enum HermesChannelArg {
    /// Discord (REST v10 bot). Reads `DISCORD_BOT_TOKEN`.
    Discord,
    /// X / Twitter (cookie-auth `aphrody-x`). Reads `X_HANDLE`.
    X,
}

#[derive(Parser)]
#[command(name = "aphrody")]
#[command(version = "1.0.0-canary")]
#[command(about = "Aphrody — cross-platform Rust binary (Linux / Windows / macOS / wasm).",
          long_about = None)]
#[cfg_attr(not(target_arch = "wasm32"), command(after_help = multicall::HELP))]
struct Cli {
    #[cfg(not(target_arch = "wasm32"))]
    #[command(flatten)]
    agent_options: AgentOptions,
    /// Open the interactive agent with an initial prompt.
    #[cfg(not(target_arch = "wasm32"))]
    #[arg(short = 'i', long = "interactive", global = true)]
    interactive: Option<String>,
    #[command(subcommand)]
    command: Option<Commands>,
}

#[cfg(not(target_arch = "wasm32"))]
fn bare_cli_opens_tui(stdin_is_terminal: bool, stdout_is_terminal: bool) -> bool {
    stdin_is_terminal && stdout_is_terminal
}

#[cfg(not(target_arch = "wasm32"))]
fn missing_command_feature(args: &[String]) -> Option<&'static str> {
    let name = args.first()?.as_str();
    match name {
        #[cfg(not(feature = "rag"))]
        "rag" => Some("rag"),
        #[cfg(not(feature = "train"))]
        "train" => Some("train"),
        #[cfg(not(feature = "infer"))]
        "infer" => Some("infer"),
        #[cfg(not(feature = "index"))]
        "index" => Some("index"),
        #[cfg(not(feature = "jobs"))]
        "job" => Some("jobs"),
        #[cfg(not(feature = "ocr"))]
        "ocr" => Some("ocr"),
        #[cfg(not(feature = "forensics"))]
        "forensics" => Some("forensics"),
        #[cfg(not(feature = "firefly"))]
        "firefly" => Some("firefly"),
        _ => None,
    }
}

/// Shared configuration for every agent entry point.
#[cfg(not(target_arch = "wasm32"))]
#[derive(Debug, Clone, Default, clap::Args)]
struct AgentOptions {
    /// Override configuration using TOML key=value syntax.
    #[arg(short = 'c', long = "config")]
    config: Vec<String>,
    /// Model identifier served by the selected provider.
    #[arg(short = 'm', long)]
    model: Option<String>,
    /// Configuration profile.
    #[arg(short = 'p', long)]
    profile: Option<String>,
    /// Use an open-weight local provider.
    #[arg(long)]
    oss: bool,
    /// Local inference provider: llama, ollama, lmstudio or vllm.
    #[arg(long)]
    local_provider: Option<String>,
    /// Agent working directory.
    #[arg(short = 'C', long)]
    cd: Option<PathBuf>,
    /// Autonomous execution without an artificial iteration limit.
    #[arg(long)]
    yolo: bool,
}

#[cfg(not(target_arch = "wasm32"))]
impl AgentOptions {
    fn overrides(&self) -> aphrody_config::CliOverrides {
        aphrody_config::CliOverrides {
            model: self.model.clone(),
            profile: self.profile.clone(),
            oss: self.oss,
            local_provider: self.local_provider.clone(),
            cwd: self.cd.clone(),
            config_overrides: self.config.clone(),
            ..Default::default()
        }
    }

    /// Merge options closest to the selected agent command last.
    fn apply_to(
        &self,
        mut inherited: aphrody_config::CliOverrides,
    ) -> aphrody_config::CliOverrides {
        if let Some(model) = &self.model {
            inherited.model = Some(model.clone());
        }
        if let Some(profile) = &self.profile {
            inherited.profile = Some(profile.clone());
        }
        if let Some(provider) = &self.local_provider {
            inherited.local_provider = Some(provider.clone());
        }
        if let Some(cwd) = &self.cd {
            inherited.cwd = Some(cwd.clone());
        }
        inherited.oss |= self.oss;
        inherited.config_overrides.extend(self.config.iter().cloned());
        inherited
    }
}

#[derive(Subcommand)]
enum Commands {
    /// Index and retrieve local code and documentation.
    #[cfg(all(not(target_arch = "wasm32"), feature = "rag"))]
    Rag(rag_cmd::RagArgs),
    #[cfg(not(target_arch = "wasm32"))]
    #[command(name = "__llama-daemon", hide = true)]
    LlamaDaemon {
        #[arg(long)]
        state_root: PathBuf,
        #[arg(long)]
        role: String,
    },
    /// Execute an autonomous agent task with optional Codex-compatible JSONL.
    #[cfg(not(target_arch = "wasm32"))]
    Exec(Box<exec_cmd::ExecArgs>),
    /// Continue a persisted agent session.
    #[cfg(not(target_arch = "wasm32"))]
    Resume(session_cmd::SessionArgs),
    /// Fork a persisted agent conversation into a new session.
    #[cfg(not(target_arch = "wasm32"))]
    Fork(session_cmd::SessionArgs),
    /// Serve or inspect the OpenAI-compatible HTTP AI Gateway (127.0.0.1:8795).
    #[cfg(not(target_arch = "wasm32"))]
    Gateway {
        #[command(subcommand)]
        action: Option<gateway_cmd::GatewayAction>,
    },
    /// Serve the local app-server protocol over stdio or loopback HTTP.
    #[cfg(not(target_arch = "wasm32"))]
    AppServer {
        #[arg(long)]
        http: bool,
        #[arg(long, default_value = "127.0.0.1:8765")]
        addr: String,
    },
    /// Manage, show, or import Codex-compatible configuration.
    #[cfg(not(target_arch = "wasm32"))]
    Config {
        #[command(subcommand)]
        action: config_cmd::ConfigAction,
    },
    /// Resolve the local AI environment; mirror external agent sessions.
    ///
    /// `aphrody ai sync-sessions [--json] [--agent agy|codex|claude] [--watch
    /// --interval-secs N]` mirrors the Antigravity CLI, Codex and Claude Code
    /// transcripts into `~/.aphrody/sessions/<agent>/` incrementally.
    ///
    /// `aphrody ai env` writes `~/.aphrody/ai/local-ai.{json,env}` with the
    /// eighteen canonical `APHRODY_AI_*` names this machine currently
    /// resolves for the local/open-source AI stack (chat/code/reasoning/small,
    /// vision, OCR, STT, embed, rerank, plus the `aphrody`/`aphrody-mcp`
    /// binaries) — the same contract
    /// `config/local-ai.json` documents. Add `--print
    /// --format env|json|nu|pwsh` to also print them.
    ///
    /// Example: aphrody ai env --print --format nu
    #[cfg(not(target_arch = "wasm32"))]
    Ai {
        #[command(subcommand)]
        action: ai_env_cmd::AiAction,
    },
    /// Native platform probes for CPU, memory, CUDA and monotonic time.
    #[cfg(not(target_arch = "wasm32"))]
    Native {
        #[command(subcommand)]
        action: pillars_cmd::NativeAction,
    },
    /// Canonical OS layer: kernel subsystems, WinClean diagnostics, process isolation.
    #[cfg(not(target_arch = "wasm32"))]
    Os {
        #[command(subcommand)]
        action: pillars_cmd::OsAction,
    },
    /// Canonical Web engine: Obscura browser automation, crawling and extraction.
    #[cfg(not(target_arch = "wasm32"))]
    Web {
        #[command(subcommand)]
        action: pillars_cmd::WebAction,
    },
    /// Canonical Shell: Nushell PTY session, Ratatui TUI, embedded terminal.
    #[cfg(not(target_arch = "wasm32"))]
    Shell {
        #[command(subcommand)]
        action: pillars_cmd::ShellAction,
    },
    /// Forward vers le binaire natif OpenAI Codex (`codex`).
    #[cfg(not(target_arch = "wasm32"))]
    Codex {
        #[arg(trailing_var_arg = true, allow_hyphen_values = true)]
        args: Vec<String>,
    },
    /// Machine learning training and fine-tuning engine.
    #[cfg(all(not(target_arch = "wasm32"), feature = "train"))]
    Train(train_cmd::TrainArgs),
    /// Authentification Google (God Mode / OAuth2)
    Auth {
        #[arg(short, long)]
        force: bool,
    },
    /// Gère le mirroring des assets MD3 (start, stop, status).
    Mirror {
        /// Action to perform: start, stop, or status.
        #[arg(default_value = "start")]
        action: String,
    },

    /// Affiche la version et l'état du système
    Version {
        /// Emit version as a single JSON object instead of human-readable text
        #[arg(long, default_value_t = false)]
        json: bool,
    },
    /// Diagnostic env + intégration A2A + supply-chain (first-impression)
    Doctor {
        /// Emit diagnostics as a single JSON object instead of human-readable text
        #[arg(long)]
        json: bool,
    },

    /// A2A coordination (serve, tick, invoke peers)
    A2a {
        #[command(subcommand)]
        action: A2aAction,
    },
    /// Compilation hyper-optimisée de ChromeOS
    Cros {
        #[command(subcommand)]
        action: CrosActions,
    },
    /// Recherche Google Native
    Search {
        #[arg(trailing_var_arg = true, allow_hyphen_values = true)]
        query: Vec<String>,
    },
    /// [DÉPRÉCIÉ] Alias de `agy` — le Gemini CLI a migré vers l'Antigravity
    /// CLI. Honore encore `APHRODY_GEMINI_BIN` / un fork in-tree ; sinon
    /// forwarde vers `agy`. Préférez `aphrody agy`.
    Gemini {
        #[arg(trailing_var_arg = true, allow_hyphen_values = true)]
        args: Vec<String>,
    },
    /// Forward vers le binaire natif Antigravity CLI (`agy`).
    ///
    /// Résolution : $APHRODY_AGY_BIN > %LOCALAPPDATA%\agy\bin\agy.exe > PATH.
    /// Pour la surface API pure (token + RPC, sans binaire), voir `antigravity`.
    Agy {
        #[arg(trailing_var_arg = true, allow_hyphen_values = true)]
        args: Vec<String>,
    },
    /// Écosystème Google natif (DNS, Suggest, Translate, Gemini Web, Antigravity, Runtime)
    #[cfg(not(target_arch = "wasm32"))]
    #[command(disable_help_flag = true)]
    Google {
        #[arg(trailing_var_arg = true, allow_hyphen_values = true)]
        args: Vec<String>,
    },
    /// Traduction unifiée via aphrody-translate
    #[cfg(not(target_arch = "wasm32"))]
    Translate {
        /// Texte à traduire directement
        #[arg(value_name = "TEXT")]
        text: Option<String>,
        /// Langue source (auto, ja, en...)
        #[arg(short, long, default_value = "auto")]
        source: String,
        /// Langue cible (fr, en, ja...)
        #[arg(short, long, default_value = "fr")]
        target: String,
        /// Backend de traduction : auto, web, google, mymemory
        #[arg(short, long, default_value = "auto")]
        backend: String,
        /// Fichier à traduire
        #[arg(short, long)]
        file: Option<std::path::PathBuf>,
        /// Return a strict machine-readable translation result
        #[arg(long)]
        json: bool,
    },
    /// Execute the integrated N2B engine (Node 2 Bun) in-process; also the `n2b` link.
    #[command(disable_help_flag = true)]
    N2b {
        #[arg(trailing_var_arg = true, allow_hyphen_values = true)]
        args: Vec<String>,
    },
    /// Forward vers le CLI natif Niers (`niers`).
    Nie {
        #[arg(trailing_var_arg = true, allow_hyphen_values = true)]
        args: Vec<String>,
    },
    /// Safe cross-platform operator CLI for configured SSH hosts.
    #[cfg(not(target_arch = "wasm32"))]
    Ssh {
        #[arg(trailing_var_arg = true, allow_hyphen_values = true)]
        args: Vec<String>,
    },
    /// Boucle de codage autonome pour le CLI Antigravity (`agy`) via ses hooks
    /// `Stop` (pilote) et `PostInvocation` (comptage par tour). Câblé par le
    /// plugin aphrody-agy ; `start`/`stop`/`status` pilotent la boucle, `hook`
    /// est le driver invoqué par agy, `hooks-json` affiche le câblage.
    #[cfg(not(target_arch = "wasm32"))]
    #[command(name = "agy-loop")]
    AgyLoop {
        #[command(subcommand)]
        action: agy_loop::AgyLoopAction,
    },
    /// Pont WebSocket-PTY pour le frontend WASM (localhost uniquement)
    Term {
        /// Adresse d'écoute du serveur WebSocket (host:port)
        #[arg(long, default_value = "127.0.0.1:8788")]
        addr: String,
        /// Shell à lancer (défaut : autodetect selon la plateforme)
        #[arg(long)]
        shell: Option<String>,
        /// Répertoire de travail initial du shell
        #[arg(long)]
        cwd: Option<std::path::PathBuf>,
        /// Jeton d'authentification pour sécuriser le WebSocket (défaut : $APHRODY_OS_AUTH_TOKEN ou généré)
        #[arg(long)]
        token: Option<String>,
    },
    /// Model Context Protocol — manage TOML servers, read legacy JSON, call tools.
    #[cfg(not(target_arch = "wasm32"))]
    Mcp {
        #[command(subcommand)]
        action: McpAction,
    },
    /// Discord bot compilation, inspection, and monorepo verification.
    #[cfg(not(target_arch = "wasm32"))]
    Discord {
        #[command(subcommand)]
        action: discord_cmd::DiscordAction,
    },
    /// Native Git inspection, GitHub REST/GraphQL, and ecosystem distribution.
    #[cfg(not(target_arch = "wasm32"))]
    Git {
        #[command(subcommand)]
        action: git_cmd::GitAction,
    },
    /// Ingest a Git repository or directory into a prompt-ready LLM digest (GitIngest standard).
    #[cfg(not(target_arch = "wasm32"))]
    #[command(alias = "y", alias = "gitingest")]
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
    /// Intelligent documentation and open-source library search (Context7, MS Learn, GitHub, llms.txt).
    #[cfg(not(target_arch = "wasm32"))]
    Docs {
        #[command(subcommand)]
        action: docs_cmd::DocsAction,
    },
    /// Curated Awesome lists ecosystem.
    #[cfg(not(target_arch = "wasm32"))]
    #[command(about = docs_cmd::awesome_about())]
    Awesome {
        #[command(subcommand)]
        action: docs_cmd::AwesomeAction,
    },
    /// Reverse engineering — triage a binary (PE32/PE64/ELF32/ELF64).
    ///
    /// Detects format via magic bytes, parses with goblin, extracts sections
    /// with per-section Shannon entropy, imports, exports, ASCII/UTF-16LE
    /// strings sample, SHA-256 fingerprint. Pure Rust, no GPL deps.
    #[cfg(not(target_arch = "wasm32"))]
    Re {
        #[command(subcommand)]
        action: ReAction,
    },
    /// Reproducible forensic extraction — filesystem map + SQLite schema dump.
    ///
    /// SECURITY: maps + classifies + dumps schema ONLY. It never prints or
    /// copies secret VALUES (tokens, cookie bytes, `secret://` rows). The
    /// SQLite path opens databases read-only and reads `sqlite_master`
    /// (names + CREATE statements) only — value columns are never selected.
    /// Built only with `--features forensics` (links `rusqlite` bundled);
    /// in a default build the subcommand is absent from the clap surface.
    ///
    /// Example: aphrody forensics sqlite --db state.vscdb | jq '.tables[].name'
    #[cfg(all(not(target_arch = "wasm32"), feature = "forensics"))]
    Forensics {
        #[command(subcommand)]
        action: forensics_cmd::ForensicsAction,
    },
    /// Persistent local-filesystem search index (SQLite FTS5).
    ///
    /// Built only with `--features index`; mirrors the Google desktop app's
    /// local_files.db (metadata-only). `build` walks a root; `search` runs an
    /// FTS5 prefix query.
    ///
    /// Example: aphrody index search "readme" --limit 20
    #[cfg(all(not(target_arch = "wasm32"), feature = "index"))]
    Index {
        #[command(subcommand)]
        action: index_cmd::IndexAction,
    },
    /// Adobe Firefly Services image generation to disk.
    ///
    /// Built only with `--features firefly`. OAuth server-to-server (IMS):
    /// reads `FIREFLY_CLIENT_ID` / `FIREFLY_CLIENT_SECRET` from the environment.
    ///
    /// Example: aphrody firefly generate "a realistic cat coding" --out ./out
    #[cfg(all(not(target_arch = "wasm32"), feature = "firefly"))]
    Firefly {
        #[command(subcommand)]
        action: firefly_cmd::FireflyAction,
    },
    /// Tier-1 memory provider operations — migrate, audit, list backends.
    ///
    /// Wires the dyn-compatible `aphrody_memory::MemoryProvider` trait so
    /// records can be copied between Mem0 / Honcho / SqliteLocal without
    /// custom glue. HTTP providers read their credentials from
    /// `MEM0_API_KEY` / `HONCHO_API_KEY` (cf. per-provider modules).
    #[cfg(not(target_arch = "wasm32"))]
    Memory {
        #[command(subcommand)]
        action: MemoryAction,
    },
    /// Local model lifecycle — catalog, pull, inspect, verify, evict.
    ///
    /// The entry point of aphrody's local-inference toolbox: it puts weights
    /// for OCR, visual transcription and speech-to-text under
    /// `~/.aphrody/models`, digest-checked and resumable, and reclaims them
    /// when disk runs short. Backed by the `aphrody-models` crate; every
    /// subcommand takes `--json` for scripted / background use.
    ///
    /// Example: aphrody model pull whisper-base-en
    #[cfg(not(target_arch = "wasm32"))]
    Model {
        #[command(subcommand)]
        action: model_cmd::ModelAction,
    },
    /// Local ONNX inference backend — runtime discovery and provider probing.
    ///
    /// Built only with `--features infer` (links ONNX Runtime through
    /// aphrody-infer, host-only). `runtime` reports which shared library will
    /// be loaded and whether it is a GPU build; `probe` loads a model and
    /// reports the execution provider it actually got, so a silent CPU
    /// fallback cannot pass unnoticed.
    ///
    /// Example: aphrody infer probe ppocr-v5-mobile --role detector --require cuda
    #[cfg(all(not(target_arch = "wasm32"), feature = "infer"))]
    Infer {
        #[command(subcommand)]
        action: infer_cmd::InferAction,
    },
    /// Persistent background jobs — work that outlives the process.
    ///
    /// Built only with `--features jobs`. A submission returns an id
    /// immediately; `run` consumes the queue. A claim is a lease, not a flag,
    /// so a machine that dies mid-job hands the work back to the next worker
    /// instead of stranding it in a state that reads as healthy.
    ///
    /// Example: aphrody job transcribe ./meeting.wav && aphrody job run
    #[cfg(all(not(target_arch = "wasm32"), feature = "jobs"))]
    Job {
        #[command(subcommand)]
        action: job_cmd::JobAction,
    },
    /// Read images with a local vision-language model.
    ///
    /// Built only with `--features ocr`. `page` reads one image; `batch`
    /// streams a whole directory as JSONL, one line per page, resumable with
    /// `--skip-done`. A page with no readable text is reported as textless
    /// rather than described — a description is not a transcription.
    ///
    /// Example: aphrody ocr batch ./lot-001/images --out lot-001.jsonl
    #[cfg(all(not(target_arch = "wasm32"), feature = "ocr"))]
    Ocr {
        #[command(subcommand)]
        action: ocr_cmd::OcrAction,
    },
    /// Run the unified turn-loop chat agent.
    ///
    /// Composes every aphrody building block (gemini-runtime + tools +
    /// memory + session + permissions + hooks + prompts + router + cost +
    /// context + events) into a complete chat agent. When `--prompt <text>`
    /// is supplied, drives a single user→assistant turn and prints the assistant
    /// reply. When omitted, launches an interactive multi-turn REPL session
    /// supporting slash commands (`/help`, `/model`, `/tools`, `/exit`).
    #[cfg(not(target_arch = "wasm32"))]
    Chat {
        /// One-shot prompt to send. When omitted, starts the interactive REPL.
        #[arg(long, short)]
        prompt: Option<String>,
        /// Vendor-qualified model id (`gemini/default`, `anthropic/claude-opus-4-7`).
        /// Default: `gemini/default`.
        #[arg(long, short)]
        model: Option<String>,
        /// Override the default system prompt.
        #[arg(long)]
        system: Option<String>,
        /// Force the in-process stub backend (skip live LLM detection).
        /// Useful for CI / smoke runs that must not require any LLM backend.
        #[arg(long)]
        stub: bool,
        /// Attach one or more local files (images, PDFs, documents, etc.) to the chat.
        #[arg(long, short, value_name = "PATH")]
        attach: Vec<std::path::PathBuf>,
        /// Route chat directly to local LLM backend (llama-server / vLLM on loopback :8080).
        #[arg(long, short = 'l')]
        local: bool,
    },
    /// Agent multi-canaux voice-to-voice (Discord + X) — surpasse hermes-agent.
    ///
    /// Écoute un canal, répond via Gemini 3.5 Flash (token agy keyless), et —
    /// avec `--voice` — transcrit l'audio entrant (Whisper) et synthétise la
    /// réponse en audio (ElevenLabs) : boucle voice-to-voice complète, là où
    /// hermes-agent ne fait que transcrire. Le canal X n'existe pas chez hermes.
    ///
    /// Credentials via env : `DISCORD_BOT_TOKEN` / `X_HANDLE`,
    /// `OPENAI_API_KEY` (STT), `ELEVENLABS_API_KEY` (TTS).
    #[cfg(not(target_arch = "wasm32"))]
    Hermes {
        /// Canal d'écoute.
        #[arg(long, value_enum)]
        channel: HermesChannelArg,
        /// Active la boucle voice-to-voice (STT entrant + TTS sortant).
        #[arg(long)]
        voice: bool,
        /// Ne répondre qu'aux messages contenant ce trigger (ex. `@aphrody`).
        /// Vide = répondre à tout.
        #[arg(long, default_value = "")]
        trigger: String,
        /// Id de modèle (défaut : flash tier via agy).
        #[arg(long, short)]
        model: Option<String>,
        /// Backend stub déterministe (aucun LLM live) — pour CI / smoke headless.
        #[arg(long)]
        stub: bool,
        /// Traite un message synthétique et sort (vérification headless, sans token canal).
        #[arg(long)]
        simulate: Option<String>,
    },
    /// Launch an autonomous agent — aphrody's flagship Antigravity-in-Rust surface.
    ///
    /// `aphrody agent "do X"` assembles the agent engine
    /// (`aphrody-agent-runtime`) and runs it immediately. By default it drives
    /// one full headless turn and prints the final agent message; `--tui`
    /// launches the full-screen interactive surface (`aphrody-tui`) instead.
    ///
    /// The backend is a live Gemini client (`GEMINI_API_KEY` / `GOOGLE_API_KEY`)
    /// unless `--stub` selects a deterministic offline replay (no network, no
    /// key — handy for CI / smoke runs). Autonomy is full-auto per CLAUDE.md
    /// §0.1; `--gated` requires approval for each tool call. When no prompt is
    /// given in headless mode, one is read from stdin.
    #[cfg(not(target_arch = "wasm32"))]
    Agent {
        /// The task prompt. When omitted (and not `--tui`), read from stdin.
        prompt: Option<String>,
        /// Launch the full-screen interactive TUI instead of a headless turn.
        #[arg(long)]
        tui: bool,
        /// Deterministic offline backend (no network, no API key). For smoke / CI.
        #[arg(long)]
        stub: bool,
        /// Model id (default: a fast Gemini flash tier).
        #[arg(long, short)]
        model: Option<String>,
        /// Override the system prompt prepended to every model request.
        #[arg(long)]
        system: Option<String>,
        /// Require approval for each tool call (`AutonomyMode::Gated`).
        #[arg(long)]
        gated: bool,
        /// Working directory the tools resolve relative paths against.
        #[arg(long)]
        cwd: Option<PathBuf>,
        /// In headless mode, echo streamed text / tool events on stderr.
        #[arg(long, short)]
        verbose: bool,
    },
    /// Serve the local Codex-shaped JSON-RPC app-server over stdin/stdout.
    #[cfg(not(target_arch = "wasm32"))]
    Session {
        #[command(subcommand)]
        action: SessionAction,
    },
    /// Envoie un message via Slack / Telegram / Matrix / Discord.
    ///
    /// Credentials lus depuis l'environnement (voir `aphrody notify --help`).
    Notify {
        /// Channel cible : slack, telegram, matrix ou discord.
        #[arg(long, value_enum)]
        channel: NotifyChannel,
        /// Texte du message (plain-text).
        #[arg(long, short)]
        message: String,
        /// Destinataire (chat ID Telegram, channel ID Slack, room ID Matrix,
        /// channel ID Discord — ou `@<user id>` pour un DM Discord).
        ///
        /// Si absent, lu depuis `SLACK_CHANNEL`, `TELEGRAM_CHAT_ID`,
        /// `MATRIX_ROOM_ID` ou `DISCORD_DM_CHANNEL_ID` selon le `--channel` choisi.
        #[arg(long, short)]
        room: Option<String>,
        /// Fichiers à joindre au message (Discord uniquement pour l'instant).
        #[arg(long = "attach", short = 'a')]
        attach: Vec<std::path::PathBuf>,
    },
    /// Check or send transactional email through Resend or OVH SMTP.
    #[cfg(not(target_arch = "wasm32"))]
    Mail {
        #[command(subcommand)]
        action: MailAction,
    },
    /// Génère des completions shell pour bash / zsh / fish / pwsh / elvish
    Completions {
        #[arg(value_enum)]
        shell: CompletionsShell,
    },
    /// Installer / bootstrap natif (remplace les .ps1/.sh scripts/).
    #[command(name = "self")]
    SelfCmd {
        #[command(subcommand)]
        action: SelfAction,
    },
    /// Gestionnaire des CLI Aphrody — installer, mettre à jour et désinstaller.
    #[cfg(not(target_arch = "wasm32"))]
    Package {
        #[command(subcommand)]
        action: package_cmd::PackageAction,
    },
    /// Orchestrateur uv/Python/AI et détection des accélérateurs.
    #[cfg(not(target_arch = "wasm32"))]
    Runtime {
        #[command(subcommand)]
        action: runtime_cmd::RuntimeAction,
    },
    /// Repo analytics : scan tree (size/file-count) + scan manifests (Cargo/JSON/TOML).
    Scan {
        #[command(subcommand)]
        action: ScanAction,
    },
    /// (ported from openclaw) Bootstrap aphrody local state + seed config.
    #[cfg(not(target_arch = "wasm32"))]
    OcOnboard {
        /// Override the default agent workspace directory.
        #[arg(long)]
        workspace: Option<PathBuf>,
        /// Run without interactive prompts (CI / scripts).
        #[arg(long)]
        non_interactive: bool,
        /// Required with `--non-interactive`: acknowledge security defaults.
        #[arg(long)]
        accept_risk: bool,
        /// Overwrite an existing aphrody.json instead of bailing out.
        #[arg(long, short)]
        force: bool,
        /// Skip seeding the optional persona files (SOUL/IDENTITY/USER/
        /// HEARTBEAT/BOOT); AGENTS.md and TOOLS.md are always seeded.
        #[arg(long)]
        skip_bootstrap: bool,
    },
    /// (ported from openclaw) Reset local state. Choose a scope:
    /// `config`, `config-creds-sessions`, or `full`.
    #[cfg(not(target_arch = "wasm32"))]
    OcReset {
        /// Reset scope.
        #[arg(long, value_enum)]
        scope: oc_cmd::ResetScope,
        /// Confirm the destructive operation (required unless --dry-run).
        #[arg(long)]
        yes: bool,
        /// Preview deletions without touching disk.
        #[arg(long)]
        dry_run: bool,
    },
    /// (ported from openclaw) Uninstall aphrody scopes (service / state /
    /// workspace / app, or `--all`).
    #[cfg(not(target_arch = "wasm32"))]
    OcUninstall {
        #[arg(long)]
        service: bool,
        #[arg(long)]
        state: bool,
        #[arg(long)]
        workspace: bool,
        #[arg(long)]
        app: bool,
        #[arg(long)]
        all: bool,
        #[arg(long)]
        yes: bool,
        #[arg(long)]
        dry_run: bool,
    },
    /// (ported from openclaw) Secure DM pairing — list / approve / inject
    /// requests against the local pairing store (~/.aphrody/pairing.json).
    #[cfg(not(target_arch = "wasm32"))]
    OcPairing {
        #[command(subcommand)]
        action: oc_cmd::PairingAction,
    },
    /// (ported from openclaw) Open or search the documentation site.
    #[cfg(not(target_arch = "wasm32"))]
    OcDocs {
        /// Free-form search query (joined with spaces).
        #[arg(trailing_var_arg = true, allow_hyphen_values = true)]
        query: Vec<String>,
        /// Print only the URL; do not attempt to open a browser.
        #[arg(long)]
        url_only: bool,
    },
    /// Google NotebookLM RPC client — notebooks / sources / chat / artifacts.
    ///
    /// Honours `NOTEBOOKLM_OAUTH_TOKEN` or `NOTEBOOKLM_COOKIES` env vars.
    /// Also requires `NOTEBOOKLM_AT_TOKEN` + `NOTEBOOKLM_BL_TOKEN` (the
    /// per-session XSRF + bootstrap config strings the web UI exports).
    #[cfg(not(target_arch = "wasm32"))]
    Notebooklm {
        #[command(subcommand)]
        action: NotebooklmActions,
    },
    /// Native Google AI Ultra / Gemini client (Antigravity). Scriptable,
    /// non-interactive, JSON output — `models`, `whoami`, `load`, `chat`.
    ///
    /// Reads the OAuth token at runtime from the platform credential store
    /// (Windows Credential Manager entry `gemini:antigravity`); no secret is
    /// embedded in the binary. On platforms without a credential store the
    /// underlying SDK returns an "unsupported platform" error.
    ///
    /// Example: aphrody antigravity chat --model gemini-2.0-flash --prompt "hi" | jq
    /// '.candidates[0].content'
    #[cfg(not(target_arch = "wasm32"))]
    Antigravity {
        #[command(subcommand)]
        action: antigravity_cmd::AntigravityAction,
    },
    /// Export the canonical aphrody logo (`crates/ui/identity/assets/logo/aphrody.webp`).
    #[cfg(not(target_arch = "wasm32"))]
    Logo {
        /// Write a multi-resolution Windows `.ico` (16/32/48/64/128/256) here.
        #[arg(long)]
        ico: Option<std::path::PathBuf>,
        /// Write a scalable `.svg` here.
        #[arg(long)]
        svg: Option<std::path::PathBuf>,
        /// Write an M3 maskable adaptive-icon PNG here (uses `--size`).
        #[arg(long)]
        maskable: Option<std::path::PathBuf>,
        /// Pixel side for the maskable PNG export.
        #[arg(long, default_value_t = 512)]
        size: u32,
    },
    /// Material 3 design-token tooling (color CSS export + UI fusion sheet).
    #[cfg(not(target_arch = "wasm32"))]
    Design {
        #[command(subcommand)]
        action: DesignActions,
    },
    /// Antigravity IDE installation inspector — info, extensions, RE, state,
    /// and launch.
    ///
    /// All sub-commands are read-only except `launch`. Resolution order for
    /// the install dir: env `APHRODY_IDE_DIR` > OS default paths.
    ///
    /// Example: aphrody ide info --json | jq '.ideVersion'
    #[cfg(not(target_arch = "wasm32"))]
    Ide {
        #[command(subcommand)]
        action: ide_cmd::IdeAction,
    },
    /// Gestion du VPN Mullvad et du contournement géo pour Google AI / agy.
    #[cfg(not(target_arch = "wasm32"))]
    Vpn {
        #[command(subcommand)]
        action: vpn_cmd::VpnAction,
    },
    /// Native Windows computer use and OS control via the in-process aphrody-winclean crate.
    ///
    /// Example: aphrody winclean call computer_click --arg windowHandle=0 --arg x=120 --arg y=48
    #[cfg(not(target_arch = "wasm32"))]
    Winclean {
        #[command(subcommand)]
        action: winclean_cmd::WincleanAction,
    },
    /// Exécution automatique (Bun, Uv, ou scripts)
    #[command(external_subcommand)]
    // On wasm the inner Vec is consumed only at the type level by clap; the
    // dispatch arm uses `Commands::Auto(_)`. Native dispatch reads it.
    #[cfg_attr(target_arch = "wasm32", allow(dead_code))]
    Auto(Vec<String>),
}

/// Local app-server lifecycle commands.
#[cfg(not(target_arch = "wasm32"))]
#[derive(Subcommand)]
enum SessionAction {
    /// Multiplex threads and local model turns over newline-delimited JSON-RPC.
    Serve {
        /// Expose HTTP JSON-RPC instead of stdio.
        #[arg(long)]
        http: bool,
        /// Local bind address for HTTP mode (app-server port; 8789 belongs to aphrody-mcp http).
        #[arg(long, default_value = "127.0.0.1:8765")]
        addr: String,
    },
}

/// Actions for the `design` subcommand.
#[cfg(not(target_arch = "wasm32"))]
#[derive(Subcommand, Debug, Clone)]
pub(crate) enum DesignActions {
    /// Emit Material 3 color tokens as CSS custom properties.
    ///
    /// Default: the M3 `--md-sys-color-*` `:root` block only. With `--fusion`,
    /// also emit the shadcn/ui alias block and the Tailwind v4 `@theme inline`
    /// block — the materialised three-way UI fusion (see docs/design/FUSION-PLAN.md).
    Tokens {
        /// Output format: raw CSS, or a shadcn `registry:theme` item (JSON).
        #[arg(long, value_enum, default_value_t = TokensFormat::Css)]
        format: TokensFormat,
        /// (CSS format) Also emit shadcn + Tailwind v4 alias sheets (fusion).
        #[arg(long)]
        fusion: bool,
        /// Use the M3 dark baseline palette instead of the light one.
        #[arg(long)]
        dark: bool,
        /// Write to this file instead of stdout.
        #[arg(short, long)]
        output: Option<std::path::PathBuf>,
    },
}

/// Output format for `design tokens`.
#[cfg(not(target_arch = "wasm32"))]
#[derive(clap::ValueEnum, Debug, Clone, Default)]
pub(crate) enum TokensFormat {
    /// Raw CSS custom properties (`:root { --md-sys-color-* }`; `--fusion` adds
    /// the shadcn + Tailwind v4 alias sheets).
    #[default]
    Css,
    /// shadcn/ui `registry:theme` item (JSON): `cssVars.theme` aliases shadcn
    /// tokens to `var(--md-sys-color-*)`, `cssVars.light`/`dark` carry the M3
    /// palette. Consumable via `shadcn add <url>`.
    ShadcnRegistry,
}

/// Actions for the `notebooklm` kernel subcommand.
#[cfg(not(target_arch = "wasm32"))]
#[derive(Subcommand, Debug, Clone)]
pub(crate) enum NotebooklmActions {
    /// List every notebook owned by the active account.
    List,
    /// Create a fresh empty notebook.
    Create {
        /// Title to assign to the new notebook (uses upstream default if absent).
        #[arg(long, short)]
        title: Option<String>,
    },
    /// Delete a notebook by id.
    Delete {
        /// Notebook id to delete.
        notebook_id: String,
    },
    /// Attach a source to a notebook (URL or local file path, auto-detected).
    Upload {
        /// Target notebook id.
        notebook_id: String,
        /// URL (http://, https://) or path to a local file.
        source: String,
    },
    /// Send a chat message and print the reply on stdout.
    Chat {
        /// Target notebook id.
        notebook_id: String,
        /// Prompt to send.
        prompt: String,
    },
    /// Kick off an artifact generation workflow.
    Generate {
        /// Target notebook id.
        notebook_id: String,
        /// Kind of artifact (`audio`, `report`, `video`, `quiz`, `mind_map`,
        /// `flashcards`, `infographic`, `slide_deck`, `data_table`).
        #[arg(long, short)]
        kind: String,
        /// Optional natural-language instructions for the workflow.
        #[arg(long, short)]
        prompt: Option<String>,
    },
    /// Wait for an artifact to reach `COMPLETE` state and download it locally.
    Download {
        /// Target notebook id (used to scope the poll).
        notebook_id: String,
        /// Artifact id returned by a previous `generate` call.
        artifact_id: String,
        /// Output path for the downloaded payload.
        #[arg(long, short)]
        output: std::path::PathBuf,
    },
}

#[derive(Subcommand)]
enum CrosActions {
    /// Synchronisation ultra-rapide (shallow clone)
    Sync,
    /// Compilation GN/Ninja avec SCCache et optimisation multi-coeur
    Build,
}

/// `aphrody a2a` — file JSONL coordination + A2A 1.0 HTTP listener.
#[derive(Subcommand)]
pub(crate) enum A2aAction {
    /// Start HTTP listener (`/ping`, `/msg`, JSON-RPC, agent card) on :8788.
    Serve {
        #[arg(long, default_value = "127.0.0.1:8788")]
        bind: String,
        /// Also listen on this Unix socket (mode 0666); env `A2A_SOCKET` when the flag is absent.
        #[arg(long)]
        unix: Option<std::path::PathBuf>,
        /// Do not bind TCP (Unix socket only, a2a-broker.ts parity).
        #[arg(long)]
        no_tcp: bool,
        /// Legacy `messages.jsonl`/`tasks.json` directory for `/jsonrpc` and `/events`;
        /// env `COORD_DIR` when the flag is absent.
        #[arg(long)]
        coord_dir: Option<std::path::PathBuf>,
    },
    /// Append one JSONL envelope (duel-tick / coord loop).
    Tick {
        #[arg(long)]
        iteration: u64,
        #[arg(long, default_value = "aphrody")]
        side: String,
        #[arg(long, default_value = "winclean")]
        peer: String,
        #[arg(long)]
        subject: Option<String>,
        #[arg(long)]
        body: Option<String>,
        #[arg(long, default_value = "ping")]
        kind: String,
    },
    /// Invoke a native peer CLI (grok, agy, claude, codex, bxc).
    Invoke {
        prompt: String,
        #[arg(long, default_value = "grok")]
        peer: String,
        #[arg(long)]
        dry_run: bool,
        /// Claim a relative file family for this invocation (repeatable).
        #[arg(long)]
        claim: Vec<PathBuf>,
    },
    /// JSON-RPC `message/send` to a federation peer (HTTP `/a2a` or `.coord` fallback).
    Send {
        instruction: String,
        #[arg(long, default_value = "shenron")]
        target: String,
        #[arg(long, default_value = "aphrody")]
        source: String,
        #[arg(long)]
        yolo: bool,
    },
    /// List resolved federation peers (env > aphrody-infra catalog > default).
    Peers,
}

/// Actions for the `scan` kernel subcommand (repo analytics).
#[derive(Subcommand, Debug, Clone)]
pub(crate) enum ScanAction {
    /// Size + file-count breakdown for top-level groups (vendor/packages/
    /// crates by default).
    Tree {
        /// Root of the project; defaults to the current working directory.
        #[arg(long)]
        root: Option<PathBuf>,
        /// Comma-separated list of top-level group directories to scan.
        #[arg(long, value_delimiter = ',')]
        groups: Vec<String>,
        /// Output JSON file path; `-` writes to stdout. Omitted = prints
        /// only the console summary.
        #[arg(long, short)]
        output: Option<PathBuf>,
        /// Number of top extensions to include per directory.
        #[arg(long, default_value = "5")]
        top_ext: usize,
    },
    /// Walk the repo for Cargo.toml / package.json / pyproject.toml / etc.
    /// and emit metadata (name, version, dependency count, workspace members).
    Manifests {
        #[arg(long)]
        root: Option<PathBuf>,
        #[arg(long, short)]
        output: Option<PathBuf>,
    },
}

/// Actions for the `self` kernel subcommand (installer + bootstrap).
#[derive(Subcommand, Debug, Clone)]
pub(crate) enum SelfAction {
    /// Register the release binary on the user PATH (HKCU on Windows,
    /// symlink into $HOME/.local/bin on Unix) and link the former standalone
    /// binary names (aphrody-infra, aphrody-kernel, …) to it.
    InstallPath {
        /// Absolute path to the aphrody binary; defaults to
        /// `<cwd>/target/release/aphrody[.exe]`.
        #[arg(long)]
        bin: Option<PathBuf>,
        /// Run `cargo build -p aphrody --release --locked` first when the
        /// binary is missing.
        #[arg(long)]
        build: bool,
        /// Plan-only: print the intended actions, never mutate PATH/symlinks.
        #[arg(long)]
        dry_run: bool,
    },
    /// Inventory dev toolchain (rustup, cargo, git, zigbuild, wasm targets).
    /// With `--check`, prints the inventory and exits non-zero on missing
    /// required tools; without it, attempts `rustup target add` to fill gaps.
    Bootstrap {
        /// Print inventory only; do not install anything.
        #[arg(long)]
        check: bool,
    },
}

/// Actions for the `mcp` kernel subcommand (Model Context Protocol).
///
/// Backed by `gemini-runtime` MCP client. Output is NDJSON on stdout — one
/// line per server / one result envelope — so it can be piped into `jq`.
#[cfg(not(target_arch = "wasm32"))]
#[derive(Subcommand, Debug, Clone)]
pub(crate) enum McpAction {
    /// Add a server to ~/.aphrody/config.toml.
    Add {
        name: String,
        /// Connect to an HTTP MCP server instead of spawning a command.
        #[arg(long, conflicts_with = "command")]
        url: Option<String>,
        /// Stdio command and arguments, following `--`.
        #[arg(last = true)]
        command: Vec<String>,
    },
    /// Remove a server from ~/.aphrody/config.toml.
    Remove { name: String },
    /// Show a configured server without exposing environment values.
    Get { name: String },
    /// List configured MCP servers + (by default) probe `tools/list` for each.
    List {
        /// Override the default config path (`~/.config/aphrody/mcp.json`).
        #[arg(long)]
        config: Option<PathBuf>,
        /// Skip the live probe; emit only the static config.
        #[arg(long)]
        no_probe: bool,
    },
    /// Invoke a single tool on a configured MCP server.
    ///
    /// Example: aphrody mcp call google_mcp search --args '{"q":"rust"}'
    Call {
        /// Override the default config path (`~/.config/aphrody/mcp.json`).
        #[arg(long)]
        config: Option<PathBuf>,
        /// Server name (key in `mcpServers`).
        server: String,
        /// Tool name to invoke.
        tool: String,
        /// JSON-encoded `arguments` object passed to `tools/call`.
        #[arg(long, default_value = "{}")]
        args: String,
    },
}

/// Actions for the `memory` kernel subcommand (Tier-1 provider operations).
///
/// Currently ships a single action: `migrate` — copy records between any pair
/// of Tier-1 providers (`mem0`, `honcho`, `sqlite-local`). Future actions
/// (list, audit, gc) follow the same pattern.
#[cfg(not(target_arch = "wasm32"))]
#[derive(Subcommand, Debug, Clone)]
pub(crate) enum MemoryAction {
    /// Copy all records for `--agent-id` from one provider to another.
    ///
    /// With `--dry-run` the source is fully enumerated but no write is
    /// issued — a JSON diff is emitted on stdout instead (set `--json` to
    /// parse it programmatically). Skipped records (per-item write errors)
    /// are collected and never abort the sweep.
    ///
    /// Example (lancedb → honcho dry-run):
    ///   aphrody memory migrate --from lancedb --to honcho \
    ///     --from-lancedb-path ./var/memory --lancedb-ndims 768 \
    ///     --agent-id agent-A --dry-run
    ///
    /// Example (offline sqlite test):
    ///   aphrody memory migrate --from sqlite-local --to sqlite-local \
    ///     --from-sqlite-path a.sqlite --to-sqlite-path b.sqlite \
    ///     --agent-id agent-A --dry-run --json
    Migrate {
        /// Source provider.
        #[arg(long, value_enum)]
        from: memory_cmd::MemoryProviderArg,
        /// Target provider.
        #[arg(long, value_enum)]
        to: memory_cmd::MemoryProviderArg,
        /// Logical owner — all records outside this scope are untouched.
        #[arg(long)]
        agent_id: String,
        /// Preview only: enumerate source but perform zero writes.
        #[arg(long)]
        dry_run: bool,
        /// Emit diff as a compact JSON object on stdout (parseable by jq).
        #[arg(long)]
        json: bool,
        /// Pretty-print the JSON diff (implies `--json`).
        #[arg(long)]
        pretty: bool,
        /// Filesystem path for the source SQLite store (sqlite-local only).
        #[arg(long)]
        from_sqlite_path: Option<PathBuf>,
        /// Filesystem path for the target SQLite store (sqlite-local only).
        #[arg(long)]
        to_sqlite_path: Option<PathBuf>,
        /// Filesystem path for the source LanceDB store directory (lancedb only).
        #[arg(long)]
        from_lancedb_path: Option<PathBuf>,
        /// Filesystem path for the target LanceDB store directory (lancedb only).
        #[arg(long)]
        to_lancedb_path: Option<PathBuf>,
        /// Embedding vector dimensionality for LanceDB backends.
        /// Required when `--from lancedb` or `--to lancedb`; defaults to 768
        /// (matches all-MiniLM-L6-v2 and similar sentence-embedding models).
        #[arg(long, default_value_t = 768)]
        lancedb_ndims: usize,
    },
}

/// Actions for the `re` kernel subcommand (Reverse engineering).
///
/// Backed by the `aphrody-re` crate (pure Rust, goblin + sha2). Output is
/// pretty-printed JSON on stdout — pipe to `jq` for filtering.
#[cfg(not(target_arch = "wasm32"))]
#[derive(Subcommand, Debug, Clone)]
pub(crate) enum ReAction {
    /// Triage a binary: detect format (PE32/PE64/ELF32/ELF64), parse
    /// sections + entropy + imports/exports + strings sample + SHA-256.
    ///
    /// Example: aphrody re triage /usr/bin/ls | jq '.format, .arch, .entry_point'
    Triage {
        /// Path to the binary to analyse. Read into memory in full
        /// (best for binaries < 100 MB).
        path: PathBuf,
        /// Pretty-print the JSON (default: compact one-line).
        #[arg(long)]
        pretty: bool,
    },
    /// Extract ASCII + UTF-16LE strings from a binary.
    ///
    /// Scans the raw bytes for contiguous runs of printable characters
    /// (ASCII 0x20–0x7E) and UTF-16LE codepoint pairs. Duplicates are
    /// collapsed. Output is a JSON array of strings.
    ///
    /// Example: aphrody re strings target/release/aphrody.exe --min-len 8 --pretty
    Strings {
        /// Path to the binary to scan.
        path: PathBuf,
        /// Minimum character length for a string to be included.
        /// Defaults to `STRINGS_MIN_LEN` (6).
        #[arg(long, default_value_t = aphrody_re::STRINGS_MIN_LEN)]
        min_len: usize,
        /// Maximum number of strings to return.
        /// Defaults to `STRINGS_SAMPLE_LIMIT` (64).
        #[arg(long, default_value_t = aphrody_re::STRINGS_SAMPLE_LIMIT)]
        limit: usize,
        /// Pretty-print the JSON (default: compact one-line).
        #[arg(long)]
        pretty: bool,
    },
    /// Parse a binary and output its sections as JSON.
    ///
    /// Each entry contains `name`, `vaddr`, `size`, and `entropy`
    /// (Shannon bits/byte, null for zero-size sections like `.bss`).
    /// High entropy (≥ 7.0) indicates compression or encryption.
    ///
    /// Example: aphrody re sections target/release/aphrody.exe --pretty | jq '.[] | select(.entropy
    /// > 7)'
    Sections {
        /// Path to the binary to parse.
        path: PathBuf,
        /// Pretty-print the JSON (default: compact one-line).
        #[arg(long)]
        pretty: bool,
    },
    /// Disassemble x86-64 instructions from a binary (or raw shellcode).
    ///
    /// Reads the file into memory and decodes up to `--limit` instructions
    /// starting at byte offset 0, using the virtual address supplied via
    /// `--rip` for display. Uses `iced-x86` Intel-syntax formatter.
    ///
    /// Output is a JSON array of `{ offset, address, bytes_hex, mnemonic, text }`.
    ///
    /// Example: aphrody re disasm target/release/aphrody.exe --limit 20 --pretty
    Disasm {
        /// Path to the binary (or raw shellcode blob) to disassemble.
        path: PathBuf,
        /// Virtual address of the first byte (used for the `address` field
        /// and RIP-relative operand display). Pass 0 when the load address
        /// is unknown.
        #[arg(long, default_value_t = 0)]
        rip: u64,
        /// Maximum number of instructions to decode. Defaults to
        /// `DISASM_LIMIT` (256).
        #[arg(long)]
        limit: Option<usize>,
        /// Pretty-print the JSON (default: compact one-line).
        #[arg(long)]
        pretty: bool,
    },
    /// Analyse a Google binary (Electron / Chromium / Go / Node / V8 snapshot).
    ///
    /// Detects the binary family, extracts OAuth2 client IDs, Google API
    /// endpoints, auto-updater URLs, and code-signing subject. Output is a
    /// single JSON object.
    ///
    /// Example: aphrody re google agy.exe --pretty | jq '.family, .chromium_version'
    Google {
        /// Path to the binary to analyse.
        path: PathBuf,
        /// Pretty-print the JSON (default: compact one-line).
        #[arg(long)]
        pretty: bool,
    },
    /// Classify a file's content type with Google Magika (deep-learning).
    ///
    /// Native, in-process replacement for the Python `magika` shell-out.
    /// Outputs `{ label, mime_type, group, description, extensions, is_text,
    /// score, kind, overwrite_reason }`. Requires building with
    /// `--features magika` (links the ONNX Runtime); without it the command
    /// errors with the rebuild instruction rather than silently degrading.
    ///
    /// Example: aphrody re classify state.vscdb --pretty | jq '.label, .score'
    #[cfg(feature = "magika")]
    Classify {
        /// Path to the file to classify.
        path: PathBuf,
        /// Pretty-print the JSON (default: compact one-line).
        #[arg(long)]
        pretty: bool,
    },
    /// Analyse a Go binary — version, function table, packages, type names.
    ///
    /// Detects Go binaries via `buildinfo` magic and `pclntab` structure.
    /// Handles Go 1.18+ and 1.20+ pclntab layouts. Degrades gracefully on
    /// stripped binaries (buildinfo absent but pclntab present). Zero GPL
    /// dependency — pure Rust via goblin.
    ///
    /// Output JSON: `{ is_go, go_version, build_flags, module_path,
    ///   func_count, funcs, packages, types_sample }`.
    ///
    /// Example: aphrody re go language_server.exe --pretty | jq '.go_version, .func_count'
    Go {
        /// Path to the binary to analyse.
        path: PathBuf,
        /// Pretty-print the JSON (default: compact one-line).
        #[arg(long)]
        pretty: bool,
        /// Deep Go recovery: also delegate to `redress` (goretk) and merge its
        /// `info` + `packages` output under a `redress` key. Useful when native
        /// recovery is weak (go1.27 google3/blaze builds → native
        /// `func_count = 0`). Resolves redress via
        /// $REDRESS_BIN > PATH > $GOPATH/bin > ~/go/bin.
        #[arg(long)]
        deep: bool,
    },
    /// Auto reverse-engineering — orchestrates all RE passes on a binary or folder.
    ///
    /// Runs (in order): triage, strings, Google endpoint extraction, Go analysis
    /// (if applicable), entrypoint disasm. With `--deep` also invokes Ghidra
    /// headless (requires `$GHIDRA_INSTALL_DIR` or `$GHIDRA_HOME`).
    ///
    /// On a folder: recursively scans executables (PE/ELF by magic), runs
    /// `auto` on each with concurrency=4, emits a JSON array.
    ///
    /// Pure-Rust passes are fast (milliseconds). `--deep` is strictly opt-in
    /// (Ghidra JVM startup is slow).
    ///
    /// Example: aphrody re auto language_server.exe --json | jq '.go.func_count'
    /// Example (batch): aphrody re auto ./bin --json --limit 500
    Auto {
        /// Path to the binary or directory to analyse.
        path: PathBuf,
        /// Also invoke Ghidra headless for decompilation (opt-in, slow).
        /// Requires `$GHIDRA_INSTALL_DIR` or `$GHIDRA_HOME`.
        #[arg(long)]
        deep: bool,
        /// Emit only pure JSON on stdout (default: also prints a markdown
        /// summary on stderr). Useful for scripting.
        #[arg(long)]
        json: bool,
        /// Maximum number of strings to extract per file (default: 2000).
        #[arg(long, default_value_t = 2000)]
        limit: usize,
    },
    /// Scan a binary with YARA-X rules (pure Rust, BSD-3-Clause).
    ///
    /// Compiles the rules from `--rules` and scans `<binary>` in memory.
    /// Returns a JSON report with every matching rule name, namespace, tags,
    /// and all matched string occurrences (identifier + byte offset + hex).
    ///
    /// Requires building with `--features yara` (activates the `yara` feature
    /// in `aphrody-re`; pure Rust, no C). Without it the command errors with
    /// the rebuild instruction rather than silently degrading.
    ///
    /// Example: aphrody re yara --rules malware.yar target.exe --pretty | jq '.matches[].rule_name'
    Yara {
        /// Path to the YARA rules file (UTF-8 source, may contain multiple
        /// rules and optional namespace declarations).
        #[arg(long)]
        rules: PathBuf,
        /// Path to the binary (or any file) to scan.
        path: PathBuf,
        /// Pretty-print the JSON output (default: compact one-line).
        #[arg(long)]
        pretty: bool,
    },
}

// Natural-language prompt detection lives in `crate::nl_tokens`. The
// canonical token inventory and the detector are shared with
// `commands::AutoCommand::execute` to guarantee both call sites agree.
#[cfg(not(target_arch = "wasm32"))]
use crate::nl_tokens::is_natural_language_prompt;

// ===========================================================================
// Native entry point — full command dispatch.
// ===========================================================================

/// Run the full command dispatch and return a `miette::Result<()>`.
///
/// Extracted from `main` so the tokio entry-point can intercept
/// `SubprocessExit` errors and issue the single authoritative
/// `process::exit` call there, keeping all library code free of direct
/// exit calls.
#[cfg(not(target_arch = "wasm32"))]
async fn dispatch(ctx: &GoogleContext, cli: Cli) -> miette::Result<()> {
    let overrides = cli.agent_options.overrides();
    if let Some(prompt) = cli.interactive.as_ref() {
        if cli.command.is_some() {
            return Err(miette::miette!("-i/--interactive cannot be combined with a subcommand"));
        }
        agent_run::run(
            agent_run::AgentArgs {
                prompt: Some(prompt.clone()),
                tui: true,
                stub: false,
                model: None,
                system: None,
                gated: false,
                cwd: None,
                verbose: false,
            },
            overrides,
        )
        .await?;
        return Ok(());
    }
    match cli.command {
        #[cfg(feature = "rag")]
        Some(Commands::Rag(args)) => rag_cmd::run(args, overrides).await?,
        Some(Commands::LlamaDaemon { state_root, role }) => {
            oss_cmd::run_daemon(state_root, role).await?
        },
        Some(Commands::Exec(mut args)) => {
            if cli.agent_options.yolo {
                args.max_tool_iterations = 0;
            }
            exec_cmd::run(*args, overrides).await?;
        },
        Some(Commands::Resume(args)) => {
            exec_cmd::run(
                exec_cmd::ExecArgs {
                    command: Some(exec_cmd::ExecCommand::Resume(args)),
                    ..Default::default()
                },
                overrides,
            )
            .await?;
        },
        Some(Commands::Fork(args)) => {
            exec_cmd::run(
                exec_cmd::ExecArgs {
                    command: Some(exec_cmd::ExecCommand::Fork(args)),
                    ..Default::default()
                },
                overrides,
            )
            .await?;
        },
        Some(Commands::AppServer { http, addr }) => {
            app_server_cmd::run(SessionAction::Serve { http, addr }).await?;
        },
        #[cfg(not(target_arch = "wasm32"))]
        Some(Commands::Gateway { action }) => {
            gateway_cmd::run(action.unwrap_or_default()).await?;
        },
        Some(Commands::Config { action }) => {
            config_cmd::run(
                action,
                cli.agent_options.profile.clone(),
                &cli.agent_options.config,
                cli.agent_options.oss,
                cli.agent_options.local_provider.clone(),
            )
            .await?;
        },
        #[cfg(not(target_arch = "wasm32"))]
        Some(Commands::Ai { action }) => {
            ai_env_cmd::run(action).await?;
        },
        #[cfg(not(target_arch = "wasm32"))]
        Some(Commands::Native { action }) => {
            pillars_cmd::handle_native(action)?;
        },
        #[cfg(not(target_arch = "wasm32"))]
        Some(Commands::Os { action }) => {
            pillars_cmd::handle_os(action).await?;
        },
        #[cfg(not(target_arch = "wasm32"))]
        Some(Commands::Web { action }) => {
            pillars_cmd::handle_web(action).await?;
        },
        #[cfg(not(target_arch = "wasm32"))]
        Some(Commands::Shell { action }) => {
            pillars_cmd::handle_shell(action)?;
        },
        Some(Commands::Codex { args }) => {
            commands::CodexCommand { args }.execute(ctx).await?;
        },
        #[cfg(feature = "train")]
        Some(Commands::Train(args)) => train_cmd::run(args).await?,
        Some(Commands::Auth { force }) => {
            commands::AuthCommand { force }.execute(ctx).await?;
        },
        Some(Commands::Version { json }) => {
            VersionCommand { json }.execute(ctx).await?;
        },
        Some(Commands::Doctor { json }) => {
            DoctorCommand { json_output: json }.execute(ctx).await?;
        },
        Some(Commands::Mirror { action }) => {
            MirrorCommand { action }.execute(ctx).await?;
        },

        Some(Commands::A2a { action }) => {
            commands::dispatch_a2a(action, ctx).await?;
        },
        Some(Commands::Cros { action }) => {
            commands::CrosCommand { action }.execute(ctx).await?;
        },
        Some(Commands::Search { query }) => {
            commands::SearchCommand { query }.execute(ctx).await?;
        },
        Some(Commands::Gemini { args }) => {
            commands::GeminiCommand { args }.execute(ctx).await?;
        },
        Some(Commands::AgyLoop { action }) => {
            agy_loop::run(action)?;
        },
        Some(Commands::Agy { args }) => {
            commands::AgyCommand { args }.execute(ctx).await?;
        },
        Some(Commands::Google { args }) => {
            commands::GoogleCommand { args }.execute(ctx).await?;
        },
        Some(Commands::Translate { text, source, target, backend, file, json }) => {
            commands::TranslateCommand { text, source, target, backend, file, json }
                .execute(ctx)
                .await?;
        },
        Some(Commands::N2b { args }) => {
            commands::N2bCommand { args }.execute(ctx).await?;
        },
        Some(Commands::Nie { args }) => {
            commands::NieCommand { args }.execute(ctx).await?;
        },
        Some(Commands::Ssh { args }) => {
            commands::SshCommand { args }.execute(ctx).await?;
        },
        Some(Commands::Term { addr, shell, cwd, token }) => {
            commands::TermCommand { addr, shell, cwd, token }.execute(ctx).await?;
        },
        Some(Commands::Mcp { action }) => match action {
            McpAction::Add { name, url, command } => {
                mcp_cmd::add_server(&name, url.as_deref(), &command)?;
            },
            McpAction::Remove { name } => {
                mcp_cmd::remove_server(&name)?;
            },
            McpAction::Get { name } => {
                mcp_cmd::get_server(&name)?;
            },
            McpAction::List { config, no_probe } => {
                mcp_cmd::McpListCommand { config, no_probe }.execute(ctx).await?;
            },
            McpAction::Call { config, server, tool, args } => {
                mcp_cmd::McpCallCommand { config, server, tool, args }.execute(ctx).await?;
            },
        },
        Some(Commands::Discord { action }) => {
            discord_cmd::run_discord(action).await?;
        },
        Some(Commands::Git { action }) => {
            git_cmd::run(action).await?;
        },
        Some(Commands::Ingest {
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
        }) => {
            git_cmd::run(git_cmd::GitAction::Ingest {
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
            })
            .await?;
        },
        Some(Commands::Docs { action }) => {
            docs_cmd::execute_docs(action).await?;
        },
        Some(Commands::Awesome { action }) => {
            docs_cmd::execute_awesome(action).await?;
        },
        Some(Commands::Memory { action }) => match action {
            MemoryAction::Migrate {
                from,
                to,
                agent_id,
                dry_run,
                json,
                pretty,
                from_sqlite_path,
                to_sqlite_path,
                from_lancedb_path,
                to_lancedb_path,
                lancedb_ndims,
            } => {
                let profile_sqlite_path = if (from == memory_cmd::MemoryProviderArg::SqliteLocal
                    && from_sqlite_path.is_none())
                    || (to == memory_cmd::MemoryProviderArg::SqliteLocal
                        && to_sqlite_path.is_none())
                {
                    Some(memory_cmd::profile_sqlite_path(&overrides)?)
                } else {
                    None
                };
                memory_cmd::MigrateCommand {
                    from,
                    to,
                    agent_id,
                    dry_run,
                    json: json || pretty,
                    pretty,
                    from_sqlite_path: from_sqlite_path.or_else(|| {
                        (from == memory_cmd::MemoryProviderArg::SqliteLocal)
                            .then(|| profile_sqlite_path.clone())
                            .flatten()
                    }),
                    to_sqlite_path: to_sqlite_path.or_else(|| {
                        (to == memory_cmd::MemoryProviderArg::SqliteLocal)
                            .then(|| profile_sqlite_path.clone())
                            .flatten()
                    }),
                    from_lancedb_path,
                    to_lancedb_path,
                    lancedb_ndims,
                }
                .execute(ctx)
                .await?;
            },
        },
        Some(Commands::Re { action }) => match action {
            ReAction::Triage { path, pretty } => {
                let bytes = std::fs::read(&path)
                    .map_err(|e| miette::miette!("failed to read {}: {e}", path.display()))?;
                let report = aphrody_re::triage(&bytes)
                    .map_err(|e| miette::miette!("aphrody-re triage failed: {e}"))?;
                let json = if pretty {
                    serde_json::to_string_pretty(&report)
                } else {
                    serde_json::to_string(&report)
                }
                .map_err(|e| miette::miette!("JSON encode failed: {e}"))?;
                println!("{json}");
            },
            ReAction::Strings { path, min_len, limit, pretty } => {
                let bytes = std::fs::read(&path)
                    .map_err(|e| miette::miette!("failed to read {}: {e}", path.display()))?;
                let strings = aphrody_re::extract_strings(&bytes, min_len, limit);
                let json = if pretty {
                    serde_json::to_string_pretty(&strings)
                } else {
                    serde_json::to_string(&strings)
                }
                .map_err(|e| miette::miette!("JSON encode failed: {e}"))?;
                println!("{json}");
            },
            ReAction::Sections { path, pretty } => {
                let bytes = std::fs::read(&path)
                    .map_err(|e| miette::miette!("failed to read {}: {e}", path.display()))?;
                let report = aphrody_re::triage(&bytes)
                    .map_err(|e| miette::miette!("aphrody-re sections (via triage) failed: {e}"))?;
                let json = if pretty {
                    serde_json::to_string_pretty(&report.sections)
                } else {
                    serde_json::to_string(&report.sections)
                }
                .map_err(|e| miette::miette!("JSON encode failed: {e}"))?;
                println!("{json}");
            },
            ReAction::Disasm { path, rip, limit, pretty } => {
                let bytes = std::fs::read(&path)
                    .map_err(|e| miette::miette!("failed to read {}: {e}", path.display()))?;
                let effective_limit = limit.unwrap_or(aphrody_re::DISASM_LIMIT);
                let insns = aphrody_re::disasm(&bytes, rip, effective_limit);
                let json = if pretty {
                    serde_json::to_string_pretty(&insns)
                } else {
                    serde_json::to_string(&insns)
                }
                .map_err(|e| miette::miette!("JSON encode failed: {e}"))?;
                println!("{json}");
            },
            ReAction::Google { path, pretty } => {
                let bytes = std::fs::read(&path)
                    .map_err(|e| miette::miette!("failed to read {}: {e}", path.display()))?;
                let report = aphrody_re::google::analyze_google(&bytes);
                let json = if pretty {
                    serde_json::to_string_pretty(&report)
                } else {
                    serde_json::to_string(&report)
                }
                .map_err(|e| miette::miette!("JSON encode failed: {e}"))?;
                println!("{json}");
            },
            #[cfg(feature = "magika")]
            ReAction::Classify { path, pretty } => {
                let report = aphrody_re::magika::classify_path(&path)
                    .map_err(|e| miette::miette!("magika classify failed: {e}"))?;
                let json = if pretty {
                    serde_json::to_string_pretty(&report)
                } else {
                    serde_json::to_string(&report)
                }
                .map_err(|e| miette::miette!("JSON encode failed: {e}"))?;
                println!("{json}");
            },
            ReAction::Go { path, pretty, deep } => {
                let bytes = std::fs::read(&path)
                    .map_err(|e| miette::miette!("failed to read {}: {e}", path.display()))?;
                let report = aphrody_re::golang::analyze_go(&bytes);
                // Base JSON: le rapport natif, ou `{"is_go":false}`.
                let mut value = match &report {
                    Some(r) => serde_json::to_value(r)
                        .map_err(|e| miette::miette!("JSON encode failed: {e}"))?,
                    None => serde_json::json!({ "is_go": false }),
                };
                // `--deep` : déléguer à redress (lent, opt-in) et fusionner.
                if deep {
                    let path_for_redress = path.clone();
                    let redress = tokio::task::spawn_blocking(move || {
                        re_auto::run_redress(&path_for_redress)
                    })
                    .await
                    .map_err(|e| miette::miette!("redress task panicked: {e}"))?;
                    if let serde_json::Value::Object(ref mut map) = value {
                        map.insert(
                            "redress".to_owned(),
                            serde_json::to_value(&redress)
                                .map_err(|e| miette::miette!("redress JSON encode failed: {e}"))?,
                        );
                    }
                }
                let json = if pretty {
                    serde_json::to_string_pretty(&value)
                } else {
                    serde_json::to_string(&value)
                }
                .map_err(|e| miette::miette!("JSON encode failed: {e}"))?;
                println!("{json}");
            },
            ReAction::Auto { path, deep, json, limit } => {
                let result = tokio::task::spawn_blocking(move || {
                    re_auto::run_auto(&path, deep, json, limit)
                })
                .await
                .map_err(|e| miette::miette!("task panicked: {e}"))?
                .map_err(|e| miette::miette!("re auto failed: {e}"))?;
                println!("{result}");
            },
            ReAction::Yara { rules, path, pretty } => {
                #[cfg(feature = "yara")]
                {
                    // Both files are read in a spawn_blocking so we never block
                    // the tokio worker thread on disk I/O.
                    let result = tokio::task::spawn_blocking(move || -> miette::Result<String> {
                        let rules_src = std::fs::read_to_string(&rules).map_err(|e| {
                            miette::miette!("failed to read rules {}: {e}", rules.display())
                        })?;
                        let data = std::fs::read(&path).map_err(|e| {
                            miette::miette!("failed to read {}: {e}", path.display())
                        })?;
                        let report = aphrody_re::yara::scan(&rules_src, &data)
                            .map_err(|e| miette::miette!("yara scan failed: {e}"))?;
                        let json = if pretty {
                            serde_json::to_string_pretty(&report)
                        } else {
                            serde_json::to_string(&report)
                        }
                        .map_err(|e| miette::miette!("JSON encode failed: {e}"))?;
                        Ok(json)
                    })
                    .await
                    .map_err(|e| miette::miette!("task panicked: {e}"))??;
                    println!("{result}");
                }
                #[cfg(not(feature = "yara"))]
                {
                    let _ = (&rules, &path, pretty);
                    return Err(miette::miette!(
                        "`aphrody re yara` requires the `yara` feature (yara-x pure Rust engine). \
                         Rebuild with: cargo build -p aphrody --features yara"
                    ));
                }
            },
        },
        #[cfg(feature = "index")]
        Some(Commands::Index { action }) => {
            index_cmd::run(action).await?;
        },
        #[cfg(not(target_arch = "wasm32"))]
        Some(Commands::Model { action }) => {
            model_cmd::run(action).await?;
        },
        #[cfg(all(not(target_arch = "wasm32"), feature = "infer"))]
        Some(Commands::Infer { action }) => {
            infer_cmd::run(action)?;
        },
        #[cfg(all(not(target_arch = "wasm32"), feature = "jobs"))]
        Some(Commands::Job { action }) => {
            job_cmd::run(action).await?;
        },
        #[cfg(all(not(target_arch = "wasm32"), feature = "ocr"))]
        Some(Commands::Ocr { action }) => {
            // Synchrone de bout en bout (llama.cpp en processus fils), sauf le
            // pont `dbfr` qui parle HTTP.
            ocr_cmd::run(action).await?;
        },

        #[cfg(feature = "firefly")]
        Some(Commands::Firefly { action }) => {
            firefly_cmd::run(action).await?;
        },
        #[cfg(feature = "forensics")]
        Some(Commands::Forensics { action }) => {
            forensics_cmd::run(action).await?;
        },
        Some(Commands::Chat { prompt, model, system, stub, attach, local }) => {
            commands::ChatCommand { prompt, model, system, stub, attach, local }
                .execute(ctx)
                .await?;
        },
        Some(Commands::Notify { channel, message, room, attach }) => {
            commands::NotifyCommand { channel, message, room, attach }.execute(ctx).await?;
        },
        #[cfg(not(target_arch = "wasm32"))]
        Some(Commands::Mail { action }) => {
            commands::MailCommand { action }.execute(ctx).await?;
        },
        #[cfg(not(target_arch = "wasm32"))]
        Some(Commands::Hermes { channel, voice, trigger, model, stub, simulate }) => {
            let ch = match channel {
                HermesChannelArg::Discord => agent_cmd::HermesChannel::Discord,
                HermesChannelArg::X => agent_cmd::HermesChannel::X,
            };
            agent_cmd::run(ch, voice, trigger, model, stub, simulate).await?;
        },
        #[cfg(not(target_arch = "wasm32"))]
        Some(Commands::Agent { prompt, tui, stub, model, system, gated, cwd, verbose }) => {
            agent_run::run(
                agent_run::AgentArgs { prompt, tui, stub, model, system, gated, cwd, verbose },
                overrides,
            )
            .await?;
        },
        Some(Commands::Session { action }) => {
            app_server_cmd::run(action).await?;
        },
        Some(Commands::Completions { shell }) => {
            let mut cmd = Cli::command();
            // clap_complete::generate writes straight to the sink and `expect`s
            // on any write error, so `aphrody completions bash | head` (consumer
            // closes stdout early) would crash with a BrokenPipe panic (exit
            // 101/109). Buffer first, then write, treating a closed pipe as a
            // clean exit like a well-behaved filter (portable: EPIPE on Unix,
            // ERROR_BROKEN_PIPE on Windows both surface as BrokenPipe).
            let mut buf = Vec::new();
            clap_complete::generate(
                clap_complete::Shell::from(shell),
                &mut cmd,
                "aphrody",
                &mut buf,
            );
            use std::io::Write as _;
            match std::io::stdout().write_all(&buf) {
                Ok(()) => {},
                Err(e) if e.kind() == std::io::ErrorKind::BrokenPipe => {},
                Err(e) => return Err(miette::miette!("failed to write completions: {e}")),
            }
        },
        Some(Commands::SelfCmd { action }) => match action {
            SelfAction::InstallPath { bin, build, dry_run } => {
                self_cmd::InstallPathCommand { bin, build_if_missing: build, dry_run }
                    .execute(ctx)
                    .await?;
            },
            SelfAction::Bootstrap { check } => {
                self_cmd::BootstrapCommand { check }.execute(ctx).await?;
            },
        },
        #[cfg(not(target_arch = "wasm32"))]
        Some(Commands::Package { action }) => {
            package_cmd::run(action)?;
        },
        Some(Commands::Runtime { action }) => {
            runtime_cmd::run(action)?;
        },
        Some(Commands::Scan { action }) => match action {
            ScanAction::Tree { root, groups, output, top_ext } => {
                scan_cmd::TreeCommand { root, groups, output, top_ext_count: top_ext }
                    .execute(ctx)
                    .await?;
            },
            ScanAction::Manifests { root, output } => {
                scan_cmd::ManifestsCommand { root, output }.execute(ctx).await?;
            },
        },
        Some(Commands::OcOnboard {
            workspace,
            non_interactive,
            accept_risk,
            force,
            skip_bootstrap,
        }) => {
            oc_cmd::OnboardCommand {
                workspace,
                non_interactive,
                accept_risk,
                force,
                skip_bootstrap,
            }
            .execute(ctx)
            .await?;
        },
        Some(Commands::OcReset { scope, yes, dry_run }) => {
            oc_cmd::ResetCommand { scope, yes, dry_run }.execute(ctx).await?;
        },
        Some(Commands::OcUninstall { service, state, workspace, app, all, yes, dry_run }) => {
            oc_cmd::UninstallCommand { service, state, workspace, app, all, yes, dry_run }
                .execute(ctx)
                .await?;
        },
        Some(Commands::OcPairing { action }) => {
            oc_cmd::PairingCommand { action }.execute(ctx).await?;
        },
        Some(Commands::OcDocs { query, url_only }) => {
            oc_cmd::DocsCommand { query, url_only }.execute(ctx).await?;
        },
        Some(Commands::Notebooklm { action }) => {
            commands::NotebooklmCommand { action }.execute(ctx).await?;
        },
        Some(Commands::Antigravity { action }) => antigravity_cmd::run(action).await?,
        Some(Commands::Logo { ico, svg, maskable, size }) => {
            use aphrody_identity::logo;
            let mut wrote = false;
            if let Some(p) = ico {
                logo::write_ico(&p).map_err(|e| miette::miette!("logo ico: {e}"))?;
                println!("wrote {}", p.display());
                wrote = true;
            }
            if let Some(p) = svg {
                logo::write_svg(&p).map_err(|e| miette::miette!("logo svg: {e}"))?;
                println!("wrote {}", p.display());
                wrote = true;
            }
            if let Some(p) = maskable {
                let png = logo::maskable_png(size, logo::BRAND_BG)
                    .map_err(|e| miette::miette!("logo maskable: {e}"))?;
                std::fs::write(&p, png)
                    .map_err(|e| miette::miette!("write {}: {e}", p.display()))?;
                println!("wrote {}", p.display());
                wrote = true;
            }
            if !wrote {
                println!(
                    "Choose an output: --ico <path>, --svg <path>, or --maskable <path> (PNG; --size sets its pixel side)."
                );
            }
        },
        Some(Commands::Design { action }) => design_cmd::run(action)?,
        Some(Commands::Ide { action }) => ide_cmd::run(action).await?,
        Some(Commands::Vpn { action }) => vpn_cmd::run(action).await?,
        Some(Commands::Winclean { action }) => winclean_cmd::run(action).await?,
        Some(Commands::Auto(args)) => {
            if let Some(feature) = missing_command_feature(&args) {
                return Err(miette::miette!("`aphrody {}` requires --features {feature}", args[0]));
            }
            // Route NL prompts to the native A2A JSON-RPC client; defer to
            // the legacy bun/uv/cargo engine dispatcher only for tokens
            // that clearly look like a CLI command (known engine name,
            // standard subcommand, or a script file).
            if is_natural_language_prompt(&args) {
                let opts = auto_command::AutoCommand::new(args.join(" "));
                match auto_command::run(opts).await {
                    Ok(_) => {},
                    Err(err) => {
                        eprintln!("aphrody: {err}");
                        return Err(miette::miette!(
                            "auto_command failed (exit {})",
                            err.exit_code()
                        ));
                    },
                }
            } else {
                commands::AutoCommand { args }.execute(ctx).await?;
            }
        },
        None => {
            use std::io::IsTerminal as _;
            if bare_cli_opens_tui(std::io::stdin().is_terminal(), std::io::stdout().is_terminal()) {
                agent_run::run(
                    agent_run::AgentArgs {
                        prompt: None,
                        tui: true,
                        stub: false,
                        model: None,
                        system: None,
                        gated: false,
                        cwd: None,
                        verbose: false,
                    },
                    overrides,
                )
                .await?;
            } else {
                commands::AutoCommand { args: vec![] }.execute(ctx).await?;
            }
        },
    }

    Ok(())
}

// ===========================================================================
// Library entry points
// ===========================================================================
// The public surface of the `aphrody` *library* crate. All command logic is
// exit-free (commands return a `SubprocessExit` error rather than calling
// `std::process::exit`), so dispatching inside a host process — the
// `aphrody-ffi` cdylib loaded by Bun, for instance — never tears the host
// down. Exit-code translation happens exactly once, here.

/// Run the full native command surface from an explicit argument vector
/// (`args[0]` is the program name, per the argv/clap convention) and return the
/// resulting process exit code.
///
/// Builds a dedicated multi-threaded tokio runtime, installs the rustls `ring`
/// crypto provider (mandatory before the first `reqwest::Client`), parses the
/// arguments with clap, constructs the `GoogleContext` and dispatches. stdout
/// and stderr are inherited (not captured). This is the single entry point the
/// FFI layer wraps to expose 100% of aphrody as a native library; the `aphrody`
/// binary calls `run_native`.
#[cfg(not(target_arch = "wasm32"))]
pub fn run_from_args<I, T>(args: I) -> i32
where
    I: IntoIterator<Item = T>,
    T: Into<std::ffi::OsString> + Clone,
{
    // `ocr batch --server` is entirely synchronous: it blocks on a child
    // process and on loopback sockets, and touches no async API. Running it
    // inside a tokio runtime is not merely unnecessary — it panics, because a
    // runtime ends up dropped from a context where blocking is forbidden. So
    // that one path is dispatched BEFORE any runtime exists.
    // `I` is consumed once, so materialise it here and pass the vector on.
    let argv: Vec<std::ffi::OsString> = args.into_iter().map(Into::into).collect();
    // Former standalone binaries run on this thread, before any runtime exists.
    let argv = match multicall::resolve(argv) {
        multicall::Resolved::Entry(entry, args) => return entry(args),
        multicall::Resolved::Clap(argv) => argv,
    };

    #[cfg(all(not(target_arch = "wasm32"), feature = "ocr"))]
    if ocr_cmd::is_synchronous_server_batch(&argv) {
        return ocr_cmd::run_sync_server_batch(&argv);
    }

    let runtime = match tokio::runtime::Builder::new_multi_thread().enable_all().build() {
        Ok(runtime) => runtime,
        Err(err) => {
            eprintln!("aphrody: failed to start the async runtime: {err}");
            return 70; // EX_SOFTWARE (sysexits.h)
        },
    };
    runtime.block_on(run_async(argv))
}

/// Process-global [`GoogleContext`], built once and reused across calls so the
/// FFI path (many commands per process) does not rebuild the VFS layout + the
/// mirror on every invocation. For the binary (one command per process) this is
/// equivalent to building it inline. `GoogleContext` is `Send + Sync` (it is
/// `Arc`-backed shared state), so a process-global handle is sound.
#[cfg(not(target_arch = "wasm32"))]
fn shared_context() -> miette::Result<&'static GoogleContext> {
    static CONTEXT: std::sync::OnceLock<GoogleContext> = std::sync::OnceLock::new();
    if let Some(ctx) = CONTEXT.get() {
        return Ok(ctx);
    }
    let ctx = GoogleContext::new()?;
    Ok(CONTEXT.get_or_init(|| ctx))
}

/// Run the full native command surface on the **caller's** async runtime,
/// returning the exit code. This is the entry the `aphrody-ffi` cdylib drives
/// on a persistent tokio runtime (so repeated FFI calls do not pay a
/// runtime-spawn cost); `run_from_args` is the sync wrapper the binary uses.
///
/// Installs the rustls `ring` provider, parses `args` with clap, builds the
/// `GoogleContext` and dispatches. stdout/stderr are inherited.
#[cfg(not(target_arch = "wasm32"))]
pub async fn run_async<I, T>(args: I) -> i32
where
    I: IntoIterator<Item = T>,
    T: Into<std::ffi::OsString> + Clone,
{
    // rustls 0.23 requires an explicit CryptoProvider install before any
    // reqwest::Client::new() call (otherwise reqwest panics at runtime in
    // async_impl/client.rs). GoogleContext::new() builds one, so install first.
    let _ = rustls::crypto::ring::default_provider().install_default();

    let argv: Vec<std::ffi::OsString> = args.into_iter().map(Into::into).collect();
    let argv = match multicall::resolve(argv) {
        // The caller (FFI) may be inside a runtime: the tool gets its own thread.
        multicall::Resolved::Entry(entry, args) => return multicall::run_isolated(entry, args),
        multicall::Resolved::Clap(argv) => argv,
    };
    let cli = match Cli::try_parse_from(argv) {
        Ok(cli) => cli,
        Err(err) => {
            // clap renders --help/--version to stdout (exit 0) and usage errors
            // to stderr (exit 2) — the same codes the binary produced.
            let _ = err.print();
            return match err.kind() {
                clap::error::ErrorKind::DisplayHelp | clap::error::ErrorKind::DisplayVersion => 0,
                _ => 2,
            };
        },
    };

    let ctx = match shared_context() {
        Ok(ctx) => ctx,
        Err(err) => {
            eprintln!("aphrody: {err}");
            return 1;
        },
    };

    match dispatch(ctx, cli).await {
        Ok(()) => 0,
        Err(report) => {
            // `SubprocessExit` forwards a child process's exit code verbatim;
            // every other error is pretty-printed via miette and mapped to 1.
            if let Some(se) = report.downcast_ref::<SubprocessExit>() {
                return se.0;
            }
            eprintln!("{report:?}");
            1
        },
    }
}

/// Binary entry point: parse the real process arguments and return an
/// `std::process::ExitCode`. Used by `src/main.rs` on native targets.
#[cfg(not(target_arch = "wasm32"))]
#[must_use]
pub fn run_native() -> std::process::ExitCode {
    // reqwest is built with `rustls-no-provider`: install the process-wide rustls
    // crypto provider before any HTTP client exists (building one without it panics).
    let _ = rustls::crypto::ring::default_provider().install_default();
    let code = run_from_args(std::env::args_os());
    // ExitCode carries a u8; clamp anything outside 0..=255 to 1 (failure).
    std::process::ExitCode::from(u8::try_from(code).unwrap_or(1))
}

/// Structured result of a captured command run: the process exit code plus the
/// captured stdout and stderr. `Serialize` so a Tauri `#[command]` can return it
/// straight to the webview.
#[cfg(not(target_arch = "wasm32"))]
#[derive(Debug, Clone, serde::Serialize)]
pub struct CapturedRun {
    /// Process exit code (0 on success).
    pub code: i32,
    /// Captured stdout (lossy UTF-8).
    pub stdout: String,
    /// Captured stderr (lossy UTF-8).
    pub stderr: String,
}

/// Run the full native command surface from `args` (`args[0]` is the program
/// name, per the argv/clap convention) with stdout AND stderr captured
/// in-process, returning the structured [`CapturedRun`].
///
/// The structured counterpart to [`run_from_args`] (which inherits stdio): it
/// wraps the same dispatch in `aphrody_stdio_capture::with_captured_stdio`. The
/// Tauri app and any host that wants the output back (rather than on the
/// terminal) use this. The redirect is process-global, so concurrent callers
/// must serialise around it.
#[cfg(not(target_arch = "wasm32"))]
#[must_use]
pub fn run_captured<I, T>(args: I) -> CapturedRun
where
    I: IntoIterator<Item = T>,
    T: Into<std::ffi::OsString> + Clone,
{
    let (code, stdout, stderr) = aphrody_stdio_capture::with_captured_stdio(|| run_from_args(args));
    CapturedRun { code, stdout, stderr }
}

// ===========================================================================
// wasm entry point — parses the clap surface so `--version` / `--help`
// behave identically; every command short-circuits to a "not available on
// wasm" notice so users discover what the native binary offers.
// ===========================================================================
/// wasm32 entry point: parse the clap surface (so `--version` / `--help` still
/// work) and print a "not available on wasm" notice for every real command.
/// Used by `src/main.rs` on wasm targets.
#[cfg(target_arch = "wasm32")]
pub fn run_wasm() {
    let cli = Cli::parse();
    match cli.command {
        None | Some(Commands::Version { .. }) => {
            println!(
                "aphrody {} — wasm stub. Use the native binary for full command surface.",
                env!("CARGO_PKG_VERSION"),
            );
        },
        Some(other) => {
            let name = match other {
                Commands::Auth { .. } => "auth",
                Commands::Mirror { .. } => "mirror",

                Commands::A2a { .. } => "a2a",
                Commands::Cros { .. } => "cros",
                Commands::Search { .. } => "search",
                Commands::Gemini { .. } => "gemini",
                Commands::Agy { .. } => "agy",
                Commands::N2b { .. } => "n2b",
                Commands::Nie { .. } => "nie",
                Commands::Doctor { .. } => "doctor",
                Commands::Term { .. } => "term",
                Commands::Notify { .. } => "notify",
                #[cfg(not(target_arch = "wasm32"))]
                Commands::Mail { .. } => "mail",
                Commands::Completions { .. } => "completions",
                Commands::SelfCmd { .. } => "self",
                Commands::Scan { .. } => "scan",
                #[cfg(not(target_arch = "wasm32"))]
                Commands::Vpn { .. } => "vpn",
                #[cfg(not(target_arch = "wasm32"))]
                Commands::Winclean { .. } => "winclean",
                Commands::Auto(_) => "auto",
                Commands::Version { .. } => unreachable!(),
            };
            eprintln!(
                "command `{name}` is not available on the wasm target — use the native aphrody \
                 binary (Linux / Windows / macOS) instead."
            );
        },
    }
}

#[cfg(test)]
mod tests {
    #[cfg(not(target_arch = "wasm32"))]
    use super::*;

    #[cfg(not(target_arch = "wasm32"))]
    fn in_large_stack<F, R>(f: F) -> R
    where
        F: FnOnce() -> R + Send + 'static,
        R: Send + 'static,
    {
        std::thread::Builder::new()
            .stack_size(8 * 1024 * 1024)
            .spawn(f)
            .expect("failed to spawn test thread")
            .join()
            .expect("test thread panicked")
    }

    #[test]
    #[cfg(not(target_arch = "wasm32"))]
    fn translate_json_preserves_languages_and_option_like_text() {
        in_large_stack(|| {
            let cli = Cli::try_parse_from([
                "aphrody",
                "translate",
                "--source",
                "ja",
                "--target",
                "en",
                "--json",
                "--",
                "--悟空",
            ])
            .expect("translation command");
            match cli.command {
                Some(Commands::Translate { text, source, target, json, .. }) => {
                    assert_eq!(text.as_deref(), Some("--悟空"));
                    assert_eq!(source, "ja");
                    assert_eq!(target, "en");
                    assert!(json);
                },
                _ => panic!("expected translation"),
            }
        });
    }

    #[test]
    #[cfg(not(target_arch = "wasm32"))]
    fn session_serve_http_defaults_to_app_server_port() {
        in_large_stack(|| {
            let cli = Cli::try_parse_from(["aphrody", "session", "serve", "--http"])
                .expect("session serve parses");
            match cli.command {
                Some(Commands::Session { action: SessionAction::Serve { http, addr } }) => {
                    assert!(http);
                    assert_eq!(addr, "127.0.0.1:8765");
                },
                _ => panic!("expected session serve"),
            }
        });
    }

    #[test]
    #[cfg(not(target_arch = "wasm32"))]
    fn interactive_entry_requires_two_terminals_and_accepts_prompt() {
        assert!(bare_cli_opens_tui(true, true));
        assert!(!bare_cli_opens_tui(true, false));
        assert!(!bare_cli_opens_tui(false, true));
        in_large_stack(|| {
            let cli = Cli::try_parse_from(["aphrody", "-i", "inspect the workspace"])
                .expect("interactive prompt parses");
            assert_eq!(cli.interactive.as_deref(), Some("inspect the workspace"));
            assert!(cli.command.is_none());
        });
    }

    #[test]
    #[cfg(all(not(target_arch = "wasm32"), not(feature = "rag")))]
    fn disabled_feature_command_reports_required_feature() {
        in_large_stack(|| {
            let cli = Cli::try_parse_from(["aphrody", "rag", "search", "query"])
                .expect("external subcommand parses");
            let Some(Commands::Auto(args)) = cli.command else { panic!("external command") };
            assert_eq!(missing_command_feature(&args), Some("rag"));
        });
    }

    #[test]
    #[cfg(not(target_arch = "wasm32"))]
    fn command_graph_has_no_inherited_agent_flag_conflicts() {
        in_large_stack(|| {
            Cli::command().debug_assert();
        });
    }

    #[test]
    #[cfg(not(target_arch = "wasm32"))]
    fn agent_flags_preserve_legacy_short_flags_and_mcp_config_type() {
        in_large_stack(|| {
            let cli = Cli::try_parse_from(["aphrody", "chat", "-p", "hello", "-m", "legacy-model"])
                .expect("chat keeps its prompt shorthand");
            assert!(
                matches!(cli.command, Some(Commands::Chat { prompt: Some(prompt), .. }) if prompt == "hello")
            );
            let cli = Cli::try_parse_from(["aphrody", "mcp", "list", "--config", "custom.json"])
                .expect("MCP config remains a filesystem path");
            assert!(cli.agent_options.config.is_empty());
            let cli = Cli::try_parse_from([
                "aphrody",
                "-m",
                "root-model",
                "exec",
                "--stub",
                "-m",
                "exec-model",
                "resume",
                "--last",
                "-m",
                "session-model",
                "continue",
            ])
            .expect("agent options work at each agent command boundary");
            let Some(Commands::Exec(args)) = cli.command else { panic!("exec") };
            let inherited = args.options.apply_to(cli.agent_options.overrides());
            let Some(exec_cmd::ExecCommand::Resume(session)) = args.command else {
                panic!("resume")
            };
            assert_eq!(session.options.apply_to(inherited).model.as_deref(), Some("session-model"));
        });
    }

    #[test]
    #[cfg(not(target_arch = "wasm32"))]
    fn ssh_subcommand_parses_arbitrary_arguments() {
        in_large_stack(|| {
            let cli = Cli::try_parse_from(["aphrody", "ssh", "status", "--host", "vps"])
                .expect("aphrody ssh should parse");
            match cli.command {
                Some(Commands::Ssh { args }) => {
                    assert_eq!(args, vec!["status", "--host", "vps"]);
                },
                _ => panic!("expected Commands::Ssh"),
            }
        });
    }

    #[test]
    #[cfg(not(target_arch = "wasm32"))]
    fn ssh_config_dump_is_limited_to_the_read_only_openssh_form() {
        assert!(commands::is_openssh_config_dump(&["-G".into(), "vps".into()]));
        assert!(!commands::is_openssh_config_dump(&["-G".into()]));
        assert!(!commands::is_openssh_config_dump(&["-o".into(), "x=y".into()]));
    }
}
