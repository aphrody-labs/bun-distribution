// SPDX-License-Identifier: Apache-2.0
//! ZIP archives (`.zip`, `.pk3`, zip-formatted `.pak`): end of central directory (with ZIP64),
//! central directory, stored and deflated entries. Encrypted entries are listed and refused.

use std::path::Path;

use super::{Archive, ArchiveEntry, decompress};
use crate::game::assets::{
    AssetError, AssetResult, format_err, normalize_path,
    source::{Cursor, FileSource},
};

const FORMAT: &str = "zip";

#[derive(Debug, Clone)]
struct Record {
    method: u16,
    compressed: u64,
    local_offset: u64,
}

/// A mounted ZIP archive.
pub struct ZipArchive {
    label: String,
    source: FileSource,
    records: Vec<Record>,
    entries: Vec<ArchiveEntry>,
}

fn method_name(method: u16) -> String {
    match method {
        0 => String::new(),
        8 => "deflate".into(),
        9 => "deflate64".into(),
        12 => "bzip2".into(),
        14 => "lzma".into(),
        93 => "zstd".into(),
        other => format!("zip-method-{other}"),
    }
}

impl ZipArchive {
    /// Open a ZIP archive.
    ///
    /// # Errors
    /// Missing end-of-central-directory, malformed directory.
    pub fn open(path: &Path, label: String) -> AssetResult<Self> {
        let source = FileSource::open(path)?;
        let tail_len = source.len().min(65_557);
        let tail = source.tail(tail_len)?;
        let eocd = tail
            .windows(4)
            .rposition(|window| window == b"PK\x05\x06")
            .ok_or_else(|| format_err(FORMAT, "no end of central directory"))?;
        let mut cursor = Cursor::at(&tail, eocd + 10, FORMAT);
        let mut count = u64::from(cursor.u16()?);
        let mut size = u64::from(cursor.u32()?);
        let mut offset = u64::from(cursor.u32()?);
        if (count == 0xFFFF || size == 0xFFFF_FFFF || offset == 0xFFFF_FFFF) && eocd >= 20 {
            let mut locator = Cursor::at(&tail, eocd - 20, FORMAT);
            if locator.bytes(4)? == b"PK\x06\x07" {
                locator.u32()?;
                let zip64 = locator.u64()?;
                let record = source.read_at(zip64, 56)?;
                let mut z = Cursor::at(&record, 32, FORMAT);
                count = z.u64()?;
                size = z.u64()?;
                offset = z.u64()?;
            }
        }
        if count > 10_000_000 {
            return Err(format_err(FORMAT, "implausible entry count"));
        }
        let directory = source.read_at(offset, size)?;
        let mut cursor = Cursor::new(&directory, FORMAT);
        let mut records = Vec::new();
        let mut entries = Vec::new();
        for _ in 0..count {
            if cursor.bytes(4)? != b"PK\x01\x02" {
                return Err(format_err(FORMAT, "bad central directory record"));
            }
            cursor.bytes(4)?;
            let flags = cursor.u16()?;
            let method = cursor.u16()?;
            cursor.bytes(8)?;
            let mut compressed = u64::from(cursor.u32()?);
            let mut uncompressed = u64::from(cursor.u32()?);
            let name_len = usize::from(cursor.u16()?);
            let extra_len = usize::from(cursor.u16()?);
            let comment_len = usize::from(cursor.u16()?);
            cursor.bytes(8)?;
            let mut local_offset = u64::from(cursor.u32()?);
            let name = String::from_utf8_lossy(cursor.bytes(name_len)?).into_owned();
            let extra = cursor.bytes(extra_len)?;
            cursor.bytes(comment_len)?;
            let mut x = Cursor::new(extra, FORMAT);
            while x.remaining() >= 4 {
                let id = x.u16()?;
                let len = usize::from(x.u16()?);
                let body = x.bytes(len)?;
                if id == 1 {
                    let mut z = Cursor::new(body, FORMAT);
                    if uncompressed == 0xFFFF_FFFF {
                        uncompressed = z.u64()?;
                    }
                    if compressed == 0xFFFF_FFFF {
                        compressed = z.u64()?;
                    }
                    if local_offset == 0xFFFF_FFFF {
                        local_offset = z.u64()?;
                    }
                }
            }
            if name.ends_with('/') {
                continue;
            }
            entries.push(ArchiveEntry {
                path: normalize_path(&name),
                size: uncompressed,
                stored: compressed,
                compression: method_name(method),
                encrypted: flags & 1 != 0,
            });
            records.push(Record {
                method,
                compressed,
                local_offset,
            });
        }
        Ok(Self {
            label,
            source,
            records,
            entries,
        })
    }
}

impl Archive for ZipArchive {
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
        let entry = &self.entries[index];
        if entry.encrypted {
            return Err(AssetError::KeyRequired(format!(
                "{} ({})",
                self.label, entry.path
            )));
        }
        let local = self.source.read_at(record.local_offset, 30)?;
        if &local[..4] != b"PK\x03\x04" {
            return Err(format_err(FORMAT, "bad local header"));
        }
        let name_len = u64::from(u16::from_le_bytes([local[26], local[27]]));
        let extra_len = u64::from(u16::from_le_bytes([local[28], local[29]]));
        let data = self.source.read_at(
            record.local_offset + 30 + name_len + extra_len,
            record.compressed,
        )?;
        let size = usize::try_from(entry.size).unwrap_or(usize::MAX);
        match record.method {
            0 => Ok(data),
            8 => decompress("deflate", &data, size),
            _ => Err(AssetError::Unsupported(format!(
                "{} compression",
                entry.compression
            ))),
        }
    }
}

#[cfg(test)]
mod tests {
    use std::io::Write;

    use super::*;

    #[test]
    fn reads_stored_and_deflated_entries() {
        let mut deflater =
            flate2::write::DeflateEncoder::new(Vec::new(), flate2::Compression::fast());
        deflater.write_all(b"deflated deflated deflated").unwrap();
        let packed = deflater.finish().unwrap();
        let files: [(&str, u16, Vec<u8>, usize); 2] = [
            ("maps/e1m1.txt", 0, b"stored".to_vec(), 6),
            ("scripts/a.json", 8, packed, 26),
        ];
        let mut zip = Vec::new();
        let mut central = Vec::new();
        for (name, method, data, size) in &files {
            let offset = u32::try_from(zip.len()).unwrap();
            zip.extend(b"PK\x03\x04");
            zip.extend([20, 0, 0, 0]);
            zip.extend(method.to_le_bytes());
            zip.extend([0u8; 8]);
            zip.extend(u32::try_from(data.len()).unwrap().to_le_bytes());
            zip.extend(u32::try_from(*size).unwrap().to_le_bytes());
            zip.extend(u16::try_from(name.len()).unwrap().to_le_bytes());
            zip.extend(0u16.to_le_bytes());
            zip.extend(name.as_bytes());
            zip.extend(data);
            central.extend(b"PK\x01\x02");
            central.extend([20, 0, 20, 0, 0, 0]);
            central.extend(method.to_le_bytes());
            central.extend([0u8; 8]);
            central.extend(u32::try_from(data.len()).unwrap().to_le_bytes());
            central.extend(u32::try_from(*size).unwrap().to_le_bytes());
            central.extend(u16::try_from(name.len()).unwrap().to_le_bytes());
            central.extend([0u8; 12]);
            central.extend(offset.to_le_bytes());
            central.extend(name.as_bytes());
        }
        let central_offset = u32::try_from(zip.len()).unwrap();
        zip.extend(&central);
        zip.extend(b"PK\x05\x06");
        zip.extend([0u8; 4]);
        zip.extend(2u16.to_le_bytes());
        zip.extend(2u16.to_le_bytes());
        zip.extend(u32::try_from(central.len()).unwrap().to_le_bytes());
        zip.extend(central_offset.to_le_bytes());
        zip.extend(0u16.to_le_bytes());

        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("pak0.pk3");
        std::fs::write(&path, &zip).unwrap();
        let archive = ZipArchive::open(&path, "pak0.pk3".into()).unwrap();
        assert_eq!(archive.read(0).unwrap(), b"stored");
        assert_eq!(archive.read(1).unwrap(), b"deflated deflated deflated");
    }
}
