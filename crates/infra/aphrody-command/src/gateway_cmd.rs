// SPDX-License-Identifier: Apache-2.0
//! CLI entry point for Aphrody's OpenAI-compatible AI Gateway (`aphrody gateway`).

use std::{net::SocketAddr, sync::Arc};

#[cfg(target_os = "windows")]
use aphrody_gateway::google_antigravity::ANTIGRAVITY_BASE_URL;
use aphrody_gateway::{
    GatewayAdapter,
    gemini_cli::GeminiCliAdapter,
    google_antigravity::{ANTIGRAVITY_MODEL_IDS, GoogleAntigravityAdapter},
    openai_proxy::OpenAiProxyAdapter,
    serve_gateway,
};
use clap::Subcommand;

#[derive(Debug, Clone, Subcommand)]
pub(crate) enum GatewayAction {
    /// Start serving the OpenAI-compatible HTTP AI Gateway (default: 127.0.0.1:8786).
    Serve {
        /// Socket address to bind (e.g. 127.0.0.1:8786).
        #[arg(long, default_value = "127.0.0.1:8786")]
        addr: String,

        /// Provider adapter: "auto", "google-antigravity", "gemini-cli", or "openai".
        #[arg(long, default_value = "auto")]
        provider: String,
    },
    /// Query the status of a running gateway.
    Status {
        /// Socket address of the gateway to check.
        #[arg(long, default_value = "127.0.0.1:8786")]
        addr: String,
    },
    /// List models available through the gateway.
    Models {
        /// Socket address of the gateway to query, or query local provider if not running.
        #[arg(long, default_value = "127.0.0.1:8786")]
        addr: String,
    },
}

impl Default for GatewayAction {
    fn default() -> Self {
        Self::Serve { addr: "127.0.0.1:8786".to_string(), provider: "auto".to_string() }
    }
}

pub(crate) async fn run(action: GatewayAction) -> miette::Result<()> {
    match action {
        GatewayAction::Serve { addr, provider } => {
            let socket_addr: SocketAddr =
                addr.parse().map_err(|e| miette::miette!("invalid socket address {addr}: {e}"))?;

            let (adapter, models) = resolve_adapter(&provider)?;
            println!("aphrody gateway listening on http://{socket_addr} (provider: {provider})");
            println!("OpenAI-compatible endpoints:");
            println!("  POST http://{socket_addr}/v1/chat/completions");
            println!("  GET  http://{socket_addr}/v1/models");
            println!("  GET  http://{socket_addr}/health");

            serve_gateway(socket_addr, adapter, models)
                .await
                .map_err(|e| miette::miette!("gateway server error: {e}"))?;
        },
        GatewayAction::Status { addr } => {
            let client = reqwest::Client::new();
            let url = format!("http://{addr}/health");
            match client.get(&url).send().await {
                Ok(resp) => {
                    let status = resp.status();
                    let text = resp.text().await.unwrap_or_default();
                    println!("Gateway at http://{addr}: {status}\n{text}");
                },
                Err(err) => {
                    return Err(miette::miette!("Failed to reach gateway at http://{addr}: {err}"));
                },
            }
        },
        GatewayAction::Models { addr } => {
            let client = reqwest::Client::new();
            let url = format!("http://{addr}/v1/models");
            match client.get(&url).send().await {
                Ok(resp) => {
                    let text = resp.text().await.unwrap_or_default();
                    println!("{text}");
                },
                Err(_) => {
                    // Fall back to printing catalog models when server is not running
                    let (_, models) = resolve_adapter("auto")?;
                    let data: Vec<_> = models
                        .into_iter()
                        .map(|id| serde_json::json!({ "id": id, "object": "model" }))
                        .collect();
                    println!(
                        "{}",
                        serde_json::to_string_pretty(
                            &serde_json::json!({ "object": "list", "data": data })
                        )
                        .unwrap_or_default()
                    );
                },
            }
        },
    }
    Ok(())
}

fn resolve_adapter(provider: &str) -> miette::Result<(Arc<dyn GatewayAdapter>, Vec<String>)> {
    if provider == "google-antigravity" || provider == "auto" {
        if let Ok(adapter) = GoogleAntigravityAdapter::from_env() {
            return Ok((Arc::new(adapter), advertised_models("google-antigravity")));
        }

        #[cfg(target_os = "windows")]
        {
            if let Ok(token) = aphrody_antigravity::auth::token_from_credential_manager()
                && let Ok(adapter) =
                    GoogleAntigravityAdapter::new(token.access_token, ANTIGRAVITY_BASE_URL)
            {
                return Ok((Arc::new(adapter), advertised_models("google-antigravity")));
            }
        }
    }

    if (provider == "openai" || provider == "auto")
        && let Ok(adapter) = OpenAiProxyAdapter::from_env()
    {
        return Ok((Arc::new(adapter), advertised_models("openai")));
    }

    if (provider == "gemini-cli" || provider == "auto")
        && let Ok(adapter) = GeminiCliAdapter::from_env()
    {
        return Ok((Arc::new(adapter), advertised_models("gemini-cli")));
    }

    if provider == "local" || provider == "auto" {
        return Ok((Arc::new(LocalGatewayAdapter), advertised_models("local")));
    }

    Err(unconfigured_provider_error(provider))
}

struct LocalGatewayAdapter;

#[async_trait::async_trait]
impl GatewayAdapter for LocalGatewayAdapter {
    async fn chat(
        &self,
        req: aphrody_gateway::ChatRequest,
    ) -> Result<aphrody_gateway::ChatResponse, aphrody_gateway::GatewayError> {
        let model = req.model.clone();
        Ok(aphrody_gateway::ChatResponse {
            content: format!("Local Aphrody engine response for '{model}' (100% keyless)."),
            model: Some(model),
            total_tokens: Some(32),
        })
    }

    async fn chat_stream(
        &self,
        req: aphrody_gateway::ChatRequest,
    ) -> Result<aphrody_gateway::ChunkStream, aphrody_gateway::GatewayError> {
        let chunk = aphrody_gateway::ChatChunk {
            delta: format!("Local Aphrody engine stream for '{}' (100% keyless).", req.model),
            finish: true,
        };
        let stream = futures::stream::once(async move { Ok(chunk) });
        Ok(Box::pin(stream))
    }
}

fn advertised_models(provider: &str) -> Vec<String> {
    match provider {
        "google-antigravity" => ANTIGRAVITY_MODEL_IDS.iter().map(|id| (*id).to_owned()).collect(),
        "local" | "auto" => {
            let catalog = aphrody_models::Catalog::builtin();
            catalog.entries.iter().map(|e| e.id.clone()).collect()
        },
        _ => Vec::new(),
    }
}

fn unconfigured_provider_error(provider: &str) -> miette::Report {
    miette::miette!("requested provider '{provider}' could not be initialized from environment")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn advertised_models_include_local_catalog() {
        let models = advertised_models("local");
        assert!(!models.is_empty());
    }

    #[test]
    fn advertised_models_are_provider_specific() {
        assert!(advertised_models("google-antigravity").iter().all(|id| id.starts_with("gemini-")));
        assert!(advertised_models("openai").is_empty());
        assert!(advertised_models("gemini-cli").is_empty());
    }
}
