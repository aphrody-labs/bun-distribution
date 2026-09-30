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
    extract::State,
    http::{HeaderMap, HeaderValue, StatusCode, header},
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

/// Construct the Axum router for the gateway HTTP service.
pub fn router(state: GatewayState) -> Router {
    Router::new()
        .route("/health", get(health_handler).options(cors_preflight))
        .route("/healthz", get(health_handler).options(cors_preflight))
        .route("/v1/models", get(models_handler).options(cors_preflight))
        .route("/v1/chat/completions", post(chat_completions_handler).options(cors_preflight))
        .with_state(state)
}

/// Start serving the gateway over the given loopback address.
pub async fn serve_gateway(
    addr: SocketAddr,
    adapter: Arc<dyn GatewayAdapter>,
    model_ids: Vec<String>,
) -> Result<(), GatewayError> {
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

async fn health_handler() -> impl IntoResponse {
    let mut headers = HeaderMap::new();
    add_cors_headers(&mut headers);
    headers.insert(header::CONTENT_TYPE, HeaderValue::from_static("application/json"));
    (
        headers,
        Json(json!({
            "ok": true,
            "status": "healthy",
            "service": "aphrody-gateway",
            "version": env!("CARGO_PKG_VERSION")
        })),
    )
}

async fn models_handler(State(state): State<GatewayState>) -> impl IntoResponse {
    let mut headers = HeaderMap::new();
    add_cors_headers(&mut headers);
    headers.insert(header::CONTENT_TYPE, HeaderValue::from_static("application/json"));

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

    (headers, Json(json!({ "object": "list", "data": data })))
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
                    },
                    // Intentionally NOT unified with aphrody-http-error - mimics OpenAI's own error wire shape for client drop-in compatibility; see aphrody-contracts/docs/API.md section 6.8.
                    Err(err) => {
                        let err_data = json!({
                            "error": {
                                "message": err.to_string(),
                                "type": "gateway_stream_error"
                            }
                        });
                        Ok::<Event, Infallible>(Event::default().data(err_data.to_string()))
                    },
                });

                let sse = Sse::new(sse_stream).keep_alive(KeepAlive::default());
                let mut res = sse.into_response();
                add_cors_headers(res.headers_mut());
                res
            },
            // Intentionally NOT unified with aphrody-http-error - mimics OpenAI's own error wire shape for client drop-in compatibility; see aphrody-contracts/docs/API.md section 6.8.
            Err(err) => {
                let mut res = (
                    StatusCode::BAD_GATEWAY,
                    Json(json!({
                        "error": {
                            "message": err.to_string(),
                            "type": "gateway_error"
                        }
                    })),
                )
                    .into_response();
                add_cors_headers(res.headers_mut());
                res
            },
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
                let mut res = (StatusCode::OK, Json(body)).into_response();
                add_cors_headers(res.headers_mut());
                res
            },
            // Intentionally NOT unified with aphrody-http-error - mimics OpenAI's own error wire shape for client drop-in compatibility; see aphrody-contracts/docs/API.md section 6.8.
            Err(err) => {
                let mut res = (
                    StatusCode::BAD_GATEWAY,
                    Json(json!({
                        "error": {
                            "message": err.to_string(),
                            "type": "gateway_error"
                        }
                    })),
                )
                    .into_response();
                add_cors_headers(res.headers_mut());
                res
            },
        }
    }
}

async fn cors_preflight() -> impl IntoResponse {
    let mut headers = HeaderMap::new();
    add_cors_headers(&mut headers);
    (StatusCode::NO_CONTENT, headers)
}

fn add_cors_headers(headers: &mut HeaderMap) {
    headers.insert(header::ACCESS_CONTROL_ALLOW_ORIGIN, HeaderValue::from_static("*"));
    headers.insert(
        header::ACCESS_CONTROL_ALLOW_METHODS,
        HeaderValue::from_static("GET, POST, OPTIONS, PUT, DELETE"),
    );
    headers.insert(
        header::ACCESS_CONTROL_ALLOW_HEADERS,
        HeaderValue::from_static("Content-Type, Authorization, X-Requested-With, Origin, Accept"),
    );
}
