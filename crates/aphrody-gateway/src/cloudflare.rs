// SPDX-License-Identifier: Apache-2.0
//! Cloudflare AI Gateway adapter.
//!
//! Proxies OpenAI-compatible chat completions through the Cloudflare AI
//! Gateway endpoint:
//!
//! ```text
//! POST https://gateway.ai.cloudflare.com/v1/<account_id>/<gateway_id>/openai/chat/completions
//! Authorization: Bearer <api_token>
//! Content-Type: application/json
//! ```
//!
//! Reference (upstream TS): `openclaw/extensions/cloudflare-ai-gateway/`.

use std::env;

use reqwest::Client;
use serde::{Deserialize, Serialize};
use url::Url;

use crate::{ChatRequest, ChatResponse, ChunkStream, GatewayAdapter, GatewayError, openai_compat};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/// Base URL template before appending `/openai/chat/completions`.
const GATEWAY_BASE: &str = "https://gateway.ai.cloudflare.com/v1";

/// Environment variable name for the API token (mirrors the TS plugin).
pub const ENV_API_TOKEN: &str = "CLOUDFLARE_AI_GATEWAY_API_KEY";

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

/// Cloudflare AI Gateway adapter.
///
/// Construct via [`CloudflareAdapter::new`] or [`CloudflareAdapter::from_env`].
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CloudflareAdapter {
    /// Cloudflare account ID (shown in the dashboard → "Account ID").
    pub account_id: String,

    /// Cloudflare AI Gateway ID (the slug you chose when creating the gateway).
    pub gateway_id: String,

    /// Cloudflare API token with AI Gateway permissions.
    pub api_token: String,

    /// HTTP client shared across requests.
    #[serde(skip)]
    client: Option<Client>,
}

impl CloudflareAdapter {
    /// Constructs an adapter with an explicit token.
    ///
    /// `account_id` and `gateway_id` must both be non-empty.
    pub fn new(
        account_id: impl Into<String>,
        gateway_id: impl Into<String>,
        api_token: impl Into<String>,
    ) -> Result<Self, GatewayError> {
        let account_id = account_id.into();
        let gateway_id = gateway_id.into();
        let api_token = api_token.into();

        if account_id.trim().is_empty() {
            return Err(GatewayError::Config(
                "CloudflareAdapter: account_id must not be blank".to_owned(),
            ));
        }
        if gateway_id.trim().is_empty() {
            return Err(GatewayError::Config(
                "CloudflareAdapter: gateway_id must not be blank".to_owned(),
            ));
        }
        if api_token.trim().is_empty() {
            return Err(GatewayError::Config(
                "CloudflareAdapter: api_token must not be blank".to_owned(),
            ));
        }

        Ok(Self {
            account_id,
            gateway_id,
            api_token,
            client: Some(Client::new()),
        })
    }

    /// Constructs an adapter by reading credentials from environment variables.
    ///
    /// Required env vars:
    /// - `CLOUDFLARE_AI_GATEWAY_API_KEY` — Cloudflare API token.
    /// - `CLOUDFLARE_AI_GATEWAY_ACCOUNT_ID` — Cloudflare account ID.
    /// - `CLOUDFLARE_AI_GATEWAY_GATEWAY_ID` — AI Gateway ID.
    pub fn from_env() -> Result<Self, GatewayError> {
        let api_token = env::var(ENV_API_TOKEN).map_err(|_| {
            GatewayError::Config(format!(
                "CloudflareAdapter: env var {ENV_API_TOKEN} not set"
            ))
        })?;
        let account_id = env::var("CLOUDFLARE_AI_GATEWAY_ACCOUNT_ID").map_err(|_| {
            GatewayError::Config(
                "CloudflareAdapter: env var CLOUDFLARE_AI_GATEWAY_ACCOUNT_ID not set".to_owned(),
            )
        })?;
        let gateway_id = env::var("CLOUDFLARE_AI_GATEWAY_GATEWAY_ID").map_err(|_| {
            GatewayError::Config(
                "CloudflareAdapter: env var CLOUDFLARE_AI_GATEWAY_GATEWAY_ID not set".to_owned(),
            )
        })?;
        Self::new(account_id, gateway_id, api_token)
    }

    /// Returns the full chat completions URL for this adapter.
    pub fn endpoint_url(&self) -> Result<Url, GatewayError> {
        let raw = format!(
            "{}/{}/{}/openai/chat/completions",
            GATEWAY_BASE,
            self.account_id.trim(),
            self.gateway_id.trim(),
        );
        Ok(Url::parse(&raw)?)
    }

    fn http_client(&self) -> Client {
        self.client.clone().unwrap_or_default()
    }
}

#[async_trait::async_trait]
impl GatewayAdapter for CloudflareAdapter {
    async fn chat(&self, req: ChatRequest) -> Result<ChatResponse, GatewayError> {
        openai_compat::chat(
            &self.http_client(),
            self.endpoint_url()?,
            &self.api_token,
            req,
        )
        .await
    }

    async fn chat_stream(&self, req: ChatRequest) -> Result<ChunkStream, GatewayError> {
        openai_compat::chat_stream(
            &self.http_client(),
            self.endpoint_url()?,
            &self.api_token,
            req,
        )
        .await
    }
}

// ---------------------------------------------------------------------------
// Unit tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    /// Install the rustls `ring` `CryptoProvider` once for the test process —
    /// `CloudflareAdapter::new` builds a `reqwest::Client`, and rustls 0.23+
    /// panics `No provider set` without an installed default provider.
    fn install_rustls_provider() {
        use std::sync::Once;
        static ONCE: Once = Once::new();
        ONCE.call_once(|| {
            let _ = rustls::crypto::ring::default_provider().install_default();
        });
    }

    #[test]
    fn endpoint_url_format() {
        install_rustls_provider();
        let adapter = CloudflareAdapter::new("acc123", "gw456", "tok").expect("construct");
        let url = adapter.endpoint_url().expect("url");
        assert_eq!(
            url.as_str(),
            "https://gateway.ai.cloudflare.com/v1/acc123/gw456/openai/chat/completions"
        );
    }

    #[test]
    fn blank_account_id_rejected() {
        let err = CloudflareAdapter::new("", "gw", "tok").unwrap_err();
        assert!(matches!(err, GatewayError::Config(_)));
    }

    #[test]
    fn blank_gateway_id_rejected() {
        let err = CloudflareAdapter::new("acc", "", "tok").unwrap_err();
        assert!(matches!(err, GatewayError::Config(_)));
    }

    #[test]
    fn blank_api_token_rejected() {
        let err = CloudflareAdapter::new("acc", "gw", "").unwrap_err();
        assert!(matches!(err, GatewayError::Config(_)));
    }
}
