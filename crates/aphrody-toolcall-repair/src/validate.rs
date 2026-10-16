// SPDX-License-Identifier: Apache-2.0
//! A JSON-Schema-subset validator and coercer for tool-call arguments, and a
//! corrective English message to feed back to a weak model so it can retry.

use serde_json::Value;

use crate::repair::repair_json;

/// One schema violation, addressed by a JSON pointer into the arguments
/// value.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Violation {
    /// A JSON pointer (`""` for the root, `"/path/to/field"` otherwise).
    pub pointer: String,
    /// A human-readable description of what is wrong.
    pub message: String,
}

impl Violation {
    fn new(pointer: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            pointer: pointer.into(),
            message: message.into(),
        }
    }
}

/// Validate `args` against the JSON-Schema subset: `type`, `required`,
/// `properties`, `additionalProperties: false`, `enum`, `items`,
/// `minimum`/`maximum`, `minLength`/`maxLength`, and a shallow
/// `oneOf`/`anyOf`.
#[must_use]
pub fn validate_arguments(args: &Value, schema: &Value) -> Vec<Violation> {
    let mut out = Vec::new();
    validate_node(args, schema, "", &mut out);
    out
}

fn validate_node(value: &Value, schema: &Value, pointer: &str, out: &mut Vec<Violation>) {
    if let Some(expected) = schema.get("enum").and_then(Value::as_array)
        && !expected.contains(value)
    {
        out.push(Violation::new(
            pointer,
            "value is not one of the allowed enum values",
        ));
    }

    if let Some(type_kw) = schema.get("type") {
        validate_type(value, type_kw, pointer, out);
    }

    if let Some(minimum) = schema.get("minimum").and_then(Value::as_f64)
        && let Some(n) = value.as_f64()
        && n < minimum
    {
        out.push(Violation::new(
            pointer,
            format!("value {n} is below minimum {minimum}"),
        ));
    }
    if let Some(maximum) = schema.get("maximum").and_then(Value::as_f64)
        && let Some(n) = value.as_f64()
        && n > maximum
    {
        out.push(Violation::new(
            pointer,
            format!("value {n} is above maximum {maximum}"),
        ));
    }

    if let Some(min_len) = schema.get("minLength").and_then(Value::as_u64)
        && let Some(s) = value.as_str()
        && (s.chars().count() as u64) < min_len
    {
        out.push(Violation::new(
            pointer,
            format!("string is shorter than minLength {min_len}"),
        ));
    }
    if let Some(max_len) = schema.get("maxLength").and_then(Value::as_u64)
        && let Some(s) = value.as_str()
        && (s.chars().count() as u64) > max_len
    {
        out.push(Violation::new(
            pointer,
            format!("string is longer than maxLength {max_len}"),
        ));
    }

    if let Value::Object(map) = value {
        if let Some(required) = schema.get("required").and_then(Value::as_array) {
            for name in required.iter().filter_map(Value::as_str) {
                if !map.contains_key(name) {
                    out.push(Violation::new(
                        json_pointer_child(pointer, name),
                        "missing required property",
                    ));
                }
            }
        }

        let properties = schema.get("properties").and_then(Value::as_object);
        let additional = schema.get("additionalProperties");
        for (key, sub_value) in map {
            let child_pointer = json_pointer_child(pointer, key);
            if let Some(sub_schema) = properties.and_then(|p| p.get(key)) {
                validate_node(sub_value, sub_schema, &child_pointer, out);
            } else {
                match additional {
                    Some(Value::Bool(false)) => {
                        out.push(Violation::new(
                            child_pointer,
                            "unexpected additional property",
                        ));
                    }
                    Some(sub_schema @ Value::Object(_)) => {
                        validate_node(sub_value, sub_schema, &child_pointer, out);
                    }
                    _ => {}
                }
            }
        }
    }

    if let Value::Array(items) = value
        && let Some(item_schema) = schema.get("items")
    {
        for (i, item) in items.iter().enumerate() {
            validate_node(item, item_schema, &format!("{pointer}/{i}"), out);
        }
    }

    for keyword in ["anyOf", "oneOf"] {
        if let Some(variants) = schema.get(keyword).and_then(Value::as_array) {
            let matches = variants
                .iter()
                .filter(|variant| {
                    let mut scratch = Vec::new();
                    validate_node(value, variant, "", &mut scratch);
                    scratch.is_empty()
                })
                .count();
            let ok = if keyword == "oneOf" {
                matches == 1
            } else {
                matches >= 1
            };
            if !ok {
                out.push(Violation::new(
                    pointer,
                    format!(
                        "value does not satisfy exactly the required number of `{keyword}` schemas"
                    ),
                ));
            }
        }
    }
}

fn validate_type(value: &Value, type_kw: &Value, pointer: &str, out: &mut Vec<Violation>) {
    let names: Vec<&str> = match type_kw {
        Value::String(s) => vec![s.as_str()],
        Value::Array(items) => items.iter().filter_map(Value::as_str).collect(),
        _ => return,
    };
    if names.iter().any(|name| value_matches_type(value, name)) {
        return;
    }
    out.push(Violation::new(
        pointer.to_string(),
        format!(
            "expected type {}, got {}",
            names.join(" or "),
            json_type_name(value)
        ),
    ));
}

fn value_matches_type(value: &Value, name: &str) -> bool {
    match name {
        "string" => value.is_string(),
        "number" => value.is_number(),
        "integer" => {
            value.is_i64() || value.is_u64() || value.as_f64().is_some_and(|f| f.fract() == 0.0)
        }
        "boolean" => value.is_boolean(),
        "object" => value.is_object(),
        "array" => value.is_array(),
        "null" => value.is_null(),
        _ => true,
    }
}

fn json_type_name(value: &Value) -> &'static str {
    match value {
        Value::Null => "null",
        Value::Bool(_) => "boolean",
        Value::Number(_) => "number",
        Value::String(_) => "string",
        Value::Array(_) => "array",
        Value::Object(_) => "object",
    }
}

fn json_pointer_child(pointer: &str, key: &str) -> String {
    let escaped = key.replace('~', "~0").replace('/', "~1");
    format!("{pointer}/{escaped}")
}

// ---------------------------------------------------------------------------
// Coercion
// ---------------------------------------------------------------------------

/// One argument coercion applied by [`coerce_arguments`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Coercion {
    /// The JSON pointer of the coerced field.
    pub pointer: String,
    /// What was done.
    pub description: String,
}

impl Coercion {
    fn new(pointer: impl Into<String>, description: impl Into<String>) -> Self {
        Self {
            pointer: pointer.into(),
            description: description.into(),
        }
    }
}

/// Fix the classic weak-model argument mistakes when the fix is unambiguous:
/// a numeric/boolean string coerced to its real type, a bare value wrapped
/// into a required array, a JSON-encoded string decoded into an
/// object/array, and a `null` removed from an optional property.
#[must_use]
pub fn coerce_arguments(args: &Value, schema: &Value) -> (Value, Vec<Coercion>) {
    let mut value = args.clone();
    let mut coercions = Vec::new();
    coerce_node(&mut value, schema, "", &mut coercions);
    (value, coercions)
}

fn coerce_node(value: &mut Value, schema: &Value, pointer: &str, out: &mut Vec<Coercion>) {
    let required: Vec<String> = schema
        .get("required")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(Value::as_str)
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_default();

    let expected_type = schema.get("type").and_then(Value::as_str);

    match expected_type {
        Some("integer") => coerce_scalar_string(value, pointer, out, |s| {
            s.parse::<i64>()
                .ok()
                .map(|n| (Value::Number(n.into()), "string coerced to integer"))
        }),
        Some("number") => coerce_scalar_string(value, pointer, out, |s| {
            s.parse::<f64>()
                .ok()
                .and_then(serde_json::Number::from_f64)
                .map(|n| (Value::Number(n), "string coerced to number"))
        }),
        Some("boolean") => coerce_scalar_string(value, pointer, out, |s| match s.trim() {
            "true" | "True" | "TRUE" => Some((Value::Bool(true), "string coerced to boolean")),
            "false" | "False" | "FALSE" => Some((Value::Bool(false), "string coerced to boolean")),
            _ => None,
        }),
        Some("array") => {
            if let Value::String(s) = value.clone() {
                let trimmed = s.trim();
                if trimmed.starts_with('[')
                    && trimmed.ends_with(']')
                    && let Ok(decoded @ Value::Array(_)) = repair_json(trimmed)
                {
                    out.push(Coercion::new(
                        pointer,
                        "decoded JSON-encoded string into an array",
                    ));
                    *value = decoded;
                }
            }
            if !value.is_array() && !value.is_null() {
                let wrapped = Value::Array(vec![value.clone()]);
                out.push(Coercion::new(
                    pointer,
                    "wrapped bare value into a single-element array",
                ));
                *value = wrapped;
            }
        }
        _ => {}
    }

    if matches!(expected_type, Some("object"))
        && let Value::String(s) = value.clone()
        && let Ok(decoded @ (Value::Object(_) | Value::Array(_))) = repair_json(&s)
    {
        out.push(Coercion::new(
            pointer,
            "decoded JSON-encoded string into an object",
        ));
        *value = decoded;
    }

    if let Value::Object(map) = value {
        let properties = schema.get("properties").and_then(Value::as_object).cloned();
        let optional_nulls: Vec<String> = map
            .iter()
            .filter(|(k, v)| v.is_null() && !required.contains(k))
            .map(|(k, _)| k.clone())
            .collect();
        for key in optional_nulls {
            map.remove(&key);
            out.push(Coercion::new(
                json_pointer_child(pointer, &key),
                "removed null optional property",
            ));
        }
        if let Some(properties) = properties {
            for (key, sub_schema) in &properties {
                if let Some(sub_value) = map.get_mut(key) {
                    coerce_node(
                        sub_value,
                        sub_schema,
                        &json_pointer_child(pointer, key),
                        out,
                    );
                }
            }
        }
    }

    if let Value::Array(items) = value
        && let Some(item_schema) = schema.get("items")
    {
        for (i, item) in items.iter_mut().enumerate() {
            coerce_node(item, item_schema, &format!("{pointer}/{i}"), out);
        }
    }
}

fn coerce_scalar_string(
    value: &mut Value,
    pointer: &str,
    out: &mut Vec<Coercion>,
    f: impl FnOnce(&str) -> Option<(Value, &'static str)>,
) {
    if let Value::String(s) = value.clone()
        && let Some((coerced, description)) = f(&s)
    {
        out.push(Coercion::new(pointer.to_string(), description));
        *value = coerced;
    }
}

// ---------------------------------------------------------------------------
// Corrective retry message
// ---------------------------------------------------------------------------

/// A concise English message describing schema violations, suitable to feed
/// back to the model as the tool result so it retries with fixed arguments.
#[must_use]
pub fn corrective_message(tool: &str, violations: &[Violation]) -> String {
    if violations.is_empty() {
        return format!(
            "Tool `{tool}` arguments were rejected for an unspecified reason. Retry with \
             corrected arguments."
        );
    }
    let details: Vec<String> = violations
        .iter()
        .map(|v| {
            let pointer = if v.pointer.is_empty() {
                "(root)"
            } else {
                v.pointer.as_str()
            };
            format!("{pointer}: {}", v.message)
        })
        .collect();
    format!(
        "Tool `{tool}` arguments were invalid ({} issue{}): {}. Call `{tool}` again with \
         corrected arguments that satisfy its schema.",
        violations.len(),
        if violations.len() == 1 { "" } else { "s" },
        details.join("; "),
    )
}

#[cfg(test)]
#[path = "validate_tests.rs"]
mod tests;
