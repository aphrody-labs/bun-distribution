// SPDX-License-Identifier: Apache-2.0
//
// Integration tests for `aphrody shenron` sovereign bridge subcommands.
#![cfg(not(target_arch = "wasm32"))]

use assert_cmd::Command;
use predicates::prelude::*;

fn aphrody() -> Command {
    Command::cargo_bin("aphrody").expect("aphrody binary must be present in cargo target dir")
}

/// `aphrody` with every Shenron endpoint on a closed loopback port and no Aphrody AI profile,
/// so the bridge probes are hermetic and always report `degraded`.
fn offline_shenron() -> Command {
    let mut command = aphrody();
    command
        .env("SHENRON_SITE_URL", "http://127.0.0.1:9")
        .env("SHENRON_API_URL", "http://127.0.0.1:9")
        .env("APHRODY_AI_HTTP_URL", "")
        .env("APHRODY_SHENRON_API_URL", "")
        .env("SHENRON_ROOT", "/nonexistent-shenron-root");
    command
}

#[test]
fn shenron_doctor_text_output() {
    offline_shenron()
        .args(["shenron", "doctor"])
        .assert()
        .success()
        .stdout(predicate::str::contains("Shenron: degraded"))
        .stdout(predicate::str::contains("Site /wiki/personnages:"))
        .stdout(predicate::str::contains("Bot /api/health/check:"))
        .stdout(predicate::str::contains("Agent Home dbfr:"));
}

#[test]
fn shenron_doctor_json_output() {
    let home = tempfile::tempdir().expect("temporary Shenron home");
    std::fs::write(
        home.path().join("admin_credentials.json"),
        r#"{"betterAuth":{"email":"private@example.test"},"agentKey":{"displayPrefix":"private-prefix","scopes":["private-scope"]}}"#,
    )
    .expect("write credential presence fixture");
    let assert = offline_shenron()
        .env("APHRODY_SHENRON_HOME", home.path())
        .args(["shenron", "doctor", "--json"])
        .assert()
        .success();

    let stdout = String::from_utf8_lossy(&assert.get_output().stdout);
    let parsed: serde_json::Value = serde_json::from_str(stdout.trim())
        .expect("shenron doctor --json should output valid JSON");

    assert_eq!(parsed["pillar"], "shenron_sovereign_bridge");
    assert_eq!(parsed["status"], "degraded");
    assert_eq!(parsed["site"]["reachable"], false);
    assert_eq!(parsed["bot"]["reachable"], false);
    assert!(parsed["auth"]["configured"].as_bool().unwrap_or(false));
    assert!(parsed["auth"]["admin_credentials_present"].as_bool().unwrap_or(false));
    assert_eq!(parsed["auth"].as_object().unwrap().len(), 2);
    assert!(!stdout.contains("private@example.test"));
    assert!(!stdout.contains("private-prefix"));
    assert!(!stdout.contains("private-scope"));
}

#[test]
fn shenron_persona_prompt_output() {
    aphrody()
        .args(["shenron", "persona", "prompt"])
        .assert()
        .success()
        .stdout(predicate::str::contains("Akira Toriyama"))
        .stdout(predicate::str::contains("Tori-bot"))
        .stdout(predicate::str::contains("Daizenshuu"));
}

#[test]
fn shenron_web_status_output() {
    offline_shenron()
        .args(["shenron", "web", "status"])
        .assert()
        .success()
        .stdout(predicate::str::contains("Site Shenron: {\"reachable\":false}"))
        .stdout(predicate::str::contains("API wiki:"));
}

#[test]
fn shenron_infra_status_output() {
    offline_shenron()
        .args(["shenron", "infra", "status"])
        .assert()
        .success()
        .stdout(predicate::str::contains("Shenron: degraded"))
        .stdout(predicate::str::contains("Site /wiki/personnages:"));
}

#[test]
fn shenron_auth_status_output() {
    let home = tempfile::tempdir().expect("temporary Shenron home");
    std::fs::write(
        home.path().join("admin_credentials.json"),
        r#"{"betterAuth":{"email":"private@example.test"},"agentKey":{"name":"private-agent"}}"#,
    )
    .expect("write credential presence fixture");
    let output = aphrody()
        .env("APHRODY_SHENRON_HOME", home.path())
        .args(["shenron", "auth", "status"])
        .assert()
        .success()
        .stdout(predicate::str::contains("Présence des identifiants d'administration locaux"))
        .stdout(predicate::str::contains("Fichier d'identifiants : présent"))
        .get_output()
        .stdout
        .clone();
    let output = String::from_utf8_lossy(&output);
    assert!(!output.contains("private@example.test"));
    assert!(!output.contains("private-agent"));
    assert!(!output.contains("contact@"));
    assert!(!output.contains("Portées Agent"));
    assert!(!output.contains("Session Better Auth :     active"));
}

#[test]
fn shenron_auth_status_json() {
    let home = tempfile::tempdir().expect("temporary Shenron home");
    std::fs::write(home.path().join("admin_credentials.json"), "{}")
        .expect("write credential presence fixture");
    let assert = aphrody()
        .env("APHRODY_SHENRON_HOME", home.path())
        .args(["shenron", "auth", "status", "--json"])
        .assert()
        .success();

    let stdout = String::from_utf8_lossy(&assert.get_output().stdout);
    let parsed: serde_json::Value = serde_json::from_str(stdout.trim())
        .expect("shenron auth status --json should output valid JSON");

    assert!(parsed["configured"].as_bool().unwrap_or(false));
    assert!(parsed["admin_credentials_present"].as_bool().unwrap_or(false));
    assert_eq!(parsed.as_object().unwrap().len(), 2);
}

#[test]
fn shenron_auth_url_never_includes_the_master_token() {
    let home = tempfile::tempdir().expect("temporary Shenron home");
    std::fs::write(
        home.path().join("admin_credentials.json"),
        r#"{"masterToken":"secret-master-token-fixture"}"#,
    )
    .expect("write credential fixture");

    let output = aphrody()
        .env("APHRODY_SHENRON_HOME", home.path())
        .args([
            "shenron",
            "auth",
            "url",
            "--site",
            "https://example.test",
            "--raw",
        ])
        .assert()
        .success()
        .get_output()
        .stdout
        .clone();
    let output = String::from_utf8_lossy(&output);

    assert_eq!(output.trim(), "https://example.test/admin-access");
    assert!(!output.contains("secret-master-token-fixture"));
}
