// SPDX-License-Identifier: Apache-2.0
//! Optional stdio MCP provider hosted as a kernel subsystem.

use aphrody_proc::NoWindow as _;
use std::{collections::HashSet, path::PathBuf, process::Stdio, sync::Arc, time::Duration};

use async_trait::async_trait;
use serde_json::{Value, json};
use tokio::{
    io::{AsyncBufRead, AsyncBufReadExt, AsyncWriteExt, BufReader},
    process::{Child, ChildStdin, ChildStdout},
    sync::Mutex,
};

use crate::{SubsystemError, SystemSubsystem, ToolDefinition};

const RPC_TIMEOUT: Duration = Duration::from_secs(60);
const MAX_MCP_FRAME: usize = 64 * 1024 * 1024;

async fn read_frame<R: AsyncBufRead + Unpin>(
    reader: &mut R,
    buffer: &mut Vec<u8>,
    limit: usize,
) -> Result<(), String> {
    loop {
        // The only suspension occurs before modifying the persistent buffer.
        let available = reader.fill_buf().await.map_err(|error| error.to_string())?;
        if available.is_empty() {
            return Err("MCP provider closed stdout".into());
        }
        let newline = available.iter().position(|byte| *byte == b'\n');
        let take = newline.map_or(available.len(), |position| position + 1);
        if take > limit.saturating_sub(buffer.len()) {
            return Err(format!("MCP provider frame exceeds {limit} bytes"));
        }
        buffer.extend_from_slice(&available[..take]);
        reader.consume(take);
        if newline.is_some() {
            return Ok(());
        }
        if buffer.len() == limit {
            return Err(format!("MCP provider frame exceeds {limit} bytes"));
        }
    }
}

struct ProcessState {
    _child: Child,
    stdin: ChildStdin,
    stdout: BufReader<ChildStdout>,
    response_buffer: Vec<u8>,
    next_request_id: u64,
    disconnected: bool,
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
    /// Arguments for the looked-up `binary` (an explicit `env` command runs without them).
    pub args: &'a [String],
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
    /// Resolve an explicitly configured external Aphrody Web provider.
    ///
    /// The canonical `aphrody-mcp` already owns the kernel and Web tools. Auto-spawning
    /// another `aphrody-mcp` here would recurse and duplicate the catalog, so discovery is
    /// intentionally opt-in through `APHRODY_WEB_MCP_BIN`.
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

        Ok(None)
    }

    fn retain_web_tools(&mut self) {
        self.tools.retain(|tool| is_web_provider_tool(&tool.name));
    }

    /// Host a subsystem plugin: the MCP server binary a higher-layer repository ships for a
    /// subsystem this kernel must not link (aphrody-web's `aphrody-browser-mcp`, aphrody-ui's
    /// `aphrody-render3d-mcp`; see docs/REPO-LAYERING.md).
    ///
    /// `env` names an explicit command (empty disables the plugin, a missing binary is an error);
    /// otherwise `binary` is looked up on `PATH`, next to the kernel, then in the user install
    /// directories (`~/.local/bin`, `$CARGO_HOME/bin`, `~/.cargo/bin`, `$APHRODY_HOME/bin`), and
    /// an absent plugin is skipped, so the kernel starts without it. Tools already in `occupied`
    /// keep their owner.
    pub async fn configured_plugin(
        spec: PluginSpec<'_>,
        occupied: &HashSet<String>,
    ) -> Result<Option<Arc<dyn SystemSubsystem>>, String> {
        let PluginSpec {
            name,
            description,
            env,
            binary,
            args,
            child_env,
        } = spec;
        let explicit = std::env::var(env).ok();
        if explicit
            .as_deref()
            .is_some_and(|value| value.trim().is_empty())
        {
            return Ok(None);
        }
        let (path, args) = match explicit.as_ref() {
            Some(command) => (PathBuf::from(command), &[][..]),
            None => match installed_binary(binary) {
                Some(path) => (path, args),
                None => return Ok(None),
            },
        };
        let command = path.to_string_lossy();
        let mut plugin = match Self::spawn_unfiltered(&command, args, child_env).await {
            Ok(plugin) => plugin,
            Err(error) if explicit.is_none() => {
                eprintln!("aphrody-kernel: optional plugin {binary} unavailable: {error}");
                return Ok(None);
            }
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
            .no_window()
            .args(args)
            .envs(
                env.iter()
                    .map(|(key, value)| (key.as_str(), value.as_str())),
            )
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .kill_on_drop(true)
            .spawn()
            .map_err(|error| format!("spawn MCP provider {command}: {error}"))?;
        let stdin = child.stdin.take().ok_or("MCP provider stdin unavailable")?;
        let stdout = child
            .stdout
            .take()
            .ok_or("MCP provider stdout unavailable")?;
        let process = Arc::new(Mutex::new(ProcessState {
            _child: child,
            stdin,
            stdout: BufReader::new(stdout),
            response_buffer: Vec::new(),
            next_request_id: 1,
            disconnected: false,
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
            )
            .await?;
        proxy.notify("notifications/initialized", json!({})).await?;
        let mut params = json!({});
        let mut cursors = HashSet::new();
        let mut names = HashSet::new();
        loop {
            let listed = proxy.request("tools/list", params).await?;
            let tools = listed
                .get("tools")
                .and_then(Value::as_array)
                .ok_or("MCP tools/list response has no tools array")?;
            for tool in tools {
                let definition = provider_tool(tool)?;
                if !names.insert(definition.name.clone()) {
                    return Err(format!(
                        "MCP provider listed duplicate tool: {}",
                        definition.name
                    ));
                }
                proxy.tools.push(definition);
            }
            match listed.get("nextCursor") {
                None | Some(Value::Null) => break,
                Some(Value::String(cursor)) => {
                    if !cursors.insert(cursor.clone()) {
                        return Err("MCP provider repeated a tools/list cursor".into());
                    }
                    params = json!({"cursor": cursor});
                }
                _ => return Err("MCP provider returned an invalid tools/list cursor".into()),
            }
        }
        if proxy.tools.is_empty() {
            return Err("MCP provider returned no tools".into());
        }
        Ok(proxy)
    }

    async fn write_line(state: &mut ProcessState, value: &Value) -> Result<(), String> {
        let mut line = serde_json::to_vec(value).map_err(|error| error.to_string())?;
        line.push(b'\n');
        state
            .stdin
            .write_all(&line)
            .await
            .map_err(|error| error.to_string())?;
        state.stdin.flush().await.map_err(|error| error.to_string())
    }

    async fn request(&self, method: &str, params: Value) -> Result<Value, String> {
        self.request_with_timeout(method, params, RPC_TIMEOUT).await
    }

    async fn request_with_timeout(
        &self,
        method: &str,
        params: Value,
        timeout: Duration,
    ) -> Result<Value, String> {
        // A provider emitting notifications must not extend a request indefinitely.
        // Include queued requests and blocked stdin writes in the same deadline.
        let deadline = tokio::time::Instant::now() + timeout;
        let mut state = tokio::time::timeout_at(deadline, self.process.lock())
            .await
            .map_err(|_| format!("MCP {method} timed out waiting for the provider"))?;
        if state.disconnected {
            return Err("MCP provider disconnected".into());
        }
        let id = state.next_request_id;
        state.next_request_id = id.checked_add(1).ok_or("MCP request ID exhausted")?;
        let result = tokio::time::timeout_at(deadline, async {
            Self::write_line(
                &mut state,
                &json!({"jsonrpc":"2.0","id":id,"method":method,"params":params}),
            )
            .await?;
            loop {
                // Preserve partial framing when the caller cancels this future.
                // A later request can finish and discard the earlier ID's reply.
                let ProcessState {
                    stdout,
                    response_buffer,
                    ..
                } = &mut *state;
                if let Err(error) = read_frame(stdout, response_buffer, MAX_MCP_FRAME).await {
                    state.disconnected = true;
                    let _ = state._child.start_kill();
                    return Err(error);
                }
                let response_buffer = &mut state.response_buffer;
                let response = serde_json::from_slice::<Value>(response_buffer)
                    .map_err(|error| format!("MCP invalid response: {error}"));
                response_buffer.clear();
                let response = response?;
                if response.get("id") == Some(&json!(id)) {
                    if let Some(error) = response.get("error") {
                        return Err(error
                            .get("message")
                            .and_then(Value::as_str)
                            .unwrap_or("MCP error")
                            .into());
                    }
                    return response
                        .get("result")
                        .cloned()
                        .ok_or_else(|| "MCP response has no result".into());
                }
            }
        })
        .await;
        match result {
            Ok(result) => result,
            Err(_) => {
                // An unresponsive provider cannot retain the process indefinitely.
                state.disconnected = true;
                let _ = state._child.start_kill();
                Err(format!("MCP {method} timed out"))
            }
        }
    }

    async fn notify(&self, method: &str, params: Value) -> Result<(), String> {
        let mut state = self.process.lock().await;
        Self::write_line(
            &mut state,
            &json!({"jsonrpc":"2.0","method":method,"params":params}),
        )
        .await
    }
}

pub(crate) fn provider_tool(tool: &Value) -> Result<ToolDefinition, String> {
    let name = tool
        .get("name")
        .and_then(Value::as_str)
        .filter(|name| !name.is_empty())
        .ok_or("MCP provider listed a tool without a name")?;
    let mut definition = ToolDefinition::new(
        name,
        tool.get("description")
            .and_then(Value::as_str)
            .unwrap_or_default(),
        tool.get("inputSchema")
            .cloned()
            .unwrap_or_else(|| json!({"type":"object"})),
    );
    definition.read_only = tool
        .pointer("/annotations/readOnlyHint")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    Ok(definition)
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

/// An installed provider binary, searched in the order of
/// [`crate::paths::binary_search_directories`].
pub(crate) fn installed_binary(name: &str) -> Option<PathBuf> {
    let executable = format!("{name}{}", std::env::consts::EXE_SUFFIX);
    let kernel = std::env::current_exe().ok();
    let home = crate::paths::home_dir();
    crate::paths::binary_search_directories(
        &crate::paths::process_env,
        kernel.as_deref().and_then(|kernel| kernel.parent()),
        home.as_deref(),
    )
    .into_iter()
    .map(|directory| directory.join(&executable))
    .find(|path| path.is_file())
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
        self.request("tools/call", json!({"name":tool,"arguments":arguments}))
            .await
            .map_err(SubsystemError::Failed)
    }
}

#[cfg(test)]
mod tests {
    use std::collections::HashSet;

    use super::{
        McpProxySubsystem, PluginSpec, is_browser_owned, is_web_provider_tool, is_web_tool,
        provider_tool, read_frame,
    };

    #[tokio::test]
    async fn frames_reject_oversize_before_growing_the_buffer_past_limit() {
        let mut reader = tokio::io::BufReader::with_capacity(4, &b"123456789\n"[..]);
        let mut buffer = Vec::new();
        let error = read_frame(&mut reader, &mut buffer, 8).await.unwrap_err();
        assert!(error.contains("exceeds 8 bytes"));
        assert!(buffer.len() <= 8);

        let mut reader = tokio::io::BufReader::with_capacity(4, &b"1234567\nnext\n"[..]);
        buffer.clear();
        read_frame(&mut reader, &mut buffer, 8).await.unwrap();
        assert_eq!(buffer, b"1234567\n");
        buffer.clear();
        read_frame(&mut reader, &mut buffer, 8).await.unwrap();
        assert_eq!(buffer, b"next\n");
    }

    #[test]
    fn provider_metadata_preserves_read_only_annotations() {
        let read = provider_tool(
            &serde_json::json!({"name": "probe", "annotations": {"readOnlyHint": true}}),
        )
        .unwrap();
        assert!(read.read_only);
        assert_eq!(read.to_mcp()["annotations"]["readOnlyHint"], true);
        assert!(
            !provider_tool(&serde_json::json!({"name": "write"}))
                .unwrap()
                .read_only
        );
        assert!(provider_tool(&serde_json::json!({"name": ""})).is_err());
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn discovers_all_pages_and_uses_distinct_call_ids() {
        use crate::SystemSubsystem;
        let dir = tempfile::tempdir().unwrap();
        let script = dir.path().join("provider.sh");
        // A local provider rejects missing pagination, then sends a stale reply
        // before the live response: only the new request ID may be accepted.
        std::fs::write(&script, r#"
read -r request
printf '%s\n' '{"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2025-06-18","capabilities":{"tools":{}}}}'
read -r initialized
read -r request
printf '%s\n' '{"jsonrpc":"2.0","id":2,"result":{"tools":[{"name":"probe","annotations":{"readOnlyHint":true}}],"nextCursor":""}}'
read -r request
case "$request" in *'"cursor":""'*) ;; *) exit 3 ;; esac
printf '%s\n' '{"jsonrpc":"2.0","id":3,"result":{"tools":[{"name":"write"}]}}'
read -r request
printf '%s\n' '{"jsonrpc":"2.0","id":3,"result":{"wrong":true}}' '{"jsonrpc":"2.0","id":4,"result":{"value":41}}'
read -r request
printf '%s\n' '{"jsonrpc":"2.0","id":4,"result":{"wrong":true}}' '{"jsonrpc":"2.0","id":5,"result":{"value":42}}'
"#).unwrap();
        let provider = McpProxySubsystem::spawn("sh", &[script.to_string_lossy().into_owned()])
            .await
            .unwrap();
        assert_eq!(provider.tools().len(), 2);
        assert!(provider.tools()[0].read_only);
        assert!(!provider.tools()[1].read_only);
        assert_eq!(
            provider.call("probe", serde_json::json!({})).await.unwrap()["value"],
            41
        );
        assert_eq!(
            provider.call("probe", serde_json::json!({})).await.unwrap()["value"],
            42
        );
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn notifications_cannot_extend_deadline_or_reuse_timed_out_connection() {
        use crate::SystemSubsystem;
        let dir = tempfile::tempdir().unwrap();
        let script = dir.path().join("provider.sh");
        std::fs::write(
            &script,
            r#"
read -r request
printf '%s\n' '{"jsonrpc":"2.0","id":1,"result":{}}'
read -r initialized
read -r request
printf '%s\n' '{"jsonrpc":"2.0","id":2,"result":{"tools":[{"name":"probe"}]}}'
read -r request
while true; do
printf '%s\n' '{"jsonrpc":"2.0","method":"notifications/progress","params":{}}'
sleep 0.01
done
"#,
        )
        .unwrap();
        let provider = McpProxySubsystem::spawn("sh", &[script.to_string_lossy().into_owned()])
            .await
            .unwrap();
        let error = provider
            .request_with_timeout(
                "tools/call",
                serde_json::json!({"name":"probe"}),
                std::time::Duration::from_millis(100),
            )
            .await
            .unwrap_err();
        assert!(error.contains("timed out"));
        let next = provider
            .call("probe", serde_json::json!({}))
            .await
            .unwrap_err();
        assert!(next.to_string().contains("disconnected"));
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn caller_cancellation_preserves_partial_reply_framing() {
        use crate::SystemSubsystem;
        let dir = tempfile::tempdir().unwrap();
        let script = dir.path().join("provider.sh");
        std::fs::write(
            &script,
            r#"
read -r request
printf '%s\n' '{"jsonrpc":"2.0","id":1,"result":{}}'
read -r initialized
read -r request
printf '%s\n' '{"jsonrpc":"2.0","id":2,"result":{"tools":[{"name":"probe"}]}}'
read -r request
printf '%s' '{"jsonrpc":"2.0","id":3,'
sleep 0.1
printf '%s\n' '"result":{"value":41}}'
read -r request
printf '%s\n' '{"jsonrpc":"2.0","id":4,"result":{"value":42}}'
"#,
        )
        .unwrap();
        let provider = McpProxySubsystem::spawn("sh", &[script.to_string_lossy().into_owned()])
            .await
            .unwrap();
        let cancelled = tokio::time::timeout(
            std::time::Duration::from_millis(50),
            provider.call("probe", serde_json::json!({})),
        )
        .await;
        assert!(cancelled.is_err());
        assert_eq!(
            provider.call("probe", serde_json::json!({})).await.unwrap()["value"],
            42
        );
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn rejects_repeating_pagination_cursor() {
        let dir = tempfile::tempdir().unwrap();
        let script = dir.path().join("provider.sh");
        std::fs::write(
            &script,
            r#"
read -r request
printf '%s\n' '{"jsonrpc":"2.0","id":1,"result":{}}'
read -r initialized
read -r request
printf '%s\n' '{"jsonrpc":"2.0","id":2,"result":{"tools":[],"nextCursor":"again"}}'
read -r request
printf '%s\n' '{"jsonrpc":"2.0","id":3,"result":{"tools":[],"nextCursor":"again"}}'
"#,
        )
        .unwrap();
        let error = McpProxySubsystem::spawn("sh", &[script.to_string_lossy().into_owned()])
            .await
            .err()
            .unwrap();
        assert!(error.contains("repeated a tools/list cursor"));
    }

    #[test]
    fn explicit_web_provider_accepts_only_web_provider_tools() {
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
            args: &[],
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
        assert!(
            McpProxySubsystem::configured_provider(Some(command.into()))
                .await
                .is_err()
        );
    }
}
