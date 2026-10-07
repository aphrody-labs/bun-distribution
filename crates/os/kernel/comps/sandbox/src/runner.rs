// SPDX-License-Identifier: Apache-2.0
//! Async sandboxed command execution and runner trait.

use std::{path::Path, time::Duration};

use async_trait::async_trait;
use thiserror::Error;
#[cfg(not(target_arch = "wasm32"))]
use tokio::process::Command;

use crate::policy::SandboxPolicy;
#[cfg(not(target_arch = "wasm32"))]
use crate::policy::{NetworkPolicy, SandboxMode};

/// Error returned when running a sandboxed command.
#[derive(Debug, Error)]
pub enum RunnerError {
    #[error("I/O error executing command: {0}")]
    Io(#[from] std::io::Error),
    #[error("Command timed out after {0:?}")]
    TimedOut(Duration),
    #[error("Command execution rejected by policy: {0}")]
    Policy(String),
}

/// The captured output of an executed command.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CommandRunResult {
    /// Exit code of the child process (`-1` if terminated by signal).
    pub exit_code: i32,
    /// Raw combined or stdout output.
    pub stdout: String,
    /// Raw stderr output.
    pub stderr: String,
}

/// Abstract interface for launching commands under sandbox policies.
///
/// Injected into tools like `ShellExecTool` to enable hermetic testing and
/// environment-specific execution strategies.
#[async_trait]
pub trait CommandRunner: Send + Sync {
    /// Run `command` in `cwd` honoring `policy` and `timeout`.
    async fn run(
        &self,
        command: &[String],
        cwd: Option<&Path>,
        policy: &SandboxPolicy,
        timeout: Duration,
    ) -> Result<CommandRunResult, RunnerError>;
}

/// Default standard sandboxed command runner.
#[derive(Clone, Copy, Debug, Default)]
pub struct SandboxedCommandRunner;

impl SandboxedCommandRunner {
    #[must_use]
    pub const fn new() -> Self {
        Self
    }
}

#[cfg(not(target_arch = "wasm32"))]
#[async_trait]
impl CommandRunner for SandboxedCommandRunner {
    async fn run(
        &self,
        command: &[String],
        cwd: Option<&Path>,
        policy: &SandboxPolicy,
        timeout: Duration,
    ) -> Result<CommandRunResult, RunnerError> {
        let Some((prog, rest)) = command.split_first() else {
            return Err(RunnerError::Policy("Command argv cannot be empty".to_string()));
        };
        // configure_command currently provides process grouping only. It does not enforce
        // filesystem or network restrictions, so restricted policies must never spawn.
        if !matches!(policy.mode, SandboxMode::Disabled | SandboxMode::DangerouslyBypass)
            || policy.network == NetworkPolicy::Denied
        {
            return Err(RunnerError::Policy(
                "filesystem/network sandbox enforcement is unavailable for this runner".into(),
            ));
        }

        let mut cmd = Command::new(prog);
        cmd.args(rest);
        if let Some(c) = cwd {
            cmd.current_dir(c);
        }

        // Apply platform sandbox adjustments
        #[cfg(windows)]
        {
            crate::windows::configure_command(cmd.as_std_mut(), policy)?;
        }
        #[cfg(all(unix, not(target_arch = "wasm32")))]
        {
            crate::unix::configure_command(cmd.as_std_mut(), policy)?;
        }

        cmd.stdin(std::process::Stdio::null());
        cmd.stdout(std::process::Stdio::piped());
        cmd.stderr(std::process::Stdio::piped());
        cmd.kill_on_drop(true);

        let fut = async {
            let child = cmd.spawn()?;
            let output = child.wait_with_output().await?;
            Ok(CommandRunResult {
                exit_code: output.status.code().unwrap_or(-1),
                stdout: String::from_utf8_lossy(&output.stdout).into_owned(),
                stderr: String::from_utf8_lossy(&output.stderr).into_owned(),
            })
        };

        match tokio::time::timeout(timeout, fut).await {
            Ok(res) => res.map_err(RunnerError::Io),
            Err(_) => Err(RunnerError::TimedOut(timeout)),
        }
    }
}

#[cfg(target_arch = "wasm32")]
#[async_trait]
impl CommandRunner for SandboxedCommandRunner {
    async fn run(
        &self,
        _command: &[String],
        _cwd: Option<&Path>,
        _policy: &SandboxPolicy,
        _timeout: Duration,
    ) -> Result<CommandRunResult, RunnerError> {
        Err(RunnerError::Policy("Process execution is unsupported on wasm32".to_string()))
    }
}

/// A mock command runner for hermetic test suites.
#[derive(Clone, Debug, Default)]
pub struct MockCommandRunner {
    pub canned_result: Option<CommandRunResult>,
}

#[async_trait]
impl CommandRunner for MockCommandRunner {
    async fn run(
        &self,
        _command: &[String],
        _cwd: Option<&Path>,
        _policy: &SandboxPolicy,
        _timeout: Duration,
    ) -> Result<CommandRunResult, RunnerError> {
        if let Some(res) = &self.canned_result {
            Ok(res.clone())
        } else {
            Ok(CommandRunResult {
                exit_code: 0,
                stdout: "mock output".to_string(),
                stderr: String::new(),
            })
        }
    }
}
