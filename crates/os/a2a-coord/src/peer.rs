// SPDX-License-Identifier: Apache-2.0
use std::{
    path::{Path, PathBuf},
    process::{Command, Stdio},
};

use thiserror::Error;

use crate::manifest::PeerDef;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PeerId {
    Claude,
    Codex,
    Grok,
    Agy,
    Bxc,
}

impl PeerId {
    #[must_use]
    pub const fn short(self) -> &'static str {
        match self {
            Self::Claude => "claude",
            Self::Codex => "codex",
            Self::Grok => "grok",
            Self::Agy => "agy",
            Self::Bxc => "bxc",
        }
    }

    pub fn parse(s: &str) -> Option<Self> {
        match s.to_ascii_lowercase().as_str() {
            "claude" | "claude-code" => Some(Self::Claude),
            "codex" => Some(Self::Codex),
            "grok" | "grok-build" => Some(Self::Grok),
            "agy" | "agycli" | "gemini" | "antigravity" => Some(Self::Agy),
            "bxc" => Some(Self::Bxc),
            _ => None,
        }
    }
}

#[derive(Debug, Clone)]
pub struct PeerInvokeResult {
    pub peer: PeerId,
    pub exit_code: Option<i32>,
    pub stdout: String,
    pub stderr: String,
}

#[derive(Debug, Error)]
pub enum PeerError {
    #[error("unknown peer: {0}")]
    UnknownPeer(String),
    #[error("binary not found: {0}")]
    BinaryNotFound(String),
    #[error("io: {0}")]
    Io(#[from] std::io::Error),
    #[error("utf8")]
    Utf8(#[from] std::string::FromUtf8Error),
}

#[derive(Debug, Clone)]
pub struct PeerInvoker {
    pub cwd: PathBuf,
    pub max_turns: u32,
    pub dry_run: bool,
}

impl PeerInvoker {
    #[must_use]
    pub fn new(cwd: impl AsRef<Path>) -> Self {
        Self { cwd: cwd.as_ref().to_path_buf(), max_turns: 40, dry_run: false }
    }

    #[must_use]
    pub fn with_dry_run(mut self, dry_run: bool) -> Self {
        self.dry_run = dry_run;
        self
    }

    #[must_use]
    pub fn with_max_turns(mut self, max_turns: u32) -> Self {
        self.max_turns = max_turns;
        self
    }

    pub fn invoke_prompt(&self, peer: PeerId, prompt: &str) -> Result<PeerInvokeResult, PeerError> {
        let shared = self.shared_prompt(prompt);
        let prompt = shared.as_str();
        if self.dry_run {
            return Ok(PeerInvokeResult {
                peer,
                exit_code: Some(0),
                stdout: format!(
                    "[dry-run] would invoke {} with prompt len {}",
                    peer.short(),
                    prompt.len()
                ),
                stderr: String::new(),
            });
        }
        match peer {
            PeerId::Grok => self.invoke_grok(prompt),
            PeerId::Agy => self.invoke_agy(prompt),
            PeerId::Claude => self.invoke_claude(prompt),
            PeerId::Codex => self.invoke_codex(prompt),
            PeerId::Bxc => self.invoke_bxc(prompt),
        }
    }

    fn shared_prompt(&self, task: &str) -> String {
        let mut context = String::new();
        for relative in ["AGENTS.md", ".coord/shared/MEMORY.md", ".coord/shared/CONVERSATIONS.md"] {
            if let Ok(text) = std::fs::read_to_string(self.cwd.join(relative)) {
                let bounded: String = text.chars().take(16_384).collect();
                context.push_str(&format!("\nRepository context ({relative}):\n{bounded}\n"));
            }
        }
        format!(
            "{task}\n\nShared repository context; follow the current task and repository rules:\n{context}"
        )
    }

    pub fn invoke_peer_def(
        &self,
        def: &PeerDef,
        prompt: &str,
    ) -> Result<PeerInvokeResult, PeerError> {
        if let Some(id) = def.id.split('@').next().and_then(PeerId::parse) {
            return self.invoke_prompt(id, prompt);
        }
        Err(PeerError::UnknownPeer(def.id.clone()))
    }

    fn resolve_bin(env_key: &str, default: &str) -> PathBuf {
        std::env::var_os(env_key)
            .map(PathBuf::from)
            .filter(|p| p.is_file())
            .or_else(|| which::which(default).ok())
            .unwrap_or_else(|| PathBuf::from(default))
    }

    fn invoke_grok(&self, prompt: &str) -> Result<PeerInvokeResult, PeerError> {
        let bin = Self::resolve_bin("GROK_BIN", "grok");
        if !bin.is_file() && which::which("grok").is_err() {
            return Err(PeerError::BinaryNotFound(bin.display().to_string()));
        }
        let prompt_file =
            std::env::temp_dir().join(format!("aphrody-grok-{}.txt", std::process::id()));
        std::fs::write(&prompt_file, prompt)?;
        let mut cmd = Command::new(&bin);
        cmd.args([
            "--prompt-file",
            prompt_file.to_str().unwrap_or("prompt.txt"),
            "--always-approve",
            "--permission-mode",
            "bypassPermissions",
            "--max-turns",
            &self.max_turns.to_string(),
            "--cwd",
        ]);
        cmd.arg(&self.cwd);
        cmd.args(["--output-format", "json"]);
        // Do NOT pass --effort or --reasoning-effort (grok-build HTTP 400).
        self.run(PeerId::Grok, cmd)
    }

    fn invoke_agy(&self, prompt: &str) -> Result<PeerInvokeResult, PeerError> {
        let bin = Self::resolve_bin("APHRODY_AGY_BIN", "agy");
        let mut cmd = Command::new(&bin);
        cmd.args([
            "-p",
            prompt,
            "--dangerously-skip-permissions",
            "--print-timeout",
            "10m",
            "--add-dir",
        ]);
        cmd.arg(&self.cwd);
        self.run(PeerId::Agy, cmd)
    }

    fn invoke_claude(&self, prompt: &str) -> Result<PeerInvokeResult, PeerError> {
        let bin = Self::resolve_bin("CLAUDE_BIN", "claude");
        let mut cmd = Command::new(&bin);
        cmd.args(["-p", prompt, "--output-format", "text"]);
        cmd.current_dir(&self.cwd);
        self.run(PeerId::Claude, cmd)
    }

    fn invoke_codex(&self, prompt: &str) -> Result<PeerInvokeResult, PeerError> {
        let bin = Self::resolve_bin("CODEX_BIN", "codex");
        let mut cmd = Command::new(&bin);
        cmd.args(["exec", "--dangerously-bypass-approvals-and-sandbox", "--json", "-C"]);
        cmd.arg(&self.cwd);
        cmd.arg(prompt);
        self.run(PeerId::Codex, cmd)
    }

    fn invoke_bxc(&self, prompt: &str) -> Result<PeerInvokeResult, PeerError> {
        let bin = Self::resolve_bin("BXC_BIN", "bxc");
        let mut cmd = Command::new(&bin);
        cmd.args(["search", prompt, "--num", "3", "--json"]);
        cmd.current_dir(&self.cwd);
        self.run(PeerId::Bxc, cmd)
    }

    fn run(&self, peer: PeerId, mut cmd: Command) -> Result<PeerInvokeResult, PeerError> {
        cmd.current_dir(&self.cwd);
        cmd.stdin(Stdio::null());
        cmd.stdout(Stdio::piped());
        cmd.stderr(Stdio::piped());
        let out = cmd.output()?;
        Ok(PeerInvokeResult {
            peer,
            exit_code: out.status.code(),
            stdout: String::from_utf8(out.stdout)?,
            stderr: String::from_utf8(out.stderr)?,
        })
    }
}

#[cfg(test)]
mod coordination_tests {
    use super::*;
    #[test]
    fn common_coding_peers_are_routable() {
        assert_eq!(PeerId::parse("codex"), Some(PeerId::Codex));
        assert_eq!(PeerId::parse("agycli"), Some(PeerId::Agy));
        let invoker = PeerInvoker::new(".").with_dry_run(true);
        for peer in [PeerId::Claude, PeerId::Codex, PeerId::Agy] {
            assert_eq!(invoker.invoke_prompt(peer, "shared task").unwrap().exit_code, Some(0));
        }
    }
}
