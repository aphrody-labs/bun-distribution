// SPDX-License-Identifier: Apache-2.0
//! Newline-delimited JSON-RPC over any byte stream, and the local socket endpoint.
//!
//! The endpoint is `$APHRODY_OS_SOCKET` when set; otherwise a per-user Unix domain socket
//! (`$XDG_RUNTIME_DIR/aphrody-os.sock`, else `/tmp/aphrody-os-<user>.sock`, mode 0600) or a
//! per-user Windows named pipe (`\\.\pipe\aphrody-os-<user>`, remote clients rejected).

use std::sync::Arc;
use std::{io, time::Duration};

use serde_json::{Value, json};
use tokio::{
    io::{AsyncBufReadExt, AsyncRead, AsyncWrite, AsyncWriteExt, BufReader, BufWriter},
    sync::{Semaphore, mpsc},
    task::JoinSet,
};

use crate::{Kernel, Session};

/// Longest accepted message line (a screenshot result can be several MiB).
const MAX_LINE: usize = 64 * 1024 * 1024;
const OUTBOUND_CAPACITY: usize = 8;
const MAX_IN_FLIGHT: usize = 16;
const REQUEST_TIMEOUT: Duration = Duration::from_secs(300);
const RESPONSE_SEND_TIMEOUT: Duration = Duration::from_secs(10);

// Unlike `lines()`, this checks the limit before appending bytes to the allocation.
pub(crate) async fn read_line_limited<R: AsyncRead + Unpin>(
    reader: &mut BufReader<R>,
    limit: usize,
) -> io::Result<Option<Vec<u8>>> {
    let mut line = Vec::new();
    loop {
        let available = reader.fill_buf().await?;
        if available.is_empty() {
            return Ok((!line.is_empty()).then_some(line));
        }
        let newline = available.iter().position(|byte| *byte == b'\n');
        let consumed = newline.map_or(available.len(), |index| index + 1);
        if line.len().saturating_add(consumed) > limit {
            return Err(io::Error::new(io::ErrorKind::InvalidData, "message too large"));
        }
        line.extend_from_slice(&available[..consumed]);
        reader.consume(consumed);
        if newline.is_some() {
            return Ok(Some(line));
        }
    }
}

fn encode_message(message: &Value) -> io::Result<Vec<u8>> {
    let mut line = serde_json::to_vec(message).map_err(io::Error::other)?;
    if line.len() >= MAX_LINE {
        return Err(io::Error::new(io::ErrorKind::InvalidData, "outbound message too large"));
    }
    line.push(b'\n');
    Ok(line)
}

/// The local endpoint name for this user.
///
/// Delegates to [`aphrody_kernel_client::default_endpoint`], the single owner of the rule, so the
/// server and its clients cannot disagree (see the module documentation for the order).
#[must_use]
pub fn default_endpoint() -> String {
    aphrody_kernel_client::default_endpoint()
}

/// Serve one connection until the peer closes it. Requests run concurrently, so a peer can
/// answer the kernel's calls to its own subsystem while its own request is in flight.
pub async fn serve_connection<R, W>(kernel: Kernel, reader: R, writer: W)
where
    R: AsyncRead + Unpin + Send + 'static,
    W: AsyncWrite + Unpin + Send + 'static,
{
    let (outbound, mut queue) = mpsc::channel::<Value>(OUTBOUND_CAPACITY);
    let session = Arc::new(Session::new(outbound.clone()));
    let writer_task = tokio::spawn(async move {
        let mut buf_writer = BufWriter::with_capacity(64 * 1024, writer);
        'write: while let Some(message) = queue.recv().await {
            // Drain only the bounded queue; a single oversized response closes the peer.
            for item in std::iter::once(message).chain(std::iter::from_fn(|| queue.try_recv().ok()))
            {
                let Ok(line) = encode_message(&item) else { break 'write };
                if buf_writer.write_all(&line).await.is_err() {
                    break 'write;
                }
            }
            if buf_writer.flush().await.is_err() {
                break;
            }
        }
    });
    // Bus events: `tools/list_changed` for every session, the rest for subscribers.
    let events_task = {
        let mut events = kernel.bus().subscribe();
        let session = Arc::clone(&session);
        let outbound = outbound.clone();
        tokio::spawn(async move {
            loop {
                match events.recv().await {
                    Ok(event) => {
                        if event.kind == "tools/list_changed" && event.source == "kernel" {
                            let _ = outbound.try_send(json!({"jsonrpc": "2.0", "method": "notifications/tools/list_changed"}));
                        }
                        if session.wants(&event) {
                            let _ = outbound.try_send(json!({"jsonrpc": "2.0", "method": "system/event", "params": event}));
                        }
                    },
                    Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => {},
                    Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
                }
            }
        })
    };

    let mut reader = BufReader::new(reader);
    let permits = Arc::new(Semaphore::new(MAX_IN_FLIGHT));
    let mut requests = JoinSet::new();
    while let Ok(Some(line)) = read_line_limited(&mut reader, MAX_LINE).await {
        while requests.try_join_next().is_some() {}
        if line.iter().all(u8::is_ascii_whitespace) {
            continue;
        }
        let message: Value = match serde_json::from_slice(&line) {
            Ok(message) => message,
            Err(error) => {
                if outbound.try_send(json!({"jsonrpc": "2.0", "id": null, "error": {"code": -32700, "message": error.to_string()}})).is_err() {
                    break;
                }
                continue;
            },
        };
        // Replies to calls made by the kernel must not wait for a request permit: a
        // remote subsystem can answer while this connection is at its request limit.
        if message.get("method").is_none() {
            let _ = kernel.handle(message, &session).await;
            continue;
        }
        let Ok(permit) = Arc::clone(&permits).try_acquire_owned() else {
            if let Some(id) = message.get("id")
                && outbound.try_send(json!({"jsonrpc": "2.0", "id": id, "error": {"code": -32000, "message": "too many concurrent requests"}})).is_err()
            {
                break;
            }
            continue;
        };
        let kernel = kernel.clone();
        let session = Arc::clone(&session);
        let outbound = outbound.clone();
        let request_id = message.get("id").cloned();
        requests.spawn(async move {
            let _permit = permit;
            match tokio::time::timeout(REQUEST_TIMEOUT, kernel.handle(message, &session)).await {
                Ok(Some(response)) => {
                    let _ = tokio::time::timeout(RESPONSE_SEND_TIMEOUT, outbound.send(response)).await;
                },
                Err(_) => {
                    if let Some(id) = request_id {
                        let _ = tokio::time::timeout(RESPONSE_SEND_TIMEOUT, outbound.send(json!({"jsonrpc": "2.0", "id": id, "error": {"code": -32000, "message": "request timed out"}}))).await;
                    }
                },
                Ok(None) => {},
            }
        });
    }
    requests.abort_all();
    session.close(&kernel).await;
    events_task.abort();
    drop(outbound);
    drop(session);
    writer_task.abort();
}

/// Serve the kernel on stdin / stdout (an MCP stdio server).
pub async fn serve_stdio(kernel: Kernel) {
    serve_connection(kernel, tokio::io::stdin(), tokio::io::stdout()).await;
}

/// A connected client stream to the local endpoint.
pub type ClientStream = Box<dyn ClientIo>;

/// Read + write halves of a client connection.
pub trait ClientIo: AsyncRead + AsyncWrite + Unpin + Send {}
impl<T: AsyncRead + AsyncWrite + Unpin + Send> ClientIo for T {}

/// Connect to a running kernel.
///
/// # Errors
/// When no kernel listens on `endpoint`.
pub async fn connect(endpoint: &str) -> std::io::Result<ClientStream> {
    if let Some(port) = endpoint.strip_prefix("vsock://") {
        let port = port.parse::<u32>().map_err(|_| {
            std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                "vsock endpoint must be vsock://<host-port>",
            )
        })?;
        #[cfg(target_os = "linux")]
        return crate::hvsock::connect_guest(port).await;
        #[cfg(not(target_os = "linux"))]
        {
            let _ = port;
            return Err(std::io::Error::new(
                std::io::ErrorKind::Unsupported,
                "vsock client requires Linux",
            ));
        }
    }
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
                    tokio::time::sleep(std::time::Duration::from_millis(20)).await;
                },
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
        Err(std::io::Error::new(std::io::ErrorKind::Unsupported, "no local socket on this target"))
    }
}

/// Listen on `endpoint` and serve every connection until the process exits.
///
/// # Errors
/// When the endpoint is already served by another kernel or cannot be created.
pub async fn serve_endpoint(kernel: Kernel, endpoint: impl Into<String>) -> std::io::Result<()> {
    let endpoint = endpoint.into();
    let endpoint = endpoint.as_str();
    if connect(endpoint).await.is_ok() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::AddrInUse,
            format!("a kernel already serves {endpoint}"),
        ));
    }
    #[cfg(windows)]
    {
        use tokio::net::windows::named_pipe::ServerOptions;
        let mut server = ServerOptions::new()
            .first_pipe_instance(true)
            .reject_remote_clients(true)
            .create(endpoint)?;
        loop {
            server.connect().await?;
            let connected = server;
            server = ServerOptions::new().reject_remote_clients(true).create(endpoint)?;
            let (reader, writer) = tokio::io::split(connected);
            tokio::spawn(serve_connection(kernel.clone(), reader, writer));
        }
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let path = std::path::Path::new(endpoint);
        if path.exists() {
            std::fs::remove_file(path)?; // stale: nothing answered above
        }
        let listener = tokio::net::UnixListener::bind(path)?;
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))?;
        loop {
            let (stream, _) = listener.accept().await?;
            let (reader, writer) = stream.into_split();
            tokio::spawn(serve_connection(kernel.clone(), reader, writer));
        }
    }
    #[cfg(not(any(windows, unix)))]
    {
        let _ = (kernel, endpoint);
        Err(std::io::Error::new(std::io::ErrorKind::Unsupported, "no local socket on this target"))
    }
}
