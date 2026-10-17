// SPDX-License-Identifier: Apache-2.0
//! Gateway facade over the canonical provider owner, without a second HTTP client.

use std::sync::Arc;

use aphrody_model_client::{
    ChatMessage, ChatTurn, ModelClient, ModelStreamEvent, Part, Role, TurnOptions,
};
use async_trait::async_trait;
use futures::StreamExt;

use crate::{
    ChatChunk, ChatRequest, ChatResponse, ChunkStream, GatewayAdapter, GatewayError, Message,
};

/// Text gateway adapter over an existing [`ModelClient`].
///
/// The model, transport, credential, retries and stream timeout are resolved by
/// the capability owner. The HTTP gateway does not spawn or copy an engine.
/// Native Rust engines such as Mistral.rs use the same provider wire as vLLM.
/// Rich tool/vision requests remain on the `ModelClient` and MCP surfaces until
/// the gateway's text-only request contract is extended.
pub struct ModelClientAdapter {
    client: Arc<dyn ModelClient>,
}

impl ModelClientAdapter {
    /// Attach the facade to a resolved provider.
    #[must_use]
    pub fn new(client: Arc<dyn ModelClient>) -> Self {
        Self { client }
    }

    fn turn(&self, request: ChatRequest) -> Result<ChatTurn, GatewayError> {
        if request.model != self.client.model_id() {
            return Err(GatewayError::Config(format!(
                "model '{}' is not served by this gateway; configured model is '{}'",
                request.model,
                self.client.model_id()
            )));
        }
        let mut turn = ChatTurn {
            options: TurnOptions {
                temperature: request.temperature,
                max_output_tokens: request.max_tokens,
                ..TurnOptions::default()
            },
            ..ChatTurn::default()
        };
        for message in request.messages {
            match message {
                Message::System(text) => {
                    let system = turn.system.get_or_insert_with(String::new);
                    if !system.is_empty() {
                        system.push('\n');
                    }
                    system.push_str(&text);
                }
                Message::User(text) => turn.messages.push(ChatMessage {
                    role: Role::User,
                    parts: vec![Part::Text(text)],
                }),
                Message::Assistant(text) => turn.messages.push(ChatMessage {
                    role: Role::Model,
                    parts: vec![Part::Text(text)],
                }),
                Message::Tool(..) => {
                    // The legacy gateway has no tool_call_id to pair this
                    // result with. Refuse it instead of inventing a call.
                    return Err(GatewayError::Config(
                        "tool results require the ModelClient/MCP tool-call contract".into(),
                    ));
                }
            }
        }
        Ok(turn)
    }
}

#[async_trait]
impl GatewayAdapter for ModelClientAdapter {
    async fn chat(&self, request: ChatRequest) -> Result<ChatResponse, GatewayError> {
        let turn = self.turn(request)?;
        let mut events = self.client.stream(turn).await.map_err(provider_error)?;
        let mut content = String::new();
        let mut total_tokens = None;
        let mut completed = false;
        while let Some(event) = events.next().await {
            match event.map_err(provider_error)? {
                ModelStreamEvent::TextDelta(delta) => content.push_str(&delta),
                ModelStreamEvent::Completed { usage, .. } => {
                    total_tokens =
                        usage.map(|usage| u32::try_from(usage.total_tokens).unwrap_or(u32::MAX));
                    completed = true;
                    break;
                }
                ModelStreamEvent::ToolCall { .. } | ModelStreamEvent::ToolCallDelta { .. } => {
                    return Err(tool_call_error());
                }
                ModelStreamEvent::Created
                | ModelStreamEvent::ReasoningDelta(_)
                | ModelStreamEvent::ReasoningItem { .. } => {}
            }
        }
        if !completed {
            return Err(GatewayError::StreamFraming(
                "provider stream ended before completion".into(),
            ));
        }
        Ok(ChatResponse {
            content,
            model: Some(self.client.model_id().to_owned()),
            total_tokens,
        })
    }

    async fn chat_stream(&self, request: ChatRequest) -> Result<ChunkStream, GatewayError> {
        let turn = self.turn(request)?;
        let events = self.client.stream(turn).await.map_err(provider_error)?;
        // The owner stream remains inside this stream. Dropping the consumer
        // drops the HTTP response and terminates consumption, with no task or
        // unbounded queue detached from its lifetime.
        let chunks = futures::stream::unfold((events, false), |(mut events, ended)| async move {
            if ended {
                return None;
            }
            loop {
                let chunk = match events.next().await {
                    Some(Ok(ModelStreamEvent::TextDelta(delta))) => {
                        return Some((
                            Ok(ChatChunk {
                                delta,
                                finish: false,
                            }),
                            (events, false),
                        ));
                    }
                    Some(Ok(ModelStreamEvent::Completed { .. })) => Ok(ChatChunk {
                        delta: String::new(),
                        finish: true,
                    }),
                    Some(Ok(
                        ModelStreamEvent::ToolCall { .. } | ModelStreamEvent::ToolCallDelta { .. },
                    )) => Err(tool_call_error()),
                    Some(Err(error)) => Err(provider_error(error)),
                    Some(Ok(_)) => continue,
                    None => Err(GatewayError::StreamFraming(
                        "provider stream ended before completion".into(),
                    )),
                };
                return Some((chunk, (events, true)));
            }
        });
        Ok(Box::pin(chunks))
    }
}

fn provider_error(error: aphrody_model_client::ModelError) -> GatewayError {
    GatewayError::StreamFraming(error.to_string())
}

fn tool_call_error() -> GatewayError {
    GatewayError::StreamFraming(
        "provider requested a tool; use the ModelClient/MCP tool-call surface".into(),
    )
}

#[cfg(test)]
mod tests {
    use std::sync::Mutex;

    use aphrody_model_client::{ModelError, ModelStream, TokenUsage};

    use super::*;

    struct RecordingClient {
        turns: Mutex<Vec<ChatTurn>>,
        events: Vec<ModelStreamEvent>,
    }

    #[async_trait]
    impl ModelClient for RecordingClient {
        async fn stream(&self, turn: ChatTurn) -> Result<ModelStream, ModelError> {
            self.turns.lock().expect("turns").push(turn);
            Ok(Box::pin(futures::stream::iter(
                self.events.clone().into_iter().map(Ok),
            )))
        }

        fn model_id(&self) -> &str {
            "gemma4-e2b"
        }
    }

    fn adapter(events: Vec<ModelStreamEvent>) -> (ModelClientAdapter, Arc<RecordingClient>) {
        let client = Arc::new(RecordingClient {
            turns: Mutex::new(Vec::new()),
            events,
        });
        (ModelClientAdapter::new(client.clone()), client)
    }

    fn completed() -> ModelStreamEvent {
        ModelStreamEvent::Completed {
            usage: Some(TokenUsage::new(3, 2, 5)),
            finish_reason: Some("stop".into()),
        }
    }

    #[tokio::test]
    async fn gateway_uses_the_same_provider_and_preserves_history_sampling_and_usage() {
        let (adapter, client) = adapter(vec![
            ModelStreamEvent::Created,
            ModelStreamEvent::ReasoningDelta("private reasoning".into()),
            ModelStreamEvent::TextDelta("Four".into()),
            completed(),
        ]);
        let mut request = ChatRequest::new(
            "gemma4-e2b",
            vec![
                Message::System("Be concise.".into()),
                Message::User("2+2?".into()),
                Message::Assistant("Four".into()),
                Message::User("Repeat.".into()),
            ],
        );
        request.temperature = Some(0.1);
        request.max_tokens = Some(16);
        let response = adapter.chat(request).await.expect("chat");
        assert_eq!(response.content, "Four");
        assert_eq!(response.total_tokens, Some(5));
        let turns = client.turns.lock().expect("turns");
        assert_eq!(turns[0].system.as_deref(), Some("Be concise."));
        assert_eq!(turns[0].messages[1].role, Role::Model);
        assert_eq!(turns[0].options.max_output_tokens, Some(16));
        assert_eq!(turns[0].options.temperature, Some(0.1));
    }

    #[tokio::test]
    async fn rejects_unknown_model_before_issuing_provider_request() {
        let (adapter, client) = adapter(vec![completed()]);
        let error = adapter
            .chat(ChatRequest::new("other", Vec::new()))
            .await
            .expect_err("model");
        assert!(error.to_string().contains("not served"));
        assert!(client.turns.lock().expect("turns").is_empty());
    }

    #[tokio::test]
    async fn truncated_stream_is_an_error_instead_of_success() {
        let (adapter, _) = adapter(vec![ModelStreamEvent::TextDelta("partial".into())]);
        let error = adapter
            .chat(ChatRequest::new("gemma4-e2b", Vec::new()))
            .await
            .expect_err("truncated");
        assert!(error.to_string().contains("before completion"));
    }

    #[tokio::test]
    async fn truncated_sse_stream_emits_one_terminal_error() {
        let (adapter, _) = adapter(vec![ModelStreamEvent::TextDelta("partial".into())]);
        let chunks = adapter
            .chat_stream(ChatRequest::new("gemma4-e2b", Vec::new()))
            .await
            .expect("stream")
            .collect::<Vec<_>>()
            .await;
        assert_eq!(chunks.len(), 2);
        assert_eq!(chunks[0].as_ref().expect("partial").delta, "partial");
        assert!(
            chunks[1]
                .as_ref()
                .expect_err("truncated")
                .to_string()
                .contains("before completion")
        );
    }

    #[tokio::test]
    async fn streams_text_without_publishing_internal_reasoning() {
        let (adapter, _) = adapter(vec![
            ModelStreamEvent::ReasoningDelta("hidden".into()),
            ModelStreamEvent::TextDelta("Four".into()),
            completed(),
        ]);
        let chunks = adapter
            .chat_stream(ChatRequest::new("gemma4-e2b", Vec::new()))
            .await
            .expect("stream")
            .collect::<Vec<_>>()
            .await;
        assert_eq!(chunks.len(), 2);
        assert_eq!(chunks[0].as_ref().expect("text").delta, "Four");
        assert!(chunks[1].as_ref().expect("completion").finish);
    }

    #[tokio::test]
    async fn unpaired_tool_results_are_rejected() {
        let (adapter, client) = adapter(vec![completed()]);
        let error = adapter
            .chat(ChatRequest::new(
                "gemma4-e2b",
                vec![Message::Tool("tool".into(), "result".into())],
            ))
            .await
            .expect_err("unpaired tool");
        assert!(error.to_string().contains("tool-call contract"));
        assert!(client.turns.lock().expect("turns").is_empty());
    }
}
