// SPDX-License-Identifier: Apache-2.0
use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use crate::wire_api::WireApi;

/// Effective maximum request retries when a provider does not override it.
///
/// Mirrors `openai/codex` `codex-rs/model-provider-info/src/lib.rs`
/// `DEFAULT_REQUEST_MAX_RETRIES`.
pub const DEFAULT_REQUEST_MAX_RETRIES: u64 = 4;

/// Effective maximum stream reconnection attempts when a provider does not
/// override it. Mirrors upstream `DEFAULT_STREAM_MAX_RETRIES`.
pub const DEFAULT_STREAM_MAX_RETRIES: u64 = 5;

/// Effective streaming idle timeout, in milliseconds, when a provider does
/// not override it. Mirrors upstream `DEFAULT_STREAM_IDLE_TIMEOUT_MS`
/// (`300_000` ms = 300 s).
pub const DEFAULT_STREAM_IDLE_TIMEOUT_MS: u64 = 300_000;

/// A locally supervised inference runtime backing a `model_provider` entry.
///
/// Only `llama-server` exists today (the `aphrody-llama-server` supervisor,
/// P2 in `docs/plans/codex-oss.md`); the enum leaves room for future managed
/// runtimes without a breaking config shape change.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ManagedRuntime {
    /// Managed by `aphrody-llama-server`'s `Supervisor` (attach-or-spawn).
    LlamaServer,
}

/// Definition of a single model provider, as it appears under
/// `[model_providers.<id>]` or is synthesized for a built-in id.
///
/// Mirrors `openai/codex` `codex-rs/model-provider-info/src/lib.rs`
/// `ModelProviderInfo`, trimmed to the fields aphrody's HTTP client
/// (`openai_compat.rs`, P1) actually consumes. All optional fields use
/// `Option` so that a partial user-defined table, merged onto a built-in at
/// the TOML layer (see [`crate::layer`]), only overrides what it names.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct ModelProviderInfo {
    /// Friendly display name.
    #[serde(default)]
    pub name: String,
    /// Base URL for the provider's OpenAI-compatible (or native) API.
    /// Already includes any API version segment (e.g. `.../v1`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub base_url: Option<String>,
    /// Environment variable holding the API key or bearer token.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub env_key: Option<String>,
    /// Protected host file containing the upstream bearer credential.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub api_key_file: Option<String>,
    /// Human-readable instructions for obtaining/setting `env_key`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub env_key_instructions: Option<String>,
    /// Discouraged: a literal bearer token embedded in config. Prefer
    /// `env_key`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub experimental_bearer_token: Option<String>,
    /// Wire protocol this provider expects. Defaults to
    /// [`WireApi::Chat`] because most of aphrody's default providers speak
    /// OpenAI-compatible chat completions.
    #[serde(default)]
    pub wire_api: WireApi,
    /// Extra query parameters appended to every request URL.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub query_params: Option<BTreeMap<String, String>>,
    /// Extra static HTTP headers.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub http_headers: Option<BTreeMap<String, String>>,
    /// Extra HTTP headers whose values are read from named environment
    /// variables at request time. An unset or empty variable omits the
    /// header rather than sending an empty value.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub env_http_headers: Option<BTreeMap<String, String>>,
    /// Maximum HTTP request retries. Effective value via
    /// [`ModelProviderInfo::request_max_retries`].
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub request_max_retries: Option<u64>,
    /// Maximum stream reconnection attempts. Effective value via
    /// [`ModelProviderInfo::stream_max_retries`].
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stream_max_retries: Option<u64>,
    /// Idle timeout, in milliseconds, before a streaming response is treated
    /// as lost. Effective value via
    /// [`ModelProviderInfo::stream_idle_timeout_ms`].
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stream_idle_timeout_ms: Option<u64>,
    /// Whether this provider requires OpenAI/ChatGPT login-token auth rather
    /// than a plain API key.
    #[serde(default)]
    pub requires_openai_auth: bool,
    /// When set, this provider is a locally supervised runtime rather than a
    /// remote HTTP endpoint the caller connects to directly.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub managed: Option<ManagedRuntime>,
}

impl ModelProviderInfo {
    /// Effective maximum number of HTTP request retries.
    #[must_use]
    pub fn request_max_retries(&self) -> u64 {
        self.request_max_retries
            .unwrap_or(DEFAULT_REQUEST_MAX_RETRIES)
    }

    /// Effective maximum number of stream reconnection attempts.
    #[must_use]
    pub fn stream_max_retries(&self) -> u64 {
        self.stream_max_retries
            .unwrap_or(DEFAULT_STREAM_MAX_RETRIES)
    }

    /// Effective idle timeout, in milliseconds, for streaming responses.
    #[must_use]
    pub fn stream_idle_timeout_ms(&self) -> u64 {
        self.stream_idle_timeout_ms
            .unwrap_or(DEFAULT_STREAM_IDLE_TIMEOUT_MS)
    }
}

fn oss_base_url(env: &dyn Fn(&str) -> Option<String>, default_port: u16) -> String {
    if let Some(base_url) = env("APHRODY_OSS_BASE_URL").filter(|v| !v.trim().is_empty()) {
        return base_url;
    }
    if let Some(base_url) = env("CODEX_OSS_BASE_URL").filter(|v| !v.trim().is_empty()) {
        return base_url;
    }
    let port = env("APHRODY_OSS_PORT")
        .filter(|v| !v.trim().is_empty())
        .or_else(|| env("CODEX_OSS_PORT").filter(|v| !v.trim().is_empty()))
        .and_then(|v| v.parse::<u16>().ok())
        .unwrap_or(default_port);
    format!("http://localhost:{port}/v1")
}

/// Builds the built-in provider catalog.
///
/// `env` is injected (rather than reading `std::env` directly) so the
/// function stays pure and unit-testable; the caller passes
/// `&|key| std::env::var(key).ok()` in production. Mirrors
/// `openai/codex` `codex-rs/model-provider-info/src/lib.rs`
/// `built_in_model_providers` / `create_oss_provider`, extended with
/// aphrody's managed `llama` runtime, `antigravity` (keyless), and
/// `anthropic`.
#[must_use]
pub fn builtin_providers(
    env: &dyn Fn(&str) -> Option<String>,
) -> BTreeMap<String, ModelProviderInfo> {
    let mut providers = BTreeMap::new();

    providers.insert(
        "llama".to_string(),
        ModelProviderInfo {
            name: "Managed llama-server".to_string(),
            // Resolved at runtime by the `aphrody-llama-server` supervisor
            // once it has picked a free port; left unset here.
            base_url: None,
            wire_api: WireApi::Chat,
            managed: Some(ManagedRuntime::LlamaServer),
            ..ModelProviderInfo::default()
        },
    );

    providers.insert(
        "ollama".to_string(),
        ModelProviderInfo {
            name: "Ollama".to_string(),
            base_url: Some(oss_base_url(env, 11434)),
            wire_api: WireApi::Chat,
            ..ModelProviderInfo::default()
        },
    );

    providers.insert(
        "lmstudio".to_string(),
        ModelProviderInfo {
            name: "LM Studio".to_string(),
            base_url: Some("http://localhost:1234/v1".to_string()),
            wire_api: WireApi::Chat,
            ..ModelProviderInfo::default()
        },
    );

    providers.insert(
        "vllm".to_string(),
        ModelProviderInfo {
            name: "vLLM".to_string(),
            base_url: Some(
                crate::ai_env::CHAT_BASE_URL
                    .resolve_with(env)
                    .unwrap_or_else(|| "http://localhost:8000/v1".to_owned()),
            ),
            // Store the selected variable's name; the model factory reads its
            // protected value at request time. No secret enters config.toml.
            env_key: crate::ai_env::CHAT_API_KEY
                .resolve_source_with(env)
                .map(str::to_owned),
            wire_api: WireApi::Chat,
            ..ModelProviderInfo::default()
        },
    );

    providers.insert(
        "antigravity".to_string(),
        ModelProviderInfo {
            name: "Google Antigravity".to_string(),
            base_url: None,
            wire_api: WireApi::Antigravity,
            // Keyless: identity comes from the Antigravity desktop app's
            // credential store, never a `config.toml` secret.
            ..ModelProviderInfo::default()
        },
    );

    providers.insert(
        "chatgpt".to_string(),
        ModelProviderInfo {
            name: "ChatGPT".to_string(),
            base_url: Some("https://chatgpt.com/backend-api/codex".to_string()),
            wire_api: WireApi::Responses,
            requires_openai_auth: true,
            ..ModelProviderInfo::default()
        },
    );

    providers.insert(
        "openai".to_string(),
        ModelProviderInfo {
            name: "OpenAI".to_string(),
            base_url: Some("https://api.openai.com/v1".to_string()),
            wire_api: WireApi::Responses,
            env_key: Some("OPENAI_API_KEY".to_string()),
            ..ModelProviderInfo::default()
        },
    );

    providers.insert(
        "anthropic".to_string(),
        ModelProviderInfo {
            name: "Anthropic".to_string(),
            base_url: Some("https://api.anthropic.com/v1".to_string()),
            wire_api: WireApi::Anthropic,
            env_key: Some("ANTHROPIC_API_KEY".to_string()),
            ..ModelProviderInfo::default()
        },
    );

    providers
}

/// Serializes the built-in provider catalog into a `{ model_providers = {...} }`
/// TOML table, suitable as the value of the lowest-priority
/// [`crate::layer::ConfigLayer`] (`LayerSource::Builtin`).
///
/// # Panics
///
/// Never panics for the catalog returned by [`builtin_providers`]: every
/// field is either a primitive, a `String`, or a `BTreeMap<String, String>`,
/// all of which `toml` can represent.
#[must_use]
pub fn builtin_providers_layer_value(env: &dyn Fn(&str) -> Option<String>) -> toml::Value {
    let mut providers_table = toml::value::Table::new();
    for (id, info) in builtin_providers(env) {
        let value = toml::Value::try_from(&info)
            .unwrap_or_else(|err| panic!("builtin provider {id} must serialize to TOML: {err}"));
        providers_table.insert(id, value);
    }
    let mut root = toml::value::Table::new();
    root.insert(
        "model_providers".to_string(),
        toml::Value::Table(providers_table),
    );
    toml::Value::Table(root)
}

#[cfg(test)]
#[path = "provider_tests.rs"]
mod provider_tests;
