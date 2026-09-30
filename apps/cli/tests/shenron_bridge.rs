// SPDX-License-Identifier: Apache-2.0
//
// Integration tests for `aphrody shenron` sovereign bridge subcommands.
#![cfg(not(target_arch = "wasm32"))]

use assert_cmd::Command;
use predicates::prelude::*;

fn aphrody() -> Command {
    Command::cargo_bin("aphrody").expect("aphrody binary must be present in cargo target dir")
}

#[test]
fn shenron_doctor_text_output() {
    aphrody()
        .args(["shenron", "doctor"])
        .assert()
        .success()
        .stdout(predicate::str::contains("Diagnostic du Pont Souverain Shenron"))
        .stdout(predicate::str::contains("Dépôt Shenron"))
        .stdout(predicate::str::contains(
            "Conclusion : Le pont Aphrody <-> Shenron est opérationnel.",
        ));
}

#[test]
fn shenron_doctor_json_output() {
    let home = tempfile::tempdir().expect("temporary Shenron home");
    std::fs::write(
        home.path().join("admin_credentials.json"),
        r#"{"betterAuth":{"email":"private@example.test"},"agentKey":{"displayPrefix":"private-prefix","scopes":["private-scope"]}}"#,
    )
    .expect("write credential presence fixture");
    let assert = aphrody()
        .env("APHRODY_SHENRON_HOME", home.path())
        .args(["shenron", "doctor", "--json"])
        .assert()
        .success();

    let stdout = String::from_utf8_lossy(&assert.get_output().stdout);
    let parsed: serde_json::Value = serde_json::from_str(stdout.trim())
        .expect("shenron doctor --json should output valid JSON");

    assert_eq!(parsed["pillar"], "shenron_sovereign_bridge");
    assert_eq!(parsed["status"], "operational");
    assert!(parsed["filesystem"]["shenron_root"].is_string());
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
    aphrody()
        .args(["shenron", "web", "status"])
        .assert()
        .success()
        .stdout(predicate::str::contains("Pont Web Shenron / Aphrody Web"))
        .stdout(predicate::str::contains("BXC Engine"));
}

#[test]
fn shenron_infra_status_output() {
    aphrody()
        .args(["shenron", "infra", "status"])
        .assert()
        .success()
        .stdout(predicate::str::contains("Infrastructure Shenron / Dragon Ball FR"))
        .stdout(predicate::str::contains("vps.dragonballfr.com"));
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
