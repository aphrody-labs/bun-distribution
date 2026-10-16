// SPDX-License-Identifier: FSL-1.1-ALv2
// Derived from Spacedrive (drive/apps/tauri/src-tauri/src/files.rs), adopted as the Aphrody Drive
// file explorer.
//! File commands: reveal in the native file manager, the macOS share sheet, sidecar paths.

use aphrody_proc::NoWindow as _;
use std::path::{Path, PathBuf};

use tauri::State;

use crate::{DriveState, server};

/// Reveal a file in the native file manager (Finder, Explorer, the XDG default).
#[tauri::command]
pub async fn reveal_file(path: String) -> Result<(), String> {
    let path = PathBuf::from(path);
    if !path.exists() {
        return Err(format!("Path does not exist: {}", path.display()));
    }
    tauri::async_runtime::spawn_blocking(move || reveal_path(&path))
        .await
        .map_err(|error| error.to_string())?
        .map_err(|error| {
            log::error!("reveal_file: {error}");
            format!("Failed to reveal file: {error}")
        })
}

/// Share files through the native share sheet (macOS only).
#[tauri::command]
pub async fn share_files(paths: Vec<String>) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        if let Some(missing) = paths.iter().find(|path| !Path::new(path).exists()) {
            return Err(format!("Path does not exist: {missing}"));
        }
        let joined = paths.join("\0");
        // SAFETY: the Swift bridge copies the string before returning.
        let shared = unsafe { crate::macos::share_items(&joined.as_str().into()) };
        if shared { Ok(()) } else { Err("Failed to show share sheet".to_string()) }
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = paths;
        Err("Share sheet is only supported on macOS".to_string())
    }
}

/// The physical path of a sidecar file (for "Show in file manager" / native previews).
#[tauri::command]
pub async fn get_sidecar_path(
    state: State<'_, DriveState>,
    library_id: String,
    content_uuid: String,
    kind: String,
    variant: String,
    format: String,
) -> Result<String, String> {
    let library_folder = server::find_library_folder(state.data_dir(), &library_id)
        .await
        .ok_or_else(|| format!("Library folder not found for ID: {library_id}"))?;
    let path = server::sidecar_path(
        &library_folder,
        &content_uuid,
        &kind,
        &format!("{variant}.{format}"),
    )?;
    Ok(path.to_string_lossy().into_owned())
}

#[cfg(target_os = "macos")]
fn reveal_path(path: &Path) -> std::io::Result<()> {
    std::process::Command::new("open").no_window().arg("-R").arg(path).spawn()?.wait().map(drop)
}

#[cfg(windows)]
fn reveal_path(path: &Path) -> std::io::Result<()> {
    // explorer.exe exits with 1 even when it succeeds: only a spawn failure is an error.
    std::process::Command::new("explorer").no_window().arg("/select,").arg(path).spawn()?.wait().map(drop)
}

#[cfg(target_os = "linux")]
fn reveal_path(path: &Path) -> std::io::Result<()> {
    // No portable "select" verb on Linux desktops: open the containing folder.
    match path.parent() {
        Some(parent) => {
            std::process::Command::new("xdg-open").no_window().arg(parent).spawn()?.wait().map(drop)
        },
        None => Ok(()),
    }
}

#[cfg(not(any(target_os = "macos", windows, target_os = "linux")))]
fn reveal_path(_path: &Path) -> std::io::Result<()> {
    Err(std::io::Error::new(
        std::io::ErrorKind::Unsupported,
        "Reveal is not supported on this platform",
    ))
}
