// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 aphrody contributors

//! Typed errors for the MCP client and tool adapter.

use std::path::PathBuf;

use thiserror::Error;

/// Result type alias for MCP client operations.
pub type Result<T, E = McpClientError> = std::result::Result<T, E>;

/// Errors produced by [`crate::McpClient`] and its adapters.
#[derive(Debug, Error)]
pub enum McpClientError {
    /// Spawning the child process failed (stdio transport only).
    #[error("failed to spawn MCP server `{command}`: {source}")]
    Spawn {
        /// The command that failed to spawn.
        command: String,
        /// The underlying I/O error.
        #[source]
        source: std::io::Error,
    },

    /// The child process exposed no usable stdin or stdout handle.
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

    /// The HTTP MCP endpoint returned a non-2xx status.
    #[error("HTTP MCP endpoint returned status {status}: {body}")]
    HttpStatus {
        /// HTTP status code.
        status: u16,
        /// Response body (truncated to 1 KiB).
        body: String,
    },

    /// A configured HTTP header name or value is not valid. The value is never
    /// included, so a malformed secret cannot leak through the error text.
    #[error("invalid MCP HTTP header `{name}`")]
    InvalidHeader {
        /// Name of the offending header.
        name: String,
    },

    /// A header value is sourced from an environment variable that is unset or
    /// empty. Callers that resolve `${VAR}` placeholders fail closed with this
    /// error instead of connecting without the credential.
    #[error("MCP HTTP header `{name}` requires environment variable `{variable}`")]
    MissingHeaderEnvironment {
        /// Name of the header that needs the secret.
        name: String,
        /// Environment variable expected to hold the value.
        variable: String,
    },

    /// JSON-RPC server returned an error envelope.
    #[error("JSON-RPC error {code}: {message}")]
    JsonRpc {
        /// Error code from the JSON-RPC response.
        code: i64,
        /// Human-readable error message.
        message: String,
        /// Optional structured error data.
        data: Option<serde_json::Value>,
    },

    /// Response or frame could not be deserialized.
    #[error("malformed JSON-RPC message: {0}")]
    Malformed(String),

    /// The exchange exceeded the configured timeout.
    #[error("MCP RPC `{method}` timed out after {seconds}s")]
    Timeout {
        /// JSON-RPC method that timed out.
        method: String,
        /// Timeout value in seconds.
        seconds: u64,
    },

    /// Tool call requested before initialize() completed.
    #[error("MCP client must be initialized before calling `{0}`")]
    NotInitialized(&'static str),

    /// Requested tool was not found on the connected MCP server.
    #[error("tool `{0}` not found on MCP server")]
    ToolNotFound(String),

    /// Tool call execution failed upstream.
    #[error("MCP tool `{tool}` failed: {message}")]
    ToolCallFailed {
        /// Name of the tool.
        tool: String,
        /// Error message.
        message: String,
    },

    /// A discovered tool collided with another tool in the target registry.
    #[error("failed to register MCP tool: {0}")]
    ToolRegistration(String),

    /// Stdio transport is unavailable on this target (e.g. wasm32).
    #[error("MCP stdio transport is unavailable on this target")]
    UnsupportedTransport,

    /// Failed to read an image file for `view_image`.
    #[error("failed to load image `{path}`: {message}")]
    ImageLoadError {
        /// Path that failed.
        path: PathBuf,
        /// Error description.
        message: String,
    },
}
