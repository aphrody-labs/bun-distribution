// SPDX-License-Identifier: Apache-2.0
//! Owned JSON/YAML values. Hosts parse with their own JSON/YAML parser and
//! convert into this model; scalars keep their source text.

#[derive(Clone, Debug, PartialEq)]
pub enum Value {
    Null,
    Bool(bool),
    /// Scalars keep their source text: `1.10` stays `"1.10"`, never `1.1`.
    Number(String),
    String(String),
    Array(Vec<Value>),
    Object(Vec<(String, Value)>),
}

impl Value {
    pub fn get(&self, key: &str) -> Option<&Value> {
        match self {
            Value::Object(rows) => rows.iter().find(|(k, _)| k == key).map(|(_, v)| v),
            _ => None,
        }
    }

    /// Case-insensitive lookup (winget manifests are case-insensitive).
    pub fn get_ci(&self, key: &str) -> Option<&Value> {
        match self {
            Value::Object(rows) => {
                rows.iter().find(|(k, _)| k.eq_ignore_ascii_case(key)).map(|(_, v)| v)
            },
            _ => None,
        }
    }

    /// Strings, numbers and booleans as text.
    pub fn as_str(&self) -> Option<&str> {
        match self {
            Value::String(s) | Value::Number(s) => Some(s),
            Value::Bool(true) => Some("true"),
            Value::Bool(false) => Some("false"),
            _ => None,
        }
    }

    pub fn str_ci(&self, key: &str) -> Option<&str> {
        self.get_ci(key).and_then(Value::as_str)
    }

    pub fn as_array(&self) -> &[Value] {
        match self {
            Value::Array(items) => items,
            _ => &[],
        }
    }

    pub fn array_ci(&self, key: &str) -> &[Value] {
        self.get_ci(key).map(Value::as_array).unwrap_or(&[])
    }

    pub fn as_bool(&self) -> Option<bool> {
        match self {
            Value::Bool(b) => Some(*b),
            Value::String(s) => match s.as_str() {
                "true" | "True" | "TRUE" => Some(true),
                "false" | "False" | "FALSE" => Some(false),
                _ => None,
            },
            _ => None,
        }
    }
}

/// Appends `s` as a JSON string literal.
pub fn write_json_string(out: &mut String, s: &str) {
    out.push('"');
    for c in s.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if (c as u32) < 0x20 => {
                use core::fmt::Write as _;
                let _ = write!(out, "\\u{:04x}", c as u32);
            },
            c => out.push(c),
        }
    }
    out.push('"');
}

pub fn json_string(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 2);
    write_json_string(&mut out, s);
    out
}
