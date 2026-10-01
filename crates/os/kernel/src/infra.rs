// SPDX-License-Identifier: Apache-2.0
//! Privileged infrastructure and remote control plane subsystem (`infra`).
//!
//! Exposes native SSH execution, SFTP remote filesystem navigation, differential
//! synchronization (`fast_rsync`), and remote Git inspection as kernel tools.

use std::{
    path::{Path, PathBuf},
    process::Stdio,
};

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
        if p.is_file() {
            return Some(p);
        }
    }
    if let Ok(dir) = std::env::var("APHRODY_INFRA_DIR") {
        let p = PathBuf::from(dir).join("Cargo.toml");
        if p.is_file() {
            return Some(p);
        }
    }

    let cwd = std::env::current_dir().ok();
    let executable = std::env::current_exe().ok();
    find_workspace_manifest(cwd.as_deref(), executable.as_deref(), dirs_home().as_deref())
}

// Keep this independent of process environment so relocated clean clones and service
// launches can be tested without changing environment variables in parallel tests.
fn find_workspace_manifest(
    cwd: Option<&Path>,
    executable: Option<&Path>,
    home: Option<&Path>,
) -> Option<PathBuf> {
    for start in cwd.into_iter().chain(executable.and_then(Path::parent)) {
        for root in start.ancestors() {
            let manifest = root.join("Cargo.toml");
            if manifest.is_file() && root.join("crates/infra/ssh/Cargo.toml").is_file() {
                return Some(manifest);
            }
        }
    }
    if let Some(home) = home {
        let root = home.join("aphrody");
        let manifest = root.join("Cargo.toml");
        if manifest.is_file() && root.join("crates/infra/ssh/Cargo.toml").is_file() {
            return Some(manifest);
        }
    }

    None
}

fn resolve_infra_invoker() -> Result<(String, Vec<String>), SubsystemError> {
    if let Ok(output) = std::process::Command::new("aphrody-ssh").arg("--version").output()
        && output.status.success()
    {
        return Ok(("aphrody-ssh".to_string(), Vec::new()));
    }

    if let Ok(executable) = std::env::current_exe()
        && let Some(directory) = executable.parent()
    {
        let binary = directory.join(format!("aphrody-ssh{}", std::env::consts::EXE_SUFFIX));
        if binary.is_file() {
            return Ok((binary.to_string_lossy().into_owned(), Vec::new()));
        }
    }

    if std::env::var("APHRODY_INFRA_BUILD_FROM_SOURCE").as_deref() == Ok("1")
        && let Some(manifest) = find_infra_manifest()
        && let Some(invoker) = workspace_infra_invoker(&manifest, true)
    {
        return Ok(invoker);
    }

    Err(SubsystemError::Failed(
        "aphrody-ssh binary or workspace manifest not found. Install aphrody-ssh beside \
         aphrody-kernel or explicitly enable APHRODY_INFRA_BUILD_FROM_SOURCE=1 for development."
            .into(),
    ))
}

fn workspace_infra_invoker(manifest: &Path, allow_source: bool) -> Option<(String, Vec<String>)> {
    if !allow_source {
        return None;
    }
    if let Some(manifest_dir) = manifest.parent() {
        let bin_name = if cfg!(windows) { "aphrody-ssh.exe" } else { "aphrody-ssh" };
        let debug_bin = manifest_dir.join("target").join("debug").join(bin_name);
        let release_bin = manifest_dir.join("target").join("release").join(bin_name);
        if release_bin.is_file() {
            return Some((release_bin.to_string_lossy().into_owned(), Vec::new()));
        }
        if debug_bin.is_file() {
            return Some((debug_bin.to_string_lossy().into_owned(), Vec::new()));
        }
    }

    Some((
        "cargo".to_string(),
        vec![
            "run".to_string(),
            "--locked".to_string(),
            "--manifest-path".to_string(),
            manifest.to_string_lossy().into_owned(),
            "-p".to_string(),
            "aphrody-ssh".to_string(),
            "--".to_string(),
        ],
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
                let cmd = git_status_command(repo_path)?;
                let output =
                    run_infra_cli(&["--json", "exec", "--host", host, "--cmd", &cmd]).await?;
                Ok(output)
            },
            _ => Err(SubsystemError::UnknownTool(tool.to_owned())),
        }
    }
}

fn git_status_command(repo_path: &str) -> Result<String, SubsystemError> {
    if repo_path.is_empty() || repo_path.contains('\0') {
        return Err(SubsystemError::InvalidArguments(
            "repo_path must be nonempty and contain no NUL".into(),
        ));
    }
    let quote = |value: &str| format!("'{}'", value.replace('\'', "'\"'\"'"));
    // Expand only the documented home shorthand, keeping the rest a literal
    // shell argument even when names contain quotes, spaces or shell operators.
    let path = if repo_path == "~" {
        "\"$HOME\"".to_owned()
    } else if let Some(relative) = repo_path.strip_prefix("~/") {
        format!("\"$HOME\"/{}", quote(relative))
    } else {
        quote(repo_path)
    };
    Ok(format!("git -C {path} status --short --branch && git -C {path} log -n 5 --oneline"))
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

    #[test]
    fn discovers_relocated_workspace_from_nested_cwd_and_kernel() {
        let dir = tempfile::tempdir().expect("tempdir");
        let root = dir.path().join("relocated");
        std::fs::create_dir_all(root.join("crates/infra/ssh")).unwrap();
        std::fs::write(root.join("Cargo.toml"), "[workspace]\n").unwrap();
        std::fs::write(root.join("crates/infra/ssh/Cargo.toml"), "[package]\n").unwrap();
        let expected = Some(root.join("Cargo.toml"));
        assert_eq!(
            find_workspace_manifest(Some(&root.join("docs/reference")), None, None),
            expected
        );
        assert_eq!(
            find_workspace_manifest(None, Some(&root.join("target/release/aphrody-kernel")), None),
            expected
        );
        assert_eq!(find_workspace_manifest(Some(dir.path()), None, None), None);
    }

    #[test]
    fn workspace_manifest_never_triggers_an_implicit_build() {
        let dir = tempfile::tempdir().expect("tempdir");
        let manifest = dir.path().join("Cargo.toml");
        std::fs::write(&manifest, "[workspace]\n").unwrap();
        assert_eq!(workspace_infra_invoker(&manifest, false), None);
        let (command, args) = workspace_infra_invoker(&manifest, true).unwrap();
        assert_eq!(command, "cargo");
        assert!(args.contains(&"--locked".to_owned()));
        assert!(args.contains(&manifest.to_string_lossy().into_owned()));
    }

    #[test]
    fn home_fallback_requires_current_owner_layout() {
        let dir = tempfile::tempdir().expect("tempdir");
        let root = dir.path().join("aphrody");
        std::fs::create_dir_all(&root).unwrap();
        std::fs::write(root.join("Cargo.toml"), "[workspace]\n").unwrap();
        assert_eq!(find_workspace_manifest(None, None, Some(dir.path())), None);
        std::fs::create_dir_all(root.join("crates/infra/ssh")).unwrap();
        std::fs::write(root.join("crates/infra/ssh/Cargo.toml"), "[package]\n").unwrap();
        assert_eq!(
            find_workspace_manifest(None, None, Some(dir.path())),
            Some(root.join("Cargo.toml"))
        );
    }

    #[test]
    fn legacy_archives_are_not_automatically_discovered() {
        let dir = tempfile::tempdir().expect("tempdir");
        let legacy = dir.path().join("src/aphrody-infra");
        std::fs::create_dir_all(legacy.join("crates/aphrody-ssh")).unwrap();
        std::fs::write(legacy.join("Cargo.toml"), "[workspace]\n").unwrap();
        std::fs::write(legacy.join("crates/aphrody-ssh/Cargo.toml"), "[package]\n").unwrap();
        assert_eq!(find_workspace_manifest(Some(&legacy), None, None), None);
        assert_eq!(find_workspace_manifest(None, None, Some(dir.path())), None);
    }

    #[cfg(unix)]
    #[test]
    fn git_status_handles_literal_paths_and_home_shorthand() {
        let dir = tempfile::tempdir().expect("tempdir");
        for relative in ["quoted ' name", "repo' ; touch INJECTED ; #", "ordinary"] {
            let repository = dir.path().join(relative);
            std::fs::create_dir(&repository).unwrap();
            assert!(
                std::process::Command::new("git")
                    .args(["init", "--quiet"])
                    .arg(&repository)
                    .status()
                    .unwrap()
                    .success()
            );
            // A missing HEAD makes log fail; status must still run for the correct path.
            for path in [repository.to_string_lossy().into_owned(), format!("~/{relative}")] {
                let output = std::process::Command::new("sh")
                    .arg("-c")
                    .arg(git_status_command(&path).unwrap())
                    .env("HOME", dir.path())
                    .current_dir(dir.path())
                    .output()
                    .unwrap();
                assert!(String::from_utf8_lossy(&output.stdout).contains("## No commits yet"));
                assert!(!dir.path().join("INJECTED").exists());
            }
        }
        assert!(git_status_command("").is_err());
        assert!(git_status_command("repo\0path").is_err());
    }

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
