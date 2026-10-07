// SPDX-License-Identifier: Apache-2.0
use std::{collections::BTreeSet, path::Path};

use pretty_assertions::assert_eq;

use super::*;

#[test]
fn resolve_prefers_canonical_then_each_alias_in_order() {
    assert_eq!(EMBED_MODEL.resolve_with(&|_| None), None);
    assert_eq!(
        EMBED_MODEL.resolve_with(
            &|name| (name == "APHRODY_RAG_EMBED_MODEL").then(|| "second-alias".to_owned())
        ),
        Some("second-alias".to_owned())
    );
    assert_eq!(
        EMBED_MODEL.resolve_with(&|name| match name {
            "APHRODY_SHENRON_EMBED_MODEL" => Some("first-alias".to_owned()),
            "APHRODY_RAG_EMBED_MODEL" => Some("second-alias".to_owned()),
            _ => None,
        }),
        Some("first-alias".to_owned()),
        "the first alias in declaration order wins over a later one"
    );
    assert_eq!(
        EMBED_MODEL.resolve_with(&|name| match name {
            "APHRODY_AI_EMBED_MODEL" => Some("canonical".to_owned()),
            "APHRODY_SHENRON_EMBED_MODEL" => Some("alias".to_owned()),
            _ => None,
        }),
        Some("canonical".to_owned()),
        "the canonical name wins over any alias"
    );
}

#[test]
fn blank_values_count_as_unset() {
    assert_eq!(EMBED_MODEL.resolve_with(&|_| Some("   ".to_owned())), None);
}

#[test]
fn resolve_source_reports_which_name_supplied_the_value() {
    assert_eq!(EMBED_MODEL.resolve_source_with(&|_| None), None);
    assert_eq!(
        EMBED_MODEL.resolve_source_with(&|name| (name == "APHRODY_AI_EMBED_MODEL")
            .then(|| "v".to_owned())),
        Some("APHRODY_AI_EMBED_MODEL")
    );
    assert_eq!(
        EMBED_MODEL.resolve_source_with(
            &|name| (name == "APHRODY_RAG_EMBED_MODEL").then(|| "v".to_owned())
        ),
        Some("APHRODY_RAG_EMBED_MODEL")
    );
}

#[test]
fn all_eighteen_canonical_names_are_unique() {
    let mut names: Vec<&str> = ALL.iter().map(|v| v.canonical).collect();
    names.sort_unstable();
    let mut deduped = names.clone();
    deduped.dedup();
    assert_eq!(names.len(), 18);
    assert_eq!(names, deduped, "ALL must not repeat a canonical name");
}

#[test]
fn no_alias_shadows_another_variable_s_canonical_name() {
    let canonicals: BTreeSet<&str> = ALL.iter().map(|v| v.canonical).collect();
    for entry in ALL {
        for alias in entry.aliases {
            assert!(
                !canonicals.contains(alias),
                "{alias} aliases {} but is also a canonical name of another variable",
                entry.canonical
            );
        }
    }
}

/// Cross-checks [`ALL`] against `../aphrody-infra/tools/config/local-ai.json`
/// (owned by `aphrody-infra`) when that sibling checkout is present. Skips
/// cleanly otherwise — this repository does not depend on `aphrody-infra`
/// existing on every machine that runs `cargo test`.
#[test]
fn matches_the_aphrody_infra_contract_when_present() {
    let candidate =
        Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../aphrody-infra/tools/config/local-ai.json");
    let Ok(raw) = std::fs::read_to_string(&candidate) else {
        eprintln!(
            "skipping: {} not found (aphrody-infra is a sibling checkout)",
            candidate.display()
        );
        return;
    };
    let contract: serde_json::Value = serde_json::from_str(&raw).expect("valid JSON");

    let mut expected_canonicals = BTreeSet::new();
    let mut collect = |value: &serde_json::Value| {
        let Some(env) = value.get("env").and_then(serde_json::Value::as_array) else { return };
        for entry in env {
            if let Some(name) = entry.get("canonical").and_then(serde_json::Value::as_str) {
                expected_canonicals.insert(name.to_owned());
            }
        }
    };
    for section in ["binaries", "gateways", "capabilities"] {
        let Some(table) = contract.get(section).and_then(serde_json::Value::as_object) else {
            continue;
        };
        for entry in table.values() {
            collect(entry);
        }
    }

    let actual_canonicals: BTreeSet<String> = ALL.iter().map(|v| v.canonical.to_owned()).collect();
    assert_eq!(
        actual_canonicals, expected_canonicals,
        "aphrody-config::ai_env::ALL must name exactly the canonical variables aphrody-infra's \
         contract declares"
    );
}
