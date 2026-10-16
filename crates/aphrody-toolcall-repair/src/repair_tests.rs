// SPDX-License-Identifier: Apache-2.0
use pretty_assertions::assert_eq;
use proptest::prelude::*;
use serde_json::json;

use super::*;

#[test]
fn identity_on_valid_json_object() {
    let valid =
        r#"{"a":1,"b":[true,false,null],"c":{"nested":"value with \"quotes\" and \n newline"}}"#;
    let report = repair_json_with_report(valid).unwrap();
    assert_eq!(report.value, serde_json::from_str::<Value>(valid).unwrap());
    assert!(report.repairs.is_empty());
}

#[test]
fn identity_on_unicode_and_numbers() {
    let valid = r#"{"emoji":"\u00e9\u00e8 caf\u00e9 \ud83d\ude00","n":-12.5e10,"z":0}"#;
    let value = repair_json(valid).unwrap();
    assert_eq!(value, serde_json::from_str::<Value>(valid).unwrap());
}

#[test]
fn strips_markdown_fence_and_prose() {
    let input = "Sure, here is the JSON:\n```json\n{\"a\": 1}\n```\nHope that helps!";
    let report = repair_json_with_report(input).unwrap();
    assert_eq!(report.value, json!({"a": 1}));
    assert!(
        report
            .repairs
            .contains(&RepairKind::StrippedSurroundingText)
    );
    assert!(report.repairs.contains(&RepairKind::MarkdownFence));
}

#[test]
fn removes_trailing_comma() {
    let value = repair_json(r#"{"a": 1, "b": 2,}"#).unwrap();
    assert_eq!(value, json!({"a": 1, "b": 2}));
}

#[test]
fn removes_trailing_comma_in_array() {
    let value = repair_json(r"[1, 2, 3,]").unwrap();
    assert_eq!(value, json!([1, 2, 3]));
}

#[test]
fn single_quoted_strings_become_double_quoted() {
    let value = repair_json(r"{'name': 'Alice', 'age': 30}").unwrap();
    assert_eq!(value, json!({"name": "Alice", "age": 30}));
}

#[test]
fn single_quoted_string_with_embedded_double_quote() {
    let value = repair_json(r#"{'quote': 'she said "hi"'}"#).unwrap();
    assert_eq!(value, json!({"quote": "she said \"hi\""}));
}

#[test]
fn unquoted_keys_are_quoted() {
    let value = repair_json(r#"{name: "Bob", age: 42}"#).unwrap();
    assert_eq!(value, json!({"name": "Bob", "age": 42}));
}

#[test]
fn unquoted_string_value_is_quoted() {
    let value = repair_json(r#"{"status": ok}"#).unwrap();
    assert_eq!(value, json!({"status": "ok"}));
}

#[test]
fn python_literals_are_mapped() {
    let value = repair_json(r#"{"a": True, "b": False, "c": None}"#).unwrap();
    assert_eq!(value, json!({"a": true, "b": false, "c": null}));
}

#[test]
fn unescaped_newline_in_string_is_escaped() {
    let input = "{\"text\": \"line one\nline two\"}";
    let value = repair_json(input).unwrap();
    assert_eq!(value, json!({"text": "line one\nline two"}));
}

#[test]
fn windows_path_backslashes_are_escaped() {
    let input = r#"{"path": "C:\work\aphrody"}"#;
    let value = repair_json(input).unwrap();
    assert_eq!(value, json!({"path": "C:\\work\\aphrody"}));
}

#[test]
fn truncated_string_is_closed() {
    let value = repair_json(r#"{"name": "aphrody", "note": "cut off mid str"#).unwrap();
    assert_eq!(value, json!({"name": "aphrody", "note": "cut off mid str"}));
}

#[test]
fn truncated_object_is_closed() {
    let value = repair_json(r#"{"name": "foo", "arguments": {"path": "a.txt""#).unwrap();
    assert_eq!(
        value,
        json!({"name": "foo", "arguments": {"path": "a.txt"}})
    );
}

#[test]
fn truncated_array_is_closed() {
    let value = repair_json(r#"{"items": [1, 2, 3"#).unwrap();
    assert_eq!(value, json!({"items": [1, 2, 3]}));
}

#[test]
fn truncated_dangling_key_gets_null() {
    let value = repair_json(r#"{"name": "foo", "arguments":"#).unwrap();
    assert_eq!(value, json!({"name": "foo", "arguments": null}));
}

#[test]
fn truncated_dangling_comma_is_dropped() {
    let value = repair_json(r#"{"a": 1, "#).unwrap();
    assert_eq!(value, json!({"a": 1}));
}

#[test]
fn double_encoded_top_level_string_is_decoded() {
    // The whole payload fails to parse directly (it is a bare fenced string,
    // not a JSON document by itself would actually be valid... use a case
    // that requires the tolerant path: single-quoted wrapper).
    let input = r#"'{"a": 1, "b": [2, 3]}'"#;
    let value = repair_json(input).unwrap();
    assert_eq!(value, json!({"a": 1, "b": [2, 3]}));
}

#[test]
fn double_encoded_nested_field_is_decoded_on_repair_path() {
    // Overall payload is malformed (trailing comma), so the tolerant path
    // runs and recursively decodes the double-encoded `arguments` string.
    let input = r#"{"name": "foo", "arguments": "{\"path\": \"a.txt\"}",}"#;
    let value = repair_json(input).unwrap();
    assert_eq!(
        value,
        json!({"name": "foo", "arguments": {"path": "a.txt"}})
    );
}

#[test]
fn valid_nested_json_looking_string_is_left_alone() {
    // The whole document is already valid JSON, so the fast identity path
    // runs and the "arguments" string must NOT be blindly decoded.
    let input = r#"{"raw_config": "{\"unrelated\": true}"}"#;
    let value = repair_json(input).unwrap();
    assert_eq!(value, serde_json::from_str::<Value>(input).unwrap());
    assert_eq!(value["raw_config"], json!("{\"unrelated\": true}"));
}

#[test]
fn leading_and_trailing_garbage_is_stripped() {
    let input = "Here you go -> {\"ok\": true} <- done";
    let value = repair_json(input).unwrap();
    assert_eq!(value, json!({"ok": true}));
}

#[test]
fn two_json_objects_only_first_is_taken() {
    let input = r#"{"a": 1} {"b": 2}"#;
    let value = repair_json(input).unwrap();
    assert_eq!(value, json!({"a": 1}));
}

#[test]
fn bare_scalar_string_repairs() {
    let value = repair_json("'just a string'").unwrap();
    assert_eq!(value, json!("just a string"));
}

#[test]
fn bare_python_true_repairs() {
    let value = repair_json("True").unwrap();
    assert_eq!(value, json!(true));
}

#[test]
fn empty_input_errors() {
    assert!(matches!(repair_json("   "), Err(RepairError::Empty)));
}

#[test]
fn pure_prose_errors_with_no_json_found() {
    assert!(matches!(
        repair_json("I cannot help with that request."),
        Err(RepairError::NoJsonFound)
    ));
}

#[test]
fn combined_realistic_llama_dict_output() {
    // Note: "data"/"output" deliberately avoid t/n/r/b/f/u as the character
    // right after a backslash, which would be genuinely ambiguous with a
    // real JSON escape (`\t`, `\n`, ...).
    let input = "```\n{name: 'create_file', arguments: {'path': 'C:\\data\\output.txt', \
                 'content': 'Hello\nWorld', 'overwrite': True,}}\n```";
    let value = repair_json(input).unwrap();
    assert_eq!(
        value,
        json!({
            "name": "create_file",
            "arguments": {
                "path": "C:\\data\\output.txt",
                "content": "Hello\nWorld",
                "overwrite": true,
            }
        })
    );
}

// ---------------------------------------------------------------------------
// proptest: identity over a generated corpus of valid JSON documents.
// ---------------------------------------------------------------------------

fn arb_json_value() -> impl Strategy<Value = Value> {
    let leaf = prop_oneof![
        Just(Value::Null),
        any::<bool>().prop_map(Value::Bool),
        any::<i32>().prop_map(|n| json!(n)),
        (-1e6f64..1e6f64).prop_map(|n| json!(n)),
        "[a-zA-Z0-9 _.-]{0,24}".prop_map(Value::String),
    ];
    leaf.prop_recursive(4, 64, 8, |inner| {
        prop_oneof![
            prop::collection::vec(inner.clone(), 0..6).prop_map(Value::Array),
            prop::collection::btree_map("[a-zA-Z_][a-zA-Z0-9_]{0,12}", inner, 0..6)
                .prop_map(|m| Value::Object(m.into_iter().collect())),
        ]
    })
}

proptest! {
    #[test]
    fn identity_over_generated_valid_json(value in arb_json_value()) {
        let text = serde_json::to_string(&value).unwrap();
        let expected = serde_json::from_str::<Value>(&text).unwrap();
        let got = repair_json(&text).unwrap();
        prop_assert_eq!(got, expected);
    }
}
