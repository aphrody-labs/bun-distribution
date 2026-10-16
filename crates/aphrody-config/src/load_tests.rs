// SPDX-License-Identifier: Apache-2.0
use pretty_assertions::assert_eq;

use super::*;

#[test]
fn missing_file_returns_none_not_an_error() {
    let dir = tempfile::tempdir().expect("tempdir");
    let path = dir.path().join("does-not-exist.toml");
    let result = load_toml_file(&path).expect("missing file is not an error");
    assert_eq!(result, None);
}

#[test]
fn existing_file_parses() {
    let dir = tempfile::tempdir().expect("tempdir");
    let path = dir.path().join("config.toml");
    std::fs::write(&path, "model = \"gpt-5-codex\"\n").expect("write fixture");
    let value = load_toml_file(&path).expect("load").expect("present");
    assert_eq!(value.get("model").unwrap().as_str(), Some("gpt-5-codex"));
}

#[test]
fn invalid_toml_is_a_parse_error() {
    let dir = tempfile::tempdir().expect("tempdir");
    let path = dir.path().join("config.toml");
    std::fs::write(&path, "this is not = = valid toml").expect("write fixture");
    let err = load_toml_file(&path).expect_err("invalid toml");
    assert!(matches!(err, LoadError::Parse { .. }));
}

#[test]
fn user_layer_tags_source_correctly() {
    let dir = tempfile::tempdir().expect("tempdir");
    let path = dir.path().join("config.toml");
    std::fs::write(&path, "model = \"a\"\n").expect("write fixture");
    let layer = load_user_layer(&path).expect("load").expect("present");
    assert_eq!(layer.source, LayerSource::User);
}

#[test]
fn codex_compat_layer_is_restricted_on_load() {
    let dir = tempfile::tempdir().expect("tempdir");
    let path = dir.path().join("codex-config.toml");
    std::fs::write(
        &path,
        r#"
        model = "gpt-5.2"
        [mcp_servers.example]
        command = "example-mcp"
        "#,
    )
    .expect("write fixture");
    let layer = load_codex_compat_layer(&path)
        .expect("load")
        .expect("present");
    assert_eq!(layer.source, LayerSource::CodexCompat);
    let table = layer.value.as_table().expect("table");
    assert!(!table.contains_key("model"));
    assert!(table.contains_key("mcp_servers"));
}
