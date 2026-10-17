// SPDX-License-Identifier: Apache-2.0
//! `aphrody-model-client` — provider abstraction for the aphrody agent engine.
//!
//! This crate gives the turn loop a provider-agnostic surface:
//!
//! - [`ModelClient`] — an `async_trait` object-safe trait every backend (Gemini REST, gemini-web,
//!   agy) implements.
//! - [`ModelStreamEvent`] — a unified streaming event (text delta, reasoning delta, tool call,
//!   completion with token usage) that hides the wire format of the underlying API.
//! - Neutral request types ([`ChatTurn`], [`ChatMessage`], [`Part`], …) that describe a
//!   conversation turn without leaking any vendor schema.
//! - [`GeminiClient`] — a concrete client that maps Google's `:streamGenerateContent?alt=sse` wire
//!   onto the unified events.
//!
//! The Gemini wire mapping follows the OpenAI/Gemini delta table in
//! `docs/plans/gemini-codex.md` (§3) and the SSE pattern in
//! `var/codex/codex-rs/codex-api/src/sse/`.
//!
//! This crate is **host-only** (it pulls in `reqwest`); it is not part of the
//! wasm matrix.

#![forbid(unsafe_code)]

use std::pin::Pin;

use aphrody_toolcall::sanitize_gemini_json_schema;
use async_trait::async_trait;
use futures::{Stream, StreamExt};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

mod anthropic;
pub mod http;
pub mod ndjson;
pub mod ollama;
mod openai_chat;
pub mod openai_compat;
mod openai_responses;
pub mod rerank;
pub mod vllm;

pub use anthropic::{
    ANTHROPIC_API_VERSION, ANTHROPIC_OAUTH_BETA, AnthropicAuth, AnthropicClient,
    DEFAULT_MAX_OUTPUT_TOKENS, MessagesStreamParser, build_messages_request,
};
pub use ollama::{OllamaApi, OllamaClient, Think, ollama_host_to_url};
pub use openai_chat::{
    LocalChatCompletionsClient, build_chat_completions_request, parse_chat_completions_event,
};
pub use openai_compat::{
    DEFAULT_REQUEST_MAX_RETRIES, DEFAULT_STREAM_IDLE_TIMEOUT, OpenAiCompatClient, OpenAiWire,
    ProviderRuntime, merge_options,
};
pub use openai_responses::{LocalResponsesClient, build_responses_request, parse_responses_event};
pub use rerank::{EmbedClient, RerankClient, RerankHit};
pub use vllm::{VllmApi, VllmClient, VllmConfig};

/// Errors surfaced by a [`ModelClient`] or the pure wire helpers.
#[derive(Debug, thiserror::Error)]
pub enum ModelError {
    /// Transport-level failure issuing the request or reading the body.
    #[error("http transport error: {0}")]
    Http(#[from] reqwest::Error),
    /// A JSON payload (SSE frame or response body) failed to deserialize.
    #[error("json decode error: {0}")]
    Decode(#[from] serde_json::Error),
    /// The provider returned a non-success status with an error payload.
    #[error("provider api error (status {status}): {message}")]
    Api {
        /// HTTP status code returned by the provider.
        status: u16,
        /// Human-readable message extracted from the error body.
        message: String,
    },
    /// The byte stream broke or produced a malformed event.
    #[error("stream error: {0}")]
    Stream(String),
}

/// Token accounting reported by the provider at the end of a turn.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct TokenUsage {
    /// Tokens consumed by the prompt (input).
    pub input_tokens: u64,
    /// Tokens produced by the model (output / candidates).
    pub output_tokens: u64,
    /// Total tokens billed for the turn.
    pub total_tokens: u64,
    /// Portion of `input_tokens` served from the provider's prompt cache
    /// (0 when the provider does not report it).
    pub cached_input_tokens: u64,
    /// Portion of `output_tokens` spent on hidden reasoning (0 when the
    /// provider does not report it).
    pub reasoning_output_tokens: u64,
}

impl TokenUsage {
    /// Usage with only the three universally-reported counters set.
    #[must_use]
    pub fn new(input_tokens: u64, output_tokens: u64, total_tokens: u64) -> Self {
        Self {
            input_tokens,
            output_tokens,
            total_tokens,
            ..Self::default()
        }
    }
}

/// A single unified streaming event emitted while a turn is being generated.
#[derive(Debug, Clone, PartialEq)]
pub enum ModelStreamEvent {
    /// The stream has been opened; emitted once before any content.
    Created,
    /// An incremental chunk of assistant-visible text.
    TextDelta(String),
    /// An incremental chunk of model reasoning / "thinking" text.
    ReasoningDelta(String),
    /// A finished reasoning item the provider expects to see replayed verbatim
    /// on the next request (OpenAI Responses `reasoning` items with
    /// `encrypted_content`, Gemini `thoughtSignature`, Anthropic thinking
    /// signatures). The engine stores it as a [`Part::Reasoning`].
    ReasoningItem {
        /// Human-readable reasoning text or summary (may be empty).
        text: String,
        /// Provider-native payload to round-trip unchanged.
        opaque: Value,
    },
    /// An incremental fragment of a tool call still being generated. Purely
    /// informational (live UIs render it); the authoritative, fully-assembled
    /// call always arrives later as [`ModelStreamEvent::ToolCall`].
    ToolCallDelta {
        /// Provider call id, once known.
        id: Option<String>,
        /// Function name, once known.
        name: Option<String>,
        /// Raw fragment of the JSON arguments text.
        arguments_fragment: String,
    },
    /// The model requested a tool / function invocation.
    ToolCall {
        /// Stable id for this call (generated locally when the provider has none).
        id: String,
        /// Declared name of the function the model wants to invoke.
        name: String,
        /// JSON arguments object for the call.
        arguments: Value,
    },
    /// The turn finished; carries optional usage + finish reason.
    Completed {
        /// Token accounting, when the provider reports it.
        usage: Option<TokenUsage>,
        /// Provider-specific finish reason (e.g. `STOP`, `MAX_TOKENS`).
        finish_reason: Option<String>,
    },
}

/// Role of a message in a [`ChatTurn`].
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Role {
    /// End-user input.
    User,
    /// Prior model output.
    Model,
    /// Output of a tool / function execution fed back to the model.
    Tool,
}

impl Role {
    /// Gemini `contents[].role` wire string.
    ///
    /// Gemini only knows `user` and `model`; tool results are carried inside a
    /// `user`-role turn via `functionResponse` parts.
    #[must_use]
    fn as_gemini_role(self) -> &'static str {
        match self {
            Role::User | Role::Tool => "user",
            Role::Model => "model",
        }
    }
}

/// Where the bytes of an image handed to the model live.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ImageSource {
    /// Inline bytes, base64-encoded (standard alphabet, no `data:` prefix).
    Base64 {
        /// IANA media type (`image/png`, `image/jpeg`, …).
        mime: String,
        /// The encoded payload.
        data: String,
    },
    /// A remote `http(s)` URL the provider fetches itself.
    Url(String),
}

impl ImageSource {
    /// Inline image from a media type and an already-encoded base64 payload.
    #[must_use]
    pub fn base64(mime: impl Into<String>, data: impl Into<String>) -> Self {
        Self::Base64 {
            mime: mime.into(),
            data: data.into(),
        }
    }

    /// The `image_url` string OpenAI-compatible wires expect: a `data:` URL for
    /// inline bytes, the URL itself otherwise.
    #[must_use]
    pub fn to_url(&self) -> String {
        match self {
            Self::Base64 { mime, data } => format!("data:{mime};base64,{data}"),
            Self::Url(url) => url.clone(),
        }
    }
}

/// A single content part inside a [`ChatMessage`].
///
/// Serializable so a session's history can be written to a rollout and read
/// back verbatim (resume, fork, training-set extraction).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Part {
    /// Plain text content.
    Text(String),
    /// An image supplied as input (user attachment, pasted screenshot).
    Image(ImageSource),
    /// A finished reasoning item to replay verbatim to the provider that
    /// produced it. Wires that do not understand `opaque` drop the part.
    Reasoning {
        /// Human-readable reasoning text or summary (may be empty).
        text: String,
        /// Provider-native payload, round-tripped unchanged.
        opaque: Value,
    },
    /// A function call previously emitted by the model.
    FunctionCall {
        /// The provider's call id. It pairs this call with its
        /// [`Part::FunctionResponse`]; two calls to the same function in one
        /// turn are only distinguishable through it.
        id: String,
        /// Function name.
        name: String,
        /// JSON arguments object.
        args: Value,
    },
    /// The response of a tool / function execution.
    FunctionResponse {
        /// The id of the [`Part::FunctionCall`] this answers.
        id: String,
        /// Function name this response corresponds to.
        name: String,
        /// JSON response payload.
        response: Value,
        /// Images the tool produced (screenshots, rendered files), forwarded to
        /// vision-capable models next to the textual response.
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        images: Vec<ImageSource>,
    },
}

impl Part {
    /// A function call part.
    #[must_use]
    pub fn function_call(id: impl Into<String>, name: impl Into<String>, args: Value) -> Self {
        Self::FunctionCall {
            id: id.into(),
            name: name.into(),
            args,
        }
    }

    /// A function response part without images.
    #[must_use]
    pub fn function_response(
        id: impl Into<String>,
        name: impl Into<String>,
        response: Value,
    ) -> Self {
        Self::FunctionResponse {
            id: id.into(),
            name: name.into(),
            response,
            images: Vec::new(),
        }
    }
}

/// One message in the conversation history.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ChatMessage {
    /// Who authored the message.
    pub role: Role,
    /// Ordered content parts.
    pub parts: Vec<Part>,
}

/// A declared tool the model may call.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ToolDecl {
    /// Function name.
    pub name: String,
    /// Human-readable description shown to the model.
    pub description: String,
    /// JSON Schema object describing the function parameters.
    pub parameters: Value,
}

/// Per-request sampling / decoding options, all optional.
///
/// Every field maps onto the native knob of each wire when one exists and is
/// omitted otherwise; `extra` is merged verbatim into the top level of the
/// request body, which is how runtime-specific switches (llama-server
/// `grammar`, `cache_prompt`, vLLM `guided_json`, …) reach the server without
/// the neutral type having to know them.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct TurnOptions {
    /// Sampling temperature.
    pub temperature: Option<f32>,
    /// Upper bound on generated tokens.
    pub max_output_tokens: Option<u32>,
    /// Whether the model may emit several tool calls in one response.
    pub parallel_tool_calls: Option<bool>,
    /// Reasoning effort hint (`minimal` / `low` / `medium` / `high`).
    pub reasoning_effort: Option<String>,
    /// JSON Schema the final answer must conform to (constrained decoding).
    pub response_schema: Option<Value>,
    /// Stop sequences.
    pub stop: Vec<String>,
    /// Raw keys merged into the request body last (they win over the above).
    pub extra: serde_json::Map<String, Value>,
}

/// A full conversation turn handed to a [`ModelClient`].
#[derive(Debug, Clone, Default, PartialEq)]
pub struct ChatTurn {
    /// Optional system instruction.
    pub system: Option<String>,
    /// Ordered conversation history.
    pub messages: Vec<ChatMessage>,
    /// Tools available to the model this turn.
    pub tools: Vec<ToolDecl>,
    /// Sampling / decoding options.
    pub options: TurnOptions,
}

/// What a backend can do, so the engine adapts the conversation to it instead
/// of discovering limits through provider errors.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ModelCapabilities {
    /// Native function / tool calling.
    pub tools: bool,
    /// Several tool calls in a single response.
    pub parallel_tool_calls: bool,
    /// Image input (vision).
    pub images: bool,
    /// Emits reasoning / thinking content.
    pub reasoning: bool,
    /// Honors [`TurnOptions::response_schema`].
    pub json_schema: bool,
    /// Context window in tokens, when known.
    pub context_window: Option<u64>,
}

impl Default for ModelCapabilities {
    /// The conservative profile of an unknown OpenAI-compatible endpoint: tools
    /// yes, everything else unproven.
    fn default() -> Self {
        Self {
            tools: true,
            parallel_tool_calls: false,
            images: false,
            reasoning: false,
            json_schema: false,
            context_window: None,
        }
    }
}

/// A pinned, boxed stream of unified model events.
pub type ModelStream = Pin<Box<dyn Stream<Item = Result<ModelStreamEvent, ModelError>> + Send>>;

/// Provider-agnostic streaming chat client.
#[async_trait]
pub trait ModelClient: Send + Sync {
    /// Stream a turn, yielding unified [`ModelStreamEvent`]s.
    async fn stream(&self, turn: ChatTurn) -> Result<ModelStream, ModelError>;

    /// The model identifier this client targets.
    fn model_id(&self) -> &str;

    /// What this backend supports. The default is the conservative profile of
    /// an unknown endpoint ([`ModelCapabilities::default`]).
    fn capabilities(&self) -> ModelCapabilities {
        ModelCapabilities::default()
    }
}

// ---------------------------------------------------------------------------
// Pure wire helpers (offline-testable, no network).
// ---------------------------------------------------------------------------

/// Build the Gemini `GenerateContentRequest` JSON body from a neutral turn.
///
/// Shape produced (per `docs/plans/gemini-codex.md` §3):
/// - `systemInstruction.parts[].text` when [`ChatTurn::system`] is set;
/// - `contents[{role, parts}]` mapping [`Part`] variants to `text` / `functionCall{name,args}` /
///   `functionResponse{name,response}`;
/// - `tools[{function_declarations:[{name,description,parameters}]}]` when any tool is declared.
#[must_use]
pub fn build_request_body(turn: &ChatTurn) -> Value {
    let mut body = serde_json::Map::new();

    if let Some(system) = &turn.system {
        body.insert(
            "systemInstruction".to_string(),
            json!({ "parts": [{ "text": system }] }),
        );
    }

    let contents: Vec<Value> = turn
        .messages
        .iter()
        .filter_map(|msg| {
            let parts = message_to_gemini_parts(msg);
            // Gemini rejects a content with no parts (a message whose only part
            // was a reasoning item foreign to this wire).
            (!parts.is_empty())
                .then(|| json!({ "role": msg.role.as_gemini_role(), "parts": parts }))
        })
        .collect();
    body.insert("contents".to_string(), Value::Array(contents));

    if let Some(config) = gemini_generation_config(&turn.options) {
        body.insert("generationConfig".to_string(), config);
    }

    if !turn.tools.is_empty() {
        let decls: Vec<Value> = turn
            .tools
            .iter()
            .map(|t| {
                json!({
                    "name": t.name,
                    "description": t.description,
                    "parameters": sanitize_gemini_json_schema(t.parameters.clone()),
                })
            })
            .collect();
        body.insert(
            "tools".to_string(),
            json!([{ "function_declarations": decls }]),
        );
    }

    for (key, value) in &turn.options.extra {
        body.insert(key.clone(), value.clone());
    }

    Value::Object(body)
}

/// Key under which a Gemini thought signature travels inside
/// [`Part::Reasoning::opaque`].
const GEMINI_THOUGHT_SIGNATURE: &str = "thoughtSignature";
/// Key naming the function call a signature belongs to (Gemini attaches the
/// signature to the `functionCall` part itself and requires it back there).
const GEMINI_SIGNATURE_FOR_CALL: &str = "forCall";

/// Map one neutral message onto its Gemini `parts[]`.
///
/// Gemini pairs a `functionResponse` with its `functionCall` by name and order,
/// so call ids are not sent. Thought signatures are re-attached where Gemini
/// produced them: on the `functionCall` part they were issued for, or on a
/// standalone `thought` text part. Reasoning items from another provider carry
/// no signature and are dropped.
fn message_to_gemini_parts(message: &ChatMessage) -> Vec<Value> {
    let call_signatures: Vec<(&str, &str)> = message
        .parts
        .iter()
        .filter_map(|part| match part {
            Part::Reasoning { opaque, .. } => {
                let signature = opaque.get(GEMINI_THOUGHT_SIGNATURE)?.as_str()?;
                let call = opaque.get(GEMINI_SIGNATURE_FOR_CALL)?.as_str()?;
                Some((call, signature))
            }
            _ => None,
        })
        .collect();

    let mut parts = Vec::with_capacity(message.parts.len());
    for part in &message.parts {
        match part {
            Part::Text(text) => parts.push(json!({ "text": text })),
            Part::Image(image) => parts.push(gemini_image_part(image)),
            Part::Reasoning { text, opaque } => {
                let standalone = opaque.get(GEMINI_SIGNATURE_FOR_CALL).is_none();
                if let (true, Some(signature)) = (
                    standalone,
                    opaque.get(GEMINI_THOUGHT_SIGNATURE).and_then(Value::as_str),
                ) {
                    parts.push(json!({
                        "text": text,
                        "thought": true,
                        "thoughtSignature": signature,
                    }));
                }
            }
            Part::FunctionCall { id, name, args } => {
                let mut value = json!({ "functionCall": { "name": name, "args": args } });
                if let Some((_, signature)) = call_signatures.iter().find(|(call, _)| call == id) {
                    value["thoughtSignature"] = json!(signature);
                }
                parts.push(value);
            }
            Part::FunctionResponse {
                name,
                response,
                images,
                ..
            } => {
                parts.push(json!({ "functionResponse": { "name": name, "response": response } }));
                parts.extend(images.iter().map(gemini_image_part));
            }
        }
    }
    parts
}

/// Gemini image part: inline bytes as `inlineData`; a remote URL as a textual
/// reference, because `generateContent` only dereferences Files-API URIs.
fn gemini_image_part(image: &ImageSource) -> Value {
    match image {
        ImageSource::Base64 { mime, data } => {
            json!({ "inlineData": { "mimeType": mime, "data": data } })
        }
        ImageSource::Url(url) => json!({ "text": format!("[image: {url}]") }),
    }
}

/// Build Gemini's `generationConfig` from the neutral options, or `None` when
/// no option is set.
fn gemini_generation_config(options: &TurnOptions) -> Option<Value> {
    let mut config = serde_json::Map::new();
    if let Some(temperature) = options.temperature {
        config.insert("temperature".to_string(), json!(temperature));
    }
    if let Some(max) = options.max_output_tokens {
        config.insert("maxOutputTokens".to_string(), json!(max));
    }
    if !options.stop.is_empty() {
        config.insert("stopSequences".to_string(), json!(options.stop));
    }
    if let Some(schema) = &options.response_schema {
        config.insert("responseMimeType".to_string(), json!("application/json"));
        config.insert(
            "responseSchema".to_string(),
            sanitize_gemini_json_schema(schema.clone()),
        );
    }
    (!config.is_empty()).then_some(Value::Object(config))
}

/// Split complete SSE events out of an accumulating `buffer`.
///
/// SSE events are delimited by a blank line (LF, CRLF or CR). Any trailing
/// partial event is left in `buffer` for the next chunk. Returned blocks
/// retain their fields, with line endings normalized to LF.
#[must_use]
pub fn split_sse_events(buffer: &mut String) -> Vec<String> {
    let mut events = Vec::new();
    let bytes = buffer.as_bytes();
    let (mut cursor, mut line_start, mut event_start, mut previous_line_end) = (0, 0, 0, 0);
    while cursor < bytes.len() {
        let delimiter = match bytes[cursor] {
            b'\n' => 1,
            b'\r' if bytes.get(cursor + 1) == Some(&b'\n') => 2,
            // Keep a partial CRLF of a nonempty line until its next byte.
            // A final CR ending a blank line already dispatches the event;
            // a following LF is harmless leading empty input next time.
            b'\r' if cursor + 1 < bytes.len() || cursor == line_start => 1,
            b'\r' => break,
            _ => {
                cursor += 1;
                continue;
            }
        };
        if cursor == line_start {
            let event = &buffer[event_start..previous_line_end.max(event_start)];
            if !event.trim().is_empty() {
                events.push(event.replace("\r\n", "\n").replace('\r', "\n"));
            }
            event_start = cursor + delimiter;
        }
        previous_line_end = cursor;
        cursor += delimiter;
        line_start = cursor;
    }
    buffer.drain(..event_start);
    events
}

/// Extract the concatenated `data:` payload from one raw SSE event block.
///
/// An SSE event may carry multiple `data:` lines which are joined with `\n`
/// per the spec. Lines that are not `data:` fields (e.g. `event:`, comments
/// starting with `:`) are ignored.
#[must_use]
pub fn sse_event_data(event: &str) -> String {
    let mut data_lines = Vec::new();
    for line in event.trim_start_matches('\u{feff}').split(['\r', '\n']) {
        if line == "data" {
            data_lines.push("");
        } else if let Some(rest) = line.strip_prefix("data:") {
            // A single leading space after the colon is part of the syntax.
            data_lines.push(rest.strip_prefix(' ').unwrap_or(rest));
        }
    }
    data_lines.join("\n")
}

/// Parse one Gemini `GenerateContentResponse` JSON payload into unified events.
///
/// Mapping (per §3 of the codex plan):
/// - `candidates[0].content.parts[].text` -> [`ModelStreamEvent::TextDelta`];
/// - `candidates[0].content.parts[].functionCall{name,args}` -> [`ModelStreamEvent::ToolCall`] (id
///   generated locally);
/// - `candidates[0].finishReason` and/or `usageMetadata` -> [`ModelStreamEvent::Completed`].
///
/// A single frame can produce multiple events (e.g. several text parts, or a
/// text part plus a finish reason).
pub fn parse_sse_frame(json: &str) -> Result<Vec<ModelStreamEvent>, ModelError> {
    let value: Value = serde_json::from_str(json)?;

    // A standalone error object short-circuits.
    if let Some(err) = value.get("error").and_then(Value::as_object) {
        let status = err
            .get("code")
            .and_then(Value::as_u64)
            .map_or(0, |c| c as u16);
        let message = err
            .get("message")
            .and_then(Value::as_str)
            .unwrap_or("unknown provider error")
            .to_string();
        return Err(ModelError::Api { status, message });
    }

    let mut events = Vec::new();

    let candidate = value
        .get("candidates")
        .and_then(Value::as_array)
        .and_then(|c| c.first());

    if let Some(candidate) = candidate
        && let Some(parts) = candidate
            .get("content")
            .and_then(|c| c.get("parts"))
            .and_then(Value::as_array)
    {
        for part in parts {
            let signature = part.get(GEMINI_THOUGHT_SIGNATURE).and_then(Value::as_str);
            if let Some(text) = part.get("text").and_then(Value::as_str) {
                let is_thought = part
                    .get("thought")
                    .and_then(Value::as_bool)
                    .unwrap_or(false);
                if is_thought {
                    if !text.is_empty() {
                        events.push(ModelStreamEvent::ReasoningDelta(text.to_string()));
                    }
                    if let Some(signature) = signature {
                        events.push(ModelStreamEvent::ReasoningItem {
                            text: text.to_string(),
                            opaque: json!({ GEMINI_THOUGHT_SIGNATURE: signature }),
                        });
                    }
                } else if !text.is_empty() {
                    events.push(ModelStreamEvent::TextDelta(text.to_string()));
                }
            } else if let Some(call) = part.get("functionCall").and_then(Value::as_object) {
                let name = call
                    .get("name")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_string();
                let arguments = call.get("args").cloned().unwrap_or(Value::Null);
                let id = call
                    .get("id")
                    .and_then(Value::as_str)
                    .filter(|id| !id.is_empty())
                    .map_or_else(|| generate_call_id(&name), str::to_string);
                // The signature must come back on this exact functionCall
                // part; record which call it belongs to.
                if let Some(signature) = signature {
                    events.push(ModelStreamEvent::ReasoningItem {
                        text: String::new(),
                        opaque: json!({
                            GEMINI_THOUGHT_SIGNATURE: signature,
                            GEMINI_SIGNATURE_FOR_CALL: id,
                        }),
                    });
                }
                events.push(ModelStreamEvent::ToolCall {
                    id,
                    name,
                    arguments,
                });
            }
        }
    }

    let finish_reason = candidate
        .and_then(|c| c.get("finishReason"))
        .and_then(Value::as_str)
        .map(str::to_string);

    let usage = value
        .get("usageMetadata")
        .and_then(Value::as_object)
        .map(|u| TokenUsage {
            input_tokens: u
                .get("promptTokenCount")
                .and_then(Value::as_u64)
                .unwrap_or(0),
            output_tokens: u
                .get("candidatesTokenCount")
                .and_then(Value::as_u64)
                .unwrap_or(0),
            total_tokens: u
                .get("totalTokenCount")
                .and_then(Value::as_u64)
                .unwrap_or(0),
            cached_input_tokens: u
                .get("cachedContentTokenCount")
                .and_then(Value::as_u64)
                .unwrap_or(0),
            reasoning_output_tokens: u
                .get("thoughtsTokenCount")
                .and_then(Value::as_u64)
                .unwrap_or(0),
        });

    if finish_reason.is_some() || usage.is_some() {
        events.push(ModelStreamEvent::Completed {
            usage,
            finish_reason,
        });
    }

    Ok(events)
}

/// Mint a process-unique call id for a provider that did not supply one.
///
/// Gemini (and some local OpenAI-compatible servers) return no call id, but the
/// turn loop needs one to pair a tool result with its call. The id is monotonic
/// and name-prefixed, so two calls to the same function never collide.
pub(crate) fn generate_call_id(name: &str) -> String {
    use std::sync::atomic::{AtomicU64, Ordering};
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let n = COUNTER.fetch_add(1, Ordering::Relaxed);
    format!("call_{name}_{n}")
}

// ---------------------------------------------------------------------------
// Gemini client.
// ---------------------------------------------------------------------------

/// Default Gemini REST base URL.
pub const DEFAULT_GEMINI_BASE_URL: &str = "https://generativelanguage.googleapis.com";

/// A streaming Gemini `generateContent` client implementing [`ModelClient`].
#[derive(Debug, Clone)]
pub struct GeminiClient {
    /// The reqwest client (reused for connection pooling / low latency).
    pub http: reqwest::Client,
    /// Gemini API key.
    pub api_key: String,
    /// Target model id (e.g. `gemini-2.5-flash`).
    pub model: String,
    /// API base URL.
    pub base_url: String,
}

impl GeminiClient {
    /// Build a client for `model` authenticating with `api_key`.
    ///
    /// Uses the default public Gemini base URL; override [`GeminiClient::base_url`]
    /// for a proxy or staging endpoint.
    #[must_use]
    pub fn new(api_key: impl Into<String>, model: impl Into<String>) -> Self {
        Self {
            http: reqwest::Client::new(),
            api_key: api_key.into(),
            model: model.into(),
            base_url: DEFAULT_GEMINI_BASE_URL.to_string(),
        }
    }

    /// Full `streamGenerateContent` URL for this client's model.
    #[must_use]
    fn stream_url(&self) -> String {
        build_stream_url(&self.base_url, &self.model, &self.api_key)
    }
}

/// Build the `streamGenerateContent` SSE URL (pure, network-free helper).
#[must_use]
pub fn build_stream_url(base_url: &str, model: &str, api_key: &str) -> String {
    format!(
        "{}/v1beta/models/{model}:streamGenerateContent?alt=sse&key={api_key}",
        base_url.trim_end_matches('/'),
    )
}

#[async_trait]
impl ModelClient for GeminiClient {
    async fn stream(&self, turn: ChatTurn) -> Result<ModelStream, ModelError> {
        let body = build_request_body(&turn);
        let url = self.stream_url();

        let resp = self.http.post(&url).json(&body).send().await?;

        let status = resp.status();
        if !status.is_success() {
            let message = resp.text().await.unwrap_or_default();
            return Err(ModelError::Api {
                status: status.as_u16(),
                message: if message.is_empty() {
                    "request failed".to_string()
                } else {
                    message
                },
            });
        }

        // Drive the SSE byte stream into a unified event stream.
        let byte_stream = resp.bytes_stream();
        let event_stream = sse_byte_stream_to_events(byte_stream);
        Ok(Box::pin(event_stream))
    }

    fn model_id(&self) -> &str {
        &self.model
    }

    fn capabilities(&self) -> ModelCapabilities {
        ModelCapabilities {
            tools: true,
            parallel_tool_calls: true,
            images: true,
            reasoning: true,
            json_schema: true,
            context_window: None,
        }
    }
}

/// Convert a `reqwest` byte stream of SSE into a unified event stream.
///
/// `Created` is emitted first, then each decoded frame's events, then any
/// trailing buffered frame is flushed on stream end.
fn sse_byte_stream_to_events<S>(
    byte_stream: S,
) -> impl Stream<Item = Result<ModelStreamEvent, ModelError>> + Send
where
    S: Stream<Item = reqwest::Result<bytes::Bytes>> + Send + 'static,
{
    futures::stream::once(async { Ok(ModelStreamEvent::Created) }).chain(
        futures::stream::unfold(
            (Box::pin(byte_stream), String::new(), false),
            move |(mut stream, mut buffer, mut started)| async move {
                loop {
                    // Drain any complete events already buffered.
                    let frames = split_sse_events(&mut buffer);
                    if let Some(items) = frames_to_items(&frames) {
                        started = true;
                        return Some((items, (stream, buffer, started)));
                    }

                    match stream.next().await {
                        Some(Ok(chunk)) => match std::str::from_utf8(&chunk) {
                            Ok(text) => buffer.push_str(text),
                            Err(e) => {
                                return Some((
                                    vec![Err(ModelError::Stream(format!("invalid utf-8: {e}")))],
                                    (stream, buffer, started),
                                ));
                            }
                        },
                        Some(Err(e)) => {
                            return Some((
                                vec![Err(ModelError::Http(e))],
                                (stream, buffer, started),
                            ));
                        }
                        None => {
                            // Flush any final partial frame (Gemini may not send
                            // a trailing blank line on the last event).
                            let tail = std::mem::take(&mut buffer);
                            let trimmed = tail.trim();
                            if trimmed.is_empty() {
                                return None;
                            }
                            let final_frames = vec![trimmed.to_string()];
                            return frames_to_items(&final_frames)
                                .map(|items| (items, (stream, String::new(), started)));
                        }
                    }
                }
            },
        )
        // Flatten the per-poll batches into individual events.
        .map(futures::stream::iter)
        .flatten(),
    )
}

/// Decode a batch of raw SSE event blocks into result items.
///
/// Returns `None` when the batch produced nothing (so the caller keeps
/// polling), otherwise a non-empty vec of results.
fn frames_to_items(frames: &[String]) -> Option<Vec<Result<ModelStreamEvent, ModelError>>> {
    if frames.is_empty() {
        return None;
    }
    let mut items = Vec::new();
    for frame in frames {
        let data = sse_event_data(frame);
        let data = data.trim();
        if data.is_empty() || data == "[DONE]" {
            continue;
        }
        match parse_sse_frame(data) {
            Ok(events) => items.extend(events.into_iter().map(Ok)),
            Err(e) => items.push(Err(e)),
        }
    }
    if items.is_empty() { None } else { Some(items) }
}

#[cfg(test)]
mod tests {
    use pretty_assertions::assert_eq;

    use super::*;

    fn sample_turn() -> ChatTurn {
        ChatTurn {
            system: Some("You are a helpful coding agent.".to_string()),
            messages: vec![
                ChatMessage {
                    role: Role::User,
                    parts: vec![Part::Text("List files".to_string())],
                },
                ChatMessage {
                    role: Role::Model,
                    parts: vec![Part::function_call("call_1", "ls", json!({ "path": "." }))],
                },
                ChatMessage {
                    role: Role::Tool,
                    parts: vec![Part::function_response(
                        "call_1",
                        "ls",
                        json!({ "files": ["a.rs", "b.rs"] }),
                    )],
                },
            ],
            tools: vec![ToolDecl {
                name: "ls".to_string(),
                description: "List directory entries".to_string(),
                parameters: json!({
                    "type": "object",
                    "properties": { "path": { "type": "string" } },
                    "required": ["path"]
                }),
            }],
            options: TurnOptions::default(),
        }
    }

    #[test]
    fn build_request_body_matches_golden() {
        let got = build_request_body(&sample_turn());
        let want = json!({
            "systemInstruction": {
                "parts": [{ "text": "You are a helpful coding agent." }]
            },
            "contents": [
                { "role": "user", "parts": [{ "text": "List files" }] },
                {
                    "role": "model",
                    "parts": [{ "functionCall": { "name": "ls", "args": { "path": "." } } }]
                },
                {
                    "role": "user",
                    "parts": [{
                        "functionResponse": {
                            "name": "ls",
                            "response": { "files": ["a.rs", "b.rs"] }
                        }
                    }]
                }
            ],
            "tools": [{
                "function_declarations": [{
                    "name": "ls",
                    "description": "List directory entries",
                    "parameters": {
                        "type": "object",
                        "properties": { "path": { "type": "string" } },
                        "required": ["path"]
                    }
                }]
            }]
        });
        assert_eq!(got, want);
    }

    #[test]
    fn build_request_body_omits_optional_sections() {
        let turn = ChatTurn {
            system: None,
            messages: vec![ChatMessage {
                role: Role::User,
                parts: vec![Part::Text("hi".to_string())],
            }],
            ..ChatTurn::default()
        };
        let got = build_request_body(&turn);
        assert!(got.get("systemInstruction").is_none());
        assert!(got.get("tools").is_none());
        assert_eq!(
            got["contents"],
            json!([{ "role": "user", "parts": [{ "text": "hi" }] }])
        );
    }

    /// Gemini pairs responses by name and order: call ids stay off the wire.
    #[test]
    fn gemini_body_carries_no_call_ids() {
        let body = build_request_body(&sample_turn()).to_string();
        assert!(
            !body.contains("call_1"),
            "call id leaked into the Gemini body: {body}"
        );
    }

    #[test]
    fn gemini_images_are_inline_data_and_tool_images_follow_the_response() {
        let turn = ChatTurn {
            messages: vec![
                ChatMessage {
                    role: Role::User,
                    parts: vec![
                        Part::Text("what is this?".to_string()),
                        Part::Image(ImageSource::base64("image/png", "AAAA")),
                        Part::Image(ImageSource::Url("https://example.test/a.png".to_string())),
                    ],
                },
                ChatMessage {
                    role: Role::Tool,
                    parts: vec![Part::FunctionResponse {
                        id: "c1".to_string(),
                        name: "computer".to_string(),
                        response: json!({ "output": "ok" }),
                        images: vec![ImageSource::base64("image/jpeg", "BBBB")],
                    }],
                },
            ],
            ..ChatTurn::default()
        };
        let body = build_request_body(&turn);
        assert_eq!(
            body["contents"][0]["parts"],
            json!([
                { "text": "what is this?" },
                { "inlineData": { "mimeType": "image/png", "data": "AAAA" } },
                { "text": "[image: https://example.test/a.png]" }
            ])
        );
        assert_eq!(
            body["contents"][1]["parts"],
            json!([
                { "functionResponse": { "name": "computer", "response": { "output": "ok" } } },
                { "inlineData": { "mimeType": "image/jpeg", "data": "BBBB" } }
            ])
        );
    }

    /// A thought signature issued on a `functionCall` part must come back on
    /// that same part; a foreign reasoning item is dropped.
    #[test]
    fn gemini_thought_signature_round_trips_on_its_function_call() {
        let frame = r#"{"candidates":[{"content":{"parts":[
            {"text":"planning","thought":true},
            {"functionCall":{"name":"ls","args":{"path":"."}},"thoughtSignature":"SIG"}
        ],"role":"model"}}]}"#;
        let events = parse_sse_frame(frame).unwrap();
        assert_eq!(events.len(), 3);
        assert_eq!(
            events[0],
            ModelStreamEvent::ReasoningDelta("planning".to_string())
        );
        let ModelStreamEvent::ToolCall { id, .. } = &events[2] else {
            panic!("expected ToolCall, got {:?}", events[2]);
        };
        let ModelStreamEvent::ReasoningItem { opaque, .. } = &events[1] else {
            panic!("expected ReasoningItem, got {:?}", events[1]);
        };
        assert_eq!(*opaque, json!({ "thoughtSignature": "SIG", "forCall": id }));

        let turn = ChatTurn {
            messages: vec![ChatMessage {
                role: Role::Model,
                parts: vec![
                    Part::Reasoning {
                        text: String::new(),
                        opaque: opaque.clone(),
                    },
                    Part::Reasoning {
                        text: "foreign".to_string(),
                        opaque: json!({ "type": "reasoning", "encrypted_content": "x" }),
                    },
                    Part::function_call(id.clone(), "ls", json!({ "path": "." })),
                ],
            }],
            ..ChatTurn::default()
        };
        let body = build_request_body(&turn);
        assert_eq!(
            body["contents"][0]["parts"],
            json!([{
                "functionCall": { "name": "ls", "args": { "path": "." } },
                "thoughtSignature": "SIG"
            }])
        );
    }

    #[test]
    fn gemini_options_build_generation_config() {
        let turn = ChatTurn {
            messages: vec![ChatMessage {
                role: Role::User,
                parts: vec![Part::Text("hi".to_string())],
            }],
            options: TurnOptions {
                temperature: Some(0.5),
                max_output_tokens: Some(256),
                response_schema: Some(json!({ "type": "object" })),
                ..TurnOptions::default()
            },
            ..ChatTurn::default()
        };
        let body = build_request_body(&turn);
        assert_eq!(body["generationConfig"]["temperature"], json!(0.5));
        assert_eq!(body["generationConfig"]["maxOutputTokens"], 256);
        assert_eq!(
            body["generationConfig"]["responseMimeType"],
            "application/json"
        );
    }

    #[test]
    fn parse_usage_reports_cached_and_thought_tokens() {
        let frame = r#"{"usageMetadata":{"promptTokenCount":100,"candidatesTokenCount":20,
            "totalTokenCount":130,"cachedContentTokenCount":64,"thoughtsTokenCount":10}}"#;
        let events = parse_sse_frame(frame).unwrap();
        assert_eq!(
            events,
            vec![ModelStreamEvent::Completed {
                usage: Some(TokenUsage {
                    input_tokens: 100,
                    output_tokens: 20,
                    total_tokens: 130,
                    cached_input_tokens: 64,
                    reasoning_output_tokens: 10,
                }),
                finish_reason: None,
            }]
        );
    }

    #[test]
    fn history_serializes_and_reads_back_verbatim() {
        let message = ChatMessage {
            role: Role::Tool,
            parts: vec![
                Part::Text("note".to_string()),
                Part::function_call("c1", "ls", json!({ "path": "." })),
                Part::FunctionResponse {
                    id: "c1".to_string(),
                    name: "ls".to_string(),
                    response: json!({ "output": "a.rs" }),
                    images: vec![ImageSource::base64("image/png", "AAAA")],
                },
                Part::Reasoning {
                    text: "t".to_string(),
                    opaque: json!({ "k": 1 }),
                },
            ],
        };
        let wire = serde_json::to_value(&message).unwrap();
        assert_eq!(wire["role"], "tool");
        assert_eq!(wire["parts"][0], json!({ "text": "note" }));
        assert_eq!(wire["parts"][1]["function_call"]["id"], "c1");
        assert_eq!(
            wire["parts"][2]["function_response"]["images"][0]["base64"]["mime"],
            "image/png"
        );
        let back: ChatMessage = serde_json::from_value(wire).unwrap();
        assert_eq!(back, message);

        // A response recorded without images reads back with none.
        let bare: Part = serde_json::from_value(json!({
            "function_response": { "id": "c2", "name": "ls", "response": {} }
        }))
        .unwrap();
        assert_eq!(bare, Part::function_response("c2", "ls", json!({})));
    }

    #[test]
    fn parse_text_frame_yields_text_delta() {
        let frame = r#"{"candidates":[{"content":{"parts":[{"text":"Hello"}],"role":"model"}}]}"#;
        let events = parse_sse_frame(frame).unwrap();
        assert_eq!(
            events,
            vec![ModelStreamEvent::TextDelta("Hello".to_string())]
        );
    }

    #[test]
    fn parse_function_call_frame_yields_tool_call() {
        let frame = r#"{"candidates":[{"content":{"parts":[{"functionCall":{"name":"ls","args":{"path":"."}}}],"role":"model"}}]}"#;
        let events = parse_sse_frame(frame).unwrap();
        assert_eq!(events.len(), 1);
        match &events[0] {
            ModelStreamEvent::ToolCall {
                id,
                name,
                arguments,
            } => {
                assert!(id.starts_with("call_ls_"));
                assert_eq!(name, "ls");
                assert_eq!(*arguments, json!({ "path": "." }));
            }
            other => panic!("expected ToolCall, got {other:?}"),
        }
    }

    #[test]
    fn parse_final_frame_yields_completed_with_usage() {
        let frame = r#"{
            "candidates":[{"content":{"parts":[{"text":"done"}],"role":"model"},"finishReason":"STOP"}],
            "usageMetadata":{"promptTokenCount":12,"candidatesTokenCount":7,"totalTokenCount":19}
        }"#;
        let events = parse_sse_frame(frame).unwrap();
        assert_eq!(
            events,
            vec![
                ModelStreamEvent::TextDelta("done".to_string()),
                ModelStreamEvent::Completed {
                    usage: Some(TokenUsage::new(12, 7, 19)),
                    finish_reason: Some("STOP".to_string()),
                },
            ]
        );
    }

    #[test]
    fn parse_error_frame_yields_api_error() {
        let frame = r#"{"error":{"code":429,"message":"rate limited"}}"#;
        let err = parse_sse_frame(frame).unwrap_err();
        match err {
            ModelError::Api { status, message } => {
                assert_eq!(status, 429);
                assert_eq!(message, "rate limited");
            }
            other => panic!("expected Api error, got {other:?}"),
        }
    }

    #[test]
    fn split_sse_events_keeps_partial_in_buffer() {
        let mut buffer = String::from("data: {\"a\":1}\n\ndata: {\"b\":2");
        let events = split_sse_events(&mut buffer);
        assert_eq!(events, vec!["data: {\"a\":1}".to_string()]);
        // The incomplete second event stays buffered.
        assert_eq!(buffer, "data: {\"b\":2");

        // Completing it now emits it.
        buffer.push_str("}\n\n");
        let events = split_sse_events(&mut buffer);
        assert_eq!(events, vec!["data: {\"b\":2}".to_string()]);
        assert!(buffer.is_empty());
    }

    #[test]
    fn split_sse_events_handles_crlf_and_multiple() {
        let mut buffer = String::from("data: a\r\n\r\ndata: b\r\n\r\n");
        let events = split_sse_events(&mut buffer);
        assert_eq!(events, vec!["data: a".to_string(), "data: b".to_string()]);
        assert!(buffer.is_empty());
    }

    #[test]
    fn split_sse_handles_every_line_ending_and_chunk_boundary() {
        for ending in ["\n", "\r\n", "\r"] {
            let fixture =
                format!("data: one{ending}data: two{ending}{ending}data: three{ending}{ending}");
            for split in 0..=fixture.len() {
                let mut buffer = fixture[..split].to_string();
                let mut events = split_sse_events(&mut buffer);
                buffer.push_str(&fixture[split..]);
                events.extend(split_sse_events(&mut buffer));
                assert_eq!(
                    events.iter().map(|e| sse_event_data(e)).collect::<Vec<_>>(),
                    vec!["one\ntwo", "three"],
                    "{ending:?} split {split}"
                );
                assert!(buffer.trim().is_empty());
            }
        }
        assert_eq!(
            sse_event_data("\u{feff}data: one\rdata\rdata: two"),
            "one\n\ntwo"
        );
    }

    #[test]
    fn split_sse_ignores_repeated_leading_and_trailing_blank_lines() {
        let mut buffer = "\n\n\r\ndata: one\n\n\n\ndata: two\r\r\r".to_string();
        assert_eq!(
            split_sse_events(&mut buffer),
            vec!["data: one", "data: two"]
        );
        assert!(buffer.is_empty());
    }

    #[test]
    fn sse_event_data_extracts_and_joins_data_lines() {
        let event = "event: message\ndata: line1\ndata: line2";
        assert_eq!(sse_event_data(event), "line1\nline2");
    }

    #[test]
    fn sse_event_data_strips_single_leading_space() {
        assert_eq!(sse_event_data("data: {\"x\":1}"), "{\"x\":1}");
        assert_eq!(sse_event_data("data:{\"x\":1}"), "{\"x\":1}");
    }

    #[test]
    fn empty_candidates_frame_yields_nothing() {
        let frame = r#"{"candidates":[]}"#;
        assert!(parse_sse_frame(frame).unwrap().is_empty());
    }

    #[test]
    fn frames_to_items_skips_done_sentinel() {
        let frames = vec!["data: [DONE]".to_string()];
        assert!(frames_to_items(&frames).is_none());
    }

    // Note: we test the pure URL builder directly rather than constructing a
    // `GeminiClient`, because `reqwest::Client::new()` panics with "No provider
    // set" under rustls 0.23 in a bare test process (CLAUDE.md §7). Tests stay
    // network-free and provider-free.
    #[test]
    fn build_stream_url_matches_gemini_endpoint() {
        let url = build_stream_url(DEFAULT_GEMINI_BASE_URL, "gemini-2.5-flash", "KEY123");
        assert_eq!(
            url,
            "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:streamGenerateContent?alt=sse&key=KEY123"
        );
    }

    #[test]
    fn build_stream_url_trims_trailing_slash() {
        let url = build_stream_url("https://proxy.local/", "m", "k");
        assert_eq!(
            url,
            "https://proxy.local/v1beta/models/m:streamGenerateContent?alt=sse&key=k"
        );
    }
}
