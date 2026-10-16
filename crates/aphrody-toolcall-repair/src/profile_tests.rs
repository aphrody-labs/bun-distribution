// SPDX-License-Identifier: Apache-2.0
use pretty_assertions::assert_eq;

use super::*;

#[test]
fn builtin_profiles_cover_every_dialect_and_have_a_default() {
    let profiles = builtin_profiles();
    assert!(profiles.iter().any(|p| p.id == "default"));
    assert!(
        profiles
            .iter()
            .any(|p| p.tool_dialect == ToolDialect::Hermes)
    );
    assert!(
        profiles
            .iter()
            .any(|p| p.tool_dialect == ToolDialect::Qwen3CoderXml)
    );
    assert!(
        profiles
            .iter()
            .any(|p| p.tool_dialect == ToolDialect::MistralToolCalls)
    );
    assert!(
        profiles
            .iter()
            .any(|p| p.tool_dialect == ToolDialect::OpenAiJson)
    );
    assert!(
        profiles
            .iter()
            .any(|p| p.tool_dialect == ToolDialect::BareJson)
    );
    for profile in &profiles {
        assert!(
            !profile.system_preamble.is_empty(),
            "{} has an empty preamble",
            profile.id
        );
        assert!(
            !profile.match_model.is_empty(),
            "{} has no match patterns",
            profile.id
        );
    }
}

#[test]
fn glob_match_basics() {
    assert!(glob_match("qwen2.5-coder*", "qwen2.5-coder-7b-instruct"));
    assert!(glob_match("QWEN2.5-CODER*", "qwen2.5-coder-7b-instruct"));
    assert!(!glob_match("qwen2.5-coder*", "qwen3-coder-30b"));
    assert!(glob_match("*", "anything"));
    assert!(glob_match("llama-3?", "llama-38"));
    assert!(!glob_match("llama-3?", "llama-3-8b"));
    assert!(glob_match("*coder*", "my-qwen3-coder-model"));
}

#[test]
fn select_profile_picks_dialect_by_model_name() {
    let builtin = builtin_profiles();
    let profile = select_profile("qwen3-coder-30b-a3b-instruct", &[], &builtin);
    assert_eq!(profile.id, "qwen3-coder");

    let profile = select_profile("Meta-Llama-3.1-8B-Instruct", &[], &builtin);
    assert_eq!(profile.id, "llama-3");

    let profile = select_profile("gpt-oss-20b", &[], &builtin);
    assert_eq!(profile.id, "gpt-oss");
}

#[test]
fn select_profile_falls_back_to_default() {
    let builtin = builtin_profiles();
    let profile = select_profile("some-totally-unknown-model", &[], &builtin);
    assert_eq!(profile.id, "default");
}

#[test]
fn select_profile_user_override_wins_over_builtin() {
    let builtin = builtin_profiles();
    let user = vec![PromptProfile {
        id: "custom-qwen".to_string(),
        match_model: vec!["qwen2.5-coder*".to_string()],
        system_preamble: "custom preamble".to_string(),
        tool_dialect: ToolDialect::Hermes,
        apply_patch_format: PatchFormat::UnifiedDiff,
        parallel_tools: true,
        max_tools: None,
        grammar: GrammarMode::None,
        temperature: None,
        stop: Vec::new(),
    }];
    let profile = select_profile("qwen2.5-coder-7b-instruct", &user, &builtin);
    assert_eq!(profile.id, "custom-qwen");
}

#[test]
fn select_profile_most_specific_pattern_wins() {
    let builtin = vec![
        PromptProfile {
            id: "generic-coder".to_string(),
            match_model: vec!["*coder*".to_string()],
            system_preamble: "generic".to_string(),
            tool_dialect: ToolDialect::BareJson,
            apply_patch_format: PatchFormat::CodexPatch,
            parallel_tools: false,
            max_tools: None,
            grammar: GrammarMode::None,
            temperature: None,
            stop: Vec::new(),
        },
        PromptProfile {
            id: "specific-qwen3-coder".to_string(),
            match_model: vec!["qwen3-coder*".to_string()],
            system_preamble: "specific".to_string(),
            tool_dialect: ToolDialect::Qwen3CoderXml,
            apply_patch_format: PatchFormat::CodexPatch,
            parallel_tools: true,
            max_tools: None,
            grammar: GrammarMode::None,
            temperature: None,
            stop: Vec::new(),
        },
    ];
    let profile = select_profile("qwen3-coder-30b", &[], &builtin);
    assert_eq!(profile.id, "specific-qwen3-coder");
}

#[test]
fn prompt_profile_round_trips_through_serde() {
    let profile = builtin_profiles()
        .into_iter()
        .find(|p| p.id == "qwen3-coder")
        .unwrap();
    let text = serde_json::to_string(&profile).unwrap();
    let back: PromptProfile = serde_json::from_str(&text).unwrap();
    assert_eq!(profile, back);
}
