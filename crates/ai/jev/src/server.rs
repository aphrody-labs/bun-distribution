// SPDX-License-Identifier: Apache-2.0
//! Jev-compatible HTTP server backed by a [`JevRouter`].
//!
//! Routes mirror the TypeSafe API so existing Jev clients (the Python SDK,
//! Spring AI connectors, jeff clients) work unchanged:
//!
//! - `POST /v1/systemone` — decisions; responses are the router's validated `{model, answers,
//!   usage}`.
//! - `GET /v1/models` — the served model id.
//! - `GET /healthz` — liveness.
//!
//! Errors use Jev's envelope `{"detail":{"error_type":…,"message":…}}`:
//! `401 authentication_error` (missing or wrong key when keys are set),
//! `422 invalid_request_error`, `502 upstream_error`, `529 overloaded_error`
//! when every backend is unavailable.

use std::{collections::HashSet, sync::Arc};

use axum::{
    Json, Router,
    extract::{RawQuery, State},
    http::{HeaderMap, StatusCode, header::AUTHORIZATION},
    response::{IntoResponse, Response as HttpResponse},
    routing::{get, post},
};
use serde_json::json;

use crate::{JevError, JevRouter, Request};

/// Shared server state.
#[derive(Clone)]
pub struct ServerState {
    router: Arc<JevRouter>,
    keys: Arc<HashSet<String>>,
    model: Arc<str>,
}

impl ServerState {
    /// `keys` empty means no authentication, as on a loopback-only server.
    #[must_use]
    pub fn new(router: Arc<JevRouter>, keys: HashSet<String>, model: impl Into<Arc<str>>) -> Self {
        Self { router, keys: Arc::new(keys), model: model.into() }
    }
}

/// Build the axum application.
pub fn app(state: ServerState) -> Router {
    Router::new()
        .route("/v1/systemone", post(systemone))
        .route("/v1/models", get(models))
        .route("/healthz", get(|| async { Json(json!({ "status": "ok" })) }))
        .with_state(state)
}

/// Intentionally NOT unified with aphrody-http-error - mimics Anthropic's own error wire shape for client drop-in compatibility; see docs/apis/contracts/API.md section 6.8.
fn error(status: StatusCode, error_type: &str, message: impl Into<String>) -> HttpResponse {
    (status, Json(json!({ "detail": { "error_type": error_type, "message": message.into() } })))
        .into_response()
}

/// `None` when the request may proceed, else the 401 response.
fn denied(state: &ServerState, headers: &HeaderMap) -> Option<HttpResponse> {
    if state.keys.is_empty() {
        return None;
    }
    let presented = headers
        .get(AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "));
    match presented {
        None => Some(error(
            StatusCode::UNAUTHORIZED,
            "authentication_error",
            "Must supply an API key! Check your request and try again.",
        )),
        Some(key) if state.keys.contains(key) => None,
        Some(_) => {
            Some(error(StatusCode::UNAUTHORIZED, "authentication_error", "Invalid API key."))
        },
    }
}

async fn models(State(state): State<ServerState>, headers: HeaderMap) -> HttpResponse {
    if let Some(denied) = denied(&state, &headers) {
        return denied;
    }
    Json(json!({ "data": [{ "id": &*state.model, "object": "model" }] })).into_response()
}

async fn systemone(
    State(state): State<ServerState>,
    headers: HeaderMap,
    RawQuery(query): RawQuery,
    body: axum::body::Bytes,
) -> HttpResponse {
    if let Some(denied) = denied(&state, &headers) {
        return denied;
    }
    let mut minimum_confidence = None;
    for (name, value) in
        url::form_urlencoded::parse(query.as_deref().unwrap_or_default().as_bytes())
    {
        if name == "minimum_confidence" {
            if minimum_confidence.is_some() {
                return error(
                    StatusCode::UNPROCESSABLE_ENTITY,
                    "invalid_request_error",
                    "duplicate confidence threshold",
                );
            }
            match crate::decision::parse_threshold(&value) {
                Ok(threshold) => minimum_confidence = Some(threshold),
                Err(error_value) => {
                    return error(
                        StatusCode::UNPROCESSABLE_ENTITY,
                        "invalid_request_error",
                        error_value.to_string(),
                    );
                },
            }
        }
    }
    let request: Request = match serde_json::from_slice(&body) {
        Ok(request) => request,
        Err(e) => {
            return error(StatusCode::UNPROCESSABLE_ENTITY, "invalid_request_error", e.to_string());
        },
    };
    match state.router.decide(&request).await {
        Ok(decision) => {
            let Some(threshold) = minimum_confidence else {
                return Json(decision.response).into_response();
            };
            let selections = match crate::confident_choices(&request, &decision.response, threshold)
            {
                Ok(selections) => selections,
                Err(error_value) => {
                    return error(
                        StatusCode::BAD_GATEWAY,
                        "upstream_error",
                        error_value.to_string(),
                    );
                },
            };
            let mut output = json!(decision.response);
            output["selections"] = json!(selections);
            Json(output).into_response()
        },
        Err(JevError::InvalidRequest(message)) => {
            error(StatusCode::UNPROCESSABLE_ENTITY, "invalid_request_error", message)
        },
        Err(JevError::Rejected { status, body, .. }) => {
            let status = StatusCode::from_u16(status).unwrap_or(StatusCode::BAD_GATEWAY);
            error(status, "upstream_error", body)
        },
        Err(JevError::Unavailable(message)) => error(
            StatusCode::from_u16(529).unwrap_or(StatusCode::SERVICE_UNAVAILABLE),
            "overloaded_error",
            message,
        ),
        Err(other) => error(StatusCode::BAD_GATEWAY, "upstream_error", other.to_string()),
    }
}
