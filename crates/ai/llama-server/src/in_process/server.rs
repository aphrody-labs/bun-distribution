// SPDX-License-Identifier: Apache-2.0
//! A loopback OpenAI-compatible endpoint over an [`InProcessLlama`].
//!
//! It exists so the HTTP-shaped entry points (the agent's `base_url` provider config) work
//! without a `llama-server` child. Routes: `GET /health`, `GET /v1/models`,
//! `POST /v1/chat/completions` (streaming and not). The request and chunk conversions are pure
//! functions with their own tests.

use std::{collections::HashMap, net::SocketAddr, sync::Arc};

use aphrody_model_client::{
    ChatMessage, ChatTurn, ImageSource, ModelClient, ModelStreamEvent, Part, Role, ToolDecl,
};
use axum::{
    Json, Router,
    body::{Body, Bytes},
    extract::State,
    http::{StatusCode, header},
    response::{IntoResponse, Response},
    routing::{get, post},
};
use futures::StreamExt;
use serde_json::{Value, json};

use super::InProcessLlama;

/// A running endpoint; dropping it stops the listener.
#[derive(Debug)]
pub struct InProcessServer {
    addr: SocketAddr,
    task: tokio::task::JoinHandle<()>,
}

impl InProcessServer {
    /// Bind `127.0.0.1:0` and serve `engine` from a background task.
    ///
    /// # Errors
    ///
    /// Propagates the bind failure.
    pub async fn start(engine: InProcessLlama) -> std::io::Result<Self> {
        let listener = tokio::net::TcpListener::bind(("127.0.0.1", 0)).await?;
        let addr = listener.local_addr()?;
        let app = Router::new()
            .route("/health", get(|| async { Json(json!({"status": "ok"})) }))
            .route("/v1/models", get(models))
            .route("/v1/chat/completions", post(chat))
            .with_state(Arc::new(engine));
        let task = tokio::spawn(async move {
            if let Err(error) = axum::serve(listener, app).await {
                tracing::warn!(%error, "in-process inference endpoint stopped");
            }
        });
        Ok(Self { addr, task })
    }

    /// The OpenAI-compatible API root (`http://127.0.0.1:PORT/v1`).
    #[must_use]
    pub fn base_url(&self) -> String {
        format!("http://{}/v1", self.addr)
    }
}

impl Drop for InProcessServer {
    fn drop(&mut self) {
        self.task.abort();
    }
}

async fn models(State(engine): State<Arc<InProcessLlama>>) -> Json<Value> {
    Json(json!({
        "object": "list",
        "data": [{"id": engine.model_id(), "object": "model", "owned_by": "aphrody"}],
    }))
}

fn error_response(status: StatusCode, message: &str) -> Response {
    (status, Json(json!({"error": {"message": message, "type": "invalid_request_error"}})))
        .into_response()
}

async fn chat(State(engine): State<Arc<InProcessLlama>>, Json(body): Json<Value>) -> Response {
    let turn = match request_to_turn(&body) {
        Ok(turn) => turn,
        Err(message) => return error_response(StatusCode::BAD_REQUEST, &message),
    };
    let streaming = body.get("stream").and_then(Value::as_bool).unwrap_or(false);
    let model = engine.model_id().to_owned();
    let id = format!("chatcmpl-{}", super::router::new_call_id());
    let created = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |elapsed| elapsed.as_secs());
    let events = match engine.stream(turn).await {
        Ok(events) => events,
        Err(error) => return error_response(StatusCode::INTERNAL_SERVER_ERROR, &error.to_string()),
    };

    if streaming {
        let mut calls = 0_usize;
        let frames = events.filter_map(move |item| {
            let frame = match item {
                Ok(event) => event_to_chunk(&event, &mut calls)
                    .map(|chunk| sse(&envelope(&id, &model, created, chunk))),
                Err(error) => Some(sse(&json!({"error": {"message": error.to_string()}}))),
            };
            std::future::ready(frame)
        });
        let done =
            futures::stream::once(std::future::ready(Bytes::from_static(b"data: [DONE]\n\n")));
        let body = Body::from_stream(frames.chain(done).map(Ok::<_, std::convert::Infallible>));
        return ([(header::CONTENT_TYPE, "text/event-stream")], body).into_response();
    }

    let mut collected = Collected::default();
    let mut events = events;
    while let Some(item) = events.next().await {
        match item {
            Ok(event) => collected.push(&event),
            Err(error) => {
                return error_response(StatusCode::INTERNAL_SERVER_ERROR, &error.to_string());
            },
        }
    }
    Json(collected.into_response_body(&id, &model, created)).into_response()
}

fn sse(value: &Value) -> Bytes {
    Bytes::from(format!("data: {value}\n\n"))
}

/// Wrap a chunk's `delta` / `finish_reason` / `usage` parts into a `chat.completion.chunk`.
fn envelope(id: &str, model: &str, created: u64, chunk: Chunk) -> Value {
    let mut value = json!({
        "id": id,
        "object": "chat.completion.chunk",
        "created": created,
        "model": model,
        "choices": [{"index": 0, "delta": chunk.delta, "finish_reason": chunk.finish_reason}],
    });
    if let Some(usage) = chunk.usage {
        value["usage"] = usage;
    }
    value
}

#[derive(Debug, PartialEq)]
struct Chunk {
    delta: Value,
    finish_reason: Option<String>,
    usage: Option<Value>,
}

/// One unified event as one streaming chunk (`None` = nothing to send).
fn event_to_chunk(event: &ModelStreamEvent, calls: &mut usize) -> Option<Chunk> {
    let delta = |delta: Value| Some(Chunk { delta, finish_reason: None, usage: None });
    match event {
        ModelStreamEvent::Created => delta(json!({"role": "assistant"})),
        ModelStreamEvent::TextDelta(text) => delta(json!({"content": text})),
        ModelStreamEvent::ReasoningDelta(text) => delta(json!({"reasoning_content": text})),
        ModelStreamEvent::ToolCall { id, name, arguments } => {
            let index = *calls;
            *calls += 1;
            delta(json!({"tool_calls": [{
                "index": index,
                "id": id,
                "type": "function",
                "function": {"name": name, "arguments": arguments.to_string()},
            }]}))
        },
        ModelStreamEvent::Completed { usage, finish_reason } => Some(Chunk {
            delta: json!({}),
            finish_reason: Some(finish_reason.clone().unwrap_or_else(|| "stop".to_owned())),
            usage: usage.as_ref().map(|usage| {
                json!({
                    "prompt_tokens": usage.input_tokens,
                    "completion_tokens": usage.output_tokens,
                    "total_tokens": usage.total_tokens,
                })
            }),
        }),
        _ => None,
    }
}

/// The non-streaming accumulation of a whole turn.
#[derive(Default)]
struct Collected {
    content: String,
    reasoning: String,
    calls: Vec<Value>,
    finish_reason: Option<String>,
    usage: Option<Value>,
}

impl Collected {
    fn push(&mut self, event: &ModelStreamEvent) {
        match event {
            ModelStreamEvent::TextDelta(text) => self.content.push_str(text),
            ModelStreamEvent::ReasoningDelta(text) => self.reasoning.push_str(text),
            ModelStreamEvent::ToolCall { id, name, arguments } => self.calls.push(json!({
                "id": id,
                "type": "function",
                "function": {"name": name, "arguments": arguments.to_string()},
            })),
            ModelStreamEvent::Completed { .. } => {
                if let Some(chunk) = event_to_chunk(event, &mut 0) {
                    self.finish_reason = chunk.finish_reason;
                    self.usage = chunk.usage;
                }
            },
            _ => {},
        }
    }

    fn into_response_body(self, id: &str, model: &str, created: u64) -> Value {
        let mut message = json!({"role": "assistant", "content": self.content});
        if !self.reasoning.is_empty() {
            message["reasoning_content"] = json!(self.reasoning);
        }
        if !self.calls.is_empty() {
            message["tool_calls"] = json!(self.calls);
        }
        json!({
            "id": id,
            "object": "chat.completion",
            "created": created,
            "model": model,
            "choices": [{
                "index": 0,
                "message": message,
                "finish_reason": self.finish_reason.unwrap_or_else(|| "stop".to_owned()),
            }],
            "usage": self.usage.unwrap_or_else(|| json!({})),
        })
    }
}

fn content_text(content: &Value) -> String {
    match content {
        Value::String(text) => text.clone(),
        Value::Array(parts) => parts
            .iter()
            .filter_map(|part| part.get("text").and_then(Value::as_str))
            .collect::<Vec<_>>()
            .join("\n"),
        _ => String::new(),
    }
}

/// An OpenAI `image_url` (a string or `{"url": ...}`) as an image source: `data:` URLs become
/// inline base64, everything else (`file://`, a path, `http(s)`) is kept as a reference.
fn image_source(value: &Value) -> Result<ImageSource, String> {
    let url = value
        .as_str()
        .or_else(|| value.get("url").and_then(Value::as_str))
        .ok_or_else(|| "`image_url` needs a `url`".to_owned())?;
    let Some(rest) = url.strip_prefix("data:") else {
        return Ok(ImageSource::Url(url.to_owned()));
    };
    let (meta, data) = rest.split_once(',').ok_or_else(|| "malformed data URL".to_owned())?;
    let mime = meta
        .strip_suffix(";base64")
        .ok_or_else(|| "only base64 data URLs are supported".to_owned())?;
    let mime = if mime.is_empty() { "application/octet-stream" } else { mime };
    Ok(ImageSource::base64(mime, data))
}

/// A message's content as parts: its text (joined, one part) then its images, in order.
fn content_parts(content: Option<&Value>) -> Result<Vec<Part>, String> {
    let Some(content) = content else { return Ok(Vec::new()) };
    let mut parts = Vec::new();
    if let Value::Array(items) = content {
        for item in items {
            if item.get("type").and_then(Value::as_str) == Some("image_url") {
                let source = item
                    .get("image_url")
                    .ok_or_else(|| "`image_url` part without `image_url`".to_owned())?;
                parts.push(Part::Image(image_source(source)?));
            }
        }
    }
    let text = content_text(content);
    if !text.is_empty() || parts.is_empty() {
        parts.insert(0, Part::Text(text));
    }
    Ok(parts)
}

fn json_or_string(text: &str) -> Value {
    serde_json::from_str(text).unwrap_or_else(|_| Value::String(text.to_owned()))
}

/// An OpenAI chat-completions request body as a neutral turn.
fn request_to_turn(body: &Value) -> Result<ChatTurn, String> {
    let messages = body
        .get("messages")
        .and_then(Value::as_array)
        .ok_or_else(|| "`messages` must be an array".to_owned())?;
    let mut turn = ChatTurn::default();
    let mut system = Vec::new();
    let mut call_names: HashMap<String, String> = HashMap::new();
    for message in messages {
        let role = message.get("role").and_then(Value::as_str).unwrap_or("user");
        let text = message.get("content").map(content_text).unwrap_or_default();
        match role {
            "system" | "developer" => system.push(text),
            "assistant" => {
                let mut parts = Vec::new();
                if !text.is_empty() {
                    parts.push(Part::Text(text));
                }
                for call in
                    message.get("tool_calls").and_then(Value::as_array).into_iter().flatten()
                {
                    let id = call.get("id").and_then(Value::as_str).unwrap_or_default().to_owned();
                    let function = call.get("function").unwrap_or(&Value::Null);
                    let name =
                        function.get("name").and_then(Value::as_str).unwrap_or_default().to_owned();
                    let args = function
                        .get("arguments")
                        .and_then(Value::as_str)
                        .map_or_else(|| json!({}), json_or_string);
                    call_names.insert(id.clone(), name.clone());
                    parts.push(Part::function_call(id, name, args));
                }
                turn.messages.push(ChatMessage { role: Role::Model, parts });
            },
            "tool" => {
                let id = message
                    .get("tool_call_id")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_owned();
                let name = call_names.get(&id).cloned().unwrap_or_default();
                turn.messages.push(ChatMessage {
                    role: Role::Tool,
                    parts: vec![Part::function_response(id, name, json_or_string(&text))],
                });
            },
            _ => {
                let parts = content_parts(message.get("content"))?;
                let parts = if parts.is_empty() { vec![Part::Text(text)] } else { parts };
                turn.messages.push(ChatMessage { role: Role::User, parts });
            },
        }
    }
    if !system.is_empty() {
        turn.system = Some(system.join("\n\n"));
    }
    for tool in body.get("tools").and_then(Value::as_array).into_iter().flatten() {
        let function = tool.get("function").unwrap_or(tool);
        if let Some(name) = function.get("name").and_then(Value::as_str) {
            turn.tools.push(ToolDecl {
                name: name.to_owned(),
                description: function
                    .get("description")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_owned(),
                parameters: function.get("parameters").cloned().unwrap_or_else(|| json!({})),
            });
        }
    }
    turn.options.temperature =
        body.get("temperature").and_then(Value::as_f64).map(|value| value as f32);
    turn.options.max_output_tokens = body
        .get("max_completion_tokens")
        .or_else(|| body.get("max_tokens"))
        .and_then(Value::as_u64)
        .and_then(|value| u32::try_from(value).ok());
    turn.options.stop = match body.get("stop") {
        Some(Value::String(stop)) => vec![stop.clone()],
        Some(Value::Array(stops)) => {
            stops.iter().filter_map(Value::as_str).map(str::to_owned).collect()
        },
        _ => Vec::new(),
    };
    Ok(turn)
}

#[cfg(test)]
mod tests {
    use aphrody_model_client::TokenUsage;

    use super::*;

    #[test]
    fn a_request_becomes_a_turn() {
        let turn = request_to_turn(&json!({
            "messages": [
                {"role": "system", "content": "Be brief."},
                {"role": "user", "content": [{"type": "text", "text": "weather?"}]},
                {"role": "assistant", "content": null, "tool_calls": [
                    {"id": "c1", "type": "function",
                     "function": {"name": "get_weather", "arguments": "{\"city\":\"Paris\"}"}}]},
                {"role": "tool", "tool_call_id": "c1", "content": "{\"t\":21}"},
            ],
            "tools": [{"type": "function", "function":
                {"name": "get_weather", "description": "d", "parameters": {"type": "object"}}}],
            "temperature": 0.2,
            "max_tokens": 64,
            "stop": "END",
        }))
        .unwrap();
        assert_eq!(turn.system.as_deref(), Some("Be brief."));
        assert_eq!(turn.messages.len(), 3);
        assert_eq!(turn.tools[0].name, "get_weather");
        assert_eq!(turn.options.max_output_tokens, Some(64));
        assert_eq!(turn.options.stop, vec!["END".to_owned()]);
        assert!(matches!(
            &turn.messages[2].parts[0],
            Part::FunctionResponse { name, response, .. }
                if name == "get_weather" && response == &json!({"t": 21})
        ));
    }

    #[test]
    fn image_parts_accept_data_urls_and_paths() {
        let turn = request_to_turn(&json!({"messages": [{"role": "user", "content": [
            {"type": "text", "text": "what is this?"},
            {"type": "image_url", "image_url": {"url": "data:image/png;base64,AAAA"}},
            {"type": "image_url", "image_url": "/tmp/a.png"},
            {"type": "image_url", "image_url": {"url": "file:///tmp/b.jpg"}},
        ]}]}))
        .unwrap();
        let parts = &turn.messages[0].parts;
        assert_eq!(parts.len(), 4);
        assert!(matches!(&parts[0], Part::Text(text) if text == "what is this?"));
        assert!(matches!(
            &parts[1],
            Part::Image(ImageSource::Base64 { mime, data }) if mime == "image/png" && data == "AAAA"
        ));
        assert!(matches!(&parts[2], Part::Image(ImageSource::Url(url)) if url == "/tmp/a.png"));
        assert!(
            matches!(&parts[3], Part::Image(ImageSource::Url(url)) if url == "file:///tmp/b.jpg")
        );
    }

    #[test]
    fn a_non_base64_data_url_is_rejected() {
        let body = json!({"messages": [{"role": "user", "content": [
            {"type": "image_url", "image_url": {"url": "data:image/png,abc"}}]}]});
        assert!(request_to_turn(&body).is_err());
        let body = json!({"messages": [{"role": "user", "content": [
            {"type": "image_url", "image_url": {}}]}]});
        assert!(request_to_turn(&body).is_err());
    }

    #[test]
    fn messages_are_required() {
        assert!(request_to_turn(&json!({})).is_err());
    }

    #[test]
    fn tool_calls_are_indexed_in_stream_order() {
        let mut calls = 0;
        let call = |name: &str| ModelStreamEvent::ToolCall {
            id: format!("id-{name}"),
            name: name.into(),
            arguments: json!({"a": 1}),
        };
        let first = event_to_chunk(&call("a"), &mut calls).unwrap();
        let second = event_to_chunk(&call("b"), &mut calls).unwrap();
        assert_eq!(first.delta["tool_calls"][0]["index"], 0);
        assert_eq!(second.delta["tool_calls"][0]["index"], 1);
        assert_eq!(first.delta["tool_calls"][0]["function"]["arguments"], "{\"a\":1}");
    }

    #[test]
    fn a_whole_turn_collapses_into_one_completion() {
        let mut collected = Collected::default();
        for event in [
            ModelStreamEvent::Created,
            ModelStreamEvent::ReasoningDelta("think".into()),
            ModelStreamEvent::TextDelta("Hel".into()),
            ModelStreamEvent::TextDelta("lo".into()),
            ModelStreamEvent::Completed {
                usage: Some(TokenUsage::new(3, 2, 5)),
                finish_reason: Some("stop".into()),
            },
        ] {
            collected.push(&event);
        }
        let body = collected.into_response_body("id", "m", 1);
        assert_eq!(body["choices"][0]["message"]["content"], "Hello");
        assert_eq!(body["choices"][0]["message"]["reasoning_content"], "think");
        assert_eq!(body["choices"][0]["finish_reason"], "stop");
        assert_eq!(body["usage"]["total_tokens"], 5);
    }
}
