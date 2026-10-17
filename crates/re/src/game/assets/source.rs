// SPDX-License-Identifier: Apache-2.0
//! Positioned reads over a local file. Archives are never loaded whole: a 9 GB CPK is read
//! entry by entry with one bounded read per range.

use std::{
    fs::File,
    io::{Read, Seek, SeekFrom},
    path::{Path, PathBuf},
    sync::Mutex,
};

use super::{AssetError, AssetResult};

/// Largest single read (1 GiB). Larger entries are refused instead of exhausting memory.
pub const MAX_READ: u64 = 1 << 30;

/// A read-only file with positioned reads.
#[derive(Debug)]
pub struct FileSource {
    path: PathBuf,
    len: u64,
    file: Mutex<File>,
}

impl FileSource {
    /// Open `path` read-only.
    ///
    /// # Errors
    /// I/O errors of `open` and `metadata`.
    pub fn open(path: &Path) -> AssetResult<Self> {
        let io = |source| AssetError::Io {
            path: path.display().to_string(),
            source,
        };
        let file = File::open(path).map_err(io)?;
        let len = file.metadata().map_err(io)?.len();
        Ok(Self {
            path: path.to_path_buf(),
            len,
            file: Mutex::new(file),
        })
    }

    /// File size in bytes.
    #[must_use]
    pub fn len(&self) -> u64 {
        self.len
    }

    /// True for an empty file.
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.len == 0
    }

    /// The opened path.
    #[must_use]
    pub fn path(&self) -> &Path {
        &self.path
    }

    /// Read exactly `len` bytes at `offset`.
    ///
    /// # Errors
    /// Out-of-range requests, reads above [`MAX_READ`] and I/O errors.
    pub fn read_at(&self, offset: u64, len: u64) -> AssetResult<Vec<u8>> {
        if offset.checked_add(len).is_none_or(|end| end > self.len) {
            return Err(AssetError::Format {
                format: "source",
                details: format!(
                    "{}: range {offset}+{len} outside {} bytes",
                    self.path.display(),
                    self.len
                ),
            });
        }
        if len > MAX_READ {
            return Err(AssetError::Unsupported(format!(
                "{}: single read of {len} bytes exceeds the 1 GiB budget",
                self.path.display()
            )));
        }
        let io = |source| AssetError::Io {
            path: self.path.display().to_string(),
            source,
        };
        let mut buffer = vec![0u8; usize::try_from(len).unwrap_or(usize::MAX)];
        let mut file = self
            .file
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        file.seek(SeekFrom::Start(offset)).map_err(io)?;
        file.read_exact(&mut buffer).map_err(io)?;
        Ok(buffer)
    }

    /// Read up to `len` bytes at `offset`, clamped to the end of the file.
    ///
    /// # Errors
    /// I/O errors.
    pub fn read_clamped(&self, offset: u64, len: u64) -> AssetResult<Vec<u8>> {
        if offset >= self.len {
            return Ok(Vec::new());
        }
        self.read_at(offset, len.min(self.len - offset))
    }

    /// The last `len` bytes (or the whole file when shorter).
    ///
    /// # Errors
    /// I/O errors.
    pub fn tail(&self, len: u64) -> AssetResult<Vec<u8>> {
        let len = len.min(self.len);
        self.read_at(self.len - len, len)
    }
}

/// Little-endian/big-endian cursor over a byte slice with bounds-checked reads.
pub(crate) struct Cursor<'a> {
    data: &'a [u8],
    pub(crate) pos: usize,
    format: &'static str,
}

impl<'a> Cursor<'a> {
    pub(crate) fn new(data: &'a [u8], format: &'static str) -> Self {
        Self {
            data,
            pos: 0,
            format,
        }
    }

    pub(crate) fn at(data: &'a [u8], pos: usize, format: &'static str) -> Self {
        Self { data, pos, format }
    }

    pub(crate) fn remaining(&self) -> usize {
        self.data.len().saturating_sub(self.pos)
    }

    pub(crate) fn bytes(&mut self, len: usize) -> AssetResult<&'a [u8]> {
        let end = self
            .pos
            .checked_add(len)
            .filter(|end| *end <= self.data.len())
            .ok_or_else(|| {
                super::format_err(self.format, format!("truncated at {} (+{len})", self.pos))
            })?;
        let slice = &self.data[self.pos..end];
        self.pos = end;
        Ok(slice)
    }

    pub(crate) fn array<const N: usize>(&mut self) -> AssetResult<[u8; N]> {
        let mut out = [0u8; N];
        out.copy_from_slice(self.bytes(N)?);
        Ok(out)
    }

    pub(crate) fn u8(&mut self) -> AssetResult<u8> {
        Ok(self.array::<1>()?[0])
    }
    pub(crate) fn u16(&mut self) -> AssetResult<u16> {
        Ok(u16::from_le_bytes(self.array()?))
    }
    pub(crate) fn u32(&mut self) -> AssetResult<u32> {
        Ok(u32::from_le_bytes(self.array()?))
    }
    pub(crate) fn i32(&mut self) -> AssetResult<i32> {
        Ok(i32::from_le_bytes(self.array()?))
    }
    pub(crate) fn u64(&mut self) -> AssetResult<u64> {
        Ok(u64::from_le_bytes(self.array()?))
    }
    pub(crate) fn u16_be(&mut self) -> AssetResult<u16> {
        Ok(u16::from_be_bytes(self.array()?))
    }
    pub(crate) fn u32_be(&mut self) -> AssetResult<u32> {
        Ok(u32::from_be_bytes(self.array()?))
    }
    pub(crate) fn i32_be(&mut self) -> AssetResult<i32> {
        Ok(i32::from_be_bytes(self.array()?))
    }
    pub(crate) fn i64_be(&mut self) -> AssetResult<i64> {
        Ok(i64::from_be_bytes(self.array()?))
    }

    /// Null-terminated byte string, lossily decoded.
    pub(crate) fn cstring(&mut self) -> AssetResult<String> {
        let rest = &self.data[self.pos.min(self.data.len())..];
        let len = rest
            .iter()
            .position(|byte| *byte == 0)
            .ok_or_else(|| super::format_err(self.format, "unterminated string"))?;
        let text = String::from_utf8_lossy(&rest[..len]).into_owned();
        self.pos += len + 1;
        Ok(text)
    }

    /// Unreal `FString`: `i32` length including the terminator; negative means UTF-16.
    pub(crate) fn fstring(&mut self) -> AssetResult<String> {
        let len = self.i32()?;
        if len == 0 {
            return Ok(String::new());
        }
        if len > 0 {
            let len = usize::try_from(len).unwrap_or(usize::MAX);
            if len > 1 << 20 {
                return Err(super::format_err(self.format, "FString longer than 1 MiB"));
            }
            let raw = self.bytes(len)?;
            let raw = raw.strip_suffix(&[0]).unwrap_or(raw);
            return Ok(String::from_utf8_lossy(raw).into_owned());
        }
        let units = usize::try_from(len.unsigned_abs()).unwrap_or(usize::MAX);
        if units > 1 << 20 {
            return Err(super::format_err(self.format, "FString longer than 1 MiB"));
        }
        let raw = self.bytes(units * 2)?;
        let mut wide: Vec<u16> = raw
            .chunks_exact(2)
            .map(|pair| u16::from_le_bytes([pair[0], pair[1]]))
            .collect();
        if wide.last() == Some(&0) {
            wide.pop();
        }
        Ok(String::from_utf16_lossy(&wide))
    }

    pub(crate) fn align(&mut self, to: usize) {
        let rem = self.pos % to;
        if rem != 0 {
            self.pos += to - rem;
        }
    }
}
