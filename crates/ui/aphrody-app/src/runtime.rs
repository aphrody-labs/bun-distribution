// SPDX-License-Identifier: Apache-2.0
//! Canonical Aphrody runtime layout owned by the Tauri application.
//!
//! All desktop-owned state is rooted in Tauri's platform-correct application
//! directories. Rust services, Bun/uv clients and the UI consume this layout
//! through the kernel boundary instead of inventing sibling directories.

use std::{fs, path::PathBuf};

use serde::Serialize;
use tauri::{AppHandle, Manager};

#[derive(Debug, Serialize)]
pub struct RuntimeLayout {
    pub data: String,
    pub config: String,
    pub cache: String,
    pub logs: String,
    pub resources: String,
    pub profiles: String,
    pub assets: String,
    pub binaries: String,
    pub sqlite: String,
    pub chrome_profile: String,
    pub chrome_apps: String,
}

fn create(path: PathBuf) -> Result<PathBuf, String> {
    fs::create_dir_all(&path).map_err(|error| {
        format!("cannot create Aphrody runtime directory {}: {error}", path.display())
    })?;
    Ok(path)
}

/// Resolve and materialize the one desktop-owned state tree.
pub fn resolve(app: &AppHandle) -> Result<RuntimeLayout, String> {
    let data = create(app.path().app_data_dir().map_err(|error| error.to_string())?)?;
    let config = create(app.path().app_config_dir().map_err(|error| error.to_string())?)?;
    let cache = create(app.path().app_cache_dir().map_err(|error| error.to_string())?)?;
    let logs = create(app.path().app_log_dir().map_err(|error| error.to_string())?)?;
    let resources = app.path().resource_dir().map_err(|error| error.to_string())?;
    let profiles = create(data.join("profiles"))?;
    let assets = create(data.join("assets"))?;
    let binaries = create(data.join("binaries"))?;
    let sqlite = create(data.join("sqlite"))?;
    let chrome_profile = create(profiles.join("chromium"))?;
    let chrome_apps = create(assets.join("chrome-web-apps"))?;

    Ok(RuntimeLayout {
        data: data.display().to_string(),
        config: config.display().to_string(),
        cache: cache.display().to_string(),
        logs: logs.display().to_string(),
        resources: resources.display().to_string(),
        profiles: profiles.display().to_string(),
        assets: assets.display().to_string(),
        binaries: binaries.display().to_string(),
        sqlite: sqlite.display().to_string(),
        chrome_profile: chrome_profile.display().to_string(),
        chrome_apps: chrome_apps.display().to_string(),
    })
}
