// SPDX-License-Identifier: Apache-2.0
use std::collections::BTreeMap;

use crate::path::{self, split_parent};
use crate::{DirEntry, FileKind, Stat, Vfs, VfsError, VfsResult};

/// Resource caps for [`MemVfs`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Limits {
    /// Largest single file in bytes.
    pub max_file_size: u64,
    /// Sum of all file bytes.
    pub max_total_bytes: u64,
    /// Number of nodes excluding the root.
    pub max_inodes: usize,
}

impl Default for Limits {
    fn default() -> Self {
        Self {
            max_file_size: 16 << 20,
            max_total_bytes: 64 << 20,
            max_inodes: 65_536,
        }
    }
}

#[derive(Debug, Clone)]
enum Node {
    Dir,
    File(Vec<u8>),
}

/// In-memory filesystem keyed by normalised path. Deterministic ordering.
#[derive(Debug, Clone)]
pub struct MemVfs {
    nodes: BTreeMap<Vec<u8>, Node>,
    limits: Limits,
    total_bytes: u64,
}

impl Default for MemVfs {
    fn default() -> Self {
        Self::new()
    }
}

fn len64(n: usize) -> u64 {
    u64::try_from(n).unwrap_or(u64::MAX)
}

fn sub_prefix(p: &[u8]) -> Vec<u8> {
    let mut v = p.to_vec();
    if v.last() != Some(&b'/') {
        v.push(b'/');
    }
    v
}

impl MemVfs {
    #[must_use]
    pub fn new() -> Self {
        Self::with_limits(Limits::default())
    }

    #[must_use]
    pub fn with_limits(limits: Limits) -> Self {
        let mut nodes = BTreeMap::new();
        nodes.insert(b"/".to_vec(), Node::Dir);
        Self {
            nodes,
            limits,
            total_bytes: 0,
        }
    }

    #[must_use]
    pub fn limits(&self) -> Limits {
        self.limits
    }

    /// Bytes stored in files.
    #[must_use]
    pub fn total_bytes(&self) -> u64 {
        self.total_bytes
    }

    /// Node count excluding the root.
    #[must_use]
    pub fn inode_count(&self) -> usize {
        self.nodes.len() - 1
    }

    /// Keys strictly below `p`.
    fn descendants(&self, p: &[u8]) -> Vec<Vec<u8>> {
        let prefix = sub_prefix(p);
        self.nodes
            .range(prefix.clone()..)
            .take_while(|(k, _)| k.starts_with(&prefix))
            .filter(|(k, _)| k.as_slice() != p)
            .map(|(k, _)| k.clone())
            .collect()
    }

    fn require_parent_dir(&self, norm: &[u8]) -> VfsResult<()> {
        let (parent, name) = split_parent(norm).ok_or(VfsError::AlreadyExists)?;
        if name.is_empty() {
            return Err(VfsError::InvalidPath);
        }
        match self.nodes.get(parent) {
            Some(Node::Dir) => Ok(()),
            Some(Node::File(_)) => Err(VfsError::NotADirectory),
            None => Err(VfsError::NotFound),
        }
    }

    fn check_new_inode(&self) -> VfsResult<()> {
        if self.inode_count() >= self.limits.max_inodes {
            Err(VfsError::QuotaExceeded)
        } else {
            Ok(())
        }
    }

    fn drop_node(&mut self, key: &[u8]) {
        if let Some(Node::File(d)) = self.nodes.remove(key) {
            self.total_bytes -= len64(d.len());
        }
    }
}

impl Vfs for MemVfs {
    fn read(&mut self, p: &[u8]) -> VfsResult<Vec<u8>> {
        let n = path::normalize(p)?;
        match self.nodes.get(&n) {
            Some(Node::File(d)) => Ok(d.clone()),
            Some(Node::Dir) => Err(VfsError::IsADirectory),
            None => Err(VfsError::NotFound),
        }
    }

    fn write(&mut self, p: &[u8], data: &[u8]) -> VfsResult<()> {
        let n = path::normalize(p)?;
        let new_len = len64(data.len());
        if new_len > self.limits.max_file_size {
            return Err(VfsError::FileTooLarge);
        }
        self.require_parent_dir(&n).map_err(|e| {
            if e == VfsError::AlreadyExists {
                VfsError::IsADirectory
            } else {
                e
            }
        })?;
        let old_len = match self.nodes.get(&n) {
            Some(Node::Dir) => return Err(VfsError::IsADirectory),
            Some(Node::File(d)) => len64(d.len()),
            None => {
                self.check_new_inode()?;
                0
            }
        };
        if self.total_bytes - old_len + new_len > self.limits.max_total_bytes {
            return Err(VfsError::QuotaExceeded);
        }
        self.total_bytes = self.total_bytes - old_len + new_len;
        self.nodes.insert(n, Node::File(data.to_vec()));
        Ok(())
    }

    fn stat(&mut self, p: &[u8]) -> VfsResult<Stat> {
        let n = path::normalize(p)?;
        match self.nodes.get(&n) {
            Some(Node::Dir) => Ok(Stat {
                kind: FileKind::Dir,
                size: 0,
            }),
            Some(Node::File(d)) => Ok(Stat {
                kind: FileKind::File,
                size: len64(d.len()),
            }),
            None => Err(VfsError::NotFound),
        }
    }

    fn read_dir(&mut self, p: &[u8]) -> VfsResult<Vec<DirEntry>> {
        let n = path::normalize(p)?;
        match self.nodes.get(&n) {
            Some(Node::Dir) => {}
            Some(Node::File(_)) => return Err(VfsError::NotADirectory),
            None => return Err(VfsError::NotFound),
        }
        let prefix = sub_prefix(&n);
        let mut out = Vec::new();
        for (k, v) in self
            .nodes
            .range(prefix.clone()..)
            .take_while(|(k, _)| k.starts_with(&prefix))
        {
            let rest = &k[prefix.len()..];
            if rest.is_empty() || rest.contains(&b'/') {
                continue;
            }
            let kind = if matches!(v, Node::Dir) {
                FileKind::Dir
            } else {
                FileKind::File
            };
            out.push(DirEntry {
                name: rest.to_vec(),
                kind,
            });
        }
        Ok(out)
    }

    fn mkdir(&mut self, p: &[u8]) -> VfsResult<()> {
        let n = path::normalize(p)?;
        self.require_parent_dir(&n)?;
        if self.nodes.contains_key(&n) {
            return Err(VfsError::AlreadyExists);
        }
        self.check_new_inode()?;
        self.nodes.insert(n, Node::Dir);
        Ok(())
    }

    fn remove(&mut self, p: &[u8]) -> VfsResult<()> {
        let n = path::normalize(p)?;
        if n == b"/" {
            return Err(VfsError::InvalidInput);
        }
        match self.nodes.get(&n) {
            None => return Err(VfsError::NotFound),
            Some(Node::Dir) if !self.descendants(&n).is_empty() => {
                return Err(VfsError::DirectoryNotEmpty);
            }
            Some(_) => {}
        }
        self.drop_node(&n);
        Ok(())
    }

    fn rename(&mut self, from: &[u8], to: &[u8]) -> VfsResult<()> {
        let f = path::normalize(from)?;
        let t = path::normalize(to)?;
        if f == b"/" || t == b"/" {
            return Err(VfsError::InvalidInput);
        }
        let src_is_dir = match self.nodes.get(&f) {
            Some(Node::Dir) => true,
            Some(Node::File(_)) => false,
            None => return Err(VfsError::NotFound),
        };
        if f == t {
            return Ok(());
        }
        if src_is_dir && t.starts_with(&sub_prefix(&f)) {
            return Err(VfsError::InvalidInput);
        }
        self.require_parent_dir(&t)?;
        match (self.nodes.get(&t), src_is_dir) {
            (None, _) => {}
            (Some(Node::File(_)), false) => {}
            (Some(Node::Dir), true) => {
                if !self.descendants(&t).is_empty() {
                    return Err(VfsError::DirectoryNotEmpty);
                }
            }
            (Some(Node::Dir), false) => return Err(VfsError::IsADirectory),
            (Some(Node::File(_)), true) => return Err(VfsError::NotADirectory),
        }
        self.drop_node(&t);
        let mut moving = self.descendants(&f);
        moving.insert(0, f.clone());
        for key in moving {
            if let Some(node) = self.nodes.remove(&key) {
                let mut nk = t.clone();
                nk.extend_from_slice(&key[f.len()..]);
                self.nodes.insert(nk, node);
            }
        }
        Ok(())
    }
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;

    #[test]
    fn passes_conformance() {
        crate::conformance::run(MemVfs::new);
    }

    #[test]
    fn file_size_cap() {
        let mut v = MemVfs::with_limits(Limits {
            max_file_size: 4,
            ..Limits::default()
        });
        v.write(b"/a", b"1234").unwrap();
        assert_eq!(v.write(b"/a", b"12345"), Err(VfsError::FileTooLarge));
        assert_eq!(v.read(b"/a").unwrap(), b"1234");
    }

    #[test]
    fn total_bytes_cap_and_accounting() {
        let mut v = MemVfs::with_limits(Limits {
            max_total_bytes: 10,
            ..Limits::default()
        });
        v.write(b"/a", b"123456").unwrap();
        assert_eq!(v.write(b"/b", b"12345"), Err(VfsError::QuotaExceeded));
        v.write(b"/a", b"12").unwrap(); // shrinking frees quota
        v.write(b"/b", b"12345678").unwrap();
        assert_eq!(v.total_bytes(), 10);
        v.remove(b"/b").unwrap();
        assert_eq!(v.total_bytes(), 2);
        v.write(b"/c", b"x").unwrap();
        v.rename(b"/c", b"/a").unwrap(); // replaced file frees its bytes
        assert_eq!(v.total_bytes(), 1);
    }

    #[test]
    fn inode_cap() {
        let mut v = MemVfs::with_limits(Limits {
            max_inodes: 2,
            ..Limits::default()
        });
        v.mkdir(b"/d").unwrap();
        v.write(b"/f", b"").unwrap();
        assert_eq!(v.write(b"/g", b""), Err(VfsError::QuotaExceeded));
        assert_eq!(v.mkdir(b"/h"), Err(VfsError::QuotaExceeded));
        v.write(b"/f", b"overwrite ok").unwrap();
        v.remove(b"/f").unwrap();
        v.mkdir(b"/h").unwrap();
        assert_eq!(v.inode_count(), 2);
    }

    #[test]
    fn directory_rename_moves_subtree() {
        let mut v = MemVfs::new();
        v.mkdir_all(b"/a/b").unwrap();
        v.write(b"/a/b/f", b"x").unwrap();
        v.write(b"/ab", b"sibling").unwrap();
        v.rename(b"/a", b"/z").unwrap();
        assert_eq!(v.read(b"/z/b/f").unwrap(), b"x");
        assert!(!v.exists(b"/a"));
        assert_eq!(v.read(b"/ab").unwrap(), b"sibling");
        assert_eq!(v.rename(b"/z", b"/z/b/in"), Err(VfsError::InvalidInput));
    }
}
