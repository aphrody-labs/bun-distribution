// SPDX-License-Identifier: Apache-2.0
//! Filesystem access for `config.toml` layers.
//!
//! This module is the *only* place in this crate that touches a filesystem;
//! everything else ([`crate::layer`], [`crate::resolve`]) is pure and
//! wasm32-safe. The caller resolves the home directory (aphrody's is
//! `aphrody_models::paths::state_dir()`, per `docs/plans/codex-oss.md`,
//! "Cross-cutting rules") — this crate does not depend on `aphrody-models`
//! and does not re-derive `~/.aphrody` itself.
use std::{
    io,
    path::{Path, PathBuf},
};

use crate::layer::{ConfigLayer, LayerSource, restrict_codex_layer};

/// An error loading or parsing a `config.toml` file from disk.
#[derive(Debug, thiserror::Error)]
pub enum LoadError {
    /// The file exists but could not be read (permissions, not a regular
    /// file, etc). A missing file is *not* an error — see
    /// [`load_toml_file`].
    #[error("failed to read {path}: {source}")]
    Io {
        path: PathBuf,
        #[source]
        source: io::Error,
    },
    /// The file's contents are not valid TOML.
    #[error("failed to parse {path} as TOML: {source}")]
    Parse {
        path: PathBuf,
        #[source]
        source: Box<toml::de::Error>,
    },
}

/// Reads and parses a `config.toml`-shaped file at `path`.
///
/// Returns `Ok(None)` when the file does not exist — a missing optional
/// layer is normal, not an error condition.
///
/// # Errors
///
/// Returns [`LoadError::Io`] for any read failure other than "not found",
/// and [`LoadError::Parse`] when the contents are not valid TOML.
pub fn load_toml_file(path: &Path) -> Result<Option<toml::Value>, LoadError> {
    match std::fs::read_to_string(path) {
        Ok(contents) => {
            let value = toml::from_str(&contents).map_err(|source| LoadError::Parse {
                path: path.to_path_buf(),
                source: Box::new(source),
            })?;
            Ok(Some(value))
        }
        Err(source) if source.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(source) => Err(LoadError::Io {
            path: path.to_path_buf(),
            source,
        }),
    }
}

/// Loads `path` as a [`LayerSource::User`] layer, if it exists.
///
/// # Errors
///
/// See [`load_toml_file`].
pub fn load_user_layer(path: &Path) -> Result<Option<ConfigLayer>, LoadError> {
    Ok(load_toml_file(path)?.map(|value| ConfigLayer::new(LayerSource::User, value)))
}

/// Loads `path` as a [`LayerSource::Project`] layer, if it exists.
///
/// # Errors
///
/// See [`load_toml_file`].
pub fn load_project_layer(path: &Path) -> Result<Option<ConfigLayer>, LoadError> {
    Ok(load_toml_file(path)?.map(|value| ConfigLayer::new(LayerSource::Project, value)))
}

/// Loads `path` (typically `~/.codex/config.toml`) as a restricted
/// [`LayerSource::CodexCompat`] layer, if it exists. The caller is
/// responsible for gating this on `[compat] read_codex_home = true` before
/// calling it — this function does not know the rest of the layer stack.
///
/// # Errors
///
/// See [`load_toml_file`].
pub fn load_codex_compat_layer(path: &Path) -> Result<Option<ConfigLayer>, LoadError> {
    Ok(load_toml_file(path)?
        .map(|value| ConfigLayer::new(LayerSource::CodexCompat, restrict_codex_layer(value))))
}

#[cfg(test)]
#[path = "load_tests.rs"]
mod load_tests;
