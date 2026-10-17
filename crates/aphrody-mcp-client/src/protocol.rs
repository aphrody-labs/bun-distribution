// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 aphrody contributors

//! Model Context Protocol (MCP) JSON-RPC 2.0 wire types and frame codecs.

use serde::{Deserialize, Serialize};
use serde_json::Value as JsonValue;

use crate::error::{McpClientError, Result};

/// Default protocol version advertised during the initialize handshake.
pub const MCP_PROTOCOL_VERSION: &str = "2024-11-05";

/// Client identification sent in `initialize`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ClientInfo {
    /// Name of this client.
    pub name: String,
    /// Version of this client.
    pub version: String,
}

impl Default for ClientInfo {
    fn default() -> Self {
        Self {
            name: "aphrody-mcp-client".to_owned(),
            version: env!("CARGO_PKG_VERSION").to_owned(),
        }
    }
}

/// Client capabilities declared in `initialize`.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct ClientCapabilities {
    /// Roots capability.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub roots: Option<JsonValue>,
    /// Sampling capability.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sampling: Option<JsonValue>,
    /// Experimental capabilities.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub experimental: Option<JsonValue>,
}

/// Parameters for the `initialize` method.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InitializeParams {
    /// The MCP protocol version the client wishes to speak.
    pub protocol_version: String,
    /// Client capabilities.
    pub capabilities: ClientCapabilities,
    /// Client info.
    pub client_info: ClientInfo,
}

impl Default for InitializeParams {
    fn default() -> Self {
        Self {
            protocol_version: MCP_PROTOCOL_VERSION.to_owned(),
            capabilities: ClientCapabilities::default(),
            client_info: ClientInfo::default(),
        }
    }
}

/// Information about the connected MCP server, returned by `initialize`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerInfo {
    /// Server display name.
    pub name: String,
    /// Server version string.
    #[serde(default = "default_server_version")]
    pub version: String,
    /// Capabilities advertised by the server.
    #[serde(default)]
    pub capabilities: JsonValue,
    /// Protocol version negotiated.
    #[serde(default = "default_protocol_version")]
    pub protocol_version: String,
}

fn default_server_version() -> String {
    "0.0.0".to_owned()
}

fn default_protocol_version() -> String {
    MCP_PROTOCOL_VERSION.to_owned()
}

/// A tool advertised by an MCP server via `tools/list`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpTool {
    /// Tool identifier (used in `tools/call`).
    pub name: String,
    /// Human-readable description shown to the model.
    #[serde(default)]
    pub description: Option<String>,
    /// JSON-Schema describing the expected `arguments` object.
    #[serde(default = "default_input_schema")]
    pub input_schema: JsonValue,
}

fn default_input_schema() -> JsonValue {
    serde_json::json!({
        "type": "object"
    })
}

/// Content items returned within a `tools/call` response.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum McpContent {
    /// Plain text or markdown payload.
    Text {
        /// Textual content.
        text: String,
    },
    /// Base64 encoded binary image.
    Image {
        /// Raw base64 data string (no `data:` prefix).
        data: String,
        /// Media MIME type (`image/png`, `image/jpeg`, etc.).
        #[serde(rename = "mimeType")]
        mime_type: String,
    },
    /// An embedded or referenced resource.
    Resource {
        /// URI of the resource.
        #[serde(default)]
        uri: Option<String>,
        /// Optional MIME type.
        #[serde(rename = "mimeType", default, skip_serializing_if = "Option::is_none")]
        mime_type: Option<String>,
        /// Optional embedded text content.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        text: Option<String>,
    },
}

/// Result returned from `tools/call`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CallToolResult {
    /// Content parts returned by the tool.
    #[serde(default)]
    pub content: Vec<McpContent>,
    /// Whether the tool execution resulted in an error.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub is_error: Option<bool>,
    /// Structured result retained independently of display text.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub structured_content: Option<JsonValue>,
    /// Opaque result metadata for callers forwarding upstream output.
    #[serde(rename = "_meta", default, skip_serializing_if = "Option::is_none")]
    pub meta: Option<JsonValue>,
}

impl CallToolResult {
    /// Extract all textual content joined with newlines.
    #[must_use]
    pub fn text_content(&self) -> String {
        let mut parts = Vec::new();
        for item in &self.content {
            match item {
                McpContent::Text { text } => parts.push(text.as_str()),
                McpContent::Resource {
                    text: Some(text), ..
                } => parts.push(text.as_str()),
                McpContent::Resource { uri: Some(uri), .. } => parts.push(uri.as_str()),
                _ => {}
            }
        }
        parts.join("\n")
    }

    /// Check if this result indicates an error.
    #[must_use]
    pub fn is_error(&self) -> bool {
        self.is_error.unwrap_or(false)
    }
}

// ---------------------------------------------------------------------------
// Wire-level JSON-RPC 2.0 helpers
// ---------------------------------------------------------------------------

/// Build a minimal JSON-RPC 2.0 request frame with `id`.
#[must_use]
pub fn jsonrpc_request(id: u64, method: &str, params: JsonValue) -> String {
    serde_json::json!({
        "jsonrpc": "2.0",
        "id": id,
        "method": method,
        "params": params,
    })
    .to_string()
}

/// Build a minimal JSON-RPC 2.0 notification frame (no `id`).
#[must_use]
pub fn jsonrpc_notification(method: &str, params: JsonValue) -> String {
    serde_json::json!({
        "jsonrpc": "2.0",
        "method": method,
        "params": params,
    })
    .to_string()
}

/// Extract the `result` field from a JSON-RPC 2.0 response text, or return
/// [`McpClientError::JsonRpc`].
pub fn parse_response(text: &str) -> Result<JsonValue> {
    let v: JsonValue = serde_json::from_str(text)
        .map_err(|e| McpClientError::Malformed(format!("invalid JSON: {e}; raw={text}")))?;
    if let Some(err) = v.get("error") {
        let code = err.get("code").and_then(JsonValue::as_i64).unwrap_or(0);
        let message = err
            .get("message")
            .and_then(JsonValue::as_str)
            .unwrap_or("unknown error")
            .to_owned();
        let data = err.get("data").cloned();
        return Err(McpClientError::JsonRpc {
            code,
            message,
            data,
        });
    }
    v.get("result")
        .cloned()
        .ok_or_else(|| McpClientError::Malformed(format!("missing `result` field: {text}")))
}

/// Parse a `tools/list` result into a list of [`McpTool`].
pub fn parse_tools_list(result: &JsonValue) -> Result<Vec<McpTool>> {
    let tools_arr = result
        .get("tools")
        .and_then(JsonValue::as_array)
        .ok_or_else(|| McpClientError::Malformed(format!("missing `tools` array: {result}")))?;
    let mut out = Vec::with_capacity(tools_arr.len());
    for raw in tools_arr {
        let tool: McpTool = serde_json::from_value(raw.clone()).map_err(|e| {
            McpClientError::Malformed(format!("malformed tool entry: {e}; raw={raw}"))
        })?;
        out.push(tool);
    }
    Ok(out)
}

/// Parse an `initialize` result into [`ServerInfo`].
pub fn parse_server_info(result: &JsonValue) -> Result<ServerInfo> {
    let server_info = result
        .get("serverInfo")
        .ok_or_else(|| McpClientError::Malformed(format!("missing `serverInfo`: {result}")))?;
    let name = server_info
        .get("name")
        .and_then(JsonValue::as_str)
        .unwrap_or("unknown")
        .to_owned();
    let version = server_info
        .get("version")
        .and_then(JsonValue::as_str)
        .unwrap_or("0.0.0")
        .to_owned();
    let capabilities = result
        .get("capabilities")
        .cloned()
        .unwrap_or(JsonValue::Null);
    let protocol_version = result
        .get("protocolVersion")
        .and_then(JsonValue::as_str)
        .unwrap_or(MCP_PROTOCOL_VERSION)
        .to_owned();
    Ok(ServerInfo {
        name,
        version,
        capabilities,
        protocol_version,
    })
}

/// Parse a `tools/call` result into [`CallToolResult`].
pub fn parse_call_tool_result(result: &JsonValue) -> Result<CallToolResult> {
    // MCP embeds resource data under `resource`, whereas older callers used
    // the flattened shape. Normalize text resources; binary resources must
    // use the raw API rather than silently disappearing from the answer.
    let mut normalized = result.clone();
    if let Some(items) = normalized
        .get_mut("content")
        .and_then(JsonValue::as_array_mut)
    {
        for item in items {
            if item.get("type").and_then(JsonValue::as_str) == Some("resource")
                && let Some(resource) = item.get("resource")
            {
                if resource.get("blob").is_some() {
                    return Err(McpClientError::Malformed(
                        "binary resource requires call_tool_raw".to_owned(),
                    ));
                }
                let uri = resource
                    .get("uri")
                    .and_then(JsonValue::as_str)
                    .ok_or_else(|| {
                        McpClientError::Malformed("embedded resource is missing uri".to_owned())
                    })?;
                *item = serde_json::json!({"type":"resource","uri":uri,"text":resource.get("text"),"mimeType":resource.get("mimeType")});
            }
        }
    }
    let result = &normalized;
    // If the result already matches CallToolResult schema:
    if let Ok(res) = serde_json::from_value::<CallToolResult>(result.clone())
        && (!res.content.is_empty() || res.is_error.is_some())
    {
        return Ok(res);
    }

    // Fallback: if result has a direct "content" array:
    if let Some(content_val) = result.get("content").and_then(JsonValue::as_array) {
        let mut content = Vec::new();
        for item in content_val {
            if let Ok(c) = serde_json::from_value::<McpContent>(item.clone()) {
                content.push(c);
            } else if let Some(s) = item.as_str() {
                content.push(McpContent::Text { text: s.to_owned() });
            } else {
                return Err(McpClientError::Malformed(
                    "unsupported or malformed MCP content block; use call_tool_raw to preserve it"
                        .to_owned(),
                ));
            }
        }
        let is_error = result.get("isError").and_then(JsonValue::as_bool);
        return Ok(CallToolResult {
            content,
            is_error,
            structured_content: result.get("structuredContent").cloned(),
            meta: result.get("_meta").cloned(),
        });
    }

    // Fallback: raw JSON value as a single text item:
    let text = if let Some(s) = result.as_str() {
        s.to_owned()
    } else {
        result.to_string()
    };
    Ok(CallToolResult {
        content: vec![McpContent::Text { text }],
        ..CallToolResult::default()
    })
}
