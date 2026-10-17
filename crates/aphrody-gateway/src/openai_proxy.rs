// SPDX-License-Identifier: Apache-2.0
//! BYOK ("Bring Your Own Key") OpenAI-compatible proxy adapter.
//!
//! This is the minimal-env fallback: it posts to any configurable
//! OpenAI-compatible endpoint (OpenAI itself, Azure OpenAI, Together AI,
//! Groq, Ollama, LM Studio, …) without routing through a third-party gateway.
//!
//! Configuration is env-keyed for 12-factor compatibility:
//!
//! | Env var              | Purpose                                        | Default                              |
//! |----------------------|------------------------------------------------|--------------------------------------|
//! | `OPENAI_API_KEY`     | Bearer token                                   | *(required)*                         |
//! | `OPENAI_BASE_URL`    | Base URL of the OpenAI-compatible API          | `https://api.openai.com`             |
//!
//! From the open-design README: "OpenAI-compatible BYOK proxy is the same loop
//! minus the spawn."  This adapter is intentionally the simplest of the three.

use std::env;

use reqwest::Client;
use serde::{Deserialize, Serialize};
use url::Url;

use crate::{ChatRequest, ChatResponse, ChunkStream, GatewayAdapter, GatewayError, openai_compat};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/// Default base URL when `OPENAI_BASE_URL` is not set.
pub const DEFAULT_BASE_URL: &str = "https://api.openai.com";

/// Chat completions path.
const CHAT_PATH: &str = "/v1/chat/completions";

/// Env var for the API key.
pub const ENV_API_KEY: &str = "OPENAI_API_KEY";

/// Env var for the base URL override.
pub const ENV_BASE_URL: &str = "OPENAI_BASE_URL";

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

/// BYOK OpenAI-compatible proxy.
///
/// Construct via [`OpenAiProxyAdapter::new`] or [`OpenAiProxyAdapter::from_env`].
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OpenAiProxyAdapter {
    /// API key sent as `Authorization: Bearer <api_key>`.
    pub api_key: String,

    /// Base URL of the OpenAI-compatible service.  Defaults to
    /// `https://api.openai.com`.
    pub base_url: String,

    /// HTTP client shared across requests.
    #[serde(skip)]
    client: Option<Client>,
}

impl OpenAiProxyAdapter {
    /// Constructs an adapter with an explicit key and base URL.
    pub fn new(
        api_key: impl Into<String>,
        base_url: impl Into<String>,
    ) -> Result<Self, GatewayError> {
        let api_key = api_key.into();
        let base_url = base_url.into();
        if api_key.trim().is_empty() {
            return Err(GatewayError::Config(
                "OpenAiProxyAdapter: api_key must not be blank".to_owned(),
            ));
        }
        if base_url.trim().is_empty() {
            return Err(GatewayError::Config(
                "OpenAiProxyAdapter: base_url must not be blank".to_owned(),
            ));
        }
        // Validate immediately so callers get a clear error at construction
        // time rather than at the first network call.
        Url::parse(&base_url)?;
        Ok(Self {
            api_key,
            base_url,
            client: Some(Client::new()),
        })
    }

    /// Constructs an adapter from environment variables.
    ///
    /// - `OPENAI_API_KEY` — required.
    /// - `OPENAI_BASE_URL` — optional, defaults to `https://api.openai.com`.
    pub fn from_env() -> Result<Self, GatewayError> {
        let api_key = env::var(ENV_API_KEY).map_err(|_| {
            GatewayError::Config(format!("OpenAiProxyAdapter: env var {ENV_API_KEY} not set"))
        })?;
        let base_url = env::var(ENV_BASE_URL).unwrap_or_else(|_| DEFAULT_BASE_URL.to_owned());
        Self::new(api_key, base_url)
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
impl GatewayAdapter for OpenAiProxyAdapter {
    async fn health_check(&self) -> Result<(), GatewayError> {
        let mut models_url = Url::parse(&self.base_url)?;
        let base_path = models_url.path().trim_end_matches('/');
        let models_path = if base_path.ends_with("/v1") {
            format!("{base_path}/models")
        } else if base_path.is_empty() {
            "/v1/models".to_owned()
        } else {
            format!("{base_path}/v1/models")
        };
        models_url.set_path(&models_path);
        let response = self
            .http_client()
            .get(models_url)
            .bearer_auth(&self.api_key)
            .timeout(std::time::Duration::from_secs(3))
            .send()
            .await?;
        if !response.status().is_success() {
            let status = response.status().as_u16();
            return Err(GatewayError::UpstreamStatus {
                status,
                body: String::new(),
            });
        }
        Ok(())
    }

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
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    /// Install the rustls `ring` `CryptoProvider` once for the test process —
    /// `OpenAiProxyAdapter::new` builds a `reqwest::Client`, and rustls 0.23+
    /// panics `No provider set` without an installed default provider.
    fn install_rustls_provider() {
        use std::sync::Once;
        static ONCE: Once = Once::new();
        ONCE.call_once(|| {
            let _ = rustls::crypto::ring::default_provider().install_default();
        });
    }

    async fn models_server(status: &'static str) -> String {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind");
        let addr = listener.local_addr().expect("addr");
        tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.expect("accept");
            let mut request = Vec::new();
            let mut chunk = [0_u8; 1024];
            while !request.windows(4).any(|window| window == b"\r\n\r\n") {
                let count = socket.read(&mut chunk).await.expect("read");
                assert!(count > 0 && request.len() + count <= 8192);
                request.extend_from_slice(&chunk[..count]);
            }
            let request = String::from_utf8(request).expect("request headers");
            assert!(request.starts_with("GET /v1/models HTTP/1.1\r\n"));
            assert!(
                request
                    .lines()
                    .any(|line| line.eq_ignore_ascii_case("authorization: Bearer probe-key"))
            );
            let response =
                format!("HTTP/1.1 {status}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
            socket.write_all(response.as_bytes()).await.expect("write");
        });
        format!("http://{addr}/v1")
    }

    #[tokio::test]
    async fn readiness_probe_checks_upstream_models_with_credentials() {
        install_rustls_provider();
        let base = models_server("200 OK").await;
        let adapter = OpenAiProxyAdapter::new("probe-key", base).expect("adapter");
        adapter.health_check().await.expect("upstream is ready");
    }

    #[tokio::test]
    async fn readiness_probe_rejects_unavailable_upstream() {
        install_rustls_provider();
        let base = models_server("503 Service Unavailable").await;
        let adapter = OpenAiProxyAdapter::new("probe-key", base).expect("adapter");
        assert!(adapter.health_check().await.is_err());
    }

    #[test]
    fn endpoint_url_default_base() {
        install_rustls_provider();
        let adapter = OpenAiProxyAdapter::new("sk-test", DEFAULT_BASE_URL).expect("construct");
        let url = adapter.endpoint_url().expect("url");
        assert_eq!(url.as_str(), "https://api.openai.com/v1/chat/completions");
    }

    #[test]
    fn endpoint_url_custom_base() {
        install_rustls_provider();
        let adapter =
            OpenAiProxyAdapter::new("sk-test", "http://localhost:11434").expect("construct");
        let url = adapter.endpoint_url().expect("url");
        assert_eq!(url.as_str(), "http://localhost:11434/v1/chat/completions");
    }

    #[test]
    fn blank_api_key_rejected() {
        let err = OpenAiProxyAdapter::new("", DEFAULT_BASE_URL).unwrap_err();
        assert!(matches!(err, GatewayError::Config(_)));
    }

    #[test]
    fn blank_base_url_rejected() {
        let err = OpenAiProxyAdapter::new("key", "").unwrap_err();
        assert!(matches!(err, GatewayError::Config(_)));
    }

    #[test]
    fn invalid_base_url_rejected() {
        let err = OpenAiProxyAdapter::new("key", "://invalid").unwrap_err();
        // Either a URL parse error or a config error; both are acceptable.
        assert!(matches!(
            err,
            GatewayError::Url(_) | GatewayError::Config(_)
        ));
    }
}
