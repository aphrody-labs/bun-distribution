// SPDX-License-Identifier: Apache-2.0
//! Virtual filesystem for the Aphrody WASM shell.
//!
//! One synchronous, byte-path [`Vfs`] trait; backends (in-memory here, OPFS and
//! Tauri-fs elsewhere) must pass [`conformance::run`]. std only, no host I/O,
//! so the crate builds for `wasm32-unknown-unknown`.

pub mod conformance;
mod error;
mod mem;
pub mod path;

pub use error::{VfsError, VfsResult};
pub use mem::{Limits, MemVfs};

/// Kind of a filesystem node.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum FileKind {
    File,
    Dir,
}

/// Metadata of a node. `size` is the byte length for files and 0 for directories.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Stat {
    pub kind: FileKind,
    pub size: u64,
}

/// One entry returned by [`Vfs::read_dir`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DirEntry {
    /// Final path component (never contains `/`).
    pub name: Vec<u8>,
    pub kind: FileKind,
}

/// Synchronous virtual filesystem over absolute, byte-based paths.
///
/// Every path is normalised with [`path::normalize`] first, so `/a/./b//../c`
/// and `/a/c` are the same node. Relative paths are rejected with
/// [`VfsError::InvalidPath`]; resolve them against a cwd with [`path::resolve`].
pub trait Vfs {
    /// Whole contents of a file.
    fn read(&mut self, path: &[u8]) -> VfsResult<Vec<u8>>;
    /// Create or truncate a file. The parent directory must exist.
    fn write(&mut self, path: &[u8], data: &[u8]) -> VfsResult<()>;
    /// Metadata of a node.
    fn stat(&mut self, path: &[u8]) -> VfsResult<Stat>;
    /// Entries of a directory, sorted by name (byte order), without `.`/`..`.
    fn read_dir(&mut self, path: &[u8]) -> VfsResult<Vec<DirEntry>>;
    /// Create one directory; the parent must exist and the path must be free.
    fn mkdir(&mut self, path: &[u8]) -> VfsResult<()>;
    /// Remove a file or an empty directory. The root cannot be removed.
    fn remove(&mut self, path: &[u8]) -> VfsResult<()>;
    /// Move a node. An existing file target is replaced; an existing directory
    /// target is replaced only by a directory and only when empty. Moving a
    /// directory into itself is [`VfsError::InvalidInput`].
    fn rename(&mut self, from: &[u8], to: &[u8]) -> VfsResult<()>;

    /// `true` when the path resolves to a node.
    fn exists(&mut self, path: &[u8]) -> bool {
        self.stat(path).is_ok()
    }

    /// Append to a file, creating it when missing.
    fn append(&mut self, path: &[u8], data: &[u8]) -> VfsResult<()> {
        let mut all = match self.read(path) {
            Ok(v) => v,
            Err(VfsError::NotFound) => Vec::new(),
            Err(e) => return Err(e),
        };
        all.extend_from_slice(data);
        self.write(path, &all)
    }

    /// `mkdir -p`: create missing ancestors, succeed if the directory exists.
    fn mkdir_all(&mut self, path: &[u8]) -> VfsResult<()> {
        let norm = path::normalize(path)?;
        let mut cur: Vec<u8> = Vec::new();
        for comp in path::components(&norm) {
            cur.push(b'/');
            cur.extend_from_slice(comp);
            match self.stat(&cur) {
                Ok(Stat {
                    kind: FileKind::Dir,
                    ..
                }) => {}
                Ok(_) => return Err(VfsError::NotADirectory),
                Err(VfsError::NotFound) => self.mkdir(&cur)?,
                Err(e) => return Err(e),
            }
        }
        Ok(())
    }

    /// `rm -r`: remove a node and everything below it. The root itself is
    /// emptied, not removed.
    fn remove_all(&mut self, path: &[u8]) -> VfsResult<()> {
        let norm = path::normalize(path)?;
        if self.stat(&norm)?.kind == FileKind::Dir {
            for e in self.read_dir(&norm)? {
                let child = path::join(&norm, &e.name);
                self.remove_all(&child)?;
            }
        }
        if norm == b"/" {
            Ok(())
        } else {
            self.remove(&norm)
        }
    }
}
