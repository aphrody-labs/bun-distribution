// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 aphrody contributors
//
// Resolution of the on-disk model cache directory.
//
// fastembed (via hf-hub) downloads model weights on first use. We park them
// under the aphrody state directory (`~/.aphrody/models/embeddings`) so they
// are shared across invocations and never written to the current working
// directory. This module is always compiled (no feature gate) — it is pure
// path logic with a single filesystem `create_dir_all`.

use std::path::{Path, PathBuf};

use crate::error::{EmbedError, Result};

/// Resolve the aphrody root state directory.
///
/// Delegates to [`aphrody_models::paths::state_dir`], the single authority for
/// aphrody's on-disk layout. The copy that lived here was one of eight, and
/// the eight did not agree on what `$APHRODY_HOME` meant.
fn aphrody_state_dir() -> Result<PathBuf> {
    let unresolved = || EmbedError::CacheDir {
        path: PathBuf::from("~/.aphrody"),
        source: std::io::Error::new(
            std::io::ErrorKind::NotFound,
            "cannot resolve the aphrody state directory (set APHRODY_HOME)",
        ),
    };
    #[cfg(not(target_arch = "wasm32"))]
    {
        aphrody_models::paths::state_dir().map_err(|_| unresolved())
    }
    // A browser has no state directory: `aphrody_models::paths` is host-only.
    #[cfg(target_arch = "wasm32")]
    {
        Err(unresolved())
    }
}

/// Compose the embeddings cache path under a given aphrody state root.
///
/// Pure path arithmetic (no I/O, no env), kept separate so it is unit-testable
/// without mutating process environment (the crate is `#![forbid(unsafe_code)]`
/// and Edition-2024 `std::env::set_var` is `unsafe`).
fn embeddings_subdir(state_root: &Path) -> PathBuf {
    state_root.join("models").join("embeddings")
}

/// Resolve (and create) the embeddings model cache directory.
///
/// Returns `~/.aphrody/models/embeddings`, creating the full path if missing.
/// An explicit `override_dir` short-circuits the default and is created the
/// same way — handy for tests (point it at a `tempfile::TempDir`) and for
/// callers that want an isolated cache.
///
/// # Errors
/// [`EmbedError::NoHome`] if no home directory can be resolved, or
/// [`EmbedError::CacheDir`] if the directory cannot be created.
pub fn model_cache_dir(override_dir: Option<PathBuf>) -> Result<PathBuf> {
    let dir = match override_dir {
        Some(d) => d,
        None => embeddings_subdir(&aphrody_state_dir()?),
    };
    std::fs::create_dir_all(&dir)
        .map_err(|source| EmbedError::CacheDir { path: dir.clone(), source })?;
    Ok(dir)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn override_dir_is_created_and_returned() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let target = tmp.path().join("nested").join("cache");
        let resolved = model_cache_dir(Some(target.clone())).expect("resolve");
        assert_eq!(resolved, target);
        assert!(resolved.is_dir(), "cache dir should have been created");
    }

    #[test]
    fn embeddings_subdir_is_under_models_embeddings() {
        let root = Path::new("/some/root/.aphrody");
        let sub = embeddings_subdir(root);
        assert!(sub.starts_with(root));
        assert_eq!(sub.file_name().unwrap(), "embeddings");
        assert_eq!(sub.parent().unwrap().file_name().unwrap(), "models");
    }

    #[test]
    fn aphrody_state_dir_resolves_without_panic() {
        // Read-only: does not mutate env. On any normal dev/CI machine a home
        // is resolvable; assert the happy path produces a `.aphrody` leaf.
        if let Ok(dir) = aphrody_state_dir() {
            if let Ok(explicit) = std::env::var("APHRODY_HOME")
                && !explicit.is_empty()
            {
                assert_eq!(dir, PathBuf::from(explicit));
                return;
            }
            assert_eq!(dir.file_name().unwrap(), ".aphrody");
        }
    }
}
