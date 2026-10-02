// SPDX-License-Identifier: Apache-2.0
//! Native wiring of aphrody's **home agent** and the in-tree **yolo** package
//! into the Antigravity CLI (`agy`).
//!
//! `agy` discovers customizations from its global root `~/.gemini/config/`
//! (documented by its own `agy-customizations` skill):
//!
//! * `mcp_config.json` — MCP servers (`mcpServers` map) exposed to every session;
//! * `skills.json` — a manifest whose `entries[].path` point at directories scanned for skill
//!   subdirs (each `SKILL.md`);
//! * `AGENTS.md` / `GEMINI.md` — the persona/rules, walked up from the cwd.
//!
//! Before forwarding to the `agy` binary, [`provision`] wires three things in,
//! **idempotently** and **merge-safe** (never clobbering a user's own config):
//!
//! 1. the **OS MCP kernel** — `aphrody-kernel mcp` into `mcp_config.json` and the persona into
//!    `~/.gemini/AGENTS.md` / `GEMINI.md` inside a managed block;
//! 2. the **Aphrody plugin** — `../aphrody-os/plugins/aphrody/skills` registered in `skills.json`,
//!    so yolo's autonomous skills (grind, autopilot, start, …) are available.
//!
//! Everything is written under `~/.gemini/` — nothing in the repo or the plugin
//! checkout is modified. Provisioning is best-effort: a failure is logged and
//! never blocks the `agy` session. Set `APHRODY_AGY_NO_PROVISION=1` to skip it.

use std::path::{Path, PathBuf};

use serde_json::{Value, json};

/// Opening marker of the aphrody-managed block in `AGENTS.md` / `GEMINI.md`.
const PERSONA_BEGIN: &str = "<!-- BEGIN aphrody-agy — bloc géré automatiquement, ne pas éditer -->";
/// Closing marker of the aphrody-managed block.
const PERSONA_END: &str = "<!-- END aphrody-agy -->";

/// Outcome of a provisioning pass — what actually changed on disk.
#[derive(Debug, Default, Clone, Copy)]
pub(crate) struct Provisioned {
    /// The `aphrody` MCP server entry was added or updated.
    pub mcp: bool,
    /// `skills.json` gained one or more yolo skill entries.
    pub skills: bool,
    /// The persona block in `AGENTS.md` / `GEMINI.md` was written or refreshed.
    pub persona: bool,
}

impl Provisioned {
    /// Whether anything at all changed (worth reporting to the user).
    pub(crate) fn changed(self) -> bool {
        self.mcp || self.skills || self.persona
    }
}

/// `~/.gemini` — the Antigravity CLI home.
fn gemini_dir() -> Option<PathBuf> {
    dirs::home_dir().map(|h| h.join(".gemini"))
}

/// Platform binary name for the Aphrody OS MCP kernel.
fn mcp_bin_name() -> &'static str {
    if cfg!(windows) { "aphrody-kernel.exe" } else { "aphrody-kernel" }
}

fn yolo_root(repo_root: &Path) -> PathBuf {
    repo_root.join("plugins/aphrody")
}

/// Resolve the `aphrody-kernel` binary, first match wins:
/// 1. `$APHRODY_OS_KERNEL_BIN` (must exist);
/// 2. sibling of the current executable (installed layout);
/// 3. `which(aphrody-kernel)` — PATH lookup;
/// 4. `~/.local/bin/aphrody-kernel[.exe]`.
///
/// Returns `None` when it cannot be found — the MCP wiring is then skipped
/// (the yolo skills + persona are still provisioned).
fn resolve_aphrody_mcp_bin() -> Option<PathBuf> {
    if let Ok(p) = std::env::var("APHRODY_OS_KERNEL_BIN") {
        let p = PathBuf::from(p.trim());
        if p.exists() {
            return Some(p);
        }
    }
    let name = mcp_bin_name();
    if let Ok(exe) = std::env::current_exe()
        && let Some(dir) = exe.parent()
    {
        let p = dir.join(name);
        if p.exists() {
            return Some(p);
        }
    }
    if let Ok(p) = which::which(name) {
        return Some(p);
    }
    if let Some(home) = dirs::home_dir() {
        let p = home.join(".local").join("bin").join(name);
        if p.exists() {
            return Some(p);
        }
    }
    None
}

/// Read a JSON object file (default `{}` when missing/invalid), let `f` mutate
/// it, and write it back pretty-printed **only if** `f` reports a change.
fn update_json_file(
    path: &Path,
    f: impl FnOnce(&mut serde_json::Map<String, Value>) -> bool,
) -> std::io::Result<bool> {
    let mut root = std::fs::read_to_string(path)
        .ok()
        .and_then(|s| serde_json::from_str::<Value>(&s).ok())
        .and_then(|v| v.as_object().cloned())
        .unwrap_or_default();

    if !f(&mut root) {
        return Ok(false);
    }
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let text = serde_json::to_string_pretty(&Value::Object(root))?;
    std::fs::write(path, text)?;
    Ok(true)
}

/// Ensure `mcp_config.json` exposes the `aphrody-os` kernel MCP server.
fn ensure_mcp(config_dir: &Path) -> std::io::Result<bool> {
    let Some(bin) = resolve_aphrody_mcp_bin() else {
        // aphrody-kernel introuvable : on saute le câblage MCP (skills+persona restent).
        return Ok(false);
    };
    let desired = json!({ "command": bin.to_string_lossy(), "args": ["mcp"] });
    update_json_file(&config_dir.join("mcp_config.json"), |root| {
        let servers = root.entry("mcpServers").or_insert_with(|| json!({}));
        if !servers.is_object() {
            *servers = json!({});
        }
        let servers = servers.as_object_mut().expect("just set to object");
        if servers.get("aphrody") == Some(&desired) {
            return false;
        }
        servers.insert("aphrody".to_owned(), desired.clone());
        true
    })
}

/// Ensure `skills.json` scans each directory in `dirs` for skills.
fn ensure_skills(config_dir: &Path, dirs: &[PathBuf]) -> std::io::Result<bool> {
    if dirs.is_empty() {
        return Ok(false);
    }
    update_json_file(&config_dir.join("skills.json"), |root| {
        let entries = root.entry("entries").or_insert_with(|| json!([]));
        if !entries.is_array() {
            *entries = json!([]);
        }
        let entries = entries.as_array_mut().expect("just set to array");
        let mut changed = false;
        for dir in dirs {
            let path = dir.to_string_lossy();
            let present = entries
                .iter()
                .any(|e| e.get("path").and_then(Value::as_str) == Some(path.as_ref()));
            if !present {
                entries.push(json!({ "path": path }));
                changed = true;
            }
        }
        changed
    })
}

/// The persona body wired into the managed block: aphrody's home-agent identity
/// header followed by the in-tree yolo `home/AGENTS.md` (the managed persona).
///
/// Sourced from the repo so it stays in sync; returns `None` when neither the
/// repo root nor a yolo home file is available.
fn persona_body(repo_root: Option<&Path>) -> Option<String> {
    let root = repo_root?;
    let yolo_agents = yolo_root(root).join("home").join("AGENTS.md");
    let persona = std::fs::read_to_string(&yolo_agents).ok()?;
    // Strip an SPDX header line if present so it does not leak into the rules.
    let persona = persona
        .lines()
        .filter(|l| !l.trim_start().starts_with("<!-- SPDX"))
        .collect::<Vec<_>>()
        .join("\n");
    Some(format!(
        "# aphrody — home agent (câblé dans agy)\n\nCe bloc est le pont natif entre le **home \
         agent aphrody** (identité/soul/mémoire, servis aussi via le serveur MCP `aphrody`) et \
         l'écosystème **yolo** (skills autonomes enregistrés dans \
         `~/.gemini/config/skills.json`).\n\n{}",
        persona.trim()
    ))
}

/// Upsert the managed persona block into `existing`, preserving any surrounding
/// user content. Replaces a prior block in place; otherwise appends.
fn upsert_block(existing: &str, block: &str) -> String {
    if let (Some(begin), Some(end)) = (existing.find(PERSONA_BEGIN), existing.find(PERSONA_END)) {
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

/// Write the managed persona block into `~/.gemini/{AGENTS,GEMINI}.md`.
fn ensure_persona(gemini_dir: &Path, body: &str) -> std::io::Result<bool> {
    let block = format!("{PERSONA_BEGIN}\n{body}\n{PERSONA_END}\n");
    let mut changed = false;
    for name in ["AGENTS.md", "GEMINI.md"] {
        let path = gemini_dir.join(name);
        let existing = std::fs::read_to_string(&path).unwrap_or_default();
        let merged = upsert_block(&existing, &block);
        if merged != existing {
            std::fs::create_dir_all(gemini_dir)?;
            std::fs::write(&path, merged)?;
            changed = true;
        }
    }
    Ok(changed)
}

/// Provision `agy`'s customization root with aphrody's home agent + yolo.
///
/// Best-effort and idempotent: every step logs and swallows its own error so a
/// provisioning hiccup never blocks the `agy` session. Honors
/// `APHRODY_AGY_NO_PROVISION`.
pub(crate) fn provision(repo_root: Option<&Path>) -> Provisioned {
    let mut out = Provisioned::default();
    if std::env::var_os("APHRODY_AGY_NO_PROVISION").is_some() {
        return out;
    }
    let Some(gemini) = gemini_dir() else {
        return out;
    };
    let config = gemini.join("config");

    match ensure_mcp(&config) {
        Ok(c) => out.mcp = c,
        Err(e) => eprintln!("aphrody agy: échec mcp_config.json ({e})"),
    }

    let mut skill_dirs = Vec::new();
    if let Some(root) = repo_root {
        let yolo = yolo_root(root).join("skills");
        if yolo.is_dir() {
            skill_dirs.push(yolo);
        }
    }
    match ensure_skills(&config, &skill_dirs) {
        Ok(c) => out.skills = c,
        Err(e) => eprintln!("aphrody agy: échec skills.json ({e})"),
    }

    if let Some(body) = persona_body(repo_root) {
        match ensure_persona(&gemini, &body) {
            Ok(c) => out.persona = c,
            Err(e) => eprintln!("aphrody agy: échec AGENTS.md/GEMINI.md ({e})"),
        }
    }

    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn upsert_inserts_then_replaces_in_place() {
        let block_a = format!("{PERSONA_BEGIN}\nA\n{PERSONA_END}\n");
        let block_b = format!("{PERSONA_BEGIN}\nB\n{PERSONA_END}\n");

        // Insert into user content: the user's text is preserved.
        let base = "# user rules\nkeep me\n";
        let once = upsert_block(base, &block_a);
        assert!(once.contains("keep me"));
        assert!(once.contains("\nA\n"));

        // Replacing is idempotent in shape and swaps only the managed body.
        let twice = upsert_block(&once, &block_b);
        assert!(twice.contains("keep me"));
        assert!(twice.contains("\nB\n"));
        assert!(!twice.contains("\nA\n"));
        assert_eq!(twice.matches(PERSONA_BEGIN).count(), 1);
        assert_eq!(twice.matches(PERSONA_END).count(), 1);
    }

    #[test]
    fn ensure_skills_dedups_entries() {
        let tmp = std::env::temp_dir().join(format!("aphrody-agy-prov-{}", std::process::id()));
        std::fs::create_dir_all(&tmp).unwrap();
        let skills = tmp.join("skills");
        std::fs::create_dir_all(&skills).unwrap();

        assert!(ensure_skills(&tmp, std::slice::from_ref(&skills)).unwrap());
        // Second pass with the same dir must not duplicate the entry.
        assert!(!ensure_skills(&tmp, std::slice::from_ref(&skills)).unwrap());

        let text = std::fs::read_to_string(tmp.join("skills.json")).unwrap();
        let v: Value = serde_json::from_str(&text).unwrap();
        assert_eq!(v["entries"].as_array().unwrap().len(), 1);
        let _ = std::fs::remove_dir_all(&tmp);
    }
}
