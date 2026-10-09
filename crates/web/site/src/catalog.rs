// SPDX-License-Identifier: Apache-2.0
//! Shared product model for HTTP, CLI and MCP adapters. All adapters load
//! these same docs/templates; no transport-specific catalog or parser is needed.
use crate::{docs, templates};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{io, path::Path};

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct Catalog {
    pub docs: Value,
    pub templates: Value,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CatalogView {
    All,
    Docs,
    Templates,
}

impl CatalogView {
    pub fn validate_filter(self, filter: &SearchFilter) -> io::Result<()> {
        if self == Self::Templates
            && [&filter.q, &filter.category, &filter.id]
                .iter()
                .any(|value| value.as_deref().is_some_and(|value| !value.is_empty()))
        {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "docs filters cannot be used with the templates-only section",
            ));
        }
        Ok(())
    }
}

/// Empty query/category/id means no restriction. Matching is literal text:
/// queries do not compile regex, execute code, or grant provider/host access.
#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct SearchFilter {
    pub q: Option<String>,
    pub category: Option<String>,
    pub id: Option<String>,
}

impl Catalog {
    pub fn select(&self, view: CatalogView, filter: &SearchFilter) -> io::Result<Value> {
        view.validate_filter(filter)?;
        Ok(match view {
            CatalogView::Docs => self.search_docs(filter),
            CatalogView::Templates => self.templates.clone(),
            CatalogView::All => serde_json::json!({
                "docs": self.search_docs(filter), "templates": self.templates
            }),
        })
    }

    pub fn load(root: &Path) -> io::Result<Self> {
        Ok(Self {
            docs: docs::load_docs(root)?,
            templates: serde_json::to_value(templates::load_templates(root)?)
                .map_err(io::Error::other)?,
        })
    }

    /// DocsHub search parity: search title/summary/tags/content, case-insensitive;
    /// exact category and article id filters retain catalog order and all fields.
    pub fn search_docs(&self, filter: &SearchFilter) -> Value {
        let query = filter.q.as_deref().unwrap_or("").to_lowercase();
        let category =
            filter.category.as_deref().filter(|value| !value.is_empty() && *value != "All");
        let id = filter.id.as_deref().filter(|value| !value.is_empty());
        let articles = self.docs.as_array().map(Vec::as_slice).unwrap_or(&[]);
        Value::Array(
            articles
                .iter()
                .filter(|article| {
                    if category.is_some_and(|category| {
                        article.get("category").and_then(Value::as_str) != Some(category)
                    }) {
                        return false;
                    }
                    if id.is_some_and(|id| article.get("id").and_then(Value::as_str) != Some(id)) {
                        return false;
                    }
                    query.is_empty()
                        || ["title", "summary", "content"].iter().any(|field| {
                            article
                                .get(*field)
                                .and_then(Value::as_str)
                                .is_some_and(|value| value.to_lowercase().contains(&query))
                        })
                        || article.get("tags").and_then(Value::as_array).is_some_and(|tags| {
                            tags.iter()
                                .filter_map(Value::as_str)
                                .any(|tag| tag.to_lowercase().contains(&query))
                        })
                })
                .cloned()
                .collect(),
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn catalog() -> Catalog {
        Catalog { docs: docs::load_docs(Path::new("unused")).unwrap(), templates: json!([]) }
    }

    #[test]
    fn all_adapters_share_selection_and_template_filter_rejection() {
        let catalog = catalog();
        let filter = SearchFilter { q: Some("rust".into()), ..SearchFilter::default() };
        let docs = catalog.select(CatalogView::Docs, &filter).unwrap();
        assert_eq!(docs, catalog.search_docs(&filter));
        assert_eq!(catalog.select(CatalogView::All, &filter).unwrap()["docs"], docs);
        assert_eq!(
            catalog.select(CatalogView::Templates, &filter).unwrap_err().kind(),
            io::ErrorKind::InvalidInput
        );
    }

    #[test]
    fn empty_filter_preserves_exact_docs_api_value() {
        let catalog = catalog();
        assert_eq!(catalog.search_docs(&SearchFilter::default()), catalog.docs);
        let roundtrip: Catalog =
            serde_json::from_value(serde_json::to_value(&catalog).unwrap()).unwrap();
        assert_eq!(roundtrip, catalog);
    }

    #[test]
    fn query_category_id_and_tag_search_share_docs_hub_semantics() {
        let catalog = catalog();
        let category = SearchFilter { category: Some("Architecture".into()), ..Default::default() };
        let result = catalog.search_docs(&category);
        assert_eq!(result.as_array().unwrap().len(), 1);
        assert_eq!(result[0]["id"], "runtime-architecture");
        let tag = SearchFilter { q: Some("hct color".into()), ..Default::default() };
        assert_eq!(catalog.search_docs(&tag)[0]["id"], "material-3-design-tokens");
        let id = SearchFilter { id: Some("llms-txt-standard".into()), ..Default::default() };
        assert_eq!(catalog.search_docs(&id).as_array().unwrap().len(), 1);
        let absent = SearchFilter { q: Some("no-such-doc-xyz".into()), ..Default::default() };
        assert_eq!(catalog.search_docs(&absent), json!([]));
        let all = SearchFilter { category: Some("All".into()), ..Default::default() };
        assert_eq!(catalog.search_docs(&all), catalog.docs);
    }

    #[test]
    fn filtering_preserves_complete_article_metadata() {
        let catalog = catalog();
        let filter = SearchFilter { id: Some("runtime-architecture".into()), ..Default::default() };
        assert_eq!(catalog.search_docs(&filter)[0], catalog.docs[0]);
        assert_eq!(catalog.search_docs(&filter).as_array().unwrap().len(), 1);
    }
}
