// SPDX-License-Identifier: Apache-2.0
//! Cooperative subtree claims. OS file handles release claims on exit or crash.
use aphrody_proc::{FileLock, LockKind};
use std::{
    io,
    path::{Component, Path},
};

/// A held claim: ancestors are shared, the requested subtree is exclusive.
#[derive(Debug)]
pub struct FileClaim {
    _locks: Vec<FileLock>,
}

impl FileClaim {
    /// Claim a relative file or subtree without waiting. Cooperating workers
    /// may edit siblings concurrently, but cannot claim overlapping subtrees.
    /// Symlink paths are rejected to avoid aliases bypassing the claim.
    ///
    /// # Errors
    /// Returns invalid input for non-relative paths, would-block for conflicts,
    /// or the underlying filesystem error.
    pub fn acquire(root: &Path, relative: &Path) -> io::Result<Self> {
        let components: Vec<_> = relative.components().collect();
        if components.is_empty()
            || components
                .iter()
                .any(|c| !matches!(c, Component::Normal(_)))
        {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "claim requires a normal relative path",
            ));
        }
        let mut source = root.to_path_buf();
        let mut lock_dir = root.join(".coord/claims/locks");
        let mut locks = Vec::new();
        for (index, component) in components.iter().enumerate() {
            let Component::Normal(name) = component else {
                unreachable!()
            };
            source.push(name);
            if source
                .symlink_metadata()
                .is_ok_and(|m| m.file_type().is_symlink())
            {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidInput,
                    "symlink claims are unsupported",
                ));
            }
            let encoded: String = name
                .as_encoded_bytes()
                .iter()
                .map(|byte| format!("{byte:02x}"))
                .collect();
            lock_dir.push(encoded);
            let kind = if index + 1 == components.len() {
                LockKind::Exclusive
            } else {
                LockKind::Shared
            };
            let lock = FileLock::try_acquire(lock_dir.join(".lock"), kind)?.ok_or_else(|| {
                io::Error::new(io::ErrorKind::WouldBlock, "file family already claimed")
            })?;
            locks.push(lock);
        }
        Ok(Self { _locks: locks })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn claims_allow_siblings_and_exclude_parent_and_child() {
        let dir = tempfile::tempdir().unwrap();
        let a = FileClaim::acquire(dir.path(), Path::new("crates/ai/session")).unwrap();
        let _b =
            FileClaim::acquire(dir.path(), Path::new("crates/os/kernel/comps/a2a-coord")).unwrap();
        for path in [
            "crates",
            "crates/ai",
            "crates/ai/session",
            "crates/ai/session/src",
        ] {
            assert_eq!(
                FileClaim::acquire(dir.path(), Path::new(path))
                    .unwrap_err()
                    .kind(),
                io::ErrorKind::WouldBlock
            );
        }
        drop(a);
        assert!(FileClaim::acquire(dir.path(), Path::new("crates/ai")).is_ok());
    }
    #[test]
    fn claims_reject_paths_outside_checkout() {
        let dir = tempfile::tempdir().unwrap();
        for path in ["../other", "/tmp", "crates/../apps", ""] {
            assert_eq!(
                FileClaim::acquire(dir.path(), Path::new(path))
                    .unwrap_err()
                    .kind(),
                io::ErrorKind::InvalidInput
            );
        }
    }
}
