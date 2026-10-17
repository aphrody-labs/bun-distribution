// SPDX-License-Identifier: Apache-2.0
//! MCP client facade for the Gemini runtime.
//!
//! The one MCP client of the workspace is [`aphrody_mcp_client`]. It owns the JSON-RPC framing,
//! the stdio and streamable HTTP transports, header validation and the timeouts; this module no
//! longer carries a second implementation of any of it. What remains is the public surface that
//! `aphrody mcp` (`crates/infra/aphrody`), [`crate::tools::McpProxyTool`] and the existing tests were written
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
    map.iter()
        .map(|(key, value)| (key.clone(), value.clone()))
        .collect()
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
        Self {
            inner,
            rpc_timeout: DEFAULT_RPC_TIMEOUT,
        }
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

    /// Perform the MCP `initialize` handshake and the `notifications/initialized`
    /// follow-up. The other methods run it on demand when it has not happened yet.
    ///
    /// # Errors
    ///
    /// Any [`McpError`] variant the underlying transport can produce.
    pub async fn initialize(&mut self) -> Result<ServerInfo, McpError> {
        self.apply_timeouts();
        self.inner.initialize().await.cloned().map(ServerInfo::from)
    }

    /// List the tools advertised by the connected MCP server.
    ///
    /// # Errors
    ///
    /// - [`McpError::Malformed`] — the response payload does not match `{ tools: [...] }`.
    /// - Any error of the handshake or the transport.
    pub async fn list_tools(&mut self) -> Result<Vec<McpTool>, McpError> {
        self.apply_timeouts();
        let tools = self.inner.list_tools().await?;
        Ok(tools.into_iter().map(McpTool::from).collect())
    }

    /// Invoke a tool on the connected server.
    ///
    /// `args` must be a JSON object matching the tool's `inputSchema`.
    /// Returns the raw JSON-RPC `result` field — typically
    /// `{ content: [{ type: "text", text: "..." }, ...] }` — untouched.
    ///
    /// # Errors
    ///
    /// - [`McpError::JsonRpc`] — server returned a JSON-RPC error envelope.
    /// - Any error of the handshake or the transport.
    pub async fn call_tool(
        &mut self,
        name: &str,
        args: serde_json::Value,
    ) -> Result<serde_json::Value, McpError> {
        self.apply_timeouts();
        self.inner.call_tool_raw(name, args).await
    }

    /// Attempt to gracefully shut down the underlying transport.
    ///
    /// For stdio the child process is killed; for HTTP this is a no-op.
    pub async fn shutdown(&mut self) {
        // Best effort, as before: the child is also killed when the client is dropped.
        let _ = self.inner.shutdown().await;
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
                stream
                    .set_read_timeout(Some(Duration::from_secs(5)))
                    .expect("read timeout");
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
                let status = if response.is_empty() {
                    "202 Accepted"
                } else {
                    "200 OK"
                };
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
            (
                "Authorization".to_owned(),
                "Bearer fixture-secret".to_owned(),
            ),
            ("X-Project".to_owned(), "fixture-workspace".to_owned()),
        ]);
        let mut client = McpClient::from_http_headers(format!("http://{address}/mcp"), &headers)
            .expect("HTTP client");
        client.initialize().await.expect("initialize");
        assert!(client.list_tools().await.expect("tools/list").is_empty());
        server.join().expect("server assertions");
    }

    // JSON-RPC framing, response parsing and the transports are tested where they live, in
    // `aphrody-mcp-client` (`tests/mcp_client_tests.rs`, `tests/http_transport.rs`). The tests
    // below cover only what this facade adds: value conversion and the error passthrough.

    #[test]
    fn canonical_tool_without_description_renders_as_empty_string() {
        let tool = aphrody_mcp_client::McpTool {
            name: "echo".to_owned(),
            description: None,
            input_schema: serde_json::json!({"type": "object"}),
        };
        let converted = McpTool::from(tool);
        assert_eq!(converted.name, "echo");
        assert_eq!(converted.description, "");
        assert!(converted.input_schema.is_object());
    }

    #[test]
    fn canonical_server_info_converts_field_for_field() {
        let info = aphrody_mcp_client::ServerInfo {
            name: "example-server".to_owned(),
            version: "1.2.3".to_owned(),
            capabilities: serde_json::json!({"tools": {}}),
            protocol_version: "2024-11-05".to_owned(),
        };
        let converted = ServerInfo::from(info);
        assert_eq!(converted.name, "example-server");
        assert_eq!(converted.version, "1.2.3");
        assert_eq!(converted.protocol_version, "2024-11-05");
        assert!(converted.capabilities.is_object());
        // The serialised shape consumed by `aphrody mcp list` keeps its snake_case keys.
        let value = serde_json::to_value(&converted).expect("serialises");
        assert_eq!(value["protocol_version"], "2024-11-05");
    }

    #[tokio::test]
    async fn missing_command_surfaces_the_canonical_spawn_error() {
        let env = HashMap::new();
        let bogus = "definitely-not-a-real-binary-xyz-aphrody-facade";
        match McpClient::from_stdio(bogus, &[], &env).await {
            Err(McpError::Spawn { command, .. }) => assert_eq!(command, bogus),
            Err(other) => panic!("expected Spawn, got {other:?}"),
            Ok(_) => panic!("phantom binary somehow spawned"),
        }
    }

    #[test]
    fn shared_constants_keep_their_values() {
        assert_eq!(MCP_PROTOCOL_VERSION, "2024-11-05");
        assert_eq!(DEFAULT_RPC_TIMEOUT, Duration::from_secs(30));
        assert_eq!(DEFAULT_CONNECT_TIMEOUT, Duration::from_secs(10));
    }
}
