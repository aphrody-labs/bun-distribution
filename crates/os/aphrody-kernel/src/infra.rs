// SPDX-License-Identifier: Apache-2.0
//! Privileged infrastructure and remote control plane subsystem (`infra`).
//!
//! Exposes native SSH execution, SFTP remote filesystem navigation, differential
//! synchronization (`fast_rsync`), and remote Git inspection as kernel tools.

use std::{path::PathBuf, process::Stdio};

use aphrody_subsystem::{SubsystemError, SystemSubsystem, ToolDefinition};
use async_trait::async_trait;
use serde_json::{Value, json};
use tokio::process::Command;

/// The kernel-owned infrastructure control plane.
#[derive(Debug, Default)]
pub struct InfraSubsystem;

impl InfraSubsystem {
    #[must_use]
    pub fn new() -> Self {
        Self
    }
}

fn dirs_home() -> Option<PathBuf> {
    #[cfg(target_os = "windows")]
    {
        std::env::var_os("USERPROFILE").map(PathBuf::from)
    }
    #[cfg(not(target_os = "windows"))]
    {
        std::env::var_os("HOME").map(PathBuf::from)
    }
}

fn find_infra_manifest() -> Option<PathBuf> {
    if let Ok(path) = std::env::var("APHRODY_INFRA_PATH") {
        let p = PathBuf::from(path);
        if p.exists() {
            return Some(p);
        }
    }
    if let Ok(dir) = std::env::var("APHRODY_INFRA_DIR") {
        let p = PathBuf::from(dir).join("Cargo.toml");
        if p.exists() {
            return Some(p);
        }
    }

    if let Ok(cwd) = std::env::current_dir() {
        let sibling = cwd.join("../aphrody-infra/Cargo.toml");
        if sibling.exists() {
            return Some(sibling);
        }
        let direct = cwd.join("aphrody-infra/Cargo.toml");
        if direct.exists() {
            return Some(direct);
        }
    }

    if let Some(home) = dirs_home() {
        let in_src = home.join("src").join("aphrody-infra").join("Cargo.toml");
        if in_src.exists() {
            return Some(in_src);
        }
        let in_home = home.join("aphrody-infra").join("Cargo.toml");
        if in_home.exists() {
            return Some(in_home);
        }
    }

    None
}

fn resolve_infra_invoker() -> Result<(String, Vec<String>), SubsystemError> {
    if let Ok(output) = std::process::Command::new("aphrody-ssh").arg("--version").output() {
        if output.status.success() {
            return Ok(("aphrody-ssh".to_string(), Vec::new()));
        }
    }

    if let Some(manifest) = find_infra_manifest() {
        if let Some(manifest_dir) = manifest.parent() {
            let bin_name = if cfg!(windows) { "aphrody-ssh.exe" } else { "aphrody-ssh" };
            let debug_bin = manifest_dir.join("target").join("debug").join(bin_name);
            if debug_bin.exists() {
                return Ok((debug_bin.to_string_lossy().into_owned(), Vec::new()));
            }
            let release_bin = manifest_dir.join("target").join("release").join(bin_name);
            if release_bin.exists() {
                return Ok((release_bin.to_string_lossy().into_owned(), Vec::new()));
            }
        }

        return Ok((
            "cargo".to_string(),
            vec![
                "run".to_string(),
                "--manifest-path".to_string(),
                manifest.to_string_lossy().into_owned(),
                "-p".to_string(),
                "aphrody-ssh".to_string(),
                "--".to_string(),
            ],
        ));
    }

    Err(SubsystemError::Failed(
        "aphrody-infra manifest or binary not found. Set APHRODY_INFRA_PATH or clone \
         aphrody-infra beside aphrody-os."
            .into(),
    ))
}

#[async_trait]
impl SystemSubsystem for InfraSubsystem {
    fn name(&self) -> &'static str {
        "infra"
    }

    fn description(&self) -> &'static str {
        "Kernel-owned infrastructure control plane: native SSH execution, SFTP filesystem \
         traversal, differential fast-rsync sync and remote Git operations."
    }

    fn tools(&self) -> Vec<ToolDefinition> {
        vec![
            ToolDefinition::new(
                "infra_exec",
                "Execute an arbitrary remote command on an Aphrody infrastructure host (vps or dbfr) via in-process SSH",
                json!({
                    "type": "object",
                    "properties": {
                        "host": {
                            "type": "string",
                            "enum": ["vps", "dbfr"],
                            "description": "Target infrastructure host alias"
                        },
                        "command": {
                            "type": "string",
                            "description": "Command string to execute remotely"
                        }
                    },
                    "required": ["host", "command"]
                }),
            ),
            ToolDefinition::new(
                "infra_sftp_list",
                "List directory entries and metadata (size, permissions, is_dir) on an Aphrody infrastructure host via native SFTP",
                json!({
                    "type": "object",
                    "properties": {
                        "host": {
                            "type": "string",
                            "enum": ["vps", "dbfr"],
                            "description": "Target infrastructure host alias"
                        },
                        "path": {
                            "type": "string",
                            "description": "Remote directory path (defaults to /var/www)"
                        }
                    },
                    "required": ["host"]
                }),
            )
            .read_only(),
            ToolDefinition::new(
                "infra_sftp_read",
                "Read the content of a remote file on an Aphrody infrastructure host via native in-process SFTP",
                json!({
                    "type": "object",
                    "properties": {
                        "host": {
                            "type": "string",
                            "enum": ["vps", "dbfr"],
                            "description": "Target infrastructure host alias"
                        },
                        "path": {
                            "type": "string",
                            "description": "Remote file path to read"
                        }
                    },
                    "required": ["host", "path"]
                }),
            )
            .read_only(),
            ToolDefinition::new(
                "infra_sync",
                "Execute a differential file/directory synchronization with remote infrastructure host (fast-rsync/rclone)",
                json!({
                    "type": "object",
                    "properties": {
                        "host": {
                            "type": "string",
                            "enum": ["vps", "dbfr"],
                            "description": "Target infrastructure host alias"
                        },
                        "source": {
                            "type": "string",
                            "description": "Local source directory path"
                        },
                        "destination": {
                            "type": "string",
                            "description": "Remote destination directory path"
                        },
                        "apply": {
                            "type": "boolean",
                            "description": "Apply transfer changes (defaults to false = dry-run)"
                        }
                    },
                    "required": ["host", "source", "destination"]
                }),
            ),
            ToolDefinition::new(
                "infra_git_status",
                "Inspect the working tree status and recent commits of a production Git repository on an infrastructure host",
                json!({
                    "type": "object",
                    "properties": {
                        "host": {
                            "type": "string",
                            "enum": ["vps", "dbfr"],
                            "description": "Target infrastructure host alias"
                        },
                        "repo_path": {
                            "type": "string",
                            "description": "Remote path to the git repository (e.g. ~/aphrody)"
                        }
                    },
                    "required": ["host", "repo_path"]
                }),
            )
            .read_only(),
        ]
    }

    async fn call(&self, tool: &str, arguments: Value) -> Result<Value, SubsystemError> {
        match tool {
            "infra_exec" => {
                let host = arguments
                    .get("host")
                    .and_then(Value::as_str)
                    .ok_or_else(|| SubsystemError::InvalidArguments("missing host".into()))?;
                let command = arguments
                    .get("command")
                    .and_then(Value::as_str)
                    .ok_or_else(|| SubsystemError::InvalidArguments("missing command".into()))?;

                validate_host(host)?;
                let output =
                    run_infra_cli(&["--json", "exec", "--host", host, "--cmd", command]).await?;
                Ok(output)
            },
            "infra_sftp_list" => {
                let host = arguments
                    .get("host")
                    .and_then(Value::as_str)
                    .ok_or_else(|| SubsystemError::InvalidArguments("missing host".into()))?;
                let path = arguments.get("path").and_then(Value::as_str).unwrap_or("/var/www");

                validate_host(host)?;
                let output =
                    run_infra_cli(&["--json", "sftp", "--host", host, "--path", path]).await?;
                Ok(output)
            },
            "infra_sftp_read" => {
                let host = arguments
                    .get("host")
                    .and_then(Value::as_str)
                    .ok_or_else(|| SubsystemError::InvalidArguments("missing host".into()))?;
                let path = arguments
                    .get("path")
                    .and_then(Value::as_str)
                    .ok_or_else(|| SubsystemError::InvalidArguments("missing path".into()))?;

                validate_host(host)?;
                let output =
                    run_infra_cli(&["--json", "sftp", "--host", host, "--cat", path]).await?;
                Ok(output)
            },
            "infra_sync" => {
                let host = arguments
                    .get("host")
                    .and_then(Value::as_str)
                    .ok_or_else(|| SubsystemError::InvalidArguments("missing host".into()))?;
                let source = arguments
                    .get("source")
                    .and_then(Value::as_str)
                    .ok_or_else(|| SubsystemError::InvalidArguments("missing source".into()))?;
                let destination =
                    arguments.get("destination").and_then(Value::as_str).ok_or_else(|| {
                        SubsystemError::InvalidArguments("missing destination".into())
                    })?;
                let apply = arguments.get("apply").and_then(Value::as_bool).unwrap_or(false);

                validate_host(host)?;
                let mut args = vec![
                    "--json",
                    "sync",
                    "--host",
                    host,
                    "--source",
                    source,
                    "--destination",
                    destination,
                ];
                if apply {
                    args.push("--apply");
                }
                let output = run_infra_cli(&args).await?;
                Ok(output)
            },
            "infra_git_status" => {
                let host = arguments
                    .get("host")
                    .and_then(Value::as_str)
                    .ok_or_else(|| SubsystemError::InvalidArguments("missing host".into()))?;
                let repo_path = arguments
                    .get("repo_path")
                    .and_then(Value::as_str)
                    .ok_or_else(|| SubsystemError::InvalidArguments("missing repo_path".into()))?;

                validate_host(host)?;
                let cmd = format!(
                    "git -C '{repo_path}' status --short --branch && git -C '{repo_path}' log -n \
                     5 --oneline"
                );
                let output =
                    run_infra_cli(&["--json", "exec", "--host", host, "--cmd", &cmd]).await?;
                Ok(output)
            },
            _ => Err(SubsystemError::UnknownTool(tool.to_owned())),
        }
    }
}

fn validate_host(host: &str) -> Result<(), SubsystemError> {
    if host != "vps" && host != "dbfr" {
        return Err(SubsystemError::InvalidArguments("host must be 'vps' or 'dbfr'".into()));
    }
    Ok(())
}

async fn run_infra_cli(args: &[&str]) -> Result<Value, SubsystemError> {
    let (program, mut cmd_args) = resolve_infra_invoker()?;
    for arg in args {
        cmd_args.push((*arg).to_string());
    }

    let output = Command::new(&program)
        .args(&cmd_args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .await
        .map_err(|e| SubsystemError::Failed(format!("failed to spawn {program}: {e}")))?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);

    if !output.status.success() {
        return Err(SubsystemError::Failed(format!(
            "aphrody-ssh failed with exit code {:?}: {}",
            output.status.code(),
            stderr.trim()
        )));
    }

    if let Ok(parsed) = serde_json::from_str::<Value>(&stdout) {
        Ok(parsed)
    } else {
        Ok(json!({
            "stdout": stdout.to_string(),
            "stderr": stderr.to_string(),
            "exit_code": output.status.code().unwrap_or(0),
        }))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn infra_subsystem_declares_tools() {
        let infra = InfraSubsystem::new();
        assert_eq!(infra.name(), "infra");
        let tools = infra.tools();
        assert_eq!(tools.len(), 5);
        let names: Vec<_> = tools.iter().map(|t| t.name.as_str()).collect();
        assert!(names.contains(&"infra_exec"));
        assert!(names.contains(&"infra_sftp_list"));
        assert!(names.contains(&"infra_sftp_read"));
        assert!(names.contains(&"infra_sync"));
        assert!(names.contains(&"infra_git_status"));
    }

    #[tokio::test]
    async fn infra_subsystem_rejects_unknown_host() {
        let infra = InfraSubsystem::new();
        let res =
            infra.call("infra_exec", json!({ "host": "unknown_vps", "command": "uptime" })).await;
        assert!(matches!(res, Err(SubsystemError::InvalidArguments(_))));
    }

    #[tokio::test]
    async fn infra_subsystem_validates_arguments_and_tools() {
        let infra = InfraSubsystem::new();

        // Unknown tool
        let res_unknown = infra.call("nonexistent_tool", json!({})).await;
        assert!(matches!(res_unknown, Err(SubsystemError::UnknownTool(_))));

        // Missing command in infra_exec
        let res_no_cmd = infra.call("infra_exec", json!({ "host": "vps" })).await;
        assert!(matches!(res_no_cmd, Err(SubsystemError::InvalidArguments(_))));

        // Missing path in infra_sftp_read
        let res_no_path = infra.call("infra_sftp_read", json!({ "host": "vps" })).await;
        assert!(matches!(res_no_path, Err(SubsystemError::InvalidArguments(_))));

        // Missing host in infra_sftp_list
        let res_no_host = infra.call("infra_sftp_list", json!({})).await;
        assert!(matches!(res_no_host, Err(SubsystemError::InvalidArguments(_))));

        // Missing destination in infra_sync
        let res_no_dest = infra.call("infra_sync", json!({ "host": "vps", "source": "." })).await;
        assert!(matches!(res_no_dest, Err(SubsystemError::InvalidArguments(_))));

        // Missing repo_path in infra_git_status
        let res_no_repo = infra.call("infra_git_status", json!({ "host": "vps" })).await;
        assert!(matches!(res_no_repo, Err(SubsystemError::InvalidArguments(_))));
    }

    #[test]
    fn validate_host_rules() {
        assert!(validate_host("vps").is_ok());
        assert!(validate_host("dbfr").is_ok());
        assert!(validate_host("unknown").is_err());
        assert!(validate_host("").is_err());
    }
}
