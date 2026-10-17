// SPDX-License-Identifier: Apache-2.0
//! Runtime configuration: the knobs a surface sets to assemble an agent.

use std::{path::PathBuf, time::Duration};

use aphrody_agent_tools::{DEFAULT_MAX_OUTPUT_BYTES, DEFAULT_TIMEOUT, ShellExecConfig};
use aphrody_config::ComputerUseConfig;
use aphrody_engine::{AutonomyMode, EngineConfig};
use serde_json::Value;

use crate::tools::ToolProfileSpec;

/// Opt-in bounds for the shell-exec tool.
///
/// Both tools assembled by the runtime are *permissive by default* (CLAUDE.md
/// §0.1: no human in the loop): there is no command allow/deny-listing and no
/// path jailing. These two fields only bound runaway commands (a wall-clock
/// timeout and an output cap) and map directly onto
/// [`ShellExecConfig`](aphrody_agent_tools::ShellExecConfig).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ShellGuardrails {
    /// Wall-clock timeout applied when a tool call omits its own `timeout_ms`.
    pub default_timeout: Duration,
    /// Maximum number of bytes retained from a command's combined output.
    pub max_output_bytes: usize,
}

impl Default for ShellGuardrails {
    fn default() -> Self {
        Self {
            default_timeout: DEFAULT_TIMEOUT,
            max_output_bytes: DEFAULT_MAX_OUTPUT_BYTES,
        }
    }
}

impl ShellGuardrails {
    /// Translate these guardrails into the tool crate's
    /// [`ShellExecConfig`](aphrody_agent_tools::ShellExecConfig).
    #[must_use]
    pub(crate) fn to_shell_config(&self) -> ShellExecConfig {
        ShellExecConfig {
            default_timeout: self.default_timeout,
            max_output_bytes: self.max_output_bytes,
        }
    }
}

/// The sessions root under the aphrody state directory, when it resolves.
#[must_use]
pub fn default_sessions_dir() -> Option<PathBuf> {
    aphrody_models::paths::state_subdir("sessions").ok()
}

/// Everything a surface configures to assemble a ready-to-run agent.
///
/// Build one with [`RuntimeConfig::new`] (or [`RuntimeConfig::default`]) and the
/// `with_*` builder methods, then hand it to
/// [`AgentRuntime::builder`](crate::AgentRuntime::builder).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RuntimeConfig {
    /// The model identifier the session targets (informational on the engine
    /// side; the actual model is chosen by the
    /// [`ModelChoice`](crate::ModelChoice)).
    pub model: String,
    /// Provider identity retained when a session is resumed after restart.
    pub model_provider: Option<String>,
    /// Optional system instruction prepended to every model request.
    pub system_prompt: Option<String>,
    /// Agent Home root reloaded for each model turn.
    pub live_agent_home_workspace: Option<PathBuf>,
    /// JSON Schema requested for the final model response.
    pub response_schema: Option<Value>,
    /// Tool-call approval policy. Defaults to
    /// [`AutonomyMode::FullAuto`](aphrody_engine::AutonomyMode::FullAuto).
    pub autonomy: AutonomyMode,
    /// Maximum number of model<->tool round trips within a single turn.
    /// Zero removes the iteration cap (explicit YOLO mode).
    pub max_tool_iterations: usize,
    /// Optional prompt-token threshold for automatic structural compaction.
    /// When absent the engine derives the threshold from model capabilities.
    pub auto_compact_token_limit: Option<u64>,
    /// Working directory the tools resolve relative paths against. When `None`
    /// the agent's process directory is used.
    pub cwd: Option<PathBuf>,
    /// Opt-in shell-exec guardrails (timeout / output cap).
    pub shell: ShellGuardrails,
    /// When set, every emitted event is mirrored to a rollout JSONL file under
    /// this directory (see [`RolloutRecorder`](aphrody_rollout::RolloutRecorder)).
    pub rollout_path: Option<PathBuf>,
    /// Local retrieval database exposed through `rag_search` and `rag_context`.
    /// Requires the runtime's `rag` feature. No index is created implicitly.
    pub rag_db: Option<PathBuf>,
    /// Exact tool surface selected by the active profile. When absent, the
    /// historical built-in tool set is used. Profiled MCP initialization is
    /// asynchronous and requires
    /// [`AgentRuntimeBuilder::build_profiled`](crate::AgentRuntimeBuilder::build_profiled).
    pub tool_profile: Option<ToolProfileSpec>,
    /// `[computer_use]` policy for the desktop `computer_use` tool: master
    /// switch, application allow/deny lists and target environment. `None`
    /// keeps the tool registered with the host's auto-detected backend and
    /// no application restriction beyond the hard-coded security denials.
    pub computer_use: Option<ComputerUseConfig>,
}

impl Default for RuntimeConfig {
    fn default() -> Self {
        Self {
            model: String::new(),
            model_provider: None,
            system_prompt: None,
            live_agent_home_workspace: None,
            response_schema: None,
            // No human in the loop by default (CLAUDE.md §0.1).
            autonomy: AutonomyMode::FullAuto,
            max_tool_iterations: aphrody_engine::DEFAULT_MAX_TOOL_ITERATIONS,
            auto_compact_token_limit: None,
            cwd: None,
            shell: ShellGuardrails::default(),
            // A library default never writes into the user's home: surfaces
            // that persist sessions opt in with `with_default_rollout_dir`.
            rollout_path: None,
            rag_db: None,
            tool_profile: None,
            computer_use: None,
        }
    }
}

impl RuntimeConfig {
    /// Record the provider used to construct the model client.
    #[must_use]
    pub fn with_model_provider(mut self, provider: impl Into<String>) -> Self {
        self.model_provider = Some(provider.into());
        self
    }
    /// Enable retrieval from an existing local index. Without the `rag`
    /// feature, building the runtime returns an explicit configuration error.
    #[must_use]
    pub fn with_rag_db(mut self, path: impl Into<PathBuf>) -> Self {
        self.rag_db = Some(path.into());
        self
    }

    /// Restrict tools, skills, plugins, and MCP servers to an explicit
    /// resolved profile snapshot.
    #[must_use]
    pub fn with_tool_profile(mut self, profile: ToolProfileSpec) -> Self {
        self.tool_profile = Some(profile);
        self
    }

    /// Build a config targeting `model` with runtime defaults otherwise.
    #[must_use]
    pub fn new(model: impl Into<String>) -> Self {
        Self {
            model: model.into(),
            ..Self::default()
        }
    }

    /// Set the system prompt (builder style).
    #[must_use]
    pub fn with_system_prompt(mut self, system_prompt: impl Into<String>) -> Self {
        self.system_prompt = Some(system_prompt.into());
        self
    }

    /// Use a live Agent Home for every turn, including interactive sessions.
    #[must_use]
    pub fn with_live_agent_home_workspace(mut self, workspace: impl Into<PathBuf>) -> Self {
        self.live_agent_home_workspace = Some(workspace.into());
        self
    }

    /// Send a JSON Schema constraint to the model on each turn.
    #[must_use]
    pub fn with_response_schema(mut self, schema: Value) -> Self {
        self.response_schema = Some(schema);
        self
    }

    /// Set the autonomy mode (builder style).
    #[must_use]
    pub fn with_autonomy(mut self, autonomy: AutonomyMode) -> Self {
        self.autonomy = autonomy;
        self
    }

    /// Set the per-turn tool-iteration budget (builder style).
    #[must_use]
    pub fn with_max_tool_iterations(mut self, max: usize) -> Self {
        self.max_tool_iterations = max;
        self
    }

    /// Set the prompt-token threshold for automatic structural compaction.
    #[must_use]
    pub fn with_auto_compact_token_limit(mut self, limit: u64) -> Self {
        self.auto_compact_token_limit = (limit > 0).then_some(limit);
        self
    }

    /// Run autonomously until completion, interruption, or a model/tool error.
    #[must_use]
    pub fn with_yolo(self) -> Self {
        self.with_autonomy(AutonomyMode::FullAuto)
            .with_max_tool_iterations(0)
    }

    /// Set the working directory the tools resolve relative paths against
    /// (builder style).
    #[must_use]
    pub fn with_cwd(mut self, cwd: impl Into<PathBuf>) -> Self {
        self.cwd = Some(cwd.into());
        self
    }

    /// Set the shell-exec guardrails (builder style).
    #[must_use]
    pub fn with_shell_guardrails(mut self, shell: ShellGuardrails) -> Self {
        self.shell = shell;
        self
    }

    /// Apply the `[computer_use]` policy from the resolved configuration
    /// (builder style).
    #[must_use]
    pub fn with_computer_use(mut self, computer_use: ComputerUseConfig) -> Self {
        self.computer_use = Some(computer_use);
        self
    }

    /// Record every emitted event to a rollout JSONL file under `dir` (builder
    /// style).
    #[must_use]
    pub fn with_rollout_path(mut self, dir: impl Into<PathBuf>) -> Self {
        self.rollout_path = Some(dir.into());
        self
    }

    /// Record sessions under the aphrody state directory
    /// (`$APHRODY_HOME/sessions`, else `~/.aphrody/sessions`) — what every
    /// user-facing surface (CLI, TUI, app-server) does by default. Left unset
    /// when the state directory cannot be resolved, so a host without a home
    /// still runs, just without a rollout.
    #[must_use]
    pub fn with_default_rollout_dir(mut self) -> Self {
        self.rollout_path = default_sessions_dir();
        self
    }

    /// Project this config onto the engine's [`EngineConfig`].
    #[must_use]
    pub(crate) fn to_engine_config(&self) -> EngineConfig {
        EngineConfig {
            model: self.model.clone(),
            system_prompt: self.system_prompt.clone(),
            live_agent_home_workspace: self.live_agent_home_workspace.clone(),
            response_schema: self.response_schema.clone(),
            max_tool_iterations: self.max_tool_iterations,
            auto_compact_token_limit: self.auto_compact_token_limit,
            autonomy: self.autonomy,
        }
    }
}
