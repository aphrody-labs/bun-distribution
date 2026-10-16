// SPDX-License-Identifier: Apache-2.0
use std::{collections::BTreeMap, path::PathBuf};

use serde::Serialize;

use crate::{
    config_toml::{
        ConfigToml, ConfigWarning, DEFAULT_PROJECT_DOC_MAX_BYTES, HistoryConfig,
        SandboxWorkspaceWrite, ShellEnvironmentPolicy,
    },
    home_agent::{A2aConfig, DatabaseConfig, OcrConfig, PluginConfig, RedisConfig, SkillsConfig},
    layer::{ConfigLayer, merge_layers, merge_toml_values},
    mcp::McpServerConfig,
    overrides::{OverrideError, apply_override, parse_override},
    policy::{AskForApproval, SandboxMode},
    provider::ModelProviderInfo,
    rag::{CompatConfig, ComputerUseConfig, LlamaConfig, RagConfig, TrainConfig},
};

/// Errors that stop configuration resolution outright. Everything that does
/// *not* need to stop resolution (unknown keys) is a [`ConfigWarning`]
/// instead.
#[derive(Debug, thiserror::Error)]
pub enum ConfigError {
    /// Re-serializing the merged layer stack failed. Should not happen for
    /// values built exclusively from [`crate::layer::merge_toml_values`],
    /// but surfaced rather than unwrapped.
    #[error("failed to serialize merged configuration: {0}")]
    Serialize(#[from] toml::ser::Error),
    /// The merged configuration does not match [`ConfigToml`]'s shape (a
    /// *known* field had the wrong type, e.g. `approval_policy = 5`).
    #[error("failed to deserialize merged configuration: {0}")]
    Deserialize(#[from] toml::de::Error),
    /// A `-c key=value` override string was malformed.
    #[error("invalid -c override: {0}")]
    Override(#[from] OverrideError),
    /// `--profile <name>` / `profile = "<name>"` named a profile that does
    /// not exist in `[profiles]`.
    #[error("unknown profile `{name}`; available profiles: [{}]", available.join(", "))]
    UnknownProfile {
        name: String,
        available: Vec<String>,
    },
    /// The resolved `model_provider` id has no entry in the built-in +
    /// user-defined provider catalog.
    #[error("unknown model provider `{id}`; available providers: [{}]", available.join(", "))]
    UnknownProvider { id: String, available: Vec<String> },
}

/// A model provider id paired with its resolved definition.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct ResolvedProvider {
    pub id: String,
    pub info: ModelProviderInfo,
}

/// Dedicated CLI flags that participate in resolution alongside `-c`
/// overrides and layered `config.toml` files. Mirrors the flag set on
/// `crates/cli`'s `Cli` struct (`-m --oss --local-provider -p -c -C -s -a
/// --full-auto --dangerously-bypass-approvals-and-sandbox`, P1 in
/// `docs/plans/codex-oss.md`).
#[derive(Debug, Clone, Default)]
pub struct CliOverrides {
    /// `-m/--model`.
    pub model: Option<String>,
    /// Explicit `--model-provider` (or `-C`) selection.
    pub model_provider: Option<String>,
    /// `--oss`: prefer the OSS local provider over any configured
    /// `model_provider`.
    pub oss: bool,
    /// `--local-provider`: the specific OSS provider id `--oss` should use,
    /// overriding `oss_provider` from `config.toml`.
    pub local_provider: Option<String>,
    /// `-p/--profile`.
    pub profile: Option<String>,
    /// `-a/--ask-for-approval`.
    pub approval_policy: Option<AskForApproval>,
    /// `-s/--sandbox`.
    pub sandbox_mode: Option<SandboxMode>,
    /// `--full-auto`: forces `workspace-write` + `never` (aphrody's
    /// resolved defaults already match this; the flag exists for explicit,
    /// non-overridable intent even against a stricter `config.toml`).
    pub full_auto: bool,
    /// `--dangerously-bypass-approvals-and-sandbox`: forces
    /// `danger-full-access` + `never`. Wins over `full_auto`.
    pub dangerously_bypass: bool,
    /// The resolved working directory, used by the caller when assembling
    /// the `Project` layer. Not read by [`resolve`] itself.
    pub cwd: Option<PathBuf>,
    /// Raw `-c key=value` strings, in the order they were given on the
    /// command line (later wins).
    pub config_overrides: Vec<String>,
}

/// The effective, ready-to-use configuration.
///
/// Every field that has a defined default (`approval_policy`,
/// `sandbox_mode`, `project_doc_max_bytes`, and the aphrody extension
/// tables) is a concrete value rather than an `Option`; fields with no
/// sensible universal default (`model`) stay `Option`. Never carries a
/// secret value — only environment variable *names* (see
/// [`ModelProviderInfo::env_key`]); [`Config::to_json`] is safe to log or
/// return from `aphrody config show --json`.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Config {
    pub model: Option<String>,
    pub review_model: Option<String>,
    pub provider: ResolvedProvider,
    pub approval_policy: AskForApproval,
    pub sandbox_mode: SandboxMode,
    pub sandbox_workspace_write: Option<SandboxWorkspaceWrite>,
    pub shell_environment_policy: ShellEnvironmentPolicy,
    pub model_context_window: Option<i64>,
    pub model_auto_compact_token_limit: Option<i64>,
    pub model_reasoning_effort: Option<String>,
    pub model_reasoning_summary: Option<String>,
    pub model_verbosity: Option<String>,
    pub notify: Vec<String>,
    pub instructions: Option<String>,
    pub developer_instructions: Option<String>,
    pub project_doc_max_bytes: usize,
    pub project_doc_fallback_filenames: Vec<String>,
    pub history: HistoryConfig,
    pub rag: RagConfig,
    pub database: DatabaseConfig,
    pub plugins: PluginConfig,
    pub skills: SkillsConfig,
    pub a2a: A2aConfig,
    pub ocr: OcrConfig,
    pub redis: RedisConfig,
    pub llama: LlamaConfig,
    pub train: TrainConfig,
    pub compat: CompatConfig,
    pub computer_use: ComputerUseConfig,
    pub tools: BTreeMap<String, toml::Value>,
    pub model_profiles: BTreeMap<String, toml::Value>,
    pub mcp_servers: BTreeMap<String, McpServerConfig>,
    pub model_providers: BTreeMap<String, ModelProviderInfo>,
    pub active_profile: Option<String>,
}

impl Config {
    /// Renders the effective configuration as a JSON value, for
    /// `aphrody config show --json`. Secrets never appear: providers only
    /// carry environment variable *names* (`env_key`), never resolved
    /// values.
    #[must_use]
    pub fn to_json(&self) -> serde_json::Value {
        serde_json::to_value(self).unwrap_or(serde_json::Value::Null)
    }
}

/// The two hardcoded per-provider default models this crate contributes
/// (upstream `openai/codex` `codex-rs/model-provider-info` ships the same
/// two for its `oss_provider` targets). Every other provider needs either
/// an explicit `model`/`-m`, a `[profiles.*]` entry, or a caller-supplied
/// `default_models` entry — this crate never invents a third one.
///
/// These two literals must agree with `aphrody-llama-server`'s
/// `ensure::DEFAULT_OLLAMA_MODEL` / `DEFAULT_LMSTUDIO_MODEL`. This crate is a
/// dependency-free leaf (no `aphrody-models`), so the two cannot share one
/// `const`; `gpt-oss:20b`/`openai/gpt-oss-20b` is published under those exact
/// tags by Ollama, LM Studio and vLLM, which is why it — not a
/// `aphrody_models::LocalRole` model family — is the value both crates agree
/// on.
fn hardcoded_default_model(provider_id: &str) -> Option<String> {
    match provider_id {
        "ollama" => Some("gpt-oss:20b".to_string()),
        "lmstudio" => Some("openai/gpt-oss-20b".to_string()),
        _ => None,
    }
}

/// Resolves a stack of [`ConfigLayer`]s plus CLI overrides into an effective
/// [`Config`].
///
/// `default_provider` is the provider id used when neither `-C`/
/// `--model-provider`, `--oss`, nor `config.toml`'s `model_provider` name
/// one (the caller resolves this once per process, typically `"antigravity"`
/// when its credential store is present, else `"llama"` — this crate does
/// not itself probe credential stores). `default_models` is a caller-owned
/// per-provider fallback model map; the only defaults this crate invents on
/// top of it are `ollama` and `lmstudio`'s upstream-documented OSS defaults.
///
/// Pipeline (matches `docs/plans/codex-oss.md`, P1):
/// 1. Fold `layers` in the order given (the caller supplies them in ascending
///    [`crate::layer::LayerSource`] precedence).
/// 2. Select `[profiles.<name>]` (`overrides.profile`, else the merged `profile` key) and merge it
///    back onto the root. An explicitly named, absent profile is a hard
///    [`ConfigError::UnknownProfile`].
/// 3. Apply `overrides.config_overrides` (`-c key=value`), in order given.
/// 4. Deserialize into [`ConfigToml`], collecting unknown-key [`ConfigWarning`]s.
/// 5. Resolve `approval_policy`/`sandbox_mode` (doctrine defaults, then explicit config/flags, then
///    `full_auto`/`dangerously_bypass` last).
/// 6. Resolve the provider id and look it up (absent = hard [`ConfigError::UnknownProvider`]).
/// 7. Resolve `model`.
///
/// # Errors
///
/// See [`ConfigError`].
// `layers` is taken by value rather than `&[ConfigLayer]` because the caller
// (a one-shot CLI invocation) has no further use for the stack once resolved
// and this keeps the signature matching the P1 spec exactly
// (`docs/plans/codex-oss.md`).
#[allow(clippy::needless_pass_by_value)]
pub fn resolve(
    layers: Vec<ConfigLayer>,
    overrides: &CliOverrides,
    default_provider: &str,
    default_models: &BTreeMap<String, String>,
) -> Result<(Config, Vec<ConfigWarning>), ConfigError> {
    let mut merged = merge_layers(&layers);

    let requested_profile = overrides.profile.clone().or_else(|| {
        merged
            .get("profile")
            .and_then(toml::Value::as_str)
            .map(str::to_string)
    });

    apply_selected_profile(&mut merged, requested_profile.as_deref())?;

    for raw in &overrides.config_overrides {
        let (path, value) = parse_override(raw)?;
        apply_override(&mut merged, &path, value);
    }

    let merged_toml_str = toml::to_string(&merged)?;
    let config_toml: ConfigToml = toml::from_str(&merged_toml_str)?;
    let mut warnings = config_toml.unknown_key_warnings();
    warnings.sort_by_key(ToString::to_string);

    let mut approval_policy = overrides
        .approval_policy
        .or(config_toml.approval_policy)
        .unwrap_or_default();
    let mut sandbox_mode = overrides
        .sandbox_mode
        .or(config_toml.sandbox_mode)
        .unwrap_or_default();

    if overrides.full_auto {
        sandbox_mode = SandboxMode::WorkspaceWrite;
        approval_policy = AskForApproval::Never;
    }
    if overrides.dangerously_bypass {
        sandbox_mode = SandboxMode::DangerFullAccess;
        approval_policy = AskForApproval::Never;
    }

    let provider_id = if overrides.oss {
        overrides
            .local_provider
            .clone()
            .or_else(|| config_toml.oss_provider.clone())
            .unwrap_or_else(|| "llama".to_string())
    } else {
        overrides
            .model_provider
            .clone()
            .or_else(|| config_toml.model_provider.clone())
            .unwrap_or_else(|| default_provider.to_string())
    };

    let Some(provider_info) = config_toml.model_providers.get(&provider_id).cloned() else {
        let mut available: Vec<String> = config_toml.model_providers.keys().cloned().collect();
        available.sort_unstable();
        return Err(ConfigError::UnknownProvider {
            id: provider_id,
            available,
        });
    };
    let provider = ResolvedProvider {
        id: provider_id.clone(),
        info: provider_info,
    };

    let model = overrides
        .model
        .clone()
        .or_else(|| config_toml.model.clone())
        .or_else(|| default_models.get(&provider_id).cloned())
        .or_else(|| hardcoded_default_model(&provider_id));

    let config = Config {
        model,
        review_model: config_toml.review_model,
        provider,
        approval_policy,
        sandbox_mode,
        sandbox_workspace_write: config_toml.sandbox_workspace_write,
        shell_environment_policy: config_toml.shell_environment_policy,
        model_context_window: config_toml.model_context_window,
        model_auto_compact_token_limit: config_toml.model_auto_compact_token_limit,
        model_reasoning_effort: config_toml.model_reasoning_effort,
        model_reasoning_summary: config_toml.model_reasoning_summary,
        model_verbosity: config_toml.model_verbosity,
        notify: config_toml.notify,
        instructions: config_toml.instructions,
        developer_instructions: config_toml.developer_instructions,
        project_doc_max_bytes: config_toml
            .project_doc_max_bytes
            .unwrap_or(DEFAULT_PROJECT_DOC_MAX_BYTES),
        project_doc_fallback_filenames: config_toml
            .project_doc_fallback_filenames
            .unwrap_or_default(),
        history: config_toml.history.unwrap_or_default(),
        rag: config_toml.rag.unwrap_or_default(),
        database: config_toml.database.unwrap_or_default(),
        plugins: config_toml.plugins.unwrap_or_default(),
        skills: config_toml.skills.unwrap_or_default(),
        a2a: config_toml.a2a.unwrap_or_default(),
        ocr: config_toml.ocr.unwrap_or_default(),
        redis: config_toml.redis.unwrap_or_default(),
        llama: config_toml.llama.unwrap_or_default(),
        train: config_toml.train.unwrap_or_default(),
        compat: config_toml.compat,
        computer_use: config_toml.computer_use.unwrap_or_default(),
        tools: config_toml.tools,
        model_profiles: config_toml.model_profiles,
        mcp_servers: config_toml.mcp_servers,
        model_providers: config_toml.model_providers,
        active_profile: requested_profile,
    };

    Ok((config, warnings))
}

fn apply_selected_profile(
    merged: &mut toml::Value,
    requested_profile: Option<&str>,
) -> Result<(), ConfigError> {
    if let Some(name) = requested_profile {
        let profile_value = merged
            .get("profiles")
            .and_then(|profiles| profiles.get(name))
            .cloned();
        if let Some(value) = profile_value {
            let profile: crate::profile::ConfigProfile = value.try_into()?;
            let encoded = toml::to_string(&profile)?;
            let typed_value: toml::Value = toml::from_str(&encoded)?;
            merge_profile(merged, &typed_value);
        } else {
            let mut available: Vec<String> = merged
                .get("profiles")
                .and_then(toml::Value::as_table)
                .map(|table| table.keys().cloned().collect())
                .unwrap_or_default();
            available.sort_unstable();
            return Err(ConfigError::UnknownProfile {
                name: name.to_owned(),
                available,
            });
        }
    }

    Ok(())
}

/// Merge a typed profile while replacing isolation-sensitive Home Agent
/// components as atomic values. A selected profile must not inherit another
/// component's nested paths, server ids, mailboxes, or Redis namespace.
fn merge_profile(base: &mut toml::Value, profile: &toml::Value) {
    const ISOLATED_COMPONENTS: &[&str] = &[
        "database",
        "rag",
        "plugins",
        "mcp_servers",
        "skills",
        "a2a",
        "ocr",
        "redis",
    ];

    let (Some(base_table), Some(profile_table)) = (base.as_table_mut(), profile.as_table()) else {
        merge_toml_values(base, profile);
        return;
    };

    for (key, value) in profile_table {
        if ISOLATED_COMPONENTS.contains(&key.as_str()) {
            base_table.insert(key.clone(), value.clone());
        } else if let Some(current) = base_table.get_mut(key) {
            merge_toml_values(current, value);
        } else {
            base_table.insert(key.clone(), value.clone());
        }
    }
}

#[cfg(test)]
#[path = "resolve_tests.rs"]
mod resolve_tests;
