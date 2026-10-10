// SPDX-License-Identifier: Apache-2.0
//! Native Ollama client: the `/api/*` wire, not the OpenAI-compatible one.
//!
//! [`OpenAiCompatClient`](crate::OpenAiCompatClient) already talks to Ollama's
//! `/v1/chat/completions`, which is enough for plain chat. This module speaks
//! the native protocol (`api/types.go`, `server/routes.go` in the Ollama tree)
//! for what the compatibility layer cannot express:
//!
//! - [`OllamaClient`] — a [`ModelClient`] over `POST /api/chat` with NDJSON
//!   streaming, native `thinking` and `tool_calls` fields, `think` levels,
//!   `keep_alive` and `options` such as `num_ctx`;
//! - [`OllamaApi`] — the management surface: `/api/tags`, `/api/show`,
//!   `/api/ps`, `/api/version`, `/api/embed`, `/api/generate`, streaming
//!   `/api/pull` progress, `/api/delete`, load and unload.
//!
//! Both share one `reqwest` stack and the retry policy of the other wires.
//! The base URL may be the server root or the OpenAI-compatible root
//! (`http://localhost:11434/v1`): a trailing `/v1` is removed, so a provider
//! entry written for the compatibility endpoint works unchanged.

mod chat;
mod types;

use std::{
    pin::Pin,
    sync::{Arc, OnceLock},
};

use async_trait::async_trait;
use futures::{Stream, StreamExt};
use serde::Deserialize;
use serde_json::{Value, json};

use self::{chat::chat_ndjson_stream, types::null_default};
pub use self::{
    chat::{OllamaChatDefaults, build_ollama_chat_request},
    types::{
        KeepAlive, OllamaChatChunk, OllamaChatMessage, OllamaEmbedRequest, OllamaEmbedResponse,
        OllamaGenerateChunk, OllamaGenerateRequest, OllamaMetrics, OllamaModelDetails,
        OllamaModelSummary, OllamaProgress, OllamaRunningModel, OllamaShow, OllamaThinking,
        OllamaToolCall, OllamaToolCallFunction, Think,
    },
};
use crate::{
    ChatTurn, EmbedClient, ModelCapabilities, ModelClient, ModelError, ModelStream,
    http::{request_json, rooted, send_request},
    ndjson::{error_line, ndjson_values},
    openai_compat::{ProviderRuntime, merge_options, with_idle_timeout},
};

/// A boxed stream of `/api/pull` progress lines.
pub type OllamaProgressStream =
    Pin<Box<dyn Stream<Item = Result<OllamaProgress, ModelError>> + Send>>;

/// A boxed stream of `/api/generate` chunks.
pub type OllamaGenerateStream =
    Pin<Box<dyn Stream<Item = Result<OllamaGenerateChunk, ModelError>> + Send>>;

/// Default endpoint of a local Ollama server.
pub const DEFAULT_OLLAMA_URL: &str = "http://localhost:11434";

/// Resolve an `OLLAMA_HOST` value to a base URL, as Ollama's own client does
/// (`envconfig.Host`): the scheme defaults to `http`, the port to `11434`
/// (`80` / `443` when the scheme is explicit), an empty value means the
/// loopback default, and `ollama.com` is the hosted service over `https`.
///
/// Pure: the caller reads the environment and passes the value in.
#[must_use]
pub fn ollama_host_to_url(host: &str) -> String {
    let host = host.trim();
    if host.is_empty() {
        return DEFAULT_OLLAMA_URL.to_string();
    }
    if host == "ollama.com" {
        return "https://ollama.com:443".to_string();
    }
    let (scheme, rest, explicit) = match host.split_once("://") {
        Some((scheme, rest)) => (scheme, rest, true),
        None => ("http", host, false),
    };
    let default_port = match (scheme, explicit) {
        ("http", true) => "80",
        ("https", true) => "443",
        _ => "11434",
    };
    // A path after the authority is kept; the authority gets its default port.
    let (authority, path) = match rest.split_once('/') {
        Some((authority, path)) => (authority, format!("/{path}")),
        None => (rest, String::new()),
    };
    let authority = if authority.is_empty() {
        format!("127.0.0.1:{default_port}")
    } else if let Ok(ip) = authority.parse::<std::net::Ipv6Addr>() {
        // A bare IPv6 address has no port and needs brackets in a URL.
        format!("[{ip}]:{default_port}")
    } else {
        let has_port = if let Some(stripped) = authority.strip_prefix('[') {
            // Bracketed IPv6: a port follows the closing bracket.
            stripped.split_once(']').is_some_and(|(_, tail)| tail.starts_with(':'))
        } else {
            authority.contains(':')
        };
        if has_port { authority.to_string() } else { format!("{authority}:{default_port}") }
    };
    // `0.0.0.0` / `[::]` are valid to bind but not to connect to (they fail on
    // Windows); Ollama's `ConnectableHost` maps them to loopback.
    let authority = if let Some(port) = authority.strip_prefix("0.0.0.0") {
        format!("127.0.0.1{port}")
    } else if let Some(port) = authority.strip_prefix("[::]") {
        format!("[::1]{port}")
    } else {
        authority
    };
    format!("{scheme}://{authority}{}", path.trim_end_matches('/'))
}

/// Ollama's shortest display form of a model name, lower-cased: the default
/// registry host and the `library` namespace are dropped and a missing tag
/// becomes `latest`. `/api/tags` reports names in this form, so two spellings
/// of one model compare equal after this.
#[must_use]
pub fn canonical_model_name(name: &str) -> String {
    let lowered = name.trim().to_ascii_lowercase();
    let without_scheme = lowered.split_once("://").map_or(lowered.as_str(), |(_, rest)| rest);
    let without_host = without_scheme.strip_prefix("registry.ollama.ai/").unwrap_or(without_scheme);
    let without_namespace = without_host.strip_prefix("library/").unwrap_or(without_host);
    let has_tag = without_namespace.rsplit('/').next().is_some_and(|segment| segment.contains(':'));
    if has_tag { without_namespace.to_string() } else { format!("{without_namespace}:latest") }
}

// ---------------------------------------------------------------------------
// Management API.
// ---------------------------------------------------------------------------

/// The management surface of an Ollama server.
///
/// Cheap to clone (the HTTP client is reference counted). Obtain one next to a
/// chat client with [`OllamaClient::api`].
#[derive(Debug, Clone)]
pub struct OllamaApi {
    http: reqwest::Client,
    runtime: ProviderRuntime,
}

impl OllamaApi {
    /// An API handle for the server described by `runtime`. A trailing `/v1`
    /// of `runtime.base_url` is dropped; the credential and extra headers are
    /// kept.
    #[must_use]
    pub fn new(runtime: ProviderRuntime) -> Self {
        Self { http: reqwest::Client::new(), runtime: rooted(&runtime) }
    }

    /// A keyless handle for the server at `base_url`.
    #[must_use]
    pub fn local(base_url: impl Into<String>) -> Self {
        Self::new(ProviderRuntime::keyless(base_url))
    }

    /// The server root this handle talks to.
    #[must_use]
    pub fn base_url(&self) -> &str {
        &self.runtime.base_url
    }

    fn url(&self, path: &str) -> String {
        self.runtime.endpoint_path(path)
    }

    /// `GET /api/version`: the server's version string.
    ///
    /// # Errors
    ///
    /// Transport, status and decode failures.
    pub async fn version(&self) -> Result<String, ModelError> {
        #[derive(Deserialize)]
        struct Version {
            #[serde(default)]
            version: String,
        }
        let version: Version = request_json(
            &self.http,
            &self.runtime,
            reqwest::Method::GET,
            &self.url("api/version"),
            None,
        )
        .await?;
        Ok(version.version)
    }

    /// `GET /api/tags`: the models installed on the server.
    ///
    /// # Errors
    ///
    /// Transport, status and decode failures.
    pub async fn list_models(&self) -> Result<Vec<OllamaModelSummary>, ModelError> {
        #[derive(Deserialize)]
        struct Tags {
            #[serde(default, deserialize_with = "null_default")]
            models: Vec<OllamaModelSummary>,
        }
        let tags: Tags = request_json(
            &self.http,
            &self.runtime,
            reqwest::Method::GET,
            &self.url("api/tags"),
            None,
        )
        .await?;
        Ok(tags.models)
    }

    /// `GET /api/ps`: the models currently loaded in memory.
    ///
    /// # Errors
    ///
    /// Transport, status and decode failures.
    pub async fn running_models(&self) -> Result<Vec<OllamaRunningModel>, ModelError> {
        #[derive(Deserialize)]
        struct Running {
            #[serde(default, deserialize_with = "null_default")]
            models: Vec<OllamaRunningModel>,
        }
        let running: Running = request_json(
            &self.http,
            &self.runtime,
            reqwest::Method::GET,
            &self.url("api/ps"),
            None,
        )
        .await?;
        Ok(running.models)
    }

    /// `POST /api/show`: details, capabilities and GGUF metadata of `model`.
    ///
    /// `verbose` asks for the full tokenizer arrays and tensor list, which are
    /// large; leave it off unless they are needed.
    ///
    /// # Errors
    ///
    /// [`ModelError::Api`] with status 404 when the model is not installed,
    /// plus transport and decode failures.
    pub async fn show(&self, model: &str, verbose: bool) -> Result<OllamaShow, ModelError> {
        let body = json!({ "model": model, "verbose": verbose });
        request_json(
            &self.http,
            &self.runtime,
            reqwest::Method::POST,
            &self.url("api/show"),
            Some(&body),
        )
        .await
    }

    /// Whether `model` is installed, comparing names the way Ollama does
    /// (`llama3.2`, `llama3.2:latest` and `library/llama3.2:latest` are one
    /// model).
    ///
    /// # Errors
    ///
    /// Transport, status and decode failures of `/api/tags`.
    pub async fn has_model(&self, model: &str) -> Result<bool, ModelError> {
        let wanted = canonical_model_name(model);
        Ok(self.list_models().await?.iter().any(|installed| {
            canonical_model_name(&installed.name) == wanted
                || canonical_model_name(&installed.model) == wanted
        }))
    }

    /// `POST /api/embed`: embed `request.input`.
    ///
    /// # Errors
    ///
    /// Transport, status and decode failures; a 400 when an input exceeds the
    /// context and `truncate` is `Some(false)`.
    pub async fn embed(
        &self,
        request: &OllamaEmbedRequest,
    ) -> Result<OllamaEmbedResponse, ModelError> {
        request_json(
            &self.http,
            &self.runtime,
            reqwest::Method::POST,
            &self.url("api/embed"),
            Some(&request.to_body()),
        )
        .await
    }

    /// `POST /api/generate`, streamed: completion, fill-in-the-middle (with
    /// `suffix`) and raw prompts.
    ///
    /// The stream yields every chunk including the final `done` one and ends
    /// after it; an `{"error": ...}` line becomes an `Err` item.
    ///
    /// # Errors
    ///
    /// Transport and status failures opening the stream.
    pub async fn generate(
        &self,
        request: &OllamaGenerateRequest,
    ) -> Result<OllamaGenerateStream, ModelError> {
        let response = send_request(
            &self.http,
            &self.runtime,
            reqwest::Method::POST,
            &self.url("api/generate"),
            Some(&request.to_body()),
            "application/x-ndjson",
        )
        .await?;
        let bytes = with_idle_timeout(response.bytes_stream(), self.runtime.stream_idle_timeout);
        Ok(Box::pin(typed_ndjson::<OllamaGenerateChunk, _>(bytes)))
    }

    /// `POST /api/pull`, streamed: the progress of a download.
    ///
    /// Lines are `pulling manifest`, one `pulling <digest12>` line per layer
    /// update with `total` and `completed`, `verifying sha256 digest`,
    /// `writing manifest` and finally `success`. A pull of an installed model
    /// answers `success` at once. Concurrent pulls of one model share the
    /// transfer on the server, and an interrupted pull resumes.
    ///
    /// The stream has no total timeout (a model can take hours); it fails only
    /// when the server stays silent for [`ProviderRuntime::stream_idle_timeout`].
    ///
    /// # Errors
    ///
    /// Transport and status failures opening the stream; a pull failure
    /// (`{"error": ...}` line) is an `Err` item.
    pub async fn pull(&self, model: &str) -> Result<OllamaProgressStream, ModelError> {
        let body = json!({ "model": model, "stream": true });
        let response = send_request(
            &self.http,
            &self.runtime,
            reqwest::Method::POST,
            &self.url("api/pull"),
            Some(&body),
            "application/x-ndjson",
        )
        .await?;
        let bytes = with_idle_timeout(response.bytes_stream(), self.runtime.stream_idle_timeout);
        Ok(Box::pin(typed_ndjson::<OllamaProgress, _>(bytes)))
    }

    /// Pull `model`, calling `on_progress` for every line, and return once the
    /// server reports `success`.
    ///
    /// # Errors
    ///
    /// Any failure of [`OllamaApi::pull`], and [`ModelError::Stream`] when the
    /// stream ends without a `success` line (a dropped connection).
    pub async fn pull_with(
        &self,
        model: &str,
        mut on_progress: impl FnMut(&OllamaProgress),
    ) -> Result<(), ModelError> {
        let mut stream = self.pull(model).await?;
        let mut succeeded = false;
        while let Some(item) = stream.next().await {
            let progress = item?;
            on_progress(&progress);
            succeeded |= progress.is_success();
        }
        if succeeded {
            Ok(())
        } else {
            Err(ModelError::Stream("ollama pull ended before reporting success".to_string()))
        }
    }

    /// `DELETE /api/delete`: remove `model` from the server.
    ///
    /// # Errors
    ///
    /// [`ModelError::Api`] with status 404 when the model is not installed,
    /// plus transport failures.
    pub async fn delete(&self, model: &str) -> Result<(), ModelError> {
        let body = json!({ "model": model });
        send_request(
            &self.http,
            &self.runtime,
            reqwest::Method::DELETE,
            &self.url("api/delete"),
            Some(&body),
            "application/json",
        )
        .await?;
        Ok(())
    }

    /// Load `model` into memory without generating (`/api/generate` with an
    /// empty prompt). `keep_alive` overrides how long it stays resident.
    ///
    /// # Errors
    ///
    /// Transport and status failures.
    pub async fn load(
        &self,
        model: &str,
        keep_alive: Option<&KeepAlive>,
    ) -> Result<(), ModelError> {
        let mut body = json!({ "model": model });
        if let Some(keep_alive) = keep_alive {
            body["keep_alive"] = keep_alive.to_value();
        }
        self.empty_generate(&body).await
    }

    /// Unload `model` from memory now (`keep_alive: 0`).
    ///
    /// # Errors
    ///
    /// Transport and status failures.
    pub async fn unload(&self, model: &str) -> Result<(), ModelError> {
        let body = json!({ "model": model, "keep_alive": KeepAlive::UNLOAD.to_value() });
        self.empty_generate(&body).await
    }

    async fn empty_generate(&self, body: &Value) -> Result<(), ModelError> {
        send_request(
            &self.http,
            &self.runtime,
            reqwest::Method::POST,
            &self.url("api/generate"),
            Some(body),
            "application/json",
        )
        .await?;
        Ok(())
    }
}

/// Decode an NDJSON body into typed lines, turning an `{"error": ...}` line
/// into an `Err` item.
fn typed_ndjson<T, S>(bytes: S) -> impl Stream<Item = Result<T, ModelError>> + Send
where
    T: serde::de::DeserializeOwned + Send + 'static,
    S: Stream<Item = Result<bytes::Bytes, ModelError>> + Send + 'static,
{
    ndjson_values(bytes).map(|item| {
        let value = item?;
        if let Some(message) = error_line(&value) {
            return Err(ModelError::Api { status: 502, message: message.to_string() });
        }
        T::deserialize(&value).map_err(ModelError::Decode)
    })
}

// ---------------------------------------------------------------------------
// Chat client.
// ---------------------------------------------------------------------------

/// A [`ModelClient`] over Ollama's native `POST /api/chat`.
///
/// ```no_run
/// use aphrody_model_client::{ModelClient, OllamaClient, Think};
///
/// # async fn run() -> Result<(), aphrody_model_client::ModelError> {
/// let client = OllamaClient::local("http://localhost:11434", "qwen3:8b")
///     .with_think(Think::On)
///     .with_num_ctx(16_384);
/// // Refine the capabilities from /api/show before the turn loop adapts to them.
/// let capabilities = client.probe_capabilities().await?;
/// println!("{} supports tools: {}", client.model_id(), capabilities.tools);
/// # Ok(())
/// # }
/// ```
#[derive(Debug, Clone)]
pub struct OllamaClient {
    api: OllamaApi,
    model: String,
    defaults: OllamaChatDefaults,
    probed: Arc<OnceLock<ModelCapabilities>>,
}

impl OllamaClient {
    /// Build a client for `model` served by the provider described by
    /// `runtime` (a trailing `/v1` of the base URL is dropped).
    #[must_use]
    pub fn from_provider(runtime: ProviderRuntime, model: impl Into<String>) -> Self {
        Self {
            api: OllamaApi::new(runtime),
            model: model.into(),
            defaults: OllamaChatDefaults::default(),
            probed: Arc::new(OnceLock::new()),
        }
    }

    /// A keyless client for the server at `base_url`.
    #[must_use]
    pub fn local(base_url: impl Into<String>, model: impl Into<String>) -> Self {
        Self::from_provider(ProviderRuntime::keyless(base_url), model)
    }

    /// Replace the request defaults wholesale.
    #[must_use]
    pub fn with_defaults(mut self, defaults: OllamaChatDefaults) -> Self {
        self.defaults = defaults;
        self
    }

    /// How long the server keeps the model loaded after each request.
    #[must_use]
    pub fn with_keep_alive(mut self, keep_alive: KeepAlive) -> Self {
        self.defaults.keep_alive = Some(keep_alive);
        self
    }

    /// The `think` value used when a turn sets no `reasoning_effort`.
    #[must_use]
    pub fn with_think(mut self, think: Think) -> Self {
        self.defaults.think = Some(think);
        self
    }

    /// Context window the model is loaded with (`options.num_ctx`). Ollama
    /// loads models with a small default context; agents need more.
    #[must_use]
    pub fn with_num_ctx(self, num_ctx: u32) -> Self {
        self.with_option("num_ctx", json!(num_ctx))
    }

    /// Set a model parameter (`options.<key>`) for every request.
    #[must_use]
    pub fn with_option(mut self, key: impl Into<String>, value: Value) -> Self {
        self.defaults.options.insert(key.into(), value);
        self
    }

    /// The management API on the same server and credentials.
    #[must_use]
    pub fn api(&self) -> OllamaApi {
        self.api.clone()
    }

    /// The request body sent for `turn`, provider and client defaults applied.
    #[must_use]
    pub fn request_body(&self, turn: &ChatTurn) -> Value {
        let mut turn = turn.clone();
        turn.options = merge_options(&self.api.runtime.default_options, &turn.options);
        build_ollama_chat_request(&turn, &self.model, &self.defaults)
    }

    /// Ask the server what the model can do (`/api/show`) and remember it, so
    /// [`ModelClient::capabilities`] reports the model's real tools, vision,
    /// thinking and context window instead of the conservative default.
    ///
    /// The first successful probe wins; later calls return the stored result.
    /// A `num_ctx` set through [`OllamaClient::with_num_ctx`] caps the
    /// reported context window, because that is what the model is loaded
    /// with.
    ///
    /// # Errors
    ///
    /// [`ModelError::Api`] with status 404 when the model is not installed,
    /// plus transport and decode failures.
    pub async fn probe_capabilities(&self) -> Result<ModelCapabilities, ModelError> {
        if let Some(known) = self.probed.get() {
            return Ok(known.clone());
        }
        let show = self.api.show(&self.model, false).await?;
        let mut capabilities = show.model_capabilities();
        if let Some(num_ctx) = self.defaults.options.get("num_ctx").and_then(Value::as_u64) {
            capabilities.context_window = Some(num_ctx);
        }
        Ok(self.probed.get_or_init(|| capabilities).clone())
    }
}

#[async_trait]
impl ModelClient for OllamaClient {
    async fn stream(&self, turn: ChatTurn) -> Result<ModelStream, ModelError> {
        let body = self.request_body(&turn);
        let response = send_request(
            &self.api.http,
            &self.api.runtime,
            reqwest::Method::POST,
            &self.api.url("api/chat"),
            Some(&body),
            "application/x-ndjson",
        )
        .await?;
        let bytes =
            with_idle_timeout(response.bytes_stream(), self.api.runtime.stream_idle_timeout);
        Ok(Box::pin(chat_ndjson_stream(bytes)))
    }

    fn model_id(&self) -> &str {
        &self.model
    }

    fn capabilities(&self) -> ModelCapabilities {
        self.probed.get().cloned().unwrap_or_else(|| self.api.runtime.capabilities.clone())
    }
}

/// Embeddings with the client's model (build a second client for the embedding
/// model, e.g. `nomic-embed-text`, rather than reusing a chat one).
#[async_trait]
impl EmbedClient for OllamaClient {
    fn embed_model_id(&self) -> &str {
        &self.model
    }

    async fn embed(&self, inputs: &[&str]) -> Result<Vec<Vec<f32>>, ModelError> {
        if inputs.is_empty() {
            return Ok(Vec::new());
        }
        let request = OllamaEmbedRequest::new(self.model.clone(), inputs.iter().copied());
        let response = self.api.embed(&request).await?;
        if response.embeddings.len() != inputs.len() {
            return Err(ModelError::Stream(format!(
                "ollama returned {} embeddings for {} inputs",
                response.embeddings.len(),
                inputs.len()
            )));
        }
        Ok(response.embeddings)
    }
}

#[cfg(test)]
mod tests {
    use std::sync::{Arc, Mutex, Once};

    use axum::{
        Router,
        extract::State,
        http::StatusCode,
        routing::{delete, get, post},
    };
    use pretty_assertions::assert_eq;
    use serde_json::{Value, json};

    use super::*;
    use crate::{ChatMessage, ModelStreamEvent, Part, Role};

    /// rustls 0.23 needs an explicit provider before the first `reqwest::Client`
    /// (CLAUDE.md §7).
    fn install_rustls_provider() {
        static ONCE: Once = Once::new();
        ONCE.call_once(|| {
            let _ = rustls::crypto::ring::default_provider().install_default();
        });
    }

    async fn serve(router: Router) -> String {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.expect("bind");
        let address = listener.local_addr().expect("addr");
        tokio::spawn(async move {
            let _ = axum::serve(listener, router).await;
        });
        format!("http://{address}")
    }

    /// Request bodies the mock server received, by route.
    type Seen = Arc<Mutex<Vec<(String, Value)>>>;

    fn ndjson(lines: &[Value]) -> String {
        lines.iter().map(|line| format!("{line}\n")).collect()
    }

    fn user(text: &str) -> ChatTurn {
        ChatTurn {
            messages: vec![ChatMessage {
                role: Role::User,
                parts: vec![Part::Text(text.to_string())],
            }],
            ..ChatTurn::default()
        }
    }

    #[test]
    fn ollama_host_values_resolve_like_the_go_client() {
        assert_eq!(ollama_host_to_url(""), "http://localhost:11434");
        assert_eq!(ollama_host_to_url("127.0.0.1"), "http://127.0.0.1:11434");
        // A bind address is not a connect address.
        assert_eq!(ollama_host_to_url("0.0.0.0:8080"), "http://127.0.0.1:8080");
        assert_eq!(ollama_host_to_url("0.0.0.0"), "http://127.0.0.1:11434");
        assert_eq!(ollama_host_to_url("http://gpu-box"), "http://gpu-box:80");
        assert_eq!(ollama_host_to_url("https://gpu-box"), "https://gpu-box:443");
        assert_eq!(
            ollama_host_to_url("https://gpu-box:8443/ollama/"),
            "https://gpu-box:8443/ollama"
        );
        assert_eq!(ollama_host_to_url("ollama.com"), "https://ollama.com:443");
        assert_eq!(ollama_host_to_url("[::1]"), "http://[::1]:11434");
        assert_eq!(ollama_host_to_url("::1"), "http://[::1]:11434");
        assert_eq!(ollama_host_to_url("http://[::1]:9000"), "http://[::1]:9000");
    }

    #[test]
    fn model_names_compare_the_way_ollama_displays_them() {
        assert_eq!(canonical_model_name("llama3.2"), "llama3.2:latest");
        assert_eq!(canonical_model_name("library/llama3.2:latest"), "llama3.2:latest");
        assert_eq!(canonical_model_name("registry.ollama.ai/library/gpt-oss:20b"), "gpt-oss:20b");
        assert_eq!(canonical_model_name("Me/Tuned"), "me/tuned:latest");
        assert_eq!(canonical_model_name("hf.co/user/repo:Q4_K_M"), "hf.co/user/repo:q4_k_m");
    }

    #[tokio::test]
    async fn chat_streams_native_events_and_sends_the_native_request() {
        install_rustls_provider();
        let seen: Seen = Arc::new(Mutex::new(Vec::new()));
        let router = Router::new()
            .route(
                "/api/chat",
                post(|State(seen): State<Seen>, body: String| async move {
                    let request: Value = serde_json::from_str(&body).expect("json body");
                    seen.lock().expect("lock").push(("/api/chat".to_string(), request));
                    (
                        [("content-type", "application/x-ndjson")],
                        ndjson(&[
                            json!({"model":"qwen3:8b","message":{"role":"assistant","content":"","thinking":"hmm"},"done":false}),
                            json!({"model":"qwen3:8b","message":{"role":"assistant","content":"Hello"},"done":false}),
                            json!({"model":"qwen3:8b","message":{"role":"assistant","content":""},"done":true,"done_reason":"stop","prompt_eval_count":3,"eval_count":2}),
                        ]),
                    )
                }),
            )
            .with_state(seen.clone());
        let base = serve(router).await;

        // The OpenAI-compatible root works as the base URL: `/v1` is removed.
        let client = OllamaClient::local(format!("{base}/v1"), "qwen3:8b")
            .with_think(Think::On)
            .with_num_ctx(8192)
            .with_keep_alive(KeepAlive::Duration("10m".to_string()));
        let events: Vec<ModelStreamEvent> = client
            .stream(user("hi"))
            .await
            .expect("stream")
            .map(|event| event.expect("event"))
            .collect()
            .await;

        assert_eq!(events[0], ModelStreamEvent::Created);
        assert_eq!(events[1], ModelStreamEvent::ReasoningDelta("hmm".to_string()));
        assert!(matches!(events[2], ModelStreamEvent::ReasoningItem { .. }));
        assert_eq!(events[3], ModelStreamEvent::TextDelta("Hello".to_string()));
        assert!(matches!(
            events[4],
            ModelStreamEvent::Completed { usage: Some(ref usage), .. } if usage.total_tokens == 5
        ));

        let (_, request) = seen.lock().expect("lock").remove(0);
        assert_eq!(request["model"], "qwen3:8b");
        assert_eq!(request["stream"], true);
        assert_eq!(request["think"], true);
        assert_eq!(request["keep_alive"], "10m");
        assert_eq!(request["options"]["num_ctx"], 8192);
        assert_eq!(request["messages"][0], json!({"role": "user", "content": "hi"}));
    }

    #[tokio::test]
    async fn a_missing_model_surfaces_the_server_message_and_status() {
        install_rustls_provider();
        let router = Router::new().route(
            "/api/chat",
            post(|| async {
                (
                    StatusCode::NOT_FOUND,
                    [("content-type", "application/json")],
                    r#"{"error":"model 'nope' not found"}"#,
                )
            }),
        );
        let base = serve(router).await;
        let client = OllamaClient::local(base, "nope");
        let error = client.stream(user("hi")).await.err().expect("error");
        assert!(
            matches!(
                error,
                ModelError::Api { status: 404, ref message } if message == "model 'nope' not found"
            ),
            "{error}"
        );
    }

    #[tokio::test]
    async fn management_calls_decode_the_documented_payloads() {
        install_rustls_provider();
        let seen: Seen = Arc::new(Mutex::new(Vec::new()));
        let router = Router::new()
            .route("/api/version", get(|| async { axum::Json(json!({"version": "0.12.3"})) }))
            .route(
                "/api/tags",
                get(|| async {
                    axum::Json(json!({"models": [{
                        "name": "llama3.2:latest", "model": "llama3.2:latest",
                        "modified_at": "2025-05-04T17:37:44.706015396-07:00",
                        "size": 2019393189, "digest": "a80c4f17",
                        "details": {"parent_model": "", "format": "gguf", "family": "llama",
                                    "families": ["llama"], "parameter_size": "3.2B",
                                    "quantization_level": "Q4_K_M"}
                    }]}))
                }),
            )
            .route(
                "/api/ps",
                get(|| async {
                    axum::Json(json!({"models": [{
                        "name": "mistral:latest", "model": "mistral:latest",
                        "size": 5137025024u64, "digest": "2ae6f6dd",
                        "details": {"format": "gguf", "family": "llama", "families": null},
                        "expires_at": "2024-06-04T14:38:31.83753-07:00",
                        "size_vram": 5137025024u64, "context_length": 4096
                    }]}))
                }),
            )
            .route(
                "/api/show",
                post(|State(seen): State<Seen>, body: String| async move {
                    seen.lock().expect("lock").push((
                        "/api/show".to_string(),
                        serde_json::from_str(&body).expect("json"),
                    ));
                    axum::Json(json!({
                        "details": {"format": "gguf", "family": "llama"},
                        "model_info": {"general.architecture": "llama", "llama.context_length": 8192},
                        "capabilities": ["completion", "tools"]
                    }))
                }),
            )
            .route(
                "/api/embed",
                post(|body: String| async move {
                    let request: Value = serde_json::from_str(&body).expect("json");
                    let count = request["input"].as_array().map_or(0, Vec::len);
                    axum::Json(json!({
                        "model": request["model"],
                        "embeddings": vec![vec![0.5, -0.5]; count],
                        "prompt_eval_count": 4
                    }))
                }),
            )
            .route(
                "/api/delete",
                delete(|State(seen): State<Seen>, body: String| async move {
                    seen.lock().expect("lock").push((
                        "/api/delete".to_string(),
                        serde_json::from_str(&body).expect("json"),
                    ));
                    StatusCode::OK
                }),
            )
            .with_state(seen.clone());
        let base = serve(router).await;
        let api = OllamaApi::local(format!("{base}/v1"));

        assert_eq!(api.version().await.expect("version"), "0.12.3");

        let models = api.list_models().await.expect("tags");
        assert_eq!(models[0].name, "llama3.2:latest");
        assert!(api.has_model("llama3.2").await.expect("has"));
        assert!(api.has_model("library/llama3.2:latest").await.expect("has"));
        assert!(!api.has_model("llama3.2:1b").await.expect("has"));

        let running = api.running_models().await.expect("ps");
        assert_eq!(running[0].size_vram, 5_137_025_024);
        assert_eq!(running[0].context_length, 4096);

        let show = api.show("llama3.2", false).await.expect("show");
        assert_eq!(show.context_length(), Some(8192));
        assert!(show.model_capabilities().tools);

        let embeddings =
            api.embed(&OllamaEmbedRequest::new("all-minilm", ["a", "b"])).await.expect("embed");
        assert_eq!(embeddings.embeddings.len(), 2);

        api.delete("llama3.2").await.expect("delete");

        let seen = seen.lock().expect("lock");
        assert_eq!(
            seen[0],
            ("/api/show".to_string(), json!({"model": "llama3.2", "verbose": false}))
        );
        assert_eq!(seen[1], ("/api/delete".to_string(), json!({"model": "llama3.2"})));
    }

    #[tokio::test]
    async fn probing_capabilities_replaces_the_conservative_default() {
        install_rustls_provider();
        let router = Router::new().route(
            "/api/show",
            post(|| async {
                axum::Json(json!({
                    "model_info": {"general.architecture": "qwen3", "qwen3.context_length": 40960},
                    "capabilities": ["completion", "tools", "thinking"]
                }))
            }),
        );
        let base = serve(router).await;
        let client = OllamaClient::local(base.clone(), "qwen3:8b");
        assert!(!client.capabilities().reasoning);

        let probed = client.probe_capabilities().await.expect("probe");
        assert!(probed.reasoning && probed.tools);
        assert_eq!(client.capabilities().context_window, Some(40960));
        // The probe result is shared by clones: the first probe wins.
        assert_eq!(client.clone().capabilities().context_window, Some(40960));

        // A configured `num_ctx` is what the model is loaded with, so it caps
        // the reported window.
        let capped = OllamaClient::local(base, "qwen3:8b").with_num_ctx(8192);
        assert_eq!(capped.probe_capabilities().await.expect("probe").context_window, Some(8192));
    }

    #[tokio::test]
    async fn pull_streams_progress_and_reports_success() {
        install_rustls_provider();
        let seen: Seen = Arc::new(Mutex::new(Vec::new()));
        let router = Router::new()
            .route(
                "/api/pull",
                post(|State(seen): State<Seen>, body: String| async move {
                    seen.lock().expect("lock").push((
                        "/api/pull".to_string(),
                        serde_json::from_str(&body).expect("json"),
                    ));
                    (
                        [("content-type", "application/x-ndjson")],
                        ndjson(&[
                            json!({"status": "pulling manifest"}),
                            json!({"status": "pulling 6e4c38e1172f", "digest": "sha256:6e4c38e1172f", "total": 1000, "completed": 250}),
                            json!({"status": "pulling 6e4c38e1172f", "digest": "sha256:6e4c38e1172f", "total": 1000, "completed": 1000}),
                            json!({"status": "verifying sha256 digest"}),
                            json!({"status": "writing manifest"}),
                            json!({"status": "success"}),
                        ]),
                    )
                }),
            )
            .with_state(seen.clone());
        let base = serve(router).await;
        let api = OllamaApi::local(base);

        let mut steps: Vec<(String, Option<f64>)> = Vec::new();
        api.pull_with("llama3.2", |progress| {
            steps.push((progress.status.clone(), progress.fraction()));
        })
        .await
        .expect("pull");

        assert_eq!(steps.first().expect("first").0, "pulling manifest");
        assert_eq!(steps[1].1, Some(0.25));
        assert_eq!(steps[2].1, Some(1.0));
        assert_eq!(steps.last().expect("last").0, "success");
        assert_eq!(seen.lock().expect("lock")[0].1, json!({"model": "llama3.2", "stream": true}));
    }

    #[tokio::test]
    async fn a_failed_pull_is_an_error_and_a_cut_pull_is_not_a_success() {
        install_rustls_provider();
        let router = Router::new().route(
            "/api/pull",
            post(|body: String| async move {
                let request: Value = serde_json::from_str(&body).expect("json");
                let lines = if request["model"] == "missing" {
                    vec![
                        json!({"status": "pulling manifest"}),
                        json!({"error": "pull model manifest: file does not exist"}),
                    ]
                } else {
                    vec![json!({"status": "pulling manifest"})]
                };
                ([("content-type", "application/x-ndjson")], ndjson(&lines))
            }),
        );
        let base = serve(router).await;
        let api = OllamaApi::local(base);

        let failure = api.pull_with("missing", |_| {}).await.expect_err("failure");
        assert!(
            matches!(
                failure,
                ModelError::Api { ref message, .. } if message.contains("file does not exist")
            ),
            "{failure}"
        );

        let cut = api.pull_with("cut", |_| {}).await.expect_err("cut");
        assert!(matches!(cut, ModelError::Stream(_)), "{cut}");
    }

    #[tokio::test]
    async fn generate_streams_chunks_with_fill_in_the_middle_fields() {
        install_rustls_provider();
        let seen: Seen = Arc::new(Mutex::new(Vec::new()));
        let router = Router::new()
            .route(
                "/api/generate",
                post(|State(seen): State<Seen>, body: String| async move {
                    seen.lock().expect("lock").push((
                        "/api/generate".to_string(),
                        serde_json::from_str(&body).expect("json"),
                    ));
                    (
                        [("content-type", "application/x-ndjson")],
                        ndjson(&[
                            json!({"model": "m", "response": "let x", "done": false}),
                            json!({"model": "m", "response": " = 1;", "done": false}),
                            json!({"model": "m", "response": "", "done": true, "done_reason": "stop", "eval_count": 5}),
                        ]),
                    )
                }),
            )
            .with_state(seen.clone());
        let base = serve(router).await;
        let api = OllamaApi::local(base);

        let mut request = OllamaGenerateRequest::new("m", "fn main() {\n    ");
        request.suffix = Some("\n}".to_string());
        let chunks: Vec<OllamaGenerateChunk> = api
            .generate(&request)
            .await
            .expect("stream")
            .map(|chunk| chunk.expect("chunk"))
            .collect()
            .await;

        let text: String = chunks.iter().map(|chunk| chunk.response.as_str()).collect();
        assert_eq!(text, "let x = 1;");
        assert!(chunks.last().expect("last").done);
        assert_eq!(chunks.last().expect("last").metrics.eval_count, 5);
        let sent = seen.lock().expect("lock")[0].1.clone();
        assert_eq!(sent["suffix"], "\n}");
        assert_eq!(sent["stream"], true);
    }

    #[tokio::test]
    async fn embedding_through_the_trait_checks_the_vector_count() {
        install_rustls_provider();
        let router = Router::new().route(
            "/api/embed",
            post(|| async {
                // One vector for two inputs: a broken server.
                axum::Json(json!({"model": "m", "embeddings": [[1.0, 0.0]]}))
            }),
        );
        let base = serve(router).await;
        let client = OllamaClient::local(base, "m");
        assert!(client.embed(&[]).await.expect("empty").is_empty());
        let error = EmbedClient::embed(&client, &["a", "b"]).await.expect_err("mismatch");
        assert!(matches!(error, ModelError::Stream(_)), "{error}");
    }
}
