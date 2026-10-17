// SPDX-License-Identifier: Apache-2.0
use std::path::Path;

use aphrody_agent_home::{AgentHome, Bluntness, BootstrapBudget, Brevity, HomeOptions, Humor};

// Integration fixtures stay synthetic: no dependency on private Agent Homes,
// migrated checkout paths, environment variables, or Google Docs contents.
fn fixture(profile: &str) -> (tempfile::TempDir, std::path::PathBuf) {
    let root = tempfile::tempdir().expect("temporary fixture");
    let workspace = root.path().join("workspaces").join(profile);
    std::fs::create_dir_all(&workspace).expect("fixture workspace");
    write(
        &workspace,
        "SOUL.md",
        "---\ntone: souverain, précis\nbrevity: terse\nhumor: dry\ndefault_bluntness: frank\n---\n\nTu es Shenron, inspiré par Akira Toriyama.\n",
    );
    write(
        &workspace,
        "AGENTS.md",
        "# Règles\nVérifie les sources Dragon Ball.\n",
    );
    write(
        &workspace,
        "USER.md",
        "# Utilisateur\nUtilisateur de qualification synthétique.\n",
    );
    write(
        &workspace,
        "TOOLS.md",
        "# Outils\nInventaire synthétique de qualification.\n",
    );
    (root, workspace)
}

fn write(root: &Path, name: &str, content: &str) {
    std::fs::write(root.join(name), content).expect("write synthetic fixture");
}

#[test]
fn test_open_agent_home_dbfr() {
    let (_fixture, workspace) = fixture("dbfr");
    let options = HomeOptions {
        workspace: Some(workspace.clone()),
        profile: Some("dbfr".to_string()),
        ..Default::default()
    };
    let home = AgentHome::open(options).expect("failed to open dbfr agent home");

    assert_eq!(home.root(), workspace);
    // Verify the explicit canonical workspace retains its domain.
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
    let (_fixture, workspace) = fixture("shenron");
    let options = HomeOptions {
        workspace: Some(workspace.clone()),
        profile: Some("shenron".to_string()),
        ..Default::default()
    };
    let home = AgentHome::open(options).expect("failed to open shenron agent home");

    assert_eq!(home.root(), workspace);
    assert!(
        home.soul().is_some(),
        "SOUL.md must be present for shenron profile"
    );
    let budget = BootstrapBudget::default();
    let prompt = home.system_prompt(&budget).render();
    assert!(prompt.contains("Shenron") || prompt.contains("Toriyama"));
}

#[test]
fn test_open_explicit_dbfr_workspace_with_shenron_persona() {
    let (_fixture, workspace) = fixture("dbfr");
    // Shenron is a persona of the dbfr workspace; its source crate does not
    // own a second checked-in home or the user's persistent documents.
    let options = HomeOptions {
        workspace: Some(workspace.clone()),
        ..Default::default()
    };
    let home = AgentHome::open(options).expect("failed to open explicit dbfr home");
    assert_eq!(home.root(), workspace);
    let soul = home.soul().expect("dbfr SOUL.md must be parsed");
    assert!(soul.body.contains("Shenron"));
    let budget = BootstrapBudget::default();
    let prompt = home.system_prompt(&budget).render();
    assert!(prompt.contains("Shenron"));
}
