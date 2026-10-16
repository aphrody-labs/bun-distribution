// SPDX-License-Identifier: Apache-2.0
use serde::{Deserialize, Serialize};

/// Authoritative database used by one Home Agent profile.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DatabaseType {
    /// `PostgreSQL`, including a remote `PostgreSQL`/pgvector authority.
    Postgres,
    /// A local `SQLite` database.
    Sqlite,
}

/// Optional local cache paired with the authoritative database.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DatabaseCache {
    /// `SQLite` configured for write-ahead logging.
    SqliteWal,
}

/// `[database]` — database authority and its profile-local cache.
///
/// URLs may be written directly for local endpoints. Deployments should use
/// `url_env` for credentials so secrets never enter `config.toml`.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct DatabaseConfig {
    /// Database implementation.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub db_type: Option<DatabaseType>,
    /// Literal database URL. Prefer `url_env` when it contains credentials.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    /// Environment variable holding the database URL.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub url_env: Option<String>,
    /// `PostgreSQL` schema or equivalent logical namespace.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub schema: Option<String>,
    /// Optional local cache implementation.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cache: Option<DatabaseCache>,
    /// Profile-local cache path.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cache_path: Option<String>,
}

/// `plugins = [...]` — plugin roots loaded for one profile.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(transparent)]
pub struct PluginConfig {
    pub paths: Vec<String>,
}

/// `[skills]` — exact skill names made visible to the profile.
///
/// An empty whitelist exposes no profile-selected skills.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct SkillsConfig {
    #[serde(default)]
    pub whitelist: Vec<String>,
}

/// `[a2a]` — profile identity and file mailbox endpoints.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct A2aConfig {
    /// Stable A2A agent identity.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    /// Inbox JSONL path.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mailbox: Option<String>,
    /// Optional outbox JSONL path.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub outbox: Option<String>,
}

/// OCR engines supported by Aphrody's native pipeline.
///
/// Serialised as the `aphrody-models` catalog id of the default variant, so a
/// `[ocr].engines` entry can be pasted straight from `aphrody model list` /
/// `aphrody model pull`. The historical, pre-catalog names (`pp-ocr-v5`,
/// `dots.ocr-3b`) are still accepted on read via `alias`, so a `config.toml`
/// written before the catalog existed keeps parsing unchanged.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum OcrEngine {
    /// PP-OCRv5 through ONNX Runtime. Serialised as the catalog id of the
    /// default (mobile) variant; `pp-ocr-v5` is the accepted legacy alias.
    #[serde(rename = "ppocr-v5-mobile", alias = "pp-ocr-v5")]
    PpOcrV5,
    /// Granite Docling 258M through llama.cpp. Already a catalog id.
    #[serde(rename = "granite-docling-258m")]
    GraniteDocling258m,
    /// dots.ocr through llama.cpp. Serialised as the catalog id; `dots.ocr-3b`
    /// is the accepted legacy alias.
    #[serde(rename = "dots-ocr", alias = "dots.ocr-3b")]
    DotsOcr3b,
}

/// `[ocr]` — ordered OCR engine policy and profile-local state.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct OcrConfig {
    /// Engines in preference order.
    #[serde(default)]
    pub engines: Vec<OcrEngine>,
    /// State/audit directory isolated to this profile.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub state_path: Option<String>,
}

/// `[redis]` — profile-local Redis database and key namespace.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct RedisConfig {
    /// Redis URL, including the logical database number.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    /// Prefix prepended to every key owned by this profile.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub prefix: Option<String>,
}

/// `[agent_home]` — where the Agent Homes of this machine live.
///
/// `homes_dir` overrides the default homes root (`<state>/workspaces`). A
/// relative value is resolved against the state directory. The environment
/// variable `APHRODY_HOMES_DIR` wins over this key (see
/// `aphrody_agent_home::homes`).
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct AgentHomeConfig {
    /// Root directory holding one subdirectory per home.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub homes_dir: Option<String>,
}

impl AgentHomeConfig {
    /// Extract the `[agent_home]` table from a raw `config.toml` value.
    /// Returns `None` when the table is absent or malformed.
    #[must_use]
    pub fn from_toml(root: &toml::Value) -> Option<Self> {
        root.get("agent_home")
            .cloned()
            .and_then(|v| v.try_into().ok())
    }
}

#[cfg(test)]
#[path = "home_agent_tests.rs"]
mod home_agent_tests;
