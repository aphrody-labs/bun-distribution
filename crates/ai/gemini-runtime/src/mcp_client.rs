// SPDX-License-Identifier: Apache-2.0
//! MCP client facade for the Gemini runtime.
//!
//! The one MCP client of the workspace is [`aphrody_mcp_client`]. It owns the JSON-RPC framing,
//! the stdio and streamable HTTP transports, header validation and the timeouts; this module no
//! longer carries a second implementation of any of it. What remains is the public surface that
//! `aphrody mcp` (`apps/cli`), [`crate::tools::McpProxyTool`] and the existing tests were written
//! against: an `async` [`McpClient::from_stdio`] taking `HashMap` environments,
//! [`McpClient::from_http_headers`], an owned [`ServerInfo`], tools whose description is a plain
//! `String`, and a `call_tool` that returns the raw JSON-RPC result. Everything below is
//! delegation plus value conversion.
//!
//! New code should use [`aphrody_mcp_client::McpClient`] together with
//! [`aphrody_config::mcp::McpServerConfig`]; this facade goes away once `aphrody mcp` migrates.

use std::{
    collections::{BTreeMap, HashMap},
    time::Duration,
};

// The error type is the canonical one: a single definition for every MCP caller.
pub use aphrody_mcp_client::McpClientError as McpError;
// Shared with the canonical client; the values are unchanged (`2024-11-05`, 30 s).
pub use aphrody_mcp_client::{DEFAULT_RPC_TIMEOUT, MCP_PROTOCOL_VERSION};
use serde::{Deserialize, Serialize};

/// Default timeout for connecting to / spawning an MCP server.
pub const DEFAULT_CONNECT_TIMEOUT: Duration = Duration::from_secs(10);

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/// Information about the connected MCP server, returned by `initialize`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ServerInfo {
    /// Server display name.
    pub name: String,
    /// Server version string.
    pub version: String,
    /// Server-advertised capabilities (free-form JSON object).
    #[serde(default)]
    pub capabilities: serde_json::Value,
    /// MCP protocol version negotiated by the server.
    #[serde(default)]
    pub protocol_version: String,
}

/// A tool advertised by an MCP server.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct McpTool {
    /// Tool identifier (used in `tools/call`).
    pub name: String,
    /// Human-readable description.
    #[serde(default)]
    pub description: String,
    /// JSON-Schema describing the expected `arguments` object.
    #[serde(rename = "inputSchema", default)]
    pub input_schema: serde_json::Value,
}

// ---------------------------------------------------------------------------
// Conversions from the canonical client's value types
// ---------------------------------------------------------------------------

impl From<aphrody_mcp_client::ServerInfo> for ServerInfo {
    fn from(info: aphrody_mcp_client::ServerInfo) -> Self {
        Self {
            name: info.name,
            version: info.version,
            capabilities: info.capabilities,
            protocol_version: info.protocol_version,
        }
    }
}

impl From<aphrody_mcp_client::McpTool> for McpTool {
    fn from(tool: aphrody_mcp_client::McpTool) -> Self {
        Self {
            name: tool.name,
            // The canonical descriptor keeps an absent description as `None`; this surface has
            // always rendered it as the empty string.
            description: tool.description.unwrap_or_default(),
            input_schema: tool.input_schema,
        }
    }
}

/// Copy a `HashMap` environment or header set into the canonical client's ordered map.
fn ordered(map: &HashMap<String, String>) -> BTreeMap<String, String> {
    map.iter().map(|(key, value)| (key.clone(), value.clone())).collect()
}

// ---------------------------------------------------------------------------
// McpClient
// ---------------------------------------------------------------------------

/// A live MCP client connection. A thin wrapper over [`aphrody_mcp_client::McpClient`].
///
/// Created via [`McpClient::from_stdio`], [`McpClient::from_http`] or
/// [`McpClient::from_http_headers`]. Dropping the client closes the transport: the stdio child
/// process is killed, an HTTP client simply goes away.
pub struct McpClient {
    inner: aphrody_mcp_client::McpClient,
    /// Configurable RPC timeout (default: [`DEFAULT_RPC_TIMEOUT`]). It also bounds the
    /// `initialize` handshake, as it always has on this surface.
    pub rpc_timeout: Duration,
}

impl McpClient {
    fn wrap(inner: aphrody_mcp_client::McpClient) -> Self {
        Self { inner, rpc_timeout: DEFAULT_RPC_TIMEOUT }
    }

    /// Apply this client's timeout to every phase of the canonical client.
    fn apply_timeouts(&mut self) {
        self.inner.rpc_timeout = self.rpc_timeout;
        self.inner.startup_timeout = self.rpc_timeout;
    }

    /// Connect to an MCP server over stdio by spawning `command` with `args`
    /// and a custom environment (`env`).
    ///
    /// The child is killed when the [`McpClient`] is dropped. On wasm32 this returns
    /// [`McpError::UnsupportedTransport`].
    ///
    /// # Errors
    ///
    /// - [`McpError::Spawn`] — the child process could not be started.
    /// - [`McpError::MissingHandle`] — the child exposed no stdin or stdout.
    /// - [`McpError::UnsupportedTransport`] — on wasm32.
    pub async fn from_stdio(
        command: &str,
        args: &[&str],
        env: &HashMap<String, String>,
    ) -> Result<Self, McpError> {
        let args: Vec<String> = args.iter().map(|arg| (*arg).to_owned()).collect();
        let env = ordered(env);
        aphrody_mcp_client::McpClient::from_stdio(command, &args, Some(&env), None).map(Self::wrap)
    }

    /// Connect to a streamable-HTTP MCP endpoint.
    ///
    /// The optional `bearer` token is sent as `Authorization: Bearer <token>`
    /// on every request — required by most production MCP HTTP servers.
    ///
    /// # Errors
    ///
    /// - [`McpError::InvalidHeader`] — the token cannot be sent as a header value.
    /// - [`McpError::Http`] — building the inner HTTP client failed.
    pub fn from_http(url: impl Into<String>, bearer: Option<String>) -> Result<Self, McpError> {
        aphrody_mcp_client::McpClient::from_http(url, bearer, None).map(Self::wrap)
    }

    /// Connect to a streamable-HTTP endpoint with the configured request
    /// headers. Header values are validated without including them in errors.
    /// The same headers are sent for initialization, notifications and calls.
    ///
    /// # Errors
    ///
    /// - [`McpError::InvalidHeader`] — a header name or value cannot be sent.
    /// - [`McpError::Http`] — building the inner HTTP client failed.
    pub fn from_http_headers(
        url: impl Into<String>,
        headers: &HashMap<String, String>,
    ) -> Result<Self, McpError> {
        let headers = ordered(headers);
        aphrody_mcp_client::McpClient::from_http(url, None, Some(&headers)).map(Self::wrap)
    }

    /// Send a JSON-RPC request and wait for the matching response.
    async fn call(
        &mut self,
        method: &str,
        params: serde_json::Value,
    ) -> Result<serde_json::Value, McpError> {
        let id = self.next_id();
        let frame = jsonrpc_request(id, method, params);
        let timeout_duration = self.rpc_timeout;
        let secs = timeout_duration.as_secs();
        let method_owned = method.to_owned();

        let fut = async {
            match &mut self.transport {
                #[cfg(not(target_arch = "wasm32"))]
                Transport::Stdio { stdin, lines, .. } => {
                    stdin.write_all(frame.as_bytes()).await?;
                    stdin.write_all(b"\n").await?;
                    stdin.flush().await?;

                    // Read lines until we find a matching id.
                    loop {
                        let line = match lines.next_line().await {
                            Ok(Some(l)) => l,
                            Ok(None) => {
                                return Err(McpError::Malformed(
                                    "MCP server closed stdout before responding".to_owned(),
                                ));
                            },
                            Err(e) => return Err(McpError::Io(e)),
                        };
                        if line.trim().is_empty() {
                            continue;
                        }
                        // Skip JSON-RPC notifications (no id) and responses with
                        // unrelated ids; the latter happens when notifications
                        // are emitted by the server.
                        let v: serde_json::Value = match serde_json::from_str(&line) {
                            Ok(v) => v,
                            Err(_) => continue,
                        };
                        let resp_id = v.get("id").and_then(serde_json::Value::as_u64);
                        if resp_id != Some(id) {
                            continue;
                        }
                        return parse_response(&line);
                    }
                },
                Transport::Http { client, url } => {
                    let req = client
                        .post(url.as_str())
                        .header("Content-Type", "application/json")
                        .header("Accept", "application/json, text/event-stream");
                    let resp = req.body(frame).send().await.map_err(McpError::Http)?;
                    let status = resp.status();
                    let text = resp.text().await.map_err(McpError::Http)?;
                    if !status.is_success() {
                        let trimmed: String = text.chars().take(1024).collect();
                        return Err(McpError::HttpStatus {
                            status: status.as_u16(),
                            body: trimmed,
                        });
                    }
                    parse_response(&text)
                },
            }
        };

        #[cfg(not(target_arch = "wasm32"))]
        {
            match timeout(timeout_duration, fut).await {
                Ok(r) => r,
                Err(_) => Err(McpError::Timeout { method: method_owned, seconds: secs }),
            }
        }
        #[cfg(target_arch = "wasm32")]
        {
            // No tokio::time::timeout on wasm; trust the reqwest client timeout.
            let _ = (timeout_duration, secs, method_owned);
            fut.await
        }
    }

    /// Send a JSON-RPC notification (no response expected).
    ///
    /// Only meaningful for stdio transport; HTTP MCP requires a response per
    /// frame, so we POST without waiting for an interesting body.
    async fn notify(&mut self, method: &str, params: serde_json::Value) -> Result<(), McpError> {
        let frame = jsonrpc_notification(method, params);
        match &mut self.transport {
            #[cfg(not(target_arch = "wasm32"))]
            Transport::Stdio { stdin, .. } => {
                stdin.write_all(frame.as_bytes()).await?;
                stdin.write_all(b"\n").await?;
                stdin.flush().await?;
                Ok(())
            },
            Transport::Http { client, url } => {
                let req = client.post(url.as_str()).header("Content-Type", "application/json");
                // We deliberately ignore the body; notifications are fire-and-forget.
                let _ = req.body(frame).send().await.map_err(McpError::Http)?;
                Ok(())
            },
        }
    }

    /// Perform the MCP `initialize` handshake and the `notifications/initialized`
    /// follow-up. Must be called before [`Self::list_tools`] or
    /// [`Self::call_tool`].
    ///
    /// # Errors
    ///
    /// Any [`McpError`] variant the underlying transport can produce.
    pub async fn initialize(&mut self) -> Result<ServerInfo, McpError> {
        let params = serde_json::json!({
            "protocolVersion": MCP_PROTOCOL_VERSION,
            "capabilities": {
                "tools": {}
            },
            "clientInfo": {
                "name": "aphrody-gemini-runtime",
                "version": env!("CARGO_PKG_VERSION"),
            }
        });
        let result = self.call("initialize", params).await?;
        let info = parse_server_info(&result)?;
        // Per spec: client SHOULD send `notifications/initialized` after a
        // successful initialize. Servers like google_mcp expect it before
        // accepting `tools/list`.
        self.notify("notifications/initialized", serde_json::json!({})).await?;
        self.initialized = true;
        Ok(info)
    }

    /// List the tools advertised by the connected MCP server.
    ///
    /// # Errors
    ///
    /// - [`McpError::Malformed`] — when `initialize` has not been called yet or the response
    ///   payload does not match `{ tools: [...] }`.
    pub async fn list_tools(&mut self) -> Result<Vec<McpTool>, McpError> {
        if !self.initialized {
            return Err(McpError::Malformed("list_tools called before initialize()".to_owned()));
        }
        let result = self.call("tools/list", serde_json::json!({})).await?;
        parse_tools(&result)
    }

    /// Invoke a tool on the connected server.
    ///
    /// `args` must be a JSON object matching the tool's `inputSchema`.
    /// Returns the raw JSON-RPC `result` field — typically
    /// `{ content: [{ type: "text", text: "..." }, ...] }`.
    ///
    /// # Errors
    ///
    /// - [`McpError::JsonRpc`] — server returned a JSON-RPC error envelope.
    /// - [`McpError::Malformed`] — when `initialize` has not been called.
    pub async fn call_tool(
        &mut self,
        name: &str,
        args: serde_json::Value,
    ) -> Result<serde_json::Value, McpError> {
        if !self.initialized {
            return Err(McpError::Malformed("call_tool called before initialize()".to_owned()));
        }
        let params = serde_json::json!({
            "name": name,
            "arguments": args,
        });
        self.call("tools/call", params).await
    }

    /// Attempt to gracefully shut down the underlying transport.
    ///
    /// For stdio, sends SIGKILL via [`Child::start_kill`]; for HTTP this is a
    /// no-op (the connection pool is dropped with the client).
    #[cfg(not(target_arch = "wasm32"))]
    pub async fn shutdown(&mut self) {
        if let Transport::Stdio { child, .. } = &mut self.transport {
            let _ = child.start_kill();
        }
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn invalid_http_header_does_not_disclose_value() {
        let headers = HashMap::from([("X-Secret".to_owned(), "private\nvalue".to_owned())]);
        let error = match McpClient::from_http_headers("http://127.0.0.1/mcp", &headers) {
            Ok(_) => panic!("invalid header was accepted"),
            Err(error) => error.to_string(),
        };
        assert!(error.contains("X-Secret"));
        assert!(!error.contains("private"));
    }

    #[tokio::test]
    async fn custom_http_headers_reach_handshake_notification_and_tool_list() {
        use std::io::{BufRead as _, Read as _, Write as _};
        let _ = rustls::crypto::ring::default_provider().install_default();
        let listener = std::net::TcpListener::bind("127.0.0.1:0").expect("bind local fixture");
        let address = listener.local_addr().expect("fixture address");
        let server = std::thread::spawn(move || {
            for _ in 0..3 {
                let (stream, _) = listener.accept().expect("accept MCP request");
                stream.set_read_timeout(Some(Duration::from_secs(5))).expect("read timeout");
                let mut reader = std::io::BufReader::new(stream);
                let mut line = String::new();
                reader.read_line(&mut line).expect("request line");
                assert!(line.starts_with("POST /mcp HTTP/1.1"));
                let mut length = 0;
                let mut saw_authorization = false;
                let mut saw_project = false;
                loop {
                    line.clear();
                    reader.read_line(&mut line).expect("header line");
                    if line == "\r\n" {
                        break;
                    }
                    let (name, value) = line.split_once(':').expect("header format");
                    if name.eq_ignore_ascii_case("content-length") {
                        length = value.trim().parse::<usize>().expect("body length");
                    }
                    if name.eq_ignore_ascii_case("authorization") {
                        assert_eq!(value.trim(), "Bearer fixture-secret");
                        saw_authorization = true;
                    }
                    if name.eq_ignore_ascii_case("x-project") {
                        assert_eq!(value.trim(), "fixture-workspace");
                        saw_project = true;
                    }
                }
                assert!(saw_authorization && saw_project, "required headers missing");
                let mut body = vec![0; length];
                reader.read_exact(&mut body).expect("request body");
                let request: serde_json::Value = serde_json::from_slice(&body).expect("JSON-RPC");
                let response = match request["method"].as_str().expect("method") {
                    "initialize" => serde_json::json!({"jsonrpc":"2.0","id":request["id"],"result":{"serverInfo":{"name":"fixture","version":"1"},"protocolVersion":"2024-11-05"}}).to_string(),
                    "notifications/initialized" => String::new(),
                    "tools/list" => serde_json::json!({"jsonrpc":"2.0","id":request["id"],"result":{"tools":[]}}).to_string(),
                    method => panic!("unexpected method: {method}"),
                };
                let status = if response.is_empty() { "202 Accepted" } else { "200 OK" };
                write!(
                    reader.get_mut(),
                    "HTTP/1.1 {status}\r\nContent-Length: {}\r\nConnection: \
                     close\r\n\r\n{response}",
                    response.len()
                )
                .expect("respond");
            }
        });
        let headers = HashMap::from([
            ("Authorization".to_owned(), "Bearer fixture-secret".to_owned()),
            ("X-Project".to_owned(), "fixture-workspace".to_owned()),
        ]);
        let mut client = McpClient::from_http_headers(format!("http://{address}/mcp"), &headers)
            .expect("HTTP client");
        client.initialize().await.expect("initialize");
        assert!(client.list_tools().await.expect("tools/list").is_empty());
        server.join().expect("server assertions");
    }

    #[test]
    fn parse_tools_extracts_three_fields() {
        let raw = serde_json::json!({
            "tools": [
                {
                    "name": "read_file",
                    "description": "Read a file from disk",
                    "inputSchema": {"type": "object", "properties": {"path": {"type": "string"}}}
                },
                {
                    "name": "write_file",
                    "description": "Write content to a file",
                    "inputSchema": {"type": "object"}
                }
            ]
        });
        let tools = parse_tools(&raw).expect("parse ok");
        assert_eq!(tools.len(), 2);
        assert_eq!(tools[0].name, "read_file");
        assert_eq!(tools[0].description, "Read a file from disk");
        assert!(tools[0].input_schema.is_object());
        assert_eq!(tools[1].name, "write_file");
    }

    #[test]
    fn parse_tools_rejects_missing_array() {
        let raw = serde_json::json!({"foo": "bar"});
        assert!(matches!(parse_tools(&raw), Err(McpError::Malformed(_))));
    }

    #[test]
    fn parse_response_surfaces_jsonrpc_error() {
        let raw =
            r#"{"jsonrpc":"2.0","id":1,"error":{"code":-32601,"message":"method not found"}}"#;
        match parse_response(raw) {
            Err(McpError::JsonRpc { code, message }) => {
                assert_eq!(code, -32601);
                assert_eq!(message, "method not found");
            },
            other => panic!("expected JsonRpc, got {other:?}"),
        }
    }

    #[test]
    fn parse_response_extracts_result() {
        let raw = r#"{"jsonrpc":"2.0","id":1,"result":{"ok":true}}"#;
        let v = parse_response(raw).expect("ok");
        assert_eq!(v["ok"], true);
    }

    #[test]
    fn parse_server_info_returns_defaults() {
        let raw = serde_json::json!({
            "protocolVersion": "2024-11-05",
            "serverInfo": {"name": "example-server", "version": "1.2.3"},
            "capabilities": {"tools": {}}
        });
        let info = parse_server_info(&raw).expect("ok");
        assert_eq!(info.name, "example-server");
        assert_eq!(info.version, "1.2.3");
        assert_eq!(info.protocol_version, "2024-11-05");
        assert!(info.capabilities.is_object());
    }

    #[test]
    fn jsonrpc_request_shape() {
        let frame = jsonrpc_request(7, "tools/list", serde_json::json!({}));
        let v: serde_json::Value = serde_json::from_str(&frame).expect("valid JSON");
        assert_eq!(v["jsonrpc"], "2.0");
        assert_eq!(v["id"], 7);
        assert_eq!(v["method"], "tools/list");
    }

    #[test]
    fn jsonrpc_notification_omits_id() {
        let frame = jsonrpc_notification("notifications/initialized", serde_json::json!({}));
        let v: serde_json::Value = serde_json::from_str(&frame).expect("valid JSON");
        assert_eq!(v["jsonrpc"], "2.0");
        assert!(v.get("id").is_none());
        assert_eq!(v["method"], "notifications/initialized");
    }
}
