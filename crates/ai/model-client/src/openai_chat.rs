// SPDX-License-Identifier: Apache-2.0
//! Local OpenAI Chat Completions-compatible streaming adapter.
//!
//! Provides streaming `/v1/chat/completions` support for local, keyless runtimes
//! such as vLLM, llama-server (`llama.cpp`), Ollama, or any OpenAI-compatible
//! endpoint. Maps OpenAI chat streaming deltas into Aphrody's provider-neutral
//! [`ModelStreamEvent`]s.

use async_trait::async_trait;
use futures::{Stream, StreamExt};
use serde_json::{Value, json};

use crate::{
    ChatMessage, ChatTurn, ImageSource, ModelCapabilities, ModelClient, ModelError, ModelStream,
    ModelStreamEvent, OpenAiCompatClient, OpenAiWire, Part, ProviderRuntime, Role, TokenUsage,
    TurnOptions,
};

/// Build an OpenAI Chat Completions request from Aphrody's provider-neutral turn.
///
/// Tool calls and their results are paired through the provider call id
/// ([`Part::FunctionCall`] `id` / [`Part::FunctionResponse`] `id`), never through
/// the function name: two calls to the same tool in one response stay distinct,
/// which strict servers (vLLM, OpenAI) require.
#[must_use]
pub fn build_chat_completions_request(turn: &ChatTurn, model: &str) -> Value {
    let mut messages: Vec<Value> = Vec::new();

    if let Some(system) = &turn.system
        && !system.is_empty()
    {
        messages.push(json!({
            "role": "system",
            "content": system,
        }));
    }

    for message in &turn.messages {
        messages.extend(chat_message_to_openai_messages(message));
    }

    let mut body = json!({
        "model": model,
        "messages": messages,
        "stream": true,
        "stream_options": {
            "include_usage": true
        }
    });

    if !turn.tools.is_empty() {
        let tools: Vec<Value> = turn
            .tools
            .iter()
            .map(|tool| {
                json!({
                    "type": "function",
                    "function": {
                        "name": tool.name,
                        "description": tool.description,
                        "parameters": tool.parameters,
                    }
                })
            })
            .collect();
        body["tools"] = Value::Array(tools);
        if let Some(parallel) = turn.options.parallel_tool_calls {
            body["parallel_tool_calls"] = json!(parallel);
        }
    }

    apply_chat_options(&mut body, &turn.options);
    body
}

/// Project the neutral [`TurnOptions`] onto Chat Completions fields.
fn apply_chat_options(body: &mut Value, options: &TurnOptions) {
    if let Some(temperature) = options.temperature {
        body["temperature"] = json!(temperature);
    }
    if let Some(max) = options.max_output_tokens {
        body["max_tokens"] = json!(max);
    }
    if let Some(effort) = &options.reasoning_effort {
        body["reasoning_effort"] = json!(effort);
    }
    if !options.stop.is_empty() {
        body["stop"] = json!(options.stop);
    }
    if let Some(schema) = &options.response_schema {
        body["response_format"] = json!({
            "type": "json_schema",
            "json_schema": { "name": "response", "schema": schema, "strict": true },
        });
    }
    if let Some(object) = body.as_object_mut() {
        for (key, value) in &options.extra {
            object.insert(key.clone(), value.clone());
        }
    }
}

/// The id to put on the wire for a call: the provider id, or the function name
/// for a legacy history entry recorded before ids were tracked.
fn wire_call_id<'a>(id: &'a str, name: &'a str) -> &'a str {
    if id.is_empty() { name } else { id }
}

/// Render a tool response payload as the string `content` of a `tool` message.
fn tool_response_content(response: &Value) -> String {
    match response {
        Value::String(text) => text.clone(),
        other => other.to_string(),
    }
}

/// `content` for a user message: a plain string when it is text-only (the form
/// every OpenAI-compatible server accepts), the multimodal array otherwise.
fn user_content(texts: &[&str], images: &[&ImageSource]) -> Value {
    if images.is_empty() {
        return json!(texts.join("\n"));
    }
    let mut content: Vec<Value> = Vec::with_capacity(texts.len() + images.len());
    if !texts.is_empty() {
        content.push(json!({ "type": "text", "text": texts.join("\n") }));
    }
    content.extend(
        images
            .iter()
            .map(|image| json!({ "type": "image_url", "image_url": { "url": image.to_url() } })),
    );
    Value::Array(content)
}

/// The `tool` message for one function response; the images it carries are
/// queued in `tool_images` for [`tool_images_message`].
fn tool_message<'a>(
    id: &str,
    name: &str,
    response: &Value,
    images: &'a [ImageSource],
    tool_images: &mut Vec<(String, &'a ImageSource)>,
) -> Value {
    tool_images.extend(images.iter().map(|image| (name.to_string(), image)));
    json!({
        "role": "tool",
        "tool_call_id": wire_call_id(id, name),
        "content": tool_response_content(response),
    })
}

/// Chat Completions has no image slot on `tool` messages, so images a tool
/// produced follow its result in a user message that names their origin.
fn tool_images_message(tool_images: &[(String, &ImageSource)]) -> Option<Value> {
    if tool_images.is_empty() {
        return None;
    }
    let mut names: Vec<&str> = tool_images.iter().map(|(name, _)| name.as_str()).collect();
    names.dedup();
    let label = format!("Image output of tool call(s): {}", names.join(", "));
    let images: Vec<&ImageSource> = tool_images.iter().map(|(_, image)| *image).collect();
    Some(json!({ "role": "user", "content": user_content(&[label.as_str()], &images) }))
}

fn chat_message_to_openai_messages(message: &ChatMessage) -> Vec<Value> {
    match message.role {
        Role::User => {
            let mut texts = Vec::new();
            let mut images = Vec::new();
            let mut tool_messages = Vec::new();
            let mut tool_images = Vec::new();

            for part in &message.parts {
                match part {
                    Part::Text(text) => texts.push(text.as_str()),
                    Part::Image(image) => images.push(image),
                    // A tool result filed under a user message (Gemini-style
                    // history) still has to reach the wire as a `tool` message.
                    Part::FunctionResponse { id, name, response, images } => {
                        tool_messages.push(tool_message(
                            id,
                            name,
                            response,
                            images,
                            &mut tool_images,
                        ));
                    },
                    Part::FunctionCall { .. } | Part::Reasoning { .. } => {},
                }
            }

            let mut result = tool_messages;
            result.extend(tool_images_message(&tool_images));
            if !texts.is_empty() || !images.is_empty() {
                result.push(json!({ "role": "user", "content": user_content(&texts, &images) }));
            }
            result
        },
        Role::Model => {
            let mut text_parts = Vec::new();
            let mut tool_calls = Vec::new();

            for part in &message.parts {
                match part {
                    Part::Text(text) => text_parts.push(text.as_str()),
                    Part::FunctionCall { id, name, args } => {
                        tool_calls.push(json!({
                            "id": wire_call_id(id, name),
                            "type": "function",
                            "function": {
                                "name": name,
                                "arguments": args.to_string(),
                            }
                        }));
                    },
                    // Reasoning is never replayed on this wire: servers that
                    // emit `reasoning_content` reject it on input.
                    Part::Reasoning { .. } | Part::Image(_) | Part::FunctionResponse { .. } => {},
                }
            }

            if text_parts.is_empty() && tool_calls.is_empty() {
                return Vec::new();
            }

            let mut msg = serde_json::Map::new();
            msg.insert("role".to_string(), json!("assistant"));
            if !text_parts.is_empty() {
                msg.insert("content".to_string(), json!(text_parts.join("\n")));
            }
            if !tool_calls.is_empty() {
                msg.insert("tool_calls".to_string(), Value::Array(tool_calls));
            }
            vec![Value::Object(msg)]
        },
        Role::Tool => {
            let mut result = Vec::new();
            let mut tool_images = Vec::new();
            for part in &message.parts {
                if let Part::FunctionResponse { id, name, response, images } = part {
                    result.push(tool_message(id, name, response, images, &mut tool_images));
                }
            }
            result.extend(tool_images_message(&tool_images));
            result
        },
    }
}

/// Process a streaming text chunk, extracting reasoning tokens inside `<think>...</think>`
/// and standard text tokens outside.
fn process_text_chunk(text: &str, in_thinking: &mut bool) -> Vec<ModelStreamEvent> {
    let mut events = Vec::new();
    let mut remainder = text;

    while !remainder.is_empty() {
        if *in_thinking {
            if let Some(end_idx) = remainder.find("</think>") {
                let thinking_part = &remainder[..end_idx];
                if !thinking_part.is_empty() {
                    events.push(ModelStreamEvent::ReasoningDelta(thinking_part.to_string()));
                }
                *in_thinking = false;
                remainder = &remainder[end_idx + "</think>".len()..];
            } else {
                events.push(ModelStreamEvent::ReasoningDelta(remainder.to_string()));
                break;
            }
        } else if let Some(start_idx) = remainder.find("<think>") {
            let text_part = &remainder[..start_idx];
            if !text_part.is_empty() {
                events.push(ModelStreamEvent::TextDelta(text_part.to_string()));
            }
            *in_thinking = true;
            remainder = &remainder[start_idx + "<think>".len()..];
        } else {
            events.push(ModelStreamEvent::TextDelta(remainder.to_string()));
            break;
        }
    }

    events
}

#[derive(Debug, Clone, Default)]
struct PendingToolCall {
    index: usize,
    id: String,
    name: String,
    arguments_buf: String,
}

/// Stateful stream parser for OpenAI Chat Completions SSE frames.
#[derive(Debug, Default)]
pub(crate) struct ChatCompletionsStreamParser {
    in_thinking: bool,
    pending_tool_calls: Vec<PendingToolCall>,
    completed_usage: Option<TokenUsage>,
    completed_finish_reason: Option<String>,
}

impl ChatCompletionsStreamParser {
    /// Create a new stream parser.
    #[must_use]
    pub(crate) fn new() -> Self {
        Self::default()
    }

    /// Feed one SSE data frame payload into the parser, returning any produced events.
    pub(crate) fn feed_event(&mut self, data: &str) -> Result<Vec<ModelStreamEvent>, ModelError> {
        let value: Value = serde_json::from_str(data)?;

        // Standalone error payload
        if let Some(error) = value.get("error") {
            let message = error
                .get("message")
                .and_then(Value::as_str)
                .or_else(|| value.get("message").and_then(Value::as_str))
                .unwrap_or("OpenAI Chat Completions error");
            let status = error.get("code").and_then(Value::as_u64).map_or(502, |c| c as u16);
            return Err(ModelError::Api { status, message: message.to_string() });
        }

        let mut events = Vec::new();

        // Check for root usage (OpenAI stream_options emit a final frame with usage)
        if let Some(usage_obj) = value.get("usage").and_then(Value::as_object) {
            let usage = TokenUsage {
                input_tokens: usage_obj
                    .get("prompt_tokens")
                    .and_then(Value::as_u64)
                    .unwrap_or_default(),
                output_tokens: usage_obj
                    .get("completion_tokens")
                    .and_then(Value::as_u64)
                    .unwrap_or_default(),
                total_tokens: usage_obj
                    .get("total_tokens")
                    .and_then(Value::as_u64)
                    .unwrap_or_default(),
                cached_input_tokens: value
                    .pointer("/usage/prompt_tokens_details/cached_tokens")
                    .and_then(Value::as_u64)
                    .unwrap_or_default(),
                reasoning_output_tokens: value
                    .pointer("/usage/completion_tokens_details/reasoning_tokens")
                    .and_then(Value::as_u64)
                    .unwrap_or_default(),
            };
            self.completed_usage = Some(usage);
        }

        let choice = value.get("choices").and_then(Value::as_array).and_then(|c| c.first());

        if let Some(choice) = choice {
            let delta = choice.get("delta").or_else(|| choice.get("message"));

            if let Some(delta) = delta {
                // 1. Explicit reasoning content (DeepSeek / Qwen / vLLM reasoning)
                let reasoning = delta
                    .get("reasoning_content")
                    .or_else(|| delta.get("reasoning"))
                    .and_then(Value::as_str)
                    .filter(|s| !s.is_empty());
                if let Some(r) = reasoning {
                    events.push(ModelStreamEvent::ReasoningDelta(r.to_string()));
                }

                // 2. Visible text content with <think> tag support
                let content =
                    delta.get("content").and_then(Value::as_str).filter(|s| !s.is_empty());
                if let Some(c) = content {
                    events.extend(process_text_chunk(c, &mut self.in_thinking));
                }

                // 3. Tool call deltas
                if let Some(tool_calls) = delta.get("tool_calls").and_then(Value::as_array) {
                    for tc in tool_calls {
                        events.extend(self.record_tool_call_delta(tc));
                    }
                }
            }

            if let Some(finish_reason) = choice.get("finish_reason").and_then(Value::as_str) {
                self.completed_finish_reason = Some(finish_reason.to_string());
                // Once finish_reason is seen, tool calls are complete
                events.extend(self.flush_tool_calls());
            }
        }

        Ok(events)
    }

    /// Accumulate one `tool_calls[]` delta and surface it as a
    /// [`ModelStreamEvent::ToolCallDelta`] when it carries anything new.
    fn record_tool_call_delta(&mut self, tc: &Value) -> Option<ModelStreamEvent> {
        let index = tc
            .get("index")
            .and_then(Value::as_u64)
            .map(|i| i as usize)
            .unwrap_or(self.pending_tool_calls.len());

        let entry = if let Some(pos) = self.pending_tool_calls.iter().position(|p| p.index == index)
        {
            &mut self.pending_tool_calls[pos]
        } else {
            self.pending_tool_calls.push(PendingToolCall {
                index,
                id: String::new(),
                name: String::new(),
                arguments_buf: String::new(),
            });
            self.pending_tool_calls.last_mut().unwrap()
        };

        if let Some(id) = tc.get("id").and_then(Value::as_str)
            && !id.is_empty()
        {
            entry.id = id.to_string();
        }
        if let Some(name) =
            tc.pointer("/function/name").or_else(|| tc.get("name")).and_then(Value::as_str)
            && !name.is_empty()
        {
            entry.name.push_str(name);
        }
        let mut fragment = String::new();
        if let Some(args) = tc.pointer("/function/arguments").or_else(|| tc.get("arguments")) {
            match args {
                Value::String(s) => fragment.push_str(s),
                other => fragment.push_str(&other.to_string()),
            }
        }
        entry.arguments_buf.push_str(&fragment);

        Some(ModelStreamEvent::ToolCallDelta {
            id: (!entry.id.is_empty()).then(|| entry.id.clone()),
            name: (!entry.name.is_empty()).then(|| entry.name.clone()),
            arguments_fragment: fragment,
        })
    }

    /// Flush all accumulated tool calls as [`ModelStreamEvent::ToolCall`].
    pub(crate) fn flush_tool_calls(&mut self) -> Vec<ModelStreamEvent> {
        let pending = std::mem::take(&mut self.pending_tool_calls);
        let mut events = Vec::with_capacity(pending.len());
        for call in pending {
            let name = if call.name.is_empty() { "unnamed_tool".to_string() } else { call.name };
            // Some local servers omit the call id; mint a unique one so two
            // calls to the same tool never share an id.
            let id = if call.id.is_empty() { crate::generate_call_id(&name) } else { call.id };
            let arguments = if call.arguments_buf.trim().is_empty() {
                Value::Null
            } else {
                serde_json::from_str(&call.arguments_buf)
                    .unwrap_or(Value::String(call.arguments_buf))
            };
            events.push(ModelStreamEvent::ToolCall { id, name, arguments });
        }
        events
    }

    /// Complete the stream on `[DONE]` or stream EOF, emitting tool calls and Completed.
    pub(crate) fn feed_done(&mut self) -> Vec<ModelStreamEvent> {
        let mut events = self.flush_tool_calls();
        if self.completed_finish_reason.is_some() || self.completed_usage.is_some() {
            events.push(ModelStreamEvent::Completed {
                usage: self.completed_usage.take(),
                finish_reason: self.completed_finish_reason.take(),
            });
        }
        events
    }
}

/// Parse one Chat Completions API SSE data payload into neutral model events.
pub fn parse_chat_completions_event(data: &str) -> Result<Vec<ModelStreamEvent>, ModelError> {
    let mut parser = ChatCompletionsStreamParser::new();
    let mut events = parser.feed_event(data)?;
    // For single-event evaluation, flush tool calls immediately
    events.extend(parser.flush_tool_calls());
    // Also emit completed if finish_reason or usage was present in this frame
    if parser.completed_finish_reason.is_some() || parser.completed_usage.is_some() {
        events.push(ModelStreamEvent::Completed {
            usage: parser.completed_usage.take(),
            finish_reason: parser.completed_finish_reason.take(),
        });
    }
    Ok(events)
}

/// Streaming client for a local or OpenAI-compatible `/v1/chat/completions` endpoint.
///
/// Designed for keyless local inference engines such as vLLM, llama-server,
/// Ollama, or any OpenAI-compatible HTTP proxy.
///
/// A convenience over [`OpenAiCompatClient`] for the common "server root +
/// model" case: `base_url` is the server root (`http://127.0.0.1:8080`), the
/// `/v1` segment is added here.
#[derive(Debug, Clone)]
pub struct LocalChatCompletionsClient {
    inner: OpenAiCompatClient,
}

impl LocalChatCompletionsClient {
    /// Construct a client with a local OpenAI-compatible endpoint and model.
    #[must_use]
    pub fn new(base_url: impl Into<String>, model: impl Into<String>) -> Self {
        let root = base_url.into();
        let runtime = ProviderRuntime::keyless(format!("{}/v1", root.trim_end_matches('/')));
        Self { inner: OpenAiCompatClient::from_provider(runtime, OpenAiWire::Chat, model) }
    }
}

#[async_trait]
impl ModelClient for LocalChatCompletionsClient {
    async fn stream(&self, turn: ChatTurn) -> Result<ModelStream, ModelError> {
        self.inner.stream(turn).await
    }

    fn model_id(&self) -> &str {
        self.inner.model_id()
    }

    fn capabilities(&self) -> ModelCapabilities {
        self.inner.capabilities()
    }
}

/// Decode a Chat Completions SSE byte stream into neutral events.
pub(crate) fn chat_completions_sse_stream<S>(
    bytes: S,
) -> impl Stream<Item = Result<ModelStreamEvent, ModelError>> + Send
where
    S: Stream<Item = Result<bytes::Bytes, ModelError>> + Send + 'static,
{
    futures::stream::once(async { Ok(ModelStreamEvent::Created) }).chain(
        futures::stream::unfold(
            (Box::pin(bytes.fuse()), String::new(), ChatCompletionsStreamParser::new(), false),
            |(mut stream, mut buffer, mut parser, mut completed_sent)| async move {
                loop {
                    let frames = crate::split_sse_events(&mut buffer);
                    let mut items = Vec::new();

                    for frame in frames {
                        let data = crate::sse_event_data(&frame);
                        let trimmed = data.trim();
                        if trimmed.is_empty() {
                            continue;
                        }
                        if trimmed == "[DONE]" {
                            if !completed_sent {
                                let done_events = parser.feed_done();
                                if !done_events.is_empty() {
                                    completed_sent = true;
                                    items.extend(done_events.into_iter().map(Ok));
                                }
                            }
                            continue;
                        }
                        match parser.feed_event(trimmed) {
                            Ok(events) => {
                                items.extend(events.into_iter().map(Ok));
                            },
                            Err(error) => items.push(Err(error)),
                        }
                    }

                    if !items.is_empty() {
                        return Some((
                            futures::stream::iter(items),
                            (stream, buffer, parser, completed_sent),
                        ));
                    }

                    match stream.next().await {
                        Some(Ok(chunk)) => match std::str::from_utf8(&chunk) {
                            Ok(text) => buffer.push_str(text),
                            Err(error) => {
                                return Some((
                                    futures::stream::iter(vec![Err(ModelError::Stream(format!(
                                        "invalid utf-8: {error}"
                                    )))]),
                                    (stream, buffer, parser, completed_sent),
                                ));
                            },
                        },
                        Some(Err(error)) => {
                            return Some((
                                futures::stream::iter(vec![Err(error)]),
                                (stream, buffer, parser, completed_sent),
                            ));
                        },
                        None => {
                            let tail = std::mem::take(&mut buffer);
                            let trimmed = tail.trim();
                            let mut final_items = Vec::new();
                            if !trimmed.is_empty() {
                                let data = crate::sse_event_data(trimmed);
                                let d_trimmed = data.trim();
                                if !d_trimmed.is_empty() && d_trimmed != "[DONE]" {
                                    match parser.feed_event(d_trimmed) {
                                        Ok(events) => {
                                            final_items.extend(events.into_iter().map(Ok));
                                        },
                                        Err(error) => final_items.push(Err(error)),
                                    }
                                }
                            }
                            if !completed_sent {
                                let done_events = parser.feed_done();
                                if !done_events.is_empty() {
                                    completed_sent = true;
                                    final_items.extend(done_events.into_iter().map(Ok));
                                } else {
                                    completed_sent = true;
                                    final_items.push(Ok(ModelStreamEvent::Completed {
                                        usage: None,
                                        finish_reason: Some("stop".to_string()),
                                    }));
                                }
                            }
                            if final_items.is_empty() {
                                return None;
                            }
                            return Some((
                                futures::stream::iter(final_items),
                                (stream, String::new(), parser, completed_sent),
                            ));
                        },
                    }
                }
            },
        )
        .flatten(),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ToolDecl;

    #[test]
    fn build_chat_completions_request_matches_standard() {
        let turn = ChatTurn {
            system: Some("You are an expert system.".to_string()),
            messages: vec![
                ChatMessage { role: Role::User, parts: vec![Part::Text("Hello".to_string())] },
                ChatMessage {
                    role: Role::Model,
                    parts: vec![
                        Part::Text("Calling tool".to_string()),
                        Part::function_call("call_7", "shell", json!({ "cmd": "ls" })),
                    ],
                },
                ChatMessage {
                    role: Role::Tool,
                    parts: vec![Part::function_response(
                        "call_7",
                        "shell",
                        json!("file1.rs\nfile2.rs"),
                    )],
                },
            ],
            tools: vec![ToolDecl {
                name: "shell".to_string(),
                description: "Execute shell command".to_string(),
                parameters: json!({
                    "type": "object",
                    "properties": {
                        "cmd": { "type": "string" }
                    },
                    "required": ["cmd"]
                }),
            }],
            options: TurnOptions::default(),
        };

        let req = build_chat_completions_request(&turn, "qwen2.5-coder");
        assert_eq!(req["model"], "qwen2.5-coder");
        assert_eq!(req["stream"], true);
        assert_eq!(req["stream_options"]["include_usage"], true);

        let messages = req["messages"].as_array().unwrap();
        assert_eq!(messages.len(), 4);
        assert_eq!(
            messages[0],
            json!({ "role": "system", "content": "You are an expert system." })
        );
        assert_eq!(messages[1], json!({ "role": "user", "content": "Hello" }));
        assert_eq!(
            messages[2],
            json!({
                "role": "assistant",
                "content": "Calling tool",
                "tool_calls": [{
                    "id": "call_7",
                    "type": "function",
                    "function": {
                        "name": "shell",
                        "arguments": "{\"cmd\":\"ls\"}"
                    }
                }]
            })
        );
        assert_eq!(
            messages[3],
            json!({
                "role": "tool",
                "tool_call_id": "call_7",
                "content": "file1.rs\nfile2.rs"
            })
        );

        let tools = req["tools"].as_array().unwrap();
        assert_eq!(tools.len(), 1);
        assert_eq!(tools[0]["type"], "function");
        assert_eq!(tools[0]["function"]["name"], "shell");
    }

    /// Two calls to the same tool in one response must keep distinct ids, each
    /// paired with its own result — name-keyed pairing collapsed them.
    #[test]
    fn two_parallel_calls_same_tool_keep_distinct_ids() {
        let turn = ChatTurn {
            messages: vec![
                ChatMessage {
                    role: Role::Model,
                    parts: vec![
                        Part::function_call("call_a", "shell", json!({ "cmd": "ls" })),
                        Part::function_call("call_b", "shell", json!({ "cmd": "pwd" })),
                    ],
                },
                ChatMessage {
                    role: Role::Tool,
                    parts: vec![
                        Part::function_response("call_a", "shell", json!("a.rs")),
                        Part::function_response("call_b", "shell", json!("/repo")),
                    ],
                },
            ],
            ..ChatTurn::default()
        };

        let req = build_chat_completions_request(&turn, "m");
        let messages = req["messages"].as_array().unwrap();
        assert_eq!(messages.len(), 3);

        let call_ids: Vec<&str> = messages[0]["tool_calls"]
            .as_array()
            .unwrap()
            .iter()
            .map(|call| call["id"].as_str().unwrap())
            .collect();
        assert_eq!(call_ids, vec!["call_a", "call_b"]);

        assert_eq!(
            messages[1],
            json!({ "role": "tool", "tool_call_id": "call_a", "content": "a.rs" })
        );
        assert_eq!(
            messages[2],
            json!({ "role": "tool", "tool_call_id": "call_b", "content": "/repo" })
        );
    }

    #[test]
    fn user_image_becomes_multimodal_content() {
        let turn = ChatTurn {
            messages: vec![ChatMessage {
                role: Role::User,
                parts: vec![
                    Part::Text("what is this?".to_string()),
                    Part::Image(ImageSource::base64("image/png", "AAAA")),
                ],
            }],
            ..ChatTurn::default()
        };
        let req = build_chat_completions_request(&turn, "m");
        assert_eq!(
            req["messages"][0],
            json!({
                "role": "user",
                "content": [
                    { "type": "text", "text": "what is this?" },
                    { "type": "image_url", "image_url": { "url": "data:image/png;base64,AAAA" } }
                ]
            })
        );
    }

    #[test]
    fn tool_images_follow_the_tool_message_as_user_content() {
        let turn = ChatTurn {
            messages: vec![ChatMessage {
                role: Role::Tool,
                parts: vec![Part::FunctionResponse {
                    id: "call_1".to_string(),
                    name: "computer".to_string(),
                    response: json!({ "output": "screenshot taken" }),
                    images: vec![ImageSource::base64("image/png", "BBBB")],
                }],
            }],
            ..ChatTurn::default()
        };
        let req = build_chat_completions_request(&turn, "m");
        let messages = req["messages"].as_array().unwrap();
        assert_eq!(messages.len(), 2);
        assert_eq!(messages[0]["role"], "tool");
        assert_eq!(messages[0]["tool_call_id"], "call_1");
        assert_eq!(messages[1]["role"], "user");
        assert_eq!(messages[1]["content"][0]["text"], "Image output of tool call(s): computer");
        assert_eq!(messages[1]["content"][1]["image_url"]["url"], "data:image/png;base64,BBBB");
    }

    #[test]
    fn options_map_onto_chat_fields_and_extra_wins() {
        let mut extra = serde_json::Map::new();
        extra.insert("cache_prompt".to_string(), json!(true));
        extra.insert("temperature".to_string(), json!(0.9));
        let turn = ChatTurn {
            messages: vec![ChatMessage {
                role: Role::User,
                parts: vec![Part::Text("hi".to_string())],
            }],
            options: TurnOptions {
                temperature: Some(0.2),
                max_output_tokens: Some(512),
                stop: vec!["</s>".to_string()],
                response_schema: Some(json!({ "type": "object" })),
                extra,
                ..TurnOptions::default()
            },
            ..ChatTurn::default()
        };
        let req = build_chat_completions_request(&turn, "m");
        assert_eq!(req["max_tokens"], 512);
        assert_eq!(req["stop"], json!(["</s>"]));
        assert_eq!(req["response_format"]["type"], "json_schema");
        assert_eq!(req["response_format"]["json_schema"]["schema"], json!({ "type": "object" }));
        assert_eq!(req["cache_prompt"], true);
        // `extra` is merged last.
        assert_eq!(req["temperature"], json!(0.9));
        // No tools declared: the parallel switch is not sent.
        assert!(req.get("parallel_tool_calls").is_none());
    }

    #[test]
    fn missing_provider_ids_get_unique_local_ids() {
        let mut parser = ChatCompletionsStreamParser::new();
        parser
            .feed_event(
                r#"{"choices":[{"delta":{"tool_calls":[
                    {"index":0,"function":{"name":"shell","arguments":"{}"}},
                    {"index":1,"function":{"name":"shell","arguments":"{}"}}
                ]}}]}"#,
            )
            .unwrap();
        let calls = parser.flush_tool_calls();
        let ids: Vec<&str> = calls
            .iter()
            .map(|event| match event {
                ModelStreamEvent::ToolCall { id, .. } => id.as_str(),
                other => panic!("expected ToolCall, got {other:?}"),
            })
            .collect();
        assert_eq!(ids.len(), 2);
        assert_ne!(ids[0], ids[1]);
    }

    #[test]
    fn parse_text_delta_event() {
        let data = r#"{"choices":[{"delta":{"content":"Hello world!"}}]}"#;
        let events = parse_chat_completions_event(data).unwrap();
        assert_eq!(events, vec![ModelStreamEvent::TextDelta("Hello world!".to_string())]);
    }

    #[test]
    fn parse_reasoning_content_event() {
        let data = r#"{"choices":[{"delta":{"reasoning_content":"Thinking carefully..."}}]}"#;
        let events = parse_chat_completions_event(data).unwrap();
        assert_eq!(events, vec![ModelStreamEvent::ReasoningDelta(
            "Thinking carefully...".to_string()
        )]);
    }

    #[test]
    fn parse_think_tag_within_content() {
        let data =
            r#"{"choices":[{"delta":{"content":"<think>Internal plan</think>Visible answer"}}]}"#;
        let events = parse_chat_completions_event(data).unwrap();
        assert_eq!(events, vec![
            ModelStreamEvent::ReasoningDelta("Internal plan".to_string()),
            ModelStreamEvent::TextDelta("Visible answer".to_string()),
        ]);
    }

    #[test]
    fn parse_stream_across_think_tags() {
        let mut parser = ChatCompletionsStreamParser::new();

        let e1 = parser
            .feed_event(r#"{"choices":[{"delta":{"content":"Before <think>Inside"}}]}"#)
            .unwrap();
        assert_eq!(e1, vec![
            ModelStreamEvent::TextDelta("Before ".to_string()),
            ModelStreamEvent::ReasoningDelta("Inside".to_string()),
        ]);

        let e2 = parser
            .feed_event(r#"{"choices":[{"delta":{"content":" reasoning</think> After"}}]}"#)
            .unwrap();
        assert_eq!(e2, vec![
            ModelStreamEvent::ReasoningDelta(" reasoning".to_string()),
            ModelStreamEvent::TextDelta(" After".to_string()),
        ]);
    }

    #[test]
    fn parse_tool_call_event() {
        let data = r#"{
            "choices": [{
                "delta": {
                    "tool_calls": [{
                        "index": 0,
                        "id": "call_abc123",
                        "type": "function",
                        "function": {
                            "name": "read_file",
                            "arguments": "{\"path\":\"src/lib.rs\"}"
                        }
                    }]
                }
            }]
        }"#;
        let events = parse_chat_completions_event(data).unwrap();
        assert_eq!(events.len(), 2);
        assert_eq!(events[0], ModelStreamEvent::ToolCallDelta {
            id: Some("call_abc123".to_string()),
            name: Some("read_file".to_string()),
            arguments_fragment: "{\"path\":\"src/lib.rs\"}".to_string(),
        });
        match &events[1] {
            ModelStreamEvent::ToolCall { id, name, arguments } => {
                assert_eq!(id, "call_abc123");
                assert_eq!(name, "read_file");
                assert_eq!(*arguments, json!({ "path": "src/lib.rs" }));
            },
            other => panic!("expected ToolCall, got {other:?}"),
        }
    }

    #[test]
    fn parse_chunked_tool_calls_stream() {
        let mut parser = ChatCompletionsStreamParser::new();

        // Chunk 1: index 0 with id, name, beginning of args
        let e1 = parser
            .feed_event(
                r#"{"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"calc","arguments":"{\"a\":"}}]}}]}"#,
            )
            .unwrap();
        assert_eq!(e1, vec![ModelStreamEvent::ToolCallDelta {
            id: Some("call_1".to_string()),
            name: Some("calc".to_string()),
            arguments_fragment: "{\"a\":".to_string(),
        }]);

        // Chunk 2: index 0 with end of args
        let e2 = parser
            .feed_event(
                r#"{"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"1}"}}]}}]}"#,
            )
            .unwrap();
        assert_eq!(e2, vec![ModelStreamEvent::ToolCallDelta {
            id: Some("call_1".to_string()),
            name: Some("calc".to_string()),
            arguments_fragment: "1}".to_string(),
        }]);

        // Chunk 3: finish_reason tool_calls
        let e3 = parser.feed_event(r#"{"choices":[{"finish_reason":"tool_calls"}]}"#).unwrap();
        assert_eq!(e3.len(), 1);
        match &e3[0] {
            ModelStreamEvent::ToolCall { id, name, arguments } => {
                assert_eq!(id, "call_1");
                assert_eq!(name, "calc");
                assert_eq!(*arguments, json!({ "a": 1 }));
            },
            other => panic!("expected ToolCall, got {other:?}"),
        }

        // Done: Completed event emitted
        let done = parser.feed_done();
        assert_eq!(done, vec![ModelStreamEvent::Completed {
            usage: None,
            finish_reason: Some("tool_calls".to_string()),
        }]);
    }

    #[test]
    fn parse_completion_with_usage_and_finish_reason() {
        let data = r#"{
            "choices": [{"finish_reason": "stop"}],
            "usage": {
                "prompt_tokens": 15,
                "completion_tokens": 8,
                "total_tokens": 23
            }
        }"#;
        let events = parse_chat_completions_event(data).unwrap();
        assert_eq!(events, vec![ModelStreamEvent::Completed {
            usage: Some(TokenUsage::new(15, 8, 23)),
            finish_reason: Some("stop".to_string()),
        }]);
    }

    #[test]
    fn parse_error_payload() {
        let data = r#"{"error":{"message":"Context length exceeded","code":400}}"#;
        let err = parse_chat_completions_event(data).unwrap_err();
        match err {
            ModelError::Api { status, message } => {
                assert_eq!(status, 400);
                assert_eq!(message, "Context length exceeded");
            },
            other => panic!("expected Api error, got {other:?}"),
        }
    }
}
