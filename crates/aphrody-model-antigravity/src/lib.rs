// SPDX-License-Identifier: Apache-2.0
//! Antigravity (Google AI Ultra / Cloud Code) `ModelClient` implementation for aphrody.
//!
//! Provides:
//! - Direct, streaming LLM execution via Cloud Code `streamGenerateContent` SSE endpoint.
//! - Automatic keyless token re-read from Windows Credential Manager / agy store on HTTP 401.
//! - Conversion between `aphrody-model-client` unified structures and Gemini/Antigravity requests.
//! - Full support for tool function declarations, function calling, and reasoning traces.

use std::sync::Arc;

use aphrody_antigravity::{
    client::AntigravityClient, endpoints::CloudCodeEndpoint, error::SdkError,
    models::GenerateContentRequest,
};
use aphrody_model_client::{
    ChatTurn, ModelCapabilities, ModelClient, ModelError, ModelStream, ModelStreamEvent,
    build_request_body, parse_sse_frame,
};
use async_trait::async_trait;
use futures::StreamExt;
use tokio::sync::RwLock;
use tracing::warn;

/// Antigravity streaming model client implementing [`ModelClient`].
pub struct AntigravityModelClient {
    /// Inner authenticated Antigravity client with keyless token refresh support.
    client: Arc<RwLock<AntigravityClient>>,
    /// Target model identifier (e.g. `gemini-2.5-flash`, `gemini-3-flash`).
    model: String,
    /// Optional Cloud AI Companion project. If `None`, will be lazily resolved.
    project: Arc<RwLock<Option<String>>>,
    /// Target Cloud Code endpoint.
    endpoint: CloudCodeEndpoint,
    /// Advertised model capabilities.
    capabilities: ModelCapabilities,
}

impl AntigravityModelClient {
    /// Create a new client targeting `model` with an authenticated [`AntigravityClient`].
    pub fn new(client: AntigravityClient, model: impl Into<String>) -> Self {
        Self {
            client: Arc::new(RwLock::new(client)),
            model: model.into(),
            project: Arc::new(RwLock::new(None)),
            endpoint: CloudCodeEndpoint::default(),
            capabilities: ModelCapabilities {
                tools: true,
                parallel_tool_calls: true,
                images: true,
                reasoning: true,
                json_schema: true,
                context_window: Some(1_048_576),
            },
        }
    }

    /// Override the Cloud Code endpoint.
    #[must_use]
    pub fn with_endpoint(mut self, endpoint: CloudCodeEndpoint) -> Self {
        self.endpoint = endpoint;
        self
    }

    /// Set an explicit Cloud Code project name instead of resolving it dynamically.
    #[must_use]
    pub fn with_project(mut self, project: impl Into<String>) -> Self {
        self.project = Arc::new(RwLock::new(Some(project.into())));
        self
    }

    /// Access the current model identifier.
    #[must_use]
    pub fn model(&self) -> &str {
        &self.model
    }
}

/// Convert an [`SdkError`] to a [`ModelError`].
fn sdk_to_model_error(err: SdkError) -> ModelError {
    match err {
        SdkError::Http(e) => ModelError::Http(e),
        SdkError::TokenParse(e) => ModelError::Decode(e),
        SdkError::OAuthServer { status, body } => ModelError::Api {
            status,
            message: body,
        },
        SdkError::Stream(s) => ModelError::Stream(s),
        other => ModelError::Stream(other.to_string()),
    }
}

#[async_trait]
impl ModelClient for AntigravityModelClient {
    fn model_id(&self) -> &str {
        &self.model
    }

    fn capabilities(&self) -> ModelCapabilities {
        self.capabilities.clone()
    }

    async fn stream(&self, turn: ChatTurn) -> Result<ModelStream, ModelError> {
        let body_value = build_request_body(&turn);
        let req: GenerateContentRequest =
            serde_json::from_value(body_value).map_err(ModelError::Decode)?;

        // Lazily resolve project if not yet cached.
        let mut cached_proj = self.project.read().await.clone();
        if cached_proj.is_none() {
            let resolved = {
                let cl = self.client.read().await;
                cl.resolve_cloudcode_project().await.ok().flatten()
            };
            let p = resolved.unwrap_or_else(|| "cloudaicompanion".to_string());
            *self.project.write().await = Some(p.clone());
            cached_proj = Some(p);
        }
        let project_str = cached_proj.unwrap_or_else(|| "cloudaicompanion".to_string());

        // Execute streaming request with 401 keyless retry.
        let mut attempt = 0;
        let response_stream = loop {
            attempt += 1;
            let result = {
                let cl = self.client.read().await;
                cl.stream_generate_content_cloud_code(
                    self.endpoint,
                    &self.model,
                    &project_str,
                    &req,
                )
                .await
            };

            match result {
                Ok(s) => break s,
                Err(SdkError::OAuthServer { status: 401, body }) if attempt == 1 => {
                    warn!(
                        status = 401,
                        body = %body,
                        "Antigravity 401 Unauthorized; attempting keyless token re-read from credential store"
                    );
                    let mut cl = self.client.write().await;
                    if let Err(refresh_err) = cl.refresh_token().await {
                        return Err(ModelError::Api {
                            status: 401,
                            message: format!("token refresh failed: {refresh_err}"),
                        });
                    }
                    continue;
                }
                Err(err) => {
                    if err.is_geo_restricted() {
                        return Err(ModelError::Api {
                            status: 400,
                            message: format!("Antigravity location geo-restricted (EEA IP): {err}"),
                        });
                    }
                    return Err(sdk_to_model_error(err));
                }
            }
        };

        // Map the SSE chunks to unified model stream events.
        let event_stream = response_stream
            .map(|chunk_res| match chunk_res {
                Ok(resp) => match serde_json::to_value(&resp).map_err(ModelError::Decode) {
                    Ok(val) => match parse_sse_frame(&val.to_string()) {
                        Ok(events) => events.into_iter().map(Ok).collect::<Vec<_>>(),
                        Err(e) => vec![Err(e)],
                    },
                    Err(e) => vec![Err(e)],
                },
                Err(e) => vec![Err(sdk_to_model_error(e))],
            })
            .map(futures::stream::iter)
            .flatten();

        // Prefix with Created event per the ModelStream contract.
        let full_stream =
            futures::stream::once(async { Ok(ModelStreamEvent::Created) }).chain(event_stream);

        Ok(Box::pin(full_stream))
    }
}

#[cfg(test)]
mod tests {
    use pretty_assertions::assert_eq;

    use super::*;

    #[test]
    fn test_sdk_to_model_error_mapping() {
        let err = SdkError::OAuthServer {
            status: 403,
            body: "Forbidden".to_string(),
        };
        let mapped = sdk_to_model_error(err);
        match mapped {
            ModelError::Api { status, message } => {
                assert_eq!(status, 403);
                assert_eq!(message, "Forbidden");
            }
            other => panic!("expected Api error, got {other:?}"),
        }
    }
}
