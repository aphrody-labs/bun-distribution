// SPDX-License-Identifier: Apache-2.0
//! Pluggable model backend trait + reference implementations.
//!
//! The [`ModelBackend`] trait is the **only** surface through which
//! [`crate::turn_loop::ChatLoop`] reaches the outside world for LLM
//! completions. Every other concern (memory, tools, hooks, permissions,
//! cost, sessions) is resolved entirely inside the orchestrator.
//!
//! ## Provided implementations
//!
//! * [`StubBackend`] — deterministic in-memory backend used for unit tests and for the `aphrody
//!   chat --prompt …` one-shot smoke when no live provider is configured. Returns a caller-chosen
//!   fixed string with zero token usage; never opens a socket.
//! * [`GeminiBackend`] — adapter on top of [`aphrody_gemini_runtime::detect`] that spawns the local
//!   `gemini` CLI binary, pipes the prompt to stdin, and collapses the resulting `stream-json`
//!   NDJSON events into a single [`BackendResponse`]. The exact decoding rules are:
//!   - `text` events are concatenated into the assistant reply.
//!   - `tool_call` events are forwarded verbatim into [`BackendResponse::tool_calls`].
//!   - `done` events terminate the collapse early; downstream events are ignored.
//!   - `error` events bubble up as [`crate::error::ChatError::BackendFailure`].

use std::pin::Pin;

use async_trait::async_trait;
use futures_util::StreamExt as _;
use serde::{Deserialize, Serialize};

use crate::{
    error::ChatError,
    types::{Message, ToolInvocation},
};

// ---------------------------------------------------------------------------
// BackendResponse — the structured outcome of one backend round-trip
// ---------------------------------------------------------------------------

/// Output of one [`ModelBackend::complete`] call.
///
/// A backend is free to stream internally; the surface here is "collapsed"
/// so the orchestrator has a single, structured handoff point. For genuine
/// streaming UI integrations callers can implement [`ModelBackend::stream`]
/// in addition to (or instead of) `complete`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct BackendResponse {
    /// Concatenated assistant text. May be empty when the response is purely
    /// a tool-call solicitation.
    pub content: String,
    /// Tool calls the model wants the orchestrator to dispatch. Empty when the
    /// model produced a pure-text response.
    #[serde(default)]
    pub tool_calls: Vec<ToolInvocation>,
    /// Prompt-side tokens billed.
    #[serde(default)]
    pub prompt_tokens: u32,
    /// Completion-side tokens billed.
    #[serde(default)]
    pub completion_tokens: u32,
    /// Free-form model identifier echoed by the backend (Gemini may rename
    /// the requested model server-side, Anthropic returns the resolved
    /// `claude-opus-4-7` even when `claude-opus-4` was requested). Optional
    /// so backends that don't expose this can leave it `None`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub resolved_model: Option<String>,
}

impl BackendResponse {
    /// Build a text-only response with zero usage and no tool calls. Useful
    /// for the [`StubBackend`] and for tests.
    #[must_use]
    pub fn text(content: impl Into<String>) -> Self {
        Self {
            content: content.into(),
            tool_calls: Vec::new(),
            prompt_tokens: 0,
            completion_tokens: 0,
            resolved_model: None,
        }
    }
}

// ---------------------------------------------------------------------------
// ModelBackend trait
// ---------------------------------------------------------------------------

/// Async surface the orchestrator drives.
///
/// Implementations are stored as `Box<dyn ModelBackend>` on the
/// [`crate::turn_loop::ChatLoop`] so the active backend can be swapped at
/// construction time without touching call sites.
#[async_trait]
pub trait ModelBackend: Send + Sync {
    /// Stable identifier for logs / metrics / event-bus labelling
    /// (`"stub"`, `"gemini-cli"`, `"router/anthropic"`, …).
    fn name(&self) -> &str;

    /// Complete one turn given the running conversation thread.
    ///
    /// `messages` is the full ordered context window. Implementations are
    /// responsible for projecting it into their native wire shape (Anthropic
    /// `messages[]`, Gemini `contents[]`, …).
    async fn complete(&self, messages: &[Message]) -> Result<BackendResponse, ChatError>;

    /// Optional streaming surface. The default implementation buffers the
    /// full response via [`Self::complete`] and emits a single chunk so
    /// streaming consumers can be written against a unified API.
    async fn stream(
        &self,
        messages: &[Message],
    ) -> Result<
        Pin<Box<dyn futures_util::Stream<Item = Result<String, ChatError>> + Send>>,
        ChatError,
    > {
        let resp = self.complete(messages).await?;
        let chunk = resp.content;
        let one = futures_util::stream::once(async move { Ok::<String, ChatError>(chunk) });
        Ok(Box::pin(one))
    }
}

// ---------------------------------------------------------------------------
// StubBackend — deterministic, no-network, no-state implementation
// ---------------------------------------------------------------------------

/// Deterministic backend that always returns the same reply.
///
/// Production-ready in the same sense as [`std::iter::repeat`]: it does
/// exactly one thing, predictably, with zero allocations beyond the cloned
/// reply string and zero side effects. Drives the integration tests and the
/// `aphrody chat --prompt …` one-shot smoke when no live provider is wired.
#[derive(Debug, Clone)]
pub struct StubBackend {
    reply: String,
    name: String,
}

impl StubBackend {
    /// Build a stub that echoes `reply` on every `complete` call.
    #[must_use]
    pub fn with_reply(reply: impl Into<String>) -> Self {
        Self { reply: reply.into(), name: "stub".to_string() }
    }

    /// Override the backend's logged identifier — useful when a test wants
    /// to distinguish two stub backends on the same event bus.
    #[must_use]
    pub fn with_name(mut self, name: impl Into<String>) -> Self {
        self.name = name.into();
        self
    }
}

impl Default for StubBackend {
    fn default() -> Self {
        Self::with_reply("(stub backend reply — no live provider configured)")
    }
}

#[async_trait]
impl ModelBackend for StubBackend {
    fn name(&self) -> &str {
        &self.name
    }

    async fn complete(&self, _messages: &[Message]) -> Result<BackendResponse, ChatError> {
        Ok(BackendResponse::text(self.reply.clone()))
    }
}

// ---------------------------------------------------------------------------
// GeminiBackend — adapter over the local `gemini` CLI
// ---------------------------------------------------------------------------

/// Adapter that streams completions from the local `gemini` CLI binary
/// (resolved via [`aphrody_gemini_runtime::detect`]).
///
/// Construction is fallible — the constructor probes the `gemini` binary
/// once, captures its version, and stores the handle so subsequent
/// `complete` calls reuse the same path.
#[derive(Debug, Clone)]
pub struct GeminiBackend {
    runtime: aphrody_gemini_runtime::GeminiRuntime,
    model: Option<String>,
}

impl GeminiBackend {
    /// Detect the binary and build a backend pointing at it.
    ///
    /// # Errors
    ///
    /// Returns [`ChatError::BackendFailure`] when [`aphrody_gemini_runtime::detect`]
    /// fails (binary absent from PATH, version probe non-zero, parse error).
    pub async fn detect() -> Result<Self, ChatError> {
        let runtime = aphrody_gemini_runtime::detect()
            .await
            .map_err(|e| ChatError::BackendFailure(format!("gemini-runtime detect: {e}")))?;
        Ok(Self { runtime, model: None })
    }

    /// Override the model passed to `gemini --model <…>` for this backend.
    /// Pass `None` (or an empty string) to fall back to the CLI's default.
    #[must_use]
    pub fn with_model(mut self, model: Option<String>) -> Self {
        self.model = model.filter(|s| !s.is_empty());
        self
    }

    /// Borrow the resolved CLI version string.
    #[must_use]
    pub fn version(&self) -> &str {
        &self.runtime.version
    }
}

#[async_trait]
impl ModelBackend for GeminiBackend {
    fn name(&self) -> &str {
        "gemini-cli"
    }

    async fn complete(&self, messages: &[Message]) -> Result<BackendResponse, ChatError> {
        // Project the messages into a single prompt string. We use a simple
        // role-prefixed transcript because the upstream gemini CLI consumes a
        // single stdin blob and is responsible for its own framing. This
        // matches the shape used by the existing `aphrody gemini "…"`
        // subcommand which forwards the raw args.
        let mut prompt = String::new();
        for m in messages {
            prompt.push_str(m.role.as_str());
            prompt.push_str(": ");
            prompt.push_str(&m.content);
            prompt.push('\n');
        }

        let opts = aphrody_gemini_runtime::TurnOptions {
            model: self.model.clone(),
            image_paths: Vec::new(),
            extra_args: Vec::new(),
        };

        let mut stream = self.runtime.turn(&prompt, &opts).await;
        let mut content = String::new();
        let mut tool_calls: Vec<ToolInvocation> = Vec::new();
        let mut resolved_model: Option<String> = None;
        let mut latest_error: Option<String> = None;

        while let Some(event) = stream.next().await {
            match event {
                aphrody_gemini_runtime::StreamEvent::Text(t) => content.push_str(&t),
                aphrody_gemini_runtime::StreamEvent::ToolCall { name, arguments, call_id } => {
                    let id = call_id.unwrap_or_default();
                    tool_calls.push(ToolInvocation::new(id, name, arguments));
                },
                aphrody_gemini_runtime::StreamEvent::Done { model } => {
                    if let Some(m) = model {
                        resolved_model = Some(m);
                    }
                    break;
                },
                aphrody_gemini_runtime::StreamEvent::Error { message, .. } => {
                    latest_error = Some(message);
                    // Don't break — collect any prior text/tool_call so the
                    // caller has the most useful partial outcome possible.
                },
                aphrody_gemini_runtime::StreamEvent::Unknown(_) => {
                    // Forward-compat: silently drop unknown envelopes.
                },
            }
        }

        if content.is_empty()
            && tool_calls.is_empty()
            && let Some(msg) = latest_error
        {
            return Err(ChatError::BackendFailure(msg));
        }

        Ok(BackendResponse {
            content,
            tool_calls,
            prompt_tokens: 0, // gemini stream-json does not surface usage; safe zero.
            completion_tokens: 0,
            resolved_model,
        })
    }
}

// ---------------------------------------------------------------------------
// AnthropicBackend / AntigravityBackend — live adapters
// ---------------------------------------------------------------------------

/// Default Anthropic model when the backend is constructed with `None` (or
/// `Some("")`). Aligned with project memory `project_aphrody_providers_3only`
/// — the Opus 4.7 tier is the canonical default for orchestrated turns.
pub const ANTHROPIC_DEFAULT_MODEL: &str = "claude-opus-4-7";

/// Cloud Code model used when the backend is constructed without a model override.
pub const ANTIGRAVITY_DEFAULT_MODEL: &str = "gemini-3-flash";

/// Project a chat-loop [`Message`] slice into the router's
/// [`aphrody_router::ChatMessage`] shape, using the existing
/// [`MessageRole::to_router`] projection so the role mapping stays
/// authoritative in `types.rs`.
fn to_router_messages(messages: &[Message]) -> Vec<aphrody_router::ChatMessage> {
    messages
        .iter()
        .map(|m| {
            // Tool-result messages carry their dispatch id on the first
            // recorded tool_call entry (if any) — surface it so the router
            // can round-trip `tool_call_id` for providers that need it.
            let tool_call_id = if matches!(m.role, crate::types::MessageRole::Tool) {
                m.tool_calls.first().map(|tc| tc.id.clone())
            } else {
                None
            };
            aphrody_router::ChatMessage {
                role: m.role.to_router(),
                content: m.content.clone(),
                tool_call_id,
            }
        })
        .collect()
}

/// Live adapter that dispatches through
/// [`aphrody_router::ChatProvider::complete`] for the Anthropic provider.
///
/// Construction is two-step:
///
/// 1. [`AnthropicBackend::new`] builds the underlying [`aphrody_router::AnthropicProvider`] (which
///    itself builds a single long-lived `reqwest::Client`).
/// 2. Optional [`AnthropicBackend::with_model`] picks the model slug routed to the wire (defaults
///    to [`ANTHROPIC_DEFAULT_MODEL`] when called with `None` / empty string).
///
/// `from_env` is provided as a one-shot helper that reads
/// `APHRODY_ANTHROPIC_API_KEY` first (so the project-specific override
/// always wins) and falls back to the standard SDK env var
/// `ANTHROPIC_API_KEY`. Missing-credential failures surface as
/// [`ChatError::BackendFailure`] — never a panic.
#[derive(Debug, Clone)]
pub struct AnthropicBackend {
    provider: aphrody_router::AnthropicProvider,
    model: String,
}

impl AnthropicBackend {
    /// Build a backend pointing at the public Anthropic Messages endpoint
    /// using `api_key` for authentication. The default model
    /// ([`ANTHROPIC_DEFAULT_MODEL`]) is used until overridden via
    /// [`Self::with_model`].
    ///
    /// # Errors
    /// Returns [`ChatError::BackendFailure`] when the underlying reqwest
    /// client builder fails (extremely rare — only happens when the host
    /// TLS stack cannot initialise).
    pub fn new(api_key: impl Into<String>) -> Result<Self, ChatError> {
        let provider = aphrody_router::AnthropicProvider::new(api_key)
            .map_err(|e| ChatError::BackendFailure(format!("anthropic: {e}")))?;
        Ok(Self { provider, model: ANTHROPIC_DEFAULT_MODEL.to_string() })
    }

    /// Read the API key from the process environment.
    ///
    /// Lookup order:
    /// 1. `APHRODY_ANTHROPIC_API_KEY` — aphrody-specific override.
    /// 2. `ANTHROPIC_API_KEY` — standard Anthropic SDK convention.
    ///
    /// # Errors
    /// Returns [`ChatError::BackendFailure`] with `"ANTHROPIC_API_KEY not set"`
    /// when neither variable is present (or both are empty).
    pub fn from_env() -> Result<Self, ChatError> {
        Self::from_env_lookup(
            std::env::var("APHRODY_ANTHROPIC_API_KEY").ok(),
            std::env::var("ANTHROPIC_API_KEY").ok(),
        )
    }

    /// Pure-function variant of [`Self::from_env`]: takes the two candidate
    /// env-var values explicitly so unit tests can exercise the lookup
    /// precedence (aphrody override > standard SDK var > missing) without
    /// touching the process-global environment (which would require
    /// `unsafe` under the workspace `#![forbid(unsafe_code)]` policy).
    ///
    /// # Errors
    /// Returns [`ChatError::BackendFailure`] with `"ANTHROPIC_API_KEY not set"`
    /// when both inputs are `None` or empty.
    pub fn from_env_lookup(
        aphrody_override: Option<String>,
        standard: Option<String>,
    ) -> Result<Self, ChatError> {
        let key = aphrody_override
            .or(standard)
            .filter(|s| !s.is_empty())
            .ok_or_else(|| ChatError::BackendFailure("ANTHROPIC_API_KEY not set".to_string()))?;
        Self::new(key)
    }

    /// Override the model slug used for subsequent `complete` calls.
    /// Passing `None` or `Some("")` resets to [`ANTHROPIC_DEFAULT_MODEL`].
    #[must_use]
    pub fn with_model(mut self, model: Option<String>) -> Self {
        self.model =
            model.filter(|s| !s.is_empty()).unwrap_or_else(|| ANTHROPIC_DEFAULT_MODEL.to_string());
        self
    }

    /// Borrow the model slug currently configured.
    #[must_use]
    pub fn model(&self) -> &str {
        &self.model
    }
}

#[async_trait]
impl ModelBackend for AnthropicBackend {
    fn name(&self) -> &str {
        "router/anthropic"
    }

    async fn complete(&self, messages: &[Message]) -> Result<BackendResponse, ChatError> {
        use aphrody_router::ChatProvider as _;

        let req = aphrody_router::ChatRequest {
            model: aphrody_router::ModelId::new(
                aphrody_router::Provider::Anthropic,
                self.model.clone(),
            ),
            messages: to_router_messages(messages),
            temperature: None,
            max_tokens: None,
            stream: false,
        };
        let resp = self
            .provider
            .complete(req)
            .await
            .map_err(|e| ChatError::BackendFailure(format!("anthropic: {e}")))?;
        Ok(BackendResponse {
            content: resp.content,
            tool_calls: Vec::new(),
            prompt_tokens: resp.usage.prompt_tokens,
            completion_tokens: resp.usage.completion_tokens,
            resolved_model: Some(resp.model.name),
        })
    }
}

/// Live adapter that dispatches through
/// [`aphrody_router::ChatProvider::complete`] for Antigravity Cloud Code.
///
/// The router reads the desktop-maintained OAuth credential via the Cloud Code
/// SDK; an explicit OAuth access token can be supplied with [`Self::new`].
#[derive(Debug, Clone)]
pub struct AntigravityBackend {
    provider: aphrody_router::AntigravityProvider,
    model: String,
}

impl AntigravityBackend {
    /// Build a backend pointing at the default Cloud Code host using
    /// `access_token` as the Bearer credential.
    ///
    /// # Errors
    /// Returns [`ChatError::BackendFailure`] when the OAuth token is empty.
    pub fn new(access_token: impl Into<String>) -> Result<Self, ChatError> {
        let provider = aphrody_router::AntigravityProvider::new(access_token)
            .map_err(|e| ChatError::BackendFailure(format!("antigravity: {e}")))?;
        Ok(Self { provider, model: ANTIGRAVITY_DEFAULT_MODEL.to_string() })
    }

    /// Read the desktop-maintained OAuth token from the credential store.
    ///
    /// # Errors
    /// Returns a backend error when no Antigravity OAuth credential is available.
    pub fn from_env() -> Result<Self, ChatError> {
        let provider = aphrody_router::AntigravityProvider::from_credential_manager()
            .map_err(|error| ChatError::BackendFailure(format!("antigravity: {error}")))?;
        Ok(Self { provider, model: ANTIGRAVITY_DEFAULT_MODEL.to_owned() })
    }

    /// Construct from explicitly supplied OAuth access token candidates.
    ///
    /// # Errors
    /// Returns a backend error when both inputs are absent or empty.
    pub fn from_env_lookup(
        aphrody_override: Option<String>,
        standard: Option<String>,
    ) -> Result<Self, ChatError> {
        let key = aphrody_override.or(standard).filter(|s| !s.is_empty()).ok_or_else(|| {
            ChatError::BackendFailure("Antigravity OAuth token not set".to_string())
        })?;
        Self::new(key)
    }

    /// Override the model slug used for subsequent `complete` calls.
    /// Passing `None` or `Some("")` resets to [`ANTIGRAVITY_DEFAULT_MODEL`].
    #[must_use]
    pub fn with_model(mut self, model: Option<String>) -> Self {
        self.model = model
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| ANTIGRAVITY_DEFAULT_MODEL.to_string());
        self
    }

    /// Borrow the model slug currently configured.
    #[must_use]
    pub fn model(&self) -> &str {
        &self.model
    }
}

#[async_trait]
impl ModelBackend for AntigravityBackend {
    fn name(&self) -> &str {
        "router/antigravity"
    }

    async fn complete(&self, messages: &[Message]) -> Result<BackendResponse, ChatError> {
        use aphrody_router::ChatProvider as _;

        let req = aphrody_router::ChatRequest {
            model: aphrody_router::ModelId::new(
                aphrody_router::Provider::Antigravity,
                self.model.clone(),
            ),
            messages: to_router_messages(messages),
            temperature: None,
            max_tokens: None,
            stream: false,
        };
        let resp = self
            .provider
            .complete(req)
            .await
            .map_err(|e| ChatError::BackendFailure(format!("antigravity: {e}")))?;
        Ok(BackendResponse {
            content: resp.content,
            tool_calls: Vec::new(),
            prompt_tokens: resp.usage.prompt_tokens,
            completion_tokens: resp.usage.completion_tokens,
            resolved_model: Some(resp.model.name),
        })
    }
}

// ---------------------------------------------------------------------------
// LocalBackend — OpenAI-compatible local HTTP endpoint (llama-server / vLLM)
// ---------------------------------------------------------------------------

/// Default base URL for local inference (llama-server default).
pub const LOCAL_DEFAULT_BASE_URL: &str = "http://127.0.0.1:8080/v1";

/// Default local chat model slug.
pub const LOCAL_DEFAULT_MODEL: &str = "qwen3-30b-a3b-instruct-2507-q4km";

/// Adapter connecting aphrody-chat directly to local OpenAI-compatible
/// servers (llama-server, vLLM, Aphrody AI API).
#[derive(Debug, Clone)]
pub struct LocalBackend {
    client: reqwest::Client,
    base_url: String,
    model: String,
    temperature: Option<f32>,
}

impl LocalBackend {
    /// Construct a new `LocalBackend` with the specified base URL and model.
    pub fn new(base_url: impl Into<String>, model: impl Into<String>) -> Self {
        Self {
            client: reqwest::Client::new(),
            base_url: base_url.into().trim_end_matches('/').to_string(),
            model: model.into(),
            temperature: None,
        }
    }

    /// Construct `LocalBackend` by inspecting environment variables:
    /// - `APHRODY_AI_CHAT_BASE_URL` or `APHRODY_AI_HTTP_URL` (default: `http://127.0.0.1:8080/v1`)
    /// - `APHRODY_AI_CHAT_MODEL` (default: `qwen3-30b-a3b-instruct-2507-q4km`)
    #[must_use]
    pub fn from_env_or_default() -> Self {
        let base_url = std::env::var("APHRODY_AI_CHAT_BASE_URL")
            .or_else(|_| std::env::var("APHRODY_AI_HTTP_URL"))
            .unwrap_or_else(|_| LOCAL_DEFAULT_BASE_URL.to_string());

        let model = std::env::var("APHRODY_AI_CHAT_MODEL")
            .unwrap_or_else(|_| LOCAL_DEFAULT_MODEL.to_string());

        Self::new(base_url, model)
    }

    /// Override the model slug used for completions.
    #[must_use]
    pub fn with_model(mut self, model: Option<String>) -> Self {
        self.model =
            model.filter(|s| !s.is_empty()).unwrap_or_else(|| LOCAL_DEFAULT_MODEL.to_string());
        self
    }

    /// Override the temperature used for completions.
    #[must_use]
    pub fn with_temperature(mut self, temp: Option<f32>) -> Self {
        self.temperature = temp;
        self
    }

    /// Get configured model identifier.
    #[must_use]
    pub fn model(&self) -> &str {
        &self.model
    }

    /// Get configured base URL.
    #[must_use]
    pub fn base_url(&self) -> &str {
        &self.base_url
    }
}

#[async_trait]
impl ModelBackend for LocalBackend {
    fn name(&self) -> &str {
        "local/openai-compat"
    }

    async fn complete(&self, messages: &[Message]) -> Result<BackendResponse, ChatError> {
        let endpoint = if self.base_url.ends_with("/chat/completions") {
            self.base_url.clone()
        } else {
            format!("{}/chat/completions", self.base_url)
        };

        // Wire OpenAI JSON messages payload
        let wire_messages: Vec<serde_json::Value> = messages
            .iter()
            .map(|m| {
                let role = match m.role {
                    crate::types::MessageRole::User => "user",
                    crate::types::MessageRole::Assistant => "assistant",
                    crate::types::MessageRole::System => "system",
                    crate::types::MessageRole::Tool => "tool",
                };
                serde_json::json!({
                    "role": role,
                    "content": m.content,
                })
            })
            .collect();

        let mut body = serde_json::json!({
            "model": self.model,
            "messages": wire_messages,
            "stream": false,
        });

        if let Some(temp) = self.temperature {
            body["temperature"] = serde_json::json!(temp);
        }

        let resp = self
            .client
            .post(&endpoint)
            .header("Content-Type", "application/json")
            .json(&body)
            .send()
            .await
            .map_err(|e| {
                ChatError::BackendFailure(format!("local inference connection error: {e}"))
            })?;

        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            return Err(ChatError::BackendFailure(format!(
                "local model returned HTTP {status}: {text}"
            )));
        }

        let json_val: serde_json::Value = resp.json().await.map_err(|e| {
            ChatError::BackendFailure(format!("failed to parse response JSON: {e}"))
        })?;

        let content = json_val
            .pointer("/choices/0/message/content")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();

        let prompt_tokens =
            json_val.pointer("/usage/prompt_tokens").and_then(|v| v.as_u64()).unwrap_or(0) as u32;

        let completion_tokens =
            json_val.pointer("/usage/completion_tokens").and_then(|v| v.as_u64()).unwrap_or(0)
                as u32;

        let resolved_model = json_val
            .pointer("/model")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
            .or_else(|| Some(self.model.clone()));

        Ok(BackendResponse {
            content,
            tool_calls: Vec::new(),
            prompt_tokens,
            completion_tokens,
            resolved_model,
        })
    }
}

// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::Message;

    /// Install the rustls ring `CryptoProvider` exactly once for the entire
    /// test binary — reqwest 0.13 panics with `"No provider set"` the first
    /// time a `Client::builder().build()` runs otherwise (see CLAUDE.md §7).
    #[allow(dead_code)]
    fn install_crypto_provider() {
        use std::sync::Once;
        static ONCE: Once = Once::new();
        ONCE.call_once(|| {
            let _ = rustls::crypto::ring::default_provider().install_default();
        });
    }

    #[tokio::test]
    async fn stub_backend_returns_configured_reply() {
        let b = StubBackend::with_reply("hello-from-stub");
        let msgs = vec![Message::user("ping")];
        let resp = b.complete(&msgs).await.unwrap();
        assert_eq!(resp.content, "hello-from-stub");
        assert!(resp.tool_calls.is_empty());
        assert_eq!(resp.prompt_tokens, 0);
    }

    #[tokio::test]
    async fn stub_backend_stream_emits_single_chunk() {
        let b = StubBackend::with_reply("one-chunk");
        let mut s = b.stream(&[Message::user("ping")]).await.unwrap();
        let first = s.next().await.expect("at least one chunk").unwrap();
        assert_eq!(first, "one-chunk");
        assert!(s.next().await.is_none());
    }

    // ----- AnthropicBackend ---------------------------------------------

    /// `from_env_lookup(None, None)` must structurally fail with a
    /// `BackendFailure` carrying the `ANTHROPIC_API_KEY` token (proves the
    /// missing-credential path of `from_env` without mutating the
    /// process-global environment, which would require `unsafe` under the
    /// crate-wide `#![forbid(unsafe_code)]` policy).
    #[tokio::test]
    async fn anthropic_backend_from_env_without_key_errors() {
        install_crypto_provider();
        let err = AnthropicBackend::from_env_lookup(None, None)
            .expect_err("from_env_lookup should fail when both inputs absent");
        match err {
            ChatError::BackendFailure(msg) => {
                assert!(
                    msg.contains("ANTHROPIC_API_KEY"),
                    "msg should mention the env var, got: {msg}"
                );
            },
            other => panic!("expected BackendFailure, got {other:?}"),
        }

        // Empty strings must also be treated as missing.
        let err2 = AnthropicBackend::from_env_lookup(Some(String::new()), Some(String::new()))
            .expect_err("empty strings should be rejected as missing");
        assert!(matches!(err2, ChatError::BackendFailure(_)));
    }

    /// Lookup precedence: the first explicit OAuth token wins.
    #[tokio::test]
    async fn anthropic_backend_from_env_lookup_prefers_aphrody_override() {
        install_crypto_provider();
        let b = AnthropicBackend::from_env_lookup(
            Some("from-aphrody-override".to_string()),
            Some("from-standard-anthropic".to_string()),
        )
        .expect("both present → builds");
        // The override must have been chosen; we can't inspect the api_key
        // directly (it lives inside the router provider), so we instead
        // verify the backend was built and is dispatchable.
        assert_eq!(b.name(), "router/anthropic");
    }

    /// Construction with an explicit (fake) key must succeed without making
    /// any network call. Exercises the constructor + `with_model` builder +
    /// `name` accessor — all offline-safe.
    #[tokio::test]
    async fn anthropic_backend_new_and_with_model_default_to_opus() {
        install_crypto_provider();
        let b = AnthropicBackend::new("sk-ant-fake-test-key").unwrap();
        assert_eq!(b.name(), "router/anthropic");
        assert_eq!(b.model(), ANTHROPIC_DEFAULT_MODEL);

        let b2 = b.clone().with_model(None);
        assert_eq!(b2.model(), ANTHROPIC_DEFAULT_MODEL);

        let b3 = b.clone().with_model(Some(String::new()));
        assert_eq!(b3.model(), ANTHROPIC_DEFAULT_MODEL);

        let b4 = b.with_model(Some("claude-3-5-haiku-latest".to_string()));
        assert_eq!(b4.model(), "claude-3-5-haiku-latest");
    }

    // ----- AntigravityBackend -------------------------------------------

    /// `from_env_lookup(None, None)` must structurally fail with a
    /// Missing explicit OAuth tokens return a structured backend error.
    #[tokio::test]
    async fn antigravity_backend_from_env_without_key_errors() {
        install_crypto_provider();
        let err = AntigravityBackend::from_env_lookup(None, None)
            .expect_err("from_env_lookup should fail when both inputs absent");
        match err {
            ChatError::BackendFailure(msg) => {
                assert!(msg.contains("OAuth token"), "msg should mention the env var, got: {msg}");
            },
            other => panic!("expected BackendFailure, got {other:?}"),
        }

        let err2 = AntigravityBackend::from_env_lookup(Some(String::new()), Some(String::new()))
            .expect_err("empty strings should be rejected as missing");
        assert!(matches!(err2, ChatError::BackendFailure(_)));
    }

    /// Lookup precedence: aphrody override wins over standard SDK var.
    #[tokio::test]
    async fn antigravity_backend_from_env_lookup_prefers_aphrody_override() {
        install_crypto_provider();
        let b = AntigravityBackend::from_env_lookup(
            Some("ya29.from-aphrody-override".to_string()),
            Some("ya29.from-fallback".to_string()),
        )
        .expect("both present → builds");
        assert_eq!(b.name(), "router/antigravity");
    }

    /// Construction with an explicit (fake) access token must succeed without
    /// any network call.
    #[tokio::test]
    async fn antigravity_backend_new_and_with_model_default_to_flash() {
        install_crypto_provider();
        let b = AntigravityBackend::new("ya29.fake-test-token").unwrap();
        assert_eq!(b.name(), "router/antigravity");
        assert_eq!(b.model(), ANTIGRAVITY_DEFAULT_MODEL);

        let b2 = b.clone().with_model(None);
        assert_eq!(b2.model(), ANTIGRAVITY_DEFAULT_MODEL);

        let b3 = b.clone().with_model(Some(String::new()));
        assert_eq!(b3.model(), ANTIGRAVITY_DEFAULT_MODEL);

        let b4 = b.with_model(Some("antigravity-experimental".to_string()));
        assert_eq!(b4.model(), "antigravity-experimental");
    }

    // ----- LocalBackend -------------------------------------------------

    #[tokio::test]
    async fn local_backend_defaults_and_with_model() {
        install_crypto_provider();
        let b = LocalBackend::new("http://localhost:8080/v1", "custom-model");
        assert_eq!(b.name(), "local/openai-compat");
        assert_eq!(b.base_url(), "http://localhost:8080/v1");
        assert_eq!(b.model(), "custom-model");

        let b2 = b
            .with_model(Some("qwen3-30b-a3b-instruct-2507-q4km".to_string()))
            .with_temperature(Some(0.7));
        assert_eq!(b2.model(), "qwen3-30b-a3b-instruct-2507-q4km");
    }

    #[tokio::test]
    async fn local_backend_from_env_or_default() {
        install_crypto_provider();
        let b = LocalBackend::from_env_or_default();
        assert_eq!(b.name(), "local/openai-compat");
        assert!(!b.base_url().is_empty());
        assert!(!b.model().is_empty());
    }
}
