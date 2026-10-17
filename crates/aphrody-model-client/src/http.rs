// SPDX-License-Identifier: Apache-2.0
//! Plain (non-streaming) JSON request helpers for the Ollama and vLLM
//! management surfaces.
//!
//! The streaming chat wires already share [`send_with_retry`]; the endpoints
//! that are not a token stream (`/api/tags`, `/api/show`, `/rerank`,
//! `/tokenize`, `/metrics`, ...) need the same retry budget, credential and
//! extra headers plus a typed decode and a readable error. They live here so
//! no provider module grows its own request loop.

use serde::de::DeserializeOwned;
use serde_json::Value;

use crate::{
    ModelError,
    openai_compat::{ProviderRuntime, send_with_retry},
};

/// Send one non-streaming request and return the successful response.
///
/// `accept` is the `Accept` header (`application/json`, `text/plain`, ...).
/// The provider credential and extra headers of `runtime` are attached, and a
/// non-success status becomes [`ModelError::Api`] carrying the message
/// extracted from the error body (see [`error_message`]).
pub(crate) async fn send_request(
    http: &reqwest::Client,
    runtime: &ProviderRuntime,
    method: reqwest::Method,
    url: &str,
    body: Option<&Value>,
    accept: &str,
) -> Result<reqwest::Response, ModelError> {
    send_with_retry(runtime, &|| {
        let mut request = http
            .request(method.clone(), url)
            .header(reqwest::header::ACCEPT, accept);
        if let Some(token) = &runtime.bearer_token {
            request = request.bearer_auth(token);
        }
        if let Some(body) = body {
            request = request.json(body);
        }
        request
    })
    .await
    .map_err(refine_api_error)
}

/// Decode a successful response body as JSON.
///
/// The body is read first and decoded second so a malformed payload surfaces as
/// [`ModelError::Decode`] (with the serde position) instead of an opaque
/// transport error.
pub(crate) async fn read_json<T: DeserializeOwned>(
    response: reqwest::Response,
) -> Result<T, ModelError> {
    let bytes = response.bytes().await?;
    Ok(serde_json::from_slice(&bytes)?)
}

/// One-call JSON request/response round trip.
pub(crate) async fn request_json<T: DeserializeOwned>(
    http: &reqwest::Client,
    runtime: &ProviderRuntime,
    method: reqwest::Method,
    url: &str,
    body: Option<&Value>,
) -> Result<T, ModelError> {
    let response = send_request(http, runtime, method, url, body, "application/json").await?;
    read_json(response).await
}

/// The human-readable message inside an error response body.
///
/// Understands the three shapes the supported servers use: Ollama's
/// `{"error": "message"}`, the OpenAI/vLLM `{"error": {"message": "...",
/// "type": "...", "code": 400}}` (`ErrorResponse` in vLLM's `engine/protocol.py`)
/// and a FastAPI `{"detail": "..."}`. Anything else is returned trimmed and
/// verbatim.
pub(crate) fn error_message(body: &str) -> String {
    let fallback = || body.trim().to_string();
    let Ok(Value::Object(map)) = serde_json::from_str::<Value>(body) else {
        return fallback();
    };
    match map.get("error") {
        Some(Value::String(message)) if !message.is_empty() => return message.clone(),
        Some(Value::Object(error)) => {
            if let Some(Value::String(message)) = error.get("message")
                && !message.is_empty()
            {
                return message.clone();
            }
        }
        _ => {}
    }
    match map.get("detail") {
        Some(Value::String(detail)) if !detail.is_empty() => detail.clone(),
        _ => fallback(),
    }
}

/// Replace a raw error body in [`ModelError::Api`] by its extracted message.
pub(crate) fn refine_api_error(error: ModelError) -> ModelError {
    match error {
        ModelError::Api { status, message } => ModelError::Api {
            status,
            message: error_message(&message),
        },
        other => other,
    }
}

/// The server root of a base URL that may carry an API segment.
///
/// [`ProviderRuntime::base_url`] follows the Codex convention of including the
/// version segment (`http://localhost:11434/v1`, `http://localhost:8000/v1`),
/// because that is what the OpenAI-compatible wires append to. The native
/// Ollama routes (`/api/...`) and the vLLM extras (`/rerank`, `/tokenize`,
/// `/metrics`, ...) hang off the server root instead, so a trailing `/v1` (or
/// `/api`) is removed. Reverse-proxy prefixes in front of it are kept.
pub(crate) fn server_root(base_url: &str) -> String {
    let trimmed = base_url.trim().trim_end_matches('/');
    for suffix in ["/v1", "/api"] {
        if let Some(root) = trimmed.strip_suffix(suffix) {
            return root.trim_end_matches('/').to_string();
        }
    }
    trimmed.to_string()
}

/// A copy of `runtime` whose `base_url` is the server root.
pub(crate) fn rooted(runtime: &ProviderRuntime) -> ProviderRuntime {
    ProviderRuntime {
        base_url: server_root(&runtime.base_url),
        ..runtime.clone()
    }
}

#[cfg(test)]
mod tests {
    use pretty_assertions::assert_eq;

    use super::*;

    #[test]
    fn server_root_strips_only_a_trailing_api_segment() {
        assert_eq!(
            server_root("http://localhost:11434/v1"),
            "http://localhost:11434"
        );
        assert_eq!(
            server_root("http://localhost:11434/v1/"),
            "http://localhost:11434"
        );
        assert_eq!(
            server_root("http://localhost:11434"),
            "http://localhost:11434"
        );
        assert_eq!(
            server_root("http://localhost:11434/api"),
            "http://localhost:11434"
        );
        assert_eq!(
            server_root("https://gw.example/ollama/v1"),
            "https://gw.example/ollama"
        );
        // A path that merely contains the segment is left alone.
        assert_eq!(
            server_root("https://host/v1/models-proxy"),
            "https://host/v1/models-proxy"
        );
    }

    #[test]
    fn error_messages_are_extracted_from_every_server_shape() {
        assert_eq!(
            error_message(r#"{"error":"model 'x' not found"}"#),
            "model 'x' not found"
        );
        assert_eq!(
            error_message(
                r#"{"error":{"message":"bad request","type":"BadRequestError","code":400}}"#
            ),
            "bad request"
        );
        assert_eq!(error_message(r#"{"detail":"not allowed"}"#), "not allowed");
        assert_eq!(error_message("  plain text body \n"), "plain text body");
        assert_eq!(
            error_message(r#"{"unexpected":true}"#),
            r#"{"unexpected":true}"#
        );
    }

    #[test]
    fn refining_keeps_the_status_and_other_variants() {
        let refined = refine_api_error(ModelError::Api {
            status: 404,
            message: r#"{"error":"model not found"}"#.to_string(),
        });
        assert!(matches!(
            refined,
            ModelError::Api { status: 404, ref message } if message == "model not found"
        ));
        assert!(matches!(
            refine_api_error(ModelError::Stream("x".to_string())),
            ModelError::Stream(_)
        ));
    }

    #[test]
    fn rooted_runtime_keeps_credentials_and_swaps_the_base() {
        let mut runtime = ProviderRuntime::keyless("http://localhost:8000/v1");
        runtime.bearer_token = Some("tok".to_string());
        let root = rooted(&runtime);
        assert_eq!(root.base_url, "http://localhost:8000");
        assert_eq!(root.bearer_token.as_deref(), Some("tok"));
        assert_eq!(root.endpoint_path("rerank"), "http://localhost:8000/rerank");
    }
}
