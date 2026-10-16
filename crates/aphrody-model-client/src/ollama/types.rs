// SPDX-License-Identifier: Apache-2.0
//! Wire types of Ollama's native API.
//!
//! Field names and shapes follow `api/types.go` in the Ollama tree (the
//! `json:"..."` tags are the contract). Responses are decoded leniently:
//! every field is optional, `null` reads as the empty value, and unknown
//! fields are ignored, because Ollama adds fields between releases and a client
//! must not break on them. Requests are built by `to_body` methods so that
//! unset fields are omitted rather than sent as defaults (the server treats an
//! absent `think`, `keep_alive` or `truncate` differently from an explicit
//! value).

use serde::{Deserialize, Deserializer};
use serde_json::{Map, Value, json};

use crate::ModelCapabilities;

/// Deserialize `null` as the type's default (a missing field needs
/// `#[serde(default)]` on top of this).
pub(crate) fn null_default<'de, D, T>(deserializer: D) -> Result<T, D::Error>
where
    D: Deserializer<'de>,
    T: Deserialize<'de> + Default,
{
    Ok(Option::<T>::deserialize(deserializer)?.unwrap_or_default())
}

// ---------------------------------------------------------------------------
// Request-side value types.
// ---------------------------------------------------------------------------

/// How long Ollama keeps a model loaded after a request (`keep_alive`).
///
/// The server accepts a number of seconds (negative means "forever") or a Go
/// duration string (`api.Duration` in `api/types.go`).
#[derive(Debug, Clone, PartialEq)]
pub enum KeepAlive {
    /// Seconds. A negative value keeps the model loaded indefinitely, `0`
    /// unloads it right after the request.
    Seconds(i64),
    /// A Go duration string such as `"10m"` or `"1h30m"`.
    Duration(String),
}

impl KeepAlive {
    /// Keep the model loaded until the server stops.
    pub const FOREVER: Self = Self::Seconds(-1);
    /// Unload the model as soon as the request ends.
    pub const UNLOAD: Self = Self::Seconds(0);

    /// The JSON value sent in the request body.
    #[must_use]
    pub fn to_value(&self) -> Value {
        match self {
            Self::Seconds(seconds) => Value::from(*seconds),
            Self::Duration(text) => Value::from(text.as_str()),
        }
    }
}

/// The `think` request field: whether a thinking model reasons before it
/// answers (`docs/capabilities/thinking.mdx`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Think {
    /// `false`: no thinking output, when the model permits it.
    Off,
    /// `true`: the model's default thinking.
    On,
    /// A named level, taken from the model's `thinking.values` in `/api/show`
    /// (`"low"`, `"medium"`, `"high"`, `"max"` for the models that predate
    /// level metadata).
    Level(String),
}

impl Think {
    /// The JSON value sent in the request body.
    #[must_use]
    pub fn to_value(&self) -> Value {
        match self {
            Self::Off => Value::Bool(false),
            Self::On => Value::Bool(true),
            Self::Level(level) => Value::from(level.as_str()),
        }
    }

    /// Map a provider-neutral reasoning effort onto Ollama's `think`.
    ///
    /// `none` / `off` disable thinking; `minimal` is folded into `low`, the
    /// lowest level a model without level metadata accepts (the server
    /// rejects unknown level names for such models with a 400, see
    /// `ValidateLegacyThinking`); `low`, `medium`, `high` and `max` pass
    /// through; any other name is forwarded as a model-defined level.
    /// `None` for an empty string.
    #[must_use]
    pub fn from_effort(effort: &str) -> Option<Self> {
        match effort.trim().to_ascii_lowercase().as_str() {
            "" => None,
            "none" | "off" | "false" | "disabled" => Some(Self::Off),
            "true" | "on" | "enabled" => Some(Self::On),
            "minimal" | "low" => Some(Self::Level("low".to_string())),
            other => Some(Self::Level(other.to_string())),
        }
    }
}

// ---------------------------------------------------------------------------
// Chat / generate responses.
// ---------------------------------------------------------------------------

/// Timing and token counters of a finished generation (`api.Metrics`).
/// Durations are nanoseconds; a counter the server did not report is `0`.
#[derive(Debug, Clone, Default, PartialEq, Eq, Deserialize)]
pub struct OllamaMetrics {
    /// Wall time of the whole request.
    #[serde(default)]
    pub total_duration: u64,
    /// Time spent loading the model.
    #[serde(default)]
    pub load_duration: u64,
    /// Prompt tokens evaluated.
    #[serde(default)]
    pub prompt_eval_count: u64,
    /// Prompt tokens served from the KV cache, when reported.
    #[serde(default)]
    pub prompt_eval_cached_count: Option<u64>,
    /// Time spent evaluating the prompt.
    #[serde(default)]
    pub prompt_eval_duration: u64,
    /// Tokens generated.
    #[serde(default)]
    pub eval_count: u64,
    /// Time spent generating.
    #[serde(default)]
    pub eval_duration: u64,
}

impl OllamaMetrics {
    /// Generation speed in tokens per second, when both counters are known.
    #[must_use]
    pub fn tokens_per_second(&self) -> Option<f64> {
        (self.eval_duration > 0 && self.eval_count > 0)
            .then(|| self.eval_count as f64 / (self.eval_duration as f64 / 1e9))
    }
}

/// The function of a tool call (`api.ToolCallFunction`).
#[derive(Debug, Clone, Default, PartialEq, Deserialize)]
pub struct OllamaToolCallFunction {
    /// Position of the call in the response.
    #[serde(default)]
    pub index: u32,
    /// Declared function name.
    #[serde(default)]
    pub name: String,
    /// Arguments as a JSON object. Ollama parses the model output into an
    /// object itself, so there is no string to re-parse (unlike the OpenAI
    /// wire).
    #[serde(default, deserialize_with = "null_default")]
    pub arguments: Value,
}

/// A tool call requested by the model (`api.ToolCall`).
#[derive(Debug, Clone, Default, PartialEq, Deserialize)]
pub struct OllamaToolCall {
    /// Call id minted by Ollama; empty when the server did not provide one.
    #[serde(default, deserialize_with = "null_default")]
    pub id: String,
    /// The requested function.
    #[serde(default)]
    pub function: OllamaToolCallFunction,
}

/// The assistant message inside a chat chunk (`api.Message`).
#[derive(Debug, Clone, Default, PartialEq, Deserialize)]
pub struct OllamaChatMessage {
    /// Always `assistant` in a response.
    #[serde(default, deserialize_with = "null_default")]
    pub role: String,
    /// Visible text produced since the previous chunk.
    #[serde(default, deserialize_with = "null_default")]
    pub content: String,
    /// Reasoning produced since the previous chunk (thinking models, when
    /// `think` is enabled).
    #[serde(default, deserialize_with = "null_default")]
    pub thinking: String,
    /// Tool calls completed in this chunk.
    #[serde(default, deserialize_with = "null_default")]
    pub tool_calls: Vec<OllamaToolCall>,
}

/// One line of an `/api/chat` stream (`api.ChatResponse`).
#[derive(Debug, Clone, Default, PartialEq, Deserialize)]
pub struct OllamaChatChunk {
    /// Model that produced the chunk.
    #[serde(default, deserialize_with = "null_default")]
    pub model: String,
    /// RFC 3339 timestamp of the chunk.
    #[serde(default, deserialize_with = "null_default")]
    pub created_at: String,
    /// The incremental assistant message.
    #[serde(default)]
    pub message: OllamaChatMessage,
    /// Whether this is the last chunk.
    #[serde(default)]
    pub done: bool,
    /// Why generation stopped: `stop`, `length`, `load` (a load-only request)
    /// or `unload`.
    #[serde(default)]
    pub done_reason: Option<String>,
    /// Counters, present on the last chunk.
    #[serde(flatten)]
    pub metrics: OllamaMetrics,
}

/// One line of an `/api/generate` stream (`api.GenerateResponse`).
#[derive(Debug, Clone, Default, PartialEq, Deserialize)]
pub struct OllamaGenerateChunk {
    /// Model that produced the chunk.
    #[serde(default, deserialize_with = "null_default")]
    pub model: String,
    /// RFC 3339 timestamp of the chunk.
    #[serde(default, deserialize_with = "null_default")]
    pub created_at: String,
    /// Text produced since the previous chunk.
    #[serde(default, deserialize_with = "null_default")]
    pub response: String,
    /// Reasoning produced since the previous chunk, when `think` is enabled.
    #[serde(default, deserialize_with = "null_default")]
    pub thinking: String,
    /// Whether this is the last chunk.
    #[serde(default)]
    pub done: bool,
    /// Why generation stopped.
    #[serde(default)]
    pub done_reason: Option<String>,
    /// Opaque conversation state to pass back as `context` (legacy memory).
    #[serde(default, deserialize_with = "null_default")]
    pub context: Vec<i64>,
    /// Tool calls completed in this chunk.
    #[serde(default, deserialize_with = "null_default")]
    pub tool_calls: Vec<OllamaToolCall>,
    /// Counters, present on the last chunk.
    #[serde(flatten)]
    pub metrics: OllamaMetrics,
}

// ---------------------------------------------------------------------------
// Management responses.
// ---------------------------------------------------------------------------

/// One progress line of `/api/pull` (`api.ProgressResponse`).
///
/// A pull streams `pulling manifest`, then one `pulling <digest12>` line per
/// layer update (with `digest`, `total` and `completed`), then `verifying
/// sha256 digest`, `writing manifest`, optionally `removing any unused layers`
/// and finally `success`.
#[derive(Debug, Clone, Default, PartialEq, Eq, Deserialize)]
pub struct OllamaProgress {
    /// Human-readable step.
    #[serde(default, deserialize_with = "null_default")]
    pub status: String,
    /// Layer digest the line is about (`sha256:...`), empty for non-layer steps.
    #[serde(default, deserialize_with = "null_default")]
    pub digest: String,
    /// Layer size in bytes, `0` when unknown.
    #[serde(default)]
    pub total: u64,
    /// Bytes of the layer received so far.
    #[serde(default)]
    pub completed: u64,
}

impl OllamaProgress {
    /// Whether this is the final `success` line.
    #[must_use]
    pub fn is_success(&self) -> bool {
        self.status == "success"
    }

    /// Completion ratio of the layer, in `0.0..=1.0`, when its size is known.
    #[must_use]
    pub fn fraction(&self) -> Option<f64> {
        (self.total > 0).then(|| (self.completed as f64 / self.total as f64).min(1.0))
    }
}

/// Facts about a model's weights (`api.ModelDetails`).
#[derive(Debug, Clone, Default, PartialEq, Eq, Deserialize)]
pub struct OllamaModelDetails {
    /// Model this one was derived from, when any.
    #[serde(default, deserialize_with = "null_default")]
    pub parent_model: String,
    /// Weights format (`gguf`, `safetensors`).
    #[serde(default, deserialize_with = "null_default")]
    pub format: String,
    /// Architecture family (`llama`, `qwen2`, ...).
    #[serde(default, deserialize_with = "null_default")]
    pub family: String,
    /// Every family the model belongs to (a multimodal model lists its vision
    /// family as well).
    #[serde(default, deserialize_with = "null_default")]
    pub families: Vec<String>,
    /// Human-readable parameter count (`7.6B`).
    #[serde(default, deserialize_with = "null_default")]
    pub parameter_size: String,
    /// Quantisation level (`Q4_K_M`).
    #[serde(default, deserialize_with = "null_default")]
    pub quantization_level: String,
    /// Native context length, when reported.
    #[serde(default)]
    pub context_length: Option<u64>,
    /// Embedding vector size, when reported.
    #[serde(default)]
    pub embedding_length: Option<u64>,
}

/// One installed model of `/api/tags` (`api.ListModelResponse`).
#[derive(Debug, Clone, Default, PartialEq, Eq, Deserialize)]
pub struct OllamaModelSummary {
    /// Name in the shortest unambiguous form (`llama3.2:latest`).
    #[serde(default, deserialize_with = "null_default")]
    pub name: String,
    /// Same as `name` (kept by the server for compatibility).
    #[serde(default, deserialize_with = "null_default")]
    pub model: String,
    /// RFC 3339 modification time.
    #[serde(default, deserialize_with = "null_default")]
    pub modified_at: String,
    /// Size on disk in bytes.
    #[serde(default)]
    pub size: u64,
    /// Manifest digest (hex, no `sha256:` prefix).
    #[serde(default, deserialize_with = "null_default")]
    pub digest: String,
    /// Weights facts.
    #[serde(default)]
    pub details: OllamaModelDetails,
    /// Capabilities (`completion`, `tools`, `vision`, `embedding`,
    /// `thinking`, ...), when the server reports them.
    #[serde(default, deserialize_with = "null_default")]
    pub capabilities: Vec<String>,
    /// Upstream model for a cloud-backed entry.
    #[serde(default)]
    pub remote_model: Option<String>,
    /// Upstream host for a cloud-backed entry.
    #[serde(default)]
    pub remote_host: Option<String>,
}

/// One loaded model of `/api/ps` (`api.ProcessModelResponse`).
#[derive(Debug, Clone, Default, PartialEq, Eq, Deserialize)]
pub struct OllamaRunningModel {
    /// Model name.
    #[serde(default, deserialize_with = "null_default")]
    pub name: String,
    /// Same as `name`.
    #[serde(default, deserialize_with = "null_default")]
    pub model: String,
    /// Memory the loaded model occupies, in bytes.
    #[serde(default)]
    pub size: u64,
    /// Manifest digest.
    #[serde(default, deserialize_with = "null_default")]
    pub digest: String,
    /// Weights facts.
    #[serde(default)]
    pub details: OllamaModelDetails,
    /// RFC 3339 time at which the model is unloaded if left idle.
    #[serde(default, deserialize_with = "null_default")]
    pub expires_at: String,
    /// Part of `size` that lives in GPU memory.
    #[serde(default)]
    pub size_vram: u64,
    /// Context length the model was loaded with.
    #[serde(default)]
    pub context_length: u64,
}

/// The `thinking` descriptor of `/api/show` (`model.Thinking`): which values
/// of the `think` request field the model honours.
#[derive(Debug, Clone, Default, PartialEq, Deserialize)]
pub struct OllamaThinking {
    /// Accepted values: booleans for on/off models, strings for named levels.
    /// `[false]` means the model does not think.
    #[serde(default, deserialize_with = "null_default")]
    pub values: Vec<Value>,
    /// Value used when the request omits `think`.
    #[serde(default, deserialize_with = "null_default")]
    pub default: Value,
}

/// Response of `/api/show` (`api.ShowResponse`).
#[derive(Debug, Clone, Default, PartialEq, Deserialize)]
pub struct OllamaShow {
    /// Licence text.
    #[serde(default, deserialize_with = "null_default")]
    pub license: String,
    /// The Modelfile that reproduces the model.
    #[serde(default, deserialize_with = "null_default")]
    pub modelfile: String,
    /// Default parameters, one per line.
    #[serde(default, deserialize_with = "null_default")]
    pub parameters: String,
    /// Prompt template.
    #[serde(default, deserialize_with = "null_default")]
    pub template: String,
    /// Default system prompt.
    #[serde(default, deserialize_with = "null_default")]
    pub system: String,
    /// Weights facts.
    #[serde(default)]
    pub details: OllamaModelDetails,
    /// GGUF metadata (`general.architecture`, `<arch>.context_length`, ...).
    #[serde(default, deserialize_with = "null_default")]
    pub model_info: Map<String, Value>,
    /// Capabilities: `completion`, `tools`, `insert`, `vision`, `embedding`,
    /// `thinking`, `image`, `audio`.
    #[serde(default, deserialize_with = "null_default")]
    pub capabilities: Vec<String>,
    /// Thinking controls the model advertises, when it has any metadata.
    #[serde(default)]
    pub thinking: Option<OllamaThinking>,
    /// RFC 3339 modification time of the manifest.
    #[serde(default, deserialize_with = "null_default")]
    pub modified_at: String,
    /// Minimum Ollama version the model needs.
    #[serde(default, deserialize_with = "null_default")]
    pub requires: String,
}

impl OllamaShow {
    /// Whether the server lists `capability` for the model.
    #[must_use]
    pub fn has_capability(&self, capability: &str) -> bool {
        self.capabilities.iter().any(|c| c == capability)
    }

    /// Native context length: `details.context_length`, else the GGUF key
    /// `<general.architecture>.context_length`.
    #[must_use]
    pub fn context_length(&self) -> Option<u64> {
        self.details
            .context_length
            .filter(|n| *n > 0)
            .or_else(|| self.arch_metadata("context_length"))
    }

    /// Embedding vector size: `details.embedding_length`, else the GGUF key
    /// `<general.architecture>.embedding_length`.
    #[must_use]
    pub fn embedding_length(&self) -> Option<u64> {
        self.details
            .embedding_length
            .filter(|n| *n > 0)
            .or_else(|| self.arch_metadata("embedding_length"))
    }

    fn arch_metadata(&self, key: &str) -> Option<u64> {
        let arch = self.model_info.get("general.architecture")?.as_str()?;
        self.model_info.get(&format!("{arch}.{key}"))?.as_u64()
    }

    /// The [`ModelCapabilities`] this model supports, from the server's own
    /// capability list instead of the conservative default.
    ///
    /// Structured output (`format`) is available on every completion model, and
    /// Ollama can return several tool calls in one message, so both follow the
    /// `completion` and `tools` capabilities.
    #[must_use]
    pub fn model_capabilities(&self) -> ModelCapabilities {
        let tools = self.has_capability("tools");
        ModelCapabilities {
            tools,
            parallel_tool_calls: tools,
            images: self.has_capability("vision"),
            reasoning: self.has_capability("thinking"),
            json_schema: self.has_capability("completion"),
            context_window: self.context_length(),
        }
    }
}

/// Response of `/api/embed` (`api.EmbedResponse`).
#[derive(Debug, Clone, Default, PartialEq, Deserialize)]
pub struct OllamaEmbedResponse {
    /// Model that produced the vectors.
    #[serde(default, deserialize_with = "null_default")]
    pub model: String,
    /// One L2-normalised vector per input, in input order.
    #[serde(default, deserialize_with = "null_default")]
    pub embeddings: Vec<Vec<f32>>,
    /// Wall time of the request, nanoseconds.
    #[serde(default)]
    pub total_duration: u64,
    /// Model load time, nanoseconds.
    #[serde(default)]
    pub load_duration: u64,
    /// Tokens embedded across all inputs.
    #[serde(default)]
    pub prompt_eval_count: u64,
}

// ---------------------------------------------------------------------------
// Request types.
// ---------------------------------------------------------------------------

/// Request of `/api/generate` (`api.GenerateRequest`).
#[derive(Debug, Clone, Default, PartialEq)]
pub struct OllamaGenerateRequest {
    /// Model name.
    pub model: String,
    /// Prompt text. An empty prompt only loads the model.
    pub prompt: String,
    /// Text after the insertion point, for fill-in-the-middle models.
    pub suffix: Option<String>,
    /// Overrides the model's system prompt.
    pub system: Option<String>,
    /// Overrides the model's prompt template.
    pub template: Option<String>,
    /// `context` returned by a previous call (legacy conversational memory).
    pub context: Vec<i64>,
    /// Send the prompt without any templating. Incompatible with `system`,
    /// `template` and `context`.
    pub raw: bool,
    /// `"json"` or a JSON Schema constraining the output.
    pub format: Option<Value>,
    /// How long to keep the model loaded afterwards.
    pub keep_alive: Option<KeepAlive>,
    /// Images (standard base64, no `data:` prefix) for multimodal models.
    pub images: Vec<String>,
    /// Model parameters (`temperature`, `num_ctx`, `num_predict`, `stop`, ...).
    pub options: Map<String, Value>,
    /// Thinking control.
    pub think: Option<Think>,
    /// Truncate the prompt when it exceeds the context instead of failing.
    pub truncate: Option<bool>,
    /// Shift the context window instead of failing when it fills up.
    pub shift: Option<bool>,
}

impl OllamaGenerateRequest {
    /// A request for `prompt` with every optional field unset.
    #[must_use]
    pub fn new(model: impl Into<String>, prompt: impl Into<String>) -> Self {
        Self { model: model.into(), prompt: prompt.into(), ..Self::default() }
    }

    /// The streaming request body. Unset fields are left out.
    #[must_use]
    pub fn to_body(&self) -> Value {
        let mut body = Map::new();
        body.insert("model".to_string(), json!(self.model));
        body.insert("prompt".to_string(), json!(self.prompt));
        body.insert("stream".to_string(), json!(true));
        if let Some(suffix) = &self.suffix {
            body.insert("suffix".to_string(), json!(suffix));
        }
        if let Some(system) = &self.system {
            body.insert("system".to_string(), json!(system));
        }
        if let Some(template) = &self.template {
            body.insert("template".to_string(), json!(template));
        }
        if !self.context.is_empty() {
            body.insert("context".to_string(), json!(self.context));
        }
        if self.raw {
            body.insert("raw".to_string(), json!(true));
        }
        if let Some(format) = &self.format {
            body.insert("format".to_string(), format.clone());
        }
        if let Some(keep_alive) = &self.keep_alive {
            body.insert("keep_alive".to_string(), keep_alive.to_value());
        }
        if !self.images.is_empty() {
            body.insert("images".to_string(), json!(self.images));
        }
        if !self.options.is_empty() {
            body.insert("options".to_string(), Value::Object(self.options.clone()));
        }
        if let Some(think) = &self.think {
            body.insert("think".to_string(), think.to_value());
        }
        if let Some(truncate) = self.truncate {
            body.insert("truncate".to_string(), json!(truncate));
        }
        if let Some(shift) = self.shift {
            body.insert("shift".to_string(), json!(shift));
        }
        Value::Object(body)
    }
}

/// Request of `/api/embed` (`api.EmbedRequest`).
#[derive(Debug, Clone, Default, PartialEq)]
pub struct OllamaEmbedRequest {
    /// Embedding model name.
    pub model: String,
    /// Texts to embed.
    pub input: Vec<String>,
    /// Truncate over-long inputs (server default `true`); `Some(false)` makes
    /// an over-long input an error.
    pub truncate: Option<bool>,
    /// Cut the vectors to this many dimensions (Matryoshka models).
    pub dimensions: Option<u32>,
    /// How long to keep the model loaded afterwards.
    pub keep_alive: Option<KeepAlive>,
    /// Model parameters.
    pub options: Map<String, Value>,
}

impl OllamaEmbedRequest {
    /// A request embedding `input` with `model`, every option unset.
    #[must_use]
    pub fn new<I, S>(model: impl Into<String>, input: I) -> Self
    where
        I: IntoIterator<Item = S>,
        S: Into<String>,
    {
        Self {
            model: model.into(),
            input: input.into_iter().map(Into::into).collect(),
            ..Self::default()
        }
    }

    /// The request body. Unset fields are left out.
    #[must_use]
    pub fn to_body(&self) -> Value {
        let mut body = Map::new();
        body.insert("model".to_string(), json!(self.model));
        body.insert("input".to_string(), json!(self.input));
        if let Some(truncate) = self.truncate {
            body.insert("truncate".to_string(), json!(truncate));
        }
        if let Some(dimensions) = self.dimensions {
            body.insert("dimensions".to_string(), json!(dimensions));
        }
        if let Some(keep_alive) = &self.keep_alive {
            body.insert("keep_alive".to_string(), keep_alive.to_value());
        }
        if !self.options.is_empty() {
            body.insert("options".to_string(), Value::Object(self.options.clone()));
        }
        Value::Object(body)
    }
}

#[cfg(test)]
mod tests {
    use pretty_assertions::assert_eq;

    use super::*;

    #[test]
    fn keep_alive_and_think_serialise_like_the_go_types() {
        assert_eq!(KeepAlive::FOREVER.to_value(), json!(-1));
        assert_eq!(KeepAlive::UNLOAD.to_value(), json!(0));
        assert_eq!(KeepAlive::Duration("10m".to_string()).to_value(), json!("10m"));
        assert_eq!(Think::Off.to_value(), json!(false));
        assert_eq!(Think::On.to_value(), json!(true));
        assert_eq!(Think::Level("high".to_string()).to_value(), json!("high"));
    }

    #[test]
    fn reasoning_effort_maps_onto_think() {
        assert_eq!(Think::from_effort(""), None);
        assert_eq!(Think::from_effort("none"), Some(Think::Off));
        assert_eq!(Think::from_effort("OFF"), Some(Think::Off));
        assert_eq!(Think::from_effort("minimal"), Some(Think::Level("low".to_string())));
        assert_eq!(Think::from_effort("Medium"), Some(Think::Level("medium".to_string())));
        assert_eq!(Think::from_effort("max"), Some(Think::Level("max".to_string())));
    }

    /// The tool-call chunk from `docs/api.md` ("Chat request (Streaming with
    /// tools)"), including the final line with its counters.
    #[test]
    fn chat_chunks_decode_tool_calls_and_counters() {
        let call: OllamaChatChunk = serde_json::from_str(
            r#"{"model":"llama3.2","created_at":"2025-07-07T20:22:19.184789Z",
                "message":{"role":"assistant","content":"","tool_calls":[
                  {"function":{"name":"get_weather","arguments":{"city":"Tokyo"}}}]},
                "done":false}"#,
        )
        .expect("tool call chunk");
        assert_eq!(call.message.tool_calls.len(), 1);
        assert_eq!(call.message.tool_calls[0].function.name, "get_weather");
        assert_eq!(call.message.tool_calls[0].function.arguments, json!({"city": "Tokyo"}));
        assert!(!call.done);

        let last: OllamaChatChunk = serde_json::from_str(
            r#"{"model":"llama3.2","created_at":"2025-07-07T20:22:19.19314Z",
                "message":{"role":"assistant","content":""},"done_reason":"stop","done":true,
                "total_duration":182242375,"load_duration":41295167,"prompt_eval_count":169,
                "prompt_eval_duration":24573166,"eval_count":15,"eval_duration":115959084}"#,
        )
        .expect("final chunk");
        assert!(last.done);
        assert_eq!(last.done_reason.as_deref(), Some("stop"));
        assert_eq!(last.metrics.prompt_eval_count, 169);
        assert_eq!(last.metrics.eval_count, 15);
        let rate = last.metrics.tokens_per_second().expect("rate");
        assert!((rate - 129.35).abs() < 0.1, "{rate}");
    }

    #[test]
    fn null_fields_and_unknown_fields_are_tolerated() {
        let chunk: OllamaChatChunk = serde_json::from_str(
            r#"{"model":"m","message":{"role":"assistant","content":"hi","images":null,
                "tool_calls":null,"thinking":null},"done":false,"future_field":{"x":1}}"#,
        )
        .expect("lenient decode");
        assert_eq!(chunk.message.content, "hi");
        assert!(chunk.message.tool_calls.is_empty());
        assert_eq!(chunk.message.thinking, "");
    }

    #[test]
    fn pull_progress_lines_decode() {
        let manifest: OllamaProgress =
            serde_json::from_str(r#"{"status":"pulling manifest"}"#).expect("manifest line");
        assert_eq!(manifest.fraction(), None);
        let layer: OllamaProgress = serde_json::from_str(
            r#"{"status":"pulling digestname","digest":"digestname","total":2000,"completed":500}"#,
        )
        .expect("layer line");
        assert_eq!(layer.fraction(), Some(0.25));
        assert!(!layer.is_success());
        let done: OllamaProgress = serde_json::from_str(r#"{"status":"success"}"#).expect("done");
        assert!(done.is_success());
    }

    /// The `/api/tags` example of `docs/api.md`.
    #[test]
    fn tags_decode() {
        #[derive(Deserialize)]
        struct Tags {
            models: Vec<OllamaModelSummary>,
        }
        let tags: Tags = serde_json::from_str(
            r#"{"models":[{"name":"deepseek-r1:latest","model":"deepseek-r1:latest",
                "modified_at":"2025-05-10T08:06:48.639712648-07:00","size":4683075271,
                "digest":"0a8c266910232fd3291e71e5ba1e058cc5af9d411192cf88b6d30e92b6e73163",
                "details":{"parent_model":"","format":"gguf","family":"qwen2",
                "families":["qwen2"],"parameter_size":"7.6B","quantization_level":"Q4_K_M"}}]}"#,
        )
        .expect("tags");
        assert_eq!(tags.models[0].name, "deepseek-r1:latest");
        assert_eq!(tags.models[0].size, 4_683_075_271);
        assert_eq!(tags.models[0].details.families, vec!["qwen2".to_string()]);
    }

    #[test]
    fn show_exposes_capabilities_and_context_length() {
        let show: OllamaShow = serde_json::from_str(
            r#"{"details":{"parent_model":"","format":"gguf","family":"llama",
                "families":null,"parameter_size":"8.0B","quantization_level":"Q4_0"},
                "model_info":{"general.architecture":"llama","llama.context_length":8192,
                "llama.embedding_length":4096},
                "capabilities":["completion","vision","tools","thinking"],
                "thinking":{"values":["low","medium","high"],"default":"medium"}}"#,
        )
        .expect("show");
        assert_eq!(show.context_length(), Some(8192));
        assert_eq!(show.embedding_length(), Some(4096));
        let caps = show.model_capabilities();
        assert!(caps.tools && caps.parallel_tool_calls && caps.images && caps.reasoning);
        assert!(caps.json_schema);
        assert_eq!(caps.context_window, Some(8192));
        assert_eq!(show.thinking.expect("thinking").values.len(), 3);
    }

    #[test]
    fn show_prefers_details_context_length_over_gguf_metadata() {
        let show: OllamaShow = serde_json::from_str(
            r#"{"details":{"context_length":4096},
                "model_info":{"general.architecture":"llama","llama.context_length":8192}}"#,
        )
        .expect("show");
        assert_eq!(show.context_length(), Some(4096));
        // No capability list at all: nothing is claimed.
        assert!(!show.model_capabilities().tools);
    }

    #[test]
    fn embed_response_decodes() {
        let response: OllamaEmbedResponse = serde_json::from_str(
            r#"{"model":"all-minilm","embeddings":[[0.010071029,-0.0017594862]],
                "total_duration":14143917,"load_duration":1019500,"prompt_eval_count":8}"#,
        )
        .expect("embed");
        assert_eq!(response.embeddings.len(), 1);
        assert_eq!(response.embeddings[0].len(), 2);
        assert_eq!(response.prompt_eval_count, 8);
    }

    #[test]
    fn requests_omit_unset_fields() {
        let minimal = OllamaGenerateRequest::new("m", "hi").to_body();
        assert_eq!(minimal, json!({"model": "m", "prompt": "hi", "stream": true}));

        let mut request = OllamaGenerateRequest::new("m", "fn main() {");
        request.suffix = Some("}".to_string());
        request.keep_alive = Some(KeepAlive::Duration("5m".to_string()));
        request.think = Some(Think::Off);
        request.options.insert("num_predict".to_string(), json!(64));
        let body = request.to_body();
        assert_eq!(body["suffix"], "}");
        assert_eq!(body["keep_alive"], "5m");
        assert_eq!(body["think"], false);
        assert_eq!(body["options"], json!({"num_predict": 64}));
        assert!(body.get("raw").is_none() && body.get("context").is_none());

        let mut embed = OllamaEmbedRequest::new("all-minilm", ["a", "b"]);
        assert_eq!(embed.to_body(), json!({"model": "all-minilm", "input": ["a", "b"]}));
        embed.dimensions = Some(256);
        embed.truncate = Some(false);
        let body = embed.to_body();
        assert_eq!(body["dimensions"], 256);
        assert_eq!(body["truncate"], false);
    }
}
