// SPDX-License-Identifier: FSL-1.1-ALv2
// Derived from Spacedrive (drive/apps/tauri/crates/file-opening-macos/src/lib.rs), adopted as the
// Aphrody Drive file explorer.
//! macOS: Launch Services through the `FileOpening` Swift package
//! (`macos/file-opening/src-swift/FileOpening.swift`); every call returns JSON.

use std::path::{Path, PathBuf};

use swift_rs::{SRString, swift};

use super::{FileOpener, OpenResult, OpenWithApp};

swift!(fn get_apps_for_path(path: &SRString) -> SRString);
swift!(fn open_path_with_default(path: &SRString) -> SRString);
swift!(fn open_path_with_app(path: &SRString, app_id: &SRString) -> SRString);
swift!(fn open_paths_with_app(paths: &SRString, app_id: &SRString) -> SRString);

fn decode<T: serde::de::DeserializeOwned>(json: &str) -> Result<T, String> {
    serde_json::from_str(json).map_err(|error| error.to_string())
}

pub(super) struct MacFileOpener;

impl FileOpener for MacFileOpener {
    fn get_apps_for_file(&self, path: &Path) -> Result<Vec<OpenWithApp>, String> {
        let path = SRString::from(path.to_string_lossy().as_ref());
        // SAFETY: the Swift function copies its argument and returns an owned string.
        decode(unsafe { get_apps_for_path(&path) }.as_str())
    }

    fn open_with_default(&self, path: &Path) -> Result<OpenResult, String> {
        let path = SRString::from(path.to_string_lossy().as_ref());
        // SAFETY: as above.
        decode(unsafe { open_path_with_default(&path) }.as_str())
    }

    fn open_with_app(&self, path: &Path, app_id: &str) -> Result<OpenResult, String> {
        let path = SRString::from(path.to_string_lossy().as_ref());
        let app_id = SRString::from(app_id);
        // SAFETY: as above.
        decode(unsafe { open_path_with_app(&path, &app_id) }.as_str())
    }

    fn open_files_with_app(
        &self,
        paths: &[PathBuf],
        app_id: &str,
    ) -> Result<Vec<OpenResult>, String> {
        // The Swift side splits NUL-delimited paths.
        let joined = paths.iter().map(|path| path.to_string_lossy()).collect::<Vec<_>>().join("\0");
        let paths = SRString::from(joined.as_str());
        let app_id = SRString::from(app_id);
        // SAFETY: as above.
        decode(unsafe { open_paths_with_app(&paths, &app_id) }.as_str())
    }
}
