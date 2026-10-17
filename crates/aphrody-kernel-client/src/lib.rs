// SPDX-License-Identifier: Apache-2.0
//! Client contract for the Aphrody OS kernel's local NDJSON JSON-RPC endpoint.

use std::{
    fmt, io,
    sync::atomic::{AtomicU64, Ordering},
    time::Duration,
};

use serde_json::{Value, json};
use thiserror::Error;
use tokio::io::{AsyncBufReadExt, AsyncRead, AsyncWrite, AsyncWriteExt, BufReader};
use tokio::sync::Mutex;

mod endpoint;

pub use endpoint::{ENDPOINT_ENV, EnvLookup, endpoint_from};

/// Default deadline for one local kernel request.
pub const DEFAULT_REQUEST_TIMEOUT: Duration = Duration::from_secs(30);
/// Maximum inbound or outbound JSON-RPC frame size.
pub const MAX_MESSAGE_BYTES: usize = 64 * 1024 * 1024;

/// Fixed read-only diagnostics suitable for native desktop UI commands.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WslProbe {
    /// Linux kernel information.
    SystemInfo,
    /// Installed reverse-engineering packages.
    ReToolchain,
    /// Linux process inventory.
    Processes,
    /// Mounted file systems.
    Mounts,
    /// Network interface addresses.
    Network,
}

impl WslProbe {
    const fn name(self) -> &'static str {
        match self {
            Self::SystemInfo => "system-info",
            Self::ReToolchain => "re-toolchain",
            Self::Processes => "processes",
            Self::Mounts => "mounts",
            Self::Network => "network",
        }
    }
}

/// Errors returned by the local kernel client.
#[derive(Debug, Error)]
pub enum KernelClientError {
    /// The endpoint could not be opened.
    #[error("connect to Aphrody OS kernel: {0}")]
    Connect(#[source] io::Error),
    /// Framing or stream I/O failed.
    #[error("Aphrody OS kernel transport: {0}")]
    Io(#[source] io::Error),
    /// The peer closed before replying.
    #[error("Aphrody OS kernel closed the connection")]
    Closed,
    /// The peer returned malformed JSON or an invalid response.
    #[error("invalid Aphrody OS kernel response: {0}")]
    Protocol(String),
    /// The kernel rejected the JSON-RPC request.
    #[error("Aphrody OS kernel error {code}: {message}")]
    Rpc { code: i64, message: String },
    /// A tool returned an MCP error result.
    #[error("kernel tool {tool} failed: {message}")]
    Tool { tool: String, message: String },
    /// A request exceeded its deadline.
    #[error("Aphrody OS kernel request timed out")]
    Timeout,
}

/// Connection parameters. Authentication material is intentionally redacted from `Debug`.
pub struct ClientOptions {
    /// Local Unix socket path or Windows named-pipe path.
    pub endpoint: String,
    /// Optional kernel auth token. The caller owns secure storage and lifetime.
    pub auth_token: Option<String>,
    /// Per-request deadline.
    pub timeout: Duration,
}

impl fmt::Debug for ClientOptions {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("ClientOptions")
            .field("endpoint", &self.endpoint)
            .field(
                "auth_token",
                &self.auth_token.as_ref().map(|_| "<redacted>"),
            )
            .field("timeout", &self.timeout)
            .finish()
    }
}

impl ClientOptions {
    /// Build options using the kernel endpoint convention and an optional caller-provided token.
    #[must_use]
    pub fn new(endpoint: impl Into<String>) -> Self {
        Self {
            endpoint: endpoint.into(),
            auth_token: None,
            timeout: DEFAULT_REQUEST_TIMEOUT,
        }
    }

    /// Sets the token without making it observable in formatted diagnostics.
    #[must_use]
    pub fn with_auth_token(mut self, token: impl Into<String>) -> Self {
        self.auth_token = Some(token.into());
        self
    }

    /// Sets a per-request deadline.
    #[must_use]
    pub const fn with_timeout(mut self, timeout: Duration) -> Self {
        self.timeout = timeout;
        self
    }
}

/// Resolve the local kernel endpoint from `APHRODY_OS_SOCKET` or the documented per-user default.
///
/// This is the canonical rule: the kernel server's own `default_endpoint` delegates here, so the
/// server and its clients cannot disagree. [`endpoint_from`] is the same rule over an injected
/// environment.
#[must_use]
pub fn default_endpoint() -> String {
    endpoint_from(&process_env, cfg!(windows))
}

fn process_env(key: &str) -> Option<std::ffi::OsString> {
    std::env::var_os(key)
}

/// Connected, serial request/response client for one kernel session.
pub struct KernelClient {
    stream: Mutex<BufReader<Box<dyn KernelIo>>>,
    next_id: AtomicU64,
    auth_token: Option<String>,
    timeout: Duration,
    initialized: Mutex<bool>,
}

/// I/O stream accepted by the local kernel client.
pub trait KernelIo: AsyncRead + AsyncWrite + Unpin + Send {}
impl<T: AsyncRead + AsyncWrite + Unpin + Send> KernelIo for T {}

impl KernelClient {
    /// Connects to the platform's local socket or named pipe.
    pub async fn connect(options: ClientOptions) -> Result<Self, KernelClientError> {
        let stream = connect_endpoint(&options.endpoint)
            .await
            .map_err(KernelClientError::Connect)?;
        Ok(Self::from_stream(
            stream,
            options.auth_token,
            options.timeout,
        ))
    }

    /// Creates a client over an existing stream; useful to embed or test the protocol contract.
    #[must_use]
    pub fn from_stream(
        stream: Box<dyn KernelIo>,
        auth_token: Option<String>,
        timeout: Duration,
    ) -> Self {
        Self {
            stream: Mutex::new(BufReader::new(stream)),
            next_id: AtomicU64::new(1),
            auth_token,
            timeout,
            initialized: Mutex::new(false),
        }
    }

    /// Calls `tools/list` after performing MCP initialization on this connection.
    pub async fn tools(&self) -> Result<Value, KernelClientError> {
        self.ensure_initialized().await?;
        self.request("tools/list", json!({})).await
    }

    /// Calls a aphrody-mcp tool and returns its structured content when available.
    pub async fn call_tool(
        &self,
        tool: &str,
        arguments: Value,
    ) -> Result<Value, KernelClientError> {
        self.ensure_initialized().await?;
        let result = self
            .request(
                "tools/call",
                json!({ "name": tool, "arguments": arguments }),
            )
            .await?;
        if result.get("isError").and_then(Value::as_bool) == Some(true) {
            let message = result
                .get("content")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
                .filter_map(|part| part.get("text").and_then(Value::as_str))
                .collect::<Vec<_>>()
                .join("\n");
            return Err(KernelClientError::Tool {
                tool: tool.to_owned(),
                message,
            });
        }
        Ok(result.get("structuredContent").cloned().unwrap_or(result))
    }

    /// Calls a kernel RPC method after MCP initialization and authentication.
    /// Authorization and method validation remain with the kernel.
    pub async fn call_method(
        &self,
        method: &str,
        params: Value,
    ) -> Result<Value, KernelClientError> {
        self.ensure_initialized().await?;
        self.request(method, params).await
    }

    /// Read-only WSL installation status for native desktop consumers.
    pub async fn wsl_status(&self) -> Result<Value, KernelClientError> {
        self.call_tool("wsl_get_status", json!({})).await
    }

    /// Read-only WSL distribution inventory for native desktop consumers.
    pub async fn wsl_distributions(&self) -> Result<Value, KernelClientError> {
        self.call_tool("wsl_list_distributions", json!({})).await
    }

    /// Run a fixed diagnostic; the kernel validates the distribution and probe.
    pub async fn wsl_probe(
        &self,
        distribution: &str,
        probe: WslProbe,
    ) -> Result<Value, KernelClientError> {
        self.call_tool(
            "wsl_read_only_probe",
            json!({"distribution": distribution, "probe": probe.name()}),
        )
        .await
    }

    async fn ensure_initialized(&self) -> Result<(), KernelClientError> {
        let mut initialized = self.initialized.lock().await;
        if *initialized {
            return Ok(());
        }
        let mut params = json!({ "protocolVersion": "2025-03-26", "capabilities": {}, "clientInfo": { "name": "aphrody-shell", "version": env!("CARGO_PKG_VERSION") } });
        if let Some(token) = &self.auth_token {
            params["authToken"] = json!(token);
        }
        self.request("initialize", params).await?;
        self.notify("notifications/initialized", json!({})).await?;
        *initialized = true;
        Ok(())
    }

    async fn notify(&self, method: &str, params: Value) -> Result<(), KernelClientError> {
        let message = json!({ "jsonrpc": "2.0", "method": method, "params": params });
        let line = encode(&message).map_err(KernelClientError::Io)?;
        let mut stream = self.stream.lock().await;
        stream
            .get_mut()
            .write_all(&line)
            .await
            .map_err(KernelClientError::Io)?;
        stream
            .get_mut()
            .flush()
            .await
            .map_err(KernelClientError::Io)
    }

    async fn request(&self, method: &str, params: Value) -> Result<Value, KernelClientError> {
        tokio::time::timeout(self.timeout, async {
            let id = self.next_id.fetch_add(1, Ordering::Relaxed);
            let message = json!({ "jsonrpc": "2.0", "id": id, "method": method, "params": params });
            let line = encode(&message).map_err(KernelClientError::Io)?;
            let mut stream = self.stream.lock().await;
            stream
                .get_mut()
                .write_all(&line)
                .await
                .map_err(KernelClientError::Io)?;
            stream
                .get_mut()
                .flush()
                .await
                .map_err(KernelClientError::Io)?;
            loop {
                let response = read_frame(&mut stream).await?;
                let response: Value = serde_json::from_slice(&response)
                    .map_err(|error| KernelClientError::Protocol(error.to_string()))?;
                if !response.is_object() {
                    return Err(KernelClientError::Protocol(
                        "expected JSON-RPC object".into(),
                    ));
                }
                if response.get("method").is_some() || response.get("id").is_none() {
                    continue;
                }
                if response.get("id").and_then(Value::as_u64) != Some(id) {
                    return Err(KernelClientError::Protocol(
                        "response id does not match request".into(),
                    ));
                }
                if let Some(error) = response.get("error") {
                    return Err(KernelClientError::Rpc {
                        code: error.get("code").and_then(Value::as_i64).unwrap_or(-32000),
                        message: error
                            .get("message")
                            .and_then(Value::as_str)
                            .unwrap_or("unknown error")
                            .to_owned(),
                    });
                }
                return response.get("result").cloned().ok_or_else(|| {
                    KernelClientError::Protocol("response has neither result nor error".into())
                });
            }
        })
        .await
        .map_err(|_| KernelClientError::Timeout)?
    }
}

async fn connect_endpoint(endpoint: &str) -> io::Result<Box<dyn KernelIo>> {
    #[cfg(windows)]
    {
        use tokio::net::windows::named_pipe::ClientOptions;
        const ERROR_PIPE_BUSY: i32 = 231;
        let mut attempts = 0;
        loop {
            match ClientOptions::new().open(endpoint) {
                Ok(client) => return Ok(Box::new(client)),
                Err(error) if error.raw_os_error() == Some(ERROR_PIPE_BUSY) && attempts < 50 => {
                    attempts += 1;
                    tokio::time::sleep(Duration::from_millis(20)).await;
                }
                Err(error) => return Err(error),
            }
        }
    }
    #[cfg(unix)]
    {
        Ok(Box::new(tokio::net::UnixStream::connect(endpoint).await?))
    }
    #[cfg(not(any(windows, unix)))]
    {
        let _ = endpoint;
        Err(io::Error::new(
            io::ErrorKind::Unsupported,
            "no local kernel socket on this target",
        ))
    }
}

fn encode(message: &Value) -> io::Result<Vec<u8>> {
    let mut bytes = serde_json::to_vec(message).map_err(io::Error::other)?;
    if bytes.len() >= MAX_MESSAGE_BYTES {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "kernel request exceeds frame limit",
        ));
    }
    bytes.push(b'\n');
    Ok(bytes)
}

async fn read_frame<R: AsyncRead + Unpin>(
    reader: &mut BufReader<R>,
) -> Result<Vec<u8>, KernelClientError> {
    let mut frame = Vec::new();
    loop {
        let available = reader.fill_buf().await.map_err(KernelClientError::Io)?;
        if available.is_empty() {
            return if frame.is_empty() {
                Err(KernelClientError::Closed)
            } else {
                Ok(frame)
            };
        }
        let newline = available.iter().position(|byte| *byte == b'\n');
        let consumed = newline.map_or(available.len(), |position| position + 1);
        if frame.len().saturating_add(consumed) > MAX_MESSAGE_BYTES {
            return Err(KernelClientError::Protocol(
                "kernel response exceeds frame limit".into(),
            ));
        }
        frame.extend_from_slice(&available[..consumed]);
        reader.consume(consumed);
        if newline.is_some() {
            frame.pop();
            return Ok(frame);
        }
    }
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use serde_json::{Value, json};
    use tokio::io::{AsyncBufReadExt, AsyncWriteExt};

    use super::{ClientOptions, KernelClient, KernelClientError};

    #[tokio::test]
    async fn initializes_and_calls_tools_over_one_local_stream() {
        let (client_io, mut server_io) = tokio::io::duplex(4096);
        let client = KernelClient::from_stream(Box::new(client_io), None, Duration::from_secs(1));
        let server = tokio::spawn(async move {
            let mut reader = tokio::io::BufReader::new(&mut server_io);
            let mut line = String::new();
            reader.read_line(&mut line).await.unwrap();
            let initialize: Value = serde_json::from_str(&line).unwrap();
            assert_eq!(initialize["method"], "initialize");
            let id = initialize["id"].clone();
            let mut response =
                serde_json::to_vec(&json!({ "jsonrpc": "2.0", "id": id, "result": {} })).unwrap();
            response.push(b'\n');
            reader.get_mut().write_all(&response).await.unwrap();
            line.clear();
            reader.read_line(&mut line).await.unwrap();
            assert_eq!(
                serde_json::from_str::<Value>(&line).unwrap()["method"],
                "notifications/initialized"
            );
            line.clear();
            reader.read_line(&mut line).await.unwrap();
            let call: Value = serde_json::from_str(&line).unwrap();
            assert_eq!(call["method"], "tools/call");
            assert_eq!(call["params"]["name"], "coreutils_status");
            let id = call["id"].clone();
            let mut response = serde_json::to_vec(&json!({ "jsonrpc": "2.0", "id": id, "result": { "structuredContent": { "available": true }, "isError": false } })).unwrap();
            response.push(b'\n');
            reader.get_mut().write_all(&response).await.unwrap();
        });
        let result = client
            .call_tool("coreutils_status", json!({}))
            .await
            .unwrap();
        assert_eq!(result, json!({ "available": true }));
        server.await.unwrap();
    }

    #[tokio::test]
    async fn times_out_and_redacts_tokens() {
        let (client_io, _server_io) = tokio::io::duplex(64);
        let options = ClientOptions::new("local").with_auth_token("secret-token");
        assert!(!format!("{options:?}").contains("secret-token"));
        let client = KernelClient::from_stream(Box::new(client_io), None, Duration::from_millis(5));
        assert!(matches!(
            client.tools().await,
            Err(KernelClientError::Timeout)
        ));
    }

    #[tokio::test]
    async fn ignores_interleaved_notifications_before_request_response() {
        let (client_io, mut server_io) = tokio::io::duplex(4096);
        let client = KernelClient::from_stream(Box::new(client_io), None, Duration::from_secs(1));
        let server = tokio::spawn(async move {
            let mut reader = tokio::io::BufReader::new(&mut server_io);
            let mut line = String::new();

            // Handshake: initialize
            reader.read_line(&mut line).await.unwrap();
            let initialize: Value = serde_json::from_str(&line).unwrap();
            assert_eq!(initialize["method"], "initialize");
            let id = initialize["id"].clone();
            let mut response =
                serde_json::to_vec(&json!({ "jsonrpc": "2.0", "id": id, "result": {} })).unwrap();
            response.push(b'\n');
            reader.get_mut().write_all(&response).await.unwrap();

            // notifications/initialized from client
            line.clear();
            reader.read_line(&mut line).await.unwrap();
            assert_eq!(
                serde_json::from_str::<Value>(&line).unwrap()["method"],
                "notifications/initialized"
            );

            // Method call from client
            line.clear();
            reader.read_line(&mut line).await.unwrap();
            let call: Value = serde_json::from_str(&line).unwrap();
            assert_eq!(call["method"], "desktop/window_list");
            let id = call["id"].clone();

            // Interleave an asynchronous notification before replying to the request
            let mut notification = serde_json::to_vec(&json!({
                "jsonrpc": "2.0",
                "method": "desktop/notify",
                "params": { "title": "Background Notification", "level": "info" }
            }))
            .unwrap();
            notification.push(b'\n');
            reader.get_mut().write_all(&notification).await.unwrap();

            // Send the actual response matching the request id
            let mut response = serde_json::to_vec(&json!({
                "jsonrpc": "2.0",
                "id": id,
                "result": { "windows": ["main", "terminal"] }
            }))
            .unwrap();
            response.push(b'\n');
            reader.get_mut().write_all(&response).await.unwrap();
        });

        let result = client
            .call_method("desktop/window_list", json!({}))
            .await
            .unwrap();
        assert_eq!(result, json!({ "windows": ["main", "terminal"] }));
        server.await.unwrap();
    }

    #[tokio::test]
    async fn mismatched_response_id_fails() {
        let (client_io, mut server_io) = tokio::io::duplex(4096);
        let client = KernelClient::from_stream(Box::new(client_io), None, Duration::from_secs(1));
        let server = tokio::spawn(async move {
            let mut reader = tokio::io::BufReader::new(&mut server_io);
            let mut line = String::new();
            reader.read_line(&mut line).await.unwrap();
            let initialize: Value = serde_json::from_str(&line).unwrap();
            let id = initialize["id"].as_u64().unwrap();
            let mut response = serde_json::to_vec(&json!({
                "jsonrpc": "2.0",
                "id": id + 999,
                "result": {}
            }))
            .unwrap();
            response.push(b'\n');
            reader.get_mut().write_all(&response).await.unwrap();
        });

        let result = client.call_method("test", json!({})).await;
        match result {
            Err(KernelClientError::Protocol(msg)) => {
                assert_eq!(msg, "response id does not match request");
            }
            other => panic!("expected Protocol error, got {other:?}"),
        }
        server.await.unwrap();
    }
}
