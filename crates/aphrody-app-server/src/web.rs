// SPDX-License-Identifier: Apache-2.0
//! The same local agent console is embedded in HTTP and the Tauri application.
//!
//! The assets are staged by `build.rs` into `OUT_DIR`: the console built in
//! `packages/app-ui/dist/` when it exists, otherwise a
//! placeholder page that explains how to build it. [`ui_embedded`] tells
//! which one this binary carries.

/// Whether the real console (not the placeholder) was embedded at build time.
#[must_use]
pub fn ui_embedded() -> bool {
    env!("APHRODY_UI_EMBEDDED") == "1"
}

pub(crate) async fn index() -> (axum::http::StatusCode, axum::response::Html<&'static str>) {
    (
        asset_status(),
        axum::response::Html(include_str!(concat!(env!("OUT_DIR"), "/index.html"))),
    )
}

fn asset_status() -> axum::http::StatusCode {
    if ui_embedded() {
        axum::http::StatusCode::OK
    } else {
        axum::http::StatusCode::SERVICE_UNAVAILABLE
    }
}

pub(crate) async fn script() -> (
    axum::http::StatusCode,
    [(&'static str, &'static str); 1],
    &'static str,
) {
    (
        asset_status(),
        [("content-type", "text/javascript; charset=utf-8")],
        include_str!(concat!(env!("OUT_DIR"), "/app.js")),
    )
}

pub(crate) async fn style() -> (
    axum::http::StatusCode,
    [(&'static str, &'static str); 1],
    &'static str,
) {
    (
        asset_status(),
        [("content-type", "text/css; charset=utf-8")],
        include_str!(concat!(env!("OUT_DIR"), "/app.css")),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn embedded_assets_are_never_empty() {
        // Whether the real console or the placeholder shipped, every route
        // must serve something a browser can render.
        assert!(!index().await.1.0.trim().is_empty());
        assert!(!script().await.2.trim().is_empty());
        assert!(!style().await.2.trim().is_empty());
        if ui_embedded() {
            assert_eq!(index().await.0, axum::http::StatusCode::OK);
            assert!(!index().await.1.0.contains("built without the web console"));
        } else {
            assert_eq!(index().await.0, axum::http::StatusCode::SERVICE_UNAVAILABLE);
            assert_eq!(
                script().await.0,
                axum::http::StatusCode::SERVICE_UNAVAILABLE
            );
            assert_eq!(style().await.0, axum::http::StatusCode::SERVICE_UNAVAILABLE);
            assert!(index().await.1.0.contains("built without the web console"));
        }
    }
}
