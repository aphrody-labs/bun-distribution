// SPDX-License-Identifier: FSL-1.1-ALv2
// Derived from Spacedrive (drive/apps/tauri/crates/file-opening and src-tauri/src/file_opening.rs),
// adopted as the Aphrody Drive file explorer.
//! "Open" and "Open with": list the applications that handle a file and launch one.
//! One implementation per platform: Shell association handlers on Windows, freedesktop desktop
//! entries on Linux, Launch Services (Swift bridge) on macOS.

#[cfg(target_os = "linux")]
mod linux;
#[cfg(target_os = "macos")]
mod macos;
#[cfg(windows)]
mod win;

use std::{
    collections::{HashMap, HashSet},
    path::{Path, PathBuf},
};

use serde::{Deserialize, Serialize};
use tauri::State;

/// An application that can open a file.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct OpenWithApp {
    /// Platform identifier: bundle ID (macOS), handler name (Windows), desktop entry ID (Linux).
    pub id: String,
    /// Display name.
    pub name: String,
    /// Optional base64 PNG icon.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub icon: Option<String>,
}

/// Outcome of an open request.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum OpenResult {
    Success,
    FileNotFound { path: String },
    AppNotFound { app_id: String },
    PermissionDenied { path: String },
    PlatformError { message: String },
}

impl OpenResult {
    /// `FileNotFound` for `path`.
    #[must_use]
    pub fn not_found(path: &Path) -> Self {
        Self::FileNotFound { path: path.to_string_lossy().into_owned() }
    }
}

/// A platform file opener.
pub trait FileOpener: Send + Sync {
    /// Applications that can open `path`.
    ///
    /// # Errors
    /// When the platform query fails.
    fn get_apps_for_file(&self, path: &Path) -> Result<Vec<OpenWithApp>, String>;

    /// Applications that can open every path (intersection), sorted by name.
    ///
    /// # Errors
    /// When a platform query fails.
    fn get_apps_for_files(&self, paths: &[PathBuf]) -> Result<Vec<OpenWithApp>, String> {
        let Some((first, rest)) = paths.split_first() else { return Ok(Vec::new()) };
        let mut per_file = vec![self.get_apps_for_file(first)?];
        for path in rest {
            per_file.push(self.get_apps_for_file(path)?);
        }
        Ok(intersect_apps(per_file))
    }

    /// Open with the default application.
    ///
    /// # Errors
    /// When the platform call itself fails (application-level failures are `OpenResult`s).
    fn open_with_default(&self, path: &Path) -> Result<OpenResult, String>;

    /// Open with a given application.
    ///
    /// # Errors
    /// When the platform call itself fails.
    fn open_with_app(&self, path: &Path, app_id: &str) -> Result<OpenResult, String>;

    /// Open several files with a given application.
    ///
    /// # Errors
    /// When a platform call itself fails.
    fn open_files_with_app(
        &self,
        paths: &[PathBuf],
        app_id: &str,
    ) -> Result<Vec<OpenResult>, String> {
        paths.iter().map(|path| self.open_with_app(path, app_id)).collect()
    }
}

/// Keep the applications present in every list, sorted by name.
#[must_use]
pub fn intersect_apps(per_file: Vec<Vec<OpenWithApp>>) -> Vec<OpenWithApp> {
    let mut lists = per_file.into_iter();
    let Some(first) = lists.next() else { return Vec::new() };
    let mut common: HashMap<String, OpenWithApp> =
        first.into_iter().map(|app| (app.id.clone(), app)).collect();
    for list in lists {
        let ids: HashSet<String> = list.into_iter().map(|app| app.id).collect();
        common.retain(|id, _| ids.contains(id));
    }
    let mut result: Vec<_> = common.into_values().collect();
    result.sort_by(|a, b| a.name.cmp(&b.name).then_with(|| a.id.cmp(&b.id)));
    result
}

/// The opener managed as Tauri state.
pub struct FileOpeningService {
    opener: std::sync::Arc<dyn FileOpener>,
}

impl FileOpeningService {
    /// The opener of this platform.
    #[must_use]
    pub fn new() -> Self {
        #[cfg(windows)]
        let opener: std::sync::Arc<dyn FileOpener> = std::sync::Arc::new(win::WindowsFileOpener);
        #[cfg(target_os = "linux")]
        let opener: std::sync::Arc<dyn FileOpener> = std::sync::Arc::new(linux::LinuxFileOpener);
        #[cfg(target_os = "macos")]
        let opener: std::sync::Arc<dyn FileOpener> = std::sync::Arc::new(macos::MacFileOpener);
        #[cfg(not(any(windows, target_os = "linux", target_os = "macos")))]
        let opener: std::sync::Arc<dyn FileOpener> = std::sync::Arc::new(Unsupported);
        Self { opener }
    }
}

impl Default for FileOpeningService {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(not(any(windows, target_os = "linux", target_os = "macos")))]
struct Unsupported;

#[cfg(not(any(windows, target_os = "linux", target_os = "macos")))]
impl FileOpener for Unsupported {
    fn get_apps_for_file(&self, _path: &Path) -> Result<Vec<OpenWithApp>, String> {
        Ok(Vec::new())
    }

    fn open_with_default(&self, _path: &Path) -> Result<OpenResult, String> {
        Ok(OpenResult::PlatformError {
            message: "Opening files is not supported on this platform".into(),
        })
    }

    fn open_with_app(&self, path: &Path, _app_id: &str) -> Result<OpenResult, String> {
        self.open_with_default(path)
    }
}

/// Run a blocking opener call off the async runtime (COM, Launch Services, process spawns).
async fn blocking<T: Send + 'static>(
    service: &FileOpeningService,
    call: impl FnOnce(&dyn FileOpener) -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    let opener = std::sync::Arc::clone(&service.opener);
    tauri::async_runtime::spawn_blocking(move || call(opener.as_ref()))
        .await
        .map_err(|error| format!("file opener failed: {error}"))?
}

/// Applications that can open every given path.
#[tauri::command]
pub async fn get_apps_for_paths(
    paths: Vec<PathBuf>,
    service: State<'_, FileOpeningService>,
) -> Result<Vec<OpenWithApp>, String> {
    if paths.is_empty() {
        return Ok(Vec::new());
    }
    blocking(&service, move |opener| opener.get_apps_for_files(&paths)).await
}

/// Open a file with its default application.
#[tauri::command]
pub async fn open_path_default(
    path: PathBuf,
    service: State<'_, FileOpeningService>,
) -> Result<OpenResult, String> {
    blocking(&service, move |opener| opener.open_with_default(&path)).await
}

/// Open a file with a given application.
#[tauri::command]
pub async fn open_path_with_app(
    path: PathBuf,
    app_id: String,
    service: State<'_, FileOpeningService>,
) -> Result<OpenResult, String> {
    blocking(&service, move |opener| opener.open_with_app(&path, &app_id)).await
}

/// Open several files with a given application.
#[tauri::command]
pub async fn open_paths_with_app(
    paths: Vec<PathBuf>,
    app_id: String,
    service: State<'_, FileOpeningService>,
) -> Result<Vec<OpenResult>, String> {
    blocking(&service, move |opener| opener.open_files_with_app(&paths, &app_id)).await
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    fn app(id: &str, name: &str) -> OpenWithApp {
        OpenWithApp { id: id.into(), name: name.into(), icon: None }
    }

    #[test]
    fn intersection_keeps_common_apps_sorted_by_name() {
        let result = intersect_apps(vec![
            vec![app("vlc", "VLC"), app("mpv", "mpv"), app("gimp", "GIMP")],
            vec![app("gimp", "GIMP"), app("vlc", "VLC")],
        ]);
        assert_eq!(result, vec![app("gimp", "GIMP"), app("vlc", "VLC")]);
        assert!(intersect_apps(Vec::new()).is_empty());
        assert!(intersect_apps(vec![vec![app("a", "A")], Vec::new()]).is_empty());
    }

    #[test]
    fn results_serialize_with_a_status_tag() {
        assert_eq!(
            serde_json::to_value(OpenResult::Success).unwrap(),
            json!({"status": "success"})
        );
        assert_eq!(
            serde_json::to_value(OpenResult::AppNotFound { app_id: "x".into() }).unwrap(),
            json!({"status": "app_not_found", "app_id": "x"})
        );
        assert_eq!(
            serde_json::to_value(OpenResult::not_found(Path::new("f"))).unwrap(),
            json!({"status": "file_not_found", "path": "f"})
        );
        assert_eq!(serde_json::to_value(app("a", "A")).unwrap(), json!({"id": "a", "name": "A"}));
    }
}
