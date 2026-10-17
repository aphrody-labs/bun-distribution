// SPDX-License-Identifier: FSL-1.1-ALv2
// Derived from Spacedrive (drive/apps/tauri/src-tauri/src/server.rs), adopted as the Aphrody Drive
// file explorer.
//! Local HTTP server for sidecars (thumbnails, transcripts, previews).
//!
//! Tauri custom URI protocols cannot stream asynchronously, so sidecars are served by an Axum
//! server bound to `127.0.0.1` on a random port:
//! `GET /{token}/sidecar/{library_id}/{content_uuid}/{kind}/{variant}.{ext}`. The explorer learns
//! the URL from `get_daemon_status` / `get_server_url`.

use std::{
    net::Ipv4Addr,
    path::{Path, PathBuf},
};

use axum::{
    Router,
    body::Body,
    extract::{Path as UrlPath, Request, State},
    http::{HeaderValue, Response, StatusCode, header},
    middleware::{self, Next},
    routing::get,
};
use tokio::{fs::File, io, net::TcpListener, sync::mpsc};
use uuid::Uuid;

#[derive(Clone)]
struct ServerState {
    /// The explorer data directory.
    data_dir: PathBuf,
    token: String,
}

/// Whether `id` is a library or content UUID (hex digits and dashes, at least 4 characters).
#[must_use]
pub fn is_uuid_like(id: &str) -> bool {
    id.len() >= 4
        && id
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() || byte == b'-')
}

/// Whether `name` is a single safe path component (no separator, no `..`, not hidden).
#[must_use]
pub fn is_safe_component(name: &str) -> bool {
    !name.is_empty() && !name.starts_with('.') && !name.contains(['/', '\\', ':', '\0'])
}

/// The sidecar directory name for a kind: `thumb` → `thumbs`, `transcript` stays singular.
#[must_use]
pub fn kind_dir(kind: &str) -> String {
    if kind == "transcript" {
        kind.to_string()
    } else {
        format!("{kind}s")
    }
}

/// The sidecar file inside a library folder:
/// `sidecars/content/{uuid[0..2]}/{uuid[2..4]}/{uuid}/{kind}s/{file}`.
///
/// # Errors
/// When a component is not a UUID or not a single safe path component.
pub fn sidecar_path(
    library_folder: &Path,
    content_uuid: &str,
    kind: &str,
    file: &str,
) -> Result<PathBuf, String> {
    if !is_uuid_like(content_uuid) {
        return Err(format!("Invalid content UUID: {content_uuid}"));
    }
    if !is_safe_component(kind) || !is_safe_component(file) {
        return Err(format!("Invalid sidecar component: {kind}/{file}"));
    }
    Ok(library_folder
        .join("sidecars")
        .join("content")
        .join(&content_uuid[0..2])
        .join(&content_uuid[2..4])
        .join(content_uuid)
        .join(kind_dir(kind))
        .join(file))
}

/// Find the `.sdlibrary` folder whose `library.json` carries `library_id` (folders may be
/// named differently from the ID).
pub async fn find_library_folder(data_dir: &Path, library_id: &str) -> Option<PathBuf> {
    let mut entries = tokio::fs::read_dir(data_dir.join("libraries")).await.ok()?;
    while let Ok(Some(entry)) = entries.next_entry().await {
        let path = entry.path();
        if path.extension().and_then(|extension| extension.to_str()) != Some("sdlibrary") {
            continue;
        }
        let Ok(contents) = tokio::fs::read_to_string(path.join("library.json")).await else {
            continue;
        };
        let Ok(json) = serde_json::from_str::<serde_json::Value>(&contents) else {
            continue;
        };
        if json.get("id").and_then(serde_json::Value::as_str) == Some(library_id) {
            return Some(path);
        }
    }
    None
}

/// Content type from the file extension.
#[must_use]
pub fn content_type(file: &str) -> &'static str {
    match file.rsplit('.').next() {
        Some("webp") => "image/webp",
        Some("jpg" | "jpeg") => "image/jpeg",
        Some("png") => "image/png",
        Some("gif") => "image/gif",
        Some("avif") => "image/avif",
        Some("mp4") => "video/mp4",
        Some("webm") => "video/webm",
        Some("txt") => "text/plain; charset=utf-8",
        Some("json") => "application/json",
        _ => "application/octet-stream",
    }
}

async fn serve_sidecar(
    State(state): State<ServerState>,
    UrlPath((token, library_id, content_uuid, kind, file)): UrlPath<(
        String,
        String,
        String,
        String,
        String,
    )>,
) -> Result<Response<Body>, StatusCode> {
    if token != state.token {
        return Err(StatusCode::NOT_FOUND);
    }
    let library_folder = find_library_folder(&state.data_dir, &library_id)
        .await
        .ok_or(StatusCode::NOT_FOUND)?;
    let path = sidecar_path(&library_folder, &content_uuid, &kind, &file).map_err(|error| {
        log::error!("sidecar request rejected: {error}");
        StatusCode::FORBIDDEN
    })?;
    let libraries_root = tokio::fs::canonicalize(state.data_dir.join("libraries"))
        .await
        .map_err(|_| StatusCode::NOT_FOUND)?;
    let library_root = tokio::fs::canonicalize(&library_folder)
        .await
        .map_err(|_| StatusCode::NOT_FOUND)?;
    let resolved_path = tokio::fs::canonicalize(&path).await.map_err(|error| {
        if error.kind() == io::ErrorKind::NotFound {
            StatusCode::NOT_FOUND
        } else {
            StatusCode::INTERNAL_SERVER_ERROR
        }
    })?;
    if !library_root.starts_with(&libraries_root) || !resolved_path.starts_with(&library_root) {
        log::error!("sidecar path escapes its library directory");
        return Err(StatusCode::FORBIDDEN);
    }
    let file_handle = File::open(&resolved_path).await.map_err(|error| {
        if error.kind() == io::ErrorKind::NotFound {
            StatusCode::NOT_FOUND
        } else {
            log::error!("opening sidecar: {error}");
            StatusCode::INTERNAL_SERVER_ERROR
        }
    })?;
    let length = file_handle
        .metadata()
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .len();
    Response::builder()
        .status(StatusCode::OK)
        .header(
            header::CONTENT_TYPE,
            HeaderValue::from_static(content_type(&file)),
        )
        .header(header::CONTENT_LENGTH, length)
        .header(
            header::CACHE_CONTROL,
            HeaderValue::from_static("private, no-store"),
        )
        .header(
            header::X_CONTENT_TYPE_OPTIONS,
            HeaderValue::from_static("nosniff"),
        )
        .body(Body::from_stream(tokio_util::io::ReaderStream::new(
            file_handle,
        )))
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)
}

/// The desktop webview is cross-origin from the loopback sidecar server.
fn allowed_webview_origin(origin: &HeaderValue) -> bool {
    matches!(
        origin.to_str(),
        Ok("http://localhost:1421"
            | "http://tauri.localhost"
            | "https://tauri.localhost"
            | "tauri://localhost")
    )
}

async fn add_cors_headers(request: Request, next: Next) -> Response<Body> {
    let origin = request.headers().get(header::ORIGIN).cloned();
    let mut response = next.run(request).await;
    response
        .headers_mut()
        .insert(header::VARY, HeaderValue::from_static("Origin"));
    if let Some(origin) = origin.filter(allowed_webview_origin) {
        response
            .headers_mut()
            .insert(header::ACCESS_CONTROL_ALLOW_ORIGIN, origin);
    }
    response
}

fn router(data_dir: PathBuf, token: String) -> Router {
    Router::new()
        .route(
            "/{token}/sidecar/{library_id}/{content_uuid}/{kind}/{variant}",
            get(serve_sidecar),
        )
        .layer(middleware::from_fn(add_cors_headers))
        .with_state(ServerState { data_dir, token })
}

/// Start the server on a random localhost port; returns its base URL and a shutdown sender.
///
/// # Errors
/// When the port cannot be bound.
pub async fn start_server(data_dir: PathBuf) -> Result<(String, mpsc::Sender<()>), String> {
    let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0))
        .await
        .map_err(|error| error.to_string())?;
    let address = listener.local_addr().map_err(|error| error.to_string())?;
    let token = Uuid::new_v4().simple().to_string();
    let url = format!("http://{address}/{token}");
    log::info!("sidecar server on http://{address}");
    let (shutdown_tx, mut shutdown_rx) = mpsc::channel::<()>(1);
    tauri::async_runtime::spawn(async move {
        let served = axum::serve(listener, router(data_dir, token))
            .with_graceful_shutdown(async move {
                shutdown_rx.recv().await;
            })
            .await;
        if let Err(error) = served {
            log::error!("sidecar server: {error}");
        }
    });
    Ok((url, shutdown_tx))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cors_allows_only_the_desktop_webview() {
        for origin in [
            "http://localhost:1421",
            "http://tauri.localhost",
            "https://tauri.localhost",
            "tauri://localhost",
        ] {
            assert!(allowed_webview_origin(
                &HeaderValue::from_str(origin).unwrap()
            ));
        }
        for origin in ["null", "https://example.test", "http://localhost:1422"] {
            assert!(!allowed_webview_origin(
                &HeaderValue::from_str(origin).unwrap()
            ));
        }
    }

    #[tokio::test]
    async fn sidecar_requires_token_and_stays_inside_its_library() {
        let data = tempfile::tempdir().unwrap();
        let library = data.path().join("libraries").join("Home.sdlibrary");
        std::fs::create_dir_all(&library).unwrap();
        std::fs::write(library.join("library.json"), r#"{"id":"1234"}"#).unwrap();
        let sidecar = sidecar_path(&library, "abcd", "thumb", "grid.webp").unwrap();
        std::fs::create_dir_all(sidecar.parent().unwrap()).unwrap();
        std::fs::write(&sidecar, b"image").unwrap();
        let state = ServerState {
            data_dir: data.path().to_path_buf(),
            token: "secret".into(),
        };
        let request = |token: &str| {
            UrlPath((
                token.to_string(),
                "1234".into(),
                "abcd".into(),
                "thumb".into(),
                "grid.webp".into(),
            ))
        };
        assert!(matches!(
            serve_sidecar(State(state.clone()), request("wrong")).await,
            Err(StatusCode::NOT_FOUND)
        ));
        let response = serve_sidecar(State(state), request("secret"))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(
            response.headers()[header::CACHE_CONTROL],
            "private, no-store"
        );
        assert_eq!(
            response.headers()[header::X_CONTENT_TYPE_OPTIONS],
            "nosniff"
        );
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn sidecar_rejects_symlinks_outside_the_library() {
        let data = tempfile::tempdir().unwrap();
        let library = data.path().join("libraries").join("Home.sdlibrary");
        std::fs::create_dir_all(&library).unwrap();
        std::fs::write(library.join("library.json"), r#"{"id":"1234"}"#).unwrap();
        let outside = data.path().join("outside.txt");
        std::fs::write(&outside, b"private").unwrap();
        let sidecar = sidecar_path(&library, "abcd", "thumb", "grid.webp").unwrap();
        std::fs::create_dir_all(sidecar.parent().unwrap()).unwrap();
        std::os::unix::fs::symlink(outside, sidecar).unwrap();
        let state = ServerState {
            data_dir: data.path().to_path_buf(),
            token: "secret".into(),
        };
        assert!(matches!(
            serve_sidecar(
                State(state),
                UrlPath((
                    "secret".into(),
                    "1234".into(),
                    "abcd".into(),
                    "thumb".into(),
                    "grid.webp".into()
                ))
            )
            .await,
            Err(StatusCode::FORBIDDEN)
        ));
    }

    #[test]
    fn sidecar_paths_follow_the_core_layout() {
        let library = Path::new("/d/libraries/Home.sdlibrary");
        let path = sidecar_path(
            library,
            "0cc0b48f-a475-53ec-a580-bc7d47b486a9",
            "thumb",
            "detail@1x.webp",
        )
        .unwrap();
        assert_eq!(
            path,
            library.join(
                "sidecars/content/0c/c0/0cc0b48f-a475-53ec-a580-bc7d47b486a9/thumbs/detail@1x.webp"
            )
        );
        let transcript = sidecar_path(library, "abcd", "transcript", "text.txt").unwrap();
        assert!(transcript.ends_with(Path::new("transcript").join("text.txt")));
    }

    #[test]
    fn traversal_and_short_ids_are_rejected() {
        let library = Path::new("/d/libraries/Home.sdlibrary");
        assert!(sidecar_path(library, "../../etc", "thumb", "x.webp").is_err());
        assert!(sidecar_path(library, "ab", "thumb", "x.webp").is_err());
        assert!(sidecar_path(library, "abcd", "..", "x.webp").is_err());
        assert!(sidecar_path(library, "abcd", "thumb", "../x.webp").is_err());
        assert!(sidecar_path(library, "abcd", "thumb", r"..\x.webp").is_err());
        assert!(sidecar_path(library, "abcd", "thumb", "C:x").is_err());
    }

    #[test]
    fn content_types() {
        assert_eq!(content_type("detail@1x.webp"), "image/webp");
        assert_eq!(content_type("a.JPG"), "application/octet-stream");
        assert_eq!(content_type("a.jpeg"), "image/jpeg");
        assert_eq!(content_type("noext"), "application/octet-stream");
    }

    #[tokio::test]
    async fn libraries_are_found_by_their_json_id() {
        let data = tempfile::tempdir().unwrap();
        let folder = data.path().join("libraries").join("Named.sdlibrary");
        std::fs::create_dir_all(&folder).unwrap();
        std::fs::write(folder.join("library.json"), r#"{"id":"1234-abcd"}"#).unwrap();
        std::fs::create_dir_all(data.path().join("libraries").join("other")).unwrap();
        assert_eq!(
            find_library_folder(data.path(), "1234-abcd").await,
            Some(folder)
        );
        assert_eq!(find_library_folder(data.path(), "ffff").await, None);
    }
}
