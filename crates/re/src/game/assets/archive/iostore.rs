// SPDX-License-Identifier: Apache-2.0
//! Unreal Engine IoStore containers: the `.utoc` table of contents (chunk ids, offset/lengths,
//! compression blocks, method names, directory index) and the `.ucas` payload partitions.
//! Chunks absent from the directory index are listed under `.chunks/<id>`. Encrypted
//! containers need a user-provided AES-256 key; Oodle blocks are refused.

use std::path::{Path, PathBuf};

use super::{Archive, ArchiveEntry, aes256_ecb_decrypt, align_up, decompress};
use crate::game::assets::{
    AssetError, AssetResult, Keys, format_err, normalize_path,
    source::{Cursor, FileSource},
};

/// `.utoc` magic.
pub const TOC_MAGIC: &[u8; 16] = b"-==--==--==--==-";
const FORMAT: &str = "unreal-iostore";
const FLAG_COMPRESSED: u8 = 1;
const FLAG_ENCRYPTED: u8 = 2;
const FLAG_SIGNED: u8 = 4;
const FLAG_INDEXED: u8 = 8;
const NONE: u32 = u32::MAX;

#[derive(Debug, Clone, Copy)]
struct Block {
    offset: u64,
    compressed: u32,
    uncompressed: u32,
    method: u8,
}

/// A mounted IoStore container.
pub struct IoStoreArchive {
    label: String,
    version: u8,
    flags: u8,
    block_size: u64,
    partition_size: u64,
    partitions: Vec<FileSource>,
    methods: Vec<String>,
    blocks: Vec<Block>,
    ranges: Vec<(u64, u64)>,
    mount_point: String,
    key: Option<[u8; 32]>,
    entries: Vec<ArchiveEntry>,
}

fn u40_be(bytes: &[u8]) -> u64 {
    bytes
        .iter()
        .take(5)
        .fold(0u64, |acc, byte| (acc << 8) | u64::from(*byte))
}

fn le(bytes: &[u8]) -> u64 {
    bytes
        .iter()
        .rev()
        .fold(0u64, |acc, byte| (acc << 8) | u64::from(*byte))
}

fn partition_paths(utoc: &Path, count: usize) -> Vec<PathBuf> {
    let stem = utoc.with_extension("");
    (0..count.max(1))
        .map(|index| {
            if index == 0 {
                stem.with_extension("ucas")
            } else {
                let mut name = stem.file_name().unwrap_or_default().to_os_string();
                name.push(format!("_s{index}.ucas"));
                stem.with_file_name(name)
            }
        })
        .collect()
}

impl IoStoreArchive {
    /// Open `path` (`.utoc`) and its `.ucas` partitions.
    ///
    /// # Errors
    /// Malformed TOC, missing partitions, encrypted directory index without key.
    pub fn open(path: &Path, label: String, keys: &Keys) -> AssetResult<Self> {
        let toc = std::fs::read(path).map_err(|source| AssetError::Io {
            path: path.display().to_string(),
            source,
        })?;
        let mut cursor = Cursor::new(&toc, FORMAT);
        if cursor.bytes(16)? != TOC_MAGIC {
            return Err(format_err(FORMAT, "bad .utoc magic"));
        }
        let version = cursor.u8()?;
        cursor.bytes(3)?;
        let header_size = cursor.u32()? as usize;
        let entry_count = cursor.u32()? as usize;
        let block_count = cursor.u32()? as usize;
        let block_entry_size = cursor.u32()? as usize;
        let method_count = cursor.u32()? as usize;
        let method_len = cursor.u32()? as usize;
        let block_size = u64::from(cursor.u32()?);
        let directory_size = cursor.u32()? as usize;
        let partition_count = cursor.u32()? as usize;
        let _container_id = cursor.u64()?;
        let _key_guid = cursor.bytes(16)?;
        let flags = cursor.u8()?;
        cursor.bytes(3)?;
        let seeds = cursor.u32()? as usize;
        let partition_size = cursor.u64()?;
        let without_hash = cursor.u32()? as usize;
        if entry_count > 10_000_000 || block_count > 50_000_000 || block_entry_size != 12 {
            return Err(format_err(FORMAT, "implausible TOC header"));
        }
        let (partition_count, partition_size) = if version >= 3 && partition_size != 0 {
            (partition_count.max(1), partition_size)
        } else {
            (1, u64::MAX)
        };
        cursor.pos = header_size;
        let chunk_ids = cursor.bytes(entry_count * 12)?.to_vec();
        let offsets = cursor.bytes(entry_count * 10)?.to_vec();
        if version >= 4 {
            cursor.bytes(seeds * 4)?;
        }
        if version >= 5 {
            cursor.bytes(without_hash * 4)?;
        }
        let raw_blocks = cursor.bytes(block_count * 12)?;
        let blocks: Vec<Block> = raw_blocks
            .chunks_exact(12)
            .map(|raw| Block {
                offset: le(&raw[0..5]),
                compressed: le(&raw[5..8]) as u32,
                uncompressed: le(&raw[8..11]) as u32,
                method: raw[11],
            })
            .collect();
        let mut methods = Vec::with_capacity(method_count);
        for _ in 0..method_count {
            let raw = cursor.bytes(method_len)?;
            let name = raw.split(|byte| *byte == 0).next().unwrap_or_default();
            methods.push(String::from_utf8_lossy(name).into_owned());
        }
        if flags & FLAG_SIGNED != 0 {
            let hash_size = usize::try_from(cursor.i32()?.max(0)).unwrap_or(0);
            cursor.bytes(hash_size * 2)?;
            cursor.bytes(block_count * 20)?;
        }
        let encrypted = flags & FLAG_ENCRYPTED != 0;
        let mut names: Vec<Option<String>> = vec![None; entry_count];
        let mut mount_point = String::new();
        if flags & FLAG_INDEXED != 0 && directory_size > 0 && version >= 2 {
            let mut directory = cursor.bytes(directory_size)?.to_vec();
            if encrypted {
                let key = keys.aes.as_ref().ok_or_else(|| {
                    AssetError::KeyRequired(format!("{label} (encrypted IoStore directory)"))
                })?;
                aes256_ecb_decrypt(key, &mut directory)?;
            }
            mount_point = read_directory(&directory, &mut names)?;
        }

        let partitions = partition_paths(path, partition_count)
            .iter()
            .filter(|candidate| candidate.is_file())
            .map(|candidate| FileSource::open(candidate))
            .collect::<AssetResult<Vec<_>>>()?;
        if partitions.is_empty() {
            return Err(format_err(
                FORMAT,
                format!("{label}: no .ucas partition next to the TOC"),
            ));
        }

        let mut archive = Self {
            label,
            version,
            flags,
            block_size: block_size.max(1),
            partition_size,
            partitions,
            methods,
            blocks,
            ranges: Vec::with_capacity(entry_count),
            mount_point: mount_point.clone(),
            key: keys.aes,
            entries: Vec::with_capacity(entry_count),
        };
        for index in 0..entry_count {
            let raw = &offsets[index * 10..index * 10 + 10];
            let offset = u40_be(&raw[0..5]);
            let length = u40_be(&raw[5..10]);
            let path = match &names[index] {
                Some(name) => normalize_path(&format!("{mount_point}{name}")),
                None => {
                    let id = hex::encode(&chunk_ids[index * 12..index * 12 + 12]);
                    let stem = archive
                        .label
                        .rsplit('/')
                        .next()
                        .unwrap_or_default()
                        .trim_end_matches(".utoc")
                        .to_string();
                    format!(".chunks/{stem}/{id}")
                }
            };
            let compression = archive.first_method(offset, length);
            archive.entries.push(ArchiveEntry {
                path,
                size: length,
                stored: length,
                compression,
                encrypted,
            });
            archive.ranges.push((offset, length));
        }
        Ok(archive)
    }

    fn first_method(&self, offset: u64, length: u64) -> String {
        if length == 0 {
            return String::new();
        }
        let first = usize::try_from(offset / self.block_size).unwrap_or(usize::MAX);
        let last = usize::try_from((offset + length - 1) / self.block_size).unwrap_or(usize::MAX);
        let methods: std::collections::BTreeSet<u8> = self
            .blocks
            .get(first..=last.min(self.blocks.len().saturating_sub(1)))
            .unwrap_or_default()
            .iter()
            .map(|block| block.method)
            .collect();
        methods
            .iter()
            .filter(|method| **method != 0)
            .map(|method| self.method_name(*method))
            .collect::<Vec<_>>()
            .join("+")
    }

    fn method_name(&self, method: u8) -> String {
        if method == 0 {
            return String::new();
        }
        self.methods
            .get(usize::from(method) - 1)
            .cloned()
            .unwrap_or_else(|| format!("method#{method}"))
    }

    fn read_block(&self, block: &Block) -> AssetResult<Vec<u8>> {
        let partition = usize::try_from(block.offset / self.partition_size).unwrap_or(usize::MAX);
        let source = self.partitions.get(partition).ok_or_else(|| {
            format_err(
                FORMAT,
                format!("{}: missing .ucas partition {partition}", self.label),
            )
        })?;
        let at = block.offset % self.partition_size;
        let encrypted = self.flags & FLAG_ENCRYPTED != 0;
        let stored = if encrypted {
            align_up(u64::from(block.compressed), 16)
        } else {
            u64::from(block.compressed)
        };
        let mut raw = source.read_at(at, stored)?;
        if encrypted {
            let key = self.key.as_ref().ok_or_else(|| {
                AssetError::KeyRequired(format!("{} (encrypted IoStore block)", self.label))
            })?;
            aes256_ecb_decrypt(key, &mut raw)?;
        }
        raw.truncate(block.compressed as usize);
        let method = self.method_name(block.method);
        decompress(&method, &raw, block.uncompressed as usize)
    }
}

/// Parse `FIoDirectoryIndexResource`, filling `names[toc_index]`; returns the mount point.
fn read_directory(data: &[u8], names: &mut [Option<String>]) -> AssetResult<String> {
    let mut cursor = Cursor::new(data, FORMAT);
    let mount_point = cursor.fstring()?;
    let dir_count = usize::try_from(cursor.i32()?.max(0)).unwrap_or(0);
    let mut dirs = Vec::with_capacity(dir_count.min(1 << 20));
    for _ in 0..dir_count {
        dirs.push((cursor.u32()?, cursor.u32()?, cursor.u32()?, cursor.u32()?));
    }
    let file_count = usize::try_from(cursor.i32()?.max(0)).unwrap_or(0);
    let mut files = Vec::with_capacity(file_count.min(1 << 20));
    for _ in 0..file_count {
        files.push((cursor.u32()?, cursor.u32()?, cursor.u32()?));
    }
    let string_count = usize::try_from(cursor.i32()?.max(0)).unwrap_or(0);
    let mut strings = Vec::with_capacity(string_count.min(1 << 20));
    for _ in 0..string_count {
        strings.push(cursor.fstring()?);
    }
    let name = |index: u32| strings.get(index as usize).cloned().unwrap_or_default();
    // Depth-first walk from the root directory (entry 0, unnamed).
    let mut stack: Vec<(u32, String)> = Vec::new();
    if !dirs.is_empty() {
        stack.push((0, String::new()));
    }
    let mut guard = 0usize;
    while let Some((dir, prefix)) = stack.pop() {
        guard += 1;
        if guard > dirs.len() + 1 {
            return Err(format_err(FORMAT, "cyclic directory index"));
        }
        let Some(&(_, first_child, _, first_file)) = dirs.get(dir as usize) else {
            continue;
        };
        let mut file = first_file;
        let mut seen = 0usize;
        while file != NONE {
            let Some(&(file_name, next, user_data)) = files.get(file as usize) else {
                break;
            };
            if let Some(slot) = names.get_mut(user_data as usize) {
                *slot = Some(format!("{prefix}{}", name(file_name)));
            }
            file = next;
            seen += 1;
            if seen > files.len() {
                return Err(format_err(FORMAT, "cyclic file list"));
            }
        }
        let mut child = first_child;
        let mut seen = 0usize;
        while child != NONE {
            let Some(&(child_name, _, next_sibling, _)) = dirs.get(child as usize) else {
                break;
            };
            stack.push((child, format!("{prefix}{}/", name(child_name))));
            child = next_sibling;
            seen += 1;
            if seen > dirs.len() {
                return Err(format_err(FORMAT, "cyclic directory list"));
            }
        }
    }
    Ok(mount_point)
}

impl Archive for IoStoreArchive {
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
        let (offset, length) = *self
            .ranges
            .get(index)
            .ok_or_else(|| AssetError::NotFound(format!("{}#{index}", self.label)))?;
        if length == 0 {
            return Ok(Vec::new());
        }
        if length > crate::game::assets::source::MAX_READ {
            return Err(AssetError::Unsupported(format!("chunk of {length} bytes")));
        }
        let first = offset / self.block_size;
        let last = (offset + length - 1) / self.block_size;
        let mut out = Vec::with_capacity(usize::try_from(length).unwrap_or(0));
        for block_index in first..=last {
            let block = self
                .blocks
                .get(usize::try_from(block_index).unwrap_or(usize::MAX))
                .ok_or_else(|| format_err(FORMAT, "chunk beyond the block table"))?;
            let data = self.read_block(block)?;
            let block_start = block_index * self.block_size;
            let from = offset.saturating_sub(block_start) as usize;
            let to =
                ((offset + length).min(block_start + data.len() as u64) - block_start) as usize;
            out.extend_from_slice(data.get(from..to).unwrap_or_default());
        }
        Ok(out)
    }
    fn info(&self) -> serde_json::Value {
        serde_json::json!({
            "version": self.version,
            "mountPoint": self.mount_point,
            "compressed": self.flags & FLAG_COMPRESSED != 0,
            "encrypted": self.flags & FLAG_ENCRYPTED != 0,
            "signed": self.flags & FLAG_SIGNED != 0,
            "indexed": self.flags & FLAG_INDEXED != 0,
            "methods": self.methods,
            "partitions": self.partitions.len(),
            "blocks": self.blocks.len(),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fstring(out: &mut Vec<u8>, text: &str) {
        out.extend_from_slice(&i32::try_from(text.len() + 1).unwrap().to_le_bytes());
        out.extend_from_slice(text.as_bytes());
        out.push(0);
    }

    #[test]
    fn reads_an_indexed_uncompressed_container() {
        let payload_a = b"first chunk".to_vec();
        let payload_b = b"second".to_vec();
        let mut ucas = payload_a.clone();
        ucas.extend(&payload_b);

        let mut directory = Vec::new();
        fstring(&mut directory, "../../../Game/");
        // Root (no name) -> child dir "Content" holding two files.
        directory.extend(2i32.to_le_bytes());
        for value in [NONE, 1, NONE, NONE] {
            directory.extend(value.to_le_bytes());
        }
        for value in [0u32, NONE, NONE, 0] {
            directory.extend(value.to_le_bytes());
        }
        directory.extend(2i32.to_le_bytes());
        for value in [1u32, 1, 0, 2, NONE, 1] {
            directory.extend(value.to_le_bytes());
        }
        directory.extend(3i32.to_le_bytes());
        fstring(&mut directory, "Content");
        fstring(&mut directory, "a.uasset");
        fstring(&mut directory, "b.ubulk");

        let mut toc = TOC_MAGIC.to_vec();
        toc.push(3);
        toc.extend([0u8; 3]);
        toc.extend(144u32.to_le_bytes());
        toc.extend(2u32.to_le_bytes());
        toc.extend(1u32.to_le_bytes());
        toc.extend(12u32.to_le_bytes());
        toc.extend(0u32.to_le_bytes());
        toc.extend(32u32.to_le_bytes());
        toc.extend(65536u32.to_le_bytes());
        toc.extend(u32::try_from(directory.len()).unwrap().to_le_bytes());
        toc.extend(1u32.to_le_bytes());
        toc.extend(0u64.to_le_bytes());
        toc.extend([0u8; 16]);
        toc.push(FLAG_INDEXED);
        toc.extend([0u8; 3]);
        toc.extend(0u32.to_le_bytes());
        toc.extend(u64::MAX.to_le_bytes());
        toc.extend(0u32.to_le_bytes());
        toc.extend(0u32.to_le_bytes());
        toc.extend([0u8; 40]);
        assert_eq!(toc.len(), 144);
        toc.extend([1u8; 12]);
        toc.extend([2u8; 12]);
        let entry = |offset: u64, length: u64| {
            let mut raw = offset.to_be_bytes()[3..].to_vec();
            raw.extend(&length.to_be_bytes()[3..]);
            raw
        };
        toc.extend(entry(0, payload_a.len() as u64));
        toc.extend(entry(payload_a.len() as u64, payload_b.len() as u64));
        let total = ucas.len() as u64;
        let mut block = vec![0u8; 5];
        block.extend(&total.to_le_bytes()[..3]);
        block.extend(&total.to_le_bytes()[..3]);
        block.push(0);
        toc.extend(block);
        toc.extend(&directory);

        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("mod.utoc"), &toc).unwrap();
        std::fs::write(dir.path().join("mod.ucas"), &ucas).unwrap();
        let archive = IoStoreArchive::open(
            &dir.path().join("mod.utoc"),
            "mod.utoc".into(),
            &Keys::default(),
        )
        .unwrap();
        let paths: Vec<&str> = archive.entries().iter().map(|e| e.path.as_str()).collect();
        assert_eq!(paths, ["Game/Content/a.uasset", "Game/Content/b.ubulk"]);
        assert_eq!(archive.read(0).unwrap(), payload_a);
        assert_eq!(archive.read(1).unwrap(), payload_b);
    }
}
