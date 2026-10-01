// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 aphrody contributors

//! Idempotent provisioning of aphrody MCP tools and yolo persona into the OpenAI Codex CLI.
//!
//! Mirrors `agy_provision.rs` for OpenAI Codex (`$CODEX_HOME` / `~/.codex`):
//!
//! * Resolves `codex` binary via `$APHRODY_CODEX_BIN`, PATH, npm/bun global.
//! * Upserts `[mcp_servers.aphrody]` in `$CODEX_HOME/config.toml` and removes a legacy
//!   `[mcp_servers.bxc]`: `aphrody-os` serves the OS, Obscura and BXC catalog, so a second server
//!   would duplicate every BXC tool.
//! * Injects the managed YOLO persona block in `$CODEX_HOME/AGENTS.md`.
//! * Controlled via `APHRODY_CODEX_NO_PROVISION=1`.

#![allow(dead_code)]

use std::path::{Path, PathBuf};

const PERSONA_BEGIN: &str =
    "<!-- BEGIN aphrody-codex — bloc géré automatiquement, ne pas éditer -->";
const PERSONA_END: &str = "<!-- END aphrody-codex -->";

/// Outcome of a Codex provisioning pass.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub(crate) struct CodexProvisioned {
    /// Whether `config.toml` was updated with MCP servers.
    pub(crate) config: bool,
    /// Whether `AGENTS.md` was updated with the yolo persona.
    pub(crate) persona: bool,
}

impl CodexProvisioned {
    /// Whether any configuration changed on disk.
    #[must_use]
    pub(crate) fn changed(self) -> bool {
        self.config || self.persona
    }
}

/// Resolve the Codex configuration root directory (`$CODEX_HOME` or `~/.codex`).
#[must_use]
pub(crate) fn codex_dir() -> Option<PathBuf> {
    if let Ok(val) = std::env::var("CODEX_HOME") {
        let p = PathBuf::from(val.trim());
        if !p.as_os_str().is_empty() {
            return Some(p);
        }
    }
    dirs::home_dir().map(|h| h.join(".codex"))
}

/// Resolve the installed `codex` binary, checking in order:
/// 1. `$APHRODY_CODEX_BIN` (explicit override)
/// 2. `which codex[.exe]` (PATH)
/// 3. Standard global npm / bun bin locations
/// 4. `~/.local/bin/codex[.exe]`
#[must_use]
pub(crate) fn resolve_codex_bin() -> Option<PathBuf> {
    if let Ok(val) = std::env::var("APHRODY_CODEX_BIN") {
        let p = PathBuf::from(val.trim());
        if p.exists() {
            return Some(p);
        }
    }

    let bin_name = if cfg!(windows) { "codex.exe" } else { "codex" };
    if let Ok(p) = which::which(bin_name) {
        return Some(p);
    }
    if let Ok(p) = which::which("codex") {
        return Some(p);
    }

    if let Some(home) = dirs::home_dir() {
        let local_bin = home.join(".local").join("bin").join(bin_name);
        if local_bin.exists() {
            return Some(local_bin);
        }

        // Global npm on Windows:
        #[cfg(windows)]
        {
            if let Ok(appdata) = std::env::var("APPDATA") {
                let npm_bin = PathBuf::from(appdata).join("npm").join("codex.cmd");
                if npm_bin.exists() {
                    return Some(npm_bin);
                }
            }
        }
    }

    None
}

/// Resolve the `aphrody-kernel` binary for MCP server configuration.
fn resolve_mcp_bin() -> Option<PathBuf> {
    if let Ok(p) = std::env::var("APHRODY_OS_KERNEL_BIN") {
        let p = PathBuf::from(p.trim());
        if p.exists() {
            return Some(p);
        }
    }
    let name = if cfg!(windows) { "aphrody-kernel.exe" } else { "aphrody-kernel" };
    if let Ok(exe) = std::env::current_exe()
        && let Some(dir) = exe.parent()
    {
        let p = dir.join(name);
        if p.exists() {
            return Some(p);
        }
    }
    which::which(name).ok()
}

/// Format a path as a TOML-safe forward-slash string.
fn toml_path_str(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

/// Remove `[mcp_servers.<name>]` and its sub-tables (`[mcp_servers.<name>.env]`, ...).
pub(crate) fn remove_server_section(existing: &str, server_name: &str) -> (String, bool) {
    let header = format!("[mcp_servers.{server_name}]");
    let sub = format!("[mcp_servers.{server_name}.");
    let mut out = String::with_capacity(existing.len());
    let mut skipping = false;
    let mut changed = false;
    for line in existing.split_inclusive('\n') {
        let trimmed = line.trim_start();
        if trimmed.starts_with('[') {
            skipping = trimmed.starts_with(&header) || trimmed.starts_with(&sub);
            changed |= skipping;
        }
        if !skipping {
            out.push_str(line);
        }
    }
    (out, changed)
}

/// Upsert a specific `[mcp_servers.<name>]` section in TOML text format-preservingly.
pub(crate) fn upsert_server_section(
    existing: &str,
    server_name: &str,
    command: &str,
    args: &[&str],
) -> (String, bool) {
    let header = format!("[mcp_servers.{server_name}]");
    let args_str = if args.is_empty() {
        "args = []".to_string()
    } else {
        format!(
            "args = [{}]",
            args.iter().map(|a| format!("\"{a}\"")).collect::<Vec<_>>().join(", ")
        )
    };
    let new_section = format!("{header}\ncommand = \"{command}\"\n{args_str}\n");

    if let Some(start_idx) = existing.find(&header) {
        // Find where this section ends: either at the next '[' header or at EOF.
        let after_header = &existing[start_idx + header.len()..];
        let end_offset = after_header.find("\n[").map(|pos| pos + 1).unwrap_or(after_header.len());
        let full_end = start_idx + header.len() + end_offset;

        let existing_section = &existing[start_idx..full_end];
        if existing_section.trim() == new_section.trim() {
            return (existing.to_string(), false);
        }

        let mut out = String::with_capacity(existing.len() + new_section.len());
        out.push_str(&existing[..start_idx]);
        out.push_str(&new_section);
        out.push_str(&existing[full_end..]);
        (out, true)
    } else {
        let mut out = existing.to_string();
        if !out.is_empty() && !out.ends_with('\n') {
            out.push('\n');
        }
        if !out.is_empty() && !out.ends_with("\n\n") {
            out.push('\n');
        }
        out.push_str(&new_section);
        (out, true)
    }
}

/// Ensure `$CODEX_HOME/config.toml` declares `[mcp_servers.aphrody]` and no `[mcp_servers.bxc]`.
fn ensure_config(codex_dir: &Path) -> std::io::Result<bool> {
    let config_path = codex_dir.join("config.toml");
    let mut content =
        if config_path.exists() { std::fs::read_to_string(&config_path)? } else { String::new() };

    let mut changed = false;

    // Wire aphrody-os kernel if resolved
    if let Some(mcp_bin) = resolve_mcp_bin() {
        let bin_str = toml_path_str(&mcp_bin);
        let (updated, did_change) = upsert_server_section(&content, "aphrody", &bin_str, &["mcp"]);
        if did_change {
            content = updated;
            changed = true;
        }
    }

    // BXC and Obscura are aggregated by aphrody-os; drop the legacy second server.
    let (updated, did_change) = remove_server_section(&content, "bxc");
    if did_change {
        content = updated;
        changed = true;
    }

    if changed {
        std::fs::create_dir_all(codex_dir)?;
        std::fs::write(&config_path, &content)?;
    }

    Ok(changed)
}

/// In-tree yolo persona loader.
fn persona_body(repo_root: Option<&Path>) -> Option<String> {
    let root = repo_root?;
    let yolo_root = root.join("config/ai/plugins/aphrody");
    let yolo_agents = yolo_root.join("home").join("AGENTS.md");
    let persona = std::fs::read_to_string(&yolo_agents).ok()?;
    let persona = persona
        .lines()
        .filter(|l| !l.trim_start().starts_with("<!-- SPDX"))
        .collect::<Vec<_>>()
        .join("\n");
    Some(persona.trim().to_string())
}

/// Merge or replace the managed persona block in `existing` Markdown.
fn upsert_block(existing: &str, block: &str) -> String {
    if let Some(begin) = existing.find(PERSONA_BEGIN) {
        let end = existing[begin..]
            .find(PERSONA_END)
            .map(|offset| begin + offset)
            .unwrap_or(existing.len());
        let end = end + PERSONA_END.len();
        let mut out = String::with_capacity(existing.len() + block.len());
        out.push_str(&existing[..begin]);
        out.push_str(block.trim_end());
        out.push_str(&existing[end..]);
        out
    } else {
        let mut out = existing.to_owned();
        if !out.is_empty() && !out.ends_with('\n') {
            out.push('\n');
        }
        if !out.is_empty() {
            out.push('\n');
        }
        out.push_str(block);
        out
    }
}

/// Ensure `$CODEX_HOME/AGENTS.md` contains the managed YOLO persona block.
pub(crate) fn ensure_persona(codex_dir: &Path, body: &str) -> std::io::Result<bool> {
    let block = format!("{PERSONA_BEGIN}\n{body}\n{PERSONA_END}\n");
    let path = codex_dir.join("AGENTS.md");
    let existing = std::fs::read_to_string(&path).unwrap_or_default();
    let merged = upsert_block(&existing, &block);
    if merged != existing {
        std::fs::create_dir_all(codex_dir)?;
        std::fs::write(&path, merged)?;
        return Ok(true);
    }
    Ok(false)
}

/// Run full idempotent provisioning for OpenAI Codex.
///
/// Honors `APHRODY_CODEX_NO_PROVISION=1`.
pub(crate) fn provision(repo_root: Option<&Path>) -> CodexProvisioned {
    let mut out = CodexProvisioned::default();
    if std::env::var_os("APHRODY_CODEX_NO_PROVISION").is_some() {
        return out;
    }

    let Some(dir) = codex_dir() else {
        return out;
    };

    if let Ok(c) = ensure_config(&dir) {
        out.config = c;
    }

    if let Some(body) = persona_body(repo_root)
        && let Ok(c) = ensure_persona(&dir, &body)
    {
        out.persona = c;
    }

    out
}

#[cfg(test)]
mod tests {
    use tempfile::tempdir;

    use super::*;

    #[test]
    fn test_upsert_server_section_idempotent() {
        let initial = "# User config\nmodel = \"o3-mini\"\n";
        let (updated, c1) =
            upsert_server_section(initial, "aphrody", "C:/bin/aphrody-kernel.exe", &["mcp"]);
        assert!(c1);
        assert!(updated.contains("[mcp_servers.aphrody]"));
        assert!(updated.contains("command = \"C:/bin/aphrody-kernel.exe\""));
        assert!(updated.contains("args = [\"mcp\"]"));

        // Second run with same config must be a no-op
        let (updated2, c2) =
            upsert_server_section(&updated, "aphrody", "C:/bin/aphrody-kernel.exe", &["mcp"]);
        assert!(!c2);
        assert_eq!(updated, updated2);

        // Update with new command path must modify only the section
        let (updated3, c3) =
            upsert_server_section(&updated, "aphrody", "C:/new/aphrody-kernel.exe", &["mcp"]);
        assert!(c3);
        assert!(updated3.contains("command = \"C:/new/aphrody-kernel.exe\""));
        assert!(updated3.contains("# User config\nmodel = \"o3-mini\""));
    }

    #[test]
    fn test_codex_provision_persona_idempotent() {
        let tmp = tempdir().expect("tempdir");
        let codex_dir = tmp.path();

        // Persona block test
        let p1 = ensure_persona(codex_dir, "Rule 1: No HITL").expect("ensure persona");
        assert!(p1);
        let agents_text =
            std::fs::read_to_string(codex_dir.join("AGENTS.md")).expect("read agents");
        assert!(agents_text.contains("Rule 1: No HITL"));
        assert!(agents_text.contains(PERSONA_BEGIN));
        assert!(agents_text.contains(PERSONA_END));

        let p2 = ensure_persona(codex_dir, "Rule 1: No HITL").expect("ensure persona second");
        assert!(!p2);
    }
}
