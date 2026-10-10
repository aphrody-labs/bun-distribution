// SPDX-License-Identifier: Apache-2.0
//! Common handshake, initialization, and policy types.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};

/// Client identification provided during handshake.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientInfo {
    /// Client application name (e.g. "vscode", "codex-cli", "antigravity").
    pub name: String,
    /// Client application version string.
    pub version: String,
    /// Optional user-visible client title.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
}

/// Client-declared capabilities negotiated during `initialize`.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InitializeCapabilities {
    /// Opt into experimental API methods and fields.
    #[serde(default)]
    pub experimental_api: bool,
    /// Opt into `attestation/generate` requests.
    #[serde(default)]
    pub request_attestation: bool,
    /// Suppressed notification methods for this connection.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub opt_out_notification_methods: Option<Vec<String>>,
    /// Client-declared MCP or custom extensions.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub extensions: Option<HashMap<String, serde_json::Value>>,
    /// Aphrody-specific extended capabilities (RAG, Llama-server, Training).
    #[serde(default)]
    pub aphrody: bool,
}

/// Parameters for the `initialize` method.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InitializeParams {
    /// Client application info.
    pub client_info: ClientInfo,
    /// Client capabilities declaration.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub capabilities: Option<InitializeCapabilities>,
}

/// Response returned by the server on `initialize`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InitializeResponse {
    /// Server user agent identifier.
    pub user_agent: String,
    /// Absolute path to the server's root state/home directory.
    pub codex_home: String,
    /// Host platform family ("unix" or "windows").
    pub platform_family: String,
    /// Host operating system ("windows", "linux", "macos").
    pub platform_os: String,
    /// Server-supported capabilities.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub capabilities: Option<HashMap<String, serde_json::Value>>,
}

/// Authentication mode.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AuthMode {
    /// Direct API key.
    ApiKey,
    /// ChatGPT managed session.
    Chatgpt,
    /// Request headers token.
    Headers,
    /// Anonymous or open-source local inference (no cloud auth required).
    #[serde(rename = "oss")]
    Oss,
}

/// Policy for requesting human approval before tool or command execution.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum AskForApproval {
    /// Always prompt for approval.
    Always,
    /// Prompt on failure.
    OnFailure,
    /// Prompt on explicit tool request.
    OnRequest,
    /// Never prompt for approval (YOLO / autonomous mode).
    #[default]
    Never,
}

/// OS-level sandbox isolation mode.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum SandboxMode {
    /// Disallow any sandboxing / direct host execution.
    #[serde(rename = "danger-full-access", alias = "dangerously-bypass")]
    DangerouslyBypass,
    /// Read-only access to the filesystem.
    ReadOnly,
    /// Writable access restricted to workspace roots.
    #[default]
    WorkspaceWrite,
}

/// Reasoning effort level requested from the model.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ReasoningEffort {
    None,
    Low,
    Medium,
    High,
}
