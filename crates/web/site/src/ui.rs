// SPDX-License-Identifier: Apache-2.0
//! Serve the canonical app-ui artifact; the site owns no separate frontend.
use axum::{
    http::{StatusCode, header},
    response::{IntoResponse, Response},
};
use std::{
    io,
    path::{Component, Path, PathBuf},
};

pub struct AppUi {
    root: PathBuf,
}

impl AppUi {
    pub fn load(root: &Path) -> io::Result<Self> {
        let ui = Self { root: root.canonicalize()? };
        for asset in ["index.html", "app.js", "app.css"] {
            ui.asset_path(asset)?;
        }
        Ok(ui)
    }

    pub fn for_workspace(workspace: &Path) -> io::Result<Self> {
        let root = std::env::var_os("APHRODY_UI_DIR")
            .filter(|value| !value.is_empty())
            .map(PathBuf::from)
            .unwrap_or_else(|| workspace.join("crates/ui/app/ui-dist"));
        Self::load(&root)
    }

    fn asset_path(&self, relative: &str) -> io::Result<PathBuf> {
        if relative.contains(['\\', '%', ':'])
            || relative.chars().any(char::is_control)
            || Path::new(relative).components().any(|part| !matches!(part, Component::Normal(_)))
        {
            return Err(io::Error::new(io::ErrorKind::InvalidInput, "invalid UI asset path"));
        }
        let path = self.root.join(relative).canonicalize()?;
        if !path.starts_with(&self.root) || !path.is_file() {
            return Err(io::Error::new(io::ErrorKind::PermissionDenied, "asset outside app-ui"));
        }
        Ok(path)
    }

    pub fn entry_html(&self) -> io::Result<String> {
        std::fs::read_to_string(self.asset_path("index.html")?)
    }

    pub async fn response(&self, request_path: &str) -> Response {
        let relative = request_path.strip_prefix('/').unwrap_or(request_path);
        if relative.starts_with("api/")
            || matches!(relative, "api" | "rpc" | "events" | "notifications" | "healthz")
        {
            return StatusCode::NOT_FOUND.into_response();
        }
        let path = match self.asset_path(relative) {
            Ok(path) => path,
            Err(_) if !relative.contains(['.', '\\', '%', ':']) => {
                match self.asset_path("index.html") {
                    Ok(path) => path,
                    Err(_) => return StatusCode::SERVICE_UNAVAILABLE.into_response(),
                }
            },
            Err(_) => return StatusCode::NOT_FOUND.into_response(),
        };
        let content_type = match path.extension().and_then(|extension| extension.to_str()) {
            Some("html") => "text/html; charset=utf-8",
            Some("js" | "mjs") => "text/javascript; charset=utf-8",
            Some("css") => "text/css; charset=utf-8",
            Some("json") => "application/json",
            Some("svg") => "image/svg+xml",
            Some("png") => "image/png",
            Some("webp") => "image/webp",
            Some("jpg" | "jpeg") => "image/jpeg",
            Some("ico") => "image/x-icon",
            Some("woff") => "font/woff",
            Some("woff2") => "font/woff2",
            Some("ttf") => "font/ttf",
            Some("otf") => "font/otf",
            Some("wasm") => "application/wasm",
            _ => "application/octet-stream",
        };
        match tokio::fs::read(path).await {
            Ok(bytes) => (
                [
                    (header::CONTENT_TYPE, content_type),
                    (header::CACHE_CONTROL, "no-cache"),
                    (header::X_CONTENT_TYPE_OPTIONS, "nosniff"),
                ],
                bytes,
            )
                .into_response(),
            Err(_) => StatusCode::NOT_FOUND.into_response(),
        }
    }
}
