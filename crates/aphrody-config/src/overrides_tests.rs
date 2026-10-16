// SPDX-License-Identifier: Apache-2.0
use pretty_assertions::assert_eq;

use super::*;

#[test]
fn parses_integer_value() {
    let (path, value) = parse_override("a=1").expect("parse");
    assert_eq!(path, vec!["a".to_string()]);
    assert_eq!(value, toml::Value::Integer(1));
}

#[test]
fn parses_dotted_string_value() {
    let (path, value) = parse_override(r#"a.b="x""#).expect("parse");
    assert_eq!(path, vec!["a".to_string(), "b".to_string()]);
    assert_eq!(value, toml::Value::String("x".to_string()));
}

#[test]
fn parses_array_value() {
    let (_, value) = parse_override("a=[1,2]").expect("parse");
    assert_eq!(
        value,
        toml::Value::Array(vec![toml::Value::Integer(1), toml::Value::Integer(2)])
    );
}

#[test]
fn parses_inline_table_value() {
    let (_, value) = parse_override(r#"a={k="v"}"#).expect("parse");
    let table = value.as_table().expect("table");
    assert_eq!(table["k"].as_str(), Some("v"));
}

#[test]
fn unquoted_string_falls_back_to_literal() {
    let (path, value) = parse_override("a=unquoted string").expect("parse");
    assert_eq!(path, vec!["a".to_string()]);
    assert_eq!(value, toml::Value::String("unquoted string".to_string()));
}

#[test]
fn model_without_quotes_is_a_convenient_string() {
    let (_, value) = parse_override("model=gpt-oss:20b").expect("parse");
    assert_eq!(value, toml::Value::String("gpt-oss:20b".to_string()));
}

#[test]
fn quoted_path_segment_preserves_embedded_dot() {
    let (path, _) =
        parse_override(r#"model_providers."my.id".base_url="http://x""#).expect("parse");
    assert_eq!(
        path,
        vec![
            "model_providers".to_string(),
            "my.id".to_string(),
            "base_url".to_string(),
        ]
    );
}

#[test]
fn missing_equals_is_an_error() {
    let err = parse_override("model").expect_err("missing =");
    assert!(matches!(err, OverrideError::MissingEquals(_)));
}

#[test]
fn empty_key_is_an_error() {
    let err = parse_override("=1").expect_err("empty key");
    assert!(matches!(err, OverrideError::EmptyKey(_)));
}

#[test]
fn empty_path_segment_is_an_error() {
    let err = parse_override("a..b=1").expect_err("empty segment");
    assert!(matches!(err, OverrideError::EmptyPathSegment(_)));
}

#[test]
fn unterminated_quote_is_an_error() {
    let err = parse_override(r#"a."b=1"#).expect_err("unterminated quote");
    assert!(matches!(err, OverrideError::UnterminatedQuote(_)));
}

#[test]
fn apply_override_builds_intermediate_tables() {
    let mut root = toml::Value::Table(toml::value::Table::new());
    let (path, value) = parse_override("rag.top_k=20").expect("parse");
    apply_override(&mut root, &path, value);
    let rag = root.get("rag").expect("rag table");
    assert_eq!(rag.get("top_k").unwrap().as_integer(), Some(20));
}

#[test]
fn apply_override_replaces_non_table_intermediate_with_a_table() {
    let mut root: toml::Value = toml::from_str("rag = true").unwrap();
    let (path, value) = parse_override("rag.top_k=20").expect("parse");
    apply_override(&mut root, &path, value);
    assert_eq!(
        root.get("rag").unwrap().get("top_k").unwrap().as_integer(),
        Some(20)
    );
}

#[test]
fn later_apply_override_call_wins() {
    let mut root = toml::Value::Table(toml::value::Table::new());
    let (p1, v1) = parse_override("model=a").unwrap();
    let (p2, v2) = parse_override("model=b").unwrap();
    apply_override(&mut root, &p1, v1);
    apply_override(&mut root, &p2, v2);
    assert_eq!(root.get("model").unwrap().as_str(), Some("b"));
}
