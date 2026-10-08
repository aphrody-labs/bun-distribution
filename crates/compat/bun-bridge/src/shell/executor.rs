// SPDX-License-Identifier: Apache-2.0
//! In-process pipeline executor inspired by `bun_runtime::shell::interpreter`.
//!
//! Executes pipelines with zero fork/exec when all commands are builtins,
//! and seamlessly bridges to external child processes when needed.

use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command as ProcessCommand, Stdio};
use std::time::Instant;

use super::ast::{Command, Op, Pipeline, Redirection, Script};
use super::builtins::{BuiltinContext, is_builtin, run_builtin};
use super::parser::parse_script;

/// Result of evaluating a Bun Shell script or pipeline.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct BunShellOutput {
    /// Exit status code (0 for success).
    pub exit_code: i32,
    /// Stdout text output.
    pub stdout: String,
    /// Stderr text output.
    pub stderr: String,
    /// Execution wall time in milliseconds.
    pub duration_ms: f64,
    /// Whether the execution ran purely in-process without fork/exec.
    pub in_process: bool,
}

/// Pipeline executor state.
pub struct BunShellExecutor {
    /// Active working directory.
    pub cwd: PathBuf,
}

impl Default for BunShellExecutor {
    fn default() -> Self {
        Self {
            cwd: std::env::current_dir().unwrap_or_else(|_| PathBuf::from(".")),
        }
    }
}

impl BunShellExecutor {
    /// Create a new executor rooted at `cwd`.
    pub fn new(cwd: &Path) -> Self {
        Self {
            cwd: cwd.to_path_buf(),
        }
    }

    /// Execute a shell script string and return the result.
    pub fn execute(&mut self, script_str: &str) -> Result<BunShellOutput, String> {
        let script = parse_script(script_str)?;
        self.run_script(&script)
    }

    /// Execute a parsed `Script` AST.
    pub fn run_script(&mut self, script: &Script) -> Result<BunShellOutput, String> {
        let start = Instant::now();
        let mut last_code = 0;
        let mut total_stdout = Vec::new();
        let mut total_stderr = Vec::new();
        let mut purely_in_process = true;

        let mut iter = script.pipelines.iter().peekable();
        while let Some((pipeline, op)) = iter.next() {
            let mut pipe_stdout = Vec::new();
            let mut pipe_stderr = Vec::new();

            let (code, in_proc) = self.run_pipeline(pipeline, &mut pipe_stdout, &mut pipe_stderr)?;
            last_code = code;
            if !in_proc {
                purely_in_process = false;
            }

            total_stdout.extend(pipe_stdout);
            total_stderr.extend(pipe_stderr);

            // Handle control operators
            if let Some(operator) = op {
                match operator {
                    Op::And => {
                        if last_code != 0 {
                            // Skip subsequent pipeline chained by AND
                            break;
                        }
                    }
                    Op::Or => {
                        if last_code == 0 {
                            // Skip subsequent pipeline chained by OR
                            break;
                        }
                    }
                    Op::Seq => {
                        // Continue unconditionally
                    }
                }
            }
        }

        let duration_ms = start.elapsed().as_secs_f64() * 1000.0;
        let stdout = String::from_utf8_lossy(&total_stdout).into_owned();
        let stderr = String::from_utf8_lossy(&total_stderr).into_owned();

        Ok(BunShellOutput {
            exit_code: last_code,
            stdout,
            stderr,
            duration_ms,
            in_process: purely_in_process,
        })
    }

    fn run_pipeline(
        &mut self,
        pipeline: &Pipeline,
        final_stdout: &mut Vec<u8>,
        final_stderr: &mut Vec<u8>,
    ) -> Result<(i32, bool), String> {
        if pipeline.commands.is_empty() {
            return Ok((0, true));
        }

        let mut current_stdin = Vec::new();
        let mut last_code = 0;
        let mut all_in_proc = true;
        let total_cmds = pipeline.commands.len();

        for (idx, cmd) in pipeline.commands.iter().enumerate() {
            let is_last = idx == total_cmds - 1;
            let mut cmd_stdout = Vec::new();
            let mut cmd_stderr = Vec::new();

            // Setup input: stdin from previous pipe or redirect
            let mut effective_stdin = std::mem::take(&mut current_stdin);
            for redir in &cmd.redirections {
                if let Redirection::FileIn(path) = redir {
                    let target = self.cwd.join(path);
                    effective_stdin = fs::read(&target).map_err(|e| {
                        format!("Failed to read redirection input '{}': {}", target.display(), e)
                    })?;
                }
            }

            let (code, in_proc) = self.run_command(
                cmd,
                &effective_stdin,
                &mut cmd_stdout,
                &mut cmd_stderr,
            )?;

            last_code = code;
            if !in_proc {
                all_in_proc = false;
            }

            // Handle file output redirections
            let mut stdout_consumed_by_file = false;
            let mut stderr_consumed_by_file = false;

            for redir in &cmd.redirections {
                match redir {
                    Redirection::FileOut(path) => {
                        let target = self.cwd.join(path);
                        fs::write(&target, &cmd_stdout).map_err(|e| {
                            format!("Failed to write redirection '{}': {}", target.display(), e)
                        })?;
                        stdout_consumed_by_file = true;
                    }
                    Redirection::FileAppend(path) => {
                        let target = self.cwd.join(path);
                        let mut f = fs::OpenOptions::new()
                            .create(true)
                            .append(true)
                            .open(&target)
                            .map_err(|e| {
                                format!("Failed to append redirection '{}': {}", target.display(), e)
                            })?;
                        f.write_all(&cmd_stdout).map_err(|e| {
                            format!("Failed to write append redirection: {}", e)
                        })?;
                        stdout_consumed_by_file = true;
                    }
                    Redirection::FileErr(path) => {
                        let target = self.cwd.join(path);
                        fs::write(&target, &cmd_stderr).map_err(|e| {
                            format!("Failed to write stderr redirection '{}': {}", target.display(), e)
                        })?;
                        stderr_consumed_by_file = true;
                    }
                    Redirection::FileErrAppend(path) => {
                        let target = self.cwd.join(path);
                        let mut f = fs::OpenOptions::new()
                            .create(true)
                            .append(true)
                            .open(&target)
                            .map_err(|e| {
                                format!("Failed to append stderr redirection '{}': {}", target.display(), e)
                            })?;
                        f.write_all(&cmd_stderr).map_err(|e| {
                            format!("Failed to write append stderr redirection: {}", e)
                        })?;
                        stderr_consumed_by_file = true;
                    }
                    _ => {}
                }
            }

            if !stderr_consumed_by_file {
                final_stderr.extend_from_slice(&cmd_stderr);
            }

            if is_last {
                if !stdout_consumed_by_file {
                    final_stdout.extend_from_slice(&cmd_stdout);
                }
            } else {
                current_stdin = cmd_stdout;
            }
        }

        Ok((last_code, all_in_proc))
    }

    fn run_command(
        &mut self,
        cmd: &Command,
        stdin: &[u8],
        stdout: &mut Vec<u8>,
        stderr: &mut Vec<u8>,
    ) -> Result<(i32, bool), String> {
        let name = match cmd.name() {
            Some(n) => n,
            None => return Ok((0, true)),
        };

        if is_builtin(name) {
            let cx = BuiltinContext {
                argv: &cmd.argv,
                stdin,
                stdout,
                stderr,
                cwd: &mut self.cwd,
            };
            let code = run_builtin(name, cx);
            Ok((code, true))
        } else {
            // External command
            let mut proc = ProcessCommand::new(name);
            proc.args(&cmd.argv[1..])
                .current_dir(&self.cwd)
                .stdin(Stdio::piped())
                .stdout(Stdio::piped())
                .stderr(Stdio::piped());

            let mut child = proc
                .spawn()
                .map_err(|e| format!("bun-shell: command not found: '{}' ({})", name, e))?;

            if let Some(mut child_in) = child.stdin.take() {
                if !stdin.is_empty() {
                    let _ = child_in.write_all(stdin);
                }
            }

            let mut out = Vec::new();
            let mut err = Vec::new();
            if let Some(mut child_out) = child.stdout.take() {
                let _ = child_out.read_to_end(&mut out);
            }
            if let Some(mut child_err) = child.stderr.take() {
                let _ = child_err.read_to_end(&mut err);
            }

            let status = child
                .wait()
                .map_err(|e| format!("bun-shell: wait error on '{}': {}", name, e))?;

            stdout.extend_from_slice(&out);
            stderr.extend_from_slice(&err);

            let exit_code = status.code().unwrap_or(1);
            Ok((exit_code, false))
        }
    }
}

/// Convenience entry point to run a shell command or pipeline.
pub fn run_shell(script: &str, cwd: Option<&Path>) -> Result<BunShellOutput, String> {
    let active_cwd = cwd.unwrap_or_else(|| Path::new("."));
    let mut executor = BunShellExecutor::new(active_cwd);
    executor.execute(script)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_in_process_pipeline() {
        let out = run_shell("echo 'hello world' | cat", None).unwrap();
        assert_eq!(out.exit_code, 0);
        assert_eq!(out.stdout.trim(), "hello world");
        assert!(out.in_process);
    }

    #[test]
    fn test_braces_and_in_process_builtins() {
        let out = run_shell("echo {1..3}", None).unwrap();
        assert_eq!(out.exit_code, 0);
        assert_eq!(out.stdout.trim(), "1 2 3");
        assert!(out.in_process);
    }
}
