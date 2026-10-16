// SPDX-License-Identifier: Apache-2.0
//! Metadata and zero-copy entry access for CRIWARE `#EMB` texture containers.

use std::collections::HashSet;

use serde::Serialize;

use crate::game::{ReError, Result};

pub const EMB_MAGIC: &[u8; 4] = b"#EMB";
const HEADER_SIZE: usize = 32;

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EmbEntry {
    pub name: String,
    pub offset: usize,
    pub size_bytes: usize,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EmbArchive {
    pub entries: Vec<EmbEntry>,
}

impl EmbArchive {
    /// Parse the container and validate every table, name and payload range.
    pub fn parse(bytes: &[u8]) -> Result<Self> {
        if bytes.len() < HEADER_SIZE {
            return Err(ReError::BufferTooSmall { required: HEADER_SIZE, available: bytes.len() });
        }
        if &bytes[..4] != EMB_MAGIC {
            return Err(ReError::InvalidMagic {
                expected: EMB_MAGIC.to_vec(),
                found: bytes[..4].to_vec(),
            });
        }

        let count = read_i32(bytes, 12, "EMB entry count")?;
        let content_table = read_i32(bytes, 24, "EMB content table offset")?;
        let name_table = read_i32(bytes, 28, "EMB name table offset")?;
        if count < 0 || content_table < 0 || name_table < 0 {
            return Err(corrupt("negative count or table offset"));
        }
        let count = count as usize;
        let content_table = content_table as usize;
        let name_table = name_table as usize;
        let table_size =
            count.checked_mul(8).ok_or_else(|| corrupt("entry table size overflow"))?;
        checked_range(bytes, content_table, table_size)?;

        let names = if name_table == 0 {
            None
        } else {
            let name_size =
                count.checked_mul(4).ok_or_else(|| corrupt("name table size overflow"))?;
            checked_range(bytes, name_table, name_size)?;
            Some(name_table)
        };

        let mut entries = Vec::with_capacity(count);
        let mut unique_names = HashSet::with_capacity(count);
        for index in 0..count {
            let record = content_table + index * 8;
            let relative = read_i32(bytes, record, "EMB entry relative offset")?;
            let size = read_i32(bytes, record + 4, "EMB entry size")?;
            if relative < 0 || size < 0 {
                return Err(corrupt(format!("negative offset or size at entry {index}")));
            }
            let offset = record
                .checked_add(relative as usize)
                .ok_or_else(|| corrupt("payload offset overflow"))?;
            let size_bytes = size as usize;
            checked_range(bytes, offset, size_bytes)?;

            let name = if let Some(table) = names {
                let string_offset = read_i32(bytes, table + index * 4, "EMB name offset")?;
                if string_offset < 0 {
                    return Err(corrupt(format!("negative name offset at entry {index}")));
                }
                read_name(bytes, string_offset as usize, index)?
            } else {
                format!("DATA{index}.dds")
            };
            if !is_safe_file_name(&name) {
                return Err(corrupt(format!("unsafe output filename at entry {index}")));
            }
            let name = if has_extension(&name) { name } else { format!("{name}.dds") };
            if !unique_names.insert(name.to_ascii_lowercase()) {
                return Err(corrupt(format!("duplicate output filename: {name}")));
            }
            entries.push(EmbEntry { name, offset, size_bytes });
        }

        Ok(Self { entries })
    }

    /// Borrow one validated entry without copying its payload.
    pub fn entry_bytes<'a>(&self, bytes: &'a [u8], index: usize) -> Result<&'a [u8]> {
        let entry = self.entries.get(index).ok_or_else(|| ReError::ParseError {
            context: "emb_extract",
            details: format!("entry index {index} is out of range"),
        })?;
        let range = checked_range(bytes, entry.offset, entry.size_bytes)?;
        Ok(&bytes[range])
    }
}

fn read_i32(bytes: &[u8], offset: usize, field: &str) -> Result<i32> {
    let range = checked_range(bytes, offset, 4)?;
    let raw = bytes[range].try_into().map_err(|_| corrupt(format!("invalid {field}")))?;
    Ok(i32::from_le_bytes(raw))
}

fn checked_range(bytes: &[u8], offset: usize, length: usize) -> Result<std::ops::Range<usize>> {
    let end = offset.checked_add(length).ok_or_else(|| corrupt("range overflow"))?;
    if end > bytes.len() {
        return Err(ReError::BufferTooSmall { required: end, available: bytes.len() });
    }
    Ok(offset..end)
}

fn read_name(bytes: &[u8], offset: usize, index: usize) -> Result<String> {
    if offset >= bytes.len() {
        return Err(ReError::BufferTooSmall {
            required: offset.saturating_add(1),
            available: bytes.len(),
        });
    }
    let end = bytes[offset..]
        .iter()
        .position(|byte| *byte == 0)
        .map(|length| offset + length)
        .ok_or_else(|| corrupt(format!("unterminated filename at entry {index}")))?;
    let name: String = bytes[offset..end].iter().copied().map(char::from).collect();
    if name.is_empty() { Ok(format!("DATA{index}.dds")) } else { Ok(name) }
}

fn is_safe_file_name(name: &str) -> bool {
    !name.is_empty()
        && name != "."
        && name != ".."
        && !name.contains('/')
        && !name.contains('\\')
        && !name.chars().any(char::is_control)
}

fn has_extension(name: &str) -> bool {
    std::path::Path::new(name).extension().is_some()
}

fn corrupt(details: impl Into<String>) -> ReError {
    ReError::CorruptHeader(format!("EMB: {}", details.into()))
}

#[cfg(test)]
pub(crate) mod tests {
    use super::{EMB_MAGIC, EmbArchive};

    #[cfg_attr(not(feature = "wasm"), allow(dead_code))]
    pub(crate) fn fixture(names: &[(&str, &[u8])]) -> Vec<u8> {
        let (file_names, payloads): (Vec<_>, Vec<_>) = names.iter().copied().unzip();
        mock_emb(&file_names, &payloads)
    }

    fn mock_emb(names: &[&str], payloads: &[&[u8]]) -> Vec<u8> {
        assert_eq!(names.len(), payloads.len());
        let count = names.len();
        let content_table = 32usize;
        let name_table = content_table + count * 8;
        let data_table = name_table + count * 4;
        let payload_size = payloads.iter().map(|payload| payload.len()).sum::<usize>();
        let strings_table = data_table + payload_size;
        let mut bytes = vec![0; data_table];
        bytes[..4].copy_from_slice(EMB_MAGIC);
        bytes[12..16].copy_from_slice(&(count as i32).to_le_bytes());
        bytes[24..28].copy_from_slice(&(content_table as i32).to_le_bytes());
        bytes[28..32].copy_from_slice(&(name_table as i32).to_le_bytes());
        let mut payload_offset = data_table;
        let mut name_offset = strings_table;
        for index in 0..count {
            let record = content_table + index * 8;
            let relative = payload_offset - record;
            bytes[record..record + 4].copy_from_slice(&(relative as i32).to_le_bytes());
            bytes[record + 4..record + 8]
                .copy_from_slice(&(payloads[index].len() as i32).to_le_bytes());
            bytes[name_table + index * 4..name_table + index * 4 + 4]
                .copy_from_slice(&(name_offset as i32).to_le_bytes());
            payload_offset += payloads[index].len();
            name_offset += names[index].len() + 1;
        }
        for payload in payloads {
            bytes.extend_from_slice(payload);
        }
        for name in names {
            bytes.extend_from_slice(name.as_bytes());
            bytes.push(0);
        }
        bytes
    }

    #[test]
    fn parses_named_entries_and_borrows_payloads() {
        let bytes = mock_emb(&["TEX_0", "face.dds"], &[b"dds-a", b"dds-b"]);
        let emb = EmbArchive::parse(&bytes).unwrap();
        assert_eq!(emb.entries[0].name, "TEX_0.dds");
        assert_eq!(emb.entries[1].name, "face.dds");
        assert_eq!(emb.entry_bytes(&bytes, 0).unwrap(), b"dds-a");
        assert_eq!(emb.entry_bytes(&bytes, 1).unwrap(), b"dds-b");
    }

    #[test]
    fn rejects_bad_magic_truncated_ranges_and_unsafe_names() {
        assert!(EmbArchive::parse(b"not an emb").is_err());
        let mut truncated = mock_emb(&["safe"], &[b"data"]);
        truncated.truncate(38);
        assert!(EmbArchive::parse(&truncated).is_err());
        let unsafe_name = mock_emb(&["../escape"], &[b"data"]);
        assert!(EmbArchive::parse(&unsafe_name).is_err());
    }
}
