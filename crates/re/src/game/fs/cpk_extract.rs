// SPDX-License-Identifier: Apache-2.0
//! Safe single-entry extraction helper used by the CPK tree command.

use crate::game::error::{ReError, Result};
use crate::game::fs::cpk::CpkEntry;

/// Extract an entry by its parsed table record, including CRILAYLA decompression.
pub fn extract_entry(buffer: &[u8], entry: &CpkEntry) -> Result<Vec<u8>> {
    let start = usize::try_from(entry.file_offset).map_err(|_| ReError::ParseError {
        context: "cpk_extract",
        details: format!("File `{}` offset does not fit in memory", entry.name),
    })?;
    let size = usize::try_from(entry.file_size).map_err(|_| ReError::ParseError {
        context: "cpk_extract",
        details: format!("File `{}` size does not fit in memory", entry.name),
    })?;
    let end = start.checked_add(size).ok_or_else(|| ReError::ParseError {
        context: "cpk_extract",
        details: format!("File `{}` range overflows", entry.name),
    })?;
    if end > buffer.len() {
        return Err(ReError::BufferTooSmall { required: end, available: buffer.len() });
    }

    let bytes = &buffer[start..end];
    if entry.is_compressed || bytes.starts_with(b"CRILAYLA") {
        let decoded = crate::game::fs::crilayla::decompress_crilayla(bytes)?;
        if entry.is_compressed
            && usize::try_from(entry.extract_size).ok().is_some_and(|size| size != decoded.len())
        {
            return Err(ReError::ParseError {
                context: "cpk_extract",
                details: format!(
                    "File `{}` decoded to {} bytes, expected {}",
                    entry.name,
                    decoded.len(),
                    entry.extract_size
                ),
            });
        }
        Ok(decoded)
    } else {
        Ok(bytes.to_vec())
    }
}

#[cfg(test)]
mod tests {
    use super::extract_entry;
    use crate::game::fs::{cpk::CpkEntry, crilayla::compress_crilayla_mock};

    #[test]
    fn extracts_entry_records_and_validates_ranges() {
        let entry = CpkEntry {
            id: 0,
            name: "sample.bin".into(),
            dir_name: None,
            file_size: 4,
            extract_size: 4,
            file_offset: 2,
            is_compressed: false,
        };
        assert_eq!(extract_entry(b"xxdata", &entry).unwrap(), b"data");
        assert!(extract_entry(b"xx", &entry).is_err());
    }

    #[test]
    fn decompresses_crilayla_entries() {
        let original = [vec![0x5a; 0x100], b"safe mock payload".to_vec()].concat();
        let compressed = compress_crilayla_mock(&original);
        let entry = CpkEntry {
            id: 0,
            name: "sample.bin".into(),
            dir_name: None,
            file_size: compressed.len() as u64,
            extract_size: original.len() as u64,
            file_offset: 0,
            is_compressed: true,
        };
        assert_eq!(extract_entry(&compressed, &entry).unwrap(), original);
    }
}
