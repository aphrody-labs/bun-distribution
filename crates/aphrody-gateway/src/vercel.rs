// SPDX-License-Identifier: Apache-2.0
//! Vercel AI Gateway adapter.
//!
//! Proxies OpenAI-compatible chat completions through the Vercel AI Gateway:
//!
//! ```text
//! POST https://ai-gateway.vercel.sh/v1/chat/completions
//! Authorization: Bearer <api_key>
//! Content-Type: application/json
//! ```
//!
//! Reference (upstream TS): `openclaw/extensions/vercel-ai-gateway/`.
//! The gateway base URL is confirmed by `models.ts`:
//! `VERCEL_AI_GATEWAY_BASE_URL = "https://ai-gateway.vercel.sh"`.

use std::env;

use reqwest::Client;
use serde::{Deserialize, Serialize};
use url::Url;

use crate::{ChatRequest, ChatResponse, ChunkStream, GatewayAdapter, GatewayError, openai_compat};

// ---------------------------------------------------------------------------
// Constants (mirrors upstream `models.ts`)
// ---------------------------------------------------------------------------

/// Default Vercel AI Gateway base URL.
pub const VERCEL_GATEWAY_BASE_URL: &str = "https://ai-gateway.vercel.sh";

/// Chat completions path relative to the base URL.
const CHAT_PATH: &str = "/v1/chat/completions";

/// Environment variable name for the API key (mirrors the TS plugin).
pub const ENV_API_KEY: &str = "AI_GATEWAY_API_KEY";

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

/// Vercel AI Gateway adapter.
///
/// Construct via [`VercelAdapter::new`] or [`VercelAdapter::from_env`].
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VercelAdapter {
    /// Vercel AI Gateway API key.
    pub api_key: String,

    /// Gateway base URL.  Defaults to [`VERCEL_GATEWAY_BASE_URL`]; override
    /// for testing or self-hosted deployments.
    pub base_url: String,

    /// HTTP client shared across requests.
    #[serde(skip)]
    client: Option<Client>,
}

impl VercelAdapter {
    /// Constructs an adapter pointing at the default Vercel AI Gateway.
    pub fn new(api_key: impl Into<String>) -> Result<Self, GatewayError> {
        Self::with_base_url(api_key, VERCEL_GATEWAY_BASE_URL)
    }

    /// Constructs an adapter pointing at a custom base URL (useful for tests
    /// that spin up a mock server).
    pub fn with_base_url(
        api_key: impl Into<String>,
        base_url: impl Into<String>,
    ) -> Result<Self, GatewayError> {
        let api_key = api_key.into();
        let base_url = base_url.into();
        if api_key.trim().is_empty() {
            return Err(GatewayError::Config(
                "VercelAdapter: api_key must not be blank".to_owned(),
            ));
        }
        if base_url.trim().is_empty() {
            return Err(GatewayError::Config(
                "VercelAdapter: base_url must not be blank".to_owned(),
            ));
        }
        // Validate the base URL parses.
        Url::parse(&base_url)?;
        Ok(Self {
            api_key,
            base_url,
            client: Some(Client::new()),
        })
    }

    /// Constructs an adapter from the `AI_GATEWAY_API_KEY` environment
    /// variable, using the default Vercel gateway base URL.
    pub fn from_env() -> Result<Self, GatewayError> {
        let api_key = env::var(ENV_API_KEY).map_err(|_| {
            GatewayError::Config(format!("VercelAdapter: env var {ENV_API_KEY} not set"))
        })?;
        Self::new(api_key)
    }

    /// Returns the full chat completions URL.
    pub fn endpoint_url(&self) -> Result<Url, GatewayError> {
        let base = Url::parse(&self.base_url)?;
        Ok(base.join(CHAT_PATH)?)
    }

    fn http_client(&self) -> Client {
        self.client.clone().unwrap_or_default()
    }
}

#[async_trait::async_trait]
impl GatewayAdapter for VercelAdapter {
    async fn chat(&self, req: ChatRequest) -> Result<ChatResponse, GatewayError> {
        openai_compat::chat(
            &self.http_client(),
            self.endpoint_url()?,
            &self.api_key,
            req,
        )
        .await
    }

    async fn chat_stream(&self, req: ChatRequest) -> Result<ChunkStream, GatewayError> {
        openai_compat::chat_stream(
            &self.http_client(),
            self.endpoint_url()?,
            &self.api_key,
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
    /// `VercelAdapter::new` builds a `reqwest::Client`, and rustls 0.23+ panics
    /// `No provider set` without an installed default provider.
    fn install_rustls_provider() {
        use std::sync::Once;
        static ONCE: Once = Once::new();
        ONCE.call_once(|| {
            let _ = rustls::crypto::ring::default_provider().install_default();
        });
    }

    #[test]
    fn endpoint_url_default() {
        install_rustls_provider();
        let adapter = VercelAdapter::new("key123").expect("construct");
        let url = adapter.endpoint_url().expect("url");
        assert_eq!(
            url.as_str(),
            "https://ai-gateway.vercel.sh/v1/chat/completions"
        );
    }

    #[test]
    fn endpoint_url_custom_base() {
        install_rustls_provider();
        let adapter =
            VercelAdapter::with_base_url("key", "http://localhost:9090").expect("construct");
        let url = adapter.endpoint_url().expect("url");
        assert_eq!(url.as_str(), "http://localhost:9090/v1/chat/completions");
    }

    #[test]
    fn blank_api_key_rejected() {
        let err = VercelAdapter::new("").unwrap_err();
        assert!(matches!(err, GatewayError::Config(_)));
    }

    #[test]
    fn invalid_base_url_rejected() {
        let err = VercelAdapter::with_base_url("key", "not a url !!").unwrap_err();
        assert!(matches!(err, GatewayError::Url(_)));
    }
}
