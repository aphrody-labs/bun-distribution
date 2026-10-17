// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 aphrody contributors
//! The single authority for where aphrody keeps its state on disk.
//!
//! # Why this module exists
//!
//! Eight crates independently re-derived `~/.aphrody`, and they did not agree.
//! Two readings of `$APHRODY_HOME` had grown side by side:
//!
//! * **the state directory itself** — `aphrody-models`, `aphrody-infer`, `aphrody-voice`,
//!   `aphrody-embed`, the `job` CLI and the MCP job tools;
//! * **the home directory**, with `.aphrody` appended — `aphrody-agent-home` and `oc_cmd`, whose
//!   own doc comments nevertheless promised the first reading.
//!
//! Setting the variable therefore split the tree in two — weights under
//! `$APHRODY_HOME/models`, the agent workspace under
//! `$APHRODY_HOME/.aphrody/workspace` — with no error anywhere. That is the
//! failure mode this repository already knows by name: a filter stricter than
//! its counterpart raises nothing and simply makes things land elsewhere.
//!
//! This module settles it on the first reading, which is what every doc
//! comment in the workspace already claimed and what the variable's name says.
//!
//! # Layout
//!
//! ```text
//! <state dir>/            # $APHRODY_HOME, else ~/.aphrody
//!   models/               # weights, registry.json      (aphrody-models)
//!   runtimes/             # ORT / llama.cpp / whisper.cpp (aphrody-infer, -voice)
//!   jobs/                 # jobs.db + per-job NDJSON     (aphrody-jobs)
//!   workspace[-<profile>] # agent home                   (aphrody-agent-home)
//! ```
//!
//! `aphrody-models` owns this because it sits at the bottom of the toolbox
//! graph and depends on no other workspace crate: every consumer can reach it
//! without inverting the layering.

use std::path::PathBuf;

use crate::error::{ModelError, Result};

/// Environment variable naming the aphrody state directory outright.
///
/// It is the **state directory**, not the user's home: `APHRODY_HOME=/data/aph`
/// puts weights in `/data/aph/models`, never `/data/aph/.aphrody/models`.
pub const ENV_APHRODY_HOME: &str = "APHRODY_HOME";

/// Environment variable relocating only the runtimes directory.
pub const ENV_APHRODY_RUNTIMES_DIR: &str = "APHRODY_RUNTIMES_DIR";

/// Read an environment variable, treating empty as unset.
///
/// An exported-but-empty variable is the shape a shell leaves behind after
/// `export APHRODY_HOME=`; honouring it would resolve the state directory to
/// the filesystem root.
fn non_empty_var(key: &str) -> Option<PathBuf> {
    keep_non_empty(std::env::var_os(key))
}

/// The emptiness rule on its own, so it is testable without mutating the
/// process environment — this crate is `#![forbid(unsafe_code)]` and
/// Edition-2024 `set_var` is `unsafe`.
fn keep_non_empty(raw: Option<std::ffi::OsString>) -> Option<PathBuf> {
    raw.filter(|v| !v.is_empty()).map(PathBuf::from)
}

/// The state-directory rule on its own: an explicit override *is* the state
/// directory, otherwise `.aphrody` hangs off the home directory.
///
/// Pure, so the semantics that used to differ between crates are pinned by a
/// test rather than by whichever environment the suite happens to run in.
fn compose_state_dir(explicit: Option<PathBuf>, home: &std::path::Path) -> PathBuf {
    explicit.unwrap_or_else(|| home.join(".aphrody"))
}

/// The user's home directory: `%USERPROFILE%` on Windows, `$HOME` elsewhere,
/// falling back to the platform lookup.
///
/// # Errors
///
/// [`ModelError::NoStateDir`] when no home can be determined.
pub fn home_dir() -> Result<PathBuf> {
    if cfg!(windows)
        && let Some(profile) = non_empty_var("USERPROFILE")
    {
        return Ok(profile);
    }
    if let Some(home) = non_empty_var("HOME") {
        return Ok(home);
    }
    #[cfg(not(target_arch = "wasm32"))]
    {
        dirs::home_dir().ok_or(ModelError::NoStateDir)
    }
    // wasm32 has neither a home directory nor the `dirs` dependency (gated out
    // in Cargo.toml): the environment lookups above are the only source.
    #[cfg(target_arch = "wasm32")]
    {
        Err(ModelError::NoStateDir)
    }
}

/// The aphrody state directory: `$APHRODY_HOME` when set, else `~/.aphrody`.
///
/// # Errors
///
/// [`ModelError::NoStateDir`] when the variable is unset and no home directory
/// can be determined.
pub fn state_dir() -> Result<PathBuf> {
    match non_empty_var(ENV_APHRODY_HOME) {
        Some(explicit) => Ok(explicit),
        None => Ok(compose_state_dir(None, &home_dir()?)),
    }
}

/// A named directory directly under the state directory.
///
/// # Errors
///
/// Propagates [`state_dir`].
pub fn state_subdir(name: &str) -> Result<PathBuf> {
    Ok(state_dir()?.join(name))
}

/// A named file directly under the state directory, e.g. `x-store.sqlite`.
///
/// Consumers compose their own leaf from this rather than each one being
/// enumerated here: the authority owns *where the root is*, not what every
/// crate chooses to keep in it.
///
/// # Errors
///
/// Propagates [`state_dir`].
pub fn state_file(name: &str) -> Result<PathBuf> {
    Ok(state_dir()?.join(name))
}

/// Where downloaded weights live (`<state>/models`).
///
/// # Errors
///
/// Propagates [`state_dir`].
pub fn models_dir() -> Result<PathBuf> {
    state_subdir("models")
}

/// Where third-party runtimes are unpacked (`<state>/runtimes`): ONNX Runtime,
/// llama.cpp, whisper.cpp.
///
/// `$APHRODY_RUNTIMES_DIR` relocates this one directory on its own, for the
/// case where the runtimes are large and belong on a different volume from
/// the rest of the state. The override lived only in `aphrody-infer`, so
/// `aphrody-voice` silently ignored it and went looking for whisper.cpp
/// somewhere else; honouring it here is what makes the two agree.
///
/// # Errors
///
/// Propagates [`state_dir`].
pub fn runtimes_dir() -> Result<PathBuf> {
    if let Some(explicit) = non_empty_var(ENV_APHRODY_RUNTIMES_DIR) {
        return Ok(explicit);
    }
    state_subdir("runtimes")
}

/// Where the background job queue and its logs live (`<state>/jobs`).
///
/// # Errors
///
/// Propagates [`state_dir`].
pub fn jobs_dir() -> Result<PathBuf> {
    state_subdir("jobs")
}

/// Where the OCR corpus database lives (`<state>/ocr`).
///
/// # Errors
///
/// Propagates [`state_dir`].
pub fn ocr_dir() -> Result<PathBuf> {
    state_subdir("ocr")
}

/// Unified cache directory (`<state>/cache`).
///
/// Shared across Rust crates, Python uv scripts, and Bun runtimes.
///
/// # Errors
///
/// Propagates [`state_dir`].
pub fn cache_dir() -> Result<PathBuf> {
    state_subdir("cache")
}

/// Unified memory database directory (`<state>/memory`).
///
/// Holds the local `SQLite` memory (`memory.sqlite`) and `LanceDB` vector partitions.
///
/// # Errors
///
/// Propagates [`state_dir`].
pub fn memory_dir() -> Result<PathBuf> {
    state_subdir("memory")
}

/// Canonical path to the local unified memory `SQLite` database (`<state>/memory/memory.sqlite`).
///
/// # Errors
///
/// Propagates [`state_dir`].
pub fn memory_sqlite_path() -> Result<PathBuf> {
    Ok(memory_dir()?.join("memory.sqlite"))
}

/// Unified vector & embeddings storage directory (`<state>/vector`).
///
/// Shared vector index cache, MRL projections, and `LanceDB` stores.
///
/// # Errors
///
/// Propagates [`state_dir`].
pub fn vector_dir() -> Result<PathBuf> {
    state_subdir("vector")
}

/// Canonical directory for `LanceDB` vector storage (`<state>/vector/lancedb`).
///
/// # Errors
///
/// Propagates [`state_dir`].
pub fn lancedb_dir() -> Result<PathBuf> {
    Ok(vector_dir()?.join("lancedb"))
}

/// Unified data storage directory (`<state>/data`).
///
/// # Errors
///
/// Propagates [`state_dir`].
pub fn data_dir() -> Result<PathBuf> {
    state_subdir("data")
}

/// Unified chat & agent sessions history directory (`<state>/sessions`).
///
/// # Errors
///
/// Propagates [`state_dir`].
pub fn sessions_dir() -> Result<PathBuf> {
    state_subdir("sessions")
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Every well-known directory hangs off one root, so a single override
    /// moves the whole tree instead of half of it.
    #[test]
    fn well_known_dirs_share_one_root() {
        let root = state_dir().unwrap();
        assert_eq!(models_dir().unwrap(), root.join("models"));
        assert_eq!(jobs_dir().unwrap(), root.join("jobs"));
        assert_eq!(ocr_dir().unwrap(), root.join("ocr"));
        assert_eq!(cache_dir().unwrap(), root.join("cache"));
        assert_eq!(memory_dir().unwrap(), root.join("memory"));
        assert_eq!(
            memory_sqlite_path().unwrap(),
            root.join("memory").join("memory.sqlite")
        );
        assert_eq!(vector_dir().unwrap(), root.join("vector"));
        assert_eq!(lancedb_dir().unwrap(), root.join("vector").join("lancedb"));
        assert_eq!(data_dir().unwrap(), root.join("data"));
        assert_eq!(sessions_dir().unwrap(), root.join("sessions"));
        // `runtimes` only when it is not separately relocated.
        if std::env::var_os(ENV_APHRODY_RUNTIMES_DIR).is_none() {
            assert_eq!(runtimes_dir().unwrap(), root.join("runtimes"));
        }
    }

    /// `$APHRODY_HOME` names the state directory itself.
    ///
    /// This is the rule `aphrody-agent-home` and `oc_cmd` used to break: they
    /// appended `.aphrody` to the override, so weights landed in
    /// `$APHRODY_HOME/models` while the agent workspace landed in
    /// `$APHRODY_HOME/.aphrody/workspace` — two trees, and no error.
    #[test]
    fn explicit_override_is_the_state_dir_not_a_home() {
        let explicit = PathBuf::from("/data/aph");
        let home = std::path::Path::new("/home/u");
        assert_eq!(compose_state_dir(Some(explicit.clone()), home), explicit);
        assert_ne!(
            compose_state_dir(Some(explicit.clone()), home),
            explicit.join(".aphrody")
        );
    }

    /// With no override, the state directory is `.aphrody` under the home.
    #[test]
    fn default_state_dir_hangs_off_the_home() {
        let home = std::path::Path::new("/home/u");
        assert_eq!(compose_state_dir(None, home), home.join(".aphrody"));
    }

    /// An exported-but-empty variable is not an override; treating it as one
    /// resolves the state directory to the filesystem root.
    #[test]
    fn empty_variable_is_not_an_override() {
        assert!(keep_non_empty(Some(std::ffi::OsString::from(""))).is_none());
        assert!(keep_non_empty(None).is_none());
        assert_eq!(
            keep_non_empty(Some(std::ffi::OsString::from("/data/aph"))),
            Some(PathBuf::from("/data/aph"))
        );
    }
}
