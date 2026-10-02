// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 aphrody contributors

//! Core [`McpClient`] coordinating MCP session lifecycle, handshakes, and requests.

use std::{collections::BTreeMap, path::Path, sync::Arc, time::Duration};

use aphrody_config::mcp::{McpServerConfig, McpServerTransportConfig};
use serde_json::Value as JsonValue;
use tokio::sync::Mutex;
use tracing::{info, warn};

#[cfg(not(target_arch = "wasm32"))]
use crate::transport::stdio::StdioTransport;
use crate::{
    error::{McpClientError, Result},
    protocol::{
        CallToolResult, InitializeParams, McpTool, ServerInfo, parse_call_tool_result,
        parse_server_info, parse_tools_list,
    },
    transport::{Transport, http::HttpTransport},
};

/// Default timeout for individual tool calls.
pub const DEFAULT_RPC_TIMEOUT: Duration = Duration::from_secs(30);

/// Default timeout for the initialize handshake.
pub const DEFAULT_STARTUP_TIMEOUT: Duration = Duration::from_secs(15);

/// An active connection to an MCP server speaking JSON-RPC 2.0.
pub struct McpClient {
    transport: Box<dyn Transport>,
    server_info: Option<ServerInfo>,
    initialized: bool,
    /// Timeout for standard RPC requests (`tools/call`, `tools/list`).
    pub rpc_timeout: Duration,
    /// Timeout for initialization.
    pub startup_timeout: Duration,
}

impl McpClient {
    /// Create a client connected over a child-process stdio pipe.
    #[cfg(not(target_arch = "wasm32"))]
    pub fn from_stdio(
        command: &str,
        args: &[String],
        env: Option<&BTreeMap<String, String>>,
        cwd: Option<&Path>,
    ) -> Result<Self> {
        let transport = StdioTransport::spawn(command, args, env, cwd)?;
        Ok(Self {
            transport: Box::new(transport),
            server_info: None,
            initialized: false,
            rpc_timeout: DEFAULT_RPC_TIMEOUT,
            startup_timeout: DEFAULT_STARTUP_TIMEOUT,
        })
    }

    /// Stdio fallback for wasm32.
    #[cfg(target_arch = "wasm32")]
    pub fn from_stdio(
        _command: &str,
        _args: &[String],
        _env: Option<&BTreeMap<String, String>>,
        _cwd: Option<&Path>,
    ) -> Result<Self> {
        Err(McpClientError::UnsupportedTransport)
    }

    /// Create a client connected over streamable HTTP.
    pub fn from_http(
        url: impl Into<String>,
        bearer: Option<String>,
        headers: Option<&BTreeMap<String, String>>,
    ) -> Result<Self> {
        let transport = HttpTransport::new(url, bearer, headers)?;
        Ok(Self {
            transport: Box::new(transport),
            server_info: None,
            initialized: false,
            rpc_timeout: DEFAULT_RPC_TIMEOUT,
            startup_timeout: DEFAULT_STARTUP_TIMEOUT,
        })
    }

    /// Create a client configured from an [`McpServerConfig`].
    pub fn from_config(server_name: &str, cfg: &McpServerConfig) -> Result<Self> {
        let mut client = match &cfg.transport {
            McpServerTransportConfig::Stdio { command, args, env, cwd, .. } => {
                let cwd_path = cwd.as_ref().map(Path::new);
                #[cfg(not(target_arch = "wasm32"))]
                {
                    Self::from_stdio(command, args, env.as_ref(), cwd_path)?
                }
                #[cfg(target_arch = "wasm32")]
                {
                    let _ = (command, args, env, cwd_path);
                    return Err(McpClientError::UnsupportedTransport);
                }
            },
            McpServerTransportConfig::StreamableHttp {
                url,
                bearer_token_env_var,
                http_headers,
                ..
            } => {
                // Only the variable name lives in the configuration; the token is read at connect
                // time. An unset or empty variable is reported instead of silently producing an
                // unauthenticated client; callers that must refuse to connect without the
                // credential use `crate::headers::resolve_server_secrets` first.
                let bearer = match bearer_token_env_var {
                    Some(var_name) => match std::env::var(var_name) {
                        Ok(token) if !token.is_empty() => Some(token),
                        _ => {
                            warn!(
                                server = server_name,
                                variable = %var_name,
                                "MCP bearer token environment variable is unset or empty; \
                                 connecting without an Authorization header"
                            );
                            None
                        },
                    },
                    None => None,
                };
                Self::from_http(url, bearer, http_headers.as_ref())?
            },
        };

        if let Some(to) = cfg.tool_timeout_sec {
            client.rpc_timeout = Duration::from_secs(to);
        }
        if let Some(to) = cfg.startup_timeout_sec {
            client.startup_timeout = Duration::from_secs(to);
        }

        info!(server = server_name, "Configured MCP client");
        Ok(client)
    }

    /// Perform the `initialize` handshake followed by `notifications/initialized`.
    pub async fn initialize(&mut self) -> Result<&ServerInfo> {
        if self.initialized {
            return self.server_info.as_ref().ok_or_else(|| {
                McpClientError::Malformed(
                    "client initialized but server_info is missing".to_owned(),
                )
            });
        }

        let params = serde_json::to_value(InitializeParams::default())
            .map_err(|e| McpClientError::Malformed(e.to_string()))?;

        let res = self.transport.call("initialize", params, self.startup_timeout).await?;
        let info = parse_server_info(&res)?;

        // Send notifications/initialized per spec:
        self.transport.notify("notifications/initialized", serde_json::json!({})).await?;

        self.server_info = Some(info);
        self.initialized = true;

        Ok(self.server_info.as_ref().unwrap())
    }

    /// List all tools exposed by the server.
    pub async fn list_tools(&mut self) -> Result<Vec<McpTool>> {
        if !self.initialized {
            self.initialize().await?;
        }

        let res =
            self.transport.call("tools/list", serde_json::json!({}), self.rpc_timeout).await?;
        parse_tools_list(&res)
    }

    /// Call a named tool on the server with arbitrary JSON arguments.
    pub async fn call_tool(&mut self, name: &str, arguments: JsonValue) -> Result<CallToolResult> {
        let res = self.call_tool_raw(name, arguments).await?;
        parse_call_tool_result(&res)
    }

    /// Call a named tool and return the JSON-RPC `result` payload exactly as the server sent it.
    ///
    /// [`Self::call_tool`] parses the payload into the typed [`CallToolResult`], which keeps only
    /// the text, image and resource parts. Callers that forward the server's answer verbatim (the
    /// `aphrody mcp call` command, the `aphrody_mcp_call` proxy tool) use this variant so fields
    /// such as `structuredContent` or `_meta` survive.
    pub async fn call_tool_raw(&mut self, name: &str, arguments: JsonValue) -> Result<JsonValue> {
        if !self.initialized {
            self.initialize().await?;
        }

        let params = serde_json::json!({
            "name": name,
            "arguments": arguments,
        });

        self.transport.call("tools/call", params, self.rpc_timeout).await
    }

    /// Ping the server to check connection liveness.
    pub async fn ping(&mut self) -> Result<()> {
        let _ = self.transport.call("ping", serde_json::json!({}), Duration::from_secs(5)).await?;
        Ok(())
    }

    /// Access the server info if already initialized.
    #[must_use]
    pub fn server_info(&self) -> Option<&ServerInfo> {
        self.server_info.as_ref()
    }

    /// Shut down the connection.
    pub async fn shutdown(&mut self) -> Result<()> {
        self.transport.shutdown().await
    }
}

/// A shared, cloneable handle wrapping [`McpClient`] under an asynchronous [`Mutex`].
#[derive(Clone)]
pub struct McpClientHandle {
    inner: Arc<Mutex<McpClient>>,
    server_name: String,
}

impl McpClientHandle {
    /// Wrap an existing client in a thread-safe handle.
    #[must_use]
    pub fn new(server_name: impl Into<String>, client: McpClient) -> Self {
        Self { inner: Arc::new(Mutex::new(client)), server_name: server_name.into() }
    }

    /// Server name associated with this client.
    #[must_use]
    pub fn server_name(&self) -> &str {
        &self.server_name
    }

    /// Initialize the client if not already initialized.
    pub async fn initialize(&self) -> Result<ServerInfo> {
        let mut guard = self.inner.lock().await;
        guard.initialize().await.cloned()
    }

    /// List all tools exposed by the server.
    pub async fn list_tools(&self) -> Result<Vec<McpTool>> {
        let mut guard = self.inner.lock().await;
        guard.list_tools().await
    }

    /// Call a named tool on the server.
    pub async fn call_tool(&self, name: &str, arguments: JsonValue) -> Result<CallToolResult> {
        let mut guard = self.inner.lock().await;
        guard.call_tool(name, arguments).await
    }

    /// Call a named tool and return the raw JSON-RPC `result` payload.
    pub async fn call_tool_raw(&self, name: &str, arguments: JsonValue) -> Result<JsonValue> {
        let mut guard = self.inner.lock().await;
        guard.call_tool_raw(name, arguments).await
    }

    /// Shut down the client.
    pub async fn shutdown(&self) -> Result<()> {
        let mut guard = self.inner.lock().await;
        guard.shutdown().await
    }
}
