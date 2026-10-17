// SPDX-License-Identifier: Apache-2.0
//! The assembled agent: build it from a [`RuntimeConfig`] + [`ModelChoice`],
//! then either [`spawn`](AgentRuntime::spawn) it for interactive use or drive a
//! single headless turn with [`run_once`](AgentRuntime::run_once).

use std::{path::PathBuf, sync::Arc};

use aphrody_agent_proto::{Event, InputItem};
use aphrody_engine::{EventSink, Session, SessionHandle, TurnOutcome, run_turn, spawn_session};
use aphrody_model_client::{ChatMessage, ModelClient};
use aphrody_rollout::RolloutRecorder;
use aphrody_toolcall::{ToolExecutor, ToolRegistry};

use crate::{
    config::RuntimeConfig,
    error::RuntimeError,
    model::ModelChoice,
    tools::{build_profiled_tool_registry, build_tool_registry},
};

/// The outcome of a headless [`AgentRuntime::run_once`] call.
#[derive(Debug, Clone, Default)]
pub struct RunResult {
    /// The last visible agent message produced during the turn, if any.
    pub last_agent_message: Option<String>,
    /// Every [`Event`] the engine emitted during the turn, in order.
    pub events: Vec<Event>,
    /// The engine's structured turn outcome (iteration count, interruption /
    /// iteration-cap flags).
    pub outcome: TurnOutcome,
}

/// A fully wired agent: a model client, a tool registry, an engine config, and
/// an optional rollout recorder.
///
/// Construct one through [`AgentRuntime::builder`].
pub struct AgentRuntime {
    config: RuntimeConfig,
    client: Arc<dyn ModelClient>,
    tools: Arc<ToolRegistry>,
    history: Vec<ChatMessage>,
    session_id: Option<String>,
    forked_from: Option<String>,
    resume_path: Option<PathBuf>,
}

impl std::fmt::Debug for AgentRuntime {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("AgentRuntime")
            .field("config", &self.config)
            .field("model_id", &self.client.model_id())
            .field("tools", &self.tools)
            .finish()
    }
}

impl AgentRuntime {
    /// Start building a runtime.
    #[must_use]
    pub fn builder() -> AgentRuntimeBuilder {
        AgentRuntimeBuilder::default()
    }

    /// The configuration this runtime was assembled from.
    #[must_use]
    pub fn config(&self) -> &RuntimeConfig {
        &self.config
    }

    /// The tool registry the agent exposes to the model.
    #[must_use]
    pub fn tools(&self) -> &Arc<ToolRegistry> {
        &self.tools
    }

    /// Build a fresh [`RolloutRecorder`] when a rollout path is configured.
    async fn open_rollout(&self) -> Result<Option<RolloutRecorder>, RuntimeError> {
        if let Some(path) = &self.resume_path {
            let recorder = RolloutRecorder::reopen(path).await?;
            if self
                .session_id
                .as_deref()
                .is_some_and(|id| id != recorder.session_id())
            {
                recorder.shutdown().await?;
                return Err(RuntimeError::Config(
                    "resume session id does not match rollout".into(),
                ));
            }
            return Ok(Some(recorder));
        }
        match &self.config.rollout_path {
            Some(dir) => {
                let meta = aphrody_rollout::SessionMeta {
                    id: self.session_id.clone().unwrap_or_default(),
                    timestamp: String::new(),
                    cwd: self.config.cwd.clone(),
                    originator: "aphrody".to_string(),
                    cli_version: env!("CARGO_PKG_VERSION").to_string(),
                    model: Some(self.config.model.clone()),
                    model_provider: self.config.model_provider.clone(),
                    instructions: self.config.system_prompt.clone(),
                    git: None,
                    forked_from: self.forked_from.clone(),
                };
                let recorder = RolloutRecorder::create(dir, meta).await?;
                // A fork is self-contained: inherited history must survive a
                // later resume without reading its parent rollout.
                for message in &self.history {
                    recorder
                        .record_async(serde_json::json!({
                            "type": aphrody_engine::ROLLOUT_HISTORY_ITEM,
                            "message": message,
                        }))
                        .await?;
                    recorder.flush().await?;
                }
                Ok(Some(recorder))
            }
            None => Ok(None),
        }
    }

    /// Spawn a long-lived session actor for interactive surfaces (CLI / TUI /
    /// desktop).
    ///
    /// The returned [`SessionHandle`] accepts
    /// [`Op`](aphrody_agent_proto::Op) submissions and streams
    /// [`Event`](aphrody_agent_proto::Event)s back. The runtime is consumed; its
    /// model client and tool registry are moved into the actor.
    ///
    /// # Errors
    ///
    /// Returns [`RuntimeError::Rollout`] if the configured rollout file cannot
    /// be opened.
    pub async fn spawn(self) -> Result<SessionHandle, RuntimeError> {
        let rollout = self.open_rollout().await?;
        let session = Session::with_history(self.config.to_engine_config(), self.history);
        Ok(spawn_session(session, self.client, self.tools, rollout))
    }

    /// Drive one full headless turn for `prompt` and collect the result.
    ///
    /// This appends the prompt as user input, runs the engine turn loop to
    /// completion (executing any tool calls the model requests and re-injecting
    /// their output for multi-step reasoning), drains every emitted
    /// [`Event`], and returns them alongside the final agent message and the
    /// engine's [`TurnOutcome`]. The runtime is consumed.
    ///
    /// # Errors
    ///
    /// Returns [`RuntimeError::Rollout`] if the configured rollout file cannot
    /// be opened, or [`RuntimeError::Engine`] if the turn loop fails (e.g. the
    /// model stream errors).
    pub async fn run_once(self, prompt: impl Into<String>) -> Result<RunResult, RuntimeError> {
        let rollout = self.open_rollout().await?;
        let mut session = Session::with_history(self.config.to_engine_config(), self.history);
        let (sink, mut rx) = EventSink::unbounded();

        let input = vec![InputItem::Text {
            text: prompt.into(),
        }];

        // In FullAuto there is no approval gate; in Gated mode a headless caller
        // has no one to ask, so we still pass `None` and the engine denies tool
        // calls rather than blocking (engine semantics, turn.rs).
        let outcome = run_turn(
            &mut session,
            self.client.as_ref(),
            self.tools.as_ref(),
            rollout.as_ref(),
            input,
            &sink,
            None,
        )
        .await?;

        // The sink's sender is dropped with `sink` here; drain whatever the
        // engine emitted (the channel is unbounded so nothing was lost).
        drop(sink);
        let mut events = Vec::new();
        while let Ok(event) = rx.try_recv() {
            events.push(event);
        }

        if let Some(rollout) = rollout {
            rollout.shutdown().await?;
        }

        Ok(RunResult {
            last_agent_message: outcome.last_agent_message.clone(),
            events,
            outcome,
        })
    }
}

/// Builder for [`AgentRuntime`].
///
/// A [`ModelChoice`] is required; the [`RuntimeConfig`] defaults to
/// [`RuntimeConfig::default`] (which is
/// [`AutonomyMode::FullAuto`](aphrody_engine::AutonomyMode::FullAuto)).
#[derive(Debug, Default)]
pub struct AgentRuntimeBuilder {
    config: Option<RuntimeConfig>,
    model: Option<ModelChoice>,
    history: Vec<ChatMessage>,
    session_id: Option<String>,
    forked_from: Option<String>,
    resume_path: Option<PathBuf>,
    additional_tools: ToolRegistry,
}

impl AgentRuntimeBuilder {
    /// Add a caller-owned executor to the canonical registry. Duplicate names
    /// are rejected both here and against built-ins during assembly.
    ///
    /// # Errors
    /// Returns a registration error for a duplicate caller tool.
    pub fn tool(mut self, tool: Arc<dyn ToolExecutor>) -> Result<Self, RuntimeError> {
        self.additional_tools.register(tool)?;
        Ok(self)
    }
    /// Restore model-visible conversation history before the next user turn.
    #[must_use]
    pub fn history(mut self, history: Vec<ChatMessage>) -> Self {
        self.history = history;
        self
    }

    /// Use the same session id in protocol events and persisted metadata.
    #[must_use]
    pub fn session_id(mut self, id: impl Into<String>) -> Self {
        self.session_id = Some(id.into());
        self
    }

    /// Record the parent session of a new fork.
    #[must_use]
    pub fn forked_from(mut self, id: impl Into<String>) -> Self {
        self.forked_from = Some(id.into());
        self
    }

    /// Append to a previous rollout. Supply its restored history separately.
    #[must_use]
    pub fn resume_path(mut self, path: impl Into<PathBuf>) -> Self {
        self.resume_path = Some(path.into());
        self
    }

    /// Set the runtime configuration.
    #[must_use]
    pub fn config(mut self, config: RuntimeConfig) -> Self {
        self.config = Some(config);
        self
    }

    /// Set the model backend (required).
    #[must_use]
    pub fn model(mut self, model: ModelChoice) -> Self {
        self.model = Some(model);
        self
    }

    /// Assemble the runtime.
    ///
    /// # Errors
    ///
    /// Returns [`RuntimeError::Config`] if no [`ModelChoice`] was set, or
    /// [`RuntimeError::ToolRegistration`] if the tool registry could not be
    /// built.
    pub fn build(self) -> Result<AgentRuntime, RuntimeError> {
        self.validate()?;
        let config = self.config.clone().unwrap_or_default();
        if config
            .tool_profile
            .as_ref()
            .is_some_and(|profile| profile.has_mcp_servers())
        {
            return Err(RuntimeError::Config(
                "profiled MCP servers require AgentRuntimeBuilder::build_profiled".to_owned(),
            ));
        }
        let tools = build_tool_registry(&config)?;
        self.finish(config, tools)
    }

    /// Assemble a runtime with its exact profiled skills, plugins, and MCP
    /// servers. This is the entry point for a [`RuntimeConfig`] carrying a
    /// [`ToolProfileSpec`](crate::ToolProfileSpec) with MCP contributions.
    ///
    /// Unlike [`build`](Self::build), this method performs MCP handshakes and
    /// tool discovery before returning.
    pub async fn build_profiled(self) -> Result<AgentRuntime, RuntimeError> {
        self.validate()?;
        let config = self.config.clone().unwrap_or_default();
        let tools = build_profiled_tool_registry(&config).await?;
        self.finish(config, tools)
    }

    fn validate(&self) -> Result<(), RuntimeError> {
        if self.resume_path.is_some() && self.forked_from.is_some() {
            return Err(RuntimeError::Config(
                "a session cannot resume and fork simultaneously".into(),
            ));
        }
        if self.model.is_none() {
            return Err(RuntimeError::Config("a ModelChoice is required".to_owned()));
        }
        Ok(())
    }

    fn finish(
        self,
        config: RuntimeConfig,
        mut tools: Arc<ToolRegistry>,
    ) -> Result<AgentRuntime, RuntimeError> {
        let model = self.model.ok_or_else(|| {
            RuntimeError::Config("a ModelChoice is required after validation".to_owned())
        })?;
        if !self.additional_tools.is_empty() {
            let registry = Arc::make_mut(&mut tools);
            for definition in self.additional_tools.definitions() {
                if let Some(tool) = self.additional_tools.get(&definition.name) {
                    registry.register(tool)?;
                }
            }
        }
        if let Some(path) = &config.rag_db {
            #[cfg(not(feature = "rag"))]
            {
                let _ = (path, &mut tools);
                return Err(RuntimeError::Config(
                    "RAG requires the `rag` feature".into(),
                ));
            }
            #[cfg(feature = "rag")]
            {
                if !path.is_file() {
                    return Err(RuntimeError::Config(format!(
                        "RAG index does not exist: {}",
                        path.display()
                    )));
                }
                let store = Arc::new(
                    aphrody_rag::RagStore::open(path)
                        .map_err(|err| RuntimeError::Config(format!("RAG index: {err}")))?,
                );
                let searcher = Arc::new(aphrody_rag::RagSearcher::new(store.clone()));
                let indexer = Arc::new(aphrody_rag::RagIndexer::new(store));
                let registry = Arc::get_mut(&mut tools).ok_or_else(|| {
                    RuntimeError::Config("tool registry is already shared".into())
                })?;
                registry.register(Arc::new(aphrody_rag::RagSearchTool::new(searcher.clone())))?;
                registry.register(Arc::new(aphrody_rag::RagContextTool::new(searcher)))?;
                // Closes the BXC loop: scrape a page, index it, retrieve it later
                // in the same session without leaving the agent.
                registry.register(Arc::new(aphrody_rag::WebIngestTool::new(indexer)))?;
            }
        }
        Ok(AgentRuntime {
            config,
            client: model.into_client(),
            tools,
            history: self.history,
            session_id: self.session_id,
            forked_from: self.forked_from,
            resume_path: self.resume_path,
        })
    }
}
