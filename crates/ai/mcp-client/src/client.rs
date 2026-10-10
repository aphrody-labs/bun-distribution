// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 aphrody contributors

//! Core [`McpClient`] coordinating MCP session lifecycle, handshakes, and requests.

use std::{
    collections::{BTreeMap, BTreeSet},
    path::Path,
    sync::Arc,
    time::Duration,
};

use aphrody_config::mcp::{McpServerConfig, McpServerTransportConfig};
use serde_json::Value as JsonValue;
use tokio::sync::Mutex;
use tracing::info;

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
        let cfg = crate::headers::resolve_server_secrets(cfg)?;
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
                // Resolve again at the point of use to fail closed even if the environment
                // changes between validation and connection. Never log credential values.
                let bearer = match bearer_token_env_var {
                    Some(var_name) => match std::env::var(var_name) {
                        Ok(token) if !token.is_empty() => Some(token),
                        _ => {
                            return Err(McpClientError::MissingHeaderEnvironment {
                                name: "Authorization".to_owned(),
                                variable: var_name.clone(),
                            });
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

        let entries = self.list_all("tools/list", "tools").await?;
        parse_tools_list(&serde_json::json!({"tools": entries}))
    }

    /// Read every page of an MCP catalogue within one overall RPC budget.
    /// Cyclic cursors and oversized catalogues fail explicitly rather than hanging
    /// or returning a partial catalogue as though it were complete.
    async fn list_all(
        &mut self,
        method: &'static str,
        field: &'static str,
    ) -> Result<Vec<JsonValue>> {
        if !self.initialized {
            self.initialize().await?;
        }
        let budget = self.rpc_timeout;
        let operation = async {
            let mut entries = Vec::new();
            let mut cursor = None::<String>;
            let mut seen = BTreeSet::new();
            for _ in 0..1024 {
                let params = cursor
                    .as_ref()
                    .map_or_else(|| serde_json::json!({}), |c| serde_json::json!({"cursor": c}));
                let page = self.transport.call(method, params, budget).await?;
                let items = page.get(field).and_then(JsonValue::as_array).ok_or_else(|| {
                    McpClientError::Malformed(format!("{method}: missing {field} array"))
                })?;
                if entries.len().saturating_add(items.len()) > 100_000 {
                    return Err(McpClientError::Malformed(format!(
                        "{method}: catalogue exceeds 100000 entries"
                    )));
                }
                entries.extend(items.iter().cloned());
                match page.get("nextCursor") {
                    None | Some(JsonValue::Null) => return Ok(entries),
                    Some(JsonValue::String(next))
                        if !next.is_empty() && seen.insert(next.clone()) =>
                    {
                        cursor = Some(next.clone())
                    },
                    _ => {
                        return Err(McpClientError::Malformed(format!(
                            "{method}: invalid or repeated nextCursor"
                        )));
                    },
                }
            }
            Err(McpClientError::Malformed(format!("{method}: catalogue exceeds 1024 pages")))
        };
        #[cfg(not(target_arch = "wasm32"))]
        {
            tokio::time::timeout(budget, operation).await.map_err(|_| McpClientError::Timeout {
                method: method.to_owned(),
                seconds: budget.as_secs(),
            })?
        }
        // wasm32 has no tokio timer driver: every page request already carries the per-request
        // `fetch` timeout of the HTTP transport.
        #[cfg(target_arch = "wasm32")]
        {
            let _ = budget;
            operation.await
        }
    }

    /// All advertised resources, preserving extension fields.
    pub async fn list_resources(&mut self) -> Result<Vec<JsonValue>> {
        self.list_all("resources/list", "resources").await
    }

    /// All advertised resource templates, preserving extension fields.
    pub async fn list_resource_templates(&mut self) -> Result<Vec<JsonValue>> {
        self.list_all("resources/templates/list", "resourceTemplates").await
    }

    /// Read resource contents without flattening binary or metadata fields.
    pub async fn read_resource(&mut self, uri: &str) -> Result<JsonValue> {
        if !self.initialized {
            self.initialize().await?;
        }
        self.transport
            .call("resources/read", serde_json::json!({"uri": uri}), self.rpc_timeout)
            .await
    }

    /// All advertised prompts, preserving extension fields.
    pub async fn list_prompts(&mut self) -> Result<Vec<JsonValue>> {
        self.list_all("prompts/list", "prompts").await
    }

    /// Fetch a prompt, preserving its multimodal messages.
    pub async fn get_prompt(
        &mut self,
        name: &str,
        arguments: BTreeMap<String, String>,
    ) -> Result<JsonValue> {
        if !self.initialized {
            self.initialize().await?;
        }
        self.transport
            .call(
                "prompts/get",
                serde_json::json!({"name": name, "arguments": arguments}),
                self.rpc_timeout,
            )
            .await
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
        self.initialized = false;
        self.server_info = None;
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

    /// List resources through the same serialized session as tools.
    pub async fn list_resources(&self) -> Result<Vec<JsonValue>> {
        self.inner.lock().await.list_resources().await
    }

    /// List resource templates without creating a second connection.
    pub async fn list_resource_templates(&self) -> Result<Vec<JsonValue>> {
        self.inner.lock().await.list_resource_templates().await
    }

    /// Preserve binary resource contents and metadata in the raw result.
    pub async fn read_resource(&self, uri: &str) -> Result<JsonValue> {
        self.inner.lock().await.read_resource(uri).await
    }

    /// List prompts using the shared initialization and pagination budget.
    pub async fn list_prompts(&self) -> Result<Vec<JsonValue>> {
        self.inner.lock().await.list_prompts().await
    }

    /// Fetch a multimodal prompt without flattening its messages.
    pub async fn get_prompt(
        &self,
        name: &str,
        arguments: BTreeMap<String, String>,
    ) -> Result<JsonValue> {
        self.inner.lock().await.get_prompt(name, arguments).await
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

#[cfg(test)]
mod lifecycle_tests {
    use super::*;
    use async_trait::async_trait;
    use serde_json::json;
    use std::collections::VecDeque;

    struct ScriptedTransport {
        calls: VecDeque<(&'static str, JsonValue, JsonValue)>,
        notified: bool,
    }

    #[async_trait]
    impl Transport for ScriptedTransport {
        async fn call(
            &mut self,
            method: &str,
            params: JsonValue,
            _: Duration,
        ) -> Result<JsonValue> {
            let (expected, expected_params, result) =
                self.calls.pop_front().expect("unexpected RPC");
            assert_eq!(method, expected);
            assert_eq!(params, expected_params);
            if method != "initialize" {
                assert!(self.notified, "RPC before initialized notification");
            }
            Ok(result)
        }
        async fn notify(&mut self, method: &str, params: JsonValue) -> Result<()> {
            assert_eq!(method, "notifications/initialized");
            assert_eq!(params, json!({}));
            self.notified = true;
            Ok(())
        }
        async fn shutdown(&mut self) -> Result<()> {
            assert!(self.calls.is_empty(), "unconsumed RPC steps");
            Ok(())
        }
    }

    fn scripted(calls: Vec<(&'static str, JsonValue, JsonValue)>) -> McpClient {
        let initialize = (
            "initialize",
            serde_json::to_value(InitializeParams::default()).unwrap(),
            json!({
                "protocolVersion": crate::protocol::MCP_PROTOCOL_VERSION,
                "serverInfo": {"name": "test", "version": "1"}, "capabilities": {"tools": {}}
            }),
        );
        McpClient {
            transport: Box::new(ScriptedTransport {
                calls: std::iter::once(initialize).chain(calls).collect(),
                notified: false,
            }),
            server_info: None,
            initialized: false,
            rpc_timeout: DEFAULT_RPC_TIMEOUT,
            startup_timeout: DEFAULT_STARTUP_TIMEOUT,
        }
    }

    #[tokio::test]
    async fn catalogue_pages_are_followed_and_shutdown_clears_identity() {
        let mut client = scripted(vec![
            ("tools/list", json!({}), json!({"tools":[{"name":"first"}],"nextCursor":"opaque"})),
            ("tools/list", json!({"cursor":"opaque"}), json!({"tools":[{"name":"second"}]})),
            (
                "resources/list",
                json!({}),
                json!({"resources":[{"uri":"fixture://resource","_meta":{"kept":true}}]}),
            ),
            ("prompts/list", json!({}), json!({"prompts":[{"name":"explain"}]})),
            (
                "resources/templates/list",
                json!({}),
                json!({"resourceTemplates":[{"uriTemplate":"fixture://{id}"}]}),
            ),
            (
                "resources/read",
                json!({"uri":"fixture://resource"}),
                json!({"contents":[{"uri":"fixture://resource","blob":"AA=="}]}),
            ),
            ("prompts/get", json!({"name":"explain","arguments":{}}), json!({"messages":[]})),
        ]);
        let tools = client.list_tools().await.unwrap();
        assert_eq!(
            tools.iter().map(|tool| tool.name.as_str()).collect::<Vec<_>>(),
            ["first", "second"]
        );
        assert_eq!(client.list_resources().await.unwrap()[0]["_meta"]["kept"], true);
        assert_eq!(client.list_prompts().await.unwrap()[0]["name"], "explain");
        assert_eq!(client.list_resource_templates().await.unwrap().len(), 1);
        assert_eq!(
            client.read_resource("fixture://resource").await.unwrap()["contents"][0]["blob"],
            "AA=="
        );
        assert_eq!(
            client.get_prompt("explain", BTreeMap::new()).await.unwrap(),
            json!({"messages":[]})
        );
        client.shutdown().await.unwrap();
        assert!(client.server_info().is_none());
        assert!(!client.initialized);
    }

    #[tokio::test]
    async fn cyclic_cursor_fails_without_returning_partial_tools() {
        let mut client = scripted(vec![
            ("tools/list", json!({}), json!({"tools":[],"nextCursor":"same"})),
            ("tools/list", json!({"cursor":"same"}), json!({"tools":[],"nextCursor":"same"})),
        ]);
        assert!(matches!(client.list_tools().await, Err(McpClientError::Malformed(_))));
    }

    #[test]
    fn configured_missing_credentials_fail_before_transport_construction() {
        let cfg: McpServerConfig = serde_json::from_value(json!({"url":"https://example.invalid/mcp","bearer_token_env_var":"APHRODY_MCP_TEST_DEFINITELY_UNSET"})).unwrap();
        assert!(matches!(
            McpClient::from_config("private", &cfg),
            Err(McpClientError::MissingHeaderEnvironment { .. })
        ));
    }
}
