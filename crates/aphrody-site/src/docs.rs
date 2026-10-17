// SPDX-License-Identifier: Apache-2.0
//! Native product documentation catalog. Article IDs and API shape retain the
//! former apps/web catalogue contract; content follows the current source owners.
//! Original migration source TS SHA256:
//! 3e0752550922b19219ae681725c00304ce8afe6f74ec4040dd10a28b9b340ce5.
//! Current content provenance: docs/operations/workspace/product-content-source-audit-2026-10-09.md.
use serde_json::Value;
use std::{collections::BTreeSet, io, path::Path};

pub const DOCS_CATALOG_PATH: &str = "crates/web/site/data/docs.json";

/// Load product-owned declarative data, without running JS or reading upstream
/// documentation caches. The caller supplies its deployment/workspace root.
pub fn load_docs(_root: &Path) -> io::Result<Value> {
    parse_docs(include_bytes!("../data/docs.json"))
}

fn invalid(message: impl Into<String>) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidData, message.into())
}

fn parse_docs(bytes: &[u8]) -> io::Result<Value> {
    let catalog: Value =
        serde_json::from_slice(bytes).map_err(|error| invalid(error.to_string()))?;
    let articles = catalog.as_array().ok_or_else(|| invalid("docs catalog must be an array"))?;
    let mut ids = BTreeSet::new();
    for article in articles {
        let object =
            article.as_object().ok_or_else(|| invalid("docs article must be an object"))?;
        for field in ["id", "category", "title", "summary", "readTime", "content"] {
            if !object.get(field).is_some_and(Value::is_string) {
                return Err(invalid(format!("docs article missing string field {field}")));
            }
        }
        let id = object["id"].as_str().ok_or_else(|| invalid("invalid docs id"))?;
        if id.is_empty() || !ids.insert(id) {
            return Err(invalid("empty or duplicate docs article id"));
        }
        let tags = object
            .get("tags")
            .and_then(Value::as_array)
            .ok_or_else(|| invalid("docs tags must be an array"))?;
        if !tags.iter().all(Value::is_string) {
            return Err(invalid("docs tags must be strings"));
        }
        let category = object["category"].as_str().ok_or_else(|| invalid("invalid category"))?;
        if !matches!(
            category,
            "Architecture" | "Framework & Bun" | "Material 3" | "Desktop & Tauri" | "LLM & Memory"
        ) {
            return Err(invalid(format!("unknown docs category {category}")));
        }
    }
    Ok(catalog)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn preserves_api_shape_and_markdown_content() {
        let json = br##"[{"id":"demo","category":"Architecture","title":"Title","summary":"Summary","readTime":"1 min read","tags":["Rust"],"content":"# Heading\n\n`code` & <tag>\n"}]"##;
        let expected: Value = serde_json::from_slice(json).unwrap();
        assert_eq!(parse_docs(json).unwrap(), expected);
    }

    #[test]
    fn rejects_invalid_or_duplicate_catalog_entries() {
        assert!(parse_docs(br#"{}"#).is_err());
        assert!(parse_docs(br#"[{"id":"demo"}]"#).is_err());
        let json = br#"[{"id":"x","category":"Architecture","title":"t","summary":"s","readTime":"1 min","tags":[1],"content":"c"}]"#;
        assert!(parse_docs(json).is_err());
    }

    #[test]
    fn embedded_product_catalog_is_valid_and_retains_five_article_identifiers() {
        let catalog = load_docs(Path::new("unused-deployment-root")).unwrap();
        let articles = catalog.as_array().unwrap();
        assert_eq!(articles.len(), 5);
        assert_eq!(articles[0]["id"], "runtime-architecture");
        assert_eq!(articles[4]["id"], "llms-txt-standard");
        assert!(
            articles.iter().all(|article| article["content"].as_str().unwrap().starts_with('#'))
        );
    }
}
