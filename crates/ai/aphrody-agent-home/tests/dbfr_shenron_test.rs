// SPDX-License-Identifier: Apache-2.0
use std::path::PathBuf;
use aphrody_agent_home::{AgentHome, BootstrapBudget, HomeOptions, Bluntness, Brevity, Humor};

#[test]
fn test_open_agent_home_dbfr() {
    let options = HomeOptions {
        profile: Some("dbfr".to_string()),
        ..Default::default()
    };
    let home = AgentHome::open(options).expect("failed to open dbfr agent home");

    // Verify workspace path resolves to workspace-dbfr / workspaces/dbfr
    assert!(
        home.root().to_string_lossy().contains("dbfr"),
        "workspace root should contain dbfr: {:?}",
        home.root()
    );

    // Verify SOUL.md is present and parsed
    let soul = home.soul().expect("SOUL.md must be present in dbfr");
    assert_eq!(soul.brevity, Brevity::Terse);
    assert_eq!(soul.humor, Humor::Dry);
    assert_eq!(soul.default_bluntness, Bluntness::Frank);
    assert!(soul.tone.contains("souverain"));
    assert!(soul.body.contains("Akira Toriyama") || soul.body.contains("Shenron"));

    // Verify system prompt rendering
    let budget = BootstrapBudget::default();
    let view = home.system_prompt(&budget);
    let prompt = view.render();
    assert!(prompt.contains("Akira Toriyama") || prompt.contains("Shenron"));
    assert!(prompt.contains("Règles d'opération (AGENTS.md)"));
    assert!(prompt.contains("Âme (SOUL.md)"));
    assert!(prompt.contains("Utilisateur (USER.md)"));
    assert!(prompt.contains("Outils (TOOLS.md)"));
}

#[test]
fn test_open_agent_home_shenron() {
    let options = HomeOptions {
        profile: Some("shenron".to_string()),
        ..Default::default()
    };
    let home = AgentHome::open(options).expect("failed to open shenron agent home");

    assert!(home.soul().is_some(), "SOUL.md must be present for shenron profile");
    let budget = BootstrapBudget::default();
    let prompt = home.system_prompt(&budget).render();
    assert!(prompt.contains("Shenron") || prompt.contains("Toriyama"));
}

#[test]
fn test_open_in_tree_home_shenron() {
    let in_tree = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap()
        .parent()
        .unwrap()
        .join("home")
        .join("shenron");

    assert!(in_tree.exists(), "in-tree home/shenron directory should exist: {:?}", in_tree);
    let options = HomeOptions {
        workspace: Some(in_tree),
        ..Default::default()
    };
    let home = AgentHome::open(options).expect("failed to open in-tree shenron home");
    let soul = home.soul().expect("in-tree SOUL.md must be parsed");
    assert!(soul.body.contains("Shenron"));
    let budget = BootstrapBudget::default();
    let prompt = home.system_prompt(&budget).render();
    assert!(prompt.contains("Shenron"));
}
