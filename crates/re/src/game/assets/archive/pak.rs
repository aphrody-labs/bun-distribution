// SPDX-License-Identifier: Apache-2.0
//! Unreal Engine `.pak` archives, versions 1 to 11: footer, legacy index (v1-v9), path-hash and
//! full-directory index with encoded entries (v10+), stored, Zlib, Gzip and LZ4 entries.
//! Encrypted indexes and entries need a user-provided AES-256 key; Oodle and Zstd payloads are
//! listed and refused (proprietary or not linked).

use std::path::Path;

use super::{Archive, ArchiveEntry, aes256_ecb_decrypt, align_up, decompress};
use crate::game::assets::{
    AssetError, AssetResult, Keys, format_err, normalize_path,
    source::{Cursor, FileSource},
};

const MAGIC: u32 = 0x5A6F_12E1;
const FORMAT: &str = "unreal-pak";
/// Legacy compression flags of versions < 8.
const LEGACY_ZLIB: u32 = 0x01;
const LEGACY_GZIP: u32 = 0x02;
const LEGACY_CUSTOM: u32 = 0x04;

/// Parsed footer.
#[derive(Debug, Clone)]
pub struct PakFooter {
    /// Pak version (1-11).
    pub version: u32,
    /// True when the index is AES-encrypted.
    pub encrypted_index: bool,
    /// Index offset in the file.
    pub index_offset: u64,
    /// Index size in bytes.
    pub index_size: u64,
    /// Compression method names (index 1-based in entries).
    pub methods: Vec<String>,
    /// True for the 4-name v8 footer (entries store the method as a byte).
    pub method_byte: bool,
}

/// Probe the footer of a `.pak` (`None` when the file is not an Unreal pak).
///
/// # Errors
/// I/O errors.
pub fn probe(source: &FileSource) -> AssetResult<Option<PakFooter>> {
    let tail = source.tail(256)?;
    // (footer size, magic offset inside the footer).
    for (size, magic_at) in [(222usize, 17usize), (221, 17), (189, 17), (61, 17), (45, 1), (44, 0)] {
        if tail.len() < size {
            continue;
        }
        let footer = &tail[tail.len() - size..];
        let mut cursor = Cursor::at(footer, magic_at, FORMAT);
        if cursor.u32()? != MAGIC {
            continue;
        }
        let version = cursor.u32()?;
        let expected = match version {
            1..=3 => 44,
            4..=6 => 45,
            7 => 61,
            8 => {
                if size == 189 {
                    189
                } else {
                    221
                }
            },
            9 => 222,
            10.. => 221,
            _ => 0,
        };
        if expected != size {
            continue;
        }
        let index_offset = cursor.u64()?;
        let index_size = cursor.u64()?;
        cursor.bytes(20)?;
        if version == 9 {
            cursor.u8()?;
        }
        let mut methods = Vec::new();
        if size >= 189 {
            let count = if size == 189 { 4 } else { 5 };
            for _ in 0..count {
                let raw = cursor.bytes(32)?;
                let name = raw.split(|byte| *byte == 0).next().unwrap_or_default();
                methods.push(String::from_utf8_lossy(name).into_owned());
            }
        }
        while methods.last().is_some_and(String::is_empty) {
            methods.pop();
        }
        let encrypted_index = magic_at > 0 && footer[magic_at - 1] != 0;
        return Ok(Some(PakFooter {
            version,
            encrypted_index,
            index_offset,
            index_size,
            methods,
            method_byte: size == 189,
        }));
    }
    Ok(None)
}

#[derive(Debug, Clone)]
struct PakRecord {
    offset: u64,
    size: u64,
    uncompressed: u64,
    method: u32,
    blocks: Vec<(u64, u64)>,
    block_size: u32,
    encrypted: bool,
    /// Serialized size of the entry header that precedes the payload.
    header: u64,
}

/// A mounted Unreal pak.
pub struct PakArchive {
    label: String,
    source: FileSource,
    footer: PakFooter,
    mount_point: String,
    key: Option<[u8; 32]>,
    entries: Vec<ArchiveEntry>,
    records: Vec<PakRecord>,
}

fn legacy_header_size(version: u32, method_byte: bool, method: u32, blocks: usize) -> u64 {
    let method_field = if version == 8 && method_byte { 1 } else { 4 };
    let timestamp = if version <= 1 { 8 } else { 0 };
    let tail = if version >= 3 {
        (if method == 0 { 0 } else { 4 + 16 * blocks as u64 }) + 1 + 4
    } else {
        0
    };
    24 + method_field + timestamp + 20 + tail
}

fn read_legacy_entry(cursor: &mut Cursor<'_>, footer: &PakFooter) -> AssetResult<PakRecord> {
    let offset = cursor.u64()?;
    let size = cursor.u64()?;
    let uncompressed = cursor.u64()?;
    let method = if footer.version < 8 {
        let flags = cursor.u32()?;
        if flags & LEGACY_ZLIB != 0 {
            1
        } else if flags & LEGACY_GZIP != 0 {
            2
        } else if flags & LEGACY_CUSTOM != 0 {
            3
        } else {
            0
        }
    } else if footer.version == 8 && footer.method_byte {
        u32::from(cursor.u8()?)
    } else {
        cursor.u32()?
    };
    if footer.version <= 1 {
        cursor.u64()?;
    }
    cursor.bytes(20)?;
    let mut blocks = Vec::new();
    let mut encrypted = false;
    let mut block_size = 0;
    if footer.version >= 3 {
        if method != 0 {
            let count = usize::try_from(cursor.i32()?.max(0)).unwrap_or(0);
            if count > 1 << 20 {
                return Err(format_err(FORMAT, "implausible compression block count"));
            }
            for _ in 0..count {
                let start = cursor.u64()?;
                let end = cursor.u64()?;
                blocks.push((start, end));
            }
        }
        encrypted = cursor.u8()? & 1 != 0;
        block_size = cursor.u32()?;
    }
    let header = legacy_header_size(footer.version, footer.method_byte, method, blocks.len());
    Ok(PakRecord { offset, size, uncompressed, method, blocks, block_size, encrypted, header })
}

/// Decode one v10+ encoded entry (`FPakFile::DecodePakEntry`).
fn decode_entry(encoded: &[u8], at: usize) -> AssetResult<PakRecord> {
    let mut cursor = Cursor::at(encoded, at, FORMAT);
    let value = cursor.u32()?;
    let block_size = if value & 0x3f == 0x3f { cursor.u32()? } else { (value & 0x3f) << 11 };
    let count = ((value >> 6) & 0xffff) as usize;
    let encrypted = value & (1 << 22) != 0;
    let method = (value >> 23) & 0x3f;
    let offset = if value & (1 << 31) != 0 { u64::from(cursor.u32()?) } else { cursor.u64()? };
    let uncompressed =
        if value & (1 << 30) != 0 { u64::from(cursor.u32()?) } else { cursor.u64()? };
    let size = if method != 0 {
        if value & (1 << 29) != 0 { u64::from(cursor.u32()?) } else { cursor.u64()? }
    } else {
        uncompressed
    };
    let header = 53 + if method != 0 { 4 + 16 * count as u64 } else { 0 };
    let mut blocks = Vec::with_capacity(count);
    if count > 0 {
        if count == 1 && !encrypted {
            blocks.push((header, header + size));
        } else {
            let mut start = header;
            for _ in 0..count {
                let len = u64::from(cursor.u32()?);
                blocks.push((start, start + len));
                start += if encrypted { align_up(len, 16) } else { len };
            }
        }
    }
    Ok(PakRecord { offset, size, uncompressed, method, blocks, block_size, encrypted, header })
}

impl PakArchive {
    /// Open an Unreal pak.
    ///
    /// # Errors
    /// Not a pak, encrypted index without key, malformed index.
    pub fn open(path: &Path, label: String, keys: &Keys) -> AssetResult<Self> {
        let source = FileSource::open(path)?;
        let footer = probe(&source)?
            .ok_or_else(|| format_err(FORMAT, format!("{label}: no pak footer")))?;
        if footer.encrypted_index && keys.aes.is_none() {
            return Err(AssetError::KeyRequired(format!("{label} (encrypted pak index)")));
        }
        let mut index = source.read_at(footer.index_offset, footer.index_size)?;
        if footer.encrypted_index
            && let Some(key) = &keys.aes
        {
            aes256_ecb_decrypt(key, &mut index)?;
        }
        let mut archive = Self {
            label,
            source,
            mount_point: String::new(),
            key: keys.aes,
            entries: Vec::new(),
            records: Vec::new(),
            footer,
        };
        if archive.footer.version >= 10 {
            archive.read_index_v10(&index)?;
        } else {
            archive.read_index_legacy(&index)?;
        }
        Ok(archive)
    }

    fn method_name(&self, method: u32) -> String {
        if method == 0 {
            return String::new();
        }
        if self.footer.version < 8 {
            return match method {
                1 => "zlib",
                2 => "gzip",
                _ => "custom",
            }
            .to_string();
        }
        self.footer
            .methods
            .get(method as usize - 1)
            .cloned()
            .unwrap_or_else(|| format!("method#{method}"))
    }

    fn push(&mut self, path: &str, record: PakRecord) {
        let full = normalize_path(&format!("{}{path}", self.mount_point));
        self.entries.push(ArchiveEntry {
            path: full,
            size: record.uncompressed,
            stored: record.size,
            compression: self.method_name(record.method),
            encrypted: record.encrypted,
        });
        self.records.push(record);
    }

    fn read_index_legacy(&mut self, index: &[u8]) -> AssetResult<()> {
        let mut cursor = Cursor::new(index, FORMAT);
        self.mount_point = cursor.fstring()?;
        let count = cursor.i32()?;
        if !(0..=5_000_000).contains(&count) {
            return Err(format_err(FORMAT, format!("implausible entry count {count}")));
        }
        for _ in 0..count {
            let name = cursor.fstring()?;
            let record = read_legacy_entry(&mut cursor, &self.footer)?;
            self.push(&name, record);
        }
        Ok(())
    }

    fn read_index_v10(&mut self, index: &[u8]) -> AssetResult<()> {
        let mut cursor = Cursor::new(index, FORMAT);
        self.mount_point = cursor.fstring()?;
        let _count = cursor.i32()?;
        let _seed = cursor.u64()?;
        if cursor.u32()? != 0 {
            cursor.bytes(8 + 8 + 20)?;
        }
        let full_directory = if cursor.u32()? != 0 {
            let offset = cursor.u64()?;
            let size = cursor.u64()?;
            cursor.bytes(20)?;
            Some((offset, size))
        } else {
            None
        };
        let encoded_len = usize::try_from(cursor.i32()?.max(0)).unwrap_or(0);
        let encoded = cursor.bytes(encoded_len)?.to_vec();
        let files = usize::try_from(cursor.i32()?.max(0)).unwrap_or(0);
        let mut unencoded = Vec::with_capacity(files.min(1 << 20));
        for _ in 0..files {
            unencoded.push(read_legacy_entry(&mut cursor, &self.footer)?);
        }
        let Some((offset, size)) = full_directory else {
            return Err(AssetError::Unsupported(format!(
                "{}: pak without a full directory index (names stripped)",
                self.label
            )));
        };
        let mut directory = self.source.read_at(offset, size)?;
        if self.footer.encrypted_index
            && let Some(key) = &self.key
        {
            aes256_ecb_decrypt(key, &mut directory)?;
        }
        let mut cursor = Cursor::new(&directory, FORMAT);
        let dirs = cursor.i32()?;
        for _ in 0..dirs.max(0) {
            let dir = cursor.fstring()?;
            let count = cursor.i32()?;
            for _ in 0..count.max(0) {
                let name = cursor.fstring()?;
                let location = cursor.i32()?;
                let record = if location >= 0 {
                    decode_entry(&encoded, usize::try_from(location).unwrap_or(usize::MAX))?
                } else {
                    let slot = usize::try_from(-(i64::from(location) + 1)).unwrap_or(usize::MAX);
                    unencoded
                        .get(slot)
                        .cloned()
                        .ok_or_else(|| format_err(FORMAT, "entry location out of range"))?
                };
                let dir = dir.trim_start_matches('/');
                self.push(&format!("{dir}{name}"), record);
            }
        }
        Ok(())
    }

    fn decrypt(&self, data: &mut [u8]) -> AssetResult<()> {
        let key = self.key.as_ref().ok_or_else(|| {
            AssetError::KeyRequired(format!("{} (encrypted pak entry)", self.label))
        })?;
        aes256_ecb_decrypt(key, data)
    }
}

impl Archive for PakArchive {
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
        let record = self
            .records
            .get(index)
            .ok_or_else(|| AssetError::NotFound(format!("{}#{index}", self.label)))?;
        let method = self.method_name(record.method);
        if record.method == 0 {
            let start = record.offset + record.header;
            let stored = if record.encrypted { align_up(record.size, 16) } else { record.size };
            let mut data = self.source.read_at(start, stored)?;
            if record.encrypted {
                self.decrypt(&mut data)?;
            }
            data.truncate(usize::try_from(record.size).unwrap_or(usize::MAX));
            return Ok(data);
        }
        let mut out = Vec::with_capacity(usize::try_from(record.uncompressed).unwrap_or(0));
        let block_size = u64::from(record.block_size.max(1));
        for (start, end) in &record.blocks {
            let (start, end) = if self.footer.version >= 5 {
                (record.offset + start, record.offset + end)
            } else {
                (*start, *end)
            };
            let len = end.saturating_sub(start);
            let stored = if record.encrypted { align_up(len, 16) } else { len };
            let mut block = self.source.read_at(start, stored)?;
            if record.encrypted {
                self.decrypt(&mut block)?;
            }
            block.truncate(usize::try_from(len).unwrap_or(usize::MAX));
            let remaining = record.uncompressed - out.len() as u64;
            let expected = usize::try_from(remaining.min(block_size)).unwrap_or(0);
            out.extend(decompress(&method, &block, expected)?);
        }
        Ok(out)
    }
    fn info(&self) -> serde_json::Value {
        serde_json::json!({
            "version": self.footer.version,
            "mountPoint": self.mount_point,
            "encryptedIndex": self.footer.encrypted_index,
            "methods": self.footer.methods,
        })
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    fn fstring(out: &mut Vec<u8>, text: &str) {
        out.extend_from_slice(&i32::try_from(text.len() + 1).unwrap().to_le_bytes());
        out.extend_from_slice(text.as_bytes());
        out.push(0);
    }

    /// A version-11 pak with one stored entry and one Zlib entry, full directory index.
    pub(crate) fn sample_pak() -> Vec<u8> {
        use std::io::Write;
        let plain = b"plain bytes".to_vec();
        let packed_source = b"zlib zlib zlib zlib".to_vec();
        let mut encoder = flate2::write::ZlibEncoder::new(Vec::new(), flate2::Compression::fast());
        encoder.write_all(&packed_source).unwrap();
        let packed = encoder.finish().unwrap();

        let mut file = Vec::new();
        // Entry 0: stored, header 53 bytes then payload.
        let offset0 = file.len() as u64;
        file.extend(vec![0u8; 53]);
        file.extend(&plain);
        // Entry 1: zlib, one block, header 53 + 4 + 16.
        let offset1 = file.len() as u64;
        file.extend(vec![0u8; 73]);
        file.extend(&packed);

        let mut encoded = Vec::new();
        // Stored: offset/size 32-bit safe, block size 0, no blocks, method 0.
        let flags0: u32 = (1 << 31) | (1 << 30) | (1 << 29);
        encoded.extend(flags0.to_le_bytes());
        encoded.extend(u32::try_from(offset0).unwrap().to_le_bytes());
        encoded.extend(u32::try_from(plain.len()).unwrap().to_le_bytes());
        let at1 = encoded.len();
        let flags1: u32 = (1 << 31) | (1 << 30) | (1 << 29) | (1 << 23) | (1 << 6) | 0x20;
        encoded.extend(flags1.to_le_bytes());
        encoded.extend(u32::try_from(offset1).unwrap().to_le_bytes());
        encoded.extend(u32::try_from(packed_source.len()).unwrap().to_le_bytes());
        encoded.extend(u32::try_from(packed.len()).unwrap().to_le_bytes());

        let mut directory = Vec::new();
        directory.extend(1i32.to_le_bytes());
        fstring(&mut directory, "/Content/");
        directory.extend(2i32.to_le_bytes());
        fstring(&mut directory, "plain.txt");
        directory.extend(0i32.to_le_bytes());
        fstring(&mut directory, "packed.bin");
        directory.extend(i32::try_from(at1).unwrap().to_le_bytes());
        let directory_offset = file.len() as u64;
        file.extend(&directory);

        let mut index = Vec::new();
        fstring(&mut index, "../../../Game/");
        index.extend(2i32.to_le_bytes());
        index.extend(0u64.to_le_bytes());
        index.extend(0u32.to_le_bytes());
        index.extend(1u32.to_le_bytes());
        index.extend(directory_offset.to_le_bytes());
        index.extend((directory.len() as u64).to_le_bytes());
        index.extend([0u8; 20]);
        index.extend(i32::try_from(encoded.len()).unwrap().to_le_bytes());
        index.extend(&encoded);
        index.extend(0i32.to_le_bytes());
        let index_offset = file.len() as u64;
        file.extend(&index);

        file.extend([0u8; 16]);
        file.push(0);
        file.extend(MAGIC.to_le_bytes());
        file.extend(11u32.to_le_bytes());
        file.extend(index_offset.to_le_bytes());
        file.extend((index.len() as u64).to_le_bytes());
        file.extend([0u8; 20]);
        let mut names = [0u8; 160];
        names[..4].copy_from_slice(b"Zlib");
        file.extend(names);
        file
    }

    #[test]
    fn reads_a_v11_pak_with_full_directory_index() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("Game-Windows.pak");
        std::fs::write(&path, sample_pak()).unwrap();
        let archive = PakArchive::open(&path, "Game-Windows.pak".into(), &Keys::default()).unwrap();
        let paths: Vec<&str> = archive.entries().iter().map(|e| e.path.as_str()).collect();
        assert_eq!(paths, ["Game/Content/plain.txt", "Game/Content/packed.bin"]);
        assert_eq!(archive.read(0).unwrap(), b"plain bytes");
        assert_eq!(archive.read(1).unwrap(), b"zlib zlib zlib zlib");
        assert_eq!(archive.entries()[1].compression, "Zlib");
    }
}
