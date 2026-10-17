// SPDX-License-Identifier: Apache-2.0
//! A kernel client, and [`host_remote`]: serve a subsystem from another process.

use std::{
    collections::HashMap,
    sync::{
        Arc, Mutex,
        atomic::{AtomicU64, Ordering},
    },
    time::Duration,
};

use serde_json::{Value, json};
use tokio::{
    io::{AsyncWriteExt, BufReader, BufWriter},
    sync::{mpsc, oneshot},
};

use crate::{
    SubsystemError, SystemSubsystem,
    rpc::{PROTOCOL_VERSION, call_result, id_key},
    transport::{ClientStream, connect},
};

#[derive(Debug, thiserror::Error)]
pub enum ClientError {
    #[error("connection: {0}")]
    Io(#[from] std::io::Error),
    #[error("kernel closed the connection")]
    Closed,
    #[error("{method} timed out")]
    Timeout { method: String },
    #[error("{message} (code {code})")]
    Rpc { code: i64, message: String },
}

/// A JSON-RPC connection to a kernel.
pub struct Client {
    outbound: mpsc::UnboundedSender<Value>,
    pending: Arc<Mutex<HashMap<String, oneshot::Sender<Value>>>>,
    next_id: AtomicU64,
    /// Requests and notifications the kernel sent (not responses).
    pub incoming: mpsc::UnboundedReceiver<Value>,
    /// The reader task holds the read half; it is stopped on drop so the connection closes.
    reader: tokio::task::JoinHandle<()>,
}

impl Drop for Client {
    fn drop(&mut self) {
        self.reader.abort();
    }
}

impl Client {
    #[cfg(test)]
    pub(crate) fn pending_is_empty(&self) -> bool {
        self.pending
            .lock()
            .map(|pending| pending.is_empty())
            .unwrap_or(true)
    }

    /// Connect to the kernel at `endpoint`.
    ///
    /// # Errors
    /// When nothing listens there.
    pub async fn connect(endpoint: &str) -> Result<Self, ClientError> {
        Ok(Self::from_stream(connect(endpoint).await?))
    }

    #[must_use]
    pub fn from_stream(stream: ClientStream) -> Self {
        let (reader, writer) = tokio::io::split(stream);
        let (outbound, mut queue) = mpsc::unbounded_channel::<Value>();
        let (incoming_tx, incoming) = mpsc::unbounded_channel::<Value>();
        let pending: Arc<Mutex<HashMap<String, oneshot::Sender<Value>>>> = Arc::default();
        tokio::spawn(async move {
            let mut buf_writer = BufWriter::with_capacity(64 * 1024, writer);
            while let Some(message) = queue.recv().await {
                if let Ok(mut line) = serde_json::to_vec(&message) {
                    line.push(b'\n');
                    if buf_writer.write_all(&line).await.is_err() {
                        break;
                    }
                }
                while let Ok(next) = queue.try_recv() {
                    if let Ok(mut line) = serde_json::to_vec(&next) {
                        line.push(b'\n');
                        if buf_writer.write_all(&line).await.is_err() {
                            break;
                        }
                    }
                }
                if buf_writer.flush().await.is_err() {
                    break;
                }
            }
        });
        let reader_pending = Arc::clone(&pending);
        let reader = tokio::spawn(async move {
            let mut reader = BufReader::new(reader);
            while let Ok(Some(line)) =
                crate::transport::read_line_limited(&mut reader, 64 * 1024 * 1024).await
            {
                let Ok(message) = serde_json::from_slice::<Value>(&line) else {
                    continue;
                };
                let is_response = message.get("method").is_none() && message.get("id").is_some();
                if is_response {
                    let key = id_key(&message["id"]);
                    let sender = reader_pending
                        .lock()
                        .unwrap_or_else(std::sync::PoisonError::into_inner)
                        .remove(&key);
                    if let Some(sender) = sender {
                        let _ = sender.send(message);
                    }
                } else if incoming_tx.send(message).is_err() {
                    // Nobody reads requests or notifications; keep serving responses.
                }
            }
            reader_pending
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner)
                .clear();
        });
        Self {
            outbound,
            pending,
            next_id: AtomicU64::new(1),
            incoming,
            reader,
        }
    }

    /// Send a request and wait for its result.
    ///
    /// # Errors
    /// A transport failure, a timeout, or the JSON-RPC error the kernel returned.
    pub async fn request(
        &self,
        method: &str,
        params: Value,
        timeout: Duration,
    ) -> Result<Value, ClientError> {
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        let (sender, receiver) = oneshot::channel();
        self.pending
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .insert(id.to_string(), sender);
        if self
            .outbound
            .send(json!({ "jsonrpc": "2.0", "id": id, "method": method, "params": params }))
            .is_err()
        {
            self.pending
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner)
                .remove(&id.to_string());
            return Err(ClientError::Closed);
        }
        let response = match tokio::time::timeout(timeout, receiver).await {
            Ok(Ok(response)) => response,
            Ok(Err(_)) => {
                self.pending
                    .lock()
                    .unwrap_or_else(std::sync::PoisonError::into_inner)
                    .remove(&id.to_string());
                return Err(ClientError::Closed);
            }
            Err(_) => {
                self.pending
                    .lock()
                    .unwrap_or_else(std::sync::PoisonError::into_inner)
                    .remove(&id.to_string());
                return Err(ClientError::Timeout {
                    method: method.to_owned(),
                });
            }
        };
        if let Some(error) = response.get("error") {
            return Err(ClientError::Rpc {
                code: error.get("code").and_then(Value::as_i64).unwrap_or(-32000),
                message: error
                    .get("message")
                    .and_then(Value::as_str)
                    .unwrap_or("error")
                    .to_owned(),
            });
        }
        Ok(response.get("result").cloned().unwrap_or(Value::Null))
    }

    /// Send a notification.
    ///
    /// # Errors
    /// When the connection is closed.
    pub fn notify(&self, method: &str, params: Value) -> Result<(), ClientError> {
        self.outbound
            .send(json!({ "jsonrpc": "2.0", "method": method, "params": params }))
            .map_err(|_| ClientError::Closed)
    }

    /// Answer a request the kernel sent.
    ///
    /// # Errors
    /// When the connection is closed.
    pub fn respond(&self, id: Value, result: Value) -> Result<(), ClientError> {
        self.outbound
            .send(json!({ "jsonrpc": "2.0", "id": id, "result": result }))
            .map_err(|_| ClientError::Closed)
    }

    /// The MCP handshake.
    ///
    /// # Errors
    /// See [`Client::request`].
    pub async fn initialize(&self, client_name: &str) -> Result<Value, ClientError> {
        let mut params = json!({
            "protocolVersion": PROTOCOL_VERSION,
            "capabilities": {},
            "clientInfo": { "name": client_name, "version": env!("CARGO_PKG_VERSION") }
        });
        if let Some(token) = std::env::var("APHRODY_OS_AUTH_TOKEN")
            .ok()
            .filter(|token| !token.is_empty())
        {
            params["authToken"] = json!(token);
        }
        let result = self
            .request("initialize", params, Duration::from_secs(30))
            .await?;
        self.notify("notifications/initialized", json!({}))?;
        Ok(result)
    }
}

/// Serve `subsystem` inside the kernel at `endpoint`: register it, then answer the kernel's
/// `tools/call` requests until the connection closes. This is how a second process (the
/// desktop, a Bun or uv tool written against the same protocol) joins a running kernel.
///
/// # Errors
/// Connection or registration failure.
pub async fn host_remote(
    subsystem: Arc<dyn SystemSubsystem>,
    endpoint: &str,
) -> Result<(), ClientError> {
    let mut client = Client::connect(endpoint).await?;
    client
        .initialize(&format!("aphrody-os/{}", subsystem.name()))
        .await?;
    let tools: Vec<Value> = subsystem
        .tools()
        .iter()
        .map(crate::ToolDefinition::to_mcp)
        .collect();
    client
        .request(
            "system/register_subsystem",
            json!({
                "name": subsystem.name(),
                "description": subsystem.description(),
                "runtime": "rust",
                "tools": tools,
                "skills": subsystem.skills(),
            }),
            Duration::from_secs(30),
        )
        .await?;
    let mut incoming = std::mem::replace(&mut client.incoming, mpsc::unbounded_channel().1);
    let sender = Arc::new(client);
    while let Some(message) = incoming.recv().await {
        let (Some(id), Some(method)) = (
            message.get("id").cloned(),
            message.get("method").and_then(Value::as_str),
        ) else {
            continue;
        };
        let reply = match method {
            "tools/call" => {
                let subsystem = Arc::clone(&subsystem);
                let sender = Arc::clone(&sender);
                let params = message.get("params").cloned().unwrap_or(Value::Null);
                tokio::spawn(async move {
                    let tool = params
                        .get("name")
                        .and_then(Value::as_str)
                        .unwrap_or_default()
                        .to_owned();
                    let arguments = params
                        .get("arguments")
                        .cloned()
                        .unwrap_or_else(|| json!({}));
                    let outcome = subsystem.call(&tool, arguments).await;
                    let _ = sender.respond(id, call_result(outcome));
                });
                continue;
            }
            "ping" => json!({}),
            other => call_result(Err(SubsystemError::UnknownTool(other.to_owned()))),
        };
        sender.respond(id, reply)?;
    }
    Ok(())
}
