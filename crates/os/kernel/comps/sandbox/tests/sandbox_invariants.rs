// SPDX-License-Identifier: Apache-2.0
use std::{
    path::{Path, PathBuf},
    time::Duration,
};

use aphrody_sandbox::{
    CommandRunner, MockCommandRunner, RunnerError, SandboxDenialKind, SandboxPolicy,
    SandboxedCommandRunner, classify_denial, probe, verify_patch_paths,
};

#[test]
fn test_probe_invariants() {
    let report = probe();
    assert!(report.filesystem.is_available());
    assert!(!report.details.is_empty());
}

#[test]
fn test_policy_path_containment() {
    let ws = if cfg!(windows) {
        PathBuf::from(r"C:\aphrody\repo")
    } else {
        PathBuf::from("/aphrody/repo")
    };

    let policy = SandboxPolicy::workspace_write(&ws);

    // Writable targets
    assert!(policy.is_path_writable(ws.join("src").join("main.rs")));
    assert!(policy.is_path_writable(ws.join("Cargo.toml")));
    assert!(policy.is_path_writable(ws.join("docs").join("ARCHITECTURE.md")));

    // Strictly forbidden: .git metadata
    assert!(!policy.is_path_writable(ws.join(".git").join("HEAD")));
    assert!(!policy.is_path_writable(ws.join(".git").join("objects").join("pack")));

    // Strictly forbidden: .aphrody store
    assert!(!policy.is_path_writable(ws.join(".aphrody").join("sessions")));

    // Strictly forbidden: outside workspace
    let foreign = if cfg!(windows) {
        PathBuf::from(r"C:\Windows\System32\drivers\etc\hosts")
    } else {
        PathBuf::from("/etc/shadow")
    };
    assert!(!policy.is_path_writable(&foreign));
}

#[test]
fn test_patch_guard_behavior() {
    let ws = if cfg!(windows) {
        PathBuf::from(r"C:\aphrody\repo")
    } else {
        PathBuf::from("/aphrody/repo")
    };
    let policy = SandboxPolicy::workspace_write(&ws);

    let clean_patch = [ws.join("src").join("lib.rs"), ws.join("tests").join("t.rs")];
    let refs: Vec<&Path> = clean_patch.iter().map(PathBuf::as_path).collect();
    assert!(verify_patch_paths(refs, &policy).is_ok());

    let bad_patch = [ws.join("src").join("lib.rs"), ws.join(".git").join("index")];
    let bad_refs: Vec<&Path> = bad_patch.iter().map(PathBuf::as_path).collect();
    let err = verify_patch_paths(bad_refs, &policy).expect_err("should block .git target");
    assert_eq!(err.kind, SandboxDenialKind::ReadOnlyProtectedSubpath);
}

#[test]
fn test_denial_classification() {
    let d1 =
        classify_denial(1, "cat: /etc/shadow: Permission denied").expect("should detect EACCES");
    assert_eq!(d1.kind, SandboxDenialKind::RestrictedExecution);

    let d2 = classify_denial(1, "curl: (7) Failed to connect to 1.1.1.1: Network is unreachable")
        .expect("should detect network block");
    assert_eq!(d2.kind, SandboxDenialKind::NetworkBlocked);
    assert!(d2.to_structured_feedback().contains("aphrody-web web_search"));
}

#[tokio::test]
async fn test_mock_command_runner() {
    let runner = MockCommandRunner::default();
    let policy = SandboxPolicy::default();
    let res = runner
        .run(&["git".to_string(), "status".to_string()], None, &policy, Duration::from_secs(5))
        .await
        .expect("mock runner should succeed");

    assert_eq!(res.exit_code, 0);
    assert_eq!(res.stdout, "mock output");
}

#[tokio::test]
async fn restricted_runner_fails_before_spawning() {
    let result = SandboxedCommandRunner::new()
        .run(
            &["command-that-does-not-exist".to_owned()],
            None,
            &SandboxPolicy::default(),
            Duration::from_secs(1),
        )
        .await;
    assert!(matches!(result, Err(RunnerError::Policy(_))));
}
