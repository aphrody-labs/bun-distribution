// SPDX-License-Identifier: Apache-2.0
//! Optional stdio MCP provider hosted as a kernel subsystem.

use std::{collections::HashSet, path::PathBuf, process::Stdio, sync::Arc, time::Duration};

use async_trait::async_trait;
use serde_json::{Value, json};
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader},
    process::{Child, ChildStdin, ChildStdout},
    sync::Mutex,
};

use crate::{SubsystemError, SystemSubsystem, ToolDefinition};

const RPC_TIMEOUT: Duration = Duration::from_secs(60);
const AUTO_DISCOVERY_TIMEOUT: Duration = Duration::from_secs(10);

struct ProcessState {
    _child: Child,
    stdin: ChildStdin,
    stdout: BufReader<ChildStdout>,
}

/// A subsystem plugin: an MCP server binary shipped by a higher-layer repository.
pub struct PluginSpec<'a> {
    /// Subsystem name in the kernel.
    pub name: &'a str,
    /// Subsystem description.
    pub description: &'a str,
    /// Environment variable naming an explicit command (empty disables the plugin).
    pub env: &'a str,
    /// Executable name looked up when `env` is unset.
    pub binary: &'a str,
    /// Extra environment for the plugin process.
    pub child_env: &'a [(String, String)],
}

/// A dynamically discovered MCP server exposed as one kernel subsystem.
pub struct McpProxySubsystem {
    name: String,
    description: String,
    tools: Vec<ToolDefinition>,
    process: Arc<Mutex<ProcessState>>,
}

impl McpProxySubsystem {
    /// Resolve the optional Aphrody Web provider once for a composite web subsystem.
    /// An explicit command remains authoritative; otherwise use an installed provider.
    pub async fn configured_provider(
        command: Option<String>,
    ) -> Result<Option<Arc<dyn SystemSubsystem>>, String> {
        let command = command.or_else(|| std::env::var("APHRODY_WEB_MCP_BIN").ok());
        if let Some(command) = command {
            // An empty explicit value keeps the existing way to disable the provider.
            if command.trim().is_empty() {
                return Ok(None);
            }
            let args: Vec<String> = std::env::var("APHRODY_WEB_MCP_ARGS")
                .ok()
                .map(|value| value.split_whitespace().map(str::to_owned).collect())
                .unwrap_or_default();
            return Self::spawn(&command, &args).await.and_then(|mut provider| {
                provider.retain_web_tools();
                if provider.tools.is_empty() {
                    return Err("explicit Aphrody Web MCP provider returned no Web tools".into());
                }
                Ok(Some(Arc::new(provider) as Arc<dyn SystemSubsystem>))
            });
        }

        // The browser's backend exposes its full live tool catalog. Its plain
        // `mcp` command delegates to aphrody-mcp, so request the backend here.
        // The unified MCP binary remains an optional fallback.
        for (name, args) in
            [("aphrody-web-browser", &["mcp", "--backend"][..]), ("aphrody-mcp", &["server"][..])]
        {
            let Some(path) = installed_binary(name) else {
                continue;
            };
            let Some(path) = path.to_str() else {
                continue;
            };
            let args: Vec<String> = args.iter().map(|arg| (*arg).to_owned()).collect();
            match tokio::time::timeout(AUTO_DISCOVERY_TIMEOUT, Self::spawn(path, &args)).await {
                Ok(Ok(mut provider)) if provider.has_web_tools() => {
                    provider.retain_web_tools();
                    return Ok(Some(Arc::new(provider) as Arc<dyn SystemSubsystem>));
                },
                Ok(Ok(_)) => eprintln!("aphrody-kernel: {name} has no Aphrody Web tools"),
                Ok(Err(error)) => {
                    eprintln!("aphrody-kernel: optional {name} unavailable: {error}")
                },
                Err(_) => eprintln!("aphrody-kernel: optional {name} timed out during discovery"),
            }
        }
        Ok(None)
    }

    fn has_web_tools(&self) -> bool {
        self.tools.iter().any(|tool| is_web_tool(&tool.name))
    }

    fn retain_web_tools(&mut self) {
        self.tools.retain(|tool| is_web_provider_tool(&tool.name));
    }

    /// Expose the AI-owned MCP catalog through the local OS kernel. The AI
    /// server remains a separate process, so this repository never links it.
    pub async fn configured_ai_provider(
        occupied: &HashSet<String>,
    ) -> Result<Option<Arc<dyn SystemSubsystem>>, String> {
        let explicit = std::env::var("APHRODY_AI_MCP_BIN").ok();
        if explicit.as_deref().is_some_and(|value| value.trim().is_empty()) {
            return Ok(None);
        }
        let path = match explicit.as_ref() {
            Some(command) => PathBuf::from(command),
            None => match installed_binary("aphrody-mcp") {
                Some(path) => path,
                None => return Ok(None),
            },
        };
        let command = path.to_string_lossy();
        let args = ["server".to_owned()];
        let discovery = tokio::time::timeout(AUTO_DISCOVERY_TIMEOUT, Self::spawn(&command, &args))
            .await
            .map_err(|_| "Aphrody AI MCP discovery timed out".to_owned())
            .and_then(|result| result);
        let mut provider = match discovery {
            Ok(provider) => provider,
            Err(error) if explicit.is_none() => {
                eprintln!("aphrody-kernel: optional Aphrody AI MCP unavailable: {error}");
                return Ok(None);
            },
            Err(error) => return Err(error),
        };
        provider.name = "aphrody-ai".into();
        provider.description = "Aphrody AI MCP tools from the separate agent process.".into();
        provider
            .tools
            .retain(|tool| !is_web_provider_tool(&tool.name) && !occupied.contains(&tool.name));
        Ok((!provider.tools.is_empty()).then_some(Arc::new(provider) as Arc<dyn SystemSubsystem>))
    }

    /// Host a subsystem plugin: the MCP server binary a higher-layer repository ships for a
    /// subsystem this kernel must not link (aphrody-web's `aphrody-browser-mcp`, aphrody-ui's
    /// `aphrody-render3d-mcp`; see aphrody-infra/docs/REPO-LAYERING.md).
    ///
    /// `env` names an explicit command (empty disables the plugin, a missing binary is an error);
    /// otherwise `binary` is looked up next to the kernel, on `PATH`, then in `~/.local/bin` and
    /// `~/.cargo/bin`, and an absent plugin is skipped. Tools already in `occupied` keep their
    /// owner.
    pub async fn configured_plugin(
        spec: PluginSpec<'_>,
        occupied: &HashSet<String>,
    ) -> Result<Option<Arc<dyn SystemSubsystem>>, String> {
        let PluginSpec { name, description, env, binary, child_env } = spec;
        let explicit = std::env::var(env).ok();
        if explicit.as_deref().is_some_and(|value| value.trim().is_empty()) {
            return Ok(None);
        }
        let path = match explicit.as_ref() {
            Some(command) => PathBuf::from(command),
            None => match installed_binary(binary) {
                Some(path) => path,
                None => return Ok(None),
            },
        };
        let command = path.to_string_lossy();
        let mut plugin = match Self::spawn_unfiltered(&command, &[], child_env).await {
            Ok(plugin) => plugin,
            Err(error) if explicit.is_none() => {
                eprintln!("aphrody-kernel: optional plugin {binary} unavailable: {error}");
                return Ok(None);
            },
            Err(error) => return Err(error),
        };
        name.clone_into(&mut plugin.name);
        description.clone_into(&mut plugin.description);
        plugin.tools.retain(|tool| !occupied.contains(&tool.name));
        Ok((!plugin.tools.is_empty()).then_some(Arc::new(plugin) as Arc<dyn SystemSubsystem>))
    }

    /// Spawn an MCP stdio server, complete the handshake and discover its tools. Tools owned by
    /// the browser subsystem (`browser_*`, `web_fetch`, ...) are dropped.
    pub async fn spawn(command: &str, args: &[String]) -> Result<Self, String> {
        let mut proxy = Self::spawn_unfiltered(command, args, &[]).await?;
        proxy.tools.retain(|tool| !is_browser_owned(&tool.name));
        if proxy.tools.is_empty() {
            return Err("MCP provider returned no tools".into());
        }
        Ok(proxy)
    }

    /// Spawn an MCP stdio server and keep every tool it lists.
    async fn spawn_unfiltered(
        command: &str,
        args: &[String],
        env: &[(String, String)],
    ) -> Result<Self, String> {
        let mut child = tokio::process::Command::new(command)
            .args(args)
            .envs(env.iter().map(|(key, value)| (key.as_str(), value.as_str())))
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .kill_on_drop(true)
            .spawn()
            .map_err(|error| format!("spawn MCP provider {command}: {error}"))?;
        let stdin = child.stdin.take().ok_or("MCP provider stdin unavailable")?;
        let stdout = child.stdout.take().ok_or("MCP provider stdout unavailable")?;
        let process = Arc::new(Mutex::new(ProcessState {
            _child: child,
            stdin,
            stdout: BufReader::new(stdout),
        }));
        let proxy = Self {
            name: "aphrody-web".into(),
            description: "Aphrody Web Browser MCP provider.".into(),
            tools: Vec::new(),
            process,
        };
        let mut proxy = proxy;
        proxy
            .request(
                "initialize",
                json!({
                    "protocolVersion": "2025-06-18",
                    "capabilities": {},
                    "clientInfo": {"name": "aphrody-os", "version": env!("CARGO_PKG_VERSION")}
                }),
                1,
            )
            .await?;
        proxy.notify("notifications/initialized", json!({})).await?;
        let listed = proxy.request("tools/list", json!({}), 2).await?;
        proxy.tools = listed
            .pointer("/tools")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter_map(|tool| {
                let name = tool.get("name")?.as_str()?.to_owned();
                let schema =
                    tool.get("inputSchema").cloned().unwrap_or_else(|| json!({"type":"object"}));
                Some(ToolDefinition::new(
                    name,
                    tool.get("description").and_then(Value::as_str).unwrap_or_default(),
                    schema,
                ))
            })
            .collect();
        if proxy.tools.is_empty() {
            return Err("MCP provider returned no tools".into());
        }
        Ok(proxy)
    }

    async fn write_line(state: &mut ProcessState, value: &Value) -> Result<(), String> {
        let mut line = serde_json::to_vec(value).map_err(|error| error.to_string())?;
        line.push(b'\n');
        state.stdin.write_all(&line).await.map_err(|error| error.to_string())?;
        state.stdin.flush().await.map_err(|error| error.to_string())
    }

    async fn request(&self, method: &str, params: Value, id: u64) -> Result<Value, String> {
        let mut state = self.process.lock().await;
        Self::write_line(
            &mut state,
            &json!({"jsonrpc":"2.0","id":id,"method":method,"params":params}),
        )
        .await?;
        loop {
            let mut line = String::new();
            let read = tokio::time::timeout(RPC_TIMEOUT, state.stdout.read_line(&mut line))
                .await
                .map_err(|_| format!("MCP {method} timed out"))?
                .map_err(|error| error.to_string())?;
            if read == 0 {
                return Err("MCP provider closed stdout".into());
            }
            let response: Value = serde_json::from_str(line.trim())
                .map_err(|error| format!("MCP invalid response: {error}"))?;
            if response.get("id") == Some(&json!(id)) {
                if let Some(error) = response.get("error") {
                    return Err(error
                        .get("message")
                        .and_then(Value::as_str)
                        .unwrap_or("MCP error")
                        .into());
                }
                return Ok(response.get("result").cloned().unwrap_or(Value::Null));
            }
        }
    }

    async fn notify(&self, method: &str, params: Value) -> Result<(), String> {
        let mut state = self.process.lock().await;
        Self::write_line(&mut state, &json!({"jsonrpc":"2.0","method":method,"params":params}))
            .await
    }
}

/// Obscura (the browser subsystem) owns these kernel names; keep one owner per tool.
fn is_browser_owned(name: &str) -> bool {
    name == "aphrody_google_fetch"
        || name.starts_with("aphrody_browser_")
        || name == "web_fetch"
        || name == "google_search"
        || name == "gemini_web_navigate"
        || name.starts_with("browser_")
}

fn is_web_tool(name: &str) -> bool {
    name.starts_with("aphrody_web_") || name.starts_with("bxc_")
}

fn is_web_provider_tool(name: &str) -> bool {
    is_web_tool(name) || name.starts_with("web_")
}

fn installed_binary(name: &str) -> Option<PathBuf> {
    let executable = format!("{name}{}", std::env::consts::EXE_SUFFIX);
    let mut directories = Vec::new();
    if let Some(path) = std::env::var_os("PATH") {
        directories.extend(std::env::split_paths(&path));
    }
    if let Ok(kernel) = std::env::current_exe()
        && let Some(parent) = kernel.parent()
    {
        directories.push(parent.to_path_buf());
    }
    if let Some(home) = std::env::var_os("USERPROFILE").or_else(|| std::env::var_os("HOME")) {
        let home = PathBuf::from(home);
        directories.push(home.join(".local").join("bin"));
        directories.push(home.join(".cargo").join("bin"));
    }
    directories.into_iter().map(|directory| directory.join(&executable)).find(|path| path.is_file())
}

#[cfg(test)]
mod tests {
    use std::collections::HashSet;

    use super::{
        McpProxySubsystem, PluginSpec, is_browser_owned, is_web_provider_tool, is_web_tool,
    };

    #[test]
    fn auto_discovery_accepts_only_web_provider_tools() {
        assert!(is_web_tool("aphrody_web_call"));
        assert!(is_web_tool("bxc_actor_list"));
        assert!(!is_web_tool("aphrody_rag_search"));
        assert!(!is_web_tool("browser_navigate"));
        assert!(is_web_provider_tool("web_browser_autopilot_start"));
        assert!(!is_web_provider_tool("aphrody_rag_search"));
    }

    #[test]
    fn browser_owned_tools_are_not_proxied_by_providers() {
        assert!(is_browser_owned("browser_navigate"));
        assert!(is_browser_owned("web_fetch"));
        assert!(!is_browser_owned("aphrody_web_call"));
    }

    #[tokio::test]
    async fn plugins_are_disabled_by_an_empty_command_and_skipped_when_absent() {
        let occupied = HashSet::new();
        let spec = |env| PluginSpec {
            name: "test",
            description: "test plugin",
            env,
            binary: "aphrody-kernel-no-such-plugin-5b1e0c7d",
            child_env: &[],
        };
        // PATH lookup finds no such binary: an optional plugin is skipped, not an error.
        let absent = McpProxySubsystem::configured_plugin(
            spec("APHRODY_KERNEL_TEST_PLUGIN_UNSET_5b1e0c7d"),
            &occupied,
        )
        .await
        .expect("absent optional plugin is skipped");
        assert!(absent.is_none());
    }

    #[tokio::test]
    async fn empty_explicit_command_disables_auto_discovery() {
        let provider = McpProxySubsystem::configured_provider(Some(String::new()))
            .await
            .expect("empty command disables provider");
        assert!(provider.is_none());
    }

    #[tokio::test]
    async fn explicit_missing_provider_still_reports_an_error() {
        let command = "aphrody-kernel-no-such-mcp-provider-46a80fb9";
        assert!(McpProxySubsystem::configured_provider(Some(command.into())).await.is_err());
    }
}

#[async_trait]
impl SystemSubsystem for McpProxySubsystem {
    fn name(&self) -> &str {
        &self.name
    }
    fn description(&self) -> &str {
        &self.description
    }
    fn tools(&self) -> Vec<ToolDefinition> {
        self.tools.clone()
    }
    async fn call(&self, tool: &str, arguments: Value) -> Result<Value, SubsystemError> {
        if !self.tools.iter().any(|definition| definition.name == tool) {
            return Err(SubsystemError::UnknownTool(tool.into()));
        }
        self.request("tools/call", json!({"name":tool,"arguments":arguments}), 100)
            .await
            .map_err(SubsystemError::Failed)
    }
}
