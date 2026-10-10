// SPDX-License-Identifier: Apache-2.0
//! Agent session: the configuration plus the running conversation history.

use aphrody_agent_home::{AgentHome, BootstrapBudget, HomeOptions};
use aphrody_model_client::{ChatMessage, Part, Role};
use serde_json::Value;

use crate::{
    compaction::{CompactionReport, compact_history},
    config::EngineConfig,
};

/// A single agent conversation.
///
/// A session owns its [`EngineConfig`] and the full [`ChatMessage`] history. It
/// is the unit of state threaded through [`run_turn`](crate::run_turn): each
/// turn appends the user input, the model's visible message(s), and any tool
/// call / response pairs so that subsequent turns see the complete context.
#[derive(Debug, Clone)]
pub struct Session {
    config: EngineConfig,
    history: Vec<ChatMessage>,
    /// Fingerprint of the last turn context written to the rollout, so an
    /// unchanged system prompt / tool set is recorded once, not every turn.
    recorded_context: Option<u64>,
    /// Incremented whenever old messages are replaced by a compaction
    /// checkpoint, allowing rollout recording to write a replacement history.
    history_revision: u64,
    last_live_home_prompt: Option<String>,
}

impl Session {
    /// Create an empty session driven by `config`.
    #[must_use]
    pub fn new(config: EngineConfig) -> Self {
        Self {
            config,
            history: Vec::new(),
            recorded_context: None,
            history_revision: 0,
            last_live_home_prompt: None,
        }
    }

    /// Create a session that continues from a recorded `history` (resume, fork).
    #[must_use]
    pub fn with_history(config: EngineConfig, history: Vec<ChatMessage>) -> Self {
        Self {
            config,
            history,
            recorded_context: None,
            history_revision: 0,
            last_live_home_prompt: None,
        }
    }

    /// Note `fingerprint` as the turn context now on record; returns whether it
    /// differs from the previous one (i.e. whether it has to be written).
    pub(crate) fn note_recorded_context(&mut self, fingerprint: u64) -> bool {
        let changed = self.recorded_context != Some(fingerprint);
        self.recorded_context = Some(fingerprint);
        changed
    }

    /// The session's configuration.
    #[must_use]
    pub fn config(&self) -> &EngineConfig {
        &self.config
    }

    /// Refresh the live persona and rules for the next turn. A transient
    /// invalid edit keeps the previous valid revision in memory.
    pub(crate) fn refresh_live_home_prompt(&mut self) -> Option<&str> {
        let workspace = self.config.live_agent_home_workspace.as_ref()?;
        match AgentHome::open(HomeOptions {
            workspace: Some(workspace.clone()),
            strict_soul: true,
            ..HomeOptions::default()
        }) {
            Ok(home) => {
                let prompt = home.system_prompt(&BootstrapBudget::default()).render();
                if !prompt.trim().is_empty() {
                    self.last_live_home_prompt = Some(prompt);
                }
            },
            Err(error) => {
                tracing::warn!(root = %workspace.display(), error = %error, "keeping last valid Agent Home prompt");
            },
        }
        self.last_live_home_prompt.as_deref()
    }

    /// The full conversation history, oldest first.
    #[must_use]
    pub fn history(&self) -> &[ChatMessage] {
        &self.history
    }

    /// Revision of the active history. It changes only when compaction replaces
    /// old messages, not for ordinary appends.
    #[must_use]
    pub(crate) fn history_revision(&self) -> u64 {
        self.history_revision
    }

    /// Compact automatically when the effective token threshold is exceeded.
    /// `reserved_tokens` accounts for system instructions and tool schemas.
    pub(crate) fn compact_if_needed(
        &mut self,
        context_window: Option<u64>,
        reserved_tokens: u64,
    ) -> Option<CompactionReport> {
        self.compact_inner(context_window, reserved_tokens, false)
    }

    /// Force a structural compaction for [`Op::Compact`](aphrody_agent_proto::Op::Compact).
    /// Recent messages remain verbatim; histories too short to split are left
    /// unchanged.
    pub fn compact(&mut self, context_window: Option<u64>) -> Option<CompactionReport> {
        self.compact_inner(context_window, 0, true)
    }

    fn compact_inner(
        &mut self,
        context_window: Option<u64>,
        reserved_tokens: u64,
        force: bool,
    ) -> Option<CompactionReport> {
        let report = compact_history(
            &mut self.history,
            context_window,
            self.config.auto_compact_token_limit,
            reserved_tokens,
            force,
        )?;
        self.history_revision = self.history_revision.saturating_add(1);
        Some(report)
    }

    /// Number of messages currently in the history.
    #[must_use]
    pub fn len(&self) -> usize {
        self.history.len()
    }

    /// Whether the history is empty.
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.history.is_empty()
    }

    /// Append a fully-formed message to the history.
    pub fn push_message(&mut self, message: ChatMessage) {
        self.history.push(message);
    }

    /// Append a user message composed of `parts`.
    pub fn push_user(&mut self, parts: Vec<Part>) {
        self.push_message(ChatMessage { role: Role::User, parts });
    }

    /// Append a model text message.
    pub fn push_model_text(&mut self, text: impl Into<String>) {
        self.push_message(ChatMessage { role: Role::Model, parts: vec![Part::Text(text.into())] });
    }

    /// Append everything one model response produced — reasoning items, visible
    /// text and function calls, in the order they were generated — as a single
    /// model message. Providers require the calls of one response to stay
    /// together (Anthropic and Gemini reject them split across messages). Empty
    /// `parts` append nothing.
    pub fn push_model_parts(&mut self, parts: Vec<Part>) {
        if !parts.is_empty() {
            self.push_message(ChatMessage { role: Role::Model, parts });
        }
    }

    /// Append a model function-call message (the model asked to run `name`).
    /// `id` is the provider call id that pairs it with its response.
    pub fn push_model_function_call(
        &mut self,
        id: impl Into<String>,
        name: impl Into<String>,
        args: Value,
    ) {
        self.push_model_parts(vec![Part::function_call(id, name, args)]);
    }

    /// Append the results of a batch of tool calls as a single tool message:
    /// one [`Part::FunctionResponse`] per call, in call order. Empty
    /// `responses` append nothing.
    pub fn push_tool_responses(&mut self, responses: Vec<Part>) {
        if !responses.is_empty() {
            self.push_message(ChatMessage { role: Role::Tool, parts: responses });
        }
    }

    /// Append a single tool function-response message (the result fed back to
    /// the model). `id` is the id of the call it answers.
    pub fn push_tool_response(
        &mut self,
        id: impl Into<String>,
        name: impl Into<String>,
        response: Value,
    ) {
        self.push_tool_responses(vec![Part::function_response(id, name, response)]);
    }
}
