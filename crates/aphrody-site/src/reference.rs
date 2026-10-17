// SPDX-License-Identifier: Apache-2.0
//! Read-only JSON and Markdown views of the native Web design corpus.
//! Mirrored upstream HTML/JavaScript never executes in the app's origin.

use axum::{
    Router,
    extract::{Path as RoutePath, State},
    http::StatusCode,
    routing::get,
};
use serde_json::{Value, json};
use std::{
    io,
    path::{Path, PathBuf},
    sync::Arc,
};

const MAX_FILE_BYTES: u64 = 32 * 1024 * 1024;

/// One selected workspace's public reference exports, independent of profile stores.
pub struct ReferenceCorpus {
    workspace: PathBuf,
}

impl ReferenceCorpus {
    /// Resolve the selected checkout. Acquisition may complete after server startup.
    pub fn for_workspace(root: &Path) -> io::Result<Self> {
        Ok(Self {
            workspace: root.canonicalize()?,
        })
    }

    /// Expose data only; no acquisition, host execution or raw upstream scripts.
    pub fn router(self) -> Router {
        Router::new()
            .route("/api/design", get(summary))
            .route("/api/design/tokens", get(tokens))
            .route("/api/design/tokens/high-contrast", get(high_contrast))
            .route("/api/design/style-tokens", get(style_tokens))
            .route("/api/design/assets", get(assets))
            .route("/api/design/specs", get(specs))
            .route("/api/design/specs/{*slug}", get(spec))
            .route("/api/design/docs/{*slug}", get(document))
            .route("/api/design/docs", get(document_index))
            .route("/api/design/google", get(google_catalog))
            .route("/api/design/google/docs/{*slug}", get(google_document))
            .with_state(Arc::new(self))
    }

    fn read(&self, relative: &str) -> Result<Vec<u8>, StatusCode> {
        let root = self
            .workspace
            .join("var/mirrors/design-sync")
            .canonicalize()
            .map_err(|_| StatusCode::SERVICE_UNAVAILABLE)?;
        if !root.starts_with(&self.workspace) {
            return Err(StatusCode::NOT_FOUND);
        }
        let target = root
            .join(relative)
            .canonicalize()
            .map_err(|_| StatusCode::NOT_FOUND)?;
        if !target.starts_with(&root) {
            return Err(StatusCode::NOT_FOUND);
        }
        let metadata = target.metadata().map_err(|_| StatusCode::NOT_FOUND)?;
        if !metadata.is_file() || metadata.len() > MAX_FILE_BYTES {
            return Err(StatusCode::NOT_FOUND);
        }
        std::fs::read(target).map_err(|_| StatusCode::NOT_FOUND)
    }

    fn json(&self, relative: &str) -> Result<Value, StatusCode> {
        serde_json::from_slice(&self.read(relative)?).map_err(|_| StatusCode::SERVICE_UNAVAILABLE)
    }
}

type JsonResponse = Result<axum::Json<Value>, StatusCode>;

async fn summary(State(corpus): State<Arc<ReferenceCorpus>>) -> JsonResponse {
    let catalog = corpus.json("material-3/material-catalog.json")?;
    Ok(axum::Json(
        json!({"source":"aphrody-web","material":catalog,"tokens":"/api/design/tokens","highContrast":"/api/design/tokens/high-contrast","styleTokens":"/api/design/style-tokens","assets":"/api/design/assets","specs":"/api/design/specs","googleDesign":"/api/design/google"}),
    ))
}

async fn tokens(State(corpus): State<Arc<ReferenceCorpus>>) -> JsonResponse {
    corpus.json("tokens.json").map(axum::Json)
}

async fn high_contrast(State(corpus): State<Arc<ReferenceCorpus>>) -> JsonResponse {
    corpus.json("tokens-high-contrast.json").map(axum::Json)
}

async fn style_tokens(State(corpus): State<Arc<ReferenceCorpus>>) -> JsonResponse {
    corpus.json("design-tokens.json").map(axum::Json)
}

async fn google_catalog(State(corpus): State<Arc<ReferenceCorpus>>) -> JsonResponse {
    corpus
        .json("google-design/google-catalog.json")
        .map(axum::Json)
}

fn entry<'a>(catalog: &'a Value, slug: &str) -> Option<&'a Value> {
    catalog.get("entries")?.as_array()?.iter().find(|entry| {
        entry.get("slug").and_then(Value::as_str) == Some(slug)
            || entry
                .get("slugs")
                .and_then(Value::as_array)
                .is_some_and(|slugs| {
                    slugs
                        .iter()
                        .any(|candidate| candidate.as_str() == Some(slug))
                })
    })
}

fn markdown(
    corpus: &ReferenceCorpus,
    catalog: &Value,
    slug: &str,
    directory: &str,
) -> JsonResponse {
    let relative = entry(catalog, slug)
        .and_then(|entry| entry.get("markdown_path"))
        .and_then(Value::as_str)
        .ok_or(StatusCode::NOT_FOUND)?;
    if !relative.ends_with(".md") {
        return Err(StatusCode::NOT_FOUND);
    }
    let bytes = corpus.read(&format!("{directory}/{relative}"))?;
    let markdown = String::from_utf8(bytes).map_err(|_| StatusCode::SERVICE_UNAVAILABLE)?;
    Ok(axum::Json(json!({"slug":slug,"markdown":markdown})))
}

async fn document_index(State(corpus): State<Arc<ReferenceCorpus>>) -> JsonResponse {
    let catalog = corpus.json("material-3/material-catalog.json")?;
    markdown(&corpus, &catalog, "", "material-3")
}

async fn google_document(
    State(corpus): State<Arc<ReferenceCorpus>>,
    RoutePath(slug): RoutePath<String>,
) -> JsonResponse {
    if !valid_slug(&slug) {
        return Err(StatusCode::NOT_FOUND);
    }
    let catalog = corpus.json("google-design/google-catalog.json")?;
    markdown(&corpus, &catalog, &slug, "google-design")
}

async fn assets(State(corpus): State<Arc<ReferenceCorpus>>) -> JsonResponse {
    let material = corpus.json("material-3/assets.json")?;
    let google = corpus.json("google-design/manifest.json")?;
    Ok(axum::Json(
        json!({"material":material,"googleDesign":google.get("files")}),
    ))
}

async fn specs(State(corpus): State<Arc<ReferenceCorpus>>) -> JsonResponse {
    corpus
        .json("material-3/material-catalog.json")
        .map(axum::Json)
}

fn valid_slug(slug: &str) -> bool {
    slug.len() <= 256
        && slug.split('/').all(|part| {
            !part.is_empty()
                && part
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
        })
}

async fn document(
    State(corpus): State<Arc<ReferenceCorpus>>,
    RoutePath(slug): RoutePath<String>,
) -> JsonResponse {
    if !valid_slug(&slug) {
        return Err(StatusCode::NOT_FOUND);
    }
    let catalog = corpus.json("material-3/material-catalog.json")?;
    markdown(&corpus, &catalog, &slug, "material-3")
}

async fn spec(
    State(corpus): State<Arc<ReferenceCorpus>>,
    RoutePath(slug): RoutePath<String>,
) -> JsonResponse {
    if !valid_slug(&slug) {
        return Err(StatusCode::NOT_FOUND);
    }
    let catalog = corpus.json("material-3/material-catalog.json")?;
    let relative = entry(&catalog, &slug)
        .and_then(|entry| entry.get("raw_path"))
        .and_then(Value::as_str)
        .ok_or(StatusCode::NOT_FOUND)?;
    if !relative.ends_with(".json") {
        return Err(StatusCode::NOT_FOUND);
    }
    corpus
        .json(&format!("material-3/{relative}"))
        .map(axum::Json)
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{body::Body, http::Request};
    use tower::ServiceExt;

    #[tokio::test]
    async fn missing_corpus_is_explicit_and_raw_scripts_are_not_routes() {
        let temporary = tempfile::tempdir().unwrap();
        let app = ReferenceCorpus::for_workspace(temporary.path())
            .unwrap()
            .router();
        let result = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/api/design/tokens")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(result.status(), StatusCode::SERVICE_UNAVAILABLE);
        let result = app
            .oneshot(
                Request::builder()
                    .uri("/var/mirrors/main.js")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(result.status(), StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn real_data_routes_return_json_and_markdown_without_host_execution() {
        let temporary = tempfile::tempdir().unwrap();
        let corpus = temporary.path().join("var/mirrors/design-sync");
        let documents = corpus.join("material-3/documents/m3.material.io/styles/color");
        std::fs::create_dir_all(&documents).unwrap();
        std::fs::write(
            corpus.join("tokens.json"),
            r##"{"seed":"#8c6c88","light":{"primary":"#7e4d7c"}}"##,
        )
        .unwrap();
        std::fs::write(
            documents.join("index.md"),
            "# Color\nSource: https://m3.material.io/styles/color\n",
        )
        .unwrap();
        std::fs::write(
            corpus.join("material-3/material-catalog.json"),
            r#"{"entries":[{"slug":"styles/color","slugs":["styles/color","styles/color/overview"],"markdown_path":"documents/m3.material.io/styles/color/index.md"}]}"#,
        ).unwrap();
        let app = ReferenceCorpus::for_workspace(temporary.path())
            .unwrap()
            .router();
        for uri in [
            "/api/design/tokens",
            "/api/design/docs/styles/color",
            "/api/design/docs/styles/color/overview",
        ] {
            let response = app
                .clone()
                .oneshot(Request::builder().uri(uri).body(Body::empty()).unwrap())
                .await
                .unwrap();
            assert_eq!(response.status(), StatusCode::OK);
            assert_eq!(response.headers()["content-type"], "application/json");
        }
        assert!(!valid_slug("../tokens"));
        assert!(!valid_slug("styles//color"));
        assert!(!valid_slug("styles%2fcolor"));
        assert!(
            ReferenceCorpus::for_workspace(temporary.path())
                .unwrap()
                .read("../../../Cargo.toml")
                .is_err()
        );
    }
}
