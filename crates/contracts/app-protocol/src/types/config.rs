// SPDX-License-Identifier: Apache-2.0
//! Configuration inspection and update types.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};

/// Parameters for `config/read`.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigReadParams {
    /// Optional thread id to layer thread-scoped configuration.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub thread_id: Option<String>,
}

/// Response returned by `config/read`.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigReadResponse {
    /// Resolved configuration map (compatible with upstream codex config).
    pub config: HashMap<String, serde_json::Value>,
    /// Source file path where global config was loaded from.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub config_path: Option<String>,
}

/// Response returned by `config/value/write` or `config/batchWrite`.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigWriteResponse {
    pub success: bool,
}
