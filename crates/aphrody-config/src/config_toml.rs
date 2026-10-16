// SPDX-License-Identifier: Apache-2.0
use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use crate::{
    home_agent::{
        A2aConfig, AgentHomeConfig, DatabaseConfig, OcrConfig, PluginConfig, RedisConfig,
        SkillsConfig,
    },
    mcp::McpServerConfig,
    policy::{AskForApproval, SandboxMode},
    profile::ConfigProfile,
    provider::ModelProviderInfo,
    rag::{CompatConfig, ComputerUseConfig, LlamaConfig, RagConfig, TrainConfig},
};

/// Default cap on total `AGENTS.md` content bytes injected into a turn.
///
/// Mirrors `openai/codex` `codex-rs/config/src/config_toml.rs`
/// `DEFAULT_PROJECT_DOC_MAX_BYTES` (32 KiB).
pub const DEFAULT_PROJECT_DOC_MAX_BYTES: usize = 32 * 1024;

/// Persisted history settings (`~/.aphrody/history.jsonl`).
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct HistoryConfig {
    /// `"save-all"` (default behaviour) or `"none"` to disable persistence.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub persistence: Option<String>,
}

/// A configuration warning: something that did not stop parsing but the
/// caller should surface (`aphrody config show --json` includes them; a TUI
/// status line can badge them). Never an error — unknown keys must never
/// fail a load.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum ConfigWarning {
    /// A top-level `config.toml` key was not recognized by any field of
    /// [`ConfigToml`]. The raw value is preserved (see
    /// [`ConfigToml::unknown`]) so nothing is silently dropped; it is just
    /// not interpreted.
    #[error("unknown config.toml key: `{0}`")]
    UnknownKey(String),
}

/// The Codex-compatible `config.toml` schema aphrody deserializes.
///
/// Mirrors `openai/codex` `codex-rs/config/src/config_toml.rs` `ConfigToml`
/// at the subset of fields aphrody's agent loop actually consumes (P1,
/// `docs/plans/codex-oss.md`), plus aphrody's own extension tables (`[rag]`,
/// `[llama]`, `[train]`, `[compat]`, `[computer_use]`,
/// `[model_profiles.<id>]`). Every field is `Option`/collection-defaulted so
/// that any subset of keys — including none at all — parses. Unrecognized
/// top-level keys are collected into [`ConfigToml::unknown`] rather than
/// rejected; call [`ConfigToml::unknown_key_warnings`] to turn them into
/// [`ConfigWarning`]s.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct ConfigToml {
    /// Model selection override.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    /// Model used for the `/review` workflow, if different from `model`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub review_model: Option<String>,
    /// Provider id to select from `model_providers` (built-in or
    /// user-defined).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model_provider: Option<String>,
    /// User-defined providers, merged onto the built-in catalog at the TOML
    /// layer (see [`crate::layer`]) before this struct is even deserialized.
    #[serde(default)]
    pub model_providers: BTreeMap<String, ModelProviderInfo>,
    /// Context window size, in tokens, for `model`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model_context_window: Option<i64>,
    /// Token-usage threshold that triggers auto-compaction.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model_auto_compact_token_limit: Option<i64>,
    /// Reasoning effort hint (`"low"` | `"medium"` | `"high"`, provider
    /// dependent). Kept as a string: the valid set is provider-specific and
    /// this crate does not gate on provider capability.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model_reasoning_effort: Option<String>,
    /// Reasoning summary verbosity hint.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model_reasoning_summary: Option<String>,
    /// Response verbosity hint (Responses API `text.verbosity`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model_verbosity: Option<String>,
    /// Default approval policy. Resolved default:
    /// [`AskForApproval::Never`] (see [`crate::resolve`]).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub approval_policy: Option<AskForApproval>,
    /// Default sandbox mode. Resolved default:
    /// [`SandboxMode::WorkspaceWrite`].
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sandbox_mode: Option<SandboxMode>,
    /// `[sandbox_workspace_write]` — extra settings when `sandbox_mode` is
    /// `workspace-write`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sandbox_workspace_write: Option<SandboxWorkspaceWrite>,
    /// `[shell_environment_policy]` — which environment variables reach
    /// spawned shells.
    #[serde(default)]
    pub shell_environment_policy: ShellEnvironmentPolicy,
    /// Active profile name (selects `[profiles.<name>]`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub profile: Option<String>,
    /// Named, overridable configuration bundles.
    #[serde(default)]
    pub profiles: BTreeMap<String, ConfigProfile>,
    /// `[mcp_servers.<name>]` entries.
    #[serde(default)]
    pub mcp_servers: BTreeMap<String, McpServerConfig>,
    /// External commands to invoke for end-user notifications.
    #[serde(default)]
    pub notify: Vec<String>,
    /// System instructions preamble prepended ahead of the harness prompt.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub instructions: Option<String>,
    /// Developer-role instructions block.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub developer_instructions: Option<String>,
    /// Maximum total bytes of injected `AGENTS.md` content.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub project_doc_max_bytes: Option<usize>,
    /// Fallback filenames tried when `AGENTS.md` is absent in a directory.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub project_doc_fallback_filenames: Option<Vec<String>>,
    /// Preferred provider id for `--oss` when neither `--local-provider` nor
    /// an explicit provider flag is given.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub oss_provider: Option<String>,
    /// History persistence settings.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub history: Option<HistoryConfig>,
    /// `[rag]` — retrieval-augmented-generation layer.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rag: Option<RagConfig>,
    /// `[database]` — database authority and optional profile-local cache.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub database: Option<DatabaseConfig>,
    /// `plugins = [...]` — plugin roots visible to the active Home Agent.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub plugins: Option<PluginConfig>,
    /// `[skills]` — exact Home Agent skill whitelist.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub skills: Option<SkillsConfig>,
    /// `[a2a]` — Home Agent identity and mailbox paths.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub a2a: Option<A2aConfig>,
    /// `[ocr]` — OCR engine policy and profile-local state path.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ocr: Option<OcrConfig>,
    /// `[agent_home]` — homes root override.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub agent_home: Option<AgentHomeConfig>,
    /// `[redis]` — Redis database and key namespace.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub redis: Option<RedisConfig>,
    /// `[llama]` — local managed `llama-server` supervisor.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub llama: Option<LlamaConfig>,
    /// `[train]` — training surface.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub train: Option<TrainConfig>,
    /// `[compat]` — opt-in `~/.codex` interoperability.
    #[serde(default)]
    pub compat: CompatConfig,
    /// `[computer_use]` — computer-use tool configuration.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub computer_use: Option<ComputerUseConfig>,
    /// `[tools.<family>]` — opaque per-tool-family policy tables (e.g.
    /// `[tools.bxc]`). Each tool family owns and validates its own shape;
    /// this crate only carries the raw TOML through.
    #[serde(default)]
    pub tools: BTreeMap<String, toml::Value>,
    /// `[model_profiles.<id>]` — per-model dialect/prompt-profile overrides.
    /// Opaque here; owned and validated by `aphrody-toolcall-repair`
    /// (`PromptProfile`).
    #[serde(default)]
    pub model_profiles: BTreeMap<String, toml::Value>,
    /// Every top-level key this struct did not recognize, preserved
    /// verbatim. See [`ConfigToml::unknown_key_warnings`].
    #[serde(flatten)]
    pub unknown: BTreeMap<String, toml::Value>,
}

/// `[sandbox_workspace_write]`.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct SandboxWorkspaceWrite {
    /// Extra directories, beyond the resolved workspace root, that are
    /// writable.
    #[serde(default)]
    pub writable_roots: Vec<String>,
    /// Whether network access is permitted from inside the sandbox.
    #[serde(default)]
    pub network_access: bool,
    /// Whether `$TMPDIR` (or platform equivalent) is excluded from the
    /// writable set even though it usually lives outside the workspace.
    #[serde(default)]
    pub exclude_tmpdir_env_var: bool,
    /// Whether `/tmp` is excluded from the writable set on Unix.
    #[serde(default)]
    pub exclude_slash_tmp: bool,
}

/// `[shell_environment_policy]`.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct ShellEnvironmentPolicy {
    /// Whether the parent process environment is inherited at all.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub inherit: Option<bool>,
    /// Skip aphrody's built-in exclusion list (credentials-shaped variable
    /// names) rather than applying it on top of `exclude`.
    #[serde(default)]
    pub ignore_default_excludes: bool,
    /// Glob patterns of variable names to drop.
    #[serde(default)]
    pub exclude: Vec<String>,
    /// Extra variables to set (or overwrite) in the spawned shell.
    #[serde(default)]
    pub set: BTreeMap<String, String>,
    /// When non-empty, only these variable names (after `set`) reach the
    /// shell; `exclude` is ignored.
    #[serde(default)]
    pub include_only: Vec<String>,
}

impl ConfigToml {
    /// Turns every unrecognized top-level key into a
    /// [`ConfigWarning::UnknownKey`], sorted for stable output.
    #[must_use]
    pub fn unknown_key_warnings(&self) -> Vec<ConfigWarning> {
        let mut keys: Vec<&String> = self.unknown.keys().collect();
        keys.sort_unstable();
        keys.into_iter()
            .map(|key| ConfigWarning::UnknownKey(key.clone()))
            .collect()
    }
}

#[cfg(test)]
#[path = "config_toml_tests.rs"]
mod config_toml_tests;
