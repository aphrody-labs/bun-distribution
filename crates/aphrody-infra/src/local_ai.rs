// SPDX-License-Identifier: Apache-2.0
//! Typed access to `tools/aphrody/config/local-ai.json`, the local/open-source AI contract
//! (capabilities, canonical env names and aliases, targets, consumers).
//!
//! Included by `validate` so the library and the binary share one definition.

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;
use std::fs;
use std::path::Path;

/// `tools/aphrody/config/local-ai.json`: how every repository reaches the local AI stack.
///
/// Unknown fields are rejected so a typo in the contract fails validation
/// instead of silently dropping a rule.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LocalAiContract {
    pub schema_version: u32,
    pub name: String,
    pub owner: String,
    pub description: String,
    pub generated: Option<Value>,
    pub model_authority: Option<Value>,
    pub resolution: LocalAiResolution,
    #[serde(default)]
    pub managed_services: BTreeMap<String, LocalAiManagedService>,
    #[serde(default)]
    pub binaries: BTreeMap<String, LocalAiBinary>,
    #[serde(default)]
    pub gateways: BTreeMap<String, LocalAiEndpoint>,
    pub capabilities: BTreeMap<String, LocalAiEndpoint>,
    #[serde(default)]
    pub indexes: BTreeMap<String, LocalAiIndex>,
    pub targets: BTreeMap<String, LocalAiTarget>,
    #[serde(default)]
    pub consumers: BTreeMap<String, LocalAiConsumer>,
    #[serde(default)]
    pub forbidden: Vec<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LocalAiResolution {
    pub precedence: Vec<String>,
    pub alias_policy: String,
    /// URL form id (`base`, `origin`, `endpoint`) to its definition.
    pub url_forms: BTreeMap<String, String>,
}

/// A service whose listeners are started on demand (dynamic ports), as
/// opposed to a systemd unit of `infra/config/service-catalog.json`.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LocalAiManagedService {
    pub owner: String,
    pub daemon: Option<String>,
    pub runtime: Option<String>,
    pub ports: String,
    pub discovery: String,
    pub hosts: Vec<String>,
    pub note: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LocalAiBinary {
    pub source_repo: String,
    pub package: String,
    #[serde(default)]
    pub build_features: Vec<String>,
    #[serde(default)]
    pub lookup: Vec<String>,
    pub env: Vec<LocalAiEnv>,
}

/// One canonical environment variable and the legacy names it replaces.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LocalAiEnv {
    pub canonical: String,
    /// `url`, `secret`, `model`, `dimensions` or `path`.
    pub kind: String,
    /// URL form of the canonical value (required for `url`).
    pub form: Option<String>,
    #[serde(default)]
    pub aliases: Vec<String>,
    /// Aliases whose value uses another URL form than the canonical one.
    #[serde(default)]
    pub alias_forms: BTreeMap<String, String>,
}

/// A capability (`chat`, `embed`, ...) or a gateway (`ai-http`).
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LocalAiEndpoint {
    /// `openai-compatible`, `aphrody-rest`, `cli` or `mcp-stdio`.
    pub protocol: String,
    /// Catalog service id or managed service id (network protocols).
    pub service: Option<String>,
    /// Binary id (process protocols).
    pub binary: Option<String>,
    pub base_path: Option<String>,
    /// Capability whose base URL this one shares.
    pub base_url_from: Option<String>,
    #[serde(default)]
    pub operations: Vec<String>,
    pub command: Option<String>,
    pub tool: Option<String>,
    #[serde(default)]
    pub build_features: Vec<String>,
    pub auth: Option<String>,
    /// `false` when the capability is only served by a remote provider.
    pub local: Option<bool>,
    pub default_model: Option<String>,
    pub dimensions: Option<u32>,
    #[serde(default)]
    pub env: Vec<LocalAiEnv>,
    pub server_env: Option<String>,
    pub note: Option<String>,
}

/// A persisted vector index, pinned to the embedding space it was built in.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LocalAiIndex {
    pub owner: String,
    pub read_through: Option<String>,
    pub store: String,
    /// Model catalog id.
    pub model: String,
    /// Model name sent on the wire.
    pub served_model: String,
    pub quantization: Option<String>,
    pub dimensions: u32,
    pub service: String,
    pub preprocessing: Option<Value>,
    pub rule: String,
    pub on_mismatch: String,
    pub note: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LocalAiTarget {
    /// `static` (values below) or `runtime` (printed by `resolver`).
    pub resolution: String,
    pub topology_host: String,
    pub resolver: Option<String>,
    #[serde(default)]
    pub services: Vec<String>,
    #[serde(default)]
    pub bindings: BTreeMap<String, LocalAiBinding>,
    #[serde(default)]
    pub unavailable: BTreeMap<String, String>,
    pub note: Option<String>,
    /// `retired` when every catalog service this target binds to has been
    /// decommissioned; the bindings stay as the redeploy recipe.
    pub status: Option<String>,
    pub retired_at: Option<String>,
}

impl LocalAiTarget {
    #[must_use]
    pub fn is_retired(&self) -> bool {
        self.status.as_deref() == Some("retired")
    }
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LocalAiBinding {
    pub service: String,
    pub index: Option<String>,
    #[serde(default)]
    pub env: BTreeMap<String, String>,
    /// Operator-managed file holding the secret values (never the values).
    pub secrets_from: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LocalAiConsumer {
    pub uses: Vec<String>,
    #[serde(default)]
    pub indexes: Vec<String>,
    pub reads_today: Vec<String>,
    #[serde(default)]
    pub surfaces: Vec<String>,
    pub migration: String,
}

impl LocalAiContract {
    /// Every env entry with the id of the binary, gateway or capability that
    /// owns it.
    pub fn env_entries(&self) -> impl Iterator<Item = (&str, &LocalAiEnv)> {
        let binaries = self
            .binaries
            .iter()
            .flat_map(|(id, b)| b.env.iter().map(move |e| (id.as_str(), e)));
        let endpoints = self
            .gateways
            .iter()
            .chain(&self.capabilities)
            .flat_map(|(id, c)| c.env.iter().map(move |e| (id.as_str(), e)));
        binaries.chain(endpoints)
    }

    /// Gateway or capability by id.
    #[must_use]
    pub fn endpoint(&self, id: &str) -> Option<&LocalAiEndpoint> {
        self.gateways.get(id).or_else(|| self.capabilities.get(id))
    }
}

pub fn load_local_ai(root: &Path) -> Result<LocalAiContract> {
    let path = root.join("tools/aphrody/config/local-ai.json");
    let content =
        fs::read_to_string(&path).with_context(|| format!("lecture de {}", path.display()))?;
    serde_json::from_str(&content).with_context(|| format!("désérialisation de {}", path.display()))
}
