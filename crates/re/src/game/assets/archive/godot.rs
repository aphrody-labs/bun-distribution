// SPDX-License-Identifier: Apache-2.0
//! Godot `GDPC` packs, format 1 (Godot 3) and 2 (Godot 4), standalone `.pck` files or packs
//! embedded at the end of the game executable. Encrypted directories and files are listed and
//! refused (their key is compiled into the game and is not public).

use std::path::Path;

use super::{Archive, ArchiveEntry};
use crate::game::assets::{
    AssetError, AssetResult, format_err, normalize_path,
    source::{Cursor, FileSource},
};

const FORMAT: &str = "godot-pck";
const DIR_ENCRYPTED: u32 = 1;
const FILE_ENCRYPTED: u32 = 1;

/// Locate a pack in `source`: offset 0 for a `.pck`, or the trailer of an executable
/// (`… <pack> <u64 pack size> GDPC`).
///
/// # Errors
/// I/O errors.
pub fn locate(source: &FileSource) -> AssetResult<Option<u64>> {
    if source.read_clamped(0, 4)? == b"GDPC" {
        return Ok(Some(0));
    }
    let tail = source.tail(12)?;
    if tail.len() == 12 && &tail[8..] == b"GDPC" {
        let size = u64::from_le_bytes(tail[..8].try_into().unwrap_or_default());
        if let Some(start) = source.len().checked_sub(12 + size)
            && source.read_clamped(start, 4)? == b"GDPC"
        {
            return Ok(Some(start));
        }
    }
    Ok(None)
}

/// A mounted Godot pack.
pub struct PckArchive {
    label: String,
    source: FileSource,
    version: (u32, u32, u32, u32),
    ranges: Vec<(u64, u64)>,
    entries: Vec<ArchiveEntry>,
}

impl PckArchive {
    /// Open a `.pck` or an executable with an embedded pack.
    ///
    /// # Errors
    /// No pack, encrypted directory, malformed directory.
    pub fn open(path: &Path, label: String) -> AssetResult<Self> {
        let source = FileSource::open(path)?;
        let base = locate(&source)?.ok_or_else(|| format_err(FORMAT, "no GDPC pack"))?;
        let header = source.read_clamped(base, 1 << 20)?;
        let mut cursor = Cursor::new(&header, FORMAT);
        cursor.bytes(4)?;
        let pack_version = cursor.u32()?;
        let version = (pack_version, cursor.u32()?, cursor.u32()?, cursor.u32()?);
        let (mut flags, mut file_base) = (0u32, 0u64);
        if pack_version >= 2 {
            flags = cursor.u32()?;
            file_base = cursor.u64()?;
        }
        if flags & DIR_ENCRYPTED != 0 {
            return Err(AssetError::KeyRequired(format!("{label} (encrypted Godot directory)")));
        }
        cursor.bytes(16 * 4)?;
        let count = cursor.u32()? as usize;
        // Path records are at most ~1 KiB each: read the directory extent once.
        let extent = (count as u64)
            .saturating_mul(1100)
            .saturating_add(cursor.pos as u64)
            .clamp(1 << 20, 256 << 20)
            .min(source.len() - base);
        let directory = source.read_clamped(base, extent)?;
        let mut probe = Cursor::at(&directory, cursor.pos, FORMAT);
        let mut ranges = Vec::with_capacity(count.min(1 << 20));
        let mut entries = Vec::with_capacity(count.min(1 << 20));
        for _ in 0..count {
            let len = probe.u32()? as usize;
            let raw = probe.bytes(len)?;
            let name =
                String::from_utf8_lossy(raw.split(|b| *b == 0).next().unwrap_or(raw)).into_owned();
            let offset = probe.u64()?;
            let size = probe.u64()?;
            probe.bytes(16)?;
            let file_flags = if pack_version >= 2 { probe.u32()? } else { 0 };
            let stripped = name.strip_prefix("res://").unwrap_or(&name);
            let absolute = if pack_version >= 2 { base + file_base + offset } else { base + offset };
            entries.push(ArchiveEntry {
                path: normalize_path(stripped),
                size,
                stored: size,
                compression: String::new(),
                encrypted: file_flags & FILE_ENCRYPTED != 0,
            });
            ranges.push((absolute, size));
        }
        Ok(Self { label, source, version, ranges, entries })
    }
}

impl Archive for PckArchive {
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
        let entry = self
            .entries
            .get(index)
            .ok_or_else(|| AssetError::NotFound(format!("{}#{index}", self.label)))?;
        if entry.encrypted {
            return Err(AssetError::KeyRequired(format!("{} ({})", self.label, entry.path)));
        }
        let (offset, size) = self.ranges[index];
        self.source.read_at(offset, size)
    }
    fn info(&self) -> serde_json::Value {
        let (pack, major, minor, patch) = self.version;
        serde_json::json!({ "packFormat": pack, "godot": format!("{major}.{minor}.{patch}") })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_a_v2_pack() {
        let body = b"[gd_scene]".to_vec();
        let mut pack = b"GDPC".to_vec();
        for value in [2u32, 4, 2, 1] {
            pack.extend(value.to_le_bytes());
        }
        pack.extend(0u32.to_le_bytes());
        let file_base_at = pack.len();
        pack.extend(0u64.to_le_bytes());
        pack.extend([0u8; 64]);
        pack.extend(1u32.to_le_bytes());
        let name = b"res://scenes/main.tscn\0\0";
        pack.extend(u32::try_from(name.len()).unwrap().to_le_bytes());
        pack.extend(name);
        pack.extend(0u64.to_le_bytes());
        pack.extend((body.len() as u64).to_le_bytes());
        pack.extend([0u8; 16]);
        pack.extend(0u32.to_le_bytes());
        let base = pack.len() as u64;
        pack[file_base_at..file_base_at + 8].copy_from_slice(&base.to_le_bytes());
        pack.extend(&body);

        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("game.pck");
        std::fs::write(&path, &pack).unwrap();
        let archive = PckArchive::open(&path, "game.pck".into()).unwrap();
        assert_eq!(archive.entries()[0].path, "scenes/main.tscn");
        assert_eq!(archive.read(0).unwrap(), body);
    }
}
