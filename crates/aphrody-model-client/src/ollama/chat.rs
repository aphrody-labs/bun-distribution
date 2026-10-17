// SPDX-License-Identifier: Apache-2.0
//! `POST /api/chat` mapping: neutral turn -> Ollama request, NDJSON chunks ->
//! unified [`ModelStreamEvent`]s.
//!
//! What differs from the OpenAI-compatible endpoint Ollama also serves:
//!
//! - **Thinking** arrives in its own field (`message.thinking`), never inside
//!   `<think>` tags, and is controlled by `think` (`true`, `false` or a named
//!   level) instead of `reasoning_effort`.
//! - **Tool calls** arrive complete, with `arguments` as a JSON object (there
//!   are no argument fragments to reassemble) and an `id` Ollama mints
//!   itself.
//! - **Continuity**: for a thinking model the follow-up request after a tool
//!   call has to carry the assistant's `thinking`, `content` and `tool_calls`
//!   together (`docs/capabilities/tool-calling.mdx`), so the thinking is
//!   surfaced as a [`ModelStreamEvent::ReasoningItem`] tagged
//!   `{"provider":"ollama"}` and written back onto the assistant message when
//!   the history is replayed. Reasoning items from other providers are dropped.
//! - **Errors** after the response started are a final `{"error": "..."}`
//!   line with HTTP status 200.

use futures::{Stream, StreamExt};
use serde::Deserialize;
use serde_json::{Map, Value, json};

use super::types::{KeepAlive, OllamaChatChunk, Think};
use crate::{
    ChatMessage, ChatTurn, ImageSource, ModelError, ModelStreamEvent, Part, Role, TokenUsage,
    ToolDecl,
    ndjson::{error_line, ndjson_values},
    openai_chat::tool_response_content,
};

/// Client-level defaults applied to every chat request.
///
/// A turn's own [`TurnOptions`](crate::TurnOptions) win over these.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct OllamaChatDefaults {
    /// `keep_alive` sent with every request; `None` leaves the server default
    /// (five minutes).
    pub keep_alive: Option<KeepAlive>,
    /// `think` used when the turn sets no `reasoning_effort`.
    pub think: Option<Think>,
    /// `truncate`: cut the prompt to the context window instead of failing.
    pub truncate: Option<bool>,
    /// `shift`: slide the context window instead of failing when it fills up.
    pub shift: Option<bool>,
    /// Model parameters merged into `options` (`num_ctx`, `top_k`, ...).
    pub options: Map<String, Value>,
}

/// Marker stored in [`Part::Reasoning::opaque`] for thinking produced by Ollama.
const PROVIDER_KEY: &str = "provider";
const PROVIDER_NAME: &str = "ollama";

/// The opaque payload of an Ollama thinking item.
fn reasoning_marker() -> Value {
    json!({ PROVIDER_KEY: PROVIDER_NAME, "field": "thinking" })
}

/// Whether a reasoning item came from this wire.
fn is_ollama_reasoning(opaque: &Value) -> bool {
    opaque.get(PROVIDER_KEY).and_then(Value::as_str) == Some(PROVIDER_NAME)
}

// ---------------------------------------------------------------------------
// Request builder.
// ---------------------------------------------------------------------------

/// Build the `POST /api/chat` JSON body for `turn`.
///
/// Mapping:
///
/// - `system` becomes a leading `system` message;
/// - [`Part::Text`] joins into `content`, [`Part::Image`] base64 data goes to
///   `images` (Ollama takes raw base64; a remote URL has no field and is
///   mentioned in the text instead);
/// - [`Part::FunctionCall`] becomes `tool_calls[{id, function:{index, name,
///   arguments}}]` on the assistant message, with the replayed thinking next to
///   it;
/// - [`Part::FunctionResponse`] becomes a `tool` message carrying `tool_name`
///   and `tool_call_id`; images a tool produced follow in a `user` message;
/// - `temperature`, `max_output_tokens` and `stop` go to `options`
///   (`temperature`, `num_predict`, `stop`), `response_schema` to `format`,
///   `reasoning_effort` to `think`;
/// - [`TurnOptions::extra`](crate::TurnOptions::extra) keys are merged last
///   and win, except an `options` object, which is merged key by key into
///   `options`.
#[must_use]
pub fn build_ollama_chat_request(
    turn: &ChatTurn,
    model: &str,
    defaults: &OllamaChatDefaults,
) -> Value {
    let mut messages: Vec<Value> = Vec::new();
    if let Some(system) = &turn.system
        && !system.is_empty()
    {
        messages.push(json!({ "role": "system", "content": system }));
    }
    for message in &turn.messages {
        messages.extend(message_to_ollama(message));
    }

    let mut body = Map::new();
    body.insert("model".to_string(), json!(model));
    body.insert("messages".to_string(), Value::Array(messages));
    body.insert("stream".to_string(), json!(true));

    if !turn.tools.is_empty() {
        body.insert(
            "tools".to_string(),
            Value::Array(turn.tools.iter().map(tool_to_ollama).collect()),
        );
    }

    let mut options = defaults.options.clone();
    if let Some(temperature) = turn.options.temperature {
        options.insert("temperature".to_string(), json!(temperature));
    }
    if let Some(max) = turn.options.max_output_tokens {
        options.insert("num_predict".to_string(), json!(max));
    }
    if !turn.options.stop.is_empty() {
        options.insert("stop".to_string(), json!(turn.options.stop));
    }
    if !options.is_empty() {
        body.insert("options".to_string(), Value::Object(options));
    }

    if let Some(schema) = &turn.options.response_schema {
        body.insert("format".to_string(), schema.clone());
    }
    if let Some(keep_alive) = &defaults.keep_alive {
        body.insert("keep_alive".to_string(), keep_alive.to_value());
    }
    let think = turn
        .options
        .reasoning_effort
        .as_deref()
        .and_then(Think::from_effort)
        .or_else(|| defaults.think.clone());
    if let Some(think) = think {
        body.insert("think".to_string(), think.to_value());
    }
    if let Some(truncate) = defaults.truncate {
        body.insert("truncate".to_string(), json!(truncate));
    }
    if let Some(shift) = defaults.shift {
        body.insert("shift".to_string(), json!(shift));
    }

    for (key, value) in &turn.options.extra {
        if key == "options"
            && let Value::Object(extra_options) = value
        {
            let target = body
                .entry("options")
                .or_insert_with(|| Value::Object(Map::new()));
            if let Value::Object(map) = target {
                for (name, option) in extra_options {
                    map.insert(name.clone(), option.clone());
                }
            }
        } else {
            body.insert(key.clone(), value.clone());
        }
    }
    Value::Object(body)
}

fn tool_to_ollama(tool: &ToolDecl) -> Value {
    json!({
        "type": "function",
        "function": {
            "name": tool.name,
            "description": tool.description,
            "parameters": tool.parameters,
        }
    })
}

/// Arguments of a call as the JSON object Ollama requires
/// (`ToolCallFunctionArguments` unmarshals an object; anything else is a 400).
/// A string holding a JSON object (a call recorded by another wire) is parsed.
fn ollama_arguments(args: &Value) -> Value {
    match args {
        Value::Object(_) => args.clone(),
        Value::String(text) => match serde_json::from_str::<Value>(text) {
            Ok(parsed @ Value::Object(_)) => parsed,
            _ => json!({}),
        },
        _ => json!({}),
    }
}

fn tool_call_to_ollama(index: usize, id: &str, name: &str, args: &Value) -> Value {
    let mut call = json!({
        "function": { "index": index, "name": name, "arguments": ollama_arguments(args) }
    });
    if !id.is_empty() {
        call["id"] = json!(id);
    }
    call
}

/// The `tool` message for one function response.
fn tool_message(id: &str, name: &str, response: &Value) -> Value {
    let mut message = json!({
        "role": "tool",
        "content": tool_response_content(response),
        "tool_name": name,
    });
    if !id.is_empty() {
        message["tool_call_id"] = json!(id);
    }
    message
}

/// Put an image on a message: base64 data into `images`, a URL (which Ollama
/// cannot fetch) into the text.
fn place_image(image: &ImageSource, images: &mut Vec<String>, notes: &mut Vec<String>) {
    match image {
        ImageSource::Base64 { data, .. } => images.push(data.clone()),
        ImageSource::Url(url) => notes.push(format!("[image: {url}]")),
    }
}

/// Tool results of one message, plus the images they produced.
///
/// `tool` messages have no reliable image slot across prompt templates, so the
/// images follow in a `user` message that names their origin (the same
/// convention as the Chat Completions wire).
#[derive(Default)]
struct ToolResults {
    messages: Vec<Value>,
    tool_names: Vec<String>,
    images: Vec<String>,
    notes: Vec<String>,
}

impl ToolResults {
    fn push(&mut self, id: &str, name: &str, response: &Value, images: &[ImageSource]) {
        self.messages.push(tool_message(id, name, response));
        for image in images {
            self.tool_names.push(name.to_string());
            place_image(image, &mut self.images, &mut self.notes);
        }
    }

    fn into_messages(self) -> Vec<Value> {
        let mut messages = self.messages;
        if !self.images.is_empty() || !self.notes.is_empty() {
            let mut names = self.tool_names;
            names.dedup();
            let mut content = format!("Image output of tool call(s): {}", names.join(", "));
            for note in &self.notes {
                content.push('\n');
                content.push_str(note);
            }
            let mut user = json!({ "role": "user", "content": content });
            if !self.images.is_empty() {
                user["images"] = json!(self.images);
            }
            messages.push(user);
        }
        messages
    }
}

fn message_to_ollama(message: &ChatMessage) -> Vec<Value> {
    match message.role {
        Role::User => user_messages(message),
        Role::Model => assistant_message(message).into_iter().collect(),
        Role::Tool => {
            let mut results = ToolResults::default();
            for part in &message.parts {
                if let Part::FunctionResponse {
                    id,
                    name,
                    response,
                    images,
                } = part
                {
                    results.push(id, name, response, images);
                }
            }
            results.into_messages()
        }
    }
}

fn user_messages(message: &ChatMessage) -> Vec<Value> {
    let mut texts: Vec<String> = Vec::new();
    let mut images: Vec<String> = Vec::new();
    let mut notes: Vec<String> = Vec::new();
    let mut results = ToolResults::default();

    for part in &message.parts {
        match part {
            Part::Text(text) => texts.push(text.clone()),
            Part::Image(image) => place_image(image, &mut images, &mut notes),
            // A tool result filed under a user message (Gemini-style history)
            // still reaches the wire as a `tool` message.
            Part::FunctionResponse {
                id,
                name,
                response,
                images,
            } => {
                results.push(id, name, response, images);
            }
            Part::FunctionCall { .. } | Part::Reasoning { .. } => {}
        }
    }

    let mut out = results.into_messages();
    texts.extend(notes);
    if !texts.is_empty() || !images.is_empty() {
        let mut user = json!({ "role": "user", "content": texts.join("\n") });
        if !images.is_empty() {
            user["images"] = json!(images);
        }
        out.push(user);
    }
    out
}

/// The assistant message of a model turn: text, replayed thinking and calls.
fn assistant_message(message: &ChatMessage) -> Option<Value> {
    let mut texts: Vec<&str> = Vec::new();
    let mut thinking: Vec<&str> = Vec::new();
    let mut calls: Vec<Value> = Vec::new();

    for part in &message.parts {
        match part {
            Part::Text(text) => texts.push(text.as_str()),
            Part::Reasoning { text, opaque } if is_ollama_reasoning(opaque) && !text.is_empty() => {
                thinking.push(text.as_str());
            }
            Part::FunctionCall { id, name, args } => {
                calls.push(tool_call_to_ollama(calls.len(), id, name, args));
            }
            // Foreign reasoning items have no meaning for Ollama; images and
            // tool responses do not belong on an assistant message.
            Part::Reasoning { .. } | Part::Image(_) | Part::FunctionResponse { .. } => {}
        }
    }

    if texts.is_empty() && thinking.is_empty() && calls.is_empty() {
        return None;
    }
    let mut value = json!({ "role": "assistant", "content": texts.join("\n") });
    if !thinking.is_empty() {
        value["thinking"] = json!(thinking.join("\n"));
    }
    if !calls.is_empty() {
        value["tool_calls"] = Value::Array(calls);
    }
    Some(value)
}

// ---------------------------------------------------------------------------
// Stream parser.
// ---------------------------------------------------------------------------

/// Stateful decoder of `/api/chat` NDJSON lines into unified events.
#[derive(Debug, Default)]
pub(crate) struct ChatStreamParser {
    /// Thinking received and not yet closed into a reasoning item.
    thinking: String,
    /// Set once the final `done` line (or an error line) was seen.
    done: bool,
}

impl ChatStreamParser {
    /// Whether the stream is over (final line or error seen).
    pub(crate) fn is_done(&self) -> bool {
        self.done
    }

    /// Close the pending thinking into a [`ModelStreamEvent::ReasoningItem`].
    fn flush_thinking(&mut self, events: &mut Vec<Result<ModelStreamEvent, ModelError>>) {
        if self.thinking.is_empty() {
            return;
        }
        events.push(Ok(ModelStreamEvent::ReasoningItem {
            text: std::mem::take(&mut self.thinking),
            opaque: reasoning_marker(),
        }));
    }

    /// Feed one decoded NDJSON line.
    pub(crate) fn feed(&mut self, value: &Value) -> Vec<Result<ModelStreamEvent, ModelError>> {
        if let Some(message) = error_line(value) {
            self.done = true;
            // The HTTP status was already 200; a mid-stream failure is a bad
            // gateway from the caller's point of view (as on the OpenAI wire).
            return vec![Err(ModelError::Api {
                status: 502,
                message: message.to_string(),
            })];
        }
        let chunk = match OllamaChatChunk::deserialize(value) {
            Ok(chunk) => chunk,
            Err(error) => {
                self.done = true;
                return vec![Err(ModelError::Decode(error))];
            }
        };

        let mut events = Vec::new();
        let message = chunk.message;

        if !message.thinking.is_empty() {
            self.thinking.push_str(&message.thinking);
            events.push(Ok(ModelStreamEvent::ReasoningDelta(message.thinking)));
        }

        // Thinking always precedes the answer: once anything else arrives the
        // reasoning is complete and becomes one item, ahead of the text/calls.
        if !message.content.is_empty() || !message.tool_calls.is_empty() || chunk.done {
            self.flush_thinking(&mut events);
        }
        if !message.content.is_empty() {
            events.push(Ok(ModelStreamEvent::TextDelta(message.content)));
        }
        for call in message.tool_calls {
            let name = if call.function.name.is_empty() {
                "unnamed_tool".to_string()
            } else {
                call.function.name
            };
            let id = if call.id.is_empty() {
                crate::generate_call_id(&name)
            } else {
                call.id
            };
            let arguments = match call.function.arguments {
                Value::Null => json!({}),
                other => other,
            };
            events.push(Ok(ModelStreamEvent::ToolCall {
                id,
                name,
                arguments,
            }));
        }

        if chunk.done {
            self.done = true;
            let metrics = chunk.metrics;
            let usage =
                (metrics.prompt_eval_count > 0 || metrics.eval_count > 0).then(|| TokenUsage {
                    input_tokens: metrics.prompt_eval_count,
                    output_tokens: metrics.eval_count,
                    total_tokens: metrics.prompt_eval_count + metrics.eval_count,
                    cached_input_tokens: metrics.prompt_eval_cached_count.unwrap_or(0),
                    reasoning_output_tokens: 0,
                });
            events.push(Ok(ModelStreamEvent::Completed {
                usage,
                finish_reason: Some(chunk.done_reason.unwrap_or_else(|| "stop".to_string())),
            }));
        }
        events
    }

    /// Called when the body ends: a stream that never reported `done` was cut.
    pub(crate) fn finish(&mut self) -> Vec<Result<ModelStreamEvent, ModelError>> {
        if self.done {
            return Vec::new();
        }
        self.done = true;
        vec![Err(ModelError::Stream(
            "ollama stream ended before the final `done` chunk".to_string(),
        ))]
    }
}

/// Decode an `/api/chat` byte stream into unified events.
///
/// `Created` comes first, then the events of each chunk, then the stream ends
/// after the `done` chunk (anything after it is ignored) or fails if the body
/// ends without one.
pub(crate) fn chat_ndjson_stream<S>(
    bytes: S,
) -> impl Stream<Item = Result<ModelStreamEvent, ModelError>> + Send
where
    S: Stream<Item = Result<bytes::Bytes, ModelError>> + Send + 'static,
{
    let values = ndjson_values(bytes);
    futures::stream::once(async { Ok(ModelStreamEvent::Created) }).chain(
        futures::stream::unfold(
            (Box::pin(values), ChatStreamParser::default(), false),
            |(mut values, mut parser, finished)| async move {
                if finished {
                    return None;
                }
                match values.next().await {
                    Some(Ok(value)) => {
                        let events = parser.feed(&value);
                        let finished = parser.is_done();
                        Some((futures::stream::iter(events), (values, parser, finished)))
                    }
                    Some(Err(error)) => Some((
                        futures::stream::iter(vec![Err(error)]),
                        (values, parser, true),
                    )),
                    None => {
                        let tail = parser.finish();
                        if tail.is_empty() {
                            None
                        } else {
                            Some((futures::stream::iter(tail), (values, parser, true)))
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
    use bytes::Bytes;
    use pretty_assertions::assert_eq;

    use super::*;
    use crate::{ToolDecl, TurnOptions};

    fn user(text: &str) -> ChatMessage {
        ChatMessage {
            role: Role::User,
            parts: vec![Part::Text(text.to_string())],
        }
    }

    fn turn(messages: Vec<ChatMessage>) -> ChatTurn {
        ChatTurn {
            messages,
            ..ChatTurn::default()
        }
    }

    fn body(turn: &ChatTurn) -> Value {
        build_ollama_chat_request(turn, "llama3.2", &OllamaChatDefaults::default())
    }

    #[test]
    fn a_plain_turn_maps_to_the_documented_request() {
        let mut turn = turn(vec![user("why is the sky blue?")]);
        turn.system = Some("be brief".to_string());
        assert_eq!(
            body(&turn),
            json!({
                "model": "llama3.2",
                "messages": [
                    { "role": "system", "content": "be brief" },
                    { "role": "user", "content": "why is the sky blue?" }
                ],
                "stream": true
            })
        );
    }

    /// Replay of `docs/api.md` "Chat request (With history, with tools)" with
    /// thinking: the assistant message keeps thinking, content and calls
    /// together, and the result is a `tool` message naming the tool.
    #[test]
    fn tool_history_keeps_thinking_calls_and_tool_names_together() {
        let history = vec![
            user("what is the weather in Toronto?"),
            ChatMessage {
                role: Role::Model,
                parts: vec![
                    Part::Reasoning {
                        text: "need the weather tool".to_string(),
                        opaque: reasoning_marker(),
                    },
                    // Another provider's reasoning must not leak onto this wire.
                    Part::Reasoning {
                        text: "foreign".to_string(),
                        opaque: json!({ "thoughtSignature": "SIG" }),
                    },
                    Part::function_call("call_a1", "get_weather", json!({ "city": "Toronto" })),
                ],
            },
            ChatMessage {
                role: Role::Tool,
                parts: vec![Part::function_response(
                    "call_a1",
                    "get_weather",
                    json!("11 degrees celsius"),
                )],
            },
        ];
        let mut turn = turn(history);
        turn.tools = vec![ToolDecl {
            name: "get_weather".to_string(),
            description: "Get the weather in a given city".to_string(),
            parameters: json!({
                "type": "object",
                "properties": { "city": { "type": "string" } },
                "required": ["city"]
            }),
        }];
        let request = body(&turn);
        assert_eq!(
            request["messages"][1],
            json!({
                "role": "assistant",
                "content": "",
                "thinking": "need the weather tool",
                "tool_calls": [{
                    "id": "call_a1",
                    "function": {
                        "index": 0,
                        "name": "get_weather",
                        "arguments": { "city": "Toronto" }
                    }
                }]
            })
        );
        assert_eq!(
            request["messages"][2],
            json!({
                "role": "tool",
                "content": "11 degrees celsius",
                "tool_name": "get_weather",
                "tool_call_id": "call_a1"
            })
        );
        assert_eq!(request["tools"][0]["type"], "function");
        assert_eq!(request["tools"][0]["function"]["name"], "get_weather");
    }

    #[test]
    fn two_calls_to_one_tool_keep_their_ids_and_indexes() {
        let turn = turn(vec![
            ChatMessage {
                role: Role::Model,
                parts: vec![
                    Part::function_call("c1", "sh", json!({ "cmd": "ls" })),
                    Part::function_call("c2", "sh", json!("{\"cmd\":\"pwd\"}")),
                ],
            },
            ChatMessage {
                role: Role::Tool,
                parts: vec![
                    Part::function_response("c1", "sh", json!("a.rs")),
                    Part::function_response("c2", "sh", json!("/repo")),
                ],
            },
        ]);
        let request = body(&turn);
        let calls = request["messages"][0]["tool_calls"]
            .as_array()
            .expect("calls");
        assert_eq!(calls[0]["function"]["index"], 0);
        assert_eq!(calls[1]["function"]["index"], 1);
        assert_eq!(calls[1]["id"], "c2");
        // A JSON object recorded as a string by another wire is sent as an object.
        assert_eq!(calls[1]["function"]["arguments"], json!({ "cmd": "pwd" }));
        assert_eq!(request["messages"][1]["tool_call_id"], "c1");
        assert_eq!(request["messages"][2]["tool_call_id"], "c2");
    }

    #[test]
    fn images_go_to_the_images_field_and_urls_to_the_text() {
        let turn = turn(vec![ChatMessage {
            role: Role::User,
            parts: vec![
                Part::Text("what is this?".to_string()),
                Part::Image(ImageSource::base64("image/png", "AAAA")),
                Part::Image(ImageSource::Url("https://example.test/a.png".to_string())),
            ],
        }]);
        assert_eq!(
            body(&turn)["messages"][0],
            json!({
                "role": "user",
                "content": "what is this?\n[image: https://example.test/a.png]",
                "images": ["AAAA"]
            })
        );
    }

    #[test]
    fn tool_images_follow_the_tool_message_in_a_user_message() {
        let turn = turn(vec![ChatMessage {
            role: Role::Tool,
            parts: vec![Part::FunctionResponse {
                id: "c1".to_string(),
                name: "screenshot".to_string(),
                response: json!({ "ok": true }),
                images: vec![ImageSource::base64("image/png", "BBBB")],
            }],
        }]);
        let request = body(&turn);
        assert_eq!(request["messages"][0]["role"], "tool");
        assert_eq!(request["messages"][0]["content"], "{\"ok\":true}");
        assert_eq!(request["messages"][1]["role"], "user");
        assert_eq!(request["messages"][1]["images"], json!(["BBBB"]));
        assert_eq!(
            request["messages"][1]["content"],
            "Image output of tool call(s): screenshot"
        );
    }

    #[test]
    fn options_think_format_and_extra_are_mapped_and_merged() {
        let mut extra = Map::new();
        extra.insert(
            "options".to_string(),
            json!({ "num_ctx": 32768, "temperature": 0.9 }),
        );
        extra.insert("keep_alive".to_string(), json!("30m"));
        let turn = ChatTurn {
            messages: vec![user("hi")],
            options: TurnOptions {
                temperature: Some(0.2),
                max_output_tokens: Some(512),
                stop: vec!["</s>".to_string()],
                reasoning_effort: Some("minimal".to_string()),
                response_schema: Some(json!({ "type": "object" })),
                extra,
                ..TurnOptions::default()
            },
            ..ChatTurn::default()
        };
        let mut defaults = OllamaChatDefaults {
            keep_alive: Some(KeepAlive::Seconds(60)),
            think: Some(Think::On),
            truncate: Some(true),
            ..OllamaChatDefaults::default()
        };
        defaults.options.insert("top_k".to_string(), json!(40));
        let request = build_ollama_chat_request(&turn, "m", &defaults);

        assert_eq!(request["options"]["num_predict"], 512);
        assert_eq!(request["options"]["stop"], json!(["</s>"]));
        assert_eq!(request["options"]["top_k"], 40);
        // `extra.options` is merged key by key and wins.
        assert_eq!(request["options"]["num_ctx"], 32768);
        assert_eq!(request["options"]["temperature"], json!(0.9));
        // The effort on the turn beats the client default; extra beats the client default.
        assert_eq!(request["think"], "low");
        assert_eq!(request["keep_alive"], "30m");
        assert_eq!(request["format"], json!({ "type": "object" }));
        assert_eq!(request["truncate"], true);
    }

    #[test]
    fn the_client_default_think_applies_when_the_turn_has_none() {
        let defaults = OllamaChatDefaults {
            think: Some(Think::Off),
            ..Default::default()
        };
        let request = build_ollama_chat_request(&turn(vec![user("hi")]), "m", &defaults);
        assert_eq!(request["think"], false);
        assert!(body(&turn(vec![user("hi")])).get("think").is_none());
    }

    fn lines(parts: &[&str]) -> impl Stream<Item = Result<Bytes, ModelError>> + Send + 'static {
        let owned: Vec<Result<Bytes, ModelError>> = parts
            .iter()
            .map(|part| Ok(Bytes::from(part.to_string())))
            .collect();
        futures::stream::iter(owned)
    }

    async fn events(parts: &[&str]) -> Vec<Result<ModelStreamEvent, ModelError>> {
        chat_ndjson_stream(lines(parts)).collect().await
    }

    /// A thinking model that reasons, answers and calls a tool.
    #[tokio::test]
    async fn thinking_text_calls_and_usage_map_to_unified_events() {
        let items = events(&[
            "{\"model\":\"m\",\"message\":{\"role\":\"assistant\",\"content\":\"\",\"thinking\":\"Let me \"},\"done\":false}\n",
            "{\"model\":\"m\",\"message\":{\"role\":\"assistant\",\"content\":\"\",\"thinking\":\"check\"},\"done\":false}\n",
            "{\"model\":\"m\",\"message\":{\"role\":\"assistant\",\"content\":\"Sure\"},\"done\":false}\n",
            "{\"model\":\"m\",\"message\":{\"role\":\"assistant\",\"content\":\"\",\"tool_calls\":[{\"id\":\"call_x1\",\"function\":{\"index\":0,\"name\":\"get_weather\",\"arguments\":{\"city\":\"Tokyo\"}}}]},\"done\":false}\n",
            "{\"model\":\"m\",\"message\":{\"role\":\"assistant\",\"content\":\"\"},\"done_reason\":\"stop\",\"done\":true,\"prompt_eval_count\":169,\"prompt_eval_cached_count\":100,\"eval_count\":15}\n",
        ])
        .await
        .into_iter()
        .map(|item| item.expect("event"))
        .collect::<Vec<_>>();

        assert_eq!(
            items,
            vec![
                ModelStreamEvent::Created,
                ModelStreamEvent::ReasoningDelta("Let me ".to_string()),
                ModelStreamEvent::ReasoningDelta("check".to_string()),
                ModelStreamEvent::ReasoningItem {
                    text: "Let me check".to_string(),
                    opaque: reasoning_marker(),
                },
                ModelStreamEvent::TextDelta("Sure".to_string()),
                ModelStreamEvent::ToolCall {
                    id: "call_x1".to_string(),
                    name: "get_weather".to_string(),
                    arguments: json!({ "city": "Tokyo" }),
                },
                ModelStreamEvent::Completed {
                    usage: Some(TokenUsage {
                        input_tokens: 169,
                        output_tokens: 15,
                        total_tokens: 184,
                        cached_input_tokens: 100,
                        reasoning_output_tokens: 0,
                    }),
                    finish_reason: Some("stop".to_string()),
                },
            ]
        );
    }

    #[tokio::test]
    async fn a_call_without_an_id_gets_a_local_one() {
        let items = events(&[
            "{\"message\":{\"content\":\"\",\"tool_calls\":[{\"function\":{\"name\":\"ls\",\"arguments\":{}}}]},\"done\":false}\n",
            "{\"message\":{\"content\":\"\"},\"done\":true}\n",
        ])
        .await;
        let ModelStreamEvent::ToolCall {
            id,
            name,
            arguments,
        } = items[1].as_ref().expect("event").clone()
        else {
            panic!("expected a tool call, got {:?}", items[1]);
        };
        assert!(id.starts_with("call_ls_"), "{id}");
        assert_eq!(name, "ls");
        assert_eq!(arguments, json!({}));
    }

    #[tokio::test]
    async fn a_mid_stream_error_line_fails_the_stream_with_its_message() {
        let items = events(&[
            "{\"message\":{\"content\":\"partial\"},\"done\":false}\n",
            "{\"error\":\"an error was encountered while running the model\"}\n",
            "{\"message\":{\"content\":\"ignored\"},\"done\":false}\n",
        ])
        .await;
        assert_eq!(items.len(), 3, "{items:?}");
        assert!(matches!(items[1], Ok(ModelStreamEvent::TextDelta(_))));
        assert!(matches!(
            items[2],
            Err(ModelError::Api { status: 502, ref message })
                if message == "an error was encountered while running the model"
        ));
    }

    #[tokio::test]
    async fn a_body_that_ends_without_done_is_an_error() {
        let items = events(&["{\"message\":{\"content\":\"partial\"},\"done\":false}\n"]).await;
        assert!(
            matches!(items.last(), Some(Err(ModelError::Stream(_)))),
            "{items:?}"
        );
    }

    #[tokio::test]
    async fn pending_thinking_is_flushed_when_the_turn_ends_without_an_answer() {
        let items = events(&[
            "{\"message\":{\"thinking\":\"only thoughts\"},\"done\":false}\n",
            "{\"message\":{\"content\":\"\"},\"done\":true,\"done_reason\":\"length\"}\n",
        ])
        .await
        .into_iter()
        .map(|item| item.expect("event"))
        .collect::<Vec<_>>();
        assert_eq!(
            items[2],
            ModelStreamEvent::ReasoningItem {
                text: "only thoughts".to_string(),
                opaque: reasoning_marker(),
            }
        );
        assert_eq!(
            items[3],
            ModelStreamEvent::Completed {
                usage: None,
                finish_reason: Some("length".to_string())
            }
        );
    }
}
