// SPDX-License-Identifier: Apache-2.0
//! One public asset namespace over the existing source owners; no image/font/3D codecs.
use axum::{
    Router,
    body::Body,
    extract::{Path as RoutePath, State},
    http::{HeaderValue, Request, StatusCode, header},
    response::{IntoResponse, Response},
    routing::get,
};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeMap,
    io,
    path::{Component, Path, PathBuf},
    sync::{
        Arc,
        atomic::{AtomicU64, Ordering},
    },
};
use tower_http::services::ServeFile;

/// Only published product assets. Provider stores, dossiers and native binaries are absent.
pub const SOURCE_ROOTS: &[(&str, &str)] = &[
    ("icons", "m3/packages/assets/icons"),
    ("images", "m3/packages/assets/images"),
    ("svgs", "m3/packages/assets/svgs"),
    ("sounds", "m3/packages/assets/sounds"),
    ("videos", "m3/packages/assets/videos"),
    ("lottie", "m3/packages/assets/lottie"),
    ("models", "m3/packages/assets/models"),
    ("wasm", "m3/packages/assets/wasm"),
    ("brand", "crates/ui/identity/assets/brand"),
    ("logo", "crates/ui/identity/assets/logo"),
    ("pet", "crates/ui/identity/assets/aphrody"),
    ("fonts", "m3/packages/m3-fonts/fonts"),
    ("shaders", "crates/ui/render/src"),
];
const MAX_BYTES: u64 = 128 * 1024 * 1024;
static SNAPSHOT_ID: AtomicU64 = AtomicU64::new(0);

#[derive(Clone)]
pub struct SharedAssets {
    roots: BTreeMap<&'static str, PathBuf>,
    cache: PathBuf,
}

#[derive(Serialize)]
pub struct AssetEntry {
    pub namespace: String,
    pub path: String,
    pub sha256: String,
    pub bytes: u64,
    pub content_type: &'static str,
    pub url: String,
}

impl SharedAssets {
    pub fn for_workspace(workspace: &Path) -> io::Result<Self> {
        let public = std::env::var_os("APHRODY_PUBLIC_ASSET_ROOT")
            .filter(|value| !value.is_empty()).map(PathBuf::from);
        Self::for_roots(workspace, public.as_deref())
    }

    fn for_roots(workspace: &Path, public: Option<&Path>) -> io::Result<Self> {
        let workspace = workspace.canonicalize()?;
        let public = public.map(Path::canonicalize).transpose()?;
        let boundary = public.as_deref().unwrap_or(&workspace);
        let roots = SOURCE_ROOTS
            .iter()
            .filter_map(|(name, relative)| {
                let root = boundary.join(if public.is_some() { name } else { relative }).canonicalize().ok()?;
                (root.is_dir() && root.starts_with(boundary)).then_some((*name, root))
            })
            .collect();
        let cache = std::env::var_os("APHRODY_ASSET_CACHE").filter(|v| !v.is_empty()).map_or_else(
            || {
                std::env::temp_dir()
                    .join("aphrody-site-assets")
                    .join(hex::encode(Sha256::digest(workspace.to_string_lossy().as_bytes())))
            },
            PathBuf::from,
        );
        std::fs::create_dir_all(&cache)?;
        Ok(Self { roots, cache: cache.canonicalize()? })
    }

    pub fn router(self) -> Router {
        Router::new()
            .route("/assets/manifest", get(manifest))
            .route("/assets/{namespace}/{*path}", get(alias))
            .route("/assets/hash/{digest}/{namespace}/{*path}", get(versioned))
            .with_state(Arc::new(self))
    }

    fn allowed(&self, namespace: &str, relative: &str) -> bool {
        self.roots.contains_key(namespace)
            && !relative.is_empty()
            && !relative.contains(['\\', '%', ':'])
            && !relative.chars().any(char::is_control)
            && !relative.split('/').any(str::is_empty)
            && Path::new(relative).components().all(|c| matches!(c, Component::Normal(_)))
            && media_type(namespace, relative).is_some()
    }

    fn source(&self, namespace: &str, relative: &str) -> io::Result<PathBuf> {
        if !self.allowed(namespace, relative) {
            return Err(io::Error::new(io::ErrorKind::InvalidInput, "invalid public asset"));
        }
        let root =
            self.roots.get(namespace).ok_or_else(|| io::Error::from(io::ErrorKind::NotFound))?;
        let path = root.join(relative).canonicalize()?;
        if !path.starts_with(root) || !path.is_file() {
            return Err(io::Error::new(
                io::ErrorKind::PermissionDenied,
                "asset outside source owner",
            ));
        }
        Ok(path)
    }

    async fn snapshot(&self, namespace: &str, relative: &str) -> io::Result<AssetEntry> {
        let path = self.source(namespace, relative)?;
        if tokio::fs::metadata(&path).await?.len() > MAX_BYTES {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "public asset exceeds size limit",
            ));
        }
        let bytes = tokio::fs::read(path).await?;
        if bytes.len() as u64 > MAX_BYTES {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "public asset exceeds size limit",
            ));
        }
        let sha256 = hex::encode(Sha256::digest(&bytes));
        let target = self.cache.join(&sha256);
        if self.cached(&sha256).await.is_none() {
            let id = SNAPSHOT_ID.fetch_add(1, Ordering::Relaxed);
            let temporary = self.cache.join(format!("{sha256}.{}.{}.tmp", std::process::id(), id));
            tokio::fs::write(&temporary, &bytes).await?;
            if let Err(error) = tokio::fs::rename(&temporary, &target).await {
                let _ = tokio::fs::remove_file(&temporary).await;
                if self.cached(&sha256).await.is_none() {
                    return Err(error);
                }
            }
        }
        let url = format!("/assets/hash/{sha256}/{namespace}/{relative}");
        Ok(AssetEntry {
            namespace: namespace.into(),
            path: relative.into(),
            sha256,
            bytes: bytes.len() as u64,
            content_type: media_type(namespace, relative).unwrap_or("application/octet-stream"),
            url,
        })
    }

    async fn cached(&self, digest: &str) -> Option<PathBuf> {
        if digest.len() != 64
            || !digest.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
        {
            return None;
        }
        let path = self.cache.join(digest).canonicalize().ok()?;
        if !path.starts_with(&self.cache) || !path.is_file() {
            return None;
        }
        if tokio::fs::metadata(&path).await.ok()?.len() > MAX_BYTES {
            return None;
        }
        let bytes = tokio::fs::read(&path).await.ok()?;
        (hex::encode(Sha256::digest(&bytes)) == digest).then_some(path)
    }

    async fn response(
        &self,
        namespace: &str,
        relative: &str,
        expected: Option<&str>,
        request: Request<Body>,
    ) -> Response {
        let Some(content_type) = media_type(namespace, relative) else {
            return StatusCode::NOT_FOUND.into_response();
        };
        if !self.allowed(namespace, relative) {
            return StatusCode::NOT_FOUND.into_response();
        }
        let (digest, path) = if let Some(digest) = expected {
            match self.cached(digest).await {
                Some(path) => (digest.to_owned(), path),
                None => match self.snapshot(namespace, relative).await {
                    Ok(entry) if entry.sha256 == digest => (entry.sha256, self.cache.join(digest)),
                    _ => return StatusCode::NOT_FOUND.into_response(),
                },
            }
        } else {
            match self.snapshot(namespace, relative).await {
                Ok(entry) => {
                    let path = self.cache.join(&entry.sha256);
                    (entry.sha256, path)
                },
                Err(_) => return StatusCode::NOT_FOUND.into_response(),
            }
        };
        let etag = format!("\"{digest}\"");
        let unchanged =
            request.headers().get(header::IF_NONE_MATCH).and_then(|v| v.to_str().ok()).is_some_and(
                |values| {
                    values.split(',').any(|v| {
                        let v = v.trim();
                        v == "*" || v.strip_prefix("W/").unwrap_or(v) == etag
                    })
                },
            );
        let mut response = if unchanged {
            StatusCode::NOT_MODIFIED.into_response()
        } else {
            match ServeFile::new(path).try_call(request).await {
                Ok(response) => response.map(Body::new),
                Err(_) => return StatusCode::NOT_FOUND.into_response(),
            }
        };
        let headers = response.headers_mut();
        headers.insert(header::CONTENT_TYPE, HeaderValue::from_static(content_type));
        headers.insert(header::ETAG, HeaderValue::from_str(&etag).expect("SHA256 ETag is ASCII"));
        headers.insert(
            header::CACHE_CONTROL,
            HeaderValue::from_static(if expected.is_some() {
                "public, max-age=31536000, immutable"
            } else {
                "public, no-cache"
            }),
        );
        headers.insert(header::X_CONTENT_TYPE_OPTIONS, HeaderValue::from_static("nosniff"));
        headers.insert(header::ACCESS_CONTROL_ALLOW_ORIGIN, HeaderValue::from_static("*"));
        response
    }

    pub async fn entries(&self) -> io::Result<Vec<AssetEntry>> {
        let mut entries = Vec::new();
        for (namespace, root) in &self.roots {
            let mut directories = vec![root.clone()];
            while let Some(directory) = directories.pop() {
                let mut files = tokio::fs::read_dir(directory).await?;
                while let Some(file) = files.next_entry().await? {
                    let kind = file.file_type().await?;
                    if kind.is_dir() {
                        directories.push(file.path());
                    } else if kind.is_file() {
                        let path = file.path();
                        let relative = path
                            .strip_prefix(root)
                            .map_err(io::Error::other)?
                            .to_string_lossy()
                            .replace('\\', "/");
                        if media_type(namespace, &relative).is_some() {
                            entries.push(self.snapshot(namespace, &relative).await?);
                        }
                    }
                }
            }
        }
        entries.sort_by(|a, b| (&a.namespace, &a.path).cmp(&(&b.namespace, &b.path)));
        Ok(entries)
    }
}

fn media_type(namespace: &str, relative: &str) -> Option<&'static str> {
    let extension = Path::new(relative).extension()?.to_str()?;
    let allowed = match namespace {
        "icons" | "images" => {
            matches!(extension, "svg" | "png" | "webp" | "jpg" | "jpeg" | "gif" | "avif" | "ico")
        },
        "svgs" => extension == "svg",
        "brand" => matches!(extension, "png" | "svg" | "ico"),
        "logo" => matches!(extension, "webp" | "png" | "svg"),
        "pet" => {
            matches!(extension, "png" | "webp")
                || matches!(relative, "pet.json" | "animations.json")
        },
        "fonts" => matches!(extension, "woff" | "woff2" | "ttf" | "otf"),
        "shaders" => extension == "wgsl",
        "models" => matches!(extension, "glb" | "gltf"),
        "wasm" => extension == "wasm",
        "sounds" => matches!(extension, "mp3" | "wav" | "ogg"),
        "videos" => matches!(extension, "mp4" | "webm"),
        "lottie" => extension == "json",
        _ => false,
    };
    if !allowed {
        return None;
    }
    match extension {
        "svg" => Some("image/svg+xml"),
        "png" => Some("image/png"),
        "webp" => Some("image/webp"),
        "jpg" | "jpeg" => Some("image/jpeg"),
        "gif" => Some("image/gif"),
        "avif" => Some("image/avif"),
        "ico" => Some("image/x-icon"),
        "woff" => Some("font/woff"),
        "woff2" => Some("font/woff2"),
        "ttf" => Some("font/ttf"),
        "otf" => Some("font/otf"),
        "glb" => Some("model/gltf-binary"),
        "gltf" => Some("model/gltf+json"),
        "wasm" => Some("application/wasm"),
        "wgsl" => Some("text/wgsl; charset=utf-8"),
        "mp3" => Some("audio/mpeg"),
        "wav" => Some("audio/wav"),
        "ogg" => Some("audio/ogg"),
        "mp4" => Some("video/mp4"),
        "webm" => Some("video/webm"),
        "json"
            if namespace == "lottie"
                || (namespace == "pet" && matches!(relative, "pet.json" | "animations.json")) =>
        {
            Some("application/json")
        },
        _ => None,
    }
}

async fn alias(
    State(assets): State<Arc<SharedAssets>>,
    RoutePath((namespace, path)): RoutePath<(String, String)>,
    request: Request<Body>,
) -> Response {
    assets.response(&namespace, &path, None, request).await
}
async fn versioned(
    State(assets): State<Arc<SharedAssets>>,
    RoutePath((digest, namespace, path)): RoutePath<(String, String, String)>,
    request: Request<Body>,
) -> Response {
    assets.response(&namespace, &path, Some(&digest), request).await
}
async fn manifest(State(assets): State<Arc<SharedAssets>>) -> Response {
    match assets.entries().await {
        Ok(entries) => ([(header::CACHE_CONTROL, "no-cache")], axum::Json(entries)).into_response(),
        Err(_) => StatusCode::SERVICE_UNAVAILABLE.into_response(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::to_bytes;
    use tower::ServiceExt;

    fn fixture() -> (tempfile::TempDir, SharedAssets) {
        let root = tempfile::tempdir().unwrap();
        let icons = root.path().join("m3/packages/assets/icons");
        std::fs::create_dir_all(&icons).unwrap();
        for directory in ["models", "wasm", "fonts"] {
            let relative = if directory == "fonts" {
                "m3/packages/m3-fonts/fonts".to_owned()
            } else {
                format!("m3/packages/assets/{directory}")
            };
            std::fs::create_dir_all(root.path().join(relative)).unwrap();
        }
        std::fs::write(icons.join("sample.png"), b"same asset bytes").unwrap();
        std::fs::write(icons.join("duplicate.png"), b"same asset bytes").unwrap();
        let mut assets = SharedAssets::for_workspace(root.path()).unwrap();
        assets.cache = root.path().join("cache");
        std::fs::create_dir_all(&assets.cache).unwrap();
        assets.cache = assets.cache.canonicalize().unwrap();
        (root, assets)
    }

    #[tokio::test]
    async fn source_manifest_deduplicates_bytes_and_versions_mutable_aliases() {
        let (root, assets) = fixture();
        let entries = assets.entries().await.unwrap();
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].sha256, entries[1].sha256);
        assert_eq!(std::fs::read_dir(&assets.cache).unwrap().count(), 1);
        let url = entries[1].url.clone();
        let app = assets.router();
        let response = app
            .clone()
            .oneshot(Request::builder().uri(&url).body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(
            response.headers()[header::CACHE_CONTROL],
            "public, max-age=31536000, immutable"
        );
        assert_eq!(response.headers()[header::CONTENT_TYPE], "image/png");
        let etag = response.headers()[header::ETAG].clone();
        assert_eq!(
            to_bytes(response.into_body(), 1024).await.unwrap().as_ref(),
            b"same asset bytes"
        );
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri(&url)
                    .header(header::IF_NONE_MATCH, etag)
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::NOT_MODIFIED);
        assert!(to_bytes(response.into_body(), 1024).await.unwrap().is_empty());
        std::fs::write(root.path().join("m3/packages/assets/icons/sample.png"), b"new bytes")
            .unwrap();
        let response = app
            .clone()
            .oneshot(Request::builder().uri(&url).body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(
            to_bytes(response.into_body(), 1024).await.unwrap().as_ref(),
            b"same asset bytes"
        );
        let response = app
            .clone()
            .oneshot(
                Request::builder().uri("/assets/icons/sample.png").body(Body::empty()).unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.headers()[header::CACHE_CONTROL], "public, no-cache");
        assert_eq!(to_bytes(response.into_body(), 1024).await.unwrap().as_ref(), b"new bytes");
        std::fs::remove_file(root.path().join("m3/packages/assets/icons/sample.png")).unwrap();
        let response = app
            .clone()
            .oneshot(Request::builder().uri(&url).body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(
            to_bytes(response.into_body(), 1024).await.unwrap().as_ref(),
            b"same asset bytes"
        );
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/assets/hash/not-a-digest/icons/duplicate.png")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::NOT_FOUND);
        std::fs::write(root.path().join("cache").join(&entries[1].sha256), b"corrupt snapshot")
            .unwrap();
        let response =
            app.oneshot(Request::builder().uri(&url).body(Body::empty()).unwrap()).await.unwrap();
        assert_eq!(response.status(), StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn head_ranges_mime_and_source_boundaries() {
        let (root, assets) = fixture();
        assert!(assets.source("icons", "../outside.png").is_err());
        assert!(assets.source("icons", "%2e%2e/outside.png").is_err());
        assert!(assets.source("icons", "private.ts").is_err());
        assert!(assets.source("provider", "sample.png").is_err());
        assert!(media_type("pet", "dossier.json").is_none());
        assert!(media_type("fonts", "private.png").is_none());
        assert!(media_type("icons", "private.wasm").is_none());
        assert!(media_type("shaders", "source.rs").is_none());
        assert_eq!(media_type("wasm", "runtime.wasm"), Some("application/wasm"));
        assert_eq!(media_type("models", "scene.glb"), Some("model/gltf-binary"));
        assert_eq!(media_type("fonts", "font.woff2"), Some("font/woff2"));
        std::fs::write(root.path().join("m3/packages/assets/models/scene.glb"), b"glTF12345678")
            .unwrap();
        std::fs::write(
            root.path().join("m3/packages/assets/wasm/runtime.wasm"),
            [0, 97, 115, 109, 1, 0, 0, 0],
        )
        .unwrap();
        std::fs::write(root.path().join("m3/packages/m3-fonts/fonts/font.woff2"), b"wOF2data")
            .unwrap();
        let app = assets.router();
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("HEAD")
                    .uri("/assets/icons/sample.png")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(response.headers()[header::CONTENT_LENGTH], "16");
        assert!(to_bytes(response.into_body(), 1024).await.unwrap().is_empty());
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/assets/models/scene.glb")
                    .header(header::RANGE, "bytes=0-3")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::PARTIAL_CONTENT);
        assert_eq!(response.headers()[header::CONTENT_TYPE], "model/gltf-binary");
        assert_eq!(to_bytes(response.into_body(), 1024).await.unwrap().as_ref(), b"glTF");
        let response = app
            .clone()
            .oneshot(
                Request::builder().uri("/assets/wasm/runtime.wasm").body(Body::empty()).unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(response.headers()[header::CONTENT_TYPE], "application/wasm");
        assert_eq!(
            to_bytes(response.into_body(), 1024).await.unwrap().as_ref(),
            &[0, 97, 115, 109, 1, 0, 0, 0]
        );
        let response = app
            .oneshot(
                Request::builder()
                    .method("HEAD")
                    .uri("/assets/fonts/font.woff2")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(response.headers()[header::CONTENT_TYPE], "font/woff2");
        assert_eq!(response.headers()[header::CONTENT_LENGTH], "8");
        assert!(to_bytes(response.into_body(), 1024).await.unwrap().is_empty());
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn symlinks_cannot_export_other_stores() {
        let (root, assets) = fixture();
        let outside = tempfile::tempdir().unwrap();
        std::fs::write(outside.path().join("private.png"), b"protected").unwrap();
        std::os::unix::fs::symlink(
            outside.path().join("private.png"),
            root.path().join("m3/packages/assets/icons/private.png"),
        )
        .unwrap();
        assert!(assets.source("icons", "private.png").is_err());
        let entries = assets.entries().await.unwrap();
        assert_eq!(entries.len(), 2);
    }
}
