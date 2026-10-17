// SPDX-License-Identifier: Apache-2.0
//! Configurable OpenAI-compatible streaming client.
//!
//! One client for every provider that speaks Chat Completions or Responses —
//! llama-server, Ollama, LM Studio, vLLM, OpenAI, or any entry of a
//! Codex-style `[model_providers.X]` table. What differs between providers is
//! data, carried by a [`ProviderRuntime`]: base URL, credentials, headers,
//! query parameters, retry budget, idle timeout, capabilities and default
//! decoding options.
//!
//! Two conventions are fixed here because getting them wrong only shows up as
//! a 404 at runtime:
//!
//! - [`ProviderRuntime::base_url`] **already contains the API version segment**
//!   when the provider has one (`http://localhost:11434/v1`), exactly as in a Codex
//!   `config.toml`. The client appends only the endpoint (`/chat/completions`, `/responses`).
//! - Retries cover the part of a request that is safe to repeat: connecting and the response
//!   status. Once the body streams, a failure ends the turn — the model may already have produced
//!   output that a silent replay would duplicate.

use std::time::Duration;

use async_trait::async_trait;
use futures::{Stream, StreamExt};

use crate::{
    ChatTurn, ModelCapabilities, ModelClient, ModelError, ModelStream, TurnOptions,
    openai_chat::{build_chat_completions_request, chat_completions_sse_stream},
    openai_responses::{build_responses_request, responses_sse_stream},
};

/// Which OpenAI wire a provider speaks.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OpenAiWire {
    /// `POST {base_url}/chat/completions`.
    Chat,
    /// `POST {base_url}/responses`.
    Responses,
}

impl OpenAiWire {
    fn endpoint(self) -> &'static str {
        match self {
            Self::Chat => "chat/completions",
            Self::Responses => "responses",
        }
    }
}

/// Default number of attempts after the first one.
pub const DEFAULT_REQUEST_MAX_RETRIES: u32 = 4;
/// Default time a stream may stay silent before the turn is failed.
pub const DEFAULT_STREAM_IDLE_TIMEOUT: Duration = Duration::from_secs(300);

/// Everything provider-specific the client needs, resolved by the caller from
/// its configuration (secrets included — this type never reads the environment).
#[derive(Debug, Clone, PartialEq)]
pub struct ProviderRuntime {
    /// API root, version segment included (`https://api.openai.com/v1`).
    pub base_url: String,
    /// Sent as `Authorization: Bearer …` when set.
    pub bearer_token: Option<String>,
    /// Extra request headers.
    pub headers: Vec<(String, String)>,
    /// Query parameters appended to the endpoint URL (Azure `api-version`, …).
    pub query_params: Vec<(String, String)>,
    /// Attempts after the first one, for connection errors, 429 and 5xx.
    pub request_max_retries: u32,
    /// A stream silent for longer than this fails the turn.
    pub stream_idle_timeout: Duration,
    /// What the served model can do.
    pub capabilities: ModelCapabilities,
    /// Decoding options applied to every turn; a turn's own options win.
    pub default_options: TurnOptions,
}

impl ProviderRuntime {
    /// A keyless provider at `base_url` with default limits — the shape of a
    /// local runtime.
    #[must_use]
    pub fn keyless(base_url: impl Into<String>) -> Self {
        Self {
            base_url: base_url.into(),
            bearer_token: None,
            headers: Vec::new(),
            query_params: Vec::new(),
            request_max_retries: DEFAULT_REQUEST_MAX_RETRIES,
            stream_idle_timeout: DEFAULT_STREAM_IDLE_TIMEOUT,
            capabilities: ModelCapabilities {
                parallel_tool_calls: true,
                ..ModelCapabilities::default()
            },
            default_options: TurnOptions::default(),
        }
    }

    /// The URL of `wire`'s endpoint, query parameters included.
    #[must_use]
    pub fn endpoint_url(&self, wire: OpenAiWire) -> String {
        self.endpoint_path(wire.endpoint())
    }

    /// `base_url` joined with a relative `endpoint` (e.g. `messages`), plus
    /// the configured query parameters.
    #[must_use]
    pub fn endpoint_path(&self, endpoint: &str) -> String {
        let mut url = format!("{}/{}", self.base_url.trim_end_matches('/'), endpoint);
        for (index, (key, value)) in self.query_params.iter().enumerate() {
            url.push(if index == 0 { '?' } else { '&' });
            url.push_str(&percent_encode(key));
            url.push('=');
            url.push_str(&percent_encode(value));
        }
        url
    }
}

/// Percent-encode a query component (RFC 3986 unreserved characters pass).
fn percent_encode(input: &str) -> String {
    let mut encoded = String::with_capacity(input.len());
    for byte in input.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' => {
                encoded.push(char::from(byte));
            }
            other => encoded.push_str(&format!("%{other:02X}")),
        }
    }
    encoded
}

/// Overlay `turn` options on the provider `defaults`: every field the turn
/// sets wins, `extra` keys are merged with the turn's taking precedence.
#[must_use]
pub fn merge_options(defaults: &TurnOptions, turn: &TurnOptions) -> TurnOptions {
    let mut extra = defaults.extra.clone();
    for (key, value) in &turn.extra {
        extra.insert(key.clone(), value.clone());
    }
    TurnOptions {
        temperature: turn.temperature.or(defaults.temperature),
        max_output_tokens: turn.max_output_tokens.or(defaults.max_output_tokens),
        parallel_tool_calls: turn.parallel_tool_calls.or(defaults.parallel_tool_calls),
        reasoning_effort: turn
            .reasoning_effort
            .clone()
            .or_else(|| defaults.reasoning_effort.clone()),
        response_schema: turn
            .response_schema
            .clone()
            .or_else(|| defaults.response_schema.clone()),
        stop: if turn.stop.is_empty() {
            defaults.stop.clone()
        } else {
            turn.stop.clone()
        },
        extra,
    }
}

/// Whether a response status is worth another attempt.
fn is_retryable_status(status: reqwest::StatusCode) -> bool {
    status == reqwest::StatusCode::TOO_MANY_REQUESTS
        || status == reqwest::StatusCode::REQUEST_TIMEOUT
        || status.is_server_error()
}

/// Delay before attempt `attempt + 1`: exponential from 200 ms, capped at 8 s,
/// with up to 25 % jitter so parallel sessions do not retry in lockstep. A
/// server-provided `Retry-After` (seconds) wins, bounded to one minute.
fn backoff(attempt: u32, retry_after: Option<Duration>) -> Duration {
    if let Some(delay) = retry_after {
        return delay.min(Duration::from_secs(60));
    }
    let base = Duration::from_millis(200)
        .saturating_mul(2u32.saturating_pow(attempt))
        .min(Duration::from_secs(8));
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |elapsed| elapsed.subsec_nanos());
    let jitter = base.mul_f64(f64::from(nanos % 1000) / 4000.0);
    base + jitter
}

fn retry_after(response: &reqwest::Response) -> Option<Duration> {
    response
        .headers()
        .get(reqwest::header::RETRY_AFTER)?
        .to_str()
        .ok()?
        .trim()
        .parse::<u64>()
        .ok()
        .map(Duration::from_secs)
}

/// Fail a byte stream that stays silent for longer than `idle`.
pub(crate) fn with_idle_timeout<S>(
    bytes: S,
    idle: Duration,
) -> impl Stream<Item = Result<bytes::Bytes, ModelError>> + Send
where
    S: Stream<Item = reqwest::Result<bytes::Bytes>> + Send + 'static,
{
    // Fused so a decoder that polls once more after the end sees `None` again.
    futures::stream::unfold(
        (Box::pin(bytes.fuse()), false),
        move |(mut stream, failed)| async move {
            if failed {
                return None;
            }
            match tokio::time::timeout(idle, stream.next()).await {
                Ok(Some(Ok(chunk))) => Some((Ok(chunk), (stream, false))),
                Ok(Some(Err(error))) => Some((Err(ModelError::Http(error)), (stream, true))),
                Ok(None) => None,
                Err(_) => Some((
                    Err(ModelError::Stream(format!(
                        "no data from the provider for {}s (stream idle timeout)",
                        idle.as_secs()
                    ))),
                    (stream, true),
                )),
            }
        },
    )
}

/// A streaming client for any OpenAI-compatible provider.
#[derive(Debug, Clone)]
pub struct OpenAiCompatClient {
    http: reqwest::Client,
    runtime: ProviderRuntime,
    wire: OpenAiWire,
    model: String,
}

impl OpenAiCompatClient {
    /// Build a client for `model` served by the provider described by `runtime`.
    #[must_use]
    pub fn from_provider(
        runtime: ProviderRuntime,
        wire: OpenAiWire,
        model: impl Into<String>,
    ) -> Self {
        Self {
            http: reqwest::Client::new(),
            runtime,
            wire,
            model: model.into(),
        }
    }

    /// Reuse a configured HTTP client and its connection pool across provider APIs.
    #[must_use]
    pub fn with_http_client(mut self, http: reqwest::Client) -> Self {
        self.http = http;
        self
    }

    /// The provider description this client was built from.
    #[must_use]
    pub fn runtime(&self) -> &ProviderRuntime {
        &self.runtime
    }

    /// The wire this client speaks.
    #[must_use]
    pub fn wire(&self) -> OpenAiWire {
        self.wire
    }

    /// The request body for `turn`, provider defaults applied.
    #[must_use]
    pub fn request_body(&self, turn: &ChatTurn) -> serde_json::Value {
        let mut turn = turn.clone();
        turn.options = merge_options(&self.runtime.default_options, &turn.options);
        match self.wire {
            OpenAiWire::Chat => build_chat_completions_request(&turn, &self.model),
            OpenAiWire::Responses => build_responses_request(&turn, &self.model),
        }
    }

    /// Send the request, retrying the repeatable failures, and return the
    /// successful response ready to stream.
    async fn send(&self, body: &serde_json::Value) -> Result<reqwest::Response, ModelError> {
        let url = self.runtime.endpoint_url(self.wire);
        send_streaming_post(
            &self.http,
            &url,
            &self.runtime,
            body,
            &|request| match &self.runtime.bearer_token {
                Some(token) => request.bearer_auth(token),
                None => request,
            },
        )
        .await
    }
}

/// POST `body` to `url` as a streaming request under `runtime`'s retry
/// budget, letting `authorize` attach the provider's credential header(s).
///
/// Shared by every wire this crate speaks: retries cover the connect and the
/// response status only, since once the body streams a replay could duplicate
/// output the model already produced.
pub(crate) async fn send_streaming_post(
    http: &reqwest::Client,
    url: &str,
    runtime: &ProviderRuntime,
    body: &serde_json::Value,
    authorize: &(dyn Fn(reqwest::RequestBuilder) -> reqwest::RequestBuilder + Sync),
) -> Result<reqwest::Response, ModelError> {
    send_with_retry(runtime, &|| {
        authorize(
            http.post(url)
                .header(reqwest::header::ACCEPT, "text/event-stream")
                .json(body),
        )
    })
    .await
}

/// Send the request `build` produces under `runtime`'s retry budget.
///
/// `build` is called once per attempt and returns the request with its method,
/// URL, body and credential already attached; the provider's extra
/// [`ProviderRuntime::headers`] are added here. This is the single retry loop
/// of the crate: the OpenAI, Anthropic, Ollama and vLLM wires all go through
/// it, so connect failures, `429`, `408` and `5xx` behave identically on every
/// provider (and `Retry-After` is honoured everywhere).
pub(crate) async fn send_with_retry(
    runtime: &ProviderRuntime,
    build: &(dyn Fn() -> reqwest::RequestBuilder + Sync),
) -> Result<reqwest::Response, ModelError> {
    let mut attempt = 0u32;
    loop {
        let mut request = build();
        for (name, value) in &runtime.headers {
            request = request.header(name, value);
        }

        let can_retry = attempt < runtime.request_max_retries;
        match request.send().await {
            Ok(response) if response.status().is_success() => return Ok(response),
            Ok(response) if can_retry && is_retryable_status(response.status()) => {
                let delay = backoff(attempt, retry_after(&response));
                tracing::warn!(
                    status = response.status().as_u16(),
                    attempt,
                    delay_ms = delay.as_millis() as u64,
                    "provider request failed, retrying"
                );
                tokio::time::sleep(delay).await;
            }
            Ok(response) => {
                let status = response.status().as_u16();
                let message = response.text().await.unwrap_or_default();
                return Err(ModelError::Api {
                    status,
                    message: if message.is_empty() {
                        "request failed".to_string()
                    } else {
                        message
                    },
                });
            }
            // Nothing reached the provider: safe to repeat.
            Err(error) if can_retry && (error.is_connect() || error.is_timeout()) => {
                let delay = backoff(attempt, None);
                tracing::warn!(%error, attempt, "provider unreachable, retrying");
                tokio::time::sleep(delay).await;
            }
            Err(error) => return Err(ModelError::Http(error)),
        }
        attempt += 1;
    }
}

#[async_trait]
impl ModelClient for OpenAiCompatClient {
    async fn stream(&self, turn: ChatTurn) -> Result<ModelStream, ModelError> {
        let response = self.send(&self.request_body(&turn)).await?;
        let bytes = with_idle_timeout(response.bytes_stream(), self.runtime.stream_idle_timeout);
        Ok(match self.wire {
            OpenAiWire::Chat => Box::pin(chat_completions_sse_stream(bytes)),
            OpenAiWire::Responses => Box::pin(responses_sse_stream(bytes)),
        })
    }

    fn model_id(&self) -> &str {
        &self.model
    }

    fn capabilities(&self) -> ModelCapabilities {
        self.runtime.capabilities.clone()
    }
}

#[cfg(test)]
mod tests {
    use std::sync::{
        Arc, Mutex, Once,
        atomic::{AtomicUsize, Ordering},
    };

    use axum::{
        Router,
        extract::{Query, State},
        http::{HeaderMap, StatusCode},
        response::IntoResponse,
        routing::post,
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

    type CapturedRequest = (HeaderMap, Vec<(String, String)>, Value);

    #[derive(Default)]
    struct Seen {
        calls: AtomicUsize,
        last: Mutex<Option<CapturedRequest>>,
    }

    const CHAT_SSE: &str = concat!(
        "data: {\"choices\":[{\"delta\":{\"content\":\"hi\"}}]}\n\n",
        "data: {\"choices\":[{\"finish_reason\":\"stop\"}]}\n\n",
        "data: [DONE]\n\n",
    );

    async fn serve(router: Router) -> String {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind");
        let address = listener.local_addr().expect("addr");
        tokio::spawn(async move {
            let _ = axum::serve(listener, router).await;
        });
        format!("http://{address}")
    }

    fn user_turn(text: &str) -> ChatTurn {
        ChatTurn {
            messages: vec![ChatMessage {
                role: Role::User,
                parts: vec![Part::Text(text.to_string())],
            }],
            ..ChatTurn::default()
        }
    }

    async fn collect(client: &OpenAiCompatClient, turn: ChatTurn) -> Vec<ModelStreamEvent> {
        client
            .stream(turn)
            .await
            .expect("stream")
            .map(|event| event.expect("event"))
            .collect()
            .await
    }

    #[test]
    fn endpoint_url_appends_only_the_endpoint_and_encodes_query() {
        let mut runtime = ProviderRuntime::keyless("http://localhost:11434/v1/");
        assert_eq!(
            runtime.endpoint_url(OpenAiWire::Chat),
            "http://localhost:11434/v1/chat/completions"
        );
        runtime.query_params = vec![
            ("api-version".into(), "2025-01-01 preview".into()),
            ("x".into(), "a&b".into()),
        ];
        assert_eq!(
            runtime.endpoint_url(OpenAiWire::Responses),
            "http://localhost:11434/v1/responses?api-version=2025-01-01%20preview&x=a%26b"
        );
    }

    #[test]
    fn turn_options_win_over_provider_defaults() {
        let mut default_extra = serde_json::Map::new();
        default_extra.insert("cache_prompt".into(), json!(true));
        default_extra.insert("top_k".into(), json!(40));
        let defaults = TurnOptions {
            temperature: Some(0.2),
            stop: vec!["</s>".into()],
            extra: default_extra,
            ..TurnOptions::default()
        };
        let mut turn_extra = serde_json::Map::new();
        turn_extra.insert("top_k".into(), json!(1));
        let turn = TurnOptions {
            temperature: Some(0.9),
            extra: turn_extra,
            ..TurnOptions::default()
        };

        let merged = merge_options(&defaults, &turn);
        assert_eq!(merged.temperature, Some(0.9));
        assert_eq!(merged.stop, vec!["</s>".to_string()]);
        assert_eq!(merged.extra["cache_prompt"], json!(true));
        assert_eq!(merged.extra["top_k"], json!(1));
    }

    #[test]
    fn backoff_grows_is_capped_and_honours_retry_after() {
        assert!(backoff(0, None) >= Duration::from_millis(200));
        assert!(backoff(0, None) < Duration::from_millis(260));
        assert!(backoff(20, None) <= Duration::from_secs(10));
        assert_eq!(
            backoff(0, Some(Duration::from_secs(3))),
            Duration::from_secs(3)
        );
        assert_eq!(
            backoff(0, Some(Duration::from_secs(3600))),
            Duration::from_secs(60)
        );
    }

    #[tokio::test]
    async fn request_carries_path_auth_headers_query_and_default_options() {
        install_rustls_provider();
        let seen = Arc::new(Seen::default());
        let router = Router::new()
            .route(
                "/v1/chat/completions",
                post(
                    |State(seen): State<Arc<Seen>>,
                     Query(query): Query<Vec<(String, String)>>,
                     headers: HeaderMap,
                     body: String| async move {
                        seen.calls.fetch_add(1, Ordering::SeqCst);
                        let body: Value = serde_json::from_str(&body).expect("json body");
                        *seen.last.lock().expect("lock") = Some((headers, query, body));
                        ([("content-type", "text/event-stream")], CHAT_SSE)
                    },
                ),
            )
            .with_state(seen.clone());
        let base = serve(router).await;

        let mut runtime = ProviderRuntime::keyless(format!("{base}/v1"));
        runtime.bearer_token = Some("sk-test".into());
        runtime.headers = vec![("x-provider".into(), "aphrody".into())];
        runtime.query_params = vec![("api-version".into(), "v9".into())];
        runtime.default_options.temperature = Some(0.1);
        let client = OpenAiCompatClient::from_provider(runtime, OpenAiWire::Chat, "qwen2.5-coder");

        let events = collect(&client, user_turn("hello")).await;
        assert_eq!(
            events,
            vec![
                ModelStreamEvent::Created,
                ModelStreamEvent::TextDelta("hi".into()),
                ModelStreamEvent::Completed {
                    usage: None,
                    finish_reason: Some("stop".into())
                },
            ]
        );

        let (headers, query, body) = seen
            .last
            .lock()
            .expect("lock")
            .take()
            .expect("request seen");
        assert_eq!(headers["authorization"], "Bearer sk-test");
        assert_eq!(headers["x-provider"], "aphrody");
        assert_eq!(query, vec![("api-version".to_string(), "v9".to_string())]);
        assert_eq!(body["model"], "qwen2.5-coder");
        assert_eq!(body["temperature"], json!(0.1_f32));
        assert_eq!(
            body["messages"][0],
            json!({ "role": "user", "content": "hello" })
        );
    }

    #[tokio::test]
    async fn retries_a_503_then_streams() {
        install_rustls_provider();
        let seen = Arc::new(Seen::default());
        let router = Router::new()
            .route(
                "/v1/responses",
                post(|State(seen): State<Arc<Seen>>| async move {
                    if seen.calls.fetch_add(1, Ordering::SeqCst) == 0 {
                        return (
                            StatusCode::SERVICE_UNAVAILABLE,
                            [("retry-after", "0")],
                            "loading model",
                        )
                            .into_response();
                    }
                    (
                        [("content-type", "text/event-stream")],
                        concat!(
                            "data: {\"type\":\"response.output_text.delta\",\"delta\":\"ok\"}\n\n",
                            "data: {\"type\":\"response.completed\",\"response\":{\"status\":\"\
                             completed\"}}\n\n",
                        ),
                    )
                        .into_response()
                }),
            )
            .with_state(seen.clone());
        let base = serve(router).await;

        let client = OpenAiCompatClient::from_provider(
            ProviderRuntime::keyless(format!("{base}/v1")),
            OpenAiWire::Responses,
            "gpt-oss:20b",
        );
        let events = collect(&client, user_turn("hello")).await;
        assert_eq!(seen.calls.load(Ordering::SeqCst), 2);
        assert_eq!(events[1], ModelStreamEvent::TextDelta("ok".into()));
    }

    #[tokio::test]
    async fn a_client_error_is_not_retried_and_surfaces_the_body() {
        install_rustls_provider();
        let seen = Arc::new(Seen::default());
        let router = Router::new()
            .route(
                "/v1/chat/completions",
                post(|State(seen): State<Arc<Seen>>| async move {
                    seen.calls.fetch_add(1, Ordering::SeqCst);
                    (StatusCode::BAD_REQUEST, "context length exceeded")
                }),
            )
            .with_state(seen.clone());
        let base = serve(router).await;

        let client = OpenAiCompatClient::from_provider(
            ProviderRuntime::keyless(format!("{base}/v1")),
            OpenAiWire::Chat,
            "m",
        );
        let error = client
            .stream(user_turn("hello"))
            .await
            .err()
            .expect("error");
        assert!(matches!(
            error,
            ModelError::Api { status: 400, ref message } if message == "context length exceeded"
        ));
        assert_eq!(seen.calls.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn a_silent_stream_fails_with_an_idle_timeout() {
        install_rustls_provider();
        let router = Router::new().route(
            "/v1/chat/completions",
            post(|| async {
                let first = futures::stream::once(async {
                    Ok::<_, std::convert::Infallible>(bytes::Bytes::from_static(
                        b"data: {\"choices\":[{\"delta\":{\"content\":\"partial\"}}]}\n\n",
                    ))
                });
                let stalled = first.chain(futures::stream::pending());
                (
                    [("content-type", "text/event-stream")],
                    axum::body::Body::from_stream(stalled),
                )
            }),
        );
        let base = serve(router).await;

        let mut runtime = ProviderRuntime::keyless(format!("{base}/v1"));
        runtime.stream_idle_timeout = Duration::from_millis(150);
        let client = OpenAiCompatClient::from_provider(runtime, OpenAiWire::Chat, "m");

        let results: Vec<_> = client
            .stream(user_turn("hello"))
            .await
            .expect("stream")
            .collect()
            .await;
        assert!(
            matches!(results[1], Ok(ModelStreamEvent::TextDelta(ref text)) if text == "partial")
        );
        let failure = results
            .iter()
            .find_map(|item| item.as_ref().err())
            .expect("idle failure");
        assert!(
            failure.to_string().contains("stream idle timeout"),
            "{failure}"
        );
    }

    #[tokio::test]
    async fn an_unreachable_provider_fails_after_its_retry_budget() {
        install_rustls_provider();
        // A port nothing listens on: bind, read the address, drop the listener.
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind");
        let address = listener.local_addr().expect("addr");
        drop(listener);

        let mut runtime = ProviderRuntime::keyless(format!("http://{address}/v1"));
        runtime.request_max_retries = 1;
        let client = OpenAiCompatClient::from_provider(runtime, OpenAiWire::Chat, "m");
        let error = client
            .stream(user_turn("hello"))
            .await
            .err()
            .expect("error");
        assert!(matches!(error, ModelError::Http(_)), "{error}");
    }

    #[tokio::test]
    async fn mock_axum_server_sees_chat_completions_with_configured_headers() {
        install_rustls_provider();
        use std::sync::atomic::AtomicBool;
        let header_verified = Arc::new(AtomicBool::new(false));
        let flag = header_verified.clone();

        let router = Router::new().route(
            "/v1/chat/completions",
            post(move |headers: axum::http::HeaderMap| {
                let flag = flag.clone();
                async move {
                    let has_custom = headers.get("x-custom-key").and_then(|v| v.to_str().ok())
                        == Some("custom-val-123");
                    let has_auth = headers.get("authorization").and_then(|v| v.to_str().ok())
                        == Some("Bearer test-token-xyz");
                    if has_custom && has_auth {
                        flag.store(true, Ordering::SeqCst);
                    }
                    (
                        [("content-type", "text/event-stream")],
                        "data: {\"choices\":[{\"delta\":{\"content\":\"ok\"}}]}\n\ndata: \
                         [DONE]\n\n",
                    )
                }
            }),
        );
        let base = serve(router).await;

        let mut runtime = ProviderRuntime::keyless(format!("{base}/v1"));
        runtime.bearer_token = Some("test-token-xyz".to_string());
        runtime
            .headers
            .push(("x-custom-key".to_string(), "custom-val-123".to_string()));
        let client = OpenAiCompatClient::from_provider(runtime, OpenAiWire::Chat, "test-model");

        let events = collect(&client, user_turn("hi")).await;
        assert_eq!(events[1], ModelStreamEvent::TextDelta("ok".into()));
        assert!(
            header_verified.load(Ordering::SeqCst),
            "Mock server must receive configured headers"
        );
    }
}
