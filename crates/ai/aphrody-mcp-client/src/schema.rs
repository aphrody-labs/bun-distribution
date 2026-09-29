// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 aphrody contributors

//! Conversion of MCP tool input schemas into [`aphrody_toolcall::JsonSchema`].

use std::collections::BTreeMap;

use aphrody_toolcall::{AdditionalProperties, JsonSchema, JsonSchemaPrimitiveType, JsonSchemaType};
use serde_json::Value as JsonValue;

/// Convert an arbitrary MCP tool `inputSchema` (JSON value) into an
/// [`aphrody_toolcall::JsonSchema`].
///
/// Guaranteed never to panic and to produce a valid schema acceptable by model APIs.
#[must_use]
pub fn mcp_schema_to_toolcall_schema(raw: &JsonValue) -> JsonSchema {
    if let Ok(mut parsed) = serde_json::from_value::<JsonSchema>(raw.clone()) {
        // If properties exist but schema_type was omitted (common in lenient MCP servers),
        // supply "object":
        if parsed.properties.is_some() && parsed.schema_type.is_none() {
            parsed.schema_type = Some(JsonSchemaType::Single(JsonSchemaPrimitiveType::Object));
        }
        return parsed;
    }

    // Fallback parser if custom keywords or unconventional structure defeated direct serde:
    match raw {
        JsonValue::Object(map) => {
            let description =
                map.get("description").and_then(JsonValue::as_str).map(ToOwned::to_owned);

            let schema_type = map
                .get("type")
                .and_then(|t| match t.as_str() {
                    Some("string") => Some(JsonSchemaType::Single(JsonSchemaPrimitiveType::String)),
                    Some("number") => Some(JsonSchemaType::Single(JsonSchemaPrimitiveType::Number)),
                    Some("integer") => {
                        Some(JsonSchemaType::Single(JsonSchemaPrimitiveType::Integer))
                    },
                    Some("boolean") => {
                        Some(JsonSchemaType::Single(JsonSchemaPrimitiveType::Boolean))
                    },
                    Some("array") => Some(JsonSchemaType::Single(JsonSchemaPrimitiveType::Array)),
                    Some("object") => Some(JsonSchemaType::Single(JsonSchemaPrimitiveType::Object)),
                    Some("null") => Some(JsonSchemaType::Single(JsonSchemaPrimitiveType::Null)),
                    _ => None,
                })
                .or_else(|| {
                    if map.contains_key("properties") {
                        Some(JsonSchemaType::Single(JsonSchemaPrimitiveType::Object))
                    } else {
                        None
                    }
                });

            let properties = map.get("properties").and_then(JsonValue::as_object).map(|props| {
                let mut btree = BTreeMap::new();
                for (k, v) in props {
                    btree.insert(k.clone(), mcp_schema_to_toolcall_schema(v));
                }
                btree
            });

            let required = map.get("required").and_then(JsonValue::as_array).map(|arr| {
                arr.iter().filter_map(JsonValue::as_str).map(ToOwned::to_owned).collect()
            });

            let additional_properties = map.get("additionalProperties").and_then(|v| {
                if let Some(b) = v.as_bool() {
                    Some(AdditionalProperties::Boolean(b))
                } else if v.is_object() {
                    Some(AdditionalProperties::Schema(Box::new(mcp_schema_to_toolcall_schema(v))))
                } else {
                    None
                }
            });

            let items = map.get("items").map(|it| Box::new(mcp_schema_to_toolcall_schema(it)));

            JsonSchema {
                schema_ref: None,
                schema_type,
                description,
                properties,
                required,
                items,
                enum_values: None,
                additional_properties,
                any_of: None,
                defs: None,
                definitions: None,
            }
        },
        _ => JsonSchema::object(BTreeMap::new(), None, Some(AdditionalProperties::Boolean(true))),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn converts_standard_mcp_object_schema() {
        let raw = serde_json::json!({
            "type": "object",
            "description": "Read file parameters",
            "properties": {
                "path": {
                    "type": "string",
                    "description": "File path"
                },
                "offset": {
                    "type": "integer"
                }
            },
            "required": ["path"]
        });

        let schema = mcp_schema_to_toolcall_schema(&raw);
        assert_eq!(schema.description.as_deref(), Some("Read file parameters"));
        assert!(matches!(
            schema.schema_type,
            Some(JsonSchemaType::Single(JsonSchemaPrimitiveType::Object))
        ));
        assert_eq!(schema.required.as_deref(), Some(&["path".to_string()][..]));

        let props = schema.properties.expect("properties present");
        assert_eq!(props.len(), 2);
        assert!(props.contains_key("path"));
        assert!(props.contains_key("offset"));
    }

    #[test]
    fn infers_object_when_type_missing_with_properties() {
        let raw = serde_json::json!({
            "properties": {
                "query": { "type": "string" }
            }
        });

        let schema = mcp_schema_to_toolcall_schema(&raw);
        assert!(matches!(
            schema.schema_type,
            Some(JsonSchemaType::Single(JsonSchemaPrimitiveType::Object))
        ));
        assert!(schema.properties.unwrap().contains_key("query"));
    }
}
