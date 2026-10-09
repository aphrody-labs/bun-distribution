// SPDX-License-Identifier: Apache-2.0
//
// `auto_command` — natural-language fallback dispatcher for the `aphrody`
// CLI.
//
// When the user invokes `aphrody <something>` and `<something>` is not a
// known clap subcommand (and not a flag), the binary treats the full argv
// tail as a natural-language prompt and routes it to a running A2A agent
// over JSON-RPC (`SendMessage` or `SendStreamingMessage`).
//
// Endpoint resolution order:
//   1. `AutoCommand::endpoint` (explicit, e.g. set by a flag in the future).
//   2. `APHRODY_A2A_ENDPOINT` environment variable.
//   3. `http://localhost:8788` — the aphrody A2A coord listener (`aphrody a2a serve --bind
//      127.0.0.1:8788`).
//
// The default carried a `/jsonrpc` suffix until 2026-09-07. Measured against a
// running listener: `POST /jsonrpc` answers **404**, while `POST /` answers 200
// with a well-formed A2A envelope — the JSON-RPC router is merged at the root
// (`a2a-coord/src/listener.rs`), and the agent card advertises exactly that:
// `supportedInterfaces[0].url == "http://127.0.0.1:8788"`, no path. Every
// unrecognised argv falls through to this endpoint, so the wrong suffix turned
// a plain typo into an opaque transport failure that never mentioned A2A.
// The card is the contract; this constant now matches it.
//
// Streaming output is unbuffered: every text chunk is flushed to stdout as
// soon as it arrives. This matches the LLM-first terminal UX (no spinner,
// no batching) so an outer agent or TUI can render tokens live.
//
// Cross-platform: this module is only built on native targets. wasm32 has
// no reqwest/tokio runtime to drive a JSON-RPC client (see
// `crates/infra/aphrody-command/src/lib.rs` for target gating).

#![cfg(not(target_arch = "wasm32"))]

use std::{
    env,
    io::{self, Write as _},
};

use aphrody_a2a::{
    Message, Part, PartContent, Role, SendMessageRequest, SendMessageResponse, StreamResponse,
};
use aphrody_a2a_client::{A2AClient, jsonrpc::JsonRpcTransport};
use futures::StreamExt as _;
use reqwest::Client;

/// Default A2A JSON-RPC endpoint when neither `endpoint` nor the
/// `APHRODY_A2A_ENDPOINT` env var is set.
///
/// No path suffix: the A2A 1.0 binding puts JSON-RPC at the URL the agent
/// card advertises, and this listener advertises the bare origin.
pub(crate) const DEFAULT_A2A_ENDPOINT: &str = "http://localhost:8788";

/// Environment variable used to override the default A2A endpoint.
pub(crate) const ENV_A2A_ENDPOINT: &str = "APHRODY_A2A_ENDPOINT";

/// One natural-language invocation routed to the A2A agent.
#[derive(Debug, Clone)]
pub(crate) struct AutoCommand {
    /// The user's prompt — typically `argv[1..].join(" ")`.
    pub(crate) prompt: String,
    /// Explicit endpoint override; falls back to env var then default.
    pub(crate) endpoint: Option<String>,
    /// `true` -> `SendStreamingMessage` (SSE), `false` -> `SendMessage`.
    pub(crate) stream: bool,
}

impl AutoCommand {
    /// Construct an `AutoCommand` with streaming enabled by default.
    pub(crate) fn new(prompt: impl Into<String>) -> Self {
        AutoCommand { prompt: prompt.into(), endpoint: None, stream: true }
    }

    /// Resolve the JSON-RPC endpoint that should serve this invocation,
    /// following the documented precedence (explicit -> env -> default).
    pub(crate) fn resolved_endpoint(&self) -> String {
        if let Some(e) = &self.endpoint
            && !e.is_empty()
        {
            return e.clone();
        }
        if let Ok(e) = env::var(ENV_A2A_ENDPOINT)
            && !e.is_empty()
        {
            return e;
        }
        DEFAULT_A2A_ENDPOINT.to_string()
    }

    /// Build the `SendMessageRequest` body that will be sent to the agent.
    /// Exposed for testing — verifies that the prompt is wrapped in a
    /// `Role::User` message with exactly one `Text` part.
    pub(crate) fn build_request(&self) -> SendMessageRequest {
        let message = Message::new(Role::User, vec![Part::text(self.prompt.clone())]);
        SendMessageRequest { message, configuration: None, metadata: None, tenant: None }
    }
}

/// Errors surfaced by [`run`]. Mapped to process exit codes by the caller
/// (see `Self::exit_code`).
#[derive(Debug, thiserror::Error)]
pub(crate) enum AutoCommandError {
    /// Transport-level failure (connection refused, DNS, TLS handshake, ...)
    /// — exit code 1.
    #[error("A2A transport error talking to {endpoint}: {source}")]
    Transport {
        endpoint: String,
        #[source]
        source: aphrody_a2a::A2AError,
    },
    /// Server returned a JSON-RPC error result — exit code 2.
    #[error("A2A server at {endpoint} returned error: {source}")]
    Server {
        endpoint: String,
        #[source]
        source: aphrody_a2a::A2AError,
    },
    /// stdout/stderr write failed — exit code 1.
    #[error("I/O error writing agent response to stdout: {0}")]
    Io(#[from] io::Error),
}

impl AutoCommandError {
    /// Convert to the process exit code that the orchestrator should
    /// propagate (`run` returns this directly).
    #[must_use]
    pub(crate) fn exit_code(&self) -> i32 {
        match self {
            AutoCommandError::Transport { .. } | AutoCommandError::Io(_) => 1,
            AutoCommandError::Server { .. } => 2,
        }
    }
}

/// Heuristic that splits `A2AError`s coming back from the transport into
/// "we never reached the server" (Transport) vs. "server rejected us"
/// (Server). The a2a-client `JsonRpcTransport` wraps reqwest errors with
/// the prefix `"HTTP request failed:"` (see jsonrpc.rs line 71) so we
/// pattern-match on that.
fn classify_error(endpoint: &str, err: aphrody_a2a::A2AError) -> AutoCommandError {
    let msg = err.message.as_str();
    let looks_like_transport = msg.starts_with("HTTP request failed")
        || msg.contains("failed to parse JSON-RPC response")
        || msg.contains("failed to send SSE request")
        || msg.contains("connection refused")
        || msg.contains("connect error")
        || msg.contains("dns error");
    if looks_like_transport {
        AutoCommandError::Transport { endpoint: endpoint.to_string(), source: err }
    } else {
        AutoCommandError::Server { endpoint: endpoint.to_string(), source: err }
    }
}

/// Write every text part of a message to stdout, flushing after each part so
/// the user sees tokens immediately (zero buffering).
fn emit_message_parts(msg: &Message) -> io::Result<()> {
    let mut out = io::stdout().lock();
    for part in &msg.parts {
        if let PartContent::Text(t) = &part.content {
            out.write_all(t.as_bytes())?;
            out.flush()?;
        }
    }
    Ok(())
}

/// Execute the natural-language request. Returns the process exit code the
/// caller should propagate: `0` on success, `1` on transport / I/O failure,
/// `2` on a JSON-RPC server-side error. All other failure modes are
/// surfaced via the returned `AutoCommandError` whose `exit_code()` matches.
pub(crate) async fn run(opts: AutoCommand) -> Result<i32, AutoCommandError> {
    let endpoint = opts.resolved_endpoint();
    let request = opts.build_request();

    let client = A2AClient::new(JsonRpcTransport::new(Client::new(), endpoint.clone()));

    if opts.stream {
        let stream_result = client.send_streaming_message(&request).await;
        let mut stream = stream_result.map_err(|e| classify_error(&endpoint, e))?;

        let mut wrote_anything = false;
        while let Some(event) = stream.next().await {
            let event = event.map_err(|e| classify_error(&endpoint, e))?;
            match event {
                StreamResponse::Message(m) => {
                    emit_message_parts(&m)?;
                    wrote_anything = true;
                },
                StreamResponse::Task(t) => {
                    if let Some(status_msg) = t.status.message.as_ref() {
                        emit_message_parts(status_msg)?;
                        wrote_anything = true;
                    }
                },
                StreamResponse::StatusUpdate(ev) => {
                    if let Some(status_msg) = ev.status.message.as_ref() {
                        emit_message_parts(status_msg)?;
                        wrote_anything = true;
                    }
                },
                // Artifact updates carry no text-only payload guarantee on
                // their own; the message stream events above already cover
                // the conversational reply path. Skip silently.
                StreamResponse::ArtifactUpdate(_) => {},
            }
        }

        if wrote_anything {
            let mut out = io::stdout().lock();
            out.write_all(b"\n")?;
            out.flush()?;
        }
    } else {
        let response =
            client.send_message(&request).await.map_err(|e| classify_error(&endpoint, e))?;

        match response {
            SendMessageResponse::Message(m) => {
                emit_message_parts(&m)?;
            },
            SendMessageResponse::Task(t) => {
                if let Some(status_msg) = t.status.message.as_ref() {
                    emit_message_parts(status_msg)?;
                }
            },
        }
        let mut out = io::stdout().lock();
        out.write_all(b"\n")?;
        out.flush()?;
    }

    Ok(0)
}

// ===========================================================================
// Unit tests — no network. The smoke-test of an actual end-to-end call
// against a running listener belongs in tests/auto_command.rs.
// ===========================================================================
#[cfg(test)]
mod tests {
    use std::sync::Mutex;

    use super::*;

    // env var manipulation must be serialised — Rust tests run in parallel
    // by default and `set_var` / `remove_var` are unsound under contention.
    static ENV_LOCK: Mutex<()> = Mutex::new(());

    fn with_env<F: FnOnce()>(key: &str, value: Option<&str>, f: F) {
        let _guard = ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let saved = env::var(key).ok();
        // SAFETY: env mutation is serialised by ENV_LOCK above, no other
        // test in this module touches the same key concurrently.
        unsafe {
            match value {
                Some(v) => env::set_var(key, v),
                None => env::remove_var(key),
            }
        }
        f();
        unsafe {
            match saved {
                Some(v) => env::set_var(key, v),
                None => env::remove_var(key),
            }
        }
    }

    #[test]
    fn endpoint_defaults_to_localhost_8788() {
        with_env(ENV_A2A_ENDPOINT, None, || {
            let cmd = AutoCommand::new("what is 2+2");
            assert_eq!(cmd.resolved_endpoint(), DEFAULT_A2A_ENDPOINT);
        });
    }

    #[test]
    fn endpoint_resolved_from_env_var() {
        with_env(ENV_A2A_ENDPOINT, Some("http://test-host:1234/jsonrpc"), || {
            let cmd = AutoCommand::new("hi");
            assert_eq!(cmd.resolved_endpoint(), "http://test-host:1234/jsonrpc");
        });
    }

    #[test]
    fn endpoint_explicit_overrides_env() {
        with_env(ENV_A2A_ENDPOINT, Some("http://env-host:1/jsonrpc"), || {
            let cmd = AutoCommand {
                prompt: "hi".into(),
                endpoint: Some("http://explicit:9000/rpc".into()),
                stream: true,
            };
            assert_eq!(cmd.resolved_endpoint(), "http://explicit:9000/rpc");
        });
    }

    #[test]
    fn empty_env_falls_back_to_default() {
        with_env(ENV_A2A_ENDPOINT, Some(""), || {
            let cmd = AutoCommand::new("ping");
            assert_eq!(cmd.resolved_endpoint(), DEFAULT_A2A_ENDPOINT);
        });
    }

    #[test]
    fn build_request_wraps_prompt_in_user_text_part() {
        let cmd = AutoCommand::new("what is 2+2");
        let req = cmd.build_request();
        assert_eq!(req.message.role, Role::User);
        assert_eq!(req.message.parts.len(), 1);
        match &req.message.parts[0].content {
            PartContent::Text(t) => assert_eq!(t, "what is 2+2"),
            other => panic!("expected Text part, got {other:?}"),
        }
        assert!(req.configuration.is_none());
        assert!(req.metadata.is_none());
        assert!(req.tenant.is_none());
        assert!(!req.message.message_id.is_empty(), "auto-generated id should be non-empty");
    }

    #[test]
    fn classify_error_detects_transport_prefix() {
        let err = aphrody_a2a::A2AError::internal("HTTP request failed: connection refused");
        let classified = classify_error("http://localhost:8788/jsonrpc", err);
        assert!(matches!(classified, AutoCommandError::Transport { .. }));
        assert_eq!(classified.exit_code(), 1);
    }

    #[test]
    fn classify_error_treats_server_msg_as_server() {
        let err = aphrody_a2a::A2AError {
            code: aphrody_a2a::error_code::INVALID_PARAMS,
            message: "unknown task id".to_string(),
            details: None,
        };
        let classified = classify_error("http://x/y", err);
        assert!(matches!(classified, AutoCommandError::Server { .. }));
        assert_eq!(classified.exit_code(), 2);
    }
}
