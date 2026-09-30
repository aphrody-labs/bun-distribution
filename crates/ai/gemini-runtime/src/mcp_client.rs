// SPDX-License-Identifier: Apache-2.0
//! Model Context Protocol (MCP) JSON-RPC 2.0 client.
//!
//! Implements the client half of the MCP wire protocol over two transports:
//!
//! - **stdio** — spawn a child process and exchange newline-delimited JSON-RPC frames over
//!   `stdin`/`stdout`. This is the form used by Claude Desktop and the repo's own `.mcp.json`
//!   (`google_mcp`, `bxc`, …). Implemented via [`tokio::process::Command`] — guarded by
//!   `#[cfg(not(target_arch = "wasm32"))]` because process spawning is unavailable on the wasm32
//!   target.
//! - **http** — POST single JSON-RPC frames to a streamable-HTTP MCP endpoint. Available on every
//!   target including wasm32 via [`reqwest`].
//!
//! # Wire protocol summary
//!
//! The MCP handshake mandated by the spec is:
//!
//! 1. Client → `initialize` (`{ protocolVersion, capabilities, clientInfo }`).
//! 2. Server → result with `{ protocolVersion, capabilities, serverInfo }`.
//! 3. Client → `notifications/initialized` (no id, no response).
//! 4. Client → `tools/list` → server returns `{ tools: [{ name, description, inputSchema }] }`.
//! 5. Client → `tools/call` (`{ name, arguments }`) → server returns `{ content: […] }`.
//!
//! This client implements steps 1–5. Higher-level orchestration (probing, registry,
//! event publishing) lives in `aphrody-terminal-llm::mcp` — the reference probe-loop
//! implementation that this module generalises into a reusable client object.

#[cfg(not(target_arch = "wasm32"))] use std::process::Stdio;
use std::{collections::HashMap, time::Duration};

use serde::{Deserialize, Serialize};
use thiserror::Error;
#[cfg(not(target_arch = "wasm32"))]
use tokio::{
    io::{AsyncBufReadExt as _, AsyncWriteExt as _, BufReader, Lines},
    process::{Child, ChildStdin, ChildStdout, Command},
    time::timeout,
};

// ---------------------------------------------------------------------------
// Public constants
// ---------------------------------------------------------------------------

/// MCP protocol version advertised in the `initialize` handshake.
///
/// Matches the version negotiated by Claude Desktop, the `aphrody-terminal-llm`
/// probe loop and the upstream `modelcontextprotocol/specification` repo
/// (`2024-11-05`).
pub const MCP_PROTOCOL_VERSION: &str = "2024-11-05";

/// Default timeout for a single stdio JSON-RPC exchange (request + response).
pub const DEFAULT_RPC_TIMEOUT: Duration = Duration::from_secs(30);

/// Default timeout for connecting to / spawning an MCP server.
pub const DEFAULT_CONNECT_TIMEOUT: Duration = Duration::from_secs(10);

// ---------------------------------------------------------------------------
// Error type
// ---------------------------------------------------------------------------

/// Errors produced by [`McpClient`].
#[derive(Debug, Error)]
pub enum McpError {
    /// Spawning the child process failed (stdio transport only).
    #[error("failed to spawn MCP server `{command}`: {source}")]
    Spawn {
        /// The command that failed to spawn.
        command: String,
        /// The underlying I/O error.
        #[source]
        source: std::io::Error,
    },

    /// The child process exposed no usable stdin/stdout handle.
    #[error("MCP child process exposed no {handle} handle")]
    MissingHandle {
        /// `"stdin"` or `"stdout"`.
        handle: &'static str,
    },

    /// An I/O error occurred while exchanging JSON-RPC frames.
    #[error("I/O error during MCP exchange: {0}")]
    Io(#[from] std::io::Error),

    /// HTTP transport error.
    #[error("HTTP transport error: {0}")]
    Http(#[from] reqwest::Error),

    /// A configured HTTP header could not be used. Its value is never included.
    #[error("invalid MCP HTTP header `{name}`")]
    InvalidHeader { name: String },

    /// A required header value is sourced from an unset environment variable.
    #[error("MCP HTTP header `{name}` requires environment variable `{variable}`")]
    MissingHeaderEnvironment { name: String, variable: String },

    /// The HTTP MCP endpoint returned a non-2xx status.
    #[error("HTTP MCP endpoint returned status {status}: {body}")]
    HttpStatus {
        /// HTTP status code.
        status: u16,
        /// Response body (truncated to 1 KiB).
        body: String,
    },

    /// JSON-RPC server returned a structured `error` field.
    #[error("JSON-RPC error {code}: {message}")]
    JsonRpc {
        /// Error code from the JSON-RPC response.
        code: i64,
        /// Human-readable error message.
        message: String,
    },

    /// Response could not be deserialized.
    #[error("malformed JSON-RPC response: {0}")]
    Malformed(String),

    /// The exchange exceeded the configured timeout.
    #[error("MCP RPC `{method}` timed out after {seconds}s")]
    Timeout {
        /// JSON-RPC method that timed out.
        method: String,
        /// Timeout value in seconds.
        seconds: u64,
    },

    /// The transport used does not support the requested operation on this
    /// target (e.g. stdio on wasm32).
    #[error("MCP stdio transport is unavailable on this target (wasm32)")]
    UnsupportedTransport,
}

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
// Wire-level helpers
// ---------------------------------------------------------------------------

/// Build a minimal JSON-RPC 2.0 request frame (no id ⇒ notification).
fn jsonrpc_notification(method: &str, params: serde_json::Value) -> String {
    serde_json::json!({
        "jsonrpc": "2.0",
        "method": method,
        "params": params,
    })
    .to_string()
}

/// Build a minimal JSON-RPC 2.0 request frame with `id`.
fn jsonrpc_request(id: u64, method: &str, params: serde_json::Value) -> String {
    serde_json::json!({
        "jsonrpc": "2.0",
        "id": id,
        "method": method,
        "params": params,
    })
    .to_string()
}

/// Extract a `result` field, or convert an `error` field into [`McpError::JsonRpc`].
fn parse_response(text: &str) -> Result<serde_json::Value, McpError> {
    let v: serde_json::Value = serde_json::from_str(text)
        .map_err(|e| McpError::Malformed(format!("not valid JSON: {e}; raw={text}")))?;
    if let Some(err) = v.get("error") {
        let code = err.get("code").and_then(serde_json::Value::as_i64).unwrap_or(0);
        let message =
            err.get("message").and_then(serde_json::Value::as_str).unwrap_or("unknown").to_owned();
        return Err(McpError::JsonRpc { code, message });
    }
    v.get("result")
        .cloned()
        .ok_or_else(|| McpError::Malformed(format!("missing `result` field: {text}")))
}

/// Parse a `tools/list` response payload into a vector of [`McpTool`]s.
fn parse_tools(result: &serde_json::Value) -> Result<Vec<McpTool>, McpError> {
    let tools_arr = result
        .get("tools")
        .and_then(serde_json::Value::as_array)
        .ok_or_else(|| McpError::Malformed(format!("missing `tools[]`: {result}")))?;
    let mut out = Vec::with_capacity(tools_arr.len());
    for raw in tools_arr {
        let tool: McpTool = serde_json::from_value(raw.clone())
            .map_err(|e| McpError::Malformed(format!("malformed tool entry: {e}; raw={raw}")))?;
        out.push(tool);
    }
    Ok(out)
}

/// Parse an `initialize` response payload into [`ServerInfo`].
fn parse_server_info(result: &serde_json::Value) -> Result<ServerInfo, McpError> {
    let server_info = result
        .get("serverInfo")
        .ok_or_else(|| McpError::Malformed(format!("missing `serverInfo`: {result}")))?;
    let name =
        server_info.get("name").and_then(serde_json::Value::as_str).unwrap_or("unknown").to_owned();
    let version = server_info
        .get("version")
        .and_then(serde_json::Value::as_str)
        .unwrap_or("0.0.0")
        .to_owned();
    let capabilities = result.get("capabilities").cloned().unwrap_or(serde_json::Value::Null);
    let protocol_version = result
        .get("protocolVersion")
        .and_then(serde_json::Value::as_str)
        .unwrap_or(MCP_PROTOCOL_VERSION)
        .to_owned();
    Ok(ServerInfo { name, version, capabilities, protocol_version })
}

// ---------------------------------------------------------------------------
// Transport-specific connection state
// ---------------------------------------------------------------------------

/// Active transport backing an [`McpClient`].
enum Transport {
    /// Spawned child process; stdio JSON-RPC framing.
    #[cfg(not(target_arch = "wasm32"))]
    Stdio { child: Box<Child>, stdin: ChildStdin, lines: Lines<BufReader<ChildStdout>> },
    /// HTTP MCP endpoint.
    Http { client: reqwest::Client, url: String },
}

// ---------------------------------------------------------------------------
// McpClient
// ---------------------------------------------------------------------------

/// A live MCP JSON-RPC 2.0 client connection.
///
/// Created via [`McpClient::from_stdio`] or [`McpClient::from_http`]. Holds
/// the underlying transport (spawned child process or HTTP client) and tracks
/// monotonically increasing JSON-RPC request IDs.
///
/// Dropping the client closes the transport: for stdio the child process is
/// killed (via `Command::kill_on_drop(true)`); for HTTP nothing happens.
pub struct McpClient {
    transport: Transport,
    next_id: u64,
    /// Configurable RPC timeout (default: [`DEFAULT_RPC_TIMEOUT`]).
    pub rpc_timeout: Duration,
    /// Whether `initialize` has already been called; gates `list_tools` /
    /// `call_tool` from running before the handshake.
    initialized: bool,
}

impl McpClient {
    /// Connect to an MCP server over stdio by spawning `command` with `args`
    /// and a custom environment (`env`).
    ///
    /// Stdin is left open so subsequent `initialize` / `tools/list` /
    /// `tools/call` requests can be written. The child is configured with
    /// `kill_on_drop(true)` so dropping the [`McpClient`] terminates it.
    ///
    /// On wasm32 this function returns [`McpError::UnsupportedTransport`].
    ///
    /// # Errors
    ///
    /// - [`McpError::Spawn`] — the child process could not be started.
    /// - [`McpError::MissingHandle`] — the child exposed no stdin or stdout.
    /// - [`McpError::UnsupportedTransport`] — on wasm32.
    #[cfg(not(target_arch = "wasm32"))]
    pub async fn from_stdio(
        command: &str,
        args: &[&str],
        env: &HashMap<String, String>,
    ) -> Result<Self, McpError> {
        let mut cmd = Command::new(command);
        cmd.args(args)
            .envs(env)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .kill_on_drop(true);

        let mut child = cmd
            .spawn()
            .map_err(|source| McpError::Spawn { command: command.to_owned(), source })?;
        let stdin = child.stdin.take().ok_or(McpError::MissingHandle { handle: "stdin" })?;
        let stdout = child.stdout.take().ok_or(McpError::MissingHandle { handle: "stdout" })?;
        let lines = BufReader::new(stdout).lines();

        Ok(Self {
            transport: Transport::Stdio { child: Box::new(child), stdin, lines },
            next_id: 1,
            rpc_timeout: DEFAULT_RPC_TIMEOUT,
            initialized: false,
        })
    }

    /// Stub on wasm32: stdio transport is unavailable because
    /// `tokio::process` is not implemented there.
    #[cfg(target_arch = "wasm32")]
    pub async fn from_stdio(
        _command: &str,
        _args: &[&str],
        _env: &HashMap<String, String>,
    ) -> Result<Self, McpError> {
        Err(McpError::UnsupportedTransport)
    }

    /// Connect to a streamable-HTTP MCP endpoint.
    ///
    /// The optional `bearer` token is sent as `Authorization: Bearer <token>`
    /// on every request — required by most production MCP HTTP servers.
    ///
    /// # Errors
    ///
    /// - [`McpError::Http`] — building the inner [`reqwest::Client`] failed.
    pub fn from_http(url: impl Into<String>, bearer: Option<String>) -> Result<Self, McpError> {
        let mut headers = HashMap::new();
        if let Some(token) = bearer {
            headers.insert("Authorization".to_owned(), format!("Bearer {token}"));
        }
        Self::from_http_headers(url, &headers)
    }

    /// Connect to a streamable-HTTP endpoint with the configured request
    /// headers. Header values are validated without including them in errors.
    /// The same headers are sent for initialization, notifications and calls.
    pub fn from_http_headers(
        url: impl Into<String>,
        headers: &HashMap<String, String>,
    ) -> Result<Self, McpError> {
        let mut default_headers = reqwest::header::HeaderMap::new();
        for (name, value) in headers {
            let key = reqwest::header::HeaderName::from_bytes(name.as_bytes())
                .map_err(|_| McpError::InvalidHeader { name: name.clone() })?;
            let value = reqwest::header::HeaderValue::from_str(value)
                .map_err(|_| McpError::InvalidHeader { name: name.clone() })?;
            default_headers.insert(key, value);
        }
        let client = reqwest::Client::builder()
            .timeout(DEFAULT_RPC_TIMEOUT)
            .default_headers(default_headers)
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .map_err(McpError::Http)?;
        Ok(Self {
            transport: Transport::Http { client, url: url.into() },
            next_id: 1,
            rpc_timeout: DEFAULT_RPC_TIMEOUT,
            initialized: false,
        })
    }

    fn next_id(&mut self) -> u64 {
        let id = self.next_id;
        self.next_id = self.next_id.wrapping_add(1);
        id
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
