// SPDX-License-Identifier: Apache-2.0
//! CRIWARE CPK Archive Parser & Virtual File System.
//!
//! Handles CRIWARE CPK archives, parsing of embedded `@UTF` metadata tables (Header, TOC, ETOC),
//! directory hierarchies, and file extraction with transparent CRILAYLA decompression.

use crate::game::error::{ReError, Result};
use crate::game::fs::crilayla::decompress_crilayla;
use std::collections::HashMap;

pub const CPK_MAGIC: &[u8; 4] = b"CPK ";
pub const UTF_MAGIC: &[u8; 4] = b"@UTF";

/// File entry metadata in a CRIWARE CPK archive.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct CpkEntry {
    pub id: u32,
    pub name: String,
    pub dir_name: Option<String>,
    pub file_size: u64,
    pub extract_size: u64,
    pub file_offset: u64,
    pub is_compressed: bool,
}

/// Parsed CRIWARE CPK Virtual Archive.
#[derive(Debug, Clone)]
pub struct CpkArchive {
    pub entries: Vec<CpkEntry>,
    has_utf_table: bool,
    file_map: HashMap<String, usize>,
}

impl CpkArchive {
    /// Returns true if valid CRI `@UTF` schema tables were discovered and parsed.
    pub fn has_utf_table(&self) -> bool {
        self.has_utf_table
    }

    /// Parses a CPK archive from an in-memory buffer.
    pub fn parse(buffer: &[u8]) -> Result<Self> {
        if buffer.len() < 16 {
            return Err(ReError::BufferTooSmall { required: 16, available: buffer.len() });
        }

        if &buffer[0..4] != CPK_MAGIC {
            return Err(ReError::InvalidMagic {
                expected: CPK_MAGIC.to_vec(),
                found: buffer[0..4].to_vec(),
            });
        }

        let mut entries = Vec::new();
        let mut file_map = HashMap::new();
        let mut has_utf_table = false;

        // Search for CPK header @UTF table (usually at offset 16 / 0x10)
        let utf_offset = find_subslice(buffer, UTF_MAGIC);
        if let Some(hdr_utf_pos) = utf_offset {
            has_utf_table = true;
            match parse_utf_table(&buffer[hdr_utf_pos..]) {
                Ok(hdr_table) => {
                    let toc_offset = hdr_table.get_u64("TocOffset").or_else(|| hdr_table.get_u32("TocOffset").map(|v| v as u64));
                    let content_offset = hdr_table.get_u64("ContentOffset").or_else(|| hdr_table.get_u32("ContentOffset").map(|v| v as u64)).unwrap_or(0);

                if let Some(toc_pos) = toc_offset {
                    let toc_pos_usize = toc_pos as usize;
                    if toc_pos_usize < buffer.len() && buffer.len() - toc_pos_usize >= 16 {
                        let toc_slice = &buffer[toc_pos_usize..];
                        if toc_slice.starts_with(UTF_MAGIC)
                            && let Ok(toc_table) = parse_utf_table(toc_slice)
                        {
                                for (i, row) in toc_table.rows.iter().enumerate() {
                                    let name = row.get("FileName").cloned().unwrap_or_else(|| format!("file_{i}"));
                                    let dir_name = row.get("DirName").cloned();
                                    let file_size = row.get("FileSize").and_then(|v| v.parse::<u64>().ok()).unwrap_or(0);
                                    let extract_size = row.get("ExtractSize").and_then(|v| v.parse::<u64>().ok()).unwrap_or(file_size);
                                    let rel_offset = row.get("FileOffset").and_then(|v| v.parse::<u64>().ok()).unwrap_or(0);
                                    let abs_offset = if content_offset > 0 { content_offset + rel_offset } else { rel_offset };
                                    let id = row.get("ID").and_then(|v| v.parse::<u32>().ok()).unwrap_or(i as u32);

                                    let is_compressed = extract_size > file_size;

                                    let entry = CpkEntry {
                                        id,
                                        name: name.clone(),
                                        dir_name,
                                        file_size,
                                        extract_size,
                                        file_offset: abs_offset,
                                        is_compressed,
                                    };
                                    file_map.insert(name.clone(), entries.len());
                                    entries.push(entry);
                                }
                            }
                    }
                }

                // If TOC didn't populate entries, check if header table itself contains files
                if entries.is_empty() {
                    for (i, row) in hdr_table.rows.iter().enumerate() {
                        if let Some(name) = row.get("FileName") {
                            let dir_name = row.get("DirName").cloned();
                            let file_size = row.get("FileSize").and_then(|v| v.parse::<u64>().ok()).unwrap_or(0);
                            let extract_size = row.get("ExtractSize").and_then(|v| v.parse::<u64>().ok()).unwrap_or(file_size);
                            let file_offset = row.get("FileOffset").and_then(|v| v.parse::<u64>().ok()).unwrap_or(0);
                            let id = row.get("ID").and_then(|v| v.parse::<u32>().ok()).unwrap_or(i as u32);
                            let is_compressed = extract_size > file_size;

                            let entry = CpkEntry {
                                id,
                                name: name.clone(),
                                dir_name,
                                file_size,
                                extract_size,
                                file_offset,
                                is_compressed,
                            };
                            file_map.insert(name.clone(), entries.len());
                            entries.push(entry);
                        }
                    }
                }
            }
            Err(e) => {
                println!("hdr_table parse error: {:?}", e);
            }
        }
    }

        // If no file entries were parsed from @UTF tables, keep root fallback
        if entries.is_empty() {
            let entry = CpkEntry {
                id: 0,
                name: "root_table".into(),
                dir_name: None,
                file_size: buffer.len() as u64,
                extract_size: buffer.len() as u64,
                file_offset: 16,
                is_compressed: false,
            };
            file_map.insert(entry.name.clone(), 0);
            entries.push(entry);
        }

        Ok(Self { entries, has_utf_table, file_map })
    }

    /// Extract a file slice zero-copy (if uncompressed) by its internal filename.
    pub fn extract_slice<'a>(&self, buffer: &'a [u8], file_name: &str) -> Result<&'a [u8]> {
        let &idx = self.file_map.get(file_name).ok_or_else(|| ReError::ParseError {
            context: "cpk_extract_slice",
            details: format!("File `{file_name}` not found in archive"),
        })?;

        let entry = &self.entries[idx];
        let start = entry.file_offset as usize;
        let end = start + (entry.file_size as usize);

        if end > buffer.len() {
            return Err(ReError::BufferTooSmall { required: end, available: buffer.len() });
        }

        let slice = &buffer[start..end];
        if entry.is_compressed || (slice.len() >= 8 && &slice[0..8] == b"CRILAYLA") {
            return Err(ReError::ParseError {
                context: "cpk_extract_slice",
                details: format!("File `{file_name}` is CRILAYLA compressed, zero-copy slice not possible"),
            });
        }

        Ok(slice)
    }

    /// Extract a file by its internal path/name, decompressing CRILAYLA if required.
    pub fn extract(&self, buffer: &[u8], file_name: &str) -> Result<Vec<u8>> {
        let &idx = self.file_map.get(file_name).ok_or_else(|| ReError::ParseError {
            context: "cpk_extract",
            details: format!("File `{file_name}` not found in archive"),
        })?;

        let entry = &self.entries[idx];
        let start = entry.file_offset as usize;
        let end = start + (entry.file_size as usize);

        if end > buffer.len() {
            return Err(ReError::BufferTooSmall { required: end, available: buffer.len() });
        }

        let slice = &buffer[start..end];
        if entry.is_compressed || (slice.len() >= 8 && &slice[0..8] == b"CRILAYLA") {
            decompress_crilayla(slice)
        } else {
            Ok(slice.to_vec())
        }
    }

    /// Helper to construct a synthetic valid CPK buffer containing uncompressed or CRILAYLA files.
    pub fn create_mock(files: &[(&str, &[u8])]) -> Vec<u8> {
        let mut buffer = Vec::new();
        buffer.extend_from_slice(CPK_MAGIC);
        // Padding up to 16 bytes
        buffer.extend_from_slice(&[0u8; 12]);

        // Place file contents after header and TOC
        // We will build TOC table first
        let mut toc_rows = Vec::new();
        let mut file_payloads = Vec::new();

        let content_base = 2048; // Content aligned at 2048 bytes
        let mut current_offset = 0u64;

        for (id, &(name, data)) in files.iter().enumerate() {
            let is_crilayla = data.starts_with(b"CRILAYLA");
            let file_size = data.len() as u64;
            let extract_size = if is_crilayla && data.len() >= 12 {
                let uncompressed = u32::from_le_bytes(data[8..12].try_into().unwrap_or([0; 4])) as u64;
                uncompressed + 0x100
            } else {
                file_size
            };

            let mut row = HashMap::new();
            row.insert("FileName".into(), name.into());
            row.insert("FileSize".into(), file_size.to_string());
            row.insert("ExtractSize".into(), extract_size.to_string());
            row.insert("FileOffset".into(), current_offset.to_string());
            row.insert("ID".into(), id.to_string());
            toc_rows.push(row);

            file_payloads.push(data);
            current_offset += file_size;
        }

        let toc_bytes = build_mock_utf_table("CpkToc", &toc_rows);
        let toc_offset = 0x200u64; // TOC placed at 0x200 (512 bytes)

        let mut hdr_rows = Vec::new();
        let mut hdr_row = HashMap::new();
        hdr_row.insert("TocOffset".into(), toc_offset.to_string());
        hdr_row.insert("TocSize".into(), (toc_bytes.len() as u64).to_string());
        hdr_row.insert("ContentOffset".into(), (content_base as u64).to_string());
        hdr_row.insert("Files".into(), (files.len() as u32).to_string());
        hdr_rows.push(hdr_row);

        let hdr_bytes = build_mock_utf_table("CpkHeader", &hdr_rows);

        // Put header table at 0x10 (16)
        if buffer.len() < 16 {
            buffer.resize(16, 0);
        }
        buffer.extend_from_slice(&hdr_bytes);

        // Pad to toc_offset
        if buffer.len() < toc_offset as usize {
            buffer.resize(toc_offset as usize, 0);
        }
        buffer.extend_from_slice(&toc_bytes);

        // Pad to content_base
        if buffer.len() < content_base {
            buffer.resize(content_base, 0);
        }

        // Append file payloads
        for payload in file_payloads {
            buffer.extend_from_slice(payload);
        }

        buffer
    }
}

// -------------------------------------------------------------
// Minimal CRIWARE @UTF Table Parser & Serializer
// -------------------------------------------------------------

#[derive(Debug, Clone)]
struct UtfParsedTable {
    rows: Vec<HashMap<String, String>>,
}

impl UtfParsedTable {
    fn get_u64(&self, key: &str) -> Option<u64> {
        self.rows.first()?.get(key)?.parse().ok()
    }

    fn get_u32(&self, key: &str) -> Option<u32> {
        self.rows.first()?.get(key)?.parse().ok()
    }
}

fn parse_utf_table(data: &[u8]) -> Result<UtfParsedTable> {
    if data.len() < 30 || &data[0..4] != UTF_MAGIC {
        return Err(ReError::InvalidMagic {
            expected: UTF_MAGIC.to_vec(),
            found: data.get(0..4).unwrap_or(&[]).to_vec(),
        });
    }

    let rows_offset = u16::from_be_bytes(data[8..10].try_into().unwrap()) as usize + 8;
    let strings_offset = u32::from_be_bytes(data[10..14].try_into().unwrap()) as usize + 8;
    let _data_offset = u32::from_be_bytes(data[14..18].try_into().unwrap()) as usize + 8;
    let num_columns = u16::from_be_bytes(data[22..24].try_into().unwrap()) as usize;
    let row_length = u16::from_be_bytes(data[24..26].try_into().unwrap()) as usize;
    let num_rows = u32::from_be_bytes(data[26..30].try_into().unwrap()) as usize;

    let strings_pool = if strings_offset < data.len() {
        &data[strings_offset..]
    } else {
        &[]
    };

    let mut cursor = 30;
    let mut columns = Vec::with_capacity(num_columns);

    for _ in 0..num_columns {
        if cursor + 5 > data.len() {
            break;
        }
        let flag = data[cursor];
        cursor += 1;
        let name_str_offset = u32::from_be_bytes(data[cursor..cursor + 4].try_into().unwrap()) as usize;
        cursor += 4;
        let col_name = read_null_terminated_string(strings_pool, name_str_offset);

        let mut const_val = None;
        let type_id = flag & 0x0F;
        if (flag & 0x70) == 0x10 {
            // Constant value stored in column schema
            let (val, read_bytes) = read_utf_value(&data[cursor..], type_id, strings_pool);
            const_val = Some(val);
            cursor += read_bytes;
        }

        columns.push((col_name, flag, type_id, const_val));
    }

    let mut rows = Vec::with_capacity(num_rows);
    let mut row_cursor = rows_offset;

    for _ in 0..num_rows {
        if row_cursor + row_length > data.len() {
            break;
        }
        let row_slice = &data[row_cursor..row_cursor + row_length];
        let mut row_data = HashMap::new();
        let mut col_cursor = 0;

        for (col_name, flag, type_id, const_val) in &columns {
            if let Some(val) = const_val {
                row_data.insert(col_name.clone(), val.clone());
            } else if (*flag & 0x30) != 0 || (*flag & 0x70) != 0 {
                if col_cursor < row_slice.len() {
                    let (val, read_bytes) = read_utf_value(&row_slice[col_cursor..], *type_id, strings_pool);
                    row_data.insert(col_name.clone(), val);
                    col_cursor += read_bytes;
                }
            } else if (*flag & 0x50) != 0 {
                row_data.insert(col_name.clone(), "0".into());
            }
        }

        rows.push(row_data);
        row_cursor += row_length;
    }

    Ok(UtfParsedTable { rows })
}

fn read_null_terminated_string(pool: &[u8], offset: usize) -> String {
    if offset >= pool.len() {
        return String::new();
    }
    let slice = &pool[offset..];
    let end = slice.iter().position(|&b| b == 0).unwrap_or(slice.len());
    String::from_utf8_lossy(&slice[..end]).into_owned()
}

fn read_utf_value(slice: &[u8], type_id: u8, strings_pool: &[u8]) -> (String, usize) {
    match type_id {
        0 => (slice.first().copied().unwrap_or(0).to_string(), 1), // u8
        1 => (slice.first().map(|&b| b as i8).unwrap_or(0).to_string(), 1), // i8
        2 => { // u16
            if slice.len() >= 2 {
                (u16::from_be_bytes(slice[0..2].try_into().unwrap()).to_string(), 2)
            } else {
                ("0".into(), slice.len())
            }
        }
        4 => { // u32
            if slice.len() >= 4 {
                (u32::from_be_bytes(slice[0..4].try_into().unwrap()).to_string(), 4)
            } else {
                ("0".into(), slice.len())
            }
        }
        6 => { // u64
            if slice.len() >= 8 {
                (u64::from_be_bytes(slice[0..8].try_into().unwrap()).to_string(), 8)
            } else {
                ("0".into(), slice.len())
            }
        }
        0x0A => { // String (u32 offset into string pool)
            if slice.len() >= 4 {
                let off = u32::from_be_bytes(slice[0..4].try_into().unwrap()) as usize;
                (read_null_terminated_string(strings_pool, off), 4)
            } else {
                (String::new(), slice.len())
            }
        }
        0x0B => { // Data blob (u32 offset + u32 size)
            (String::new(), 8.min(slice.len()))
        }
        _ => { // Fallback 4 bytes
            ("0".into(), 4.min(slice.len()))
        }
    }
}

fn find_subslice(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    if needle.is_empty() || haystack.len() < needle.len() {
        return None;
    }
    haystack.windows(needle.len()).position(|window| window == needle)
}

fn build_mock_utf_table(table_name: &str, rows: &[HashMap<String, String>]) -> Vec<u8> {
    let mut strings = Vec::new();
    let get_str_offset = |s: &str, strings: &mut Vec<u8>| -> u32 {
        let off = strings.len() as u32;
        strings.extend_from_slice(s.as_bytes());
        strings.push(0);
        off
    };

    let table_name_off = get_str_offset(table_name, &mut strings);

    // Identify unique column names
    let mut col_names = Vec::new();
    if let Some(first_row) = rows.first() {
        for k in first_row.keys() {
            col_names.push(k.clone());
        }
    }
    col_names.sort();

    let mut col_name_offsets = Vec::new();
    for col in &col_names {
        col_name_offsets.push(get_str_offset(col, &mut strings));
    }

    let mut columns_def = Vec::new();
    let mut row_len = 0u16;

    // We store all fields as String (type 0x0A, flag 0x30 = row storage)
    for col_off in col_name_offsets {
        columns_def.push(0x30 | 0x0A); // flag & type
        columns_def.extend_from_slice(&col_off.to_be_bytes());
        row_len += 4;
    }

    let mut rows_bytes = Vec::new();
    for row in rows {
        for col in &col_names {
            let val = row.get(col).map(String::as_str).unwrap_or("");
            let val_off = get_str_offset(val, &mut strings);
            rows_bytes.extend_from_slice(&val_off.to_be_bytes());
        }
    }

    let num_columns = col_names.len() as u16;
    let num_rows = rows.len() as u32;

    let schema_size = columns_def.len();
    let rows_offset = 30 + schema_size;
    let strings_offset = rows_offset + rows_bytes.len();
    let data_offset = strings_offset + strings.len();
    let total_table_size = data_offset;

    let mut out = Vec::new();
    out.extend_from_slice(UTF_MAGIC);
    out.extend_from_slice(&((total_table_size - 8) as u32).to_be_bytes());
    out.extend_from_slice(&((rows_offset - 8) as u16).to_be_bytes());
    out.extend_from_slice(&((strings_offset - 8) as u32).to_be_bytes());
    out.extend_from_slice(&((data_offset - 8) as u32).to_be_bytes());
    out.extend_from_slice(&table_name_off.to_be_bytes());
    out.extend_from_slice(&num_columns.to_be_bytes());
    out.extend_from_slice(&row_len.to_be_bytes());
    out.extend_from_slice(&num_rows.to_be_bytes());
    out.extend_from_slice(&columns_def);
    out.extend_from_slice(&rows_bytes);
    out.extend_from_slice(&strings);

    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_cpk_archive_mock_create_and_extract() {
        let file1_data = b"Goku Super Saiyan Skill Data";
        let file2_data = b"Vegeta Final Flash Animation";

        let mock_cpk = CpkArchive::create_mock(&[
            ("skill_goku.cus", file1_data),
            ("skill_vegeta.bac", file2_data),
        ]);

        let archive = CpkArchive::parse(&mock_cpk).expect("Should parse mock CPK archive");
        assert!(archive.has_utf_table());
        assert_eq!(archive.entries.len(), 2);

        let extracted1 = archive.extract(&mock_cpk, "skill_goku.cus").expect("Extract file1");
        assert_eq!(extracted1, file1_data);

        let extracted2 = archive.extract(&mock_cpk, "skill_vegeta.bac").expect("Extract file2");
        assert_eq!(extracted2, file2_data);

        let slice1 = archive.extract_slice(&mock_cpk, "skill_goku.cus").expect("Zero copy slice");
        assert_eq!(slice1, file1_data);
    }
}
