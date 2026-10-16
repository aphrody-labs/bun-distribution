// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 aphrody contributors

//! Transports for the MCP client protocol.

use std::time::Duration;

use async_trait::async_trait;
use serde_json::Value as JsonValue;

use crate::error::Result;

pub mod http;

#[cfg(not(target_arch = "wasm32"))]
pub mod stdio;

/// An active transport layer communicating with an MCP server.
#[cfg_attr(target_arch = "wasm32", async_trait(?Send))]
#[cfg_attr(not(target_arch = "wasm32"), async_trait)]
pub trait Transport: Send + Sync {
    /// Send a JSON-RPC request and wait for the response payload.
    async fn call(
        &mut self,
        method: &str,
        params: JsonValue,
        timeout_dur: Duration,
    ) -> Result<JsonValue>;

    /// Send a JSON-RPC notification (fire and forget).
    async fn notify(&mut self, method: &str, params: JsonValue) -> Result<()>;

    /// Shut down the transport and terminate any child process.
    async fn shutdown(&mut self) -> Result<()>;
}
