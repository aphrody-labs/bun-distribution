// SPDX-License-Identifier: Apache-2.0
//! MCP server status inspection types.

use serde::{Deserialize, Serialize};

/// Parameters for `mcpServerStatus/list`.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListMcpServerStatusParams {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cursor: Option<String>,
}

/// Status of an individual MCP server connection.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpServerStatus {
    /// Configured server name (e.g. "aphrody-web", "winclean").
    pub name: String,
    /// Connection status ("connected", "connecting", "failed", "disabled").
    pub status: String,
    /// Number of tools discovered on this server.
    pub tool_count: usize,
    /// Optional error message if the server failed to start.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

/// Response returned by `mcpServerStatus/list`.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListMcpServerStatusResponse {
    pub servers: Vec<McpServerStatus>,
}
