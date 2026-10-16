// SPDX-License-Identifier: Apache-2.0
//! WebAssembly bindings of the DBXV2 game engine (feature `wasm`), absorbed from `shenron-re`.
//!
//! Exposes CPK archive triage, CRILAYLA decompression, CUS skill decoding,
//! AOB memory scanning, and Dragon Ball game catalog discovery to JS/WASM runtimes.

use crate::game::catalog::get_dragon_ball_catalog;
use crate::game::formats::{
    bac::BacFile, bdm::BdmFile, cus::CusFile, emb_archive::EmbArchive, msg::MsgFile, pup::PupFile,
};
use crate::game::fs::cpk::{CpkArchive, CpkEntry};
use crate::game::fs::crilayla::{decompress_crilayla, decompress_crilayla_raw};
use crate::game::live::aob::AobPattern;
use crate::game::text::extract_msg_text;
use crate::game::world::xenoverse3::xenoverse3_prototype_map;
use serde::{Deserialize, Serialize};
use wasm_bindgen::prelude::*;

/// Summary of a CPK archive inspection in WebAssembly.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CpkTriageSummary {
    pub valid: bool,
    pub total_files: usize,
    pub total_file_size: u64,
    pub has_utf_table: bool,
    pub compression_detected: bool,
    pub entries: Vec<CpkEntry>,
}

fn to_js_err(err: impl std::fmt::Display) -> JsValue {
    JsValue::from_str(&err.to_string())
}

/// Analyze a CRIWARE CPK archive in-memory and return its file table and metadata.
#[wasm_bindgen]
pub fn wasm_triage_cpk(bytes: &[u8]) -> Result<JsValue, JsValue> {
    let archive = CpkArchive::parse(bytes).map_err(to_js_err)?;
    let total_file_size = archive.entries.iter().map(|e| e.file_size).sum();
    let compression_detected = archive.entries.iter().any(|e| e.is_compressed);
    let summary = CpkTriageSummary {
        valid: true,
        total_files: archive.entries.len(),
        total_file_size,
        has_utf_table: archive.has_utf_table(),
        compression_detected,
        entries: archive.entries,
    };
    serde_wasm_bindgen::to_value(&summary).map_err(to_js_err)
}

/// Extract a single file from a CPK archive by name (transparently decompressing CRILAYLA if needed).
#[wasm_bindgen]
pub fn wasm_extract_cpk_file(archive_bytes: &[u8], filename: &str) -> Result<Vec<u8>, JsValue> {
    let archive = CpkArchive::parse(archive_bytes).map_err(to_js_err)?;
    archive.extract(archive_bytes, filename).map_err(to_js_err)
}

/// Decompress a CRILAYLA compressed buffer into raw uncompressed bytes.
#[wasm_bindgen]
pub fn wasm_decompress_crilayla(
    compressed: &[u8],
    uncompressed_size: usize,
) -> Result<Vec<u8>, JsValue> {
    if compressed.starts_with(b"CRILAYLA") {
        decompress_crilayla(compressed).map_err(to_js_err)
    } else if uncompressed_size > 0 {
        decompress_crilayla_raw(compressed, uncompressed_size).map_err(to_js_err)
    } else {
        Err(JsValue::from_str(
            "Invalid CRILAYLA input: missing CRILAYLA magic and uncompressed_size is 0",
        ))
    }
}

/// Parse a DBXV2 CUS (Character Ultimate Skill) binary file and return all skills.
#[wasm_bindgen]
pub fn wasm_parse_cus(cus_bytes: &[u8]) -> Result<JsValue, JsValue> {
    let cus = CusFile::parse(cus_bytes).map_err(to_js_err)?;
    serde_wasm_bindgen::to_value(&cus).map_err(to_js_err)
}

/// Parse a DBXV2 BAC (Battle Action Code) moveset binary file and return all moves.
#[wasm_bindgen]
pub fn wasm_parse_bac(bac_bytes: &[u8]) -> Result<JsValue, JsValue> {
    let bac = BacFile::parse(bac_bytes).map_err(to_js_err)?;
    serde_wasm_bindgen::to_value(&bac).map_err(to_js_err)
}

/// Parse a DBXV2 BDM (Battle Damage Matrix) binary file and return all damage definitions.
#[wasm_bindgen]
pub fn wasm_parse_bdm(bdm_bytes: &[u8]) -> Result<JsValue, JsValue> {
    let bdm = BdmFile::parse(bdm_bytes).map_err(to_js_err)?;
    serde_wasm_bindgen::to_value(&bdm).map_err(to_js_err)
}

/// Parse a DBXV2 PUP (Power-Up Parameters) binary file and return transformation multipliers.
#[wasm_bindgen]
pub fn wasm_parse_pup(pup_bytes: &[u8]) -> Result<JsValue, JsValue> {
    let pup = PupFile::parse(pup_bytes).map_err(to_js_err)?;
    serde_wasm_bindgen::to_value(&pup).map_err(to_js_err)
}

/// Parse a DBXV2 MSG (Message) binary file and return localized text strings.
#[wasm_bindgen]
pub fn wasm_parse_msg(msg_bytes: &[u8]) -> Result<JsValue, JsValue> {
    let msg = MsgFile::parse(msg_bytes).map_err(to_js_err)?;
    serde_wasm_bindgen::to_value(&msg).map_err(to_js_err)
}

/// Validate a DBXV2 EMB texture archive and return its entry names and byte ranges.
#[wasm_bindgen]
pub fn wasm_parse_emb(emb_bytes: &[u8]) -> Result<JsValue, JsValue> {
    let emb = EmbArchive::parse(emb_bytes).map_err(to_js_err)?;
    serde_wasm_bindgen::to_value(&emb).map_err(to_js_err)
}

/// Extract printable UTF-16LE text runs from one MSG buffer without parsing its table layout.
#[wasm_bindgen]
pub fn wasm_extract_msg_text(file_name: &str, msg_bytes: &[u8]) -> Result<JsValue, JsValue> {
    let report = extract_msg_text(std::path::Path::new(file_name), msg_bytes);
    serde_wasm_bindgen::to_value(&report).map_err(to_js_err)
}

/// Scan a buffer for an Array-of-Bytes (AOB) pattern with wildcards (e.g. "48 89 5C 24 ??").
#[wasm_bindgen]
pub fn wasm_scan_aob(data: &[u8], pattern: &str) -> Result<Vec<usize>, JsValue> {
    let aob = AobPattern::parse(pattern).map_err(to_js_err)?;
    Ok(aob.scan_all(data, usize::MAX))
}

/// Retrieve the full Dragon Ball game catalog (Steam + Android) as a JavaScript object.
#[wasm_bindgen]
pub fn wasm_get_dragon_ball_catalog() -> Result<JsValue, JsValue> {
    let catalog = get_dragon_ball_catalog();
    serde_wasm_bindgen::to_value(&catalog).map_err(to_js_err)
}

/// Retrieve the source-attributed Xenoverse 3 prototype world map as JavaScript data.
/// Announced places and original prototype geometry are distinguished in each record.
#[wasm_bindgen]
pub fn wasm_get_xenoverse3_prototype_map() -> Result<JsValue, JsValue> {
    let map = xenoverse3_prototype_map();
    serde_wasm_bindgen::to_value(&map).map_err(to_js_err)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_wasm_scan_aob_direct() {
        let buffer = [0x90, 0x48, 0x89, 0x5C, 0x24, 0x20, 0xC3];
        let offsets = wasm_scan_aob(&buffer, "48 89 ?? 24").unwrap();
        assert_eq!(offsets, vec![1]);
    }

    #[test]
    fn test_wasm_catalog_direct() {
        let cat = get_dragon_ball_catalog();
        assert!(cat.len() >= 10);
    }

    #[test]
    fn test_wasm_parse_bdm_direct() {
        let mock = BdmFile::create_mock(5);
        let parsed = BdmFile::parse(&mock).unwrap();
        assert_eq!(parsed.entries.len(), 5);
        assert_eq!(parsed.entries[0].id, 100);
    }

    #[test]
    fn test_wasm_prototype_map_direct() {
        let map = xenoverse3_prototype_map();
        assert_eq!(map.era, "AGE 1000");
        assert!(map.zones.iter().any(|zone| zone.id == "glacier-expedition"));
    }

    #[test]
    fn test_wasm_parse_emb_direct() {
        let bytes = crate::game::formats::emb_archive::tests::fixture(&[("texture.dds", b"DDS!")]);
        let parsed = EmbArchive::parse(&bytes).unwrap();
        assert_eq!(parsed.entries.len(), 1);
        assert_eq!(parsed.entries[0].name, "texture.dds");
        assert_eq!(parsed.entries[0].size_bytes, 4);
    }
}
