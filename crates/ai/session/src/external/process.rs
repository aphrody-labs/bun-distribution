// SPDX-License-Identifier: Apache-2.0
//! Live agent processes, found through `sysinfo` (Linux `/proc`, Windows
//! Toolhelp/PEB, macOS libproc — one API).
//!
//! A process is an agent when its executable is one (`claude`, `codex` or a
//! Codex release binary named after its target triple, `agy`,
//! `antigravity`), or when it is a `node` process whose *script* is one (the
//! npm distributions: `@anthropic-ai/claude-code/cli.js`,
//! `@openai/codex/bin/codex.js`, anything under an `antigravity` directory).
//! A `node` process running anything else is never counted: most `node`
//! processes on a developer machine are language servers and MCP servers.
//! Neither are Electron helper processes (`--type=renderer`, ...) nor the
//! Claude Desktop chat app, whose executable is also named `claude`.

use std::{ffi::OsString, path::Path};

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use super::AgentKind;

/// A running agent process.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct LiveAgentProcess {
    /// Which agent it is.
    pub agent: AgentKind,
    /// Process id.
    pub pid: u32,
    /// Process name as the OS reports it.
    pub name: String,
    /// Executable path, when readable.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub exe: Option<String>,
    /// Current working directory, when readable (not for elevated processes
    /// of another user).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cwd: Option<String>,
    /// Process start time.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub started_at: Option<DateTime<Utc>>,
    /// `true` when the agent runs as a script under `node`.
    pub via_node: bool,
}

/// Decide whether a process is an agent from its name, executable path and
/// command line. Returns the agent and whether it runs under `node`.
#[must_use]
pub fn classify_process(
    name: &str,
    exe: Option<&Path>,
    cmd: &[OsString],
) -> Option<(AgentKind, bool)> {
    // Chromium/Electron helpers (renderer, GPU, utility) share the main
    // executable's name; only the main process is the agent.
    if cmd.iter().any(|arg| arg.to_str().is_some_and(|arg| arg.starts_with("--type="))) {
        return None;
    }
    let stem = exe
        .and_then(|exe| exe.file_stem())
        .and_then(|stem| stem.to_str())
        .map(str::to_ascii_lowercase)
        .unwrap_or_else(|| file_stem_lower(name));
    if let Some(agent) = agent_from_executable_stem(&stem) {
        if agent == AgentKind::Claude && exe.is_some_and(is_claude_desktop) {
            return None;
        }
        return Some((agent, false));
    }
    if stem == "node" || file_stem_lower(name) == "node" {
        return node_script(cmd).and_then(agent_from_script).map(|agent| (agent, true));
    }
    None
}

fn file_stem_lower(name: &str) -> String {
    Path::new(name).file_stem().and_then(|stem| stem.to_str()).unwrap_or(name).to_ascii_lowercase()
}

fn agent_from_executable_stem(stem: &str) -> Option<AgentKind> {
    match stem {
        "claude" => Some(AgentKind::Claude),
        "codex" => Some(AgentKind::Codex),
        "agy" | "antigravity" => Some(AgentKind::Agy),
        // The native Codex binary shipped inside the npm package is named
        // after its target triple (`codex-x86_64-pc-windows-msvc`).
        _ if stem.starts_with("codex-")
            && ["-pc-windows-", "-unknown-linux-", "-apple-darwin"]
                .iter()
                .any(|marker| stem.contains(marker)) =>
        {
            Some(AgentKind::Codex)
        },
        _ => None,
    }
}

/// Claude Desktop, the chat app, also ships a `claude` executable; it is not
/// Claude Code and writes no transcript under `projects/`. Its install
/// locations: Squirrel (`%LOCALAPPDATA%\AnthropicClaude\app-<ver>\claude.exe`),
/// MSIX (`WindowsApps\Claude_<ver>_<arch>__<publisher>\app\claude.exe`) and
/// the macOS bundle (`Claude.app/Contents/MacOS/Claude`). Claude Code installs
/// elsewhere (`~/.local/bin`, `~/.claude/local`, a package manager's bin).
fn is_claude_desktop(exe: &Path) -> bool {
    let lower = exe.to_string_lossy().to_ascii_lowercase();
    let components: Vec<&str> =
        lower.split(['/', '\\']).filter(|component| !component.is_empty()).collect();
    components.iter().any(|component| matches!(*component, "anthropicclaude" | "claude.app"))
        || components
            .windows(2)
            .any(|pair| pair[0] == "windowsapps" && pair[1].starts_with("claude_"))
}

/// The script a `node` command line runs: the first argument after the
/// interpreter that is not an option.
fn node_script(cmd: &[OsString]) -> Option<&str> {
    cmd.iter().skip(1).filter_map(|arg| arg.to_str()).find(|arg| !arg.starts_with('-'))
}

fn agent_from_script(script: &str) -> Option<AgentKind> {
    let lower = script.to_ascii_lowercase();
    let components: Vec<&str> =
        lower.split(['/', '\\']).filter(|component| !component.is_empty()).collect();
    let stem = components.last().map(|last| file_stem_lower(last)).unwrap_or_default();
    if stem == "claude" || components.contains(&"claude-code") {
        return Some(AgentKind::Claude);
    }
    if stem == "codex"
        || components.windows(2).any(|pair| pair[0] == "@openai" && pair[1] == "codex")
    {
        return Some(AgentKind::Codex);
    }
    if stem == "agy" || components.iter().any(|component| component.contains("antigravity")) {
        return Some(AgentKind::Agy);
    }
    None
}

/// Whether a bare process name is worth a second, detailed refresh.
fn is_candidate_name(name: &str) -> bool {
    let stem = file_stem_lower(name);
    stem == "node"
        || ["claude", "codex", "agy", "antigravity"].iter().any(|prefix| stem.starts_with(prefix))
}

/// Every agent process running now.
///
/// Two passes keep this cheap: every process is listed by name only, then
/// just the candidates (agent names and `node`) are refreshed with their
/// executable, command line and working directory.
#[must_use]
pub fn probe_live_processes() -> Vec<LiveAgentProcess> {
    use sysinfo::{Pid, ProcessRefreshKind, ProcessesToUpdate, System, UpdateKind};

    let mut system = System::new();
    system.refresh_processes_specifics(ProcessesToUpdate::All, true, ProcessRefreshKind::nothing());
    let candidates: Vec<Pid> = system
        .processes()
        .iter()
        .filter(|(_, process)| process.name().to_str().is_some_and(is_candidate_name))
        .map(|(pid, _)| *pid)
        .collect();
    if candidates.is_empty() {
        return Vec::new();
    }
    system.refresh_processes_specifics(
        ProcessesToUpdate::Some(&candidates),
        false,
        ProcessRefreshKind::nothing()
            .with_exe(UpdateKind::Always)
            .with_cmd(UpdateKind::Always)
            .with_cwd(UpdateKind::Always),
    );

    let mut live: Vec<LiveAgentProcess> = candidates
        .iter()
        .filter_map(|pid| {
            let process = system.process(*pid)?;
            // Linux task IDs share the executable and cwd of their process.
            // They must not become separate agents in the live graph.
            if process.thread_kind().is_some() {
                return None;
            }
            let name = process.name().to_string_lossy().into_owned();
            let (agent, via_node) = classify_process(&name, process.exe(), process.cmd())?;
            let started_at = i64::try_from(process.start_time())
                .ok()
                .filter(|secs| *secs > 0)
                .and_then(|secs| DateTime::from_timestamp(secs, 0));
            Some(LiveAgentProcess {
                agent,
                pid: pid.as_u32(),
                name,
                exe: process.exe().map(display),
                cwd: process.cwd().map(display),
                started_at,
                via_node,
            })
        })
        .collect();
    live.sort_by(|a, b| a.agent.cmp(&b.agent).then(a.pid.cmp(&b.pid)));
    live
}

fn display(path: &Path) -> String {
    path.display().to_string()
}
