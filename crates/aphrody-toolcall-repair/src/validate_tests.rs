// SPDX-License-Identifier: Apache-2.0
use pretty_assertions::assert_eq;
use serde_json::json;

use super::*;

fn schema() -> Value {
    json!({
        "type": "object",
        "properties": {
            "path": {"type": "string"},
            "count": {"type": "integer", "minimum": 0, "maximum": 100},
            "mode": {"type": "string", "enum": ["read", "write"]},
            "tags": {"type": "array", "items": {"type": "string"}},
            "nested": {
                "type": "object",
                "properties": {"flag": {"type": "boolean"}},
                "required": ["flag"],
                "additionalProperties": false
            }
        },
        "required": ["path"],
        "additionalProperties": false
    })
}

#[test]
fn valid_arguments_produce_no_violations() {
    let args = json!({"path": "a.txt", "count": 5, "mode": "read", "tags": ["x"], "nested": {"flag": true}});
    assert!(validate_arguments(&args, &schema()).is_empty());
}

#[test]
fn missing_required_property_is_reported() {
    let args = json!({"count": 5});
    let violations = validate_arguments(&args, &schema());
    assert!(violations.iter().any(|v| v.pointer == "/path"));
}

#[test]
fn wrong_type_is_reported() {
    let args = json!({"path": "a.txt", "count": "five"});
    let violations = validate_arguments(&args, &schema());
    assert!(
        violations
            .iter()
            .any(|v| v.pointer == "/count" && v.message.contains("expected type"))
    );
}

#[test]
fn out_of_range_number_is_reported() {
    let args = json!({"path": "a.txt", "count": 500});
    let violations = validate_arguments(&args, &schema());
    assert!(
        violations
            .iter()
            .any(|v| v.pointer == "/count" && v.message.contains("maximum"))
    );
}

#[test]
fn enum_violation_is_reported() {
    let args = json!({"path": "a.txt", "mode": "delete"});
    let violations = validate_arguments(&args, &schema());
    assert!(violations.iter().any(|v| v.pointer == "/mode"));
}

#[test]
fn additional_property_is_reported() {
    let args = json!({"path": "a.txt", "bogus": 1});
    let violations = validate_arguments(&args, &schema());
    assert!(violations.iter().any(|v| v.pointer == "/bogus"));
}

#[test]
fn nested_required_property_is_reported() {
    let args = json!({"path": "a.txt", "nested": {}});
    let violations = validate_arguments(&args, &schema());
    assert!(violations.iter().any(|v| v.pointer == "/nested/flag"));
}

#[test]
fn any_of_shallow_validation() {
    let schema = json!({"anyOf": [{"type": "string"}, {"type": "integer"}]});
    assert!(validate_arguments(&json!("ok"), &schema).is_empty());
    assert!(validate_arguments(&json!(1), &schema).is_empty());
    assert!(!validate_arguments(&json!(true), &schema).is_empty());
}

#[test]
fn one_of_requires_exactly_one_match() {
    let schema = json!({"oneOf": [{"type": "number"}, {"minimum": 10}]});
    // 5 matches "number" only -> exactly one -> ok.
    assert!(validate_arguments(&json!(5), &schema).is_empty());
    // 20 matches both "number" and "minimum: 10" -> not exactly one -> violation.
    assert!(!validate_arguments(&json!(20), &schema).is_empty());
}

// ---------------------------------------------------------------------------
// Coercion
// ---------------------------------------------------------------------------

#[test]
fn coerces_string_integer() {
    let args = json!({"path": "a.txt", "count": "42"});
    let (coerced, log) = coerce_arguments(&args, &schema());
    assert_eq!(coerced["count"], json!(42));
    assert_eq!(log.len(), 1);
}

#[test]
fn coerces_string_boolean() {
    let schema = json!({"type": "object", "properties": {"flag": {"type": "boolean"}}});
    let args = json!({"flag": "true"});
    let (coerced, _log) = coerce_arguments(&args, &schema);
    assert_eq!(coerced["flag"], json!(true));
}

#[test]
fn wraps_bare_string_into_array() {
    let args = json!({"path": "a.txt", "tags": "solo"});
    let (coerced, log) = coerce_arguments(&args, &schema());
    assert_eq!(coerced["tags"], json!(["solo"]));
    assert!(!log.is_empty());
}

#[test]
fn decodes_json_encoded_array_string() {
    let args = json!({"path": "a.txt", "tags": "[\"a\", \"b\"]"});
    let (coerced, _log) = coerce_arguments(&args, &schema());
    assert_eq!(coerced["tags"], json!(["a", "b"]));
}

#[test]
fn decodes_json_encoded_object_string() {
    let schema = json!({"type": "object", "properties": {"nested": {"type": "object"}}});
    let args = json!({"nested": "{\"a\": 1}"});
    let (coerced, _log) = coerce_arguments(&args, &schema);
    assert_eq!(coerced["nested"], json!({"a": 1}));
}

#[test]
fn removes_null_optional_property() {
    let args = json!({"path": "a.txt", "mode": null});
    let (coerced, log) = coerce_arguments(&args, &schema());
    assert!(coerced.get("mode").is_none());
    assert!(log.iter().any(|c| c.pointer == "/mode"));
}

#[test]
fn corrective_message_lists_each_violation() {
    let violations = vec![
        Violation::new("/path", "missing required property"),
        Violation::new("/count", "expected type integer, got string"),
    ];
    let message = corrective_message("read_file", &violations);
    assert!(message.contains("read_file"));
    assert!(message.contains("/path"));
    assert!(message.contains("/count"));
    assert!(message.contains("2 issues"));
}
