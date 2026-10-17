// SPDX-License-Identifier: Apache-2.0
//! CRI Middleware `CPK ` archives over the canonical `aphrody-nie-formats` reader (`@UTF` header
//! and TOC, table descrambling, CRILAYLA). Only plain `CPK ` headers are mounted here: the
//! generic layer never tries a title's key derivation on another title's archive.

use std::path::Path;

use aphrody_nie_formats::{
    FormatError,
    cpk::{CpkEntry, CpkReader},
};

use super::{Archive, ArchiveEntry};
use crate::game::assets::{AssetError, AssetResult, normalize_path, source::FileSource};

/// A mounted plain CPK.
pub struct CpkArchive {
    label: String,
    source: FileSource,
    reader: CpkReader,
    entries: Vec<ArchiveEntry>,
    /// Indices into `reader.entries` for each listed entry (empty file names are skipped).
    rows: Vec<usize>,
}

fn convert(error: FormatError) -> AssetError {
    AssetError::Format {
        format: "cpk",
        details: error.to_string(),
    }
}

impl CpkArchive {
    /// Open a CPK whose first four bytes are `CPK `.
    ///
    /// # Errors
    /// Encrypted headers ([`AssetError::KeyRequired`]) and malformed tables.
    pub fn open(path: &Path, label: String) -> AssetResult<Self> {
        let source = FileSource::open(path)?;
        if source.read_clamped(0, 4)? != b"CPK " {
            return Err(AssetError::KeyRequired(format!(
                "{label} (CPK header is not `CPK `)"
            )));
        }
        let name = path
            .file_name()
            .map(|name| name.to_string_lossy().into_owned());
        let reader = CpkReader::from_reader(name.as_deref().unwrap_or(""), |offset, size| {
            source
                .read_at(offset, size as u64)
                .map_err(|_| FormatError::TooShort { got: 0, need: size })
        })
        .map_err(convert)?;
        let mut entries = Vec::with_capacity(reader.entries.len());
        let mut rows = Vec::with_capacity(reader.entries.len());
        for (row, entry) in reader.entries.iter().enumerate() {
            if entry.filename.is_empty() {
                continue;
            }
            entries.push(ArchiveEntry {
                path: normalize_path(&join(entry)),
                size: if entry.extract_size == 0 {
                    entry.size
                } else {
                    entry.extract_size
                },
                stored: entry.size,
                compression: if entry.is_compressed {
                    "crilayla".into()
                } else {
                    String::new()
                },
                encrypted: false,
            });
            rows.push(row);
        }
        Ok(Self {
            label,
            source,
            reader,
            entries,
            rows,
        })
    }
}

fn join(entry: &CpkEntry) -> String {
    if entry.directory.is_empty() {
        entry.filename.clone()
    } else {
        format!("{}/{}", entry.directory, entry.filename)
    }
}

impl Archive for CpkArchive {
    fn format(&self) -> &'static str {
        "cpk"
    }
    fn label(&self) -> &str {
        &self.label
    }
    fn entries(&self) -> &[ArchiveEntry] {
        &self.entries
    }
    fn read(&self, index: usize) -> AssetResult<Vec<u8>> {
        let row = *self
            .rows
            .get(index)
            .ok_or_else(|| AssetError::NotFound(format!("{}#{index}", self.label)))?;
        let entry = &self.reader.entries[row];
        self.reader
            .extract_from_reader(entry, |offset, size| {
                self.source
                    .read_at(offset, size as u64)
                    .map_err(|_| FormatError::TooShort { got: 0, need: size })
            })
            .map_err(convert)
    }
    fn info(&self) -> serde_json::Value {
        serde_json::json!({ "entries": self.reader.entries.len() })
    }
}

#[cfg(test)]
mod tests {
    use aphrody_nie_formats::cpk_encode::{CpkWriteEntry, encode_cpk};

    use super::*;

    #[test]
    fn lists_and_reads_a_plain_cpk() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("data.cpk");
        let bytes = encode_cpk(&[
            CpkWriteEntry {
                filename: "a.txt".into(),
                directory: "dir".into(),
                data: b"hello".to_vec(),
            },
            CpkWriteEntry {
                filename: "b.bin".into(),
                directory: String::new(),
                data: vec![7; 9],
            },
        ])
        .unwrap();
        std::fs::write(&path, bytes).unwrap();
        let archive = CpkArchive::open(&path, "data.cpk".into()).unwrap();
        let paths: Vec<&str> = archive.entries().iter().map(|e| e.path.as_str()).collect();
        assert_eq!(paths, ["dir/a.txt", "b.bin"]);
        assert_eq!(archive.read(0).unwrap(), b"hello");
        assert_eq!(archive.read(1).unwrap(), vec![7; 9]);
    }

    #[test]
    fn refuses_a_scrambled_header_without_trying_any_key() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("enc.cpk");
        std::fs::write(&path, [0x55u8; 64]).unwrap();
        assert!(matches!(
            CpkArchive::open(&path, "enc.cpk".into()),
            Err(AssetError::KeyRequired(_))
        ));
    }
}
