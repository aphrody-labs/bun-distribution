// SPDX-License-Identifier: Apache-2.0
//! Catalog and in-process Rust dispatch checks.

use std::collections::BTreeSet;

use aphrody_winclean::{TOOL_NAMES, catalog};
use sha2::{Digest as _, Sha256};

#[test]
fn embedded_catalog_matches_generated_bindings() {
    let mut embedded: Vec<&str> = catalog().iter().map(|t| t.name.as_str()).collect();
    embedded.sort_unstable();
    let mut generated = TOOL_NAMES.to_vec();
    generated.sort_unstable();
    assert_eq!(
        embedded, generated,
        "regenerate the checked-in Rust catalog"
    );
    assert!(catalog().iter().any(|t| t.name == "computer_observe"));
}

#[test]
fn migration_ledger_is_complete_and_has_unambiguous_owners() {
    #[derive(serde::Deserialize)]
    struct Rule {
        owner: String,
        prefixes: Vec<String>,
    }
    #[derive(serde::Deserialize)]
    struct Ledger {
        catalog_sha256: String,
        catalog_tool_count: usize,
        state: String,
        dispatch: String,
        tools: Vec<String>,
        owner_rules: Vec<Rule>,
    }

    let ledger: Ledger = serde_json::from_str(include_str!("../tool-migration.json"))
        .expect("tool migration ledger must be valid JSON");
    assert_eq!(ledger.catalog_tool_count, TOOL_NAMES.len());
    let normalized_catalog = aphrody_winclean::CATALOG_JSON.replace("\r\n", "\n");
    assert_eq!(
        ledger.catalog_sha256,
        Sha256::digest(normalized_catalog.as_bytes())
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect::<String>(),
        "catalog schema changed; update the reviewed ledger hash",
    );
    assert_eq!(ledger.state, "complete");
    assert_eq!(ledger.dispatch, "rust");

    let ledger_names: BTreeSet<_> = ledger.tools.iter().map(String::as_str).collect();
    let catalog_names: BTreeSet<_> = TOOL_NAMES.into_iter().collect();
    assert_eq!(
        ledger.tools.len(),
        ledger_names.len(),
        "ledger has duplicate tool names"
    );
    assert_eq!(
        ledger_names, catalog_names,
        "ledger and frozen catalog differ"
    );

    for tool in TOOL_NAMES {
        let matching: Vec<_> = ledger
            .owner_rules
            .iter()
            .filter(|rule| {
                rule.prefixes
                    .iter()
                    .any(|prefix| prefix == "*" || tool == prefix || tool.starts_with(prefix))
            })
            .collect();
        assert!(!matching.is_empty(), "{tool} has no Rust owner");
        assert_eq!(
            matching.last().map(|rule| rule.owner.as_str()),
            Some("aphrody-winclean"),
            "the fallback owner must remain last for deterministic first-match ownership"
        );
    }
}

#[cfg(windows)]
mod live {
    use aphrody_winclean::{GetOsInfoArgs, TOOL_NAMES, Winclean};

    #[test]
    fn rust_catalog_matches_vendored_bindings() {
        let wc = Winclean::load().unwrap();
        let mut live: Vec<String> = wc
            .list_tools()
            .unwrap()
            .into_iter()
            .map(|t| t.name)
            .collect();
        live.sort();
        let mut generated = TOOL_NAMES.to_vec();
        generated.sort_unstable();
        assert_eq!(
            live, generated,
            "Rust catalog and vendored bindings diverge"
        );
    }

    #[tokio::test]
    async fn sync_and_async_calls() {
        let wc = Winclean::load().unwrap();
        let os: serde_json::Value = wc
            .get_os_info(&GetOsInfoArgs::default())
            .unwrap()
            .json()
            .unwrap();
        assert!(os["BuildNumber"].is_string());
        assert!(
            !wc.get_os_info_async(&GetOsInfoArgs::default())
                .await
                .unwrap()
                .is_error
        );
        assert!(
            wc.call("does_not_exist", &serde_json::json!({}))
                .unwrap()
                .ok()
                .is_err()
        );
    }
}

#[test]
fn rust_client_loads_on_all_targets() {
    assert!(aphrody_winclean::Winclean::load().is_ok());
}
