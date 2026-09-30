// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 aphrody contributors

//! `aphrody-mcp-client` — Model Context Protocol (MCP) client and tool execution adapter.
//!
//! Provides:
//! - Full MCP JSON-RPC 2.0 client over stdio (child process) and streamable HTTP transports.
//! - [`McpToolExecutor`] bridging MCP tools into [`aphrody_toolcall::ToolExecutor`].
//! - Built-in agent tools: `update_plan`, `view_image`, and `tool_search`.
//! - Native web tools backed by the shared Rust client (`web_search`, `web_fetch`,
//!   supported `browser_*` actions).
//! - Automatic assembly from [`aphrody_config::mcp::McpServerConfig`].

pub mod builtins;
pub mod bxc;
pub mod client;
pub mod error;
pub mod executor;
pub mod protocol;
pub mod registry;
pub mod schema;
pub mod transport;
#[cfg(not(target_arch = "wasm32"))]
pub mod web;

pub use builtins::{
    PlanState, ToolCatalog, ToolSearchResult, ToolSearchTool, UpdatePlanTool, ViewImageTool,
    register_builtins,
};
pub use bxc::{
    BXC_STABLE_ALIASES, BxcAliasMapping, BxcExposureProfile, LazyBxcProvider, register_bxc_tools,
    resolve_bxc_binary,
};
pub use client::{DEFAULT_RPC_TIMEOUT, DEFAULT_STARTUP_TIMEOUT, McpClient, McpClientHandle};
pub use error::{McpClientError, Result};
pub use executor::McpToolExecutor;
pub use protocol::{
    CallToolResult, ClientCapabilities, ClientInfo, MCP_PROTOCOL_VERSION, McpContent, McpTool,
    ServerInfo,
};
pub use registry::{
    AssembledRegistry, RegistryOptions, assemble_tool_registry, register_configured_mcp_servers,
    register_selected_mcp_servers,
};
pub use schema::mcp_schema_to_toolcall_schema;
#[cfg(not(target_arch = "wasm32"))]
pub use transport::stdio::StdioTransport;
pub use transport::{Transport, http::HttpTransport};
#[cfg(not(target_arch = "wasm32"))]
pub use web::{WebExposureProfile, register_native_web_tools};
