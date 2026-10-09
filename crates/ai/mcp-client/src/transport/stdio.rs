// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 aphrody contributors

//! Stdio child-process transport for MCP servers.

use aphrody_proc::NoWindow as _;
use std::{collections::BTreeMap, path::Path, process::Stdio, time::Duration};

use async_trait::async_trait;
use serde_json::Value as JsonValue;
use tokio::{
    io::{AsyncBufReadExt as _, AsyncWriteExt as _, BufReader, Lines},
    process::{Child, ChildStdin, ChildStdout, Command},
    time::timeout,
};
use tracing::debug;

use super::Transport;
use crate::{
    error::{McpClientError, Result},
    protocol::{jsonrpc_notification, jsonrpc_request, parse_response},
};

/// Stdio-based MCP transport interacting with a spawned child process.
pub struct StdioTransport {
    child: Box<Child>,
    stdin: ChildStdin,
    lines: Lines<BufReader<ChildStdout>>,
    next_id: u64,
}

impl StdioTransport {
    /// Spawn an MCP server child process over stdio.
    pub fn spawn(
        command: &str,
        args: &[String],
        env: Option<&BTreeMap<String, String>>,
        cwd: Option<&Path>,
    ) -> Result<Self> {
        let mut cmd = Command::new(command).no_window();
        cmd.args(args);

        if let Some(env_map) = env {
            cmd.envs(env_map);
        }
        if let Some(dir) = cwd {
            cmd.current_dir(dir);
        }

        cmd.stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null()).kill_on_drop(true);

        let mut child = cmd
            .spawn()
            .map_err(|source| McpClientError::Spawn { command: command.to_owned(), source })?;

        let stdin = child.stdin.take().ok_or(McpClientError::MissingHandle { handle: "stdin" })?;
        let stdout =
            child.stdout.take().ok_or(McpClientError::MissingHandle { handle: "stdout" })?;
        let lines = BufReader::new(stdout).lines();

        Ok(Self { child: Box::new(child), stdin, lines, next_id: 1 })
    }

    fn next_id(&mut self) -> u64 {
        let id = self.next_id;
        self.next_id = self.next_id.wrapping_add(1);
        id
    }
}

#[async_trait]
impl Transport for StdioTransport {
    async fn call(
        &mut self,
        method: &str,
        params: JsonValue,
        timeout_dur: Duration,
    ) -> Result<JsonValue> {
        let id = self.next_id();
        let frame = jsonrpc_request(id, method, params);
        let secs = timeout_dur.as_secs();
        let method_name = method.to_owned();

        let fut = async {
            self.stdin.write_all(frame.as_bytes()).await?;
            self.stdin.write_all(b"\n").await?;
            self.stdin.flush().await?;

            // Read lines until finding the response with matching id:
            loop {
                let line = match self.lines.next_line().await {
                    Ok(Some(l)) => l,
                    Ok(None) => {
                        return Err(McpClientError::Malformed(
                            "MCP server closed stdout before responding".to_owned(),
                        ));
                    },
                    Err(e) => return Err(McpClientError::Io(e)),
                };

                let trimmed = line.trim();
                if trimmed.is_empty() {
                    continue;
                }

                // Check if this line is a response for our id:
                if let Ok(v) = serde_json::from_str::<JsonValue>(trimmed) {
                    if let Some(msg_id) = v.get("id").and_then(JsonValue::as_u64) {
                        if msg_id == id {
                            return parse_response(trimmed);
                        }
                        debug!(msg_id, expected_id = id, "Ignored response with different id");
                    } else if v.get("method").is_some() {
                        // Server-side notification or request, ignore or trace
                        debug!(method = ?v.get("method"), "Received server notification over stdio");
                    }
                }
            }
        };

        match timeout(timeout_dur, fut).await {
            Ok(res) => res,
            Err(_) => Err(McpClientError::Timeout { method: method_name, seconds: secs }),
        }
    }

    async fn notify(&mut self, method: &str, params: JsonValue) -> Result<()> {
        let frame = jsonrpc_notification(method, params);
        self.stdin.write_all(frame.as_bytes()).await?;
        self.stdin.write_all(b"\n").await?;
        self.stdin.flush().await?;
        Ok(())
    }

    async fn shutdown(&mut self) -> Result<()> {
        if self.child.try_wait()?.is_none() {
            self.child.kill().await?;
        }
        Ok(())
    }
}

impl Drop for StdioTransport {
    fn drop(&mut self) {
        let _ = self.child.start_kill();
    }
}
