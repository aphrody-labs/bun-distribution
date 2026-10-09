// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 aphrody contributors

//! Built-in `tool_search` tool for dynamic on-demand tool discovery.

use std::sync::Arc;

use aphrody_toolcall::{ToolDefinition, ToolError, ToolExecutor, ToolExposure, ToolOutput};
use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use serde_json::Value as JsonValue;
use tokio::sync::RwLock;

/// Shared searchable registry of tool definitions.
#[derive(Clone, Default)]
pub struct ToolCatalog {
    tools: Arc<RwLock<Vec<ToolDefinition>>>,
}

impl ToolCatalog {
    /// Create a new empty tool catalog.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Add a tool definition to the catalog.
    pub async fn add(&self, def: ToolDefinition) {
        let mut list = self.tools.write().await;
        if !list.iter().any(|t| t.name == def.name) {
            list.push(def);
        }
    }

    /// Add multiple tool definitions.
    pub async fn add_all(&self, defs: impl IntoIterator<Item = ToolDefinition>) {
        let mut list = self.tools.write().await;
        for def in defs {
            if !list.iter().any(|t| t.name == def.name) {
                list.push(def);
            }
        }
    }

    /// Search tools by keyword query.
    pub async fn search(&self, query: &str, limit: usize) -> Vec<ToolSearchResult> {
        let list = self.tools.read().await;
        let terms: Vec<String> = query
            .split_whitespace()
            .map(|t| t.to_ascii_lowercase())
            .filter(|t| !t.is_empty())
            .collect();

        if terms.is_empty() {
            return list.iter().take(limit).map(|t| ToolSearchResult::from_def(t, 0)).collect();
        }

        let mut scored: Vec<(usize, &ToolDefinition)> = list
            .iter()
            .filter_map(|tool| {
                let name_lower = tool.name.to_ascii_lowercase();
                let desc_lower = tool.description.to_ascii_lowercase();

                let mut score = 0;
                for term in &terms {
                    if name_lower.contains(term) {
                        score += 10;
                    }
                    if desc_lower.contains(term) {
                        score += 3;
                    }
                }

                if score > 0 { Some((score, tool)) } else { None }
            })
            .collect();

        // Sort descending by score:
        scored.sort_by_key(|item| std::cmp::Reverse(item.0));

        scored
            .into_iter()
            .take(limit)
            .map(|(score, t)| ToolSearchResult::from_def(t, score))
            .collect()
    }
}

/// A matched tool record returned by `tool_search`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolSearchResult {
    /// Name of the tool.
    pub name: String,
    /// Human description.
    pub description: String,
    /// Schema describing arguments.
    pub input_schema: aphrody_toolcall::JsonSchema,
    /// Exposure tier.
    pub exposure: ToolExposure,
    /// Match score.
    pub score: usize,
}

impl ToolSearchResult {
    fn from_def(def: &ToolDefinition, score: usize) -> Self {
        Self {
            name: def.name.clone(),
            description: def.description.clone(),
            input_schema: def.input_schema.clone(),
            exposure: def.exposure,
            score,
        }
    }
}

/// Built-in tool allowing an agent to search for available tools when needed.
pub struct ToolSearchTool {
    definition: ToolDefinition,
    catalog: ToolCatalog,
}

impl ToolSearchTool {
    /// Create a new `tool_search` tool instance backed by `catalog`.
    #[must_use]
    pub fn new(catalog: ToolCatalog) -> Self {
        let schema = aphrody_toolcall::JsonSchema::object(
            [
                (
                    "query".to_string(),
                    aphrody_toolcall::JsonSchema::string(Some(
                        "Keywords describing the needed tool or task (e.g. 'browser', 'scrape', \
                         'fut', 'wiki', 'google')."
                            .to_string(),
                    )),
                ),
                (
                    "limit".to_string(),
                    aphrody_toolcall::JsonSchema::integer(Some(
                        "Maximum number of tool definitions to return (default: 10).".to_string(),
                    )),
                ),
            ]
            .into_iter()
            .collect(),
            Some(vec!["query".to_string()]),
            None,
        );

        let definition = ToolDefinition::new(
            "tool_search",
            "Search for available tools and their schemas by keyword when the initial toolset \
             does not cover a specific action.",
            schema,
        )
        .with_exposure(ToolExposure::Direct);

        Self { definition, catalog }
    }
}

#[cfg_attr(target_arch = "wasm32", async_trait(?Send))]
#[cfg_attr(not(target_arch = "wasm32"), async_trait)]
impl ToolExecutor for ToolSearchTool {
    fn definition(&self) -> &ToolDefinition {
        &self.definition
    }

    async fn handle(&self, arguments: JsonValue) -> Result<ToolOutput, ToolError> {
        let query = arguments.get("query").and_then(JsonValue::as_str).ok_or_else(|| {
            ToolError::InvalidArguments {
                tool: "tool_search".to_string(),
                message: "missing required argument `query` (string)".to_string(),
            }
        })?;

        let limit =
            arguments.get("limit").and_then(JsonValue::as_u64).map(|n| n as usize).unwrap_or(10);

        let matches = self.catalog.search(query, limit).await;
        let count = matches.len();

        let json_res = serde_json::to_string_pretty(&matches).map_err(|e| {
            ToolError::Execution { tool: "tool_search".to_string(), message: e.to_string() }
        })?;

        let text = format!("Found {count} tool(s) matching `{query}`:\n\n{json_res}");
        Ok(ToolOutput::ok(text))
    }
}
