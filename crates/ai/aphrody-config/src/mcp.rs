// SPDX-License-Identifier: Apache-2.0
use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

/// Transport-specific fields of an MCP server entry.
///
/// Mirrors `openai/codex` `codex-rs/config/src/mcp_types.rs`
/// `McpServerTransportConfig`: an untagged enum discriminated by field
/// presence (`command` => stdio, `url` => streamable HTTP), matching the
/// upstream `config.toml` shape byte-for-byte for these fields. Upstream also
/// carries `env_vars` (structured secret-source descriptors) and an
/// `http_headers_helper` command; aphrody does not mirror either yet (no
/// consumer) and documents the gap here rather than inventing a shape.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(untagged)]
pub enum McpServerTransportConfig {
    /// <https://modelcontextprotocol.io/specification/2025-06-18/basic/transports#stdio>
    Stdio {
        /// Executable to spawn.
        command: String,
        /// Arguments passed to `command`.
        #[serde(default)]
        args: Vec<String>,
        /// Extra environment variables for the child process.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        env: Option<BTreeMap<String, String>>,
        /// Working directory for the child process.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        cwd: Option<String>,
    },
    /// <https://modelcontextprotocol.io/specification/2025-06-18/basic/transports#streamable-http>
    StreamableHttp {
        /// Server endpoint.
        url: String,
        /// Environment variable holding an `Authorization: Bearer <token>`
        /// value. The secret itself never lives in `config.toml`.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        bearer_token_env_var: Option<String>,
        /// Extra static HTTP headers.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        http_headers: Option<BTreeMap<String, String>>,
    },
}

/// A single `[mcp_servers.<name>]` entry.
///
/// Mirrors `openai/codex` `codex-rs/config/src/mcp_types.rs`
/// `McpServerConfig`'s shared (non-transport, non-auth) fields:
/// `enabled`, `startup_timeout_sec`, `tool_timeout_sec`, `enabled_tools`,
/// `disabled_tools`. Upstream's OAuth/EMA/environment-routing/per-tool-config
/// fields are not mirrored: aphrody has neither an enterprise `IdP` nor a
/// multi-environment executor to route through (documented gap, not a stub —
/// the fields that exist are fully functional).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct McpServerConfig {
    /// Stdio or streamable-HTTP transport fields.
    #[serde(flatten)]
    pub transport: McpServerTransportConfig,
    /// When `false`, aphrody skips initializing this server. Defaults to
    /// `true`.
    #[serde(default = "default_enabled")]
    pub enabled: bool,
    /// Seconds to wait for the server to initialize and list tools.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub startup_timeout_sec: Option<u64>,
    /// Default timeout, in seconds, for tool calls through this server.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tool_timeout_sec: Option<u64>,
    /// Explicit allow-list: when set, only these tools are registered.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub enabled_tools: Option<Vec<String>>,
    /// Explicit deny-list, applied after `enabled_tools`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub disabled_tools: Option<Vec<String>>,
}

const fn default_enabled() -> bool {
    true
}

#[cfg(test)]
#[path = "mcp_tests.rs"]
mod mcp_tests;
