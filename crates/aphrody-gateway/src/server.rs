// SPDX-License-Identifier: Apache-2.0
//! HTTP OpenAI-compatible AI Gateway Server.
//!
//! Provides a unified OpenAI-compatible wire API (`/v1/chat/completions`, `/v1/models`)
//! backed by any [`GatewayAdapter`] (Google Antigravity, Gemini CLI, BYOK Anthropic/Gemini,
//! Cloudflare, Vercel, or custom OpenAI proxy).
//!
//! Includes full CORS support for browser frontends (including `aphrody-site` :8083 and Tauri).

use std::{convert::Infallible, net::SocketAddr, sync::Arc};

use axum::{
    Json, Router,
    extract::{Request, State},
    http::{HeaderMap, HeaderValue, Method, StatusCode, header},
    middleware::{self, Next},
    response::{
        IntoResponse, Response,
        sse::{Event, KeepAlive, Sse},
    },
    routing::{get, post},
};
use futures::StreamExt;
use serde::Deserialize;
use serde_json::{Value, json};

use crate::{ChatRequest, GatewayAdapter, GatewayError};

/// Shared state for the gateway HTTP server.
#[derive(Clone)]
pub struct GatewayState {
    pub adapter: Arc<dyn GatewayAdapter>,
    pub model_ids: Vec<String>,
}

/// Request body for `/v1/chat/completions`.
#[derive(Debug, Clone, Deserialize)]
pub struct OpenAiChatCompletionsRequest {
    pub model: String,
    pub messages: Vec<crate::Message>,
    pub temperature: Option<f32>,
    pub max_tokens: Option<u32>,
    #[serde(default)]
    pub stream: bool,
}

/// Check if the given origin is an allowed localhost / loopback origin.
#[must_use]
pub fn is_allowed_origin(origin: &str) -> bool {
    let Ok(parsed) = url::Url::parse(origin) else {
        return false;
    };
    let scheme = parsed.scheme();
    if scheme != "http" && scheme != "https" && scheme != "tauri" {
        return false;
    }
    match parsed.host_str() {
        Some(host) => {
            host == "localhost"
                || host == "127.0.0.1"
                || host == "[::1]"
                || host == "::1"
                || host == "tauri.localhost"
        }
        None => false,
    }
}

/// Attach CORS headers to a header map, allowing only validated localhost origins.
pub fn add_cors_headers(headers: &mut HeaderMap, origin: Option<&HeaderValue>) {
    headers.insert(header::VARY, HeaderValue::from_static("Origin"));
    if let Some(origin_val) = origin
        && let Ok(origin_str) = origin_val.to_str()
        && is_allowed_origin(origin_str)
    {
        headers.insert(header::ACCESS_CONTROL_ALLOW_ORIGIN, origin_val.clone());
        headers.insert(
            header::ACCESS_CONTROL_ALLOW_CREDENTIALS,
            HeaderValue::from_static("true"),
        );
    }
    headers.insert(
        header::ACCESS_CONTROL_ALLOW_METHODS,
        HeaderValue::from_static("GET, POST, OPTIONS, PUT, DELETE"),
    );
    headers.insert(
        header::ACCESS_CONTROL_ALLOW_HEADERS,
        HeaderValue::from_static("Content-Type, Authorization, X-Requested-With, Origin, Accept"),
    );
}

/// Middleware ensuring only localhost origins receive `Access-Control-Allow-Origin`.
async fn cors_middleware(req: Request, next: Next) -> Response {
    let origin = req.headers().get(header::ORIGIN).cloned();
    let mut response = next.run(req).await;
    add_cors_headers(response.headers_mut(), origin.as_ref());
    response
}

/// Resolve the gateway credential, preserving the prior OS alias.
fn gateway_token() -> Result<Option<String>, GatewayError> {
    if let Some(path) = std::env::var_os("APHRODY_AI_HTTP_TOKEN_FILE") {
        return aphrody_config::credential_file::read_credential_file(std::path::Path::new(&path))
            .map(Some)
            .map_err(|error| GatewayError::Config(error.to_string()));
    }
    Ok(aphrody_config::ai_env::HTTP_TOKEN.resolve().or_else(|| {
        std::env::var("APHRODY_OS_AUTH_TOKEN")
            .ok()
            .filter(|token| !token.trim().is_empty())
    }))
}

/// Middleware validating the canonical gateway credential when configured.
async fn auth_middleware(
    State(token): State<Result<Option<String>, ()>>,
    req: Request,
    next: Next,
) -> Response {
    // OPTIONS preflight requests do not carry credentials and must be allowed through
    if req.method() == Method::OPTIONS {
        return next.run(req).await;
    }

    // Health probes remain unauthenticated
    let path = req.uri().path();
    if path == "/health" || path == "/healthz" {
        return next.run(req).await;
    }

    let Ok(token) = token else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(json!({"error":{"message":"protected gateway credential unavailable"}})),
        )
            .into_response();
    };
    if let Some(expected_token) = token {
        let expected_token = expected_token.trim();
        if !expected_token.is_empty() {
            let auth_header = req
                .headers()
                .get(header::AUTHORIZATION)
                .and_then(|val| val.to_str().ok());

            let authorized = match auth_header {
                Some(header_val) => {
                    let trimmed = header_val.trim();
                    if let Some(token) = trimmed.strip_prefix("Bearer ") {
                        token.trim() == expected_token
                    } else if let Some(token) = trimmed.strip_prefix("bearer ") {
                        token.trim() == expected_token
                    } else {
                        false
                    }
                }
                None => false,
            };

            if !authorized {
                return (
                    StatusCode::UNAUTHORIZED,
                    Json(json!({
                        "error": {
                            "message": "Unauthorized: invalid or missing Bearer token",
                            "type": "authentication_error",
                            "code": "invalid_api_key"
                        }
                    })),
                )
                    .into_response();
            }
        }
    }

    next.run(req).await
}

/// Construct the Axum router for the gateway HTTP service.
pub fn router(state: GatewayState) -> Router {
    let token = gateway_token().map_err(|_| ());
    Router::new()
        .route("/health", get(health_handler).options(cors_preflight))
        .route("/healthz", get(health_handler).options(cors_preflight))
        .route("/v1/models", get(models_handler).options(cors_preflight))
        .route(
            "/v1/chat/completions",
            post(chat_completions_handler).options(cors_preflight),
        )
        .layer(middleware::from_fn_with_state(token, auth_middleware))
        .layer(middleware::from_fn(cors_middleware))
        .with_state(state)
}

/// Start serving the gateway over the given loopback address.
pub async fn serve_gateway(
    addr: SocketAddr,
    adapter: Arc<dyn GatewayAdapter>,
    model_ids: Vec<String>,
) -> Result<(), GatewayError> {
    validate_bind(addr, gateway_token()?.as_deref())?;

    let state = GatewayState { adapter, model_ids };
    let app = router(state);
    let listener = tokio::net::TcpListener::bind(addr)
        .await
        .map_err(|e| GatewayError::Config(format!("failed to bind {addr}: {e}")))?;
    axum::serve(listener, app)
        .await
        .map_err(|e| GatewayError::Config(format!("gateway server runtime error: {e}")))?;
    Ok(())
}

fn validate_bind(addr: SocketAddr, token: Option<&str>) -> Result<(), GatewayError> {
    if !addr.ip().is_loopback() && token.is_none_or(|token| token.trim().is_empty()) {
        return Err(GatewayError::Config(
            "non-loopback gateway requires APHRODY_AI_HTTP_TOKEN in the protected host environment"
                .into(),
        ));
    }
    Ok(())
}

async fn health_handler(State(state): State<GatewayState>) -> Response {
    if state.adapter.health_check().await.is_err() {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(json!({
                "ok": false,
                "status": "unhealthy",
                "service": "aphrody-gateway",
                "version": env!("CARGO_PKG_VERSION")
            })),
        )
            .into_response();
    }
    Json(json!({
        "ok": true,
        "status": "healthy",
        "service": "aphrody-gateway",
        "version": env!("CARGO_PKG_VERSION")
    }))
    .into_response()
}

async fn models_handler(State(state): State<GatewayState>) -> impl IntoResponse {
    let data: Vec<Value> = state
        .model_ids
        .iter()
        .map(|id| {
            json!({
                "id": id,
                "object": "model",
                "created": 1700000000,
                "owned_by": "aphrody"
            })
        })
        .collect();

    Json(json!({ "object": "list", "data": data }))
}

async fn chat_completions_handler(
    State(state): State<GatewayState>,
    Json(payload): Json<OpenAiChatCompletionsRequest>,
) -> Response {
    let req = ChatRequest {
        model: payload.model.clone(),
        messages: payload.messages,
        temperature: payload.temperature,
        max_tokens: payload.max_tokens,
        stream: payload.stream,
    };

    if payload.stream {
        match state.adapter.chat_stream(req).await {
            Ok(stream) => {
                let model = payload.model.clone();
                let sse_stream = stream.map(move |chunk_result| match chunk_result {
                    Ok(chunk) => {
                        let data = json!({
                            "id": "chatcmpl-stream",
                            "object": "chat.completion.chunk",
                            "created": 1700000000,
                            "model": model,
                            "choices": [{
                                "index": 0,
                                "delta": {
                                    "content": chunk.delta
                                },
                                "finish_reason": if chunk.finish { Some("stop") } else { None }
                            }]
                        });
                        Ok::<Event, Infallible>(Event::default().data(data.to_string()))
                    }
                    // Intentionally NOT unified with aphrody-http-error - mimics OpenAI's own error wire shape for client drop-in compatibility; see docs/apis/contracts/API.md section 6.8.
                    Err(err) => {
                        let err_data = json!({
                            "error": {
                                "message": err.to_string(),
                                "type": "gateway_stream_error"
                            }
                        });
                        Ok::<Event, Infallible>(Event::default().data(err_data.to_string()))
                    }
                });

                let sse = Sse::new(sse_stream).keep_alive(KeepAlive::default());
                sse.into_response()
            }
            // Intentionally NOT unified with aphrody-http-error - mimics OpenAI's own error wire shape for client drop-in compatibility; see docs/apis/contracts/API.md section 6.8.
            Err(err) => (
                StatusCode::BAD_GATEWAY,
                Json(json!({
                    "error": {
                        "message": err.to_string(),
                        "type": "gateway_error"
                    }
                })),
            )
                .into_response(),
        }
    } else {
        match state.adapter.chat(req).await {
            Ok(resp) => {
                let body = json!({
                    "id": "chatcmpl-nonstream",
                    "object": "chat.completion",
                    "created": 1700000000,
                    "model": resp.model.unwrap_or(payload.model),
                    "choices": [{
                        "index": 0,
                        "message": {
                            "role": "assistant",
                            "content": resp.content
                        },
                        "finish_reason": "stop"
                    }],
                    "usage": {
                        "prompt_tokens": 0,
                        "completion_tokens": 0,
                        "total_tokens": resp.total_tokens.unwrap_or(0)
                    }
                });
                (StatusCode::OK, Json(body)).into_response()
            }
            // Intentionally NOT unified with aphrody-http-error - mimics OpenAI's own error wire shape for client drop-in compatibility; see docs/apis/contracts/API.md section 6.8.
            Err(err) => (
                StatusCode::BAD_GATEWAY,
                Json(json!({
                    "error": {
                        "message": err.to_string(),
                        "type": "gateway_error"
                    }
                })),
            )
                .into_response(),
        }
    }
}

async fn cors_preflight() -> impl IntoResponse {
    StatusCode::NO_CONTENT
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn file_auth_failure_is_closed_and_success_requires_the_bound_token() {
        let _ = rustls::crypto::ring::default_provider().install_default();
        for (token, expected) in [
            (Err(()), StatusCode::SERVICE_UNAVAILABLE),
            (
                Ok(Some("fixture-token".to_owned())),
                StatusCode::UNAUTHORIZED,
            ),
        ] {
            let app = Router::new()
                .route("/v1/models", get(|| async { "fixture" }))
                .layer(middleware::from_fn_with_state(token, auth_middleware));
            let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
            let address = listener.local_addr().unwrap();
            let server = tokio::spawn(async move { axum::serve(listener, app).await });
            let client = reqwest::Client::builder().no_proxy().build().unwrap();
            let url = format!("http://{address}/v1/models");
            assert_eq!(client.get(&url).send().await.unwrap().status(), expected);
            let authenticated = client
                .get(&url)
                .bearer_auth("fixture-token")
                .send()
                .await
                .unwrap();
            assert_eq!(
                authenticated.status(),
                if expected == StatusCode::UNAUTHORIZED {
                    StatusCode::OK
                } else {
                    StatusCode::SERVICE_UNAVAILABLE
                }
            );
            server.abort();
        }
    }

    struct UnreadyAdapter;

    #[async_trait::async_trait]
    impl GatewayAdapter for UnreadyAdapter {
        async fn health_check(&self) -> Result<(), GatewayError> {
            Err(GatewayError::Config("upstream unavailable".into()))
        }

        async fn chat(
            &self,
            _req: crate::ChatRequest,
        ) -> Result<crate::ChatResponse, GatewayError> {
            Err(GatewayError::Config("upstream unavailable".into()))
        }

        async fn chat_stream(
            &self,
            _req: crate::ChatRequest,
        ) -> Result<crate::ChunkStream, GatewayError> {
            Err(GatewayError::Config("upstream unavailable".into()))
        }
    }

    #[test]
    fn mesh_binding_requires_a_gateway_credential() {
        let mesh: SocketAddr = "10.200.77.10:8786".parse().unwrap();
        assert!(validate_bind(mesh, None).is_err());
        assert!(validate_bind(mesh, Some(" ")).is_err());
        assert!(validate_bind(mesh, Some("test-only-token")).is_ok());
        assert!(validate_bind("127.0.0.1:8786".parse().unwrap(), None).is_ok());
        assert!(validate_bind("[::1]:8786".parse().unwrap(), None).is_ok());
    }

    #[tokio::test]
    async fn health_is_unavailable_when_the_adapter_reports_an_unready_upstream() {
        let response = health_handler(State(GatewayState {
            adapter: Arc::new(UnreadyAdapter),
            model_ids: vec![],
        }))
        .await;
        assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
    }

    #[test]
    fn test_allowed_origins() {
        // Allowed localhost origins
        assert!(is_allowed_origin("http://localhost"));
        assert!(is_allowed_origin("http://localhost:8083"));
        assert!(is_allowed_origin("https://localhost:3000"));
        assert!(is_allowed_origin("http://127.0.0.1"));
        assert!(is_allowed_origin("http://127.0.0.1:8786"));
        assert!(is_allowed_origin("https://127.0.0.1:443"));
        assert!(is_allowed_origin("http://[::1]:8080"));
        assert!(is_allowed_origin("http://tauri.localhost"));
        assert!(is_allowed_origin("https://tauri.localhost"));
        assert!(is_allowed_origin("tauri://localhost"));

        // Disallowed / external origins
        assert!(!is_allowed_origin("http://localhost.evil.com"));
        assert!(!is_allowed_origin("http://127.0.0.1.attacker.com"));
        assert!(!is_allowed_origin("https://example.com"));
        assert!(!is_allowed_origin("https://evil.org:8083"));
        assert!(!is_allowed_origin("ftp://localhost"));
        assert!(!is_allowed_origin("null"));
        assert!(!is_allowed_origin(""));
        assert!(!is_allowed_origin("invalid-origin"));
    }

    #[test]
    fn test_add_cors_headers_filters_origin() {
        let mut headers = HeaderMap::new();
        let evil_origin = HeaderValue::from_static("http://evil.com");
        add_cors_headers(&mut headers, Some(&evil_origin));
        assert!(!headers.contains_key(header::ACCESS_CONTROL_ALLOW_ORIGIN));
        assert_eq!(headers.get(header::VARY).unwrap(), "Origin");

        let mut headers = HeaderMap::new();
        let local_origin = HeaderValue::from_static("http://localhost:8083");
        add_cors_headers(&mut headers, Some(&local_origin));
        assert_eq!(
            headers.get(header::ACCESS_CONTROL_ALLOW_ORIGIN).unwrap(),
            "http://localhost:8083"
        );
        assert_eq!(
            headers
                .get(header::ACCESS_CONTROL_ALLOW_CREDENTIALS)
                .unwrap(),
            "true"
        );
    }
}
