// SPDX-License-Identifier: Apache-2.0
#![cfg(not(target_arch = "wasm32"))]

#[path = "../src/codex_provision.rs"]
mod codex_provision;

use std::fs;

use tempfile::tempdir;

#[test]
fn test_codex_provision_config_and_persona() {
    let tmp = tempdir().expect("tempdir");
    let codex_dir = tmp.path();

    // 1. Initial config upsert test
    let initial = "# My custom codex configuration\nmodel = \"o3-mini\"\n";
    let config_path = codex_dir.join("config.toml");
    fs::write(&config_path, initial).expect("write initial config");

    let (c1, did_change1) = codex_provision::upsert_server_section(
        initial,
        "aphrody",
        "C:/bin/aphrody-kernel.exe",
        &["mcp"],
    );
    assert!(did_change1);
    assert!(c1.contains("[mcp_servers.aphrody]"));
    assert!(c1.contains("command = \"C:/bin/aphrody-kernel.exe\""));
    assert!(c1.contains("args = [\"mcp\"]"));
    assert!(c1.contains("# My custom codex configuration"));

    // 2. Second run must be idempotent (no change)
    let (c2, did_change2) = codex_provision::upsert_server_section(
        &c1,
        "aphrody",
        "C:/bin/aphrody-kernel.exe",
        &["mcp"],
    );
    assert!(!did_change2);
    assert_eq!(c1, c2);

    // 3. A legacy bxc server (and its sub-table) is removed; aphrody and comments stay.
    let legacy = format!(
        "{c1}\n[mcp_servers.bxc]\ncommand = 'bxc'\nargs = [\"mcp\"]\n\n[mcp_servers.bxc.env]\nX = \
         \"1\"\n\n[profiles.fast]\nmodel = \"m\"\n"
    );
    let (c3, did_change3) = codex_provision::remove_server_section(&legacy, "bxc");
    assert!(did_change3);
    assert!(c3.contains("[mcp_servers.aphrody]"));
    assert!(!c3.contains("[mcp_servers.bxc"));
    assert!(c3.contains("[profiles.fast]"));
    assert!(c3.contains("# My custom codex configuration"));
    let (_, again) = codex_provision::remove_server_section(&c3, "bxc");
    assert!(!again);

    // 4. Persona block injection into AGENTS.md
    let agents_path = codex_dir.join("AGENTS.md");
    let initial_agents = "# Existing Agent Guidelines\n\nSome guidelines here.\n";
    fs::write(&agents_path, initial_agents).expect("write initial agents");

    let changed_persona =
        codex_provision::ensure_persona(codex_dir, "Rule 1: No HITL").expect("ensure persona");
    assert!(changed_persona);

    let content_agents = fs::read_to_string(&agents_path).expect("read agents");
    assert!(content_agents.contains("Rule 1: No HITL"));
    assert!(content_agents.contains("<!-- BEGIN aphrody-codex"));
    assert!(content_agents.contains("<!-- END aphrody-codex -->"));
    assert!(content_agents.contains("# Existing Agent Guidelines"));

    // 5. Persona idempotency
    let changed_persona2 =
        codex_provision::ensure_persona(codex_dir, "Rule 1: No HITL").expect("ensure persona 2");
    assert!(!changed_persona2);
}
