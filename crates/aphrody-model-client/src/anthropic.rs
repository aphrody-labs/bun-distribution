// SPDX-License-Identifier: Apache-2.0
//! Anthropic Messages API streaming client (`POST /v1/messages`).
//!
//! The wire is the raw HTTP API: `x-api-key` (or an OAuth bearer token),
//! `anthropic-version: 2023-06-01`, `stream: true`, and the SSE event family
//! `message_start` / `content_block_start` / `content_block_delta` /
//! `content_block_stop` / `message_delta` / `message_stop`, decoded into the
//! crate's neutral [`ModelStreamEvent`]s.
//!
//! Mapping rules worth knowing before touching the builder:
//!
//! - [`Role::Tool`] messages become a `user` message made only of `tool_result` blocks, each paired
//!   with its `tool_use_id` (the provider call id, never the tool name).
//! - A [`Part::Reasoning`] is replayed as a `thinking` block only when its `opaque` value carries
//!   the `signature` Anthropic returned; an unsigned reasoning item (from another provider) is
//!   dropped, since the API rejects it.
//! - `max_tokens` is mandatory on this wire; [`DEFAULT_MAX_OUTPUT_TOKENS`] applies when the turn
//!   does not set one.
//! - `thinking: {type: "adaptive"}` and `output_config.effort` are sent only when the turn asks for
//!   a reasoning effort, so models that reject those fields keep working when no effort is
//!   configured.

use std::collections::BTreeMap;

use async_trait::async_trait;
use futures::{Stream, StreamExt};
use serde_json::{Value, json};

use crate::{
    ChatMessage, ChatTurn, ImageSource, ModelCapabilities, ModelClient, ModelError, ModelStream,
    ModelStreamEvent, Part, Role, TokenUsage,
    openai_compat::{ProviderRuntime, merge_options, send_streaming_post, with_idle_timeout},
};

/// `anthropic-version` sent on every request.
pub const ANTHROPIC_API_VERSION: &str = "2023-06-01";

/// Beta flag required when authenticating with an OAuth bearer token.
pub const ANTHROPIC_OAUTH_BETA: &str = "oauth-2025-04-20";

/// `max_tokens` used when the turn sets none; the wire requires the field.
pub const DEFAULT_MAX_OUTPUT_TOKENS: u32 = 16_000;

/// How the credential reaches the API.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AnthropicAuth {
    /// `x-api-key: <key>` — an `sk-ant-…` API key.
    ApiKey,
    /// `Authorization: Bearer <token>` plus the OAuth beta header — a token
    /// minted by `ant auth login` (`ANTHROPIC_AUTH_TOKEN`).
    Bearer,
}

/// Anthropic Messages streaming client.
#[derive(Debug, Clone)]
pub struct AnthropicClient {
    http: reqwest::Client,
    runtime: ProviderRuntime,
    auth: AnthropicAuth,
    model: String,
}

impl AnthropicClient {
    /// Build a client from a provider runtime. `runtime.bearer_token` holds
    /// the API key (sent as `x-api-key`) or, with
    /// [`Self::with_auth`]`(`[`AnthropicAuth::Bearer`]`)`, an OAuth token.
    #[must_use]
    pub fn from_provider(runtime: ProviderRuntime, model: impl Into<String>) -> Self {
        Self {
            http: reqwest::Client::new(),
            runtime,
            auth: AnthropicAuth::ApiKey,
            model: model.into(),
        }
    }

    /// Select how the credential is transmitted.
    #[must_use]
    pub fn with_auth(mut self, auth: AnthropicAuth) -> Self {
        self.auth = auth;
        self
    }

    /// The provider runtime this client was built from.
    #[must_use]
    pub fn runtime(&self) -> &ProviderRuntime {
        &self.runtime
    }

    /// The request body sent for `turn`, after provider defaults are merged.
    #[must_use]
    pub fn request_body(&self, turn: &ChatTurn) -> Value {
        let mut turn = turn.clone();
        turn.options = merge_options(&self.runtime.default_options, &turn.options);
        build_messages_request(&turn, &self.model)
    }

    fn authorize(&self, request: reqwest::RequestBuilder) -> reqwest::RequestBuilder {
        let mut request = request.header("anthropic-version", ANTHROPIC_API_VERSION);
        match (&self.runtime.bearer_token, self.auth) {
            (Some(key), AnthropicAuth::ApiKey) => request = request.header("x-api-key", key),
            (Some(token), AnthropicAuth::Bearer) => {
                request = request
                    .bearer_auth(token)
                    .header("anthropic-beta", ANTHROPIC_OAUTH_BETA);
            }
            (None, _) => {}
        }
        request
    }
}

#[async_trait]
impl ModelClient for AnthropicClient {
    async fn stream(&self, turn: ChatTurn) -> Result<ModelStream, ModelError> {
        let url = self.runtime.endpoint_path("messages");
        let body = self.request_body(&turn);
        let response = send_streaming_post(&self.http, &url, &self.runtime, &body, &|request| {
            self.authorize(request)
        })
        .await?;
        let bytes = with_idle_timeout(response.bytes_stream(), self.runtime.stream_idle_timeout);
        Ok(Box::pin(messages_sse_stream(bytes)))
    }

    fn model_id(&self) -> &str {
        &self.model
    }

    fn capabilities(&self) -> ModelCapabilities {
        self.runtime.capabilities.clone()
    }
}

// ---------------------------------------------------------------------------
// Request builder
// ---------------------------------------------------------------------------

/// Build the `POST /v1/messages` JSON body for `turn`.
#[must_use]
pub fn build_messages_request(turn: &ChatTurn, model: &str) -> Value {
    let mut messages: Vec<Value> = Vec::new();
    for message in &turn.messages {
        if let Some(message) = message_to_anthropic(message) {
            messages.push(message);
        }
    }

    let mut body = json!({
        "model": model,
        "max_tokens": turn.options.max_output_tokens.unwrap_or(DEFAULT_MAX_OUTPUT_TOKENS),
        "messages": messages,
        "stream": true,
    });

    if let Some(system) = turn.system.as_deref().filter(|system| !system.is_empty()) {
        body["system"] = json!(system);
    }

    if !turn.tools.is_empty() {
        let tools: Vec<Value> = turn
            .tools
            .iter()
            .map(|tool| {
                json!({
                    "name": tool.name,
                    "description": tool.description,
                    "input_schema": tool.parameters,
                })
            })
            .collect();
        body["tools"] = Value::Array(tools);
        if turn.options.parallel_tool_calls == Some(false) {
            body["tool_choice"] = json!({ "type": "auto", "disable_parallel_tool_use": true });
        }
    }

    if let Some(temperature) = turn.options.temperature {
        body["temperature"] = json!(temperature);
    }
    if !turn.options.stop.is_empty() {
        body["stop_sequences"] = json!(turn.options.stop);
    }

    let mut output_config = serde_json::Map::new();
    if let Some(effort) = &turn.options.reasoning_effort {
        body["thinking"] = json!({ "type": "adaptive" });
        output_config.insert("effort".into(), json!(effort));
    }
    if let Some(schema) = &turn.options.response_schema {
        output_config.insert(
            "format".into(),
            json!({ "type": "json_schema", "schema": schema }),
        );
    }
    if !output_config.is_empty() {
        body["output_config"] = Value::Object(output_config);
    }

    if let Some(object) = body.as_object_mut() {
        for (key, value) in &turn.options.extra {
            object.insert(key.clone(), value.clone());
        }
    }
    body
}

fn image_block(image: &ImageSource) -> Value {
    match image {
        ImageSource::Base64 { mime, data } => json!({
            "type": "image",
            "source": { "type": "base64", "media_type": mime, "data": data },
        }),
        ImageSource::Url(url) => json!({
            "type": "image",
            "source": { "type": "url", "url": url },
        }),
    }
}

fn tool_result_content(response: &Value, images: &[ImageSource]) -> Value {
    let text = match response {
        Value::String(text) => text.clone(),
        other => other.to_string(),
    };
    if images.is_empty() {
        return json!(text);
    }
    let mut content = Vec::with_capacity(images.len() + 1);
    if !text.is_empty() {
        content.push(json!({ "type": "text", "text": text }));
    }
    content.extend(images.iter().map(image_block));
    Value::Array(content)
}

/// One neutral message → one Anthropic message, or `None` when nothing in it
/// can be expressed on this wire (the API rejects empty content).
fn message_to_anthropic(message: &ChatMessage) -> Option<Value> {
    let mut content: Vec<Value> = Vec::new();
    for part in &message.parts {
        match part {
            Part::Text(text) => {
                if !text.is_empty() {
                    content.push(json!({ "type": "text", "text": text }));
                }
            }
            Part::Image(image) => content.push(image_block(image)),
            Part::Reasoning { text, opaque } => {
                if let Some(signature) = opaque.get("signature").and_then(Value::as_str) {
                    content.push(json!({
                        "type": "thinking",
                        "thinking": text,
                        "signature": signature,
                    }));
                }
            }
            Part::FunctionCall { id, name, args } => {
                let input = if args.is_object() {
                    args.clone()
                } else {
                    json!({})
                };
                content.push(json!({
                    "type": "tool_use",
                    "id": if id.is_empty() { name } else { id },
                    "name": name,
                    "input": input,
                }));
            }
            Part::FunctionResponse {
                id,
                name,
                response,
                images,
            } => {
                content.push(json!({
                    "type": "tool_result",
                    "tool_use_id": if id.is_empty() { name } else { id },
                    "content": tool_result_content(response, images),
                }));
            }
        }
    }
    if content.is_empty() {
        return None;
    }
    let role = match message.role {
        Role::User | Role::Tool => "user",
        Role::Model => "assistant",
    };
    Some(json!({ "role": role, "content": content }))
}

// ---------------------------------------------------------------------------
// SSE parser
// ---------------------------------------------------------------------------

#[derive(Debug)]
enum OpenBlock {
    Text,
    Thinking {
        text: String,
        signature: Option<String>,
    },
    ToolUse {
        id: String,
        name: String,
        input_json: String,
    },
}

/// Incremental decoder for the Messages SSE event family.
///
/// Feed each frame's JSON `data` through [`Self::feed_event`]; one frame may
/// yield zero, one or several [`ModelStreamEvent`]s.
#[derive(Debug, Default)]
pub struct MessagesStreamParser {
    blocks: BTreeMap<u64, OpenBlock>,
    usage: TokenUsage,
    stop_reason: Option<String>,
    completed_sent: bool,
}

impl MessagesStreamParser {
    /// Fresh parser for one response.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Decode one event payload.
    ///
    /// # Errors
    ///
    /// [`ModelError::Decode`] for malformed JSON, [`ModelError::Api`] for an
    /// `error` event, [`ModelError::Stream`] for a tool call whose accumulated
    /// input is not valid JSON.
    pub fn feed_event(&mut self, json: &str) -> Result<Vec<ModelStreamEvent>, ModelError> {
        let value: Value = serde_json::from_str(json)?;
        let kind = value
            .get("type")
            .and_then(Value::as_str)
            .unwrap_or_default();
        let mut events = Vec::new();
        match kind {
            "message_start" => {
                if let Some(usage) = value.pointer("/message/usage") {
                    self.absorb_usage(usage);
                }
            }
            "content_block_start" => {
                let index = block_index(&value);
                let Some(block) = value.get("content_block") else {
                    return Ok(events);
                };
                match block
                    .get("type")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                {
                    "tool_use" => {
                        let id = block.get("id").and_then(Value::as_str).unwrap_or_default();
                        let name = block
                            .get("name")
                            .and_then(Value::as_str)
                            .unwrap_or_default();
                        events.push(ModelStreamEvent::ToolCallDelta {
                            id: Some(id.to_owned()),
                            name: Some(name.to_owned()),
                            arguments_fragment: String::new(),
                        });
                        self.blocks.insert(
                            index,
                            OpenBlock::ToolUse {
                                id: id.to_owned(),
                                name: name.to_owned(),
                                input_json: String::new(),
                            },
                        );
                    }
                    "thinking" | "redacted_thinking" => {
                        let text = block
                            .get("thinking")
                            .and_then(Value::as_str)
                            .unwrap_or_default();
                        if !text.is_empty() {
                            events.push(ModelStreamEvent::ReasoningDelta(text.to_owned()));
                        }
                        self.blocks.insert(
                            index,
                            OpenBlock::Thinking {
                                text: text.to_owned(),
                                signature: None,
                            },
                        );
                    }
                    _ => {
                        let text = block
                            .get("text")
                            .and_then(Value::as_str)
                            .unwrap_or_default();
                        if !text.is_empty() {
                            events.push(ModelStreamEvent::TextDelta(text.to_owned()));
                        }
                        self.blocks.insert(index, OpenBlock::Text);
                    }
                }
            }
            "content_block_delta" => {
                let index = block_index(&value);
                let Some(delta) = value.get("delta") else {
                    return Ok(events);
                };
                match delta
                    .get("type")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                {
                    "text_delta" => {
                        if let Some(text) = delta.get("text").and_then(Value::as_str) {
                            events.push(ModelStreamEvent::TextDelta(text.to_owned()));
                        }
                    }
                    "thinking_delta" => {
                        if let Some(fragment) = delta.get("thinking").and_then(Value::as_str) {
                            events.push(ModelStreamEvent::ReasoningDelta(fragment.to_owned()));
                            if let Some(OpenBlock::Thinking { text, .. }) =
                                self.blocks.get_mut(&index)
                            {
                                text.push_str(fragment);
                            }
                        }
                    }
                    "signature_delta" => {
                        if let (Some(value), Some(OpenBlock::Thinking { signature, .. })) = (
                            delta.get("signature").and_then(Value::as_str),
                            self.blocks.get_mut(&index),
                        ) {
                            signature.get_or_insert_with(String::new).push_str(value);
                        }
                    }
                    "input_json_delta" => {
                        let fragment = delta
                            .get("partial_json")
                            .and_then(Value::as_str)
                            .unwrap_or_default();
                        if let Some(OpenBlock::ToolUse { id, input_json, .. }) =
                            self.blocks.get_mut(&index)
                        {
                            input_json.push_str(fragment);
                            events.push(ModelStreamEvent::ToolCallDelta {
                                id: Some(id.clone()),
                                name: None,
                                arguments_fragment: fragment.to_owned(),
                            });
                        }
                    }
                    _ => {}
                }
            }
            "content_block_stop" => {
                let index = block_index(&value);
                match self.blocks.remove(&index) {
                    Some(OpenBlock::ToolUse {
                        id,
                        name,
                        input_json,
                    }) => {
                        let arguments = if input_json.trim().is_empty() {
                            json!({})
                        } else {
                            serde_json::from_str(&input_json).map_err(|error| {
                                ModelError::Stream(format!(
                                    "tool call `{name}` ({id}) carried invalid JSON input: {error}"
                                ))
                            })?
                        };
                        events.push(ModelStreamEvent::ToolCall {
                            id,
                            name,
                            arguments,
                        });
                    }
                    Some(OpenBlock::Thinking { text, signature }) => {
                        let opaque = match signature {
                            Some(signature) => json!({ "signature": signature }),
                            None => Value::Null,
                        };
                        events.push(ModelStreamEvent::ReasoningItem { text, opaque });
                    }
                    Some(OpenBlock::Text) | None => {}
                }
            }
            "message_delta" => {
                if let Some(reason) = value.pointer("/delta/stop_reason").and_then(Value::as_str) {
                    self.stop_reason = Some(reason.to_owned());
                }
                if let Some(usage) = value.get("usage") {
                    self.absorb_usage(usage);
                }
            }
            "message_stop" => {
                if let Some(completed) = self.finish() {
                    events.push(completed);
                }
            }
            "error" => {
                let message = value
                    .pointer("/error/message")
                    .and_then(Value::as_str)
                    .unwrap_or("provider reported a stream error");
                return Err(ModelError::Api {
                    status: 0,
                    message: message.to_owned(),
                });
            }
            // `ping` and unknown event types carry nothing for the caller.
            _ => {}
        }
        Ok(events)
    }

    /// Emit the terminal `Completed` event if the stream ended without
    /// `message_stop`.
    pub fn finish(&mut self) -> Option<ModelStreamEvent> {
        if self.completed_sent {
            return None;
        }
        self.completed_sent = true;
        let usage = TokenUsage {
            total_tokens: self.usage.input_tokens + self.usage.output_tokens,
            ..self.usage.clone()
        };
        let usage = (usage.total_tokens > 0).then_some(usage);
        Some(ModelStreamEvent::Completed {
            usage,
            finish_reason: self.stop_reason.take(),
        })
    }

    fn absorb_usage(&mut self, usage: &Value) {
        let read = |key: &str| usage.get(key).and_then(Value::as_u64);
        if let Some(input) = read("input_tokens") {
            self.usage.input_tokens = input;
        }
        if let Some(output) = read("output_tokens") {
            self.usage.output_tokens = output;
        }
        if let Some(cached) = read("cache_read_input_tokens") {
            self.usage.cached_input_tokens = cached;
        }
    }
}

fn block_index(value: &Value) -> u64 {
    value
        .get("index")
        .and_then(Value::as_u64)
        .unwrap_or_default()
}

/// Decode a Messages SSE byte stream into unified events.
pub(crate) fn messages_sse_stream<S>(
    bytes: S,
) -> impl Stream<Item = Result<ModelStreamEvent, ModelError>> + Send
where
    S: Stream<Item = Result<bytes::Bytes, ModelError>> + Send + 'static,
{
    futures::stream::once(async { Ok(ModelStreamEvent::Created) }).chain(
        futures::stream::unfold(
            (
                Box::pin(bytes.fuse()),
                String::new(),
                MessagesStreamParser::new(),
                false,
            ),
            |(mut stream, mut buffer, mut parser, mut done)| async move {
                loop {
                    if done {
                        return None;
                    }
                    let frames = crate::split_sse_events(&mut buffer);
                    let mut items = Vec::new();
                    for frame in frames {
                        let data = crate::sse_event_data(&frame);
                        let trimmed = data.trim();
                        if trimmed.is_empty() {
                            continue;
                        }
                        match parser.feed_event(trimmed) {
                            Ok(events) => items.extend(events.into_iter().map(Ok)),
                            Err(error) => items.push(Err(error)),
                        }
                    }
                    if !items.is_empty() {
                        return Some((
                            futures::stream::iter(items),
                            (stream, buffer, parser, done),
                        ));
                    }

                    match stream.next().await {
                        Some(Ok(chunk)) => match std::str::from_utf8(&chunk) {
                            Ok(text) => buffer.push_str(text),
                            Err(error) => {
                                done = true;
                                return Some((
                                    futures::stream::iter(vec![Err(ModelError::Stream(format!(
                                        "invalid utf-8: {error}"
                                    )))]),
                                    (stream, buffer, parser, done),
                                ));
                            }
                        },
                        Some(Err(error)) => {
                            done = true;
                            return Some((
                                futures::stream::iter(vec![Err(error)]),
                                (stream, buffer, parser, done),
                            ));
                        }
                        None => {
                            done = true;
                            let tail = std::mem::take(&mut buffer);
                            let mut items = Vec::new();
                            let trimmed = tail.trim();
                            if !trimmed.is_empty() {
                                let data = crate::sse_event_data(trimmed);
                                let data = data.trim();
                                if !data.is_empty() {
                                    match parser.feed_event(data) {
                                        Ok(events) => items.extend(events.into_iter().map(Ok)),
                                        Err(error) => items.push(Err(error)),
                                    }
                                }
                            }
                            if let Some(completed) = parser.finish() {
                                items.push(Ok(completed));
                            }
                            return Some((
                                futures::stream::iter(items),
                                (stream, buffer, parser, done),
                            ));
                        }
                    }
                }
            },
        )
        .flatten(),
    )
}

#[cfg(test)]
mod tests {
    use std::sync::{Arc, Mutex, Once};

    use axum::{
        Router,
        extract::State,
        http::{HeaderMap, StatusCode},
        response::IntoResponse,
        routing::post,
    };
    use pretty_assertions::assert_eq;

    use super::*;
    use crate::ToolDecl;

    fn install_rustls_provider() {
        static ONCE: Once = Once::new();
        ONCE.call_once(|| {
            let _ = rustls::crypto::ring::default_provider().install_default();
        });
    }

    fn turn_with_history() -> ChatTurn {
        ChatTurn {
            system: Some("Be terse.".into()),
            messages: vec![
                ChatMessage {
                    role: Role::User,
                    parts: vec![Part::Text("weather in Paris".into())],
                },
                ChatMessage {
                    role: Role::Model,
                    parts: vec![
                        Part::Reasoning {
                            text: "check the tool".into(),
                            opaque: json!({ "signature": "sig-1" }),
                        },
                        Part::Reasoning {
                            text: "foreign reasoning".into(),
                            opaque: Value::Null,
                        },
                        Part::Text(String::new()),
                        Part::function_call("toolu_1", "get_weather", json!({ "city": "Paris" })),
                    ],
                },
                ChatMessage {
                    role: Role::Tool,
                    parts: vec![Part::function_response(
                        "toolu_1",
                        "get_weather",
                        json!("18°C"),
                    )],
                },
            ],
            tools: vec![ToolDecl {
                name: "get_weather".into(),
                description: "Current weather".into(),
                parameters: json!({ "type": "object", "properties": { "city": { "type": "string" } } }),
            }],
            options: crate::TurnOptions {
                reasoning_effort: Some("high".into()),
                parallel_tool_calls: Some(false),
                ..Default::default()
            },
        }
    }

    #[test]
    fn request_maps_roles_tools_and_call_ids() {
        let body = build_messages_request(&turn_with_history(), "claude-opus-5");
        assert_eq!(body["model"], "claude-opus-5");
        assert_eq!(body["stream"], true);
        assert_eq!(body["max_tokens"], DEFAULT_MAX_OUTPUT_TOKENS);
        assert_eq!(body["system"], "Be terse.");
        assert_eq!(body["thinking"], json!({ "type": "adaptive" }));
        assert_eq!(body["output_config"]["effort"], "high");
        assert_eq!(body["tool_choice"]["disable_parallel_tool_use"], true);
        assert_eq!(body["tools"][0]["name"], "get_weather");
        assert!(body["tools"][0].get("input_schema").is_some());

        let messages = body["messages"].as_array().unwrap();
        assert_eq!(messages.len(), 3);
        assert_eq!(messages[0]["role"], "user");
        assert_eq!(messages[1]["role"], "assistant");
        // Signed thinking replayed, unsigned dropped, empty text dropped.
        let assistant = messages[1]["content"].as_array().unwrap();
        assert_eq!(assistant.len(), 2);
        assert_eq!(assistant[0]["type"], "thinking");
        assert_eq!(assistant[0]["signature"], "sig-1");
        assert_eq!(assistant[1]["type"], "tool_use");
        assert_eq!(assistant[1]["id"], "toolu_1");
        assert_eq!(assistant[1]["input"]["city"], "Paris");
        // Tool results travel in a user message keyed by the call id.
        assert_eq!(messages[2]["role"], "user");
        assert_eq!(messages[2]["content"][0]["type"], "tool_result");
        assert_eq!(messages[2]["content"][0]["tool_use_id"], "toolu_1");
        assert_eq!(messages[2]["content"][0]["content"], "18°C");
    }

    #[test]
    fn request_without_effort_omits_thinking_fields() {
        let turn = ChatTurn {
            messages: vec![ChatMessage {
                role: Role::User,
                parts: vec![Part::Text("hi".into())],
            }],
            ..ChatTurn::default()
        };
        let body = build_messages_request(&turn, "claude-haiku-4-5");
        assert!(body.get("thinking").is_none());
        assert!(body.get("output_config").is_none());
        assert!(body.get("system").is_none());
        assert!(body.get("tools").is_none());
    }

    #[test]
    fn images_and_tool_result_images_use_content_blocks() {
        let turn = ChatTurn {
            messages: vec![
                ChatMessage {
                    role: Role::User,
                    parts: vec![
                        Part::Text("what is this".into()),
                        Part::Image(ImageSource::base64("image/png", "AAAA")),
                    ],
                },
                ChatMessage {
                    role: Role::Tool,
                    parts: vec![Part::FunctionResponse {
                        id: "toolu_9".into(),
                        name: "screenshot".into(),
                        response: json!("captured"),
                        images: vec![ImageSource::Url("https://x/y.png".into())],
                    }],
                },
            ],
            ..ChatTurn::default()
        };
        let body = build_messages_request(&turn, "claude-opus-5");
        let user = &body["messages"][0]["content"];
        assert_eq!(user[1]["type"], "image");
        assert_eq!(user[1]["source"]["media_type"], "image/png");
        let result = &body["messages"][1]["content"][0]["content"];
        assert_eq!(result[0]["type"], "text");
        assert_eq!(result[1]["source"]["type"], "url");
    }

    const STREAM: &[&str] = &[
        r#"{"type":"message_start","message":{"id":"msg_1","usage":{"input_tokens":25,"output_tokens":1,"cache_read_input_tokens":5}}}"#,
        r#"{"type":"content_block_start","index":0,"content_block":{"type":"thinking","thinking":""}}"#,
        r#"{"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"let me"}}"#,
        r#"{"type":"content_block_delta","index":0,"delta":{"type":"signature_delta","signature":"sig-9"}}"#,
        r#"{"type":"content_block_stop","index":0}"#,
        r#"{"type":"content_block_start","index":1,"content_block":{"type":"text","text":""}}"#,
        r#"{"type":"content_block_delta","index":1,"delta":{"type":"text_delta","text":"Checking"}}"#,
        r#"{"type":"content_block_stop","index":1}"#,
        r#"{"type":"content_block_start","index":2,"content_block":{"type":"tool_use","id":"toolu_1","name":"get_weather","input":{}}}"#,
        r#"{"type":"content_block_delta","index":2,"delta":{"type":"input_json_delta","partial_json":"{\"city\":"}}"#,
        r#"{"type":"content_block_delta","index":2,"delta":{"type":"input_json_delta","partial_json":"\"Paris\"}"}}"#,
        r#"{"type":"content_block_stop","index":2}"#,
        r#"{"type":"message_delta","delta":{"stop_reason":"tool_use"},"usage":{"output_tokens":12}}"#,
        r#"{"type":"message_stop"}"#,
    ];

    #[test]
    fn parser_assembles_thinking_text_and_tool_call() {
        let mut parser = MessagesStreamParser::new();
        let mut events = Vec::new();
        for frame in STREAM {
            events.extend(parser.feed_event(frame).unwrap());
        }
        assert_eq!(
            events,
            vec![
                ModelStreamEvent::ReasoningDelta("let me".into()),
                ModelStreamEvent::ReasoningItem {
                    text: "let me".into(),
                    opaque: json!({ "signature": "sig-9" }),
                },
                ModelStreamEvent::TextDelta("Checking".into()),
                ModelStreamEvent::ToolCallDelta {
                    id: Some("toolu_1".into()),
                    name: Some("get_weather".into()),
                    arguments_fragment: String::new(),
                },
                ModelStreamEvent::ToolCallDelta {
                    id: Some("toolu_1".into()),
                    name: None,
                    arguments_fragment: "{\"city\":".into(),
                },
                ModelStreamEvent::ToolCallDelta {
                    id: Some("toolu_1".into()),
                    name: None,
                    arguments_fragment: "\"Paris\"}".into(),
                },
                ModelStreamEvent::ToolCall {
                    id: "toolu_1".into(),
                    name: "get_weather".into(),
                    arguments: json!({ "city": "Paris" }),
                },
                ModelStreamEvent::Completed {
                    usage: Some(TokenUsage {
                        input_tokens: 25,
                        output_tokens: 12,
                        total_tokens: 37,
                        cached_input_tokens: 5,
                        reasoning_output_tokens: 0,
                    }),
                    finish_reason: Some("tool_use".into()),
                },
            ]
        );
        // `message_stop` already completed the turn; a flush adds nothing.
        assert_eq!(parser.finish(), None);
    }

    #[test]
    fn parser_surfaces_error_events_and_bad_tool_json() {
        let mut parser = MessagesStreamParser::new();
        let error = parser
            .feed_event(
                r#"{"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}"#,
            )
            .unwrap_err();
        assert!(
            matches!(error, ModelError::Api { status: 0, ref message } if message == "Overloaded")
        );

        let mut parser = MessagesStreamParser::new();
        parser
            .feed_event(r#"{"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"t","name":"f","input":{}}}"#)
            .unwrap();
        parser
            .feed_event(r#"{"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\"a\":"}}"#)
            .unwrap();
        let error = parser
            .feed_event(r#"{"type":"content_block_stop","index":0}"#)
            .unwrap_err();
        assert!(matches!(error, ModelError::Stream(_)));
    }

    #[derive(Default)]
    struct Seen {
        headers: Mutex<Option<HeaderMap>>,
        body: Mutex<Option<Value>>,
    }

    async fn messages_handler(
        State(seen): State<Arc<Seen>>,
        headers: HeaderMap,
        body: String,
    ) -> impl IntoResponse {
        *seen.headers.lock().unwrap() = Some(headers);
        *seen.body.lock().unwrap() = serde_json::from_str(&body).ok();
        let mut sse = String::new();
        for frame in STREAM {
            let kind: Value = serde_json::from_str(frame).unwrap();
            sse.push_str(&format!(
                "event: {}\ndata: {frame}\n\n",
                kind["type"].as_str().unwrap()
            ));
        }
        (StatusCode::OK, [("content-type", "text/event-stream")], sse)
    }

    async fn serve(seen: Arc<Seen>) -> String {
        let router = Router::new()
            .route("/v1/messages", post(messages_handler))
            .with_state(seen);
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind");
        let address = listener.local_addr().expect("addr");
        tokio::spawn(async move {
            let _ = axum::serve(listener, router).await;
        });
        format!("http://{address}/v1")
    }

    #[tokio::test]
    async fn client_streams_a_tool_turn_from_a_local_messages_server() {
        install_rustls_provider();
        let seen = Arc::new(Seen::default());
        let base = serve(Arc::clone(&seen)).await;

        let mut runtime = ProviderRuntime::keyless(base);
        runtime.bearer_token = Some("sk-ant-test".into());
        let client = AnthropicClient::from_provider(runtime, "claude-opus-5");
        let events: Vec<ModelStreamEvent> = client
            .stream(turn_with_history())
            .await
            .expect("stream")
            .map(|event| event.expect("event"))
            .collect()
            .await;

        assert_eq!(events.first(), Some(&ModelStreamEvent::Created));
        assert!(events.iter().any(|event| matches!(
            event,
            ModelStreamEvent::ToolCall { id, name, .. } if id == "toolu_1" && name == "get_weather"
        )));
        assert!(matches!(
            events.last(),
            Some(ModelStreamEvent::Completed { finish_reason: Some(reason), .. }) if reason == "tool_use"
        ));

        let headers = seen.headers.lock().unwrap().clone().expect("request seen");
        assert_eq!(headers.get("x-api-key").unwrap(), "sk-ant-test");
        assert_eq!(
            headers.get("anthropic-version").unwrap(),
            ANTHROPIC_API_VERSION
        );
        assert!(headers.get("authorization").is_none());
        let body = seen.body.lock().unwrap().clone().expect("body seen");
        assert_eq!(body["model"], "claude-opus-5");
        assert_eq!(body["messages"][2]["content"][0]["tool_use_id"], "toolu_1");
    }

    #[tokio::test]
    async fn bearer_auth_sends_oauth_headers() {
        install_rustls_provider();
        let seen = Arc::new(Seen::default());
        let base = serve(Arc::clone(&seen)).await;

        let mut runtime = ProviderRuntime::keyless(base);
        runtime.bearer_token = Some("oauth-token".into());
        let client = AnthropicClient::from_provider(runtime, "claude-opus-5")
            .with_auth(AnthropicAuth::Bearer);
        let _: Vec<_> = client
            .stream(ChatTurn {
                messages: vec![ChatMessage {
                    role: Role::User,
                    parts: vec![Part::Text("hi".into())],
                }],
                ..ChatTurn::default()
            })
            .await
            .expect("stream")
            .collect()
            .await;

        let headers = seen.headers.lock().unwrap().clone().expect("request seen");
        assert_eq!(headers.get("authorization").unwrap(), "Bearer oauth-token");
        assert_eq!(headers.get("anthropic-beta").unwrap(), ANTHROPIC_OAUTH_BETA);
        assert!(headers.get("x-api-key").is_none());
    }
}
