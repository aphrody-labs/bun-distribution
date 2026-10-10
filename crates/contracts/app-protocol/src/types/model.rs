// SPDX-License-Identifier: Apache-2.0
//! Model listing and capability discovery types.

use serde::{Deserialize, Serialize};

/// Parameters for `model/list`.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelListParams {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cursor: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub limit: Option<u32>,
}

/// Description of a single model available to the agent.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelDetails {
    /// Canonical model identifier (e.g. "qwen2.5-coder-7b-instruct-q5km", "gemini-3-flash").
    pub id: String,
    /// Display name.
    pub name: String,
    /// Model provider (e.g. "llama", "antigravity", "openai").
    pub provider: String,
    /// Maximum context window in tokens.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub context_window: Option<u64>,
    /// Whether the model supports vision/multimodal input.
    #[serde(default)]
    pub supports_vision: bool,
    /// Whether the model supports native function/tool calling.
    #[serde(default)]
    pub supports_tools: bool,
    /// Whether this is a local open-source model.
    #[serde(default)]
    pub is_local: bool,
}

/// Response returned by `model/list`.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelListResponse {
    pub models: Vec<ModelDetails>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub next_cursor: Option<String>,
}
