// SPDX-License-Identifier: Apache-2.0
//! Shared SHA-256 blob store. Hosts supply streams; this crate never fetches.
//! Cache formats remain ecosystem-owned. Writable extraction must use copies:
//! hardlinking a mutable package tree would corrupt the shared content address.

#![forbid(unsafe_code)]

use sha2::{Digest, Sha256};
use std::fs::{self, File};
use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};
use tempfile::NamedTempFile;

/// Validated lowercase SHA-256 content address, safe as a path component.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct BlobId(String);

impl BlobId {
    pub fn parse(value: &str) -> io::Result<Self> {
        let value = value.strip_prefix("sha256:").unwrap_or(value);
        if value.len() != 64 || !value.bytes().all(|b| b.is_ascii_hexdigit()) {
            return Err(io::Error::new(io::ErrorKind::InvalidInput, "invalid SHA-256 address"));
        }
        Ok(Self(value.to_ascii_lowercase()))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

pub struct Store {
    root: PathBuf,
}

impl Store {
    /// Callers resolve the configured Aphrody home and pass `<home>/store`.
    pub fn new(root: impl Into<PathBuf>) -> Self {
        Self { root: root.into() }
    }

    pub fn blob_path(&self, id: &BlobId) -> PathBuf {
        self.root.join("blobs").join("sha256").join(&id.0[..2]).join(&id.0)
    }

    /// Stream to a temporary file and publish without overwriting another writer.
    /// A declared upstream digest must match before any object is published.
    pub fn put(&self, mut reader: impl Read, expected: Option<&BlobId>) -> io::Result<BlobId> {
        let staging = self.root.join("staging");
        fs::create_dir_all(&staging)?;
        let mut temporary = NamedTempFile::new_in(&staging)?;
        let mut hasher = Sha256::new();
        let mut buffer = [0_u8; 64 * 1024];
        loop {
            let count = reader.read(&mut buffer)?;
            if count == 0 {
                break;
            }
            hasher.update(&buffer[..count]);
            temporary.write_all(&buffer[..count])?;
        }
        let id = BlobId(format!("{:x}", hasher.finalize()));
        if expected.is_some_and(|expected| expected != &id) {
            return Err(io::Error::new(io::ErrorKind::InvalidData, "package digest mismatch"));
        }
        temporary.as_file().sync_all()?;
        let destination = self.blob_path(&id);
        let parent = destination.parent().ok_or_else(|| io::Error::other("missing blob parent"))?;
        fs::create_dir_all(parent)?;
        match temporary.persist_noclobber(&destination) {
            Ok(_) => {},
            Err(error) if error.error.kind() == io::ErrorKind::AlreadyExists => {
                self.verify(&id)?;
            },
            Err(error) => return Err(error.error),
        }
        Ok(id)
    }

    /// Recheck bytes before consuming an object; existence alone is insufficient.
    pub fn verify(&self, id: &BlobId) -> io::Result<()> {
        let mut file = File::open(self.blob_path(id))?;
        let mut hasher = Sha256::new();
        let mut buffer = [0_u8; 64 * 1024];
        loop {
            let count = file.read(&mut buffer)?;
            if count == 0 {
                break;
            }
            hasher.update(&buffer[..count]);
        }
        if format!("{:x}", hasher.finalize()) != id.0 {
            return Err(io::Error::new(io::ErrorKind::InvalidData, "corrupt package blob"));
        }
        Ok(())
    }

    /// Materialize writable bytes using a copy. Never clobbers an existing path.
    /// Reflink and protected immutable-link modes will extend this operation.
    pub fn materialize(&self, id: &BlobId, destination: &Path) -> io::Result<()> {
        let parent =
            destination.parent().filter(|p| !p.as_os_str().is_empty()).unwrap_or(Path::new("."));
        fs::create_dir_all(parent)?;
        let mut temporary = NamedTempFile::new_in(parent)?;
        let mut source = File::open(self.blob_path(id))?;
        let mut hasher = Sha256::new();
        let mut buffer = [0_u8; 64 * 1024];
        loop {
            let count = source.read(&mut buffer)?;
            if count == 0 {
                break;
            }
            hasher.update(&buffer[..count]);
            temporary.write_all(&buffer[..count])?;
        }
        if format!("{:x}", hasher.finalize()) != id.0 {
            return Err(io::Error::new(io::ErrorKind::InvalidData, "corrupt package blob"));
        }
        temporary.as_file().sync_all()?;
        temporary.persist_noclobber(destination).map_err(|error| error.error)?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn repeated_content_has_one_address_and_mutable_copies_are_isolated() -> io::Result<()> {
        let root = tempfile::tempdir()?;
        let store = Store::new(root.path());
        let first = store.put(&b"package bytes"[..], None)?;
        let second = store.put(&b"package bytes"[..], Some(&first))?;
        assert_eq!(first, second);
        let destination = root.path().join("consumer/package");
        store.materialize(&first, &destination)?;
        fs::write(&destination, b"consumer edits")?;
        store.verify(&first)?;
        assert_eq!(fs::read(store.blob_path(&first))?, b"package bytes");
        assert_eq!(
            store.materialize(&first, &destination).unwrap_err().kind(),
            io::ErrorKind::AlreadyExists
        );
        Ok(())
    }

    #[test]
    fn integrity_failures_do_not_publish_objects_or_consumers() -> io::Result<()> {
        let root = tempfile::tempdir()?;
        let store = Store::new(root.path());
        let id = store.put(&b"valid"[..], None)?;
        assert_eq!(
            store.put(&b"invalid"[..], Some(&id)).unwrap_err().kind(),
            io::ErrorKind::InvalidData
        );
        fs::write(store.blob_path(&id), b"corrupt")?;
        assert_eq!(store.verify(&id).unwrap_err().kind(), io::ErrorKind::InvalidData);
        let destination = root.path().join("consumer");
        assert_eq!(
            store.materialize(&id, &destination).unwrap_err().kind(),
            io::ErrorKind::InvalidData
        );
        assert!(!destination.exists());
        Ok(())
    }

    #[test]
    fn address_rejects_path_traversal_and_normalizes_hashes() -> io::Result<()> {
        assert!(BlobId::parse("../other").is_err());
        let uppercase = "A".repeat(64);
        assert_eq!(BlobId::parse(&format!("sha256:{uppercase}"))?.as_str(), "a".repeat(64));
        Ok(())
    }
}
