// SPDX-License-Identifier: Apache-2.0
//! Passive PE report of the DBXV2 binaries, same shape as the dbxv2 `reverse_report.json`.
//!
//! For `START.exe` and every `bin/*.exe` / `bin/*.dll`: header fields, sections with Shannon
//! entropy, named imports per DLL, exports, `VS_VERSIONINFO` strings and a DRM/packing
//! heuristic (SteamStub `.bind` section or a `.text` entropy of at least 7.5). Read-only: no
//! byte of a binary is modified, unpacked or executed.

use std::{
    fs,
    path::{Path, PathBuf},
};

use serde::Serialize;
use serde_json::{Map, Value};

use crate::game::{ReError, Result};

const ENTROPY_PACKED: f64 = 7.5;
const IMPORTS_PER_DLL: usize = 200;
const EXPORTS_MAX: usize = 500;
const SCN_MEM_EXECUTE: u32 = 0x2000_0000;
const DLL_ASLR: u16 = 0x40;
const DLL_NX: u16 = 0x100;
const RT_VERSION: u32 = 16;

#[derive(Debug, Clone, Serialize)]
pub struct ReverseReport {
    pub target: &'static str,
    pub count: usize,
    pub binaries: Vec<Value>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ReverseSection {
    pub name: String,
    pub vsize: u32,
    #[serde(rename = "rawSize")]
    pub raw_size: u32,
    pub entropy: f64,
    pub exec: bool,
}

struct Section {
    name: String,
    virtual_size: u32,
    virtual_address: u32,
    raw_size: u32,
    raw_pointer: u32,
    characteristics: u32,
}

struct Pe<'a> {
    bytes: &'a [u8],
    sections: Vec<Section>,
    file_alignment: u32,
}

fn malformed(details: impl Into<String>) -> ReError {
    ReError::ParseError { context: "dbxv2_reverse", details: details.into() }
}

fn u16_at(bytes: &[u8], offset: usize) -> Option<u16> {
    Some(u16::from_le_bytes(bytes.get(offset..offset + 2)?.try_into().ok()?))
}

fn u32_at(bytes: &[u8], offset: usize) -> Option<u32> {
    Some(u32::from_le_bytes(bytes.get(offset..offset + 4)?.try_into().ok()?))
}

fn u64_at(bytes: &[u8], offset: usize) -> Option<u64> {
    Some(u64::from_le_bytes(bytes.get(offset..offset + 8)?.try_into().ok()?))
}

fn c_string(bytes: &[u8], offset: usize) -> Option<String> {
    let tail = bytes.get(offset..)?;
    let end = tail.iter().position(|&byte| byte == 0).unwrap_or(tail.len());
    Some(String::from_utf8_lossy(&tail[..end]).into_owned())
}

/// Shannon entropy in bits per byte, summed in byte-value order like `pefile`.
fn entropy(data: &[u8]) -> f64 {
    if data.is_empty() {
        return 0.0;
    }
    let mut counts = [0u64; 256];
    for &byte in data {
        counts[byte as usize] += 1;
    }
    let total = data.len() as f64;
    let mut value = 0.0f64;
    for count in counts {
        if count != 0 {
            let probability = count as f64 / total;
            value -= probability * (probability.ln() / 2f64.ln());
        }
    }
    value
}

/// Python `round(value, 3)`: correctly rounded decimal of the exact binary value.
fn round3(value: f64) -> f64 {
    format!("{value:.3}").parse().unwrap_or(value)
}

impl<'a> Pe<'a> {
    fn rva_to_offset(&self, rva: u32) -> Option<usize> {
        for section in &self.sections {
            let size = section.virtual_size.max(section.raw_size);
            if rva >= section.virtual_address && rva < section.virtual_address.saturating_add(size)
            {
                let pointer = self.adjusted_pointer(section.raw_pointer);
                return Some((pointer + (rva - section.virtual_address)) as usize);
            }
        }
        // Headers are mapped at RVA 0.
        let first = self.sections.iter().map(|section| section.virtual_address).min()?;
        (rva < first).then_some(rva as usize)
    }

    /// `pefile.adjust_FileAlignment`: raw pointers are rounded down to 0x200 once the file
    /// alignment reaches that value.
    fn adjusted_pointer(&self, pointer: u32) -> u32 {
        if self.file_alignment < 0x200 { pointer } else { pointer / 0x200 * 0x200 }
    }

    fn section_data(&self, section: &Section) -> &'a [u8] {
        let start = self.adjusted_pointer(section.raw_pointer) as usize;
        let mut end = start + section.raw_size as usize;
        let raw_end = section.raw_pointer as usize + section.raw_size as usize;
        if end > raw_end && raw_end > start {
            end = raw_end;
        }
        let end = end.min(self.bytes.len());
        self.bytes.get(start..end).unwrap_or(&[])
    }
}

fn data_directory(bytes: &[u8], directories: usize, count: u32, index: u32) -> Option<(u32, u32)> {
    if index >= count {
        return None;
    }
    let base = directories + index as usize * 8;
    let rva = u32_at(bytes, base)?;
    let size = u32_at(bytes, base + 4)?;
    (rva != 0).then_some((rva, size))
}

fn imports(pe: &Pe<'_>, directory: Option<(u32, u32)>, is64: bool) -> Vec<(String, Vec<String>)> {
    let mut result = Vec::new();
    let Some(mut descriptor) = directory.and_then(|(rva, _)| pe.rva_to_offset(rva)) else {
        return result;
    };
    let bytes = pe.bytes;
    while let (Some(lookup), Some(name_rva), Some(iat)) =
        (u32_at(bytes, descriptor), u32_at(bytes, descriptor + 12), u32_at(bytes, descriptor + 16))
    {
        if lookup == 0 && name_rva == 0 && iat == 0 {
            break;
        }
        let dll = pe.rva_to_offset(name_rva).and_then(|offset| c_string(bytes, offset));
        let table = if lookup != 0 { lookup } else { iat };
        let mut names = Vec::new();
        if let (Some(dll), Some(mut thunk)) = (dll, pe.rva_to_offset(table)) {
            loop {
                let (value, ordinal_flag) = if is64 {
                    let Some(value) = u64_at(bytes, thunk) else { break };
                    (value, value & (1 << 63) != 0)
                } else {
                    let Some(value) = u32_at(bytes, thunk) else { break };
                    (u64::from(value), value & (1 << 31) != 0)
                };
                if value == 0 {
                    break;
                }
                if !ordinal_flag
                    && let Some(name) = pe
                        .rva_to_offset((value & 0x7FFF_FFFF) as u32)
                        .and_then(|offset| c_string(bytes, offset + 2))
                    && !name.is_empty()
                {
                    names.push(name);
                }
                thunk += if is64 { 8 } else { 4 };
            }
            result.push((dll, names));
        }
        descriptor += 20;
    }
    result
}

fn exports(pe: &Pe<'_>, directory: Option<(u32, u32)>) -> Vec<String> {
    let Some(base) = directory.and_then(|(rva, _)| pe.rva_to_offset(rva)) else {
        return Vec::new();
    };
    let bytes = pe.bytes;
    let (Some(count), Some(names_rva)) = (u32_at(bytes, base + 24), u32_at(bytes, base + 32)) else {
        return Vec::new();
    };
    let Some(table) = pe.rva_to_offset(names_rva) else {
        return Vec::new();
    };
    (0..count as usize)
        .filter_map(|index| u32_at(bytes, table + index * 4))
        .filter_map(|rva| pe.rva_to_offset(rva).and_then(|offset| c_string(bytes, offset)))
        .filter(|name| !name.is_empty())
        .take(EXPORTS_MAX)
        .collect()
}

/// Locate the raw bytes of the first `RT_VERSION` resource.
fn version_resource<'a>(pe: &Pe<'a>, directory: Option<(u32, u32)>) -> Option<&'a [u8]> {
    let (rva, _) = directory?;
    let root = pe.rva_to_offset(rva)?;
    let bytes = pe.bytes;
    let entries = |table: usize| -> Vec<(u32, u32)> {
        let named = u16_at(bytes, table + 12).unwrap_or(0) as usize;
        let ids = u16_at(bytes, table + 14).unwrap_or(0) as usize;
        (0..named + ids)
            .filter_map(|index| {
                let entry = table + 16 + index * 8;
                Some((u32_at(bytes, entry)?, u32_at(bytes, entry + 4)?))
            })
            .collect()
    };
    let (_, type_target) = entries(root).into_iter().find(|(id, _)| *id == RT_VERSION)?;
    let mut target = type_target;
    // Descend name and language levels to the first data entry.
    for _ in 0..2 {
        if target & 0x8000_0000 == 0 {
            break;
        }
        let table = root + (target & 0x7FFF_FFFF) as usize;
        target = entries(table).first()?.1;
    }
    if target & 0x8000_0000 != 0 {
        return None;
    }
    let data_entry = root + target as usize;
    let data_rva = u32_at(bytes, data_entry)?;
    let size = u32_at(bytes, data_entry + 4)? as usize;
    let offset = pe.rva_to_offset(data_rva)?;
    bytes.get(offset..offset + size)
}

fn utf16_z(bytes: &[u8], offset: usize, limit: usize) -> (String, usize) {
    let mut units = Vec::new();
    let mut cursor = offset;
    while cursor + 1 < limit {
        let unit = u16::from_le_bytes([bytes[cursor], bytes[cursor + 1]]);
        cursor += 2;
        if unit == 0 {
            break;
        }
        units.push(unit);
    }
    (String::from_utf16_lossy(&units), cursor)
}

fn align4(offset: usize) -> usize {
    (offset + 3) & !3
}

/// Walk `VS_VERSIONINFO` and collect every `StringTable` key/value pair in file order.
fn version_strings(resource: &[u8]) -> Map<String, Value> {
    let mut strings = Map::new();
    // Each block: wLength, wValueLength, wType, szKey, padding, value, padding, children.
    fn walk(data: &[u8], start: usize, end: usize, depth: usize, out: &mut Map<String, Value>) {
        let mut cursor = start;
        while cursor + 6 <= end {
            let Some(length) = u16_at(data, cursor).map(usize::from) else { return };
            if length < 6 || cursor + length > end {
                return;
            }
            let value_length = u16_at(data, cursor + 2).map_or(0, usize::from);
            let block_end = cursor + length;
            let (key, after_key) = utf16_z(data, cursor + 6, block_end);
            let value_start = align4(after_key);
            match depth {
                // StringFileInfo / VarFileInfo
                0 if key == "StringFileInfo" => walk(data, value_start, block_end, 1, out),
                // StringTable (language/codepage key)
                1 => walk(data, value_start, block_end, 2, out),
                // String: wValueLength counts UTF-16 units including the terminator.
                2 => {
                    let limit = (value_start + value_length * 2).min(block_end);
                    let (value, _) = utf16_z(data, value_start, limit);
                    out.insert(key, Value::String(value));
                },
                _ => {},
            }
            cursor = align4(block_end);
        }
    }
    let Some(length) = u16_at(resource, 0).map(usize::from) else { return strings };
    let end = length.min(resource.len());
    let value_length = u16_at(resource, 2).map_or(0, usize::from);
    let (key, after_key) = utf16_z(resource, 6, end);
    if key != "VS_VERSION_INFO" {
        return strings;
    }
    let children = align4(align4(after_key) + value_length);
    walk(resource, children, end, 0, &mut strings);
    strings
}

/// Analyse one PE file into the per-binary JSON object of `reverse_report.json`.
pub fn reverse_binary(path: &Path) -> Result<Value> {
    let bytes = fs::read(path)?;
    if bytes.get(..2) != Some(b"MZ".as_slice()) {
        return Err(malformed("missing MZ signature"));
    }
    let pe_offset = u32_at(&bytes, 0x3C).ok_or_else(|| malformed("e_lfanew"))? as usize;
    if bytes.get(pe_offset..pe_offset + 4) != Some(b"PE\0\0".as_slice()) {
        return Err(malformed("missing PE signature"));
    }
    let coff = pe_offset + 4;
    let field16 = |offset: usize| u16_at(&bytes, offset).ok_or_else(|| malformed("header"));
    let field32 = |offset: usize| u32_at(&bytes, offset).ok_or_else(|| malformed("header"));
    let machine = field16(coff)?;
    let section_count = field16(coff + 2)?;
    let timestamp = field32(coff + 4)?;
    let optional_size = field16(coff + 16)? as usize;
    let optional = coff + 20;
    let magic = field16(optional)?;
    let is64 = magic == 0x20B;
    let entry = field32(optional + 16)?;
    let image_base = if is64 {
        u64_at(&bytes, optional + 24).ok_or_else(|| malformed("image base"))?
    } else {
        u64::from(field32(optional + 28)?)
    };
    let file_alignment = field32(optional + 36)?;
    let subsystem = field16(optional + 68)?;
    let dll_characteristics = field16(optional + 70)?;
    let (directory_count, directories) =
        if is64 { (field32(optional + 108)?, optional + 112) } else { (field32(optional + 92)?, optional + 96) };

    let table = optional + optional_size;
    let mut sections = Vec::with_capacity(section_count as usize);
    for index in 0..section_count as usize {
        let row = table + index * 40;
        let Some(raw) = bytes.get(row..row + 40) else { break };
        let name_end = raw[..8].iter().position(|&byte| byte == 0).unwrap_or(8);
        sections.push(Section {
            name: raw[..name_end].iter().map(|&byte| byte as char).collect(),
            virtual_size: u32_at(raw, 8).unwrap_or(0),
            virtual_address: u32_at(raw, 12).unwrap_or(0),
            raw_size: u32_at(raw, 16).unwrap_or(0),
            raw_pointer: u32_at(raw, 20).unwrap_or(0),
            characteristics: u32_at(raw, 36).unwrap_or(0),
        });
    }
    let pe = Pe { bytes: &bytes, sections, file_alignment };

    let section_rows: Vec<ReverseSection> = pe
        .sections
        .iter()
        .map(|section| ReverseSection {
            name: section.name.clone(),
            vsize: section.virtual_size,
            raw_size: section.raw_size,
            entropy: round3(entropy(pe.section_data(section))),
            exec: section.characteristics & SCN_MEM_EXECUTE != 0,
        })
        .collect();

    let import_list = imports(&pe, data_directory(&bytes, directories, directory_count, 1), is64);
    let mut import_map = Map::new();
    let mut imported_dlls = Vec::new();
    let mut import_count = 0usize;
    for (dll, mut names) in import_list {
        names.truncate(IMPORTS_PER_DLL);
        if !import_map.contains_key(&dll) {
            imported_dlls.push(Value::String(dll.clone()));
        }
        import_count = import_count.saturating_sub(
            import_map.get(&dll).and_then(Value::as_array).map_or(0, Vec::len),
        );
        import_count += names.len();
        import_map.insert(dll, Value::from(names));
    }
    let export_list = exports(&pe, data_directory(&bytes, directories, directory_count, 0));
    let version = version_resource(&pe, data_directory(&bytes, directories, directory_count, 2))
        .map(version_strings)
        .unwrap_or_default();

    let drm = if section_rows.iter().any(|section| section.name == ".bind") {
        Some("SteamStub (.bind)".to_owned())
    } else if section_rows
        .iter()
        .any(|section| section.name == ".text" && section.entropy >= ENTROPY_PACKED)
    {
        Some(format!("packed/encrypted .text (entropy>={ENTROPY_PACKED})"))
    } else {
        None
    };

    Ok(serde_json::json!({
        "file": path.file_name().map(|name| name.to_string_lossy()),
        "sizeBytes": bytes.len(),
        "machine": format!("0x{machine:x}"),
        "is64bit": is64,
        "imageBase": format!("0x{image_base:x}"),
        "entryRva": format!("0x{entry:x}"),
        "subsystem": subsystem,
        "timestamp": timestamp,
        "dllCharacteristics": format!("0x{dll_characteristics:x}"),
        "aslr": dll_characteristics & DLL_ASLR != 0,
        "nx": dll_characteristics & DLL_NX != 0,
        "sections": section_rows,
        "importCount": import_count,
        "importedDlls": imported_dlls,
        "imports": import_map,
        "exportCount": export_list.len(),
        "exports": export_list,
        "versionInfo": version,
        "drm": drm,
    }))
}

/// The binaries the dbxv2 `reverse` command inspects, in its order.
pub fn reverse_targets(game: &Path) -> Vec<PathBuf> {
    let mut targets = vec![game.join("START.exe")];
    let bin = game.join("bin");
    for extension in ["exe", "dll"] {
        let mut found: Vec<PathBuf> = fs::read_dir(&bin)
            .into_iter()
            .flatten()
            .flatten()
            .map(|entry| entry.path())
            .filter(|path| path.extension().is_some_and(|value| value.eq_ignore_ascii_case(extension)))
            .collect();
        // Windows path ordering, as `sorted(Path.glob())` on the reference platform.
        found.sort_by_key(|path| path.to_string_lossy().to_lowercase());
        targets.extend(found);
    }
    targets.retain(|path| path.is_file());
    targets
}

/// Analyse every DBXV2 binary; a binary that fails to parse yields an `error` record.
pub fn reverse_install(game: &Path) -> ReverseReport {
    let binaries: Vec<Value> = reverse_targets(game)
        .iter()
        .map(|path| {
            reverse_binary(path).unwrap_or_else(|error| {
                serde_json::json!({
                    "file": path.file_name().map(|name| name.to_string_lossy()),
                    "error": error.to_string(),
                })
            })
        })
        .collect();
    ReverseReport { target: "DBXV2 binaries", count: binaries.len(), binaries }
}

#[cfg(test)]
mod tests {
    use super::{entropy, round3};

    #[test]
    fn entropy_matches_pefile_bounds() {
        assert_eq!(entropy(&[]), 0.0);
        assert_eq!(entropy(&[7; 64]), 0.0);
        let all: Vec<u8> = (0..=255).collect();
        assert_eq!(round3(entropy(&all)), 8.0);
    }
}
