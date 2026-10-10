// SPDX-License-Identifier: Apache-2.0
use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use crate::{
    home_agent::{A2aConfig, DatabaseConfig, OcrConfig, PluginConfig, RedisConfig, SkillsConfig},
    mcp::McpServerConfig,
    policy::{AskForApproval, SandboxMode},
    rag::RagConfig,
    wire_api::WireApi,
};

/// Environment variable selecting a named Home Agent profile.
pub const ENV_APHRODY_PROFILE: &str = "APHRODY_PROFILE";

/// Select the active profile using the CLI-over-environment precedence used
/// by every agent entry point.
///
/// Empty or whitespace-only values are treated as absent. The `profile` key
/// in `config.toml` remains the resolver's fallback when this returns `None`.
#[must_use]
pub fn select_profile(explicit: Option<&str>, environment: Option<&str>) -> Option<String> {
    explicit
        .and_then(non_empty_profile)
        .or_else(|| environment.and_then(non_empty_profile))
        .map(str::to_owned)
}

fn non_empty_profile(value: &str) -> Option<&str> {
    let value = value.trim();
    (!value.is_empty()).then_some(value)
}

/// One named entry of the `[profiles.<name>]` table.
///
/// Mirrors `openai/codex` `codex-rs/config/src/profile_toml.rs`
/// `ConfigProfile`: an overridable subset of top-level `ConfigToml` fields.
/// A selected profile is merged onto the already-merged
/// built-ins/Codex-compat/user/project layer (see [`crate::resolve::resolve`])
/// — later, not earlier, so a profile can win over a plain user-level
/// setting but never over an explicit `-c` override or CLI flag.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct ConfigProfile {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model_provider: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub approval_policy: Option<AskForApproval>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sandbox_mode: Option<SandboxMode>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model_reasoning_effort: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model_reasoning_summary: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model_verbosity: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model_context_window: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub oss_provider: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub instructions: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rag: Option<RagConfig>,
    /// Profile-isolated database authority and local cache.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub database: Option<DatabaseConfig>,
    /// Plugin roots visible to this profile.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub plugins: Option<PluginConfig>,
    /// Exact skill whitelist visible to this profile.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub skills: Option<SkillsConfig>,
    /// Profile-specific MCP servers. Replaces the root map when present.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mcp_servers: Option<BTreeMap<String, McpServerConfig>>,
    /// A2A identity and mailbox paths.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub a2a: Option<A2aConfig>,
    /// OCR engines and state path.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ocr: Option<OcrConfig>,
    /// Redis endpoint and key prefix.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub redis: Option<RedisConfig>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub wire_api: Option<WireApi>,
}

#[cfg(test)]
#[path = "profile_tests.rs"]
mod profile_tests;
