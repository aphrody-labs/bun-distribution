// SPDX-License-Identifier: Apache-2.0
//! Cross-platform OS abstractions for the `cli` binary.
//!
//! Inspired by Chromium's `base/base_paths.h` and Android's `Environment`,
//! this module exposes per-target user-data paths so commands stay portable
//! between Windows, Linux, macOS, and WASI without `#[cfg(windows)]` scattered
//! through business logic.

use std::{
    env,
    path::{Path, PathBuf},
};

use miette::{IntoDiagnostic, Result, miette};

/// Per-user configuration directory.
///
/// - Windows : `%APPDATA%`.
/// - macOS   : `$HOME/Library/Application Support`.
/// - Linux   : `$XDG_CONFIG_HOME` if set, else `$HOME/.config`.
#[allow(dead_code)]
pub(crate) fn config_dir() -> Result<PathBuf> {
    #[cfg(windows)]
    {
        env::var_os("APPDATA").map(PathBuf::from).ok_or_else(|| miette!("APPDATA is not set"))
    }
    #[cfg(target_os = "macos")]
    {
        return home_dir().map(|h| h.join("Library").join("Preferences"));
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        if let Some(xdg) = env::var_os("XDG_CONFIG_HOME").filter(|v| !v.is_empty()) {
            return Ok(PathBuf::from(xdg));
        }
        home_dir().map(|h| h.join(".config"))
    }
    #[cfg(target_family = "wasm")]
    {
        return Ok(PathBuf::from("/tmp"));
    }
    #[cfg(not(any(windows, unix, target_family = "wasm")))]
    {
        Err(miette!("unsupported platform for config_dir()"))
    }
}

/// User home directory for the Unix configuration paths.
#[cfg(unix)]
pub(crate) fn home_dir() -> Result<PathBuf> {
    env::var_os("HOME").map(PathBuf::from).ok_or_else(|| miette!("HOME is not set"))
}
/// Ensure a directory exists (creating it recursively if needed).
#[allow(dead_code)]
pub(crate) fn ensure_dir(path: &Path) -> Result<()> {
    std::fs::create_dir_all(path).into_diagnostic()
}
