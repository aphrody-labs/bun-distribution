// SPDX-License-Identifier: Apache-2.0
//! `ModelFactory` — turns a resolved [`Config`](aphrody_config::Config) into an
//! [`Arc<dyn ModelClient>`](aphrody_model_client::ModelClient).
//!
//! Handles provider dispatch:
//! - Antigravity (`wire_api = "antigravity"`): resolves token from Credential Manager
//! - OpenAI-compatible (`wire_api = "responses"` | `"chat"`): `OpenAiCompatClient` configured with
//!   base_url, headers, query parameters, retries, and timeouts.
//! - Anthropic (`wire_api = "anthropic"`): `AnthropicClient` on the Messages API, authenticated
//!   with the provider's `env_key` (`ANTHROPIC_API_KEY`) or an `ANTHROPIC_AUTH_TOKEN` OAuth token.

use std::{sync::Arc, time::Duration};

use aphrody_config::{Config, WireApi};
use aphrody_model_client::{
    AnthropicAuth, AnthropicClient, ModelCapabilities, ModelClient, OpenAiCompatClient, OpenAiWire,
    ProviderRuntime, TurnOptions,
};

#[path = "repair.rs"]
mod repair;
use repair::RepairingModelClient;

use crate::error::RuntimeError;

/// Factory for instantiating model clients from configuration.
pub struct ModelFactory;

impl ModelFactory {
    /// Build an active [`ModelClient`] from the resolved [`Config`].
    ///
    /// # Errors
    ///
    /// Returns [`RuntimeError::Config`] if the requested provider is missing
    /// required parameters or credentials cannot be resolved.
    pub fn build(config: &Config) -> Result<Arc<dyn ModelClient>, RuntimeError> {
        let _ = rustls::crypto::ring::default_provider().install_default();

        let provider_id = &config.provider.id;
        let info = &config.provider.info;
        let model_id = config
            .model
            .clone()
            .unwrap_or_else(|| aphrody_models::LocalRole::Chat.default_model().to_string());

        match info.wire_api {
            WireApi::Antigravity => {
                // `from_credential_manager` resolves the token on every host:
                // the Windows Credential Manager entry `gemini:antigravity`,
                // or the `agy` / `aphrody antigravity login` token files on
                // Unix. A missing store surfaces as `SdkError::Unsupported`.
                use aphrody_model_antigravity::AntigravityModelClient;
                let client =
                    aphrody_antigravity::client::AntigravityClient::from_credential_manager()
                        .map_err(|e| {
                            RuntimeError::Config(format!("failed to load Antigravity token: {e}"))
                        })?;
                Ok(Arc::new(AntigravityModelClient::new(client, model_id)))
            }
            WireApi::Responses | WireApi::Chat => {
                let wire = match info.wire_api {
                    WireApi::Responses => OpenAiWire::Responses,
                    _ => OpenAiWire::Chat,
                };
                let runtime = provider_runtime(config, provider_id, info)?;
                let client: Arc<dyn ModelClient> =
                    Arc::new(OpenAiCompatClient::from_provider(runtime, wire, model_id));
                if info.managed.is_some()
                    || matches!(
                        provider_id.as_str(),
                        "llama" | "ollama" | "lmstudio" | "vllm"
                    )
                {
                    Ok(Arc::new(RepairingModelClient::new(client)))
                } else {
                    Ok(client)
                }
            }
            WireApi::Anthropic => {
                let runtime = provider_runtime(config, provider_id, info)?;
                if runtime.bearer_token.is_none() {
                    let hint = info.env_key.as_deref().unwrap_or("ANTHROPIC_API_KEY");
                    return Err(RuntimeError::Config(format!(
                        "provider `{provider_id}` needs a credential: set `{hint}` (API key) or \
                         `ANTHROPIC_AUTH_TOKEN` (OAuth token from `ant auth login`)"
                    )));
                }
                let auth = if anthropic_uses_oauth(info) {
                    AnthropicAuth::Bearer
                } else {
                    AnthropicAuth::ApiKey
                };
                Ok(Arc::new(
                    AnthropicClient::from_provider(runtime, model_id).with_auth(auth),
                ))
            }
        }
    }
}

/// Whether the Anthropic credential resolved for `info` is an OAuth token
/// (`ANTHROPIC_AUTH_TOKEN`) rather than an API key.
///
/// The key wins when both are set, mirroring the official SDKs' resolution
/// order.
fn anthropic_uses_oauth(info: &aphrody_config::ModelProviderInfo) -> bool {
    let key_present = info.api_key_file.is_some()
        || info
            .env_key
            .as_deref()
            .and_then(|key| std::env::var(key).ok())
            .is_some_and(|value| !value.trim().is_empty());
    !key_present
        && std::env::var("ANTHROPIC_AUTH_TOKEN").is_ok_and(|value| !value.trim().is_empty())
}

/// Resolve the credential for a provider: explicit file, then `env_key`, then for Anthropic
/// the OAuth token variable the official SDKs also honour.
fn provider_credential(
    info: &aphrody_config::ModelProviderInfo,
) -> Result<Option<String>, RuntimeError> {
    if let Some(path) = &info.api_key_file {
        return aphrody_config::credential_file::read_credential_file(std::path::Path::new(path))
            .map(Some)
            .map_err(|error| RuntimeError::Config(error.to_string()));
    }
    let from_env_key = info
        .env_key
        .as_ref()
        .and_then(|key| std::env::var(key).ok())
        .filter(|value| !value.trim().is_empty());
    if from_env_key.is_some() {
        return Ok(from_env_key);
    }
    if info.wire_api == WireApi::Anthropic {
        return Ok(std::env::var("ANTHROPIC_AUTH_TOKEN")
            .ok()
            .filter(|value| !value.trim().is_empty()));
    }
    Ok(None)
}

/// Assemble the transport runtime (endpoint, credential, headers, retries,
/// timeouts, capabilities, decoding defaults) shared by every HTTP wire.
fn provider_runtime(
    config: &Config,
    provider_id: &str,
    info: &aphrody_config::ModelProviderInfo,
) -> Result<ProviderRuntime, RuntimeError> {
    let base_url = info.base_url.clone().filter(|url| !url.trim().is_empty()).ok_or_else(|| {
        RuntimeError::Config(format!(
            "provider `{provider_id}` has no base_url; prepare its managed runtime or configure \
             an endpoint"
        ))
    })?;

    let bearer_token = provider_credential(info)?;

    let headers = info
        .http_headers
        .as_ref()
        .map(|h| h.iter().map(|(k, v)| (k.clone(), v.clone())).collect())
        .unwrap_or_default();

    let query_params = info
        .query_params
        .as_ref()
        .map(|q| q.iter().map(|(k, v)| (k.clone(), v.clone())).collect())
        .unwrap_or_default();

    let request_max_retries = u32::try_from(info.request_max_retries.unwrap_or(4)).unwrap_or(4);
    let stream_idle_timeout = Duration::from_millis(info.stream_idle_timeout_ms.unwrap_or(300_000));

    let context_window = config
        .model_context_window
        .and_then(|w| u64::try_from(w).ok());

    let capabilities = ModelCapabilities {
        tools: true,
        parallel_tool_calls: true,
        images: true,
        reasoning: true,
        json_schema: true,
        context_window,
    };

    let default_options = TurnOptions {
        reasoning_effort: config.model_reasoning_effort.clone(),
        ..TurnOptions::default()
    };

    Ok(ProviderRuntime {
        base_url,
        bearer_token,
        headers,
        query_params,
        request_max_retries,
        stream_idle_timeout,
        capabilities,
        default_options,
    })
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;

    use aphrody_config::{
        CliOverrides, ConfigLayer, LayerSource, builtin_providers_layer_value, resolve,
    };

    use super::*;

    #[test]
    fn explicit_missing_file_never_falls_back_to_another_credential() {
        let info = aphrody_config::ModelProviderInfo {
            api_key_file: Some("missing-credential-file".into()),
            env_key: Some("PATH".into()),
            ..Default::default()
        };
        assert!(provider_credential(&info).is_err());
    }

    #[test]
    fn managed_llama_requires_a_prepared_endpoint() {
        let env = |_: &str| None;
        let builtins = ConfigLayer::new(LayerSource::Builtin, builtin_providers_layer_value(&env));
        let (config, _) = resolve(
            vec![builtins],
            &CliOverrides::default(),
            "llama",
            &BTreeMap::new(),
        )
        .expect("resolve");

        assert!(
            ModelFactory::build(&config)
                .err()
                .expect("missing endpoint")
                .to_string()
                .contains("no base_url")
        );
        let mut ready = config;
        ready.provider.info.base_url = Some("http://127.0.0.1:43210/v1".into());
        let client = ModelFactory::build(&ready).expect("prepared provider");
        assert!(client.capabilities().tools);
        ready.provider.info.base_url = Some("   ".into());
        assert!(ModelFactory::build(&ready).is_err());
    }
}
