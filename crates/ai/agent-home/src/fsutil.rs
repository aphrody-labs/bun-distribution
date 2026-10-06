// SPDX-License-Identifier: Apache-2.0
//! Small filesystem helpers shared by the home-management modules: atomic
//! replacement, SHA-256 hex digests and mtime-preserving copies.

use std::{
    io::Write as _,
    path::{Path, PathBuf},
    time::SystemTime,
};

use sha2::{Digest as _, Sha256};

use crate::HomeError;

/// Lowercase hex SHA-256 of `bytes`.
#[must_use]
pub fn sha256_hex(bytes: &[u8]) -> String {
    hex_lower(&Sha256::digest(bytes))
}

/// Lowercase hex encoding.
#[must_use]
pub fn hex_lower(bytes: &[u8]) -> String {
    const DIGITS: &[u8; 16] = b"0123456789abcdef";
    let mut out = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        out.push(char::from(DIGITS[usize::from(b >> 4)]));
        out.push(char::from(DIGITS[usize::from(b & 0x0f)]));
    }
    out
}

/// Temp sibling of `path`, named so the revision walk ignores it (`.tmp`
/// suffix) and two writers never collide.
fn temp_sibling(path: &Path) -> PathBuf {
    let name = path.file_name().map_or_else(|| "file".into(), |n| n.to_string_lossy().into_owned());
    path.with_file_name(format!(".{name}.{}.tmp", crate::time::file_stamp()))
}

/// Replace `path` with `bytes` atomically: write a temp sibling, flush it to
/// disk, then rename over the target (atomic on the same filesystem). Creates
/// the parent directory when missing.
///
/// # Errors
/// [`HomeError::Io`] on any filesystem failure; the temp file is removed.
pub fn write_atomic(path: &Path, bytes: &[u8]) -> Result<(), HomeError> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| HomeError::io(parent, e))?;
    }
    let tmp = temp_sibling(path);
    if let Err(e) = write_then_rename(&tmp, path, bytes) {
        let _ = std::fs::remove_file(&tmp);
        return Err(HomeError::io(path, e));
    }
    Ok(())
}

fn write_then_rename(tmp: &Path, path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    let mut file = std::fs::File::create(tmp)?;
    file.write_all(bytes)?;
    file.sync_all()?;
    drop(file);
    std::fs::rename(tmp, path)
}

/// Atomically write `bytes` to `path` and set its modification time to
/// `modified` (used to keep last-writer-wins stable across copies).
///
/// # Errors
/// [`HomeError::Io`] on any filesystem failure.
pub fn write_atomic_with_mtime(
    path: &Path,
    bytes: &[u8],
    modified: SystemTime,
) -> Result<(), HomeError> {
    write_atomic(path, bytes)?;
    let file =
        std::fs::OpenOptions::new().write(true).open(path).map_err(|e| HomeError::io(path, e))?;
    file.set_modified(modified).map_err(|e| HomeError::io(path, e))
}

/// Read a file's modification time.
///
/// # Errors
/// [`HomeError::Io`] when the metadata cannot be read.
pub fn modified(path: &Path) -> Result<SystemTime, HomeError> {
    std::fs::metadata(path).and_then(|m| m.modified()).map_err(|e| HomeError::io(path, e))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sha256_matches_the_standard_vectors() {
        assert_eq!(
            sha256_hex(b""),
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        );
        assert_eq!(
            sha256_hex(b"abc"),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
    }

    #[test]
    fn write_atomic_replaces_and_leaves_no_temp() {
        let td = tempfile::tempdir().unwrap();
        let p = td.path().join("sub/a.md");
        write_atomic(&p, b"one").unwrap();
        write_atomic(&p, b"two").unwrap();
        assert_eq!(std::fs::read(&p).unwrap(), b"two");
        let names: Vec<_> = std::fs::read_dir(p.parent().unwrap()).unwrap().collect();
        assert_eq!(names.len(), 1);
    }

    #[test]
    fn write_with_mtime_sets_the_requested_instant() {
        let td = tempfile::tempdir().unwrap();
        let p = td.path().join("a.md");
        let when = SystemTime::UNIX_EPOCH + std::time::Duration::from_secs(1_700_000_000);
        write_atomic_with_mtime(&p, b"x", when).unwrap();
        assert_eq!(modified(&p).unwrap(), when);
    }
}
