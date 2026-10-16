// SPDX-License-Identifier: Apache-2.0
use pretty_assertions::assert_eq;

use super::*;

#[test]
fn approval_default_is_never() {
    assert_eq!(AskForApproval::default(), AskForApproval::Never);
}

#[test]
fn sandbox_default_is_workspace_write() {
    assert_eq!(SandboxMode::default(), SandboxMode::WorkspaceWrite);
}

#[test]
fn approval_round_trips_every_variant() {
    for policy in [
        AskForApproval::Untrusted,
        AskForApproval::OnFailure,
        AskForApproval::OnRequest,
        AskForApproval::Never,
    ] {
        let json = serde_json::to_string(&policy).expect("serialize");
        let back: AskForApproval = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(back, policy);
    }
}

#[test]
fn sandbox_round_trips_every_variant() {
    for mode in [
        SandboxMode::ReadOnly,
        SandboxMode::WorkspaceWrite,
        SandboxMode::DangerFullAccess,
    ] {
        let json = serde_json::to_string(&mode).expect("serialize");
        let back: SandboxMode = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(back, mode);
    }
}

#[test]
fn approval_kebab_case_names() {
    assert_eq!(AskForApproval::OnFailure.as_str(), "on-failure");
    assert_eq!(AskForApproval::OnRequest.as_str(), "on-request");
}

#[test]
fn sandbox_kebab_case_names() {
    assert_eq!(SandboxMode::DangerFullAccess.as_str(), "danger-full-access");
}

#[test]
fn approval_rejects_unknown() {
    let err = serde_json::from_str::<AskForApproval>("\"maybe\"").expect_err("unknown");
    assert!(err.to_string().contains("maybe"));
}

#[test]
fn sandbox_rejects_unknown() {
    let err = serde_json::from_str::<SandboxMode>("\"none\"").expect_err("unknown");
    assert!(err.to_string().contains("none"));
}
