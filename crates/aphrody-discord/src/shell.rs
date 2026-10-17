// SPDX-License-Identifier: Apache-2.0
//! Bounded shell execution and computer-use reporting for Discord.

use anyhow::{Context, Result};
use aphrody_proc::NoWindow as _;
use std::time::Instant;
use tokio::process::Command;

use crate::types::{Embed, EmbedField, EmbedFooter, clip};

/// Wall-clock limit for `run_bounded_shell`; the child is killed when it is exceeded.
pub const SHELL_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(120);

#[derive(Debug, Clone)]
pub struct ShellExecutionResult {
    pub command: String,
    pub exit_code: Option<i32>,
    pub stdout: String,
    pub stderr: String,
    pub duration_ms: u128,
    pub success: bool,
}

/// Runs a command through the platform shell, capturing stdout/stderr, killed after [`SHELL_TIMEOUT`].
pub async fn run_bounded_shell(command_line: &str) -> Result<ShellExecutionResult> {
    let start = Instant::now();

    #[cfg(target_os = "windows")]
    let mut cmd = {
        let mut c = Command::new("cmd.exe").no_window();
        c.args(["/C", command_line]);
        c
    };

    #[cfg(not(target_os = "windows"))]
    let mut cmd = {
        let mut c = Command::new("sh").no_window();
        c.args(["-c", command_line]);
        c
    };

    cmd.kill_on_drop(true);
    let output = tokio::time::timeout(SHELL_TIMEOUT, cmd.output())
        .await
        .map_err(|_| {
            anyhow::anyhow!(
                "shell command timed out after {}s: {command_line}",
                SHELL_TIMEOUT.as_secs()
            )
        })?
        .with_context(|| format!("Failed to execute shell command: {command_line}"))?;

    let duration_ms = start.elapsed().as_millis();
    let exit_code = output.status.code();
    let success = output.status.success();

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();

    Ok(ShellExecutionResult {
        command: command_line.to_string(),
        exit_code,
        stdout,
        stderr,
        duration_ms,
        success,
    })
}

/// Formats a shell execution result into a Discord Embed.
pub fn build_shell_embed(res: &ShellExecutionResult) -> Embed {
    let status_emoji = if res.success {
        "🟢 SUCCESS"
    } else {
        "🔴 FAILED"
    };
    let color = if res.success { 0x22C55E } else { 0xEF4444 };

    let mut fields = Vec::new();
    fields.push(EmbedField {
        name: "Execution Details".to_string(),
        value: format!(
            "**Status:** `{status_emoji}` (code `{}`)\n**Duration:** `{}ms`",
            res.exit_code.unwrap_or(-1),
            res.duration_ms
        ),
        inline: false,
    });

    let stdout_sample = if res.stdout.trim().is_empty() {
        "*(empty)*".to_string()
    } else if res.stdout.len() > 1000 {
        format!("{}…\n*(truncated)*", clip(&res.stdout, 1000))
    } else {
        res.stdout.clone()
    };

    fields.push(EmbedField {
        name: "Standard Output".to_string(),
        value: format!("```\n{}\n```", stdout_sample.trim()),
        inline: false,
    });

    if !res.stderr.trim().is_empty() {
        let stderr_sample = if res.stderr.len() > 800 {
            format!("{}…\n*(truncated)*", clip(&res.stderr, 800))
        } else {
            res.stderr.clone()
        };
        fields.push(EmbedField {
            name: "Standard Error".to_string(),
            value: format!("```\n{}\n```", stderr_sample.trim()),
            inline: false,
        });
    }

    Embed {
        title: Some(format!("Shell: `{}`", clip(&res.command, 80))),
        description: None,
        color: Some(color),
        fields,
        footer: Some(EmbedFooter {
            text: "Aphrody Native Shell Runner".to_string(),
            icon_url: None,
        }),
        ..Default::default()
    }
}
