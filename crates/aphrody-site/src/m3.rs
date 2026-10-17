// SPDX-License-Identifier: Apache-2.0
//! `GET /api/m3/css`: the `aphrody_m3_tokens::sheets` renderer for browsers, with the same
//! request fields as `m3Css()` of `@aphrody/bun` (`sheet`, `seed`, `variant`, `dark`,
//! `contrast`). Runtime theme changes in app-ui install the `scheme` sheet it returns.

use aphrody_m3_tokens::sheets::{SheetRequest, render};
use axum::{
    Router,
    extract::Query,
    http::{StatusCode, header},
    response::{IntoResponse, Response},
    routing::get,
};
use serde::Deserialize;

#[derive(Deserialize)]
struct CssQuery {
    sheet: String,
    seed: Option<String>,
    variant: Option<String>,
    dark: Option<bool>,
    contrast: Option<f64>,
}

async fn css(Query(query): Query<CssQuery>) -> Response {
    match SheetRequest::parse(
        &query.sheet,
        query.seed.as_deref(),
        query.variant.as_deref(),
        query.dark,
        query.contrast,
    ) {
        Ok(request) => (
            [
                (header::CONTENT_TYPE, "text/css; charset=utf-8"),
                (header::CACHE_CONTROL, "public, max-age=31536000, immutable"),
            ],
            render(&request),
        )
            .into_response(),
        Err(error) => (StatusCode::BAD_REQUEST, error).into_response(),
    }
}

/// The M3 sheet route; stateless and deterministic for a given query.
pub fn router() -> Router {
    Router::new().route("/api/m3/css", get(css))
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::{Body, to_bytes};
    use axum::http::Request;
    use tower::ServiceExt;

    async fn get(uri: &str) -> (StatusCode, String) {
        let response = router()
            .oneshot(Request::builder().uri(uri).body(Body::empty()).unwrap())
            .await
            .unwrap();
        let status = response.status();
        let body = to_bytes(response.into_body(), 1024 * 1024).await.unwrap();
        (status, String::from_utf8(body.to_vec()).unwrap())
    }

    #[tokio::test]
    async fn scheme_sheet_matches_the_rust_renderer() {
        let (status, body) =
            get("/api/m3/css?sheet=scheme&seed=%238c6c88&variant=tonal-spot&dark=true&contrast=1")
                .await;
        assert_eq!(status, StatusCode::OK);
        let expected = render(
            &SheetRequest::parse(
                "scheme",
                Some("#8c6c88"),
                Some("tonal-spot"),
                Some(true),
                Some(1.0),
            )
            .unwrap(),
        );
        assert_eq!(body, expected);
        assert!(body.contains("--md-sys-color-primary: #"));
    }

    #[tokio::test]
    async fn invalid_requests_are_explicit_errors() {
        for (uri, message) in [
            ("/api/m3/css?sheet=nope", "unknown sheet"),
            ("/api/m3/css?sheet=scheme&seed=zz", "invalid seed"),
            ("/api/m3/css?sheet=scheme&variant=nope", "unknown variant"),
            ("/api/m3/css?sheet=scheme&contrast=2", "outside -1..=1"),
        ] {
            let (status, body) = get(uri).await;
            assert_eq!(status, StatusCode::BAD_REQUEST, "{uri}");
            assert!(body.contains(message), "{uri}: {body}");
        }
    }
}
