// SPDX-License-Identifier: Apache-2.0
use std::fs;

use aphrody_kernel::execpolicy::{ApprovalPolicy, Decision, PolicyParser};

#[test]
fn test_parse_upstream_example_codexpolicy() {
    // Vendored copy of openai/codex `codex-rs/execpolicy/examples/example.codexpolicy`
    // (provenance header inside the fixture).
    let example_path =
        std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/example.codexpolicy");
    let content = fs::read_to_string(&example_path)
        .unwrap_or_else(|e| panic!("{} must be readable: {e}", example_path.display()));

    let parser = PolicyParser::new();
    let policy = parser.parse(&content).expect("parsing upstream example.codexpolicy must succeed");

    assert!(policy.rule_count() >= 8);

    // git reset --hard is forbidden
    let eval_git_reset = policy
        .evaluate(&["git".to_string(), "reset".to_string(), "--hard".to_string()])
        .expect("git reset --hard must match");
    assert_eq!(eval_git_reset.decision, Decision::Forbidden);
    assert_eq!(eval_git_reset.justification.as_deref(), Some("destructive operation"));

    // ls is allowed
    let eval_ls = policy.evaluate(&["ls".to_string(), "-la".to_string()]).expect("ls must match");
    assert_eq!(eval_ls.decision, Decision::Allow);

    // cat is allowed
    let eval_cat =
        policy.evaluate(&["cat".to_string(), "README.md".to_string()]).expect("cat must match");
    assert_eq!(eval_cat.decision, Decision::Allow);

    // cp is prompt
    let eval_cp = policy
        .evaluate(&["cp".to_string(), "src".to_string(), "dst".to_string()])
        .expect("cp must match");
    assert_eq!(eval_cp.decision, Decision::Prompt);

    // No-HITL: cp under Never becomes Forbidden with clear explanation
    let no_hitl_eval = policy.evaluate_with_approval(
        &["cp".to_string(), "src".to_string(), "dst".to_string()],
        ApprovalPolicy::Never,
    );
    assert_eq!(no_hitl_eval.decision, Decision::Forbidden);
    assert!(no_hitl_eval.explanation.expect("must have explanation").contains("No-HITL doctrine"));
}
