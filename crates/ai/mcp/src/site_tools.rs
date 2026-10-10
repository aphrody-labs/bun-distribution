// SPDX-License-Identifier: Apache-2.0
//! Read-only product catalog adapter. HTTP, CLI and MCP load the same Rust
//! owner; no browser runtime, network request, provider store or host command.

use aphrody_site::{Catalog, CatalogView, SearchFilter};
use rmcp::schemars::{self, JsonSchema};
use serde::Deserialize;
use serde_json::{Value, json};
use std::{io, path::Path};

#[derive(Debug, Clone, Copy, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub(crate) enum CatalogSection {
    Docs,
    Templates,
}

#[derive(Debug, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub(crate) struct SiteCatalogRequest {
    /// Explicit absolute path to the configured Aphrody workspace root.
    /// Only the owner's documentation/template catalog is read.
    pub(crate) root: String,
    /// Return the same array as /api/docs or /api/templates. Omit to return both.
    #[serde(default)]
    pub(crate) section: Option<CatalogSection>,
    /// Case-insensitive docs title, summary, tags and content search.
    #[serde(default)]
    pub(crate) q: Option<String>,
    /// Exact docs category; "All" means no category restriction.
    #[serde(default)]
    pub(crate) category: Option<String>,
    /// Exact documentation article id.
    #[serde(default)]
    pub(crate) id: Option<String>,
}

fn load_catalog(request: &SiteCatalogRequest) -> io::Result<Value> {
    let view = match request.section {
        Some(CatalogSection::Docs) => CatalogView::Docs,
        Some(CatalogSection::Templates) => CatalogView::Templates,
        None => CatalogView::All,
    };
    let filter = SearchFilter {
        q: request.q.clone(),
        category: request.category.clone(),
        id: request.id.clone(),
    };
    view.validate_filter(&filter)?;
    let root = Path::new(&request.root);
    if request.root.trim().is_empty() || request.root.contains('\0') || !root.is_absolute() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "root must be the explicit absolute Aphrody workspace path",
        ));
    }
    let root = root.canonicalize()?;
    if !root.is_dir() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "workspace root is not a directory",
        ));
    }
    let catalog = Catalog::load(&root)?;
    catalog.select(view, &filter)
}

fn error_value(error: &io::Error) -> Value {
    let code = match error.kind() {
        io::ErrorKind::InvalidInput => "invalid_input",
        io::ErrorKind::NotFound => "not_found",
        io::ErrorKind::PermissionDenied => "permission_denied",
        io::ErrorKind::InvalidData => "invalid_catalog",
        _ => "io_error",
    };
    json!({"ok": false, "error": {"code": code, "message": error.to_string()}})
}

pub(crate) async fn catalog(request: SiteCatalogRequest) -> String {
    let value = match tokio::task::spawn_blocking(move || load_catalog(&request)).await {
        Ok(Ok(value)) => value,
        Ok(Err(error)) => error_value(&error),
        Err(error) => {
            json!({"ok": false, "error": {"code": "worker_failed", "message": error.to_string()}})
        },
    };
    value.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn typed_request_rejects_unrecognized_operations_and_fields() {
        assert!(
            serde_json::from_value::<SiteCatalogRequest>(
                json!({"root":"workspace","section":"shell"})
            )
            .is_err()
        );
        assert!(
            serde_json::from_value::<SiteCatalogRequest>(
                json!({"root":"workspace","command":"whoami"})
            )
            .is_err()
        );
    }

    #[test]
    fn relative_root_is_rejected_with_structured_error() {
        let error = load_catalog(&SiteCatalogRequest {
            root: "relative/workspace".into(),
            section: None,
            q: None,
            category: None,
            id: None,
        })
        .unwrap_err();
        let value = error_value(&error);
        assert_eq!(value["ok"], false);
        assert_eq!(value["error"]["code"], "invalid_input");
        assert!(value["error"]["message"].as_str().unwrap().contains("absolute"));
    }

    #[test]
    fn sections_share_the_http_catalog_owner() {
        let directory = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(directory.path().join("m3/templates")).unwrap();
        std::fs::write(directory.path().join("m3/templates/stack.toml"), "").unwrap();
        let root = directory.path().canonicalize().unwrap().to_str().unwrap().to_owned();
        let combined = load_catalog(&SiteCatalogRequest {
            root: root.clone(),
            section: None,
            q: None,
            category: None,
            id: None,
        })
        .unwrap();
        let docs = load_catalog(&SiteCatalogRequest {
            root: root.clone(),
            section: Some(CatalogSection::Docs),
            q: None,
            category: None,
            id: None,
        })
        .unwrap();
        let templates = load_catalog(&SiteCatalogRequest {
            root,
            section: Some(CatalogSection::Templates),
            q: None,
            category: None,
            id: None,
        })
        .unwrap();
        assert_eq!(combined["docs"], docs);
        assert_eq!(combined["templates"], templates);
        assert!(docs.is_array());
        assert!(templates.is_array());
    }

    #[test]
    fn docs_filters_delegate_to_shared_owner_in_both_response_shapes() {
        let directory = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(directory.path().join("m3/templates")).unwrap();
        std::fs::write(directory.path().join("m3/templates/stack.toml"), "").unwrap();
        let root = directory.path().canonicalize().unwrap();
        let expected = Catalog::load(&root).unwrap().search_docs(&SearchFilter {
            q: Some("hct color".into()),
            category: Some("Material 3".into()),
            id: None,
        });
        let mut request: SiteCatalogRequest = serde_json::from_value(json!({
            "root": root.to_str().unwrap(), "q":"hct color", "category":"Material 3"
        }))
        .unwrap();
        assert_eq!(load_catalog(&request).unwrap()["docs"], expected);
        request.section = Some(CatalogSection::Docs);
        assert_eq!(load_catalog(&request).unwrap(), expected);
        request.q = None;
        request.category = None;
        request.id = Some("llms-txt-standard".into());
        assert_eq!(load_catalog(&request).unwrap()[0]["id"], "llms-txt-standard");
    }

    #[test]
    fn template_only_filter_is_explicit_invalid_input() {
        for field in ["q", "category", "id"] {
            let mut value = json!({"root":"ignored", "section":"templates"});
            value[field] = json!("nonempty");
            let request: SiteCatalogRequest = serde_json::from_value(value).unwrap();
            let error = load_catalog(&request).unwrap_err();
            assert_eq!(error.kind(), io::ErrorKind::InvalidInput);
            assert!(error.to_string().contains("filters"));
        }
    }
}
