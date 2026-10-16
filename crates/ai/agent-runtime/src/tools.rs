// SPDX-License-Identifier: Apache-2.0
//! Tool wiring: build a [`ToolRegistry`] preloaded with the agent's real
//! capabilities (shell-exec, patching, file inspection, search, and browser
//! computer use).

use std::{
    collections::{BTreeMap, BTreeSet},
    path::PathBuf,
    sync::Arc,
};

use aphrody_agent_tools::{
    ApplyPatchTool, ComputerEnvironment, ComputerPolicy, ComputerTool, ComputerUseTool,
    GoogleAiTool, JevDecideTool, JsEvalTool, ReadFileTool, RemoteComputerTarget, SearchTextTool,
    ShellExecTool, WebScrapeTool, WebSearchTool,
};
use aphrody_config::{ComputerUseConfig, ComputerUseEnvironment, McpServerConfig};
use aphrody_mcp_client::{ToolCatalog, register_selected_mcp_servers};
use aphrody_toolcall::{
    JsonSchema, ToolDefinition, ToolError, ToolExecutor, ToolOutput, ToolRegistry,
};
use serde_json::Value;

use crate::{config::RuntimeConfig, error::RuntimeError};

/// Maximum bytes returned by one skill tool invocation.
const MAX_SKILL_BYTES: u64 = 256 * 1024;

/// Tool name of the in-process browser ("web computer use") surface (formerly bxc-backed).
///
/// Kept distinct from the native `computer_use` desktop surface so an agent can
/// drive a page and the host desktop in the same session.
pub const BROWSER_TOOL: &str = "browser";

/// Name of the native desktop computer-use tool.
pub const COMPUTER_USE_TOOL: &str = "computer_use";

/// Built-in tools contributed by the BXC subsystem.
///
/// Useful for a [`ToolProfileSpec::builtin_tools`] allow-list that wants the
/// whole web surface without naming each tool.
pub const BXC_BUILTIN_TOOLS: [&str; 5] =
    ["web_search", "web_scrape", "js_eval", "google_ai", BROWSER_TOOL];

/// One explicitly authorized `SKILL.md` file.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SkillSpec {
    /// Stable profile-local identifier used in the exposed tool name.
    pub name: String,
    /// Exact `SKILL.md` path. Runtime discovery is deliberately not implicit.
    pub path: PathBuf,
}

impl SkillSpec {
    /// Create one explicit skill binding.
    #[must_use]
    pub fn new(name: impl Into<String>, path: impl Into<PathBuf>) -> Self {
        Self { name: name.into(), path: path.into() }
    }
}

/// Tool contributions from one plugin already selected by the active profile.
///
/// Plugin ids namespace every contribution, preventing two profiles/plugins
/// from accidentally sharing a tool name or MCP connection.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct PluginToolSpec {
    /// Stable plugin identifier.
    pub id: String,
    /// Skills explicitly enabled from this plugin.
    pub skills: Vec<SkillSpec>,
    /// MCP servers explicitly enabled from this plugin.
    pub mcp_servers: BTreeMap<String, McpServerConfig>,
}

impl PluginToolSpec {
    /// Create an empty, explicitly selected plugin contribution.
    #[must_use]
    pub fn new(id: impl Into<String>) -> Self {
        Self { id: id.into(), ..Self::default() }
    }
}

/// Fully resolved tool surface for one runtime profile.
///
/// `None` for `builtin_tools` preserves the default built-in set. `Some`,
/// including an empty set, is an exact allow-list. Skills, plugins, and MCP
/// servers are opt-in: only entries carried by this value are loaded.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ToolProfileSpec {
    /// Exact built-in allow-list, or all built-ins when absent.
    pub builtin_tools: Option<BTreeSet<String>>,
    /// Profile-owned skills.
    pub skills: Vec<SkillSpec>,
    /// Profile-owned MCP servers.
    pub mcp_servers: BTreeMap<String, McpServerConfig>,
    /// Contributions from plugins explicitly enabled for this profile.
    pub plugins: Vec<PluginToolSpec>,
}

impl ToolProfileSpec {
    /// Whether asynchronous MCP discovery is required.
    #[must_use]
    pub fn has_mcp_servers(&self) -> bool {
        !self.mcp_servers.is_empty()
            || self.plugins.iter().any(|plugin| !plugin.mcp_servers.is_empty())
    }

    fn allows_builtin(&self, name: &str) -> bool {
        self.builtin_tools.as_ref().is_none_or(|allowed| allowed.contains(name))
    }
}

/// Tool that reveals one authorized skill on demand.
struct SkillTool {
    definition: ToolDefinition,
    content: String,
}

impl SkillTool {
    fn new(exposed_name: String, content: String) -> Self {
        Self {
            definition: ToolDefinition::new(
                exposed_name,
                "Load the instructions for one skill authorized by the active profile.",
                JsonSchema::object(BTreeMap::new(), Some(Vec::new()), Some(false.into())),
            ),
            content,
        }
    }
}

#[async_trait::async_trait]
impl ToolExecutor for SkillTool {
    fn definition(&self) -> &ToolDefinition {
        &self.definition
    }

    async fn handle(&self, _arguments: Value) -> Result<ToolOutput, ToolError> {
        Ok(ToolOutput::ok(self.content.clone()))
    }
}

/// A [`ToolExecutor`] decorator that injects a default `cwd` argument when a
/// tool call omits one.
///
/// The engine dispatches a tool call by handing its raw JSON arguments straight
/// to the executor; it never rewrites them. Both [`ShellExecTool`] and
/// [`ApplyPatchTool`] honor a per-call `cwd` field, so this wrapper is how the
/// runtime's [`RuntimeConfig::cwd`](crate::RuntimeConfig::cwd) becomes effective:
/// if the model did not specify a working directory, we fill in the configured
/// one before delegating. Relative directories are resolved from that workspace;
/// an explicitly absolute directory wins.
struct CwdDefaulting {
    inner: Arc<dyn ToolExecutor>,
    cwd: PathBuf,
}

#[async_trait::async_trait]
impl ToolExecutor for CwdDefaulting {
    fn definition(&self) -> &ToolDefinition {
        self.inner.definition()
    }

    async fn handle(&self, mut arguments: Value) -> Result<ToolOutput, ToolError> {
        if let Value::Object(map) = &mut arguments {
            let resolved = match map.get("cwd") {
                None | Some(Value::Null) => Some(self.cwd.clone()),
                Some(Value::String(path)) => Some(self.cwd.join(path)),
                Some(_) => None,
            };
            if let Some(resolved) = resolved {
                map.insert(
                    "cwd".to_string(),
                    Value::String(resolved.to_string_lossy().into_owned()),
                );
            }
        }
        self.inner.handle(arguments).await
    }
}

/// Resolve missing or relative working directories against `cwd`.
fn with_default_cwd(inner: Arc<dyn ToolExecutor>, cwd: Option<&PathBuf>) -> Arc<dyn ToolExecutor> {
    match cwd {
        Some(cwd) => Arc::new(CwdDefaulting { inner, cwd: cwd.clone() }),
        None => inner,
    }
}

fn profile_error(message: impl Into<String>) -> ToolError {
    ToolError::InvalidArguments { tool: "tool_profile".to_owned(), message: message.into() }
}

fn validate_component(kind: &str, value: &str) -> Result<(), ToolError> {
    if value.is_empty()
        || !value.chars().all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '_' | '-'))
    {
        return Err(profile_error(format!(
            "{kind} `{value}` must contain only ASCII letters, digits, `_`, or `-`"
        )));
    }
    Ok(())
}

fn register_if_allowed(
    registry: &mut ToolRegistry,
    profile: Option<&ToolProfileSpec>,
    tool: Arc<dyn ToolExecutor>,
) -> Result<(), ToolError> {
    if profile.is_none_or(|profile| profile.allows_builtin(&tool.definition().name)) {
        registry.register(tool)?;
    }
    Ok(())
}

fn register_skill(
    registry: &mut ToolRegistry,
    plugin_id: Option<&str>,
    skill: &SkillSpec,
) -> Result<(), ToolError> {
    validate_component("skill id", &skill.name)?;
    if let Some(plugin_id) = plugin_id {
        validate_component("plugin id", plugin_id)?;
    }
    let name = plugin_id.map_or_else(
        || format!("skill__{}", skill.name),
        |plugin_id| format!("skill__{plugin_id}__{}", skill.name),
    );
    let metadata = std::fs::metadata(&skill.path).map_err(|error| {
        profile_error(format!("cannot inspect skill {}: {error}", skill.path.display()))
    })?;
    if !metadata.is_file() {
        return Err(profile_error(format!("skill path is not a file: {}", skill.path.display())));
    }
    if metadata.len() > MAX_SKILL_BYTES {
        return Err(profile_error(format!(
            "skill exceeds {MAX_SKILL_BYTES} byte limit: {}",
            skill.path.display()
        )));
    }
    let content = std::fs::read_to_string(&skill.path).map_err(|error| {
        profile_error(format!("cannot read skill {}: {error}", skill.path.display()))
    })?;
    registry.register(Arc::new(SkillTool::new(name, content)))
}

fn register_profile_skills(
    registry: &mut ToolRegistry,
    profile: &ToolProfileSpec,
) -> Result<(), ToolError> {
    validate_plugins(profile)?;
    for skill in &profile.skills {
        register_skill(registry, None, skill)?;
    }
    for plugin in &profile.plugins {
        validate_component("plugin id", &plugin.id)?;
        for skill in &plugin.skills {
            register_skill(registry, Some(&plugin.id), skill)?;
        }
    }
    Ok(())
}

fn validate_plugins(profile: &ToolProfileSpec) -> Result<(), ToolError> {
    let mut seen = BTreeSet::new();
    for plugin in &profile.plugins {
        validate_component("plugin id", &plugin.id)?;
        if !seen.insert(&plugin.id) {
            return Err(profile_error(format!("duplicate plugin id `{}`", plugin.id)));
        }
    }
    Ok(())
}

fn profiled_mcp_servers(
    profile: &ToolProfileSpec,
) -> Result<BTreeMap<String, McpServerConfig>, ToolError> {
    validate_plugins(profile)?;
    let mut servers = profile.mcp_servers.clone();
    for name in servers.keys() {
        validate_component("MCP server id", name)?;
    }
    for plugin in &profile.plugins {
        validate_component("plugin id", &plugin.id)?;
        for (server_name, config) in &plugin.mcp_servers {
            validate_component("MCP server id", server_name)?;
            let namespaced = format!("plugin__{}__{server_name}", plugin.id);
            if servers.insert(namespaced.clone(), config.clone()).is_some() {
                return Err(profile_error(format!("duplicate MCP server id `{namespaced}`")));
            }
        }
    }
    Ok(servers)
}

/// Build a [`ToolRegistry`] preloaded with the agent's production tools.
///
/// The registry contains:
///
/// - `shell` — [`ShellExecTool`] bounded by the config's
///   [`ShellGuardrails`](crate::ShellGuardrails) (timeout / output cap). The command is run
///   directly (no shell interpretation).
/// - `apply_patch` — [`ApplyPatchTool`] applying patches to real disk.
/// - `read_file` — bounded UTF-8 file inspection.
/// - `search_text` — structured repository search.
/// - `computer_use` — native desktop automation, shaped by the `[computer_use]` policy
///   ([`RuntimeConfig::computer_use`]): Windows drives the in-process `aphrody-winclean` crate in-process; a host or
///   environment without a backend gets a tool that rejects every action explicitly.
/// - Windows only: `winclean` (gateway to the 166-tool WinClean catalog) plus the native
///   computer-use core (`computer_observe`, `computer_click`, …) backed by the in-process `aphrody-winclean` crate; the rest
///   of the catalog is registered as deferred (dispatch-only). A WinClean tool whose name is
///   already taken above is skipped.
///
/// When [`RuntimeConfig::cwd`](crate::RuntimeConfig::cwd) is set, both tools are
/// wrapped so a tool call that omits `cwd` defaults to it.
///
/// Both tools are permissive by default (no allow/deny-listing, no path
/// jailing) and do not depend on `aphrody-guard`; the only guardrails are the
/// opt-in shell timeout and output cap.
///
/// # Errors
///
/// Returns [`ToolError`] if two tools collide on a name (they never do here, so
/// this only guards against a future addition).
pub fn build_tool_registry(config: &RuntimeConfig) -> Result<Arc<ToolRegistry>, ToolError> {
    let mut registry = ToolRegistry::new();

    let profile = config.tool_profile.as_ref();

    let shell: Arc<dyn ToolExecutor> =
        Arc::new(ShellExecTool::with_config(config.shell.to_shell_config()));
    register_if_allowed(&mut registry, profile, with_default_cwd(shell, config.cwd.as_ref()))?;

    let patch: Arc<dyn ToolExecutor> = Arc::new(ApplyPatchTool::new());
    register_if_allowed(&mut registry, profile, with_default_cwd(patch, config.cwd.as_ref()))?;

    let read_file: Arc<dyn ToolExecutor> = Arc::new(ReadFileTool::new());
    register_if_allowed(&mut registry, profile, with_default_cwd(read_file, config.cwd.as_ref()))?;

    let search_text: Arc<dyn ToolExecutor> = Arc::new(SearchTextTool::new());
    register_if_allowed(
        &mut registry,
        profile,
        with_default_cwd(search_text, config.cwd.as_ref()),
    )?;

    if let Some(computer_use) = desktop_computer_tool(config.computer_use.as_ref()) {
        register_if_allowed(
            &mut registry,
            profile,
            with_default_cwd(computer_use, config.cwd.as_ref()),
        )?;
    }

    // BXC native surface. These tools run in process (aphrody-web-service, the SERP client of
    // aphrody-google) and take no `cwd`, so they are registered unwrapped.
    register_if_allowed(&mut registry, profile, Arc::new(WebSearchTool::new()))?;
    register_if_allowed(&mut registry, profile, Arc::new(WebScrapeTool::new()))?;
    register_if_allowed(&mut registry, profile, Arc::new(JsEvalTool::new()))?;
    register_if_allowed(&mut registry, profile, Arc::new(GoogleAiTool::new()))?;
    register_if_allowed(
        &mut registry,
        profile,
        Arc::new(ComputerTool::browser_with_name(BROWSER_TOOL)),
    )?;

    // Jev typed decisions, only when a Jev backend is configured.
    let mut jev_endpoint = aphrody_config::ai_env::CHAT_BASE_URL.resolve();
    if jev_endpoint.is_none() {
        jev_endpoint = aphrody_llama_server::discover_running(aphrody_llama_server::Role::Chat)
            .map(|server| server.base_url());
    }
    match JevDecideTool::from_env_with_native_endpoint(jev_endpoint.as_deref()) {
        Ok(tool) => register_jev_tool(&mut registry, profile, tool)?,
        Err(error) => tracing::warn!(%error, "jev_decide disabled: invalid Jev configuration"),
    }

    // aphrody's own tools win on a name clash (e.g. `read_file`); the WinClean
    // variant stays reachable through the `winclean` gateway.
    #[cfg(windows)]
    for tool in aphrody_agent_tools::winclean_tools() {
        if profile.is_none_or(|profile| profile.allows_builtin(&tool.definition().name))
            && registry.get(&tool.definition().name).is_none()
        {
            registry.register(tool)?;
        }
    }

    if let Some(profile) = profile {
        if let Some(allowed) = &profile.builtin_tools {
            for name in allowed {
                if registry.get(name).is_none() {
                    return Err(profile_error(format!("unknown built-in tool `{name}`")));
                }
            }
        }
        register_profile_skills(&mut registry, profile)?;
    }

    Ok(Arc::new(registry))
}

/// Register `jev_decide` when a router is available and the profile allows it.
/// Build the desktop `computer_use` tool from the `[computer_use]` policy.
///
/// Returns `None` when the section disables the tool. Without a section the
/// host backend is auto-detected and only the hard-coded security denials
/// apply; with one, the allow/deny lists become the tool's [`ComputerPolicy`]
/// and `environment` selects the backend (an environment this build cannot
/// drive yields a backend that rejects every action, never a mock).
fn desktop_computer_tool(section: Option<&ComputerUseConfig>) -> Option<Arc<dyn ToolExecutor>> {
    let Some(section) = section else {
        return Some(Arc::new(ComputerUseTool::new()));
    };
    if section.enabled == Some(false) {
        return None;
    }
    let policy = ComputerPolicy {
        allowed_apps: section.allowed_apps.clone().unwrap_or_default(),
        denied_apps: section.denied_apps.clone().unwrap_or_default(),
    };
    let mut tool = if section.environment == Some(ComputerUseEnvironment::RemoteVnc) {
        let host = section.endpoint.as_deref().or(section.remote_host.as_deref()).unwrap_or("omar");
        match ComputerTool::remote_vnc(host, None, policy) {
            Ok(tool) => tool,
            Err(e) => {
                tracing::warn!("computer_use: VNC target {host}: {e}");
                return None;
            },
        }
    } else if let Some(host) = &section.remote_host {
        let mut target = RemoteComputerTarget::resolve(host);
        if let Some(distro) = &section.wsl_distribution {
            target = target.with_wsl_distro(distro.clone());
        }
        if let Some(ep) = &section.endpoint {
            target.endpoint = ep.clone();
        }
        match section.environment {
            Some(ComputerUseEnvironment::Wsl | ComputerUseEnvironment::RemoteWsl) => {
                ComputerTool::remote_wsl(target, policy)
            },
            _ => ComputerTool::remote_winclean(target, policy),
        }
    } else {
        let environment = match section.environment {
            Some(ComputerUseEnvironment::Windows) => ComputerEnvironment::Windows,
            Some(ComputerUseEnvironment::Browser) => ComputerEnvironment::Browser,
            Some(ComputerUseEnvironment::Linux) => ComputerEnvironment::Linux,
            Some(ComputerUseEnvironment::Wsl) => ComputerEnvironment::Wsl,
            Some(ComputerUseEnvironment::RemoteWindows) => ComputerEnvironment::RemoteWindows,
            Some(ComputerUseEnvironment::RemoteWsl) => ComputerEnvironment::RemoteWsl,
            Some(ComputerUseEnvironment::RemoteVnc) => ComputerEnvironment::RemoteVnc,
            None => ComputerEnvironment::auto_detect(),
        };
        ComputerTool::for_environment(environment, policy)
    };
    tool.rename(COMPUTER_USE_TOOL);
    Some(Arc::new(tool))
}

fn register_jev_tool(
    registry: &mut ToolRegistry,
    profile: Option<&ToolProfileSpec>,
    tool: Option<JevDecideTool>,
) -> Result<(), ToolError> {
    match tool {
        Some(tool) => register_if_allowed(registry, profile, Arc::new(tool)),
        None => Ok(()),
    }
}

/// Build the exact profiled registry, including asynchronous MCP discovery.
///
/// This function never consults global skill/plugin directories. Its only
/// inputs are the explicit [`ToolProfileSpec`] snapshot carried by `config`.
/// MCP tools keep the stable `mcp__<server>__<tool>` convention; plugin MCP
/// servers additionally receive a `plugin__<plugin>__` namespace.
///
/// # Errors
///
/// Returns a configuration/tool error for invalid or colliding identifiers,
/// or when MCP registry initialization itself fails.
pub async fn build_profiled_tool_registry(
    config: &RuntimeConfig,
) -> Result<Arc<ToolRegistry>, RuntimeError> {
    let mut registry = build_tool_registry(config)?;
    let Some(profile) = config.tool_profile.as_ref() else {
        return Ok(registry);
    };
    let servers = profiled_mcp_servers(profile)?;
    if servers.is_empty() {
        return Ok(registry);
    }

    let catalog = ToolCatalog::new();
    {
        let mutable_registry = Arc::get_mut(&mut registry).ok_or_else(|| {
            RuntimeError::Config("profiled tool registry became shared during assembly".to_owned())
        })?;
        register_selected_mcp_servers(mutable_registry, &catalog, &servers)
            .await
            .map_err(|error| RuntimeError::Config(format!("MCP registry: {error}")))?;
    }
    Ok(registry)
}

#[cfg(test)]
mod jev_wiring_tests {
    use std::sync::Arc;

    use aphrody_jev::{Endpoint, JevRouter, RoutingPolicy};

    use super::*;

    fn tool() -> JevDecideTool {
        let local = Endpoint::local("http://127.0.0.1:9", None).unwrap();
        let router = JevRouter::new(None, None, Some(local), RoutingPolicy::default()).unwrap();
        JevDecideTool::new(Arc::new(router))
    }

    #[test]
    fn configured_router_registers_jev_decide() {
        let mut registry = ToolRegistry::new();
        register_jev_tool(&mut registry, None, Some(tool())).unwrap();
        assert!(registry.get(aphrody_agent_tools::JEV_TOOL).is_some());
    }

    #[test]
    fn missing_router_registers_nothing() {
        let mut registry = ToolRegistry::new();
        register_jev_tool(&mut registry, None, None).unwrap();
        assert!(registry.get(aphrody_agent_tools::JEV_TOOL).is_none());
    }
}

#[cfg(test)]
mod profile_tests {
    use aphrody_config::McpServerTransportConfig;

    use super::*;

    fn disabled_server() -> McpServerConfig {
        McpServerConfig {
            transport: McpServerTransportConfig::Stdio {
                command: "never-spawn".to_owned(),
                args: Vec::new(),
                env: None,
                cwd: None,
            },
            enabled: false,
            startup_timeout_sec: None,
            tool_timeout_sec: None,
            enabled_tools: None,
            disabled_tools: None,
        }
    }

    #[test]
    fn plugin_mcp_servers_are_stably_namespaced() {
        let profile = ToolProfileSpec {
            mcp_servers: BTreeMap::from([("root".to_owned(), disabled_server())]),
            plugins: vec![PluginToolSpec {
                id: "docs".to_owned(),
                mcp_servers: BTreeMap::from([("search".to_owned(), disabled_server())]),
                ..PluginToolSpec::default()
            }],
            ..ToolProfileSpec::default()
        };
        let servers = profiled_mcp_servers(&profile).unwrap();
        assert_eq!(
            servers.keys().map(String::as_str).collect::<Vec<_>>(),
            vec!["plugin__docs__search", "root"]
        );
    }

    #[test]
    fn invalid_profile_identifiers_are_rejected() {
        let profile = ToolProfileSpec {
            plugins: vec![PluginToolSpec { id: "other/profile".to_owned(), ..Default::default() }],
            ..ToolProfileSpec::default()
        };
        let error = profiled_mcp_servers(&profile).unwrap_err();
        assert!(error.to_string().contains("plugin id"));
    }

    #[test]
    fn duplicate_plugin_ids_are_rejected_before_loading_contributions() {
        let profile = ToolProfileSpec {
            plugins: vec![PluginToolSpec::new("same"), PluginToolSpec::new("same")],
            ..ToolProfileSpec::default()
        };
        let error = profiled_mcp_servers(&profile).unwrap_err();
        assert!(error.to_string().contains("duplicate plugin id `same`"));
    }
}

#[cfg(test)]
mod bxc_surface_tests {
    use super::*;

    #[test]
    fn bxc_web_surface_is_registered_by_default() {
        let registry = build_tool_registry(&RuntimeConfig::default()).unwrap();
        for name in BXC_BUILTIN_TOOLS {
            assert!(registry.get(name).is_some(), "built-in `{name}` must be registered");
        }
    }

    #[test]
    fn browser_and_desktop_computer_surfaces_coexist() {
        let registry = build_tool_registry(&RuntimeConfig::default()).unwrap();
        assert!(registry.get(BROWSER_TOOL).is_some(), "browser surface missing");
        assert!(registry.get("computer_use").is_some(), "desktop surface missing");
    }

    #[test]
    fn computer_use_section_can_disable_the_desktop_surface() {
        let section = ComputerUseConfig { enabled: Some(false), ..ComputerUseConfig::default() };
        let config = RuntimeConfig { computer_use: Some(section), ..RuntimeConfig::default() };
        let registry = build_tool_registry(&config).unwrap();
        assert!(registry.get(COMPUTER_USE_TOOL).is_none(), "disabled section must unregister");
        assert!(registry.get(BROWSER_TOOL).is_some(), "browser surface is independent");
    }

    #[tokio::test]
    async fn computer_use_policy_reaches_the_registered_tool() {
        let section = ComputerUseConfig {
            denied_apps: Some(vec!["notepad".to_owned()]),
            environment: Some(ComputerUseEnvironment::Browser),
            ..ComputerUseConfig::default()
        };
        let config = RuntimeConfig { computer_use: Some(section), ..RuntimeConfig::default() };
        let registry = build_tool_registry(&config).unwrap();
        let tool = registry.get(COMPUTER_USE_TOOL).expect("desktop surface registered");
        let output = tool
            .handle(serde_json::json!({ "action": "focus_window", "window_title": "Notepad" }))
            .await
            .unwrap();
        assert!(output.is_error, "denied app must be refused: {output:?}");
    }

    #[cfg(not(windows))]
    #[tokio::test]
    async fn desktop_surface_without_backend_rejects_actions_instead_of_faking_them() {
        let registry = build_tool_registry(&RuntimeConfig::default()).unwrap();
        let tool = registry.get(COMPUTER_USE_TOOL).expect("desktop surface registered");
        let output = tool.handle(serde_json::json!({ "action": "screenshot" })).await.unwrap();
        assert!(output.is_error, "no backend must not produce a screenshot: {output:?}");
    }

    #[test]
    fn a_profile_can_expose_the_bxc_surface_alone() {
        let profile = ToolProfileSpec {
            builtin_tools: Some(BXC_BUILTIN_TOOLS.iter().map(|&n| n.to_owned()).collect()),
            ..ToolProfileSpec::default()
        };
        let config = RuntimeConfig { tool_profile: Some(profile), ..RuntimeConfig::default() };
        let registry = build_tool_registry(&config).unwrap();
        assert!(registry.get("web_search").is_some());
        assert!(registry.get("shell").is_none(), "allow-list must exclude shell");
    }
}
