// SPDX-License-Identifier: Apache-2.0
//! Tool hosts: Bun tool tables served through the single Aphrody MCP server.
//!
//! A tool host is a program with two sub-commands and no MCP server of its own: `<host> list`
//! prints the tool definitions as a JSON array, `<host> call <name> '<json>'` prints one
//! MCP-shaped result (`{"content": [...], "isError": bool}`). `yolo tool` and the M3 package's
//! `tool-host.ts` implement it; the kernel registers each one as a subsystem.

use aphrody_proc::NoWindow as _;
use std::{collections::HashSet, path::PathBuf, process::Stdio, sync::Arc, time::Duration};

use async_trait::async_trait;
use serde_json::Value;

use crate::{SubsystemError, SystemSubsystem, ToolDefinition};

const LIST_TIMEOUT: Duration = Duration::from_secs(20);
const CALL_TIMEOUT: Duration = Duration::from_secs(180);
const MAX_OUTPUT: usize = 8 * 1024 * 1024;

/// A tool host to attach when its program resolves.
pub struct ToolHostSpec<'a> {
    /// Subsystem name in the kernel.
    pub name: &'a str,
    /// Subsystem description.
    pub description: &'a str,
    /// Environment variable naming an explicit command (empty disables the host).
    pub env: &'a str,
    /// Executable looked up when `env` is unset.
    pub binary: &'a str,
    /// Arguments placed before `list` / `call`.
    pub args: &'a [String],
}

/// A discovered tool host exposed as one kernel subsystem.
pub struct ToolHostSubsystem {
    name: String,
    description: String,
    command: PathBuf,
    args: Vec<String>,
    tools: Vec<ToolDefinition>,
}

impl ToolHostSubsystem {
    /// Resolve and list one tool host. A missing optional host is skipped; an explicit `env`
    /// command that fails is an error. Tools already in `occupied` keep their owner.
    pub async fn configured(
        spec: ToolHostSpec<'_>,
        occupied: &HashSet<String>,
    ) -> Result<Option<Arc<dyn SystemSubsystem>>, String> {
        let ToolHostSpec {
            name,
            description,
            env,
            binary,
            args,
        } = spec;
        let explicit = std::env::var(env).ok();
        if explicit
            .as_deref()
            .is_some_and(|value| value.trim().is_empty())
        {
            return Ok(None);
        }
        let (command, args) = match explicit {
            Some(command) => {
                let mut parts = command.split_whitespace().map(str::to_owned);
                let program = parts.next().map(PathBuf::from).unwrap_or_default();
                (program, parts.collect())
            }
            None => match crate::mcp_proxy::installed_binary(binary) {
                Some(path) => (path, args.to_vec()),
                None => return Ok(None),
            },
        };
        let mut host = Self {
            name: name.to_owned(),
            description: description.to_owned(),
            command,
            args,
            tools: Vec::new(),
        };
        let listed = host.run(&["list"], LIST_TIMEOUT).await?;
        let array = listed
            .as_array()
            .ok_or_else(|| format!("tool host {name}: list is not an array"))?;
        for tool in array {
            let definition = crate::mcp_proxy::provider_tool(tool)?;
            if !occupied.contains(&definition.name) {
                host.tools.push(definition);
            }
        }
        Ok((!host.tools.is_empty()).then_some(Arc::new(host) as Arc<dyn SystemSubsystem>))
    }

    async fn run(&self, tail: &[&str], timeout: Duration) -> Result<Value, String> {
        let child = tokio::process::Command::new(&self.command)
            .no_window()
            .args(&self.args)
            .args(tail)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .kill_on_drop(true)
            .spawn()
            .map_err(|error| format!("spawn tool host {}: {error}", self.name))?;
        let output = tokio::time::timeout(timeout, child.wait_with_output())
            .await
            .map_err(|_| format!("tool host {} timed out", self.name))?
            .map_err(|error| format!("tool host {}: {error}", self.name))?;
        if output.stdout.len() > MAX_OUTPUT {
            return Err(format!(
                "tool host {} output exceeds {MAX_OUTPUT} bytes",
                self.name
            ));
        }
        if !output.status.success() {
            return Err(format!(
                "tool host {} exited with {}",
                self.name, output.status
            ));
        }
        serde_json::from_slice(&output.stdout)
            .map_err(|error| format!("tool host {}: invalid JSON: {error}", self.name))
    }
}

#[async_trait]
impl SystemSubsystem for ToolHostSubsystem {
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
        self.run(&["call", tool, &arguments.to_string()], CALL_TIMEOUT)
            .await
            .map_err(SubsystemError::Failed)
    }
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;

    #[tokio::test]
    async fn lists_and_calls_a_host_without_mcp() {
        let dir = tempfile::tempdir().unwrap();
        let script = dir.path().join("host.sh");
        std::fs::write(
            &script,
            r#"case "$1" in
list) echo '[{"name":"probe","description":"d","inputSchema":{"type":"object"}}]' ;;
call) echo "{\"content\":[{\"type\":\"text\",\"text\":\"called $2\"}]}" ;;
esac
"#,
        )
        .unwrap();
        let mut host = ToolHostSubsystem {
            name: "t".into(),
            description: "t".into(),
            command: "sh".into(),
            args: vec![script.to_string_lossy().into_owned()],
            tools: Vec::new(),
        };
        let listed = host.run(&["list"], LIST_TIMEOUT).await.unwrap();
        host.tools
            .push(crate::mcp_proxy::provider_tool(&listed[0]).unwrap());
        let result = host
            .call("probe", serde_json::json!({"a": 1}))
            .await
            .unwrap();
        assert_eq!(result["content"][0]["text"], "called probe");
        assert!(host.call("missing", serde_json::json!({})).await.is_err());
    }
}
