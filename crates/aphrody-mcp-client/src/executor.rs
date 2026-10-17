// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 aphrody contributors

//! [`aphrody_toolcall::ToolExecutor`] implementation for MCP server tools.

use aphrody_toolcall::{
    ToolDefinition, ToolError, ToolExecutor, ToolExposure, ToolImage, ToolOutput, ToolSafety,
};
use async_trait::async_trait;
use serde_json::Value as JsonValue;
use tracing::debug;

use crate::{
    client::McpClientHandle,
    protocol::{McpContent, McpTool},
    schema::mcp_schema_to_toolcall_schema,
};

/// An adapter wrapping a single MCP server tool into an [`aphrody_toolcall::ToolExecutor`].
pub struct McpToolExecutor {
    definition: ToolDefinition,
    client: McpClientHandle,
    upstream_tool_name: String,
    server_name: String,
    safety: ToolSafety,
}

impl McpToolExecutor {
    /// Create a new executor for an MCP tool.
    #[must_use]
    pub fn new(
        server_name: impl Into<String>,
        upstream_name: impl Into<String>,
        exposed_name: impl Into<String>,
        description: impl Into<String>,
        schema: &JsonValue,
        client: McpClientHandle,
        exposure: ToolExposure,
    ) -> Self {
        let input_schema = mcp_schema_to_toolcall_schema(schema);
        let definition =
            ToolDefinition::new(exposed_name, description, input_schema).with_exposure(exposure);

        Self {
            definition,
            client,
            upstream_tool_name: upstream_name.into(),
            server_name: server_name.into(),
            safety: ToolSafety::Safe,
        }
    }

    /// Build an executor directly from an [`McpTool`] descriptor advertised by an MCP server.
    ///
    /// By default, the exposed tool name is `mcp__{server}__{name}` to avoid collisions.
    #[must_use]
    pub fn from_mcp_tool(
        server_name: &str,
        tool: &McpTool,
        client: McpClientHandle,
        exposure: ToolExposure,
    ) -> Self {
        let exposed_name = format!("mcp__{server_name}__{}", tool.name);
        let desc = tool
            .description
            .clone()
            .unwrap_or_else(|| format!("Tool `{}` from MCP server `{server_name}`", tool.name));

        Self::new(
            server_name,
            &tool.name,
            exposed_name,
            desc,
            &tool.input_schema,
            client,
            exposure,
        )
    }

    /// Build an executor with a custom alias name (e.g. `web_search` instead of
    /// `mcp__bxc__bxc_search`).
    #[must_use]
    pub fn with_alias(
        server_name: &str,
        upstream_name: &str,
        alias_name: &str,
        description: &str,
        schema: &JsonValue,
        client: McpClientHandle,
        exposure: ToolExposure,
    ) -> Self {
        Self::new(
            server_name,
            upstream_name,
            alias_name,
            description,
            schema,
            client,
            exposure,
        )
    }

    /// Configure a custom pre-execution safety level for this tool.
    #[must_use]
    pub fn with_safety(mut self, safety: ToolSafety) -> Self {
        self.safety = safety;
        self
    }

    /// Upstream tool name on the remote MCP server.
    #[must_use]
    pub fn upstream_name(&self) -> &str {
        &self.upstream_tool_name
    }

    /// Name of the remote MCP server providing this tool.
    #[must_use]
    pub fn server_name(&self) -> &str {
        &self.server_name
    }
}

#[cfg_attr(target_arch = "wasm32", async_trait(?Send))]
#[cfg_attr(not(target_arch = "wasm32"), async_trait)]
impl ToolExecutor for McpToolExecutor {
    fn definition(&self) -> &ToolDefinition {
        &self.definition
    }

    async fn handle(&self, arguments: JsonValue) -> Result<ToolOutput, ToolError> {
        debug!(
            tool = self.definition.name,
            upstream = self.upstream_tool_name,
            server = self.server_name,
            "Executing MCP tool call"
        );

        let result = self
            .client
            .call_tool(&self.upstream_tool_name, arguments)
            .await
            .map_err(|err| ToolError::Execution {
                tool: self.definition.name.clone(),
                message: err.to_string(),
            })?;

        let mut text_parts = Vec::new();
        let mut images = Vec::new();
        if let Some(structured) = &result.structured_content {
            text_parts.push(structured.to_string());
        }

        for item in result.content {
            match item {
                McpContent::Text { text } => {
                    text_parts.push(text);
                }
                McpContent::Image { data, mime_type } => {
                    images.push(ToolImage::new(mime_type, data));
                }
                McpContent::Resource {
                    uri,
                    mime_type,
                    text,
                } => {
                    let mut res_desc = String::new();
                    if let Some(u) = uri {
                        res_desc.push_str(&format!("Resource: {u}"));
                    }
                    if let Some(mt) = mime_type {
                        res_desc.push_str(&format!(" ({mt})"));
                    }
                    if let Some(t) = text {
                        res_desc.push_str(&format!("\n{t}"));
                    }
                    text_parts.push(res_desc);
                }
            }
        }

        let mut content = text_parts.join("\n");
        if content.is_empty() && !images.is_empty() {
            content = format!("(Tool returned {} image payload(s))", images.len());
        }

        let is_error = result.is_error.unwrap_or(false);
        if is_error {
            Ok(ToolOutput::error(content).with_images(images))
        } else {
            Ok(ToolOutput::ok(content).with_images(images))
        }
    }

    fn safety(&self, _arguments: &JsonValue) -> ToolSafety {
        self.safety
    }
}
