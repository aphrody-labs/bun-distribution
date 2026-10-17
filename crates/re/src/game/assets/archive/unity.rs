// SPDX-License-Identifier: Apache-2.0
//! Unity `UnityFS` asset bundles (format 6-8): header, blocks info (stored, LZ4, LZ4HC) and the
//! node directory. Each node (`CAB-…` serialized file, `.resS`, `.resource`) is one entry.
//! LZMA blocks are listed and refused. Serialized-file object trees are not decoded here.

use std::path::Path;

use super::{Archive, ArchiveEntry, decompress};
use crate::game::assets::{
    AssetError, AssetResult, format_err, normalize_path,
    source::{Cursor, FileSource},
};

const FORMAT: &str = "unityfs";
const BLOCKS_INFO_AT_END: u32 = 0x80;
const BLOCK_INFO_NEEDS_PADDING: u32 = 0x200;

#[derive(Debug, Clone, Copy)]
struct StorageBlock {
    uncompressed: u32,
    compressed: u32,
    flags: u16,
    /// Offset of the compressed block in the file.
    file_offset: u64,
    /// Offset of the block in the uncompressed stream.
    stream_offset: u64,
}

fn method(flags: u32) -> &'static str {
    match flags & 0x3f {
        0 => "none",
        1 => "lzma",
        2 => "lz4",
        3 => "lz4hc",
        _ => "unknown",
    }
}

/// A mounted UnityFS bundle.
pub struct UnityFsArchive {
    label: String,
    source: FileSource,
    version: u32,
    unity_version: String,
    blocks: Vec<StorageBlock>,
    nodes: Vec<(u64, u64)>,
    entries: Vec<ArchiveEntry>,
}

impl UnityFsArchive {
    /// Open a UnityFS bundle.
    ///
    /// # Errors
    /// Not a UnityFS bundle, LZMA blocks info, malformed directory.
    pub fn open(path: &Path, label: String) -> AssetResult<Self> {
        let source = FileSource::open(path)?;
        let head = source.read_clamped(0, 4096)?;
        let mut cursor = Cursor::new(&head, FORMAT);
        if cursor.cstring()? != "UnityFS" {
            return Err(format_err(FORMAT, "missing UnityFS signature"));
        }
        let version = cursor.u32_be()?;
        let _player = cursor.cstring()?;
        let unity_version = cursor.cstring()?;
        let _size = cursor.i64_be()?;
        let compressed_info = u64::from(cursor.u32_be()?);
        let uncompressed_info = cursor.u32_be()? as usize;
        let flags = cursor.u32_be()?;
        if version >= 7 {
            cursor.align(16);
        }
        let header_end = cursor.pos as u64;
        let info_offset = if flags & BLOCKS_INFO_AT_END != 0 {
            source.len().saturating_sub(compressed_info)
        } else {
            header_end
        };
        let raw_info = source.read_at(info_offset, compressed_info)?;
        let info = match method(flags) {
            "none" => raw_info,
            "lz4" | "lz4hc" => decompress("lz4", &raw_info, uncompressed_info)?,
            other => {
                return Err(AssetError::Unsupported(format!(
                    "{label}: {other} blocks info"
                )));
            }
        };
        let mut data_offset = if flags & BLOCKS_INFO_AT_END != 0 {
            header_end
        } else {
            header_end + compressed_info
        };
        if version >= 7 && flags & BLOCK_INFO_NEEDS_PADDING != 0 {
            data_offset = super::align_up(data_offset, 16);
        }

        let mut cursor = Cursor::new(&info, FORMAT);
        cursor.bytes(16)?;
        let block_count = usize::try_from(cursor.i32_be()?.max(0)).unwrap_or(0);
        let mut blocks = Vec::with_capacity(block_count.min(1 << 20));
        let (mut file_offset, mut stream_offset) = (data_offset, 0u64);
        for _ in 0..block_count {
            let uncompressed = cursor.u32_be()?;
            let compressed = cursor.u32_be()?;
            let flags = cursor.u16_be()?;
            blocks.push(StorageBlock {
                uncompressed,
                compressed,
                flags,
                file_offset,
                stream_offset,
            });
            file_offset += u64::from(compressed);
            stream_offset += u64::from(uncompressed);
        }
        let node_count = usize::try_from(cursor.i32_be()?.max(0)).unwrap_or(0);
        let mut nodes = Vec::with_capacity(node_count.min(1 << 20));
        let mut entries = Vec::with_capacity(node_count.min(1 << 20));
        for _ in 0..node_count {
            let offset = u64::try_from(cursor.i64_be()?).unwrap_or(0);
            let size = u64::try_from(cursor.i64_be()?).unwrap_or(0);
            let _flags = cursor.u32_be()?;
            let name = cursor.cstring()?;
            let compression = blocks
                .iter()
                .find(|block| {
                    block.stream_offset + u64::from(block.uncompressed) > offset
                        && block.stream_offset <= offset
                })
                .map(|block| method(u32::from(block.flags)).replace("none", ""))
                .unwrap_or_default();
            entries.push(ArchiveEntry {
                path: normalize_path(&name),
                size,
                stored: size,
                compression,
                encrypted: false,
            });
            nodes.push((offset, size));
        }
        Ok(Self {
            label,
            source,
            version,
            unity_version,
            blocks,
            nodes,
            entries,
        })
    }
}

impl Archive for UnityFsArchive {
    fn format(&self) -> &'static str {
        FORMAT
    }
    fn label(&self) -> &str {
        &self.label
    }
    fn entries(&self) -> &[ArchiveEntry] {
        &self.entries
    }
    fn read(&self, index: usize) -> AssetResult<Vec<u8>> {
        let (offset, size) = *self
            .nodes
            .get(index)
            .ok_or_else(|| AssetError::NotFound(format!("{}#{index}", self.label)))?;
        let end = offset + size;
        let mut out = Vec::with_capacity(usize::try_from(size).unwrap_or(0));
        for block in &self.blocks {
            let block_end = block.stream_offset + u64::from(block.uncompressed);
            if block_end <= offset || block.stream_offset >= end {
                continue;
            }
            let raw = self
                .source
                .read_at(block.file_offset, u64::from(block.compressed))?;
            let data = match method(u32::from(block.flags)) {
                "none" => raw,
                "lz4" | "lz4hc" => decompress("lz4", &raw, block.uncompressed as usize)?,
                other => return Err(AssetError::Unsupported(format!("{other} bundle block"))),
            };
            let from = offset.saturating_sub(block.stream_offset) as usize;
            let to = (end.min(block_end) - block.stream_offset) as usize;
            out.extend_from_slice(data.get(from..to).unwrap_or_default());
        }
        Ok(out)
    }
    fn info(&self) -> serde_json::Value {
        serde_json::json!({
            "formatVersion": self.version,
            "unityVersion": self.unity_version,
            "blocks": self.blocks.len(),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A format-6 bundle, blocks info stored inline, one LZ4 block holding two nodes.
    #[test]
    fn reads_an_lz4_bundle() {
        let payload = b"CAB-serialized-file-bytes....resource-bytes".to_vec();
        let block = lz4_flex::block::compress(&payload);
        let mut info = vec![0u8; 16];
        info.extend(1i32.to_be_bytes());
        info.extend(u32::try_from(payload.len()).unwrap().to_be_bytes());
        info.extend(u32::try_from(block.len()).unwrap().to_be_bytes());
        info.extend(2u16.to_be_bytes());
        info.extend(2i32.to_be_bytes());
        info.extend(0i64.to_be_bytes());
        info.extend(29i64.to_be_bytes());
        info.extend(4u32.to_be_bytes());
        info.extend(b"CAB-1234\0");
        info.extend(29i64.to_be_bytes());
        info.extend(i64::try_from(payload.len() - 29).unwrap().to_be_bytes());
        info.extend(0u32.to_be_bytes());
        info.extend(b"CAB-1234.resource\0");

        let mut file = b"UnityFS\0".to_vec();
        file.extend(6u32.to_be_bytes());
        file.extend(b"5.x.x\0");
        file.extend(b"2019.4.40f1\0");
        let total = file.len() + 8 + 12 + info.len() + block.len();
        file.extend(i64::try_from(total).unwrap().to_be_bytes());
        file.extend(u32::try_from(info.len()).unwrap().to_be_bytes());
        file.extend(u32::try_from(info.len()).unwrap().to_be_bytes());
        file.extend(0u32.to_be_bytes());
        file.extend(&info);
        file.extend(&block);

        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("level0.bundle");
        std::fs::write(&path, &file).unwrap();
        let archive = UnityFsArchive::open(&path, "level0.bundle".into()).unwrap();
        assert_eq!(archive.entries().len(), 2);
        assert_eq!(archive.entries()[1].path, "CAB-1234.resource");
        assert_eq!(archive.read(0).unwrap(), &payload[..29]);
        assert_eq!(archive.read(1).unwrap(), &payload[29..]);
    }
}
