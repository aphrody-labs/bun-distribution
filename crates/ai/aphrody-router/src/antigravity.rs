// SPDX-License-Identifier: Apache-2.0
//! Adapter from the legacy text router to the real Antigravity Cloud Code client.

use std::pin::Pin;

use aphrody_antigravity::{
    auth::{OAuthToken, token_from_credential_manager},
    client::AntigravityClient,
    endpoints::CloudCodeEndpoint,
};
use aphrody_model_antigravity::AntigravityModelClient;
use aphrody_model_client::{
    ChatMessage as ModelMessage, ChatTurn, ModelClient, ModelStreamEvent, Part, Role as ModelRole,
};
use async_trait::async_trait;
use futures_util::{Stream, StreamExt};

use crate::{
    ChatProvider, ChatRequest, ChatResponse, FinishReason, ModelId, Provider, Role, RouterError,
    RouterResult, Usage, build_client,
};

/// Default Cloud Code host used by the desktop Antigravity client.
pub const ANTIGRAVITY_DEFAULT_BASE_URL: &str = "https://daily-cloudcode-pa.googleapis.com";

/// Text-only compatibility adapter backed by the Cloud Code model client.
#[derive(Clone)]
pub struct AntigravityProvider {
    token: OAuthToken,
    endpoint: CloudCodeEndpoint,
}

impl std::fmt::Debug for AntigravityProvider {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("AntigravityProvider").field("endpoint", &self.endpoint).finish()
    }
}

impl AntigravityProvider {
    /// Construct from an OAuth access token. The token is never logged.
    ///
    /// # Errors
    /// Returns an error for an empty token.
    pub fn new(access_token: impl Into<String>) -> RouterResult<Self> {
        let access_token = access_token.into();
        if access_token.is_empty() {
            return Err(RouterError::Auth);
        }
        Ok(Self {
            token: OAuthToken {
                access_token,
                refresh_token: None,
                expiry: None,
                auth_method: None,
            },
            endpoint: CloudCodeEndpoint::default(),
        })
    }

    /// Select one of the two supported Cloud Code hosts.
    ///
    /// # Errors
    /// Arbitrary hosts cannot be used because the Cloud Code client fixes its
    /// authenticated wire protocol and URL paths.
    pub fn with_base_url(
        access_token: impl Into<String>,
        base_url: impl Into<String>,
    ) -> RouterResult<Self> {
        let endpoint = match base_url.into().trim_end_matches('/') {
            "https://daily-cloudcode-pa.googleapis.com" => CloudCodeEndpoint::Daily,
            "https://cloudcode-pa.googleapis.com" => CloudCodeEndpoint::Prod,
            _ => return Err(RouterError::InvalidModel("unsupported Cloud Code host".into())),
        };
        Ok(Self { endpoint, ..Self::new(access_token)? })
    }

    /// Load the desktop-maintained OAuth credential without copying its value
    /// into the caller's configuration.
    ///
    /// # Errors
    /// Returns a credential-store error if no OAuth session is available.
    pub fn from_credential_manager() -> RouterResult<Self> {
        let token = token_from_credential_manager()
            .map_err(|error| RouterError::Stream(error.to_string()))?;
        Ok(Self { token, endpoint: CloudCodeEndpoint::default() })
    }

    fn client(&self, model: String) -> RouterResult<AntigravityModelClient> {
        let http = build_client(concat!("aphrody-router/", env!("CARGO_PKG_VERSION")))?;
        Ok(AntigravityModelClient::new(AntigravityClient::new(http, self.token.clone()), model)
            .with_endpoint(self.endpoint))
    }
}

fn to_turn(req: &ChatRequest) -> RouterResult<ChatTurn> {
    let mut system = Vec::new();
    let mut messages = Vec::new();
    for message in &req.messages {
        match message.role {
            Role::System => system.push(message.content.clone()),
            Role::User | Role::Assistant => messages.push(ModelMessage {
                role: if message.role == Role::User { ModelRole::User } else { ModelRole::Model },
                parts: vec![Part::Text(message.content.clone())],
            }),
            Role::Tool => {
                return Err(RouterError::Stream(
                    "legacy router cannot replay a tool result without its call name".into(),
                ));
            },
        }
    }
    let mut turn = ChatTurn {
        system: (!system.is_empty()).then(|| system.join("\n\n")),
        messages,
        ..ChatTurn::default()
    };
    turn.options.temperature = req.temperature;
    turn.options.max_output_tokens = req.max_tokens;
    Ok(turn)
}

#[async_trait]
impl ChatProvider for AntigravityProvider {
    fn provider(&self) -> Provider {
        Provider::Antigravity
    }

    async fn health(&self) -> RouterResult<()> {
        let http = build_client(concat!("aphrody-router/", env!("CARGO_PKG_VERSION")))?;
        AntigravityClient::new(http, self.token.clone())
            .resolve_cloudcode_project()
            .await
            .map_err(|error| RouterError::Stream(error.to_string()))?;
        Ok(())
    }

    async fn complete(&self, req: ChatRequest) -> RouterResult<ChatResponse> {
        if req.model.provider != Provider::Antigravity {
            return Err(RouterError::InvalidModel(req.model.to_string()));
        }
        let turn = to_turn(&req)?;
        let client = self.client(req.model.name.clone())?;
        let mut stream =
            client.stream(turn).await.map_err(|error| RouterError::Stream(error.to_string()))?;
        let mut content = String::new();
        let mut usage = Usage::default();
        let mut finish_reason = FinishReason::Stop;
        let mut completed = false;
        while let Some(event) = stream.next().await {
            match event.map_err(|error| RouterError::Stream(error.to_string()))? {
                ModelStreamEvent::TextDelta(delta) => content.push_str(&delta),
                ModelStreamEvent::Completed { usage: reported, finish_reason: reason } => {
                    completed = true;
                    if let Some(reported) = reported {
                        usage.prompt_tokens =
                            u32::try_from(reported.input_tokens).unwrap_or(u32::MAX);
                        usage.completion_tokens =
                            u32::try_from(reported.output_tokens).unwrap_or(u32::MAX);
                    }
                    if reason.as_deref().is_some_and(|reason| reason.contains("MAX_TOKENS")) {
                        finish_reason = FinishReason::Length;
                    }
                },
                ModelStreamEvent::ToolCall { .. } => {
                    return Err(RouterError::Stream(
                        "legacy router cannot represent an Antigravity tool call".into(),
                    ));
                },
                _ => {},
            }
        }
        if !completed {
            return Err(RouterError::Stream(
                "Antigravity stream ended without a completion event".into(),
            ));
        }
        Ok(ChatResponse {
            content,
            model: ModelId::new(Provider::Antigravity, req.model.name),
            usage,
            finish_reason,
        })
    }

    async fn complete_stream(
        &self,
        req: ChatRequest,
    ) -> RouterResult<Pin<Box<dyn Stream<Item = RouterResult<String>> + Send>>> {
        if req.model.provider != Provider::Antigravity {
            return Err(RouterError::InvalidModel(req.model.to_string()));
        }
        let turn = to_turn(&req)?;
        let client = self.client(req.model.name)?;
        let mut events =
            client.stream(turn).await.map_err(|error| RouterError::Stream(error.to_string()))?;
        let output = async_stream::stream! {
            let mut completed = false;
            let mut failed = false;
            while let Some(event) = events.next().await {
                match event {
                    Ok(ModelStreamEvent::TextDelta(delta)) => yield Ok(delta),
                    Ok(ModelStreamEvent::Completed { .. }) => {
                        completed = true;
                    },
                    Ok(ModelStreamEvent::ToolCall { .. }) => {
                        failed = true;
                        yield Err(RouterError::Stream("legacy router cannot represent an Antigravity tool call".into()));
                        break;
                    },
                    Err(error) => {
                        failed = true;
                        yield Err(RouterError::Stream(error.to_string()));
                        break;
                    },
                    _ => {},
                }
            }
            if !completed && !failed {
                yield Err(RouterError::Stream("Antigravity stream ended without a completion event".into()));
            }
        };
        Ok(Box::pin(output))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ChatMessage;

    #[test]
    fn converts_text_history_without_losing_system_instructions() {
        let req = ChatRequest {
            model: ModelId::new(Provider::Antigravity, "gemini-3-flash"),
            messages: vec![ChatMessage::system("rules"), ChatMessage::user("hello")],
            temperature: Some(0.2),
            max_tokens: Some(32),
            stream: false,
        };
        let turn = to_turn(&req).unwrap();
        assert_eq!(turn.system.as_deref(), Some("rules"));
        assert_eq!(turn.messages.len(), 1);
        assert_eq!(turn.options.max_output_tokens, Some(32));
    }

    #[test]
    fn rejects_the_obsolete_vertex_host() {
        assert!(
            AntigravityProvider::with_base_url("token", "https://aiplatform.googleapis.com")
                .is_err()
        );
    }
}
