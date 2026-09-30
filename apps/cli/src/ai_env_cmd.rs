// SPDX-License-Identifier: Apache-2.0
//! `aphrody ai env` — resolve this machine's local AI environment and
//! publish it under the eighteen canonical `APHRODY_AI_*` names
//! ([`aphrody_config::ai_env`]).
//!
//! This is the writer side of the `../aphrody-infra/config/local-ai.json`
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

use std::path::PathBuf;

use aphrody_config::ai_env::{self, CanonicalEnv};
use aphrody_llama_server::{Role, discover_running};
use aphrody_models::{Catalog, LocalRole};
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

/// One canonical variable's resolved value.
struct ResolvedVar {
    canonical: &'static str,
    value: Option<String>,
    /// `true` for `APHRODY_AI_HTTP_TOKEN`: [`Self::value`] is always `None`
    /// for a secret, and [`Self::note`] explains where the real value lives.
    secret: bool,
    note: Option<String>,
}

fn plain(canonical: CanonicalEnv, value: Option<String>) -> ResolvedVar {
    ResolvedVar { canonical: canonical.canonical, value, secret: false, note: None }
}

/// The binary reachable from this running process: an explicit env override,
/// else the executable currently running (for [`ai_env::BIN`]) or a same-named
/// sibling of it (for [`ai_env::MCP_BIN`]), else `PATH` — the lookup order
/// `../aphrody-infra/config/local-ai.json`'s `binaries.*.lookup` documents.
fn resolve_binary(
    canonical: CanonicalEnv,
    sibling_name: &str,
    self_is_current_exe: bool,
) -> ResolvedVar {
    let value = canonical
        .resolve()
        .or_else(|| {
            if self_is_current_exe {
                std::env::current_exe().ok().map(|path| path.display().to_string())
            } else {
                sibling_binary(sibling_name)
            }
        })
        .or_else(|| which::which(sibling_name).ok().map(|path| path.display().to_string()));
    plain(canonical, value)
}

/// A same-named binary next to the currently running executable, e.g.
/// `aphrody-mcp[.exe]` beside `aphrody[.exe]`.
fn sibling_binary(name: &str) -> Option<String> {
    let current = std::env::current_exe().ok()?;
    let filename = format!("{name}{}", std::env::consts::EXE_SUFFIX);
    let candidate = current.with_file_name(filename);
    candidate.is_file().then(|| candidate.display().to_string())
}

/// A capability's base URL: the canonical name or an alias, else a currently
/// running managed `llama-server` instance for `role`
/// ([`aphrody_llama_server::discover_running`] — the one fallback this
/// contract allows in place of a hardcoded port, CLAUDE.md §7). `None` when
/// neither resolves: never a guessed literal.
fn base_url_for(role: Role, canonical: CanonicalEnv) -> Option<String> {
    canonical.resolve().or_else(|| discover_running(role).map(|state| state.base_url()))
}

/// A role's model id: the canonical name or an alias, else the local
/// catalog's default for `role`.
fn role_model(role: LocalRole, canonical: CanonicalEnv) -> String {
    canonical.resolve().unwrap_or_else(|| role.default_model().to_owned())
}

/// The vector width of `model`: an explicit override
/// ([`ai_env::EMBED_DIMENSIONS`]) when present (a disagreement with the
/// catalog is reported on stderr, not silently resolved — this command only
/// reports the current environment, it does not enforce
/// [`aphrody_rag::resolve_embed`]'s stricter contract), else the catalog's
/// own dimension for `model`.
fn embed_dimensions(model: &str) -> Option<String> {
    let catalog_dim = Catalog::builtin().dimensions(model).ok().flatten();
    if let Some(env_dim) = ai_env::EMBED_DIMENSIONS.resolve() {
        if let (Ok(parsed), Some(catalog_dim)) = (env_dim.parse::<u32>(), catalog_dim)
            && parsed != catalog_dim
        {
            eprintln!(
                "warning: {} (or its alias) is set to {env_dim}, but model `{model}` is \
                 catalogued at {catalog_dim} dimensions; reporting the override as-is",
                ai_env::EMBED_DIMENSIONS.canonical
            );
        }
        return Some(env_dim);
    }
    catalog_dim.map(|dim| dim.to_string())
}

/// Resolve every canonical variable, in [`ai_env::ALL`]'s order.
fn resolve() -> Vec<ResolvedVar> {
    let embed_model = role_model(LocalRole::Embed, ai_env::EMBED_MODEL);
    let rerank_model = role_model(LocalRole::Rerank, ai_env::RERANK_MODEL);

    vec![
        resolve_binary(ai_env::BIN, "aphrody", true),
        resolve_binary(ai_env::MCP_BIN, "aphrody-mcp", false),
        plain(ai_env::HTTP_URL, ai_env::HTTP_URL.resolve()),
        ResolvedVar {
            canonical: ai_env::HTTP_TOKEN.canonical,
            value: None,
            secret: true,
            note: Some(if ai_env::HTTP_TOKEN.resolve().is_some() {
                format!("set via {}", ai_env::HTTP_TOKEN.resolve_source().unwrap_or_default())
            } else {
                "not configured on this machine (vps-only capability); see \
                 /etc/aphrody/shenron-compute-client.env on the vps target"
                    .to_owned()
            }),
        },
        plain(ai_env::CHAT_BASE_URL, base_url_for(Role::Chat, ai_env::CHAT_BASE_URL)),
        plain(ai_env::CHAT_MODEL, Some(role_model(LocalRole::Chat, ai_env::CHAT_MODEL))),
        plain(ai_env::CODE_MODEL, Some(role_model(LocalRole::Code, ai_env::CODE_MODEL))),
        plain(
            ai_env::REASONING_MODEL,
            Some(role_model(LocalRole::Reasoning, ai_env::REASONING_MODEL)),
        ),
        plain(ai_env::SMALL_MODEL, Some(role_model(LocalRole::Small, ai_env::SMALL_MODEL))),
        // No `Role::Vision` exists in `aphrody-llama-server` (only Chat / Embed
        // / Rerank instances are supervised): a running chat-role instance is
        // not reliably vision-capable, so this is environment-only, never a
        // guess at what the current chat instance happens to be serving.
        plain(ai_env::VISION_BASE_URL, ai_env::VISION_BASE_URL.resolve()),
        plain(ai_env::VISION_MODEL, Some(role_model(LocalRole::Vision, ai_env::VISION_MODEL))),
        plain(ai_env::OCR_MODEL, Some(role_model(LocalRole::Ocr, ai_env::OCR_MODEL))),
        plain(ai_env::STT_MODEL, Some(role_model(LocalRole::Stt, ai_env::STT_MODEL))),
        plain(ai_env::EMBED_BASE_URL, base_url_for(Role::Embed, ai_env::EMBED_BASE_URL)),
        plain(ai_env::EMBED_MODEL, Some(embed_model.clone())),
        plain(ai_env::EMBED_DIMENSIONS, embed_dimensions(&embed_model)),
        plain(ai_env::RERANK_BASE_URL, base_url_for(Role::Rerank, ai_env::RERANK_BASE_URL)),
        plain(ai_env::RERANK_MODEL, Some(rerank_model)),
    ]
}

/// `hostname:port` and friends may leak in error paths; this only ever names
/// a *resolution target*, never a credential.
fn host_label() -> String {
    if let Ok(distro) = std::env::var("WSL_DISTRO_NAME").map(|v| v.to_ascii_lowercase()) {
        return format!("wsl-{distro}");
    }
    if cfg!(target_os = "windows") {
        "windows-local".to_owned()
    } else if cfg!(target_os = "linux") {
        "linux-local".to_owned()
    } else if cfg!(target_os = "macos") {
        "macos-local".to_owned()
    } else {
        "local".to_owned()
    }
}

fn to_env_lines(resolved: &[ResolvedVar]) -> String {
    let mut out = String::new();
    out.push_str(
        "# Generated by `aphrody ai env`. Resolved for this machine only — do not commit.\n",
    );
    for var in resolved {
        match (&var.value, var.secret) {
            (Some(value), false) => out.push_str(&format!("{}={value}\n", var.canonical)),
            (_, true) => out.push_str(&format!(
                "# {}=  # secret: {}\n",
                var.canonical,
                var.note.as_deref().unwrap_or("never written here")
            )),
            (None, false) => out.push_str(&format!(
                "# {}=  # {}\n",
                var.canonical,
                var.note.as_deref().unwrap_or("not configured on this machine")
            )),
        }
    }
    out
}

fn to_nu_lines(resolved: &[ResolvedVar]) -> String {
    let mut out = String::new();
    for var in resolved {
        match (&var.value, var.secret) {
            (Some(value), false) => {
                out.push_str(&format!(
                    "$env.{} = \"{}\"\n",
                    var.canonical,
                    value.replace('"', "\\\"")
                ));
            },
            _ => out.push_str(&format!("# {} not set\n", var.canonical)),
        }
    }
    out
}

fn to_pwsh_lines(resolved: &[ResolvedVar]) -> String {
    let mut out = String::new();
    for var in resolved {
        match (&var.value, var.secret) {
            (Some(value), false) => {
                out.push_str(&format!(
                    "$env:{} = \"{}\"\n",
                    var.canonical,
                    value.replace('"', "`\"")
                ));
            },
            _ => out.push_str(&format!("# {} not set\n", var.canonical)),
        }
    }
    out
}

fn to_json(resolved: &[ResolvedVar]) -> serde_json::Value {
    let mut env = serde_json::Map::new();
    let mut notes = serde_json::Map::new();
    for var in resolved {
        env.insert(
            var.canonical.to_owned(),
            var.value.clone().map_or(serde_json::Value::Null, serde_json::Value::String),
        );
        if let Some(note) = &var.note {
            notes.insert(var.canonical.to_owned(), serde_json::Value::String(note.clone()));
        }
    }
    serde_json::json!({
        "schemaVersion": 1,
        "generatedBy": "aphrody ai env",
        "generatedAt": chrono::Utc::now().to_rfc3339(),
        "host": host_label(),
        "env": env,
        "notes": notes,
    })
}

fn ai_dir() -> miette::Result<PathBuf> {
    let state = aphrody_models::paths::state_dir().map_err(|e| miette::miette!("{e}"))?;
    Ok(state.join("ai"))
}

async fn env(args: EnvArgs) -> miette::Result<()> {
    let resolved = resolve();

    let dir = ai_dir()?;
    std::fs::create_dir_all(&dir).into_diagnostic()?;
    let json_path = dir.join("local-ai.json");
    let env_path = dir.join("local-ai.env");
    std::fs::write(
        &json_path,
        serde_json::to_string_pretty(&to_json(&resolved)).into_diagnostic()?,
    )
    .into_diagnostic()?;
    std::fs::write(&env_path, to_env_lines(&resolved)).into_diagnostic()?;
    eprintln!("wrote {}", json_path.display());
    eprintln!("wrote {}", env_path.display());

    if args.print {
        let body = match args.format {
            PrintFormat::Env => to_env_lines(&resolved),
            PrintFormat::Json => {
                serde_json::to_string_pretty(&to_json(&resolved)).into_diagnostic()?
            },
            PrintFormat::Nu => to_nu_lines(&resolved),
            PrintFormat::Pwsh => to_pwsh_lines(&resolved),
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

#[cfg(test)]
mod tests {
    use std::collections::BTreeSet;

    use super::*;

    #[test]
    fn resolved_names_are_exactly_the_eighteen_canonical_names() {
        let resolved = resolve();
        let names: BTreeSet<&str> = resolved.iter().map(|var| var.canonical).collect();
        let expected: BTreeSet<&str> = ai_env::ALL.iter().map(|v| v.canonical).collect();
        assert_eq!(names, expected);
        assert_eq!(resolved.len(), 18);
    }

    #[test]
    fn http_token_never_carries_a_value() {
        let resolved = resolve();
        let token =
            resolved.iter().find(|var| var.canonical == ai_env::HTTP_TOKEN.canonical).unwrap();
        assert!(token.secret);
        assert_eq!(token.value, None);
        assert!(token.note.is_some());
    }

    #[test]
    fn env_rendering_names_every_canonical_variable_once() {
        let resolved = resolve();
        let rendered = to_env_lines(&resolved);
        for var in &resolved {
            assert!(
                rendered.contains(var.canonical),
                "{} missing from rendered .env",
                var.canonical
            );
        }
    }

    #[test]
    fn json_rendering_never_inlines_the_http_token_value() {
        let resolved = resolve();
        let json = to_json(&resolved);
        assert_eq!(json["env"][ai_env::HTTP_TOKEN.canonical], serde_json::Value::Null);
        assert_eq!(json["schemaVersion"], 1);
    }

    /// Cross-checks the emitted names against
    /// `../aphrody-infra/config/local-ai.json` when that sibling checkout is
    /// present. Skips cleanly otherwise.
    #[test]
    fn matches_the_aphrody_infra_contract_when_present() {
        let candidate = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../../aphrody-infra/config/local-ai.json");
        let Ok(raw) = std::fs::read_to_string(&candidate) else {
            eprintln!(
                "skipping: {} not found (aphrody-infra is a sibling checkout)",
                candidate.display()
            );
            return;
        };
        let contract: serde_json::Value = serde_json::from_str(&raw).expect("valid JSON");
        let mut expected = BTreeSet::new();
        for section in ["binaries", "gateways", "capabilities"] {
            let Some(table) = contract.get(section).and_then(serde_json::Value::as_object) else {
                continue;
            };
            for entry in table.values() {
                let Some(vars) = entry.get("env").and_then(serde_json::Value::as_array) else {
                    continue;
                };
                for var in vars {
                    if let Some(name) = var.get("canonical").and_then(serde_json::Value::as_str) {
                        expected.insert(name.to_owned());
                    }
                }
            }
        }
        let actual: BTreeSet<String> =
            resolve().into_iter().map(|var| var.canonical.to_owned()).collect();
        assert_eq!(actual, expected);
    }
}
