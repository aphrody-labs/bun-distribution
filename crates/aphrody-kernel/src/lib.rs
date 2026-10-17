// SPDX-License-Identifier: Apache-2.0
//! The Aphrody OS kernel: the agentic fabric router.
//!
//! The kernel owns a registry of [`SystemSubsystem`]s, publishes their tools and skills over
//! the Model Context Protocol, routes every `tools/call` to the subsystem that owns the tool,
//! starts each subsystem's sub-agent on the shared [`AgentBus`], and lets other processes
//! (Bun, uv, another Rust binary) join as subsystems over the same connection
//! (`system/register_subsystem`). It speaks newline-delimited JSON-RPC 2.0 on a local socket
//! (Unix domain socket, Windows named pipe) and on stdio.
//!
//! Protocol summary (MCP methods plus the `system/` and `skills/` extensions):
//!
//! | Method | Effect |
//! |---|---|
//! | `initialize`, `ping` | MCP handshake and liveness. |
//! | `tools/list`, `tools/call` | Every subsystem tool, plus each skill as `skill_<name>`. |
//! | `skills/list`, `skills/run` | Skills with their steps; run one with parameters. |
//! | `system/subsystems` | Registered subsystems. |
//! | `system/subsystem_tools` | Tools owned by one named subsystem. |
//! | `system/register_subsystem` | The caller becomes a subsystem; the kernel sends it `tools/call` requests. |
//! | `a2a/message/send` | Dispatch `tool`/`arguments` to its registered `target` owner; `kernel` and `aphrody-kernel` retain registry-wide dispatch. Unknown or mismatched peers are rejected. |
//! | `system/subscribe`, `system/publish` | Receive bus events as `system/event` notifications; publish one. |

pub mod admin;
mod audit;
mod auth;
#[cfg(feature = "builtins")]
pub mod cli;
pub mod client;
pub mod cloud;
mod cloud_git;
#[cfg(feature = "builtins")]
pub mod compat;
#[cfg(feature = "builtins")]
pub mod coreutils;
pub mod events;
pub mod execpolicy;
#[path = "gcs.rs"]
mod gcs;
pub mod host_service;
pub mod hvsock;
pub mod infra;
pub mod mcp_proxy;
pub mod paths;
mod policy;
mod remote;
mod rpc;
pub mod runtimes;
#[cfg(feature = "builtins")]
pub mod systemd;
pub mod tool_host;
pub mod transport;

#[cfg(feature = "builtins")]
pub use cli::cli_main;
pub use host_service::host_service_main;

use std::{
    collections::{BTreeMap, HashMap, HashSet},
    path::Path,
    sync::{Arc, Mutex},
};

pub use admin::AdminSubsystem;
pub use aphrody_subsystem::{
    AgentBus, Event, SkillManifest, SkillStep, SubsystemError, SystemSubsystem, ToolDefinition,
};
pub use aphrody_toolchains::Toolchain;
pub use cloud::CloudSubsystem;
pub use infra::InfraSubsystem;
pub use runtimes::RuntimeSubsystem;
use serde_json::{Map, Value, json};
use tokio::sync::RwLock;

pub use crate::rpc::Session;

/// Prefix of the tool that runs a skill.
pub const SKILL_TOOL_PREFIX: &str = "skill_";

#[derive(Debug, thiserror::Error)]
pub enum KernelError {
    #[error("a subsystem named `{0}` is already registered")]
    DuplicateSubsystem(String),
    #[error("tool `{tool}` of `{subsystem}` is already served by `{owner}`")]
    DuplicateTool { tool: String, subsystem: String, owner: String },
    #[error("skill `{skill}` of `{subsystem}` is already served by `{owner}`")]
    DuplicateSkill { skill: String, subsystem: String, owner: String },
    #[error("tool names starting with `{SKILL_TOOL_PREFIX}` are reserved for skills: `{0}`")]
    ReservedName(String),
    #[error("kernel audit configuration is invalid: {0}")]
    AuditConfiguration(String),
    #[error("kernel audit is already configured")]
    AuditAlreadyConfigured,
    #[error("kernel audit requires an active Tokio runtime")]
    AuditRuntimeUnavailable,
    #[error("kernel authentication policy is invalid: {0}")]
    AuthenticationConfiguration(String),
    #[error("kernel execution policy is invalid: {0}")]
    ExecutionPolicyConfiguration(String),
}

#[derive(Default)]
struct Registry {
    subsystems: BTreeMap<String, Entry>,
    /// Tool name -> owning subsystem.
    tools: HashMap<String, String>,
    /// Tool name -> owning subsystem for O(1) direct dispatch.
    dispatch: HashMap<String, Arc<dyn SystemSubsystem>>,
    /// Precomputed and sorted tools as `(subsystem, definition)`.
    cached_tools: Arc<Vec<(String, ToolDefinition)>>,
    /// Precomputed skills as `(subsystem, manifest)`.
    cached_skills: Arc<Vec<(String, SkillManifest)>>,
    /// Precomputed MCP tools array ready for instant `tools/list` response.
    cached_mcp_tools: Arc<Vec<Value>>,
}

impl Registry {
    fn rebuild_cache(&mut self) {
        let mut dispatch = HashMap::with_capacity(self.tools.len());
        let mut tools: Vec<(String, ToolDefinition)> = Vec::with_capacity(self.tools.len());
        let mut skills: Vec<(String, SkillManifest)> = Vec::new();

        for (subsystem_name, entry) in &self.subsystems {
            let sub_tools = entry.subsystem.tools();
            for tool in sub_tools {
                dispatch.insert(tool.name.clone(), Arc::clone(&entry.subsystem));
                tools.push((subsystem_name.clone(), tool));
            }
            let sub_skills = entry.subsystem.skills();
            for skill in sub_skills {
                skills.push((subsystem_name.clone(), skill));
            }
        }

        tools.sort_by(|a, b| a.1.name.cmp(&b.1.name));

        let mut mcp_tools = Vec::with_capacity(tools.len() + skills.len());
        for (_, tool) in &tools {
            mcp_tools.push(tool.to_mcp());
        }
        for (subsystem, skill) in &skills {
            mcp_tools.push(crate::rpc::skill_tool(subsystem, skill).to_mcp());
        }

        self.dispatch = dispatch;
        self.cached_tools = Arc::new(tools);
        self.cached_skills = Arc::new(skills);
        self.cached_mcp_tools = Arc::new(mcp_tools);
    }
}

struct Entry {
    subsystem: Arc<dyn SystemSubsystem>,
    remote: bool,
    agent: Option<tokio::task::JoinHandle<()>>,
}

/// The fabric router. Cheap to clone; clones share state.
#[derive(Clone)]
pub struct Kernel {
    registry: Arc<RwLock<Registry>>,
    bus: AgentBus,
    audit: Arc<Mutex<Option<audit::AuditBridge>>>,
    auth: auth::AuthPolicy,
    policy: Option<policy::DispatchPolicy>,
}

impl Default for Kernel {
    fn default() -> Self {
        Self::new()
    }
}

impl Kernel {
    #[must_use]
    pub fn new() -> Self {
        Self::with_auth(auth::AuthPolicy::default())
    }

    /// Construct a kernel that requires the principals defined in an absolute policy file.
    ///
    /// The file is read once during startup and its tokens never appear in kernel status APIs.
    ///
    /// # Errors
    /// Returns an error when the policy cannot be loaded or is invalid.
    pub fn with_authentication_file(
        path: impl AsRef<std::path::Path>,
    ) -> Result<Self, KernelError> {
        auth::AuthPolicy::from_file(path)
            .map(Self::with_auth)
            .map_err(KernelError::AuthenticationConfiguration)
    }

    /// Construct a kernel with an explicit authenticated-session policy.
    #[must_use]
    pub(crate) fn with_auth(auth: auth::AuthPolicy) -> Self {
        Self {
            registry: Arc::default(),
            bus: AgentBus::default(),
            audit: Arc::default(),
            auth,
            policy: None,
        }
    }

    /// Construct a kernel with an execution policy loaded from an absolute `.codexpolicy` path.
    ///
    /// The policy evaluates tool names before kernel dispatch.
    /// Note: tool-specific process implementations still require their own argv/filesystem sandbox enforcement.
    ///
    /// # Errors
    /// Returns an error when the policy cannot be read or parsed.
    pub fn with_execution_policy_file(
        mut self,
        path: impl AsRef<Path>,
    ) -> Result<Self, KernelError> {
        self.policy = Some(
            policy::DispatchPolicy::from_file(path)
                .map_err(KernelError::ExecutionPolicyConfiguration)?,
        );
        Ok(self)
    }

    #[must_use]
    pub fn bus(&self) -> AgentBus {
        self.bus.clone()
    }

    /// Persist every future bus event to one local NDJSON audit stream.
    ///
    /// The path must be absolute so a service working directory cannot move
    /// audit records unexpectedly. Overflow and write errors are exposed by
    /// [`Self::audit_status`].
    ///
    /// # Errors
    /// When the path is invalid, no Tokio runtime is active, or an audit bridge
    /// already exists for this kernel.
    pub fn start_audit(&self, path: impl AsRef<Path>) -> Result<(), KernelError> {
        let path = audit::validate_path(path).map_err(KernelError::AuditConfiguration)?;
        if tokio::runtime::Handle::try_current().is_err() {
            return Err(KernelError::AuditRuntimeUnavailable);
        }
        let mut audit = self.audit.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
        if audit.is_some() {
            return Err(KernelError::AuditAlreadyConfigured);
        }
        *audit = Some(audit::AuditBridge::start(self.bus(), path));
        Ok(())
    }

    /// Audit bridge health and counters, or `{ "enabled": false }` when no
    /// local persistent audit stream was configured.
    #[must_use]
    pub fn audit_status(&self) -> Value {
        self.audit
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .as_ref()
            .map_or_else(|| json!({ "enabled": false }), audit::AuditBridge::status)
    }

    pub(crate) fn authenticate(&self, token: Option<&str>) -> Option<auth::SessionScope> {
        self.auth.authenticate(token)
    }

    pub(crate) const fn requires_authentication(&self) -> bool {
        self.auth.requires_authentication()
    }

    /// Register a local subsystem and start its sub-agent.
    ///
    /// # Errors
    /// A name or tool collision, or a tool name in the skill namespace.
    pub async fn register(&self, subsystem: Arc<dyn SystemSubsystem>) -> Result<(), KernelError> {
        self.insert(subsystem, false).await
    }

    async fn insert(
        &self,
        subsystem: Arc<dyn SystemSubsystem>,
        remote: bool,
    ) -> Result<(), KernelError> {
        let name = subsystem.name().to_owned();
        let tools = subsystem.tools();
        let skills = subsystem.skills();
        {
            let mut registry = self.registry.write().await;
            if registry.subsystems.contains_key(&name) {
                return Err(KernelError::DuplicateSubsystem(name));
            }
            let mut local_tools = HashSet::with_capacity(tools.len());
            for tool in &tools {
                if tool.name.starts_with(SKILL_TOOL_PREFIX) {
                    return Err(KernelError::ReservedName(tool.name.clone()));
                }
                if !local_tools.insert(&tool.name) {
                    return Err(KernelError::DuplicateTool {
                        tool: tool.name.clone(),
                        subsystem: name.clone(),
                        owner: name.clone(),
                    });
                }
                if let Some(owner) = registry.tools.get(&tool.name) {
                    return Err(KernelError::DuplicateTool {
                        tool: tool.name.clone(),
                        subsystem: name,
                        owner: owner.clone(),
                    });
                }
            }
            let mut local_skills = HashSet::with_capacity(skills.len());
            for skill in &skills {
                if !local_skills.insert(&skill.name) {
                    return Err(KernelError::DuplicateSkill {
                        skill: skill.name.clone(),
                        subsystem: name.clone(),
                        owner: name.clone(),
                    });
                }
                for entry in registry.subsystems.values() {
                    if entry.subsystem.skills().iter().any(|other| other.name == skill.name) {
                        return Err(KernelError::DuplicateSkill {
                            skill: skill.name.clone(),
                            subsystem: name.clone(),
                            owner: entry.subsystem.name().to_owned(),
                        });
                    }
                }
            }
            for tool in &tools {
                registry.tools.insert(tool.name.clone(), name.clone());
            }
            let agent = {
                let subsystem = Arc::clone(&subsystem);
                let bus = self.bus.clone();
                let source = name.clone();
                tokio::spawn(async move {
                    if let Err(error) = subsystem.run(bus.clone()).await {
                        bus.publish(Event {
                            source,
                            kind: "subagent/failed".into(),
                            payload: json!({ "error": error.to_string() }),
                        });
                    }
                })
            };
            registry
                .subsystems
                .insert(name.clone(), Entry { subsystem, remote, agent: Some(agent) });
            registry.rebuild_cache();
        }
        self.bus.publish(Event {
            source: "kernel".into(),
            kind: "tools/list_changed".into(),
            payload: json!({ "registered": name, "tools": tools.len(), "remote": remote }),
        });
        Ok(())
    }

    /// Remove a subsystem and stop its sub-agent. Returns whether it was registered.
    pub async fn unregister(&self, name: &str) -> bool {
        let removed = {
            let mut registry = self.registry.write().await;
            let removed = registry.subsystems.remove(name);
            if removed.is_some() {
                registry.tools.retain(|_, owner| owner != name);
                registry.rebuild_cache();
            }
            removed
        };
        let Some(mut entry) = removed else { return false };
        if let Some(agent) = entry.agent.take() {
            agent.abort();
        }
        self.bus.publish(Event {
            source: "kernel".into(),
            kind: "tools/list_changed".into(),
            payload: json!({ "unregistered": name }),
        });
        true
    }

    /// Every tool as `(subsystem, definition)`, sorted by tool name, skills excluded.
    pub async fn tools(&self) -> Vec<(String, ToolDefinition)> {
        let registry = self.registry.read().await;
        (*registry.cached_tools).clone()
    }

    /// Tools owned by one named subsystem, sorted by tool name.
    #[must_use]
    pub async fn subsystem_tools(&self, name: &str) -> Option<Vec<ToolDefinition>> {
        let registry = self.registry.read().await;
        let mut tools = registry.subsystems.get(name)?.subsystem.tools();
        tools.sort_by(|left, right| left.name.cmp(&right.name));
        Some(tools)
    }

    /// Every skill as `(subsystem, manifest)`.
    pub async fn skills(&self) -> Vec<(String, SkillManifest)> {
        let registry = self.registry.read().await;
        (*registry.cached_skills).clone()
    }

    /// Precomputed MCP tools array ready for instant `tools/list` response.
    #[must_use]
    pub async fn mcp_tools(&self) -> Arc<Vec<Value>> {
        let registry = self.registry.read().await;
        Arc::clone(&registry.cached_mcp_tools)
    }

    /// Summary of every registered subsystem.
    pub async fn subsystems(&self) -> Vec<Value> {
        let registry = self.registry.read().await;
        registry
            .subsystems
            .iter()
            .map(|(name, entry)| {
                json!({
                    "name": name,
                    "description": entry.subsystem.description(),
                    "tools": entry.subsystem.tools().len(),
                    "skills": entry.subsystem.skills().len(),
                    "remote": entry.remote,
                })
            })
            .collect()
    }

    /// Route one tool call. `skill_<name>` runs that skill with the arguments as parameters.
    ///
    /// # Errors
    /// The subsystem's error, or [`SubsystemError::UnknownTool`].
    pub async fn call(&self, tool: &str, arguments: Value) -> Result<Value, SubsystemError> {
        if let Some(policy) = &self.policy {
            policy.allows(tool).map_err(SubsystemError::Failed)?;
        }
        if let Some(skill) = tool.strip_prefix(SKILL_TOOL_PREFIX) {
            let params = match arguments {
                Value::Object(params) => params,
                Value::Null => Map::new(),
                _ => {
                    return Err(SubsystemError::InvalidArguments(
                        "skill parameters must be an object".into(),
                    ));
                },
            };
            return self.run_skill(skill, &params).await;
        }
        let subsystem = {
            let registry = self.registry.read().await;
            registry
                .dispatch
                .get(tool)
                .cloned()
                .ok_or_else(|| SubsystemError::UnknownTool(tool.to_owned()))?
        };
        subsystem.call(tool, arguments).await
    }

    /// Route one tool call and return the MCP `CallToolResult` (failures are `isError` results).
    pub async fn call_tool_result(&self, tool: &str, arguments: Value) -> Value {
        crate::rpc::call_result(self.call(tool, arguments).await)
    }

    /// Dispatch to a specific registered peer, retaining its handle across
    /// concurrent registry changes. Kernel aliases retain ordinary dispatch.
    pub(crate) async fn call_target(
        &self,
        target: &str,
        tool: &str,
        arguments: Value,
    ) -> Result<Value, SubsystemError> {
        if matches!(target, "kernel" | "aphrody-kernel") {
            return self.call(tool, arguments).await;
        }
        if let Some(policy) = &self.policy {
            policy.allows(tool).map_err(SubsystemError::Failed)?;
        }
        let subsystem = {
            let registry = self.registry.read().await;
            let subsystem = registry
                .dispatch
                .get(tool)
                .ok_or_else(|| SubsystemError::UnknownTool(tool.to_owned()))?;
            if subsystem.name() != target {
                return Err(SubsystemError::InvalidArguments(format!(
                    "target {target:?} does not own tool {tool:?}; owner is {:?}",
                    subsystem.name()
                )));
            }
            Arc::clone(subsystem)
        };
        subsystem.call(tool, arguments).await
    }

    /// Run a skill: each step's rendered arguments go to [`Kernel::call`]; the result lists
    /// every step and carries the last step's value as `result`.
    ///
    /// # Errors
    /// Unknown skill, bad parameters, or the first failing step (with its index).
    pub async fn run_skill(
        &self,
        name: &str,
        params: &Map<String, Value>,
    ) -> Result<Value, SubsystemError> {
        let skill = {
            let registry = self.registry.read().await;
            registry
                .cached_skills
                .iter()
                .find(|(_, skill)| skill.name == name)
                .map(|(_, skill)| skill.clone())
                .ok_or_else(|| SubsystemError::UnknownTool(format!("{SKILL_TOOL_PREFIX}{name}")))?
        };
        let mut steps = Vec::with_capacity(skill.steps.len());
        let mut previous: Option<Value> = None;
        for (index, step) in skill.steps.iter().enumerate() {
            if step.tool.starts_with(SKILL_TOOL_PREFIX) {
                return Err(SubsystemError::InvalidArguments(format!(
                    "skill {name} step {index} calls a skill; nesting is not allowed"
                )));
            }
            let arguments = skill.render_step(step, params, previous.as_ref())?;
            let result = Box::pin(self.call(&step.tool, arguments)).await.map_err(|error| {
                SubsystemError::Failed(format!(
                    "skill {name} step {index} ({}): {error}",
                    step.tool
                ))
            })?;
            steps.push(json!({ "tool": step.tool, "result": result }));
            previous = Some(result);
        }
        Ok(json!({ "skill": name, "steps": steps, "result": previous.unwrap_or(Value::Null) }))
    }
}

#[cfg(test)]
mod tests;
