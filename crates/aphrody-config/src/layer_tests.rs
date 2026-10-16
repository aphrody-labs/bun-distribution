// SPDX-License-Identifier: Apache-2.0
use pretty_assertions::assert_eq;

use super::*;

fn table(pairs: &[(&str, toml::Value)]) -> toml::Value {
    let mut t = toml::value::Table::new();
    for (k, v) in pairs {
        t.insert((*k).to_string(), v.clone());
    }
    toml::Value::Table(t)
}

#[test]
fn later_scalar_wins() {
    let mut base = table(&[("model", toml::Value::String("a".into()))]);
    let overlay = table(&[("model", toml::Value::String("b".into()))]);
    merge_toml_values(&mut base, &overlay);
    assert_eq!(base.get("model").unwrap().as_str(), Some("b"));
}

#[test]
fn tables_merge_recursively_key_by_key() {
    let mut base: toml::Value = toml::from_str(
        r"
        [rag]
        enabled = true
        top_k = 10
        ",
    )
    .unwrap();
    let overlay: toml::Value = toml::from_str(
        r"
        [rag]
        top_k = 20
        ",
    )
    .unwrap();
    merge_toml_values(&mut base, &overlay);
    let rag = base.get("rag").unwrap();
    assert_eq!(rag.get("enabled").unwrap().as_bool(), Some(true));
    assert_eq!(rag.get("top_k").unwrap().as_integer(), Some(20));
}

#[test]
fn arrays_are_replaced_wholesale_never_concatenated() {
    let mut base = table(&[(
        "notify",
        toml::Value::Array(vec![toml::Value::String("a".into())]),
    )]);
    let overlay = table(&[(
        "notify",
        toml::Value::Array(vec![
            toml::Value::String("b".into()),
            toml::Value::String("c".into()),
        ]),
    )]);
    merge_toml_values(&mut base, &overlay);
    let notify = base.get("notify").unwrap().as_array().unwrap();
    assert_eq!(notify.len(), 2);
}

#[test]
fn merge_layers_folds_in_order_later_wins() {
    let layers = vec![
        ConfigLayer::new(LayerSource::Builtin, table(&[("model", "builtin".into())])),
        ConfigLayer::new(LayerSource::User, table(&[("model", "user".into())])),
        ConfigLayer::new(LayerSource::Flag, table(&[("model", "flag".into())])),
    ];
    let merged = merge_layers(&layers);
    assert_eq!(merged.get("model").unwrap().as_str(), Some("flag"));
}

#[test]
fn every_layer_source_pair_respects_precedence() {
    let order = [
        LayerSource::Builtin,
        LayerSource::CodexCompat,
        LayerSource::User,
        LayerSource::Project,
        LayerSource::Profile,
        LayerSource::CliOverride,
        LayerSource::Flag,
    ];
    for i in 0..order.len() {
        for j in (i + 1)..order.len() {
            let layers = vec![
                ConfigLayer::new(order[i], table(&[("x", "low".into())])),
                ConfigLayer::new(order[j], table(&[("x", "high".into())])),
            ];
            let merged = merge_layers(&layers);
            assert_eq!(
                merged.get("x").unwrap().as_str(),
                Some("high"),
                "{:?} should not beat {:?}",
                order[i],
                order[j]
            );
        }
    }
}

#[test]
fn restrict_codex_layer_keeps_only_mcp_servers_and_model_providers() {
    let codex_config: toml::Value = toml::from_str(
        r#"
        model = "gpt-5.2"
        model_provider = "openai"
        approval_policy = "on-request"

        [mcp_servers.example]
        command = "example-mcp"

        [model_providers.custom]
        name = "Custom"
        "#,
    )
    .unwrap();

    let restricted = restrict_codex_layer(codex_config);
    let table = restricted.as_table().unwrap();
    assert_eq!(table.len(), 2);
    assert!(table.contains_key("mcp_servers"));
    assert!(table.contains_key("model_providers"));
    assert!(!table.contains_key("model"));
    assert!(!table.contains_key("model_provider"));
    assert!(!table.contains_key("approval_policy"));
}

#[test]
fn restrict_codex_layer_on_non_table_yields_empty_table() {
    let restricted = restrict_codex_layer(toml::Value::String("not a table".into()));
    assert_eq!(restricted, toml::Value::Table(toml::value::Table::new()));
}
