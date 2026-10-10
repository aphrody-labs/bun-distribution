// SPDX-License-Identifier: Apache-2.0
//! Synchronous VFS image used by the dedicated browser OPFS worker.
//!
//! Browser directory handles remain asynchronous even in a worker. The worker
//! opens two OPFS image slots asynchronously, then uses sync access handles to
//! load and persist the VFS image around synchronous shell operations.

use std::{cell::RefCell, rc::Rc};

use aphrody_shell_vfs::{DirEntry, FileKind, Limits, MemVfs, Stat, Vfs, VfsError, VfsResult, path};

const MAGIC: &[u8; 6] = b"APFS1\0";
/// Maximum serialized image size; the underlying `MemVfs` has its own byte/inode caps.
pub const MAX_IMAGE_BYTES: usize = 80 * 1024 * 1024;

/// A VFS with deterministic binary snapshots for persistence in OPFS.
#[derive(Default)]
pub struct OpfsVfs {
    inner: MemVfs,
    dirty: bool,
}

impl OpfsVfs {
    /// Create an empty filesystem.
    #[must_use]
    pub fn new() -> Self {
        Self { inner: MemVfs::new(), dirty: false }
    }

    /// Restore a previously persisted image. An empty byte slice creates a new filesystem.
    ///
    /// # Errors
    /// Rejects truncated, corrupt, oversized or VFS-invalid images.
    pub fn from_image(image: &[u8]) -> VfsResult<Self> {
        if image.is_empty() {
            return Ok(Self::new());
        }
        if image.len() > MAX_IMAGE_BYTES || image.len() < MAGIC.len() + 8 {
            return Err(VfsError::InvalidInput);
        }
        let (body, checksum) = image.split_at(image.len() - 4);
        if u32::from_le_bytes(checksum.try_into().map_err(|_| VfsError::InvalidInput)?)
            != crc32fast::hash(body)
        {
            return Err(VfsError::InvalidInput);
        }
        let mut cursor = Cursor::new(body);
        if cursor.take(MAGIC.len())? != MAGIC {
            return Err(VfsError::InvalidInput);
        }
        let count = cursor.u32()? as usize;
        if count > Limits::default().max_inodes {
            return Err(VfsError::QuotaExceeded);
        }
        let mut fs = MemVfs::new();
        for _ in 0..count {
            let kind = cursor.take(1)?[0];
            let path_len = cursor.u32()? as usize;
            let data_len = cursor.u32()? as usize;
            if path_len == 0
                || path_len > path::MAX_PATH_LEN
                || data_len as u64 > Limits::default().max_file_size
            {
                return Err(VfsError::InvalidInput);
            }
            let path_bytes = cursor.take(path_len)?;
            if path::normalize(path_bytes)? != path_bytes || path_bytes == b"/" {
                return Err(VfsError::InvalidInput);
            }
            let data = cursor.take(data_len)?;
            match kind {
                0 if data.is_empty() => fs.mkdir(path_bytes)?,
                1 => fs.write(path_bytes, data)?,
                _ => return Err(VfsError::InvalidInput),
            }
        }
        if !cursor.done() {
            return Err(VfsError::InvalidInput);
        }
        Ok(Self { inner: fs, dirty: false })
    }

    /// Serialize all files and directories. The checksum detects torn writes.
    ///
    /// # Errors
    /// Returns `QuotaExceeded` if the image exceeds the bound.
    pub fn image(&mut self) -> VfsResult<Vec<u8>> {
        let mut entries = Vec::new();
        collect(&mut self.inner, b"/", &mut entries)?;
        let count = u32::try_from(entries.len()).map_err(|_| VfsError::QuotaExceeded)?;
        let mut out = Vec::with_capacity(MAGIC.len() + 4);
        out.extend_from_slice(MAGIC);
        out.extend_from_slice(&count.to_le_bytes());
        for (kind, path_bytes, data) in entries {
            let path_len = u32::try_from(path_bytes.len()).map_err(|_| VfsError::QuotaExceeded)?;
            let data_len = u32::try_from(data.len()).map_err(|_| VfsError::QuotaExceeded)?;
            let entry_len = 9usize.saturating_add(path_bytes.len()).saturating_add(data.len());
            if out.len().saturating_add(entry_len).saturating_add(4) > MAX_IMAGE_BYTES {
                return Err(VfsError::QuotaExceeded);
            }
            out.push(kind);
            out.extend_from_slice(&path_len.to_le_bytes());
            out.extend_from_slice(&data_len.to_le_bytes());
            out.extend_from_slice(&path_bytes);
            out.extend_from_slice(&data);
        }
        let checksum = crc32fast::hash(&out);
        out.extend_from_slice(&checksum.to_le_bytes());
        Ok(out)
    }

    /// Whether a successful mutating VFS operation occurred since persistence.
    #[must_use]
    pub fn dirty(&self) -> bool {
        self.dirty
    }

    /// Call only after the worker has flushed this image to OPFS.
    pub fn mark_persisted(&mut self) {
        self.dirty = false;
    }
}

fn collect(
    fs: &mut MemVfs,
    dir: &[u8],
    entries: &mut Vec<(u8, Vec<u8>, Vec<u8>)>,
) -> VfsResult<()> {
    for entry in fs.read_dir(dir)? {
        let child = path::join(dir, &entry.name);
        match entry.kind {
            FileKind::Dir => {
                entries.push((0, child.clone(), Vec::new()));
                collect(fs, &child, entries)?;
            },
            FileKind::File => entries.push((1, child.clone(), fs.read(&child)?)),
        }
    }
    Ok(())
}

struct Cursor<'a> {
    bytes: &'a [u8],
    at: usize,
}
impl<'a> Cursor<'a> {
    fn new(bytes: &'a [u8]) -> Self {
        Self { bytes, at: 0 }
    }
    fn take(&mut self, count: usize) -> VfsResult<&'a [u8]> {
        let end = self.at.checked_add(count).ok_or(VfsError::InvalidInput)?;
        let slice = self.bytes.get(self.at..end).ok_or(VfsError::InvalidInput)?;
        self.at = end;
        Ok(slice)
    }
    fn u32(&mut self) -> VfsResult<u32> {
        Ok(u32::from_le_bytes(self.take(4)?.try_into().map_err(|_| VfsError::InvalidInput)?))
    }
    fn done(&self) -> bool {
        self.at == self.bytes.len()
    }
}

impl Vfs for OpfsVfs {
    fn read(&mut self, path: &[u8]) -> VfsResult<Vec<u8>> {
        self.inner.read(path)
    }
    fn write(&mut self, path: &[u8], data: &[u8]) -> VfsResult<()> {
        self.inner.write(path, data)?;
        self.dirty = true;
        Ok(())
    }
    fn stat(&mut self, path: &[u8]) -> VfsResult<Stat> {
        self.inner.stat(path)
    }
    fn read_dir(&mut self, path: &[u8]) -> VfsResult<Vec<DirEntry>> {
        self.inner.read_dir(path)
    }
    fn mkdir(&mut self, path: &[u8]) -> VfsResult<()> {
        self.inner.mkdir(path)?;
        self.dirty = true;
        Ok(())
    }
    fn remove(&mut self, path: &[u8]) -> VfsResult<()> {
        self.inner.remove(path)?;
        self.dirty = true;
        Ok(())
    }
    fn rename(&mut self, from: &[u8], to: &[u8]) -> VfsResult<()> {
        self.inner.rename(from, to)?;
        self.dirty = true;
        Ok(())
    }
}

/// Shared handle: the shell receives a `Vfs`, while its worker owns snapshots.
#[derive(Clone)]
pub struct SharedOpfsVfs(Rc<RefCell<OpfsVfs>>);

impl SharedOpfsVfs {
    /// Start from an empty or persisted image.
    ///
    /// # Errors
    /// Returns the same image errors as [`OpfsVfs::from_image`].
    pub fn from_image(image: &[u8]) -> VfsResult<Self> {
        Ok(Self(Rc::new(RefCell::new(OpfsVfs::from_image(image)?))))
    }

    /// Return a new image only when the filesystem has changed.
    ///
    /// # Errors
    /// Returns the same size errors as [`OpfsVfs::image`].
    pub fn image_if_dirty(&self) -> VfsResult<Option<Vec<u8>>> {
        let mut fs = self.0.borrow_mut();
        if fs.dirty() { Ok(Some(fs.image()?)) } else { Ok(None) }
    }

    /// Acknowledge successful OPFS flush.
    pub fn mark_persisted(&self) {
        self.0.borrow_mut().mark_persisted();
    }
}

impl Vfs for SharedOpfsVfs {
    fn read(&mut self, path: &[u8]) -> VfsResult<Vec<u8>> {
        self.0.borrow_mut().read(path)
    }
    fn write(&mut self, path: &[u8], data: &[u8]) -> VfsResult<()> {
        self.0.borrow_mut().write(path, data)
    }
    fn stat(&mut self, path: &[u8]) -> VfsResult<Stat> {
        self.0.borrow_mut().stat(path)
    }
    fn read_dir(&mut self, path: &[u8]) -> VfsResult<Vec<DirEntry>> {
        self.0.borrow_mut().read_dir(path)
    }
    fn mkdir(&mut self, path: &[u8]) -> VfsResult<()> {
        self.0.borrow_mut().mkdir(path)
    }
    fn remove(&mut self, path: &[u8]) -> VfsResult<()> {
        self.0.borrow_mut().remove(path)
    }
    fn rename(&mut self, from: &[u8], to: &[u8]) -> VfsResult<()> {
        self.0.borrow_mut().rename(from, to)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use aphrody_shell_vfs::conformance;

    #[test]
    fn vfs_conformance() {
        conformance::run(OpfsVfs::new);
    }

    #[test]
    fn binary_snapshot_round_trip_and_dirty_tracking() {
        let mut fs = OpfsVfs::new();
        fs.mkdir(b"/dir").unwrap();
        fs.write(b"/dir/bin", &[0, 255, 10, 128]).unwrap();
        assert!(fs.dirty());
        let image = fs.image().unwrap();
        fs.mark_persisted();
        assert!(!fs.dirty());
        let mut restored = OpfsVfs::from_image(&image).unwrap();
        assert_eq!(restored.read(b"/dir/bin").unwrap(), &[0, 255, 10, 128]);
        assert!(!restored.dirty());
        restored.rename(b"/dir/bin", b"/dir/moved").unwrap();
        assert!(restored.dirty());
    }

    #[test]
    fn invalid_images_are_rejected() {
        let mut fs = OpfsVfs::new();
        fs.write(b"/f", b"data").unwrap();
        let mut image = fs.image().unwrap();
        image[11] ^= 1;
        assert!(OpfsVfs::from_image(&image).is_err());
        assert!(OpfsVfs::from_image(&image[..image.len() - 2]).is_err());
        assert!(OpfsVfs::from_image(&vec![0; MAX_IMAGE_BYTES + 1]).is_err());
    }

    #[test]
    fn shared_handle_exposes_only_dirty_snapshots() {
        let shared = SharedOpfsVfs::from_image(b"").unwrap();
        assert!(shared.image_if_dirty().unwrap().is_none());
        shared.clone().write(b"/f", b"x").unwrap();
        let image = shared.image_if_dirty().unwrap().unwrap();
        shared.mark_persisted();
        assert!(shared.image_if_dirty().unwrap().is_none());
        assert_eq!(OpfsVfs::from_image(&image).unwrap().read(b"/f").unwrap(), b"x");
    }
}
