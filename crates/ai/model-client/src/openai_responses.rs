// SPDX-License-Identifier: Apache-2.0
//! Local OpenAI Responses-compatible streaming adapter.
//!
//! This is the provider seam used by the Codex architecture: Responses is
//! streamed as SSE and translated into the same neutral events consumed by
//! `aphrody-engine`. It deliberately accepts no API key and is intended for
//! local OpenAI-compatible runtimes such as llama.cpp or Ollama. Gemini
//! remains available through the sibling adapter.
//!
//! A response succeeds only after `response.completed`. Incomplete responses,
//! provider failures and interrupted streams are errors; closing a connection
//! never manufactures a successful completion. HTTP chunks may split UTF-8
//! code points without changing the text delivered to the engine.

use async_trait::async_trait;
use futures::{Stream, StreamExt};
use serde_json::{Value, json};

use crate::{
    ChatMessage, ChatTurn, ImageSource, ModelCapabilities, ModelClient, ModelError, ModelStream,
    ModelStreamEvent, OpenAiCompatClient, OpenAiWire, Part, ProviderRuntime, Role, TokenUsage,
    TurnOptions,
};

/// Build an OpenAI Responses request from Aphrody's provider-neutral turn.
///
/// Function calls and their outputs are paired through `call_id`, taken from
/// the provider call id carried by [`Part::FunctionCall`] /
/// [`Part::FunctionResponse`] — never from the function name.
#[must_use]
pub fn build_responses_request(turn: &ChatTurn, model: &str) -> Value {
    let input: Vec<Value> = turn.messages.iter().flat_map(message_to_items).collect();
    let tools: Vec<Value> = turn
        .tools
        .iter()
        .map(|tool| {
            json!({
                "type": "function",
                "name": tool.name,
                "description": tool.description,
                "parameters": tool.parameters,
                "strict": false,
            })
        })
        .collect();

    let mut body = json!({ "model": model, "input": input, "stream": true });
    if let Some(system) = &turn.system {
        body["instructions"] = Value::String(system.clone());
    }
    if !tools.is_empty() {
        body["tools"] = Value::Array(tools);
        if let Some(parallel) = turn.options.parallel_tool_calls {
            body["parallel_tool_calls"] = json!(parallel);
        }
    }
    apply_responses_options(&mut body, &turn.options);
    body
}

/// Project the neutral [`TurnOptions`] onto Responses fields. The Responses API
/// has no stop-sequence parameter, so [`TurnOptions::stop`] is not sent.
fn apply_responses_options(body: &mut Value, options: &TurnOptions) {
    if let Some(temperature) = options.temperature {
        body["temperature"] = json!(temperature);
    }
    if let Some(max) = options.max_output_tokens {
        body["max_output_tokens"] = json!(max);
    }
    if let Some(effort) = &options.reasoning_effort {
        body["reasoning"] = json!({ "effort": effort });
    }
    if let Some(schema) = &options.response_schema {
        body["text"] = json!({
            "format": { "type": "json_schema", "name": "response", "schema": schema, "strict": true },
        });
    }
    if let Some(object) = body.as_object_mut() {
        for (key, value) in &options.extra {
            object.insert(key.clone(), value.clone());
        }
    }
}

/// The `call_id` to put on the wire: the provider id, or the function name for
/// a legacy history entry recorded before ids were tracked.
fn wire_call_id<'a>(id: &'a str, name: &'a str) -> &'a str {
    if id.is_empty() { name } else { id }
}

fn input_image(image: &ImageSource) -> Value {
    json!({ "type": "input_image", "image_url": image.to_url() })
}

/// Map one neutral message onto Responses input items, preserving part order.
///
/// Consecutive text / image parts of a message are grouped into a single
/// `message` item; function calls, function outputs and replayable reasoning
/// items are items of their own, so a pending group is closed before each.
fn message_to_items(message: &ChatMessage) -> Vec<Value> {
    let (role, text_type) = match message.role {
        Role::Model => ("assistant", "output_text"),
        Role::User | Role::Tool => ("user", "input_text"),
    };

    let mut items = Vec::new();
    let mut content: Vec<Value> = Vec::new();

    for part in &message.parts {
        match part {
            Part::Text(text) => content.push(json!({ "type": text_type, "text": text })),
            Part::Image(image) => content.push(input_image(image)),
            Part::Reasoning { opaque, .. } => {
                // Only a native Responses reasoning item can be replayed.
                if opaque.get("type").and_then(Value::as_str) == Some("reasoning") {
                    flush_content(&mut items, &mut content, role);
                    items.push(opaque.clone());
                }
            },
            Part::FunctionCall { id, name, args } => {
                flush_content(&mut items, &mut content, role);
                items.push(json!({
                    "type": "function_call",
                    "call_id": wire_call_id(id, name),
                    "name": name,
                    "arguments": args.to_string(),
                }));
            },
            Part::FunctionResponse { id, name, response, images } => {
                flush_content(&mut items, &mut content, role);
                let output = match response {
                    Value::String(text) => text.clone(),
                    other => other.to_string(),
                };
                items.push(json!({
                    "type": "function_call_output",
                    "call_id": wire_call_id(id, name),
                    "output": output,
                }));
                if !images.is_empty() {
                    // Local runtimes only accept a string `output`; the images a
                    // tool produced follow it in a user message naming their origin.
                    let mut image_content = vec![json!({
                        "type": "input_text",
                        "text": format!("Image output of tool call: {name}"),
                    })];
                    image_content.extend(images.iter().map(input_image));
                    items.push(json!({ "role": "user", "content": image_content }));
                }
            },
        }
    }
    flush_content(&mut items, &mut content, role);
    items
}

/// Close the pending text / image group as one `message` item.
fn flush_content(items: &mut Vec<Value>, content: &mut Vec<Value>, role: &str) {
    if !content.is_empty() {
        items.push(json!({ "role": role, "content": std::mem::take(content) }));
    }
}

/// A function call whose arguments are complete but whose `output_item.done`
/// (the event carrying the authoritative `call_id`) has not been seen yet.
#[derive(Debug, Clone)]
struct PendingCall {
    item_id: String,
    call_id: Option<String>,
    name: String,
    arguments: String,
}

/// Stateful parser for the Responses SSE event stream.
///
/// `call_id` and `name` of a function call are announced by
/// `response.output_item.added`, its arguments stream through
/// `response.function_call_arguments.delta|done` keyed by `item_id`, and the
/// finished item arrives with `response.output_item.done`. Servers differ in
/// which of these they emit, so a call is emitted exactly once: on
/// `output_item.done` when the server sends it, otherwise when the response
/// completes.
#[derive(Debug, Default)]
pub(crate) struct ResponsesStreamParser {
    /// `item_id` -> (`call_id`, `name`) learned from `output_item.added`.
    announced: Vec<(String, String, String)>,
    pending: Vec<PendingCall>,
    emitted_items: Vec<String>,
}

impl ResponsesStreamParser {
    pub(crate) fn new() -> Self {
        Self::default()
    }

    fn announced(&self, item_id: &str) -> Option<(&str, &str)> {
        self.announced
            .iter()
            .find(|(id, ..)| id == item_id)
            .map(|(_, call_id, name)| (call_id.as_str(), name.as_str()))
    }

    /// Feed one SSE `data:` payload, returning the neutral events it produced.
    pub(crate) fn feed_event(&mut self, data: &str) -> Result<Vec<ModelStreamEvent>, ModelError> {
        let value: Value = serde_json::from_str(data)?;
        let kind = value.get("type").and_then(Value::as_str).unwrap_or_default();
        let str_field = |key: &str| value.get(key).and_then(Value::as_str).unwrap_or_default();

        let events = match kind {
            "response.output_text.delta" => match str_field("delta") {
                "" => Vec::new(),
                delta => vec![ModelStreamEvent::TextDelta(delta.to_owned())],
            },
            "response.reasoning_text.delta" | "response.reasoning_summary_text.delta" => {
                match str_field("delta") {
                    "" => Vec::new(),
                    delta => vec![ModelStreamEvent::ReasoningDelta(delta.to_owned())],
                }
            },
            "response.output_item.added" => {
                let item = value.get("item").unwrap_or(&Value::Null);
                if item.get("type").and_then(Value::as_str) == Some("function_call") {
                    let field =
                        |key: &str| item.get(key).and_then(Value::as_str).unwrap_or_default();
                    let (item_id, call_id, name) = (field("id"), field("call_id"), field("name"));
                    self.announced.push((item_id.to_owned(), call_id.to_owned(), name.to_owned()));
                    vec![ModelStreamEvent::ToolCallDelta {
                        id: (!call_id.is_empty()).then(|| call_id.to_owned()),
                        name: (!name.is_empty()).then(|| name.to_owned()),
                        arguments_fragment: String::new(),
                    }]
                } else {
                    Vec::new()
                }
            },
            "response.function_call_arguments.delta" => {
                let (id, name) = match self.announced(str_field("item_id")) {
                    Some((call_id, name)) => (
                        (!call_id.is_empty()).then(|| call_id.to_owned()),
                        (!name.is_empty()).then(|| name.to_owned()),
                    ),
                    None => (None, None),
                };
                vec![ModelStreamEvent::ToolCallDelta {
                    id,
                    name,
                    arguments_fragment: str_field("delta").to_owned(),
                }]
            },
            "response.function_call_arguments.done" => {
                let item_id = str_field("item_id").to_owned();
                let announced = self.announced(&item_id);
                let call_id = match str_field("call_id") {
                    "" => announced.map(|(call_id, _)| call_id.to_owned()),
                    call_id => Some(call_id.to_owned()),
                }
                .filter(|call_id| !call_id.is_empty());
                let name = match str_field("name") {
                    "" => announced.map(|(_, name)| name.to_owned()).unwrap_or_default(),
                    name => name.to_owned(),
                };
                self.pending.push(PendingCall {
                    item_id,
                    call_id,
                    name,
                    arguments: str_field("arguments").to_owned(),
                });
                Vec::new()
            },
            "response.output_item.done" => {
                let item = value.get("item").unwrap_or(&Value::Null);
                match item.get("type").and_then(Value::as_str) {
                    Some("function_call") => self.finish_function_call(item),
                    Some("reasoning") => vec![ModelStreamEvent::ReasoningItem {
                        text: reasoning_summary_text(item),
                        opaque: item.clone(),
                    }],
                    _ => Vec::new(),
                }
            },
            "response.completed" => {
                let mut events = self.flush_pending();
                let response = value.get("response").unwrap_or(&value);
                events.push(ModelStreamEvent::Completed {
                    usage: response.get("usage").map(parse_usage),
                    finish_reason: response
                        .get("status")
                        .and_then(Value::as_str)
                        .map(str::to_owned),
                });
                events
            },
            "response.incomplete" => {
                let reason = value
                    .pointer("/response/incomplete_details/reason")
                    .and_then(Value::as_str)
                    .unwrap_or("unspecified reason");
                return Err(ModelError::Stream(format!(
                    "OpenAI Responses response incomplete: {reason}"
                )));
            },
            "response.failed" | "error" => {
                let message = value
                    .pointer("/response/error/message")
                    .or_else(|| value.pointer("/error/message"))
                    .or_else(|| value.get("message"))
                    .and_then(Value::as_str)
                    .unwrap_or("OpenAI Responses stream failed");
                return Err(ModelError::Api { status: 502, message: message.to_owned() });
            },
            _ => Vec::new(),
        };
        Ok(events)
    }

    /// Emit the call described by a finished `function_call` item, superseding
    /// any arguments stashed for it.
    fn finish_function_call(&mut self, item: &Value) -> Vec<ModelStreamEvent> {
        let field = |key: &str| item.get(key).and_then(Value::as_str).unwrap_or_default();
        let item_id = field("id");
        if !item_id.is_empty() && self.emitted_items.iter().any(|id| id == item_id) {
            return Vec::new();
        }
        let stashed = self
            .pending
            .iter()
            .position(|call| !item_id.is_empty() && call.item_id == item_id)
            .map(|index| self.pending.remove(index));

        let name = match field("name") {
            "" => stashed.as_ref().map(|call| call.name.clone()).unwrap_or_default(),
            name => name.to_owned(),
        };
        let arguments = match field("arguments") {
            "" => stashed.as_ref().map(|call| call.arguments.clone()).unwrap_or_default(),
            arguments => arguments.to_owned(),
        };
        let call_id = match field("call_id") {
            "" => stashed.and_then(|call| call.call_id),
            call_id => Some(call_id.to_owned()),
        };

        if !item_id.is_empty() {
            self.emitted_items.push(item_id.to_owned());
        }
        vec![tool_call_event(call_id, name, &arguments)]
    }

    /// Emit every call whose `output_item.done` never came.
    pub(crate) fn flush_pending(&mut self) -> Vec<ModelStreamEvent> {
        std::mem::take(&mut self.pending)
            .into_iter()
            .filter(|call| !self.emitted_items.contains(&call.item_id))
            .map(|call| tool_call_event(call.call_id, call.name, &call.arguments))
            .collect()
    }
}

/// Assemble a [`ModelStreamEvent::ToolCall`]. Arguments that are not valid JSON
/// are surfaced as a raw string so the tool-call repair layer can mend them
/// instead of the whole stream failing.
fn tool_call_event(call_id: Option<String>, name: String, arguments: &str) -> ModelStreamEvent {
    let arguments = if arguments.trim().is_empty() {
        Value::Null
    } else {
        serde_json::from_str(arguments).unwrap_or_else(|_| Value::String(arguments.to_owned()))
    };
    let id = call_id.filter(|id| !id.is_empty()).unwrap_or_else(|| crate::generate_call_id(&name));
    ModelStreamEvent::ToolCall { id, name, arguments }
}

/// Concatenate the `summary[].text` entries of a reasoning item.
fn reasoning_summary_text(item: &Value) -> String {
    item.get("summary")
        .and_then(Value::as_array)
        .map(|parts| {
            parts
                .iter()
                .filter_map(|part| part.get("text").and_then(Value::as_str))
                .collect::<Vec<_>>()
                .join("\n")
        })
        .unwrap_or_default()
}

fn parse_usage(usage: &Value) -> TokenUsage {
    let count = |pointer: &str| usage.pointer(pointer).and_then(Value::as_u64).unwrap_or_default();
    TokenUsage {
        input_tokens: count("/input_tokens"),
        output_tokens: count("/output_tokens"),
        total_tokens: count("/total_tokens"),
        cached_input_tokens: count("/input_tokens_details/cached_tokens"),
        reasoning_output_tokens: count("/output_tokens_details/reasoning_tokens"),
    }
}

/// Parse one Responses API SSE data payload into neutral model events.
///
/// Stateless convenience over [`ResponsesStreamParser`]: a function call whose
/// arguments completed in this very payload is emitted immediately.
pub fn parse_responses_event(data: &str) -> Result<Vec<ModelStreamEvent>, ModelError> {
    let mut parser = ResponsesStreamParser::new();
    let mut events = parser.feed_event(data)?;
    events.extend(parser.flush_pending());
    Ok(events)
}

/// Streaming client for a local `/v1/responses` endpoint.
///
/// No API key or cloud authentication is accepted by this type. The endpoint
/// must be a local, OpenAI-compatible runtime selected by the caller.
///
/// A convenience over [`OpenAiCompatClient`]: `base_url` is the server root
/// (`http://127.0.0.1:8080`), the `/v1` segment is added here.
#[derive(Debug, Clone)]
pub struct LocalResponsesClient {
    inner: OpenAiCompatClient,
}

impl LocalResponsesClient {
    /// Construct a client with a local OpenAI-compatible Responses endpoint.
    #[must_use]
    pub fn new(base_url: impl Into<String>, model: impl Into<String>) -> Self {
        let root = base_url.into();
        let runtime = ProviderRuntime::keyless(format!("{}/v1", root.trim_end_matches('/')));
        Self { inner: OpenAiCompatClient::from_provider(runtime, OpenAiWire::Responses, model) }
    }
}

#[async_trait]
impl ModelClient for LocalResponsesClient {
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

/// Decode a batch of raw SSE event blocks through `parser`.
fn frames_to_items(
    parser: &mut ResponsesStreamParser,
    frames: &[String],
    terminal: &mut bool,
) -> Vec<Result<ModelStreamEvent, ModelError>> {
    let mut items = Vec::new();
    for frame in frames {
        let data = crate::sse_event_data(frame);
        let data = data.trim();
        if data.is_empty() || data == "[DONE]" {
            continue;
        }
        match parser.feed_event(data) {
            Ok(events) => {
                *terminal |=
                    events.iter().any(|event| matches!(event, ModelStreamEvent::Completed { .. }));
                items.extend(events.into_iter().map(Ok));
            },
            Err(error) => {
                *terminal = true;
                items.push(Err(error));
            },
        }
        if *terminal {
            break;
        }
    }
    items
}

/// HTTP byte chunks may split a UTF-8 code point. Only complete code points
/// enter the SSE text buffer; the trailing bytes await the next network chunk.
fn append_utf8(buffer: &mut String, pending: &mut Vec<u8>, chunk: &[u8]) -> Result<(), ModelError> {
    pending.extend_from_slice(chunk);
    match std::str::from_utf8(pending) {
        Ok(text) => {
            buffer.push_str(text);
            pending.clear();
        },
        Err(error) if error.error_len().is_none() => {
            let valid = error.valid_up_to();
            // The prefix ending at valid_up_to is guaranteed to be valid UTF-8.
            buffer.push_str(
                std::str::from_utf8(&pending[..valid])
                    .map_err(|error| ModelError::Stream(format!("invalid utf-8: {error}")))?,
            );
            pending.drain(..valid);
        },
        Err(error) => return Err(ModelError::Stream(format!("invalid utf-8: {error}"))),
    }
    Ok(())
}

/// Decode a Responses SSE byte stream into neutral events.
pub(crate) fn responses_sse_stream<S>(
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
                Vec::new(),
                ResponsesStreamParser::new(),
                false,
            ),
            |(mut stream, mut buffer, mut pending_utf8, mut parser, mut ended)| async move {
                if ended {
                    return None;
                }
                loop {
                    // Every complete frame buffered so far is decoded: one
                    // network chunk routinely carries several SSE events.
                    let frames = crate::split_sse_events(&mut buffer);
                    let items = frames_to_items(&mut parser, &frames, &mut ended);
                    if !items.is_empty() {
                        return Some((
                            futures::stream::iter(items),
                            (stream, buffer, pending_utf8, parser, ended),
                        ));
                    }

                    match stream.next().await {
                        Some(Ok(chunk)) => {
                            if let Err(error) = append_utf8(&mut buffer, &mut pending_utf8, &chunk)
                            {
                                ended = true;
                                return Some((
                                    futures::stream::iter(vec![Err(error)]),
                                    (stream, buffer, pending_utf8, parser, ended),
                                ));
                            }
                        },
                        Some(Err(error)) => {
                            ended = true;
                            return Some((
                                futures::stream::iter(vec![Err(error)]),
                                (stream, buffer, pending_utf8, parser, ended),
                            ));
                        },
                        None => {
                            // A final frame may lack its terminating blank line.
                            let tail = std::mem::take(&mut buffer);
                            let mut items = if !pending_utf8.is_empty() {
                                ended = true;
                                vec![Err(ModelError::Stream(
                                    "truncated utf-8 in Responses stream".into(),
                                ))]
                            } else if tail.trim().is_empty() {
                                Vec::new()
                            } else {
                                frames_to_items(&mut parser, &[tail], &mut ended)
                            };
                            if !ended {
                                items.push(Err(ModelError::Stream(
                                    "Responses stream closed before a terminal event".into(),
                                )));
                            }
                            ended = true;
                            return Some((
                                futures::stream::iter(items),
                                (stream, buffer, pending_utf8, parser, ended),
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
    use pretty_assertions::assert_eq;

    use super::*;

    #[test]
    fn responses_text_delta_is_mapped() {
        assert_eq!(
            parse_responses_event(r#"{"type":"response.output_text.delta","delta":"hi"}"#).unwrap(),
            vec![ModelStreamEvent::TextDelta("hi".into())]
        );
    }

    #[test]
    fn responses_function_call_is_mapped() {
        let events = parse_responses_event(r#"{"type":"response.function_call_arguments.done","call_id":"call_1","name":"shell","arguments":"{\"cmd\":\"pwd\"}"}"#).unwrap();
        assert!(
            matches!(&events[0], ModelStreamEvent::ToolCall { id, name, arguments } if id == "call_1" && name == "shell" && arguments["cmd"] == "pwd")
        );
    }

    /// The real OpenAI sequence: `call_id` only appears on the item events, the
    /// arguments events are keyed by `item_id`. The call must surface once, with
    /// the provider `call_id`.
    #[test]
    fn function_call_uses_call_id_from_output_item_and_emits_once() {
        let mut parser = ResponsesStreamParser::new();
        let added = parser
            .feed_event(r#"{"type":"response.output_item.added","item":{"type":"function_call","id":"fc_1","call_id":"call_9","name":"shell","arguments":""}}"#)
            .unwrap();
        assert_eq!(
            added,
            vec![ModelStreamEvent::ToolCallDelta {
                id: Some("call_9".into()),
                name: Some("shell".into()),
                arguments_fragment: String::new(),
            }]
        );

        let delta = parser
            .feed_event(r#"{"type":"response.function_call_arguments.delta","item_id":"fc_1","delta":"{\"cmd\":"}"#)
            .unwrap();
        assert_eq!(
            delta,
            vec![ModelStreamEvent::ToolCallDelta {
                id: Some("call_9".into()),
                name: Some("shell".into()),
                arguments_fragment: "{\"cmd\":".into(),
            }]
        );

        let args_done = parser
            .feed_event(r#"{"type":"response.function_call_arguments.done","item_id":"fc_1","arguments":"{\"cmd\":\"ls\"}"}"#)
            .unwrap();
        assert!(args_done.is_empty(), "the call waits for output_item.done");

        let item_done = parser
            .feed_event(r#"{"type":"response.output_item.done","item":{"type":"function_call","id":"fc_1","call_id":"call_9","name":"shell","arguments":"{\"cmd\":\"ls\"}"}}"#)
            .unwrap();
        assert_eq!(
            item_done,
            vec![ModelStreamEvent::ToolCall {
                id: "call_9".into(),
                name: "shell".into(),
                arguments: json!({ "cmd": "ls" }),
            }]
        );

        let completed = parser
            .feed_event(r#"{"type":"response.completed","response":{"status":"completed","usage":{"input_tokens":10,"output_tokens":4,"total_tokens":14,"input_tokens_details":{"cached_tokens":6},"output_tokens_details":{"reasoning_tokens":2}}}}"#)
            .unwrap();
        assert_eq!(
            completed,
            vec![ModelStreamEvent::Completed {
                usage: Some(TokenUsage {
                    input_tokens: 10,
                    output_tokens: 4,
                    total_tokens: 14,
                    cached_input_tokens: 6,
                    reasoning_output_tokens: 2,
                }),
                finish_reason: Some("completed".into()),
            }]
        );
    }

    /// A server that never sends `output_item.done` still gets its call out
    /// when the response completes, with the id announced by `output_item.added`.
    #[test]
    fn pending_call_is_flushed_on_completion() {
        let mut parser = ResponsesStreamParser::new();
        parser
            .feed_event(r#"{"type":"response.output_item.added","item":{"type":"function_call","id":"fc_2","call_id":"call_2","name":"read_file"}}"#)
            .unwrap();
        parser
            .feed_event(r#"{"type":"response.function_call_arguments.done","item_id":"fc_2","arguments":"{\"path\":\"a\"}"}"#)
            .unwrap();
        let events = parser
            .feed_event(r#"{"type":"response.completed","response":{"status":"completed"}}"#)
            .unwrap();
        assert_eq!(
            events,
            vec![
                ModelStreamEvent::ToolCall {
                    id: "call_2".into(),
                    name: "read_file".into(),
                    arguments: json!({ "path": "a" }),
                },
                ModelStreamEvent::Completed {
                    usage: None,
                    finish_reason: Some("completed".into())
                },
            ]
        );
    }

    #[test]
    fn malformed_arguments_surface_as_raw_string() {
        let events = parse_responses_event(r#"{"type":"response.function_call_arguments.done","call_id":"c","name":"shell","arguments":"{cmd: ls"}"#).unwrap();
        assert_eq!(
            events,
            vec![ModelStreamEvent::ToolCall {
                id: "c".into(),
                name: "shell".into(),
                arguments: Value::String("{cmd: ls".into()),
            }]
        );
    }

    #[test]
    fn reasoning_item_round_trips_verbatim() {
        let item = json!({
            "type": "reasoning",
            "id": "rs_1",
            "summary": [{ "type": "summary_text", "text": "plan" }],
            "encrypted_content": "gAAAA",
        });
        let payload = json!({ "type": "response.output_item.done", "item": item }).to_string();
        let events = parse_responses_event(&payload).unwrap();
        assert_eq!(
            events,
            vec![ModelStreamEvent::ReasoningItem { text: "plan".into(), opaque: item.clone() }]
        );

        let turn = ChatTurn {
            messages: vec![ChatMessage {
                role: Role::Model,
                parts: vec![
                    Part::Reasoning { text: "plan".into(), opaque: item.clone() },
                    Part::function_call("call_1", "shell", json!({ "cmd": "ls" })),
                ],
            }],
            ..ChatTurn::default()
        };
        let request = build_responses_request(&turn, "m");
        assert_eq!(request["input"][0], item);
        assert_eq!(request["input"][1]["call_id"], "call_1");
    }

    #[test]
    fn request_pairs_parallel_calls_by_call_id_and_carries_images() {
        let turn = ChatTurn {
            system: Some("sys".into()),
            messages: vec![
                ChatMessage {
                    role: Role::User,
                    parts: vec![
                        Part::Text("look".into()),
                        Part::Image(ImageSource::base64("image/png", "AAAA")),
                    ],
                },
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
                        Part::FunctionResponse {
                            id: "call_b".into(),
                            name: "shell".into(),
                            response: json!({ "output": "/repo" }),
                            images: vec![ImageSource::Url("https://example.test/s.png".into())],
                        },
                    ],
                },
            ],
            ..ChatTurn::default()
        };
        let request = build_responses_request(&turn, "m");
        assert_eq!(request["instructions"], "sys");
        let input = request["input"].as_array().unwrap();
        assert_eq!(
            input[0],
            json!({
                "role": "user",
                "content": [
                    { "type": "input_text", "text": "look" },
                    { "type": "input_image", "image_url": "data:image/png;base64,AAAA" }
                ]
            })
        );
        assert_eq!(input[1]["call_id"], "call_a");
        assert_eq!(input[2]["call_id"], "call_b");
        assert_eq!(
            input[3],
            json!({
                "type": "function_call_output", "call_id": "call_a", "output": "a.rs"
            })
        );
        assert_eq!(input[4]["call_id"], "call_b");
        assert_eq!(input[4]["output"], "{\"output\":\"/repo\"}");
        assert_eq!(
            input[5]["content"][1],
            json!({
                "type": "input_image", "image_url": "https://example.test/s.png"
            })
        );
    }

    #[test]
    fn failed_response_is_an_api_error() {
        let error = parse_responses_event(
            r#"{"type":"response.failed","response":{"error":{"message":"context too long"}}}"#,
        )
        .unwrap_err();
        assert!(matches!(error, ModelError::Api { message, .. } if message == "context too long"));
    }

    /// Regression: several SSE events arriving in one network chunk must all be
    /// decoded (only the first one used to survive).
    #[tokio::test]
    async fn every_frame_of_a_chunk_is_decoded() {
        let chunk = concat!(
            "data: {\"type\":\"response.output_text.delta\",\"delta\":\"a\"}\n\n",
            "data: {\"type\":\"response.output_text.delta\",\"delta\":\"b\"}\n\n",
            "data: {\"type\":\"response.completed\",\"response\":{\"status\":\"completed\"}}\n\n",
        );
        let bytes = futures::stream::iter(vec![Ok::<bytes::Bytes, ModelError>(
            bytes::Bytes::from_static(chunk.as_bytes()),
        )]);
        let events: Vec<ModelStreamEvent> =
            responses_sse_stream(bytes).map(Result::unwrap).collect().await;
        assert_eq!(
            events,
            vec![
                ModelStreamEvent::Created,
                ModelStreamEvent::TextDelta("a".into()),
                ModelStreamEvent::TextDelta("b".into()),
                ModelStreamEvent::Completed {
                    usage: None,
                    finish_reason: Some("completed".into())
                },
            ]
        );
    }

    #[tokio::test]
    async fn stream_closed_without_terminal_event_is_an_error() {
        let chunk = "data: {\"type\":\"response.output_text.delta\",\"delta\":\"a\"}";
        let bytes = futures::stream::iter(vec![Ok::<bytes::Bytes, ModelError>(
            bytes::Bytes::from_static(chunk.as_bytes()),
        )]);
        let events: Vec<Result<ModelStreamEvent, ModelError>> =
            responses_sse_stream(bytes).collect().await;
        assert_eq!(events.len(), 3);
        assert!(matches!(events[0], Ok(ModelStreamEvent::Created)));
        assert!(matches!(&events[1], Ok(ModelStreamEvent::TextDelta(text)) if text == "a"));
        assert!(matches!(&events[2], Err(ModelError::Stream(message))
            if message.contains("before a terminal event")));
    }

    #[tokio::test]
    async fn utf8_code_points_split_across_every_byte_are_preserved() {
        let payload = concat!(
            "data: {\"type\":\"response.output_text.delta\",\"delta\":\"Réponse 日本語 🐉\"}\r\n\r\n",
            "data: {\"type\":\"response.completed\",\"response\":{\"status\":\"completed\"}}\n\n",
        );
        let bytes = futures::stream::iter(
            payload
                .as_bytes()
                .iter()
                .map(|byte| Ok::<_, ModelError>(bytes::Bytes::copy_from_slice(&[*byte])))
                .collect::<Vec<_>>(),
        );
        let events: Vec<ModelStreamEvent> =
            responses_sse_stream(bytes).map(Result::unwrap).collect().await;
        assert_eq!(
            events,
            vec![
                ModelStreamEvent::Created,
                ModelStreamEvent::TextDelta("Réponse 日本語 🐉".into()),
                ModelStreamEvent::Completed {
                    usage: None,
                    finish_reason: Some("completed".into())
                },
            ]
        );
    }

    #[tokio::test]
    async fn terminal_completion_does_not_wait_for_the_connection_to_close() {
        let payload =
            "data: {\"type\":\"response.completed\",\"response\":{\"status\":\"completed\"}}\n\n";
        let bytes = futures::stream::once(async move {
            Ok::<_, ModelError>(bytes::Bytes::from_static(payload.as_bytes()))
        })
        .chain(futures::stream::pending());
        let events: Vec<_> = tokio::time::timeout(
            std::time::Duration::from_secs(1),
            responses_sse_stream(bytes).collect(),
        )
        .await
        .expect("terminal event ends the stream");
        assert_eq!(events.len(), 2);
        assert!(matches!(events[1], Ok(ModelStreamEvent::Completed { .. })));
    }

    #[tokio::test]
    async fn failure_is_terminal_even_when_followed_by_success_frames() {
        let payload = concat!(
            "data: {\"type\":\"response.failed\",\"response\":{\"error\":{\"message\":\"failed\"}}}\n\n",
            "data: {\"type\":\"response.completed\",\"response\":{\"status\":\"completed\"}}\n\n",
        );
        let bytes = futures::stream::iter(vec![
            Ok::<_, ModelError>(bytes::Bytes::from_static(payload.as_bytes())),
            Ok(bytes::Bytes::from_static(
                b"data: {\"type\":\"response.output_text.delta\",\"delta\":\"late\"}\n\n",
            )),
        ]);
        let events: Vec<_> = responses_sse_stream(bytes).collect().await;
        assert_eq!(events.len(), 2);
        assert!(matches!(&events[1], Err(ModelError::Api { message, .. }) if message == "failed"));
    }

    #[tokio::test]
    async fn incomplete_response_is_not_a_successful_completion() {
        let bytes = futures::stream::iter(vec![Ok::<_, ModelError>(bytes::Bytes::from_static(
            b"data: {\"type\":\"response.incomplete\",\"response\":{\"status\":\"incomplete\",\"incomplete_details\":{\"reason\":\"max_output_tokens\"}}}\n\n",
        ))]);
        let events: Vec<_> = responses_sse_stream(bytes).collect().await;
        assert_eq!(events.len(), 2);
        assert!(matches!(&events[1], Err(ModelError::Stream(message))
            if message.contains("max_output_tokens")));
    }

    #[tokio::test]
    async fn transport_and_encoding_failures_never_synthesize_completion() {
        let sequences = [
            vec![
                Err(ModelError::Stream("connection reset".into())),
                Ok(bytes::Bytes::from_static(b"data: {\"type\":\"response.completed\"}\n\n")),
            ],
            vec![Ok(bytes::Bytes::from_static(&[0xff]))],
            vec![Ok(bytes::Bytes::from_static(&[0xe6, 0x97]))],
        ];
        for chunks in sequences {
            let events: Vec<_> =
                responses_sse_stream(futures::stream::iter(chunks)).collect().await;
            assert_eq!(events.len(), 2);
            assert!(matches!(events[0], Ok(ModelStreamEvent::Created)));
            assert!(matches!(events[1], Err(ModelError::Stream(_))));
        }
    }
}
