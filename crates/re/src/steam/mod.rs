// SPDX-License-Identifier: Apache-2.0
//! Steam DRM and SteamStub wrapper detection over raw executable bytes: `.bind` / `.steam`
//! sections, entry point inside `.bind`, Shannon entropy of an encrypted `.text`, and
//! `steam_api*.dll` / `libsteam_api.so` dependency and Steamworks symbol scans.
//!
//! Steam installs, libraries, VDF, client configuration, Proton and depot acquisition belong to
//! the `bun-steam` crate (`bun_steam`).

use serde::{Deserialize, Serialize};

/// Forensic assessment report for Steam DRM and SteamStub protection.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SteamDrmReport {
    /// Binary format classified by goblin (e.g. `"PE32+"`, `"PE32"`, `"ELF64"`, `"Unknown"`).
    pub format: String,
    /// High-confidence detection of the SteamStub executable wrapper.
    pub is_steamstub_detected: bool,
    /// Presence of the `.bind` section (characteristic SteamStub entry vector).
    pub has_bind_section: bool,
    /// Presence of the `.steam` section (legacy SteamStub / DRM marker).
    pub has_steam_section: bool,
    /// Whether the binary entry point RVA falls directly inside the `.bind` section.
    pub entry_point_in_bind: bool,
    /// Relative Virtual Address (RVA) of `.bind` section if present.
    pub bind_section_rva: Option<u64>,
    /// Virtual size of `.bind` section in bytes.
    pub bind_section_size: Option<u64>,
    /// Shannon entropy of the primary executable `.text` code section.
    pub text_entropy: Option<f64>,
    /// Whether `.text` exhibits abnormally high entropy (> 7.2), indicating encrypted/compressed payload.
    pub is_text_encrypted: bool,
    /// Whether the binary imports Steamworks API (`steam_api.dll`, `steam_api64.dll`, `libsteam_api.so`).
    pub steam_api_dependency: bool,
    /// Specific Steam API library name detected in imports.
    pub steam_api_library: Option<String>,
    /// Detected Steamworks API function symbols (e.g. `SteamAPI_Init`, `SteamAPI_RestartAppIfNecessary`).
    pub steamworks_symbols: Vec<String>,
    /// Human-readable diagnostic assessment summary.
    pub summary: String,
}

/// Known Steamworks API function signatures scanned in import tables and string pools.
const STEAMWORKS_API_SYMBOLS: &[&str] = &[
    "SteamAPI_Init",
    "SteamAPI_InitFlat",
    "SteamAPI_RestartAppIfNecessary",
    "SteamAPI_Shutdown",
    "SteamAPI_RunCallbacks",
    "SteamAPI_RegisterCallback",
    "SteamAPI_UnregisterCallback",
    "SteamInternal_CreateInterface",
    "SteamGameServer_Init",
    "SteamGameServer_Shutdown",
];

/// Known Steamworks DLL and SO library file names.
const STEAM_API_LIBRARIES: &[&str] = &[
    "steam_api.dll",
    "steam_api64.dll",
    "libsteam_api.so",
    "libsteam_api.dylib",
];

/// Inspect executable binary bytes for Steam DRM, SteamStub wrapper sections, and Steamworks API hooks.
pub fn inspect_steam_drm(bytes: &[u8]) -> SteamDrmReport {
    let mut format = "Unknown".to_string();
    let mut has_bind_section = false;
    let mut has_steam_section = false;
    let mut entry_point_in_bind = false;
    let mut bind_section_rva = None;
    let mut bind_section_size = None;
    let mut text_entropy = None;
    let mut steam_api_dependency = false;
    let mut steam_api_library = None;
    let mut steamworks_symbols = Vec::new();

    // Parse with goblin PE / ELF
    if let Ok(pe) = goblin::pe::PE::parse(bytes) {
        format = if pe.is_64 {
            "PE32+".to_string()
        } else {
            "PE32".to_string()
        };

        let entry_point = pe.entry as u64;

        // Inspect sections
        for section in &pe.sections {
            let name = section.name().unwrap_or_default();
            let sec_rva = section.virtual_address as u64;
            let sec_size = section.virtual_size as u64;

            if name == ".bind" {
                has_bind_section = true;
                bind_section_rva = Some(sec_rva);
                bind_section_size = Some(sec_size);

                if entry_point >= sec_rva && entry_point < sec_rva.saturating_add(sec_size) {
                    entry_point_in_bind = true;
                }
            } else if name == ".steam" {
                has_steam_section = true;
            } else if name == ".text" {
                let offset = section.pointer_to_raw_data as usize;
                let size = section.size_of_raw_data as usize;
                if offset + size <= bytes.len() {
                    let entropy = crate::shannon_entropy(&bytes[offset..offset + size]);
                    text_entropy = Some(entropy);
                }
            }
        }

        // Inspect PE imported libraries
        for lib in &pe.libraries {
            let lib_lower = lib.to_ascii_lowercase();
            for &target in STEAM_API_LIBRARIES {
                if lib_lower == target {
                    steam_api_dependency = true;
                    steam_api_library = Some(target.to_string());
                    break;
                }
            }
        }

        // Inspect PE imported symbols
        for import in &pe.imports {
            let sym_name = import.name.as_ref();
            for &target_sym in STEAMWORKS_API_SYMBOLS {
                if sym_name == target_sym && !steamworks_symbols.iter().any(|s| s == target_sym) {
                    steamworks_symbols.push(target_sym.to_string());
                }
            }
        }
    } else if let Ok(elf) = goblin::elf::Elf::parse(bytes) {
        format = if elf.is_64 {
            "ELF64".to_string()
        } else {
            "ELF32".to_string()
        };

        // Inspect section headers for .bind / .steam
        for sh in &elf.section_headers {
            if let Some(name) = elf.shdr_strtab.get_at(sh.sh_name) {
                if name == ".bind" {
                    has_bind_section = true;
                } else if name == ".steam" {
                    has_steam_section = true;
                } else if name == ".text" {
                    let offset = sh.sh_offset as usize;
                    let size = sh.sh_size as usize;
                    if offset + size <= bytes.len() {
                        text_entropy = Some(crate::shannon_entropy(&bytes[offset..offset + size]));
                    }
                }
            }
        }

        // Inspect dynamic DT_NEEDED dependencies
        for lib in &elf.libraries {
            if *lib == "libsteam_api.so" {
                steam_api_dependency = true;
                steam_api_library = Some("libsteam_api.so".to_string());
            }
        }

        // Inspect dynamic symbols
        for sym in &elf.dynsyms {
            if let Some(sym_name) = elf.dynstrtab.get_at(sym.st_name) {
                for &target_sym in STEAMWORKS_API_SYMBOLS {
                    if sym_name == target_sym && !steamworks_symbols.iter().any(|s| s == target_sym)
                    {
                        steamworks_symbols.push(target_sym.to_string());
                    }
                }
            }
        }
    }

    // Fallback string search if imports were stripped or static
    if !steam_api_dependency {
        for &target in STEAM_API_LIBRARIES {
            if contains_subslice(bytes, target.as_bytes()) {
                steam_api_dependency = true;
                steam_api_library = Some(target.to_string());
                break;
            }
        }
    }

    if steamworks_symbols.is_empty() {
        for &sym in STEAMWORKS_API_SYMBOLS {
            if contains_subslice(bytes, sym.as_bytes()) {
                steamworks_symbols.push(sym.to_string());
            }
        }
    }

    let is_text_encrypted = text_entropy.map(|h| h >= 7.2).unwrap_or(false);

    // SteamStub is detected if .bind exists and entry point is inside .bind,
    // or if .bind section exists alongside high text entropy
    let is_steamstub_detected =
        (has_bind_section && entry_point_in_bind) || (has_bind_section && is_text_encrypted);

    let summary = if is_steamstub_detected {
        format!(
            "SteamStub wrapper detected: .bind section present (RVA {:#x}), entry in .bind: {}, text entropy: {:.2}",
            bind_section_rva.unwrap_or(0),
            entry_point_in_bind,
            text_entropy.unwrap_or(0.0)
        )
    } else if steam_api_dependency {
        format!(
            "Steamworks API integrated ({}), {} Steam API symbols detected",
            steam_api_library.as_deref().unwrap_or("unknown"),
            steamworks_symbols.len()
        )
    } else {
        "No Steam DRM or Steamworks API hooks detected".to_string()
    };

    SteamDrmReport {
        format,
        is_steamstub_detected,
        has_bind_section,
        has_steam_section,
        entry_point_in_bind,
        bind_section_rva,
        bind_section_size,
        text_entropy,
        is_text_encrypted,
        steam_api_dependency,
        steam_api_library,
        steamworks_symbols,
        summary,
    }
}

fn contains_subslice(haystack: &[u8], needle: &[u8]) -> bool {
    haystack.windows(needle.len()).any(|w| w == needle)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_steam_drm_inspection_on_synthetic_binary() {
        // Build a synthetic byte buffer containing Steamworks API strings
        let mut bin = Vec::new();
        bin.extend_from_slice(b"SOME_HEADER_DATA_PADDING");
        bin.extend_from_slice(b"steam_api64.dll\0");
        bin.extend_from_slice(b"SteamAPI_Init\0");
        bin.extend_from_slice(b"SteamAPI_RestartAppIfNecessary\0");
        bin.extend_from_slice(b"MORE_DATA_TRAILING");

        let report = inspect_steam_drm(&bin);
        assert!(report.steam_api_dependency);
        assert_eq!(
            report.steam_api_library,
            Some("steam_api64.dll".to_string())
        );
        assert!(
            report
                .steamworks_symbols
                .contains(&"SteamAPI_Init".to_string())
        );
        assert!(
            report
                .steamworks_symbols
                .contains(&"SteamAPI_RestartAppIfNecessary".to_string())
        );
        assert!(!report.is_steamstub_detected);
    }

    #[test]
    fn test_steam_drm_pe_bind_section_detection() {
        // Construct a synthetic minimal PE32+ with .text and .bind sections
        // Entry point is set inside the .bind section
        let mut pe = vec![0u8; 4096];

        // DOS header
        pe[0] = b'M';
        pe[1] = b'Z';
        let pe_offset = 0x80usize;
        pe[0x3C..0x40].copy_from_slice(&(pe_offset as u32).to_le_bytes());

        // PE signature
        pe[pe_offset..pe_offset + 4].copy_from_slice(b"PE\0\0");

        // COFF header (offset 0x84, 20 bytes)
        let coff = pe_offset + 4;
        pe[coff..coff + 2].copy_from_slice(&0x8664u16.to_le_bytes()); // Machine: x86_64
        pe[coff + 2..coff + 4].copy_from_slice(&2u16.to_le_bytes()); // 2 sections (.text, .bind)
        let opt_hdr_size = 240u16; // Standard PE32+ optional header size
        pe[coff + 16..coff + 18].copy_from_slice(&opt_hdr_size.to_le_bytes());
        pe[coff + 18..coff + 20].copy_from_slice(&0x0022u16.to_le_bytes()); // Characteristics: EXECUTABLE_IMAGE | LARGE_ADDRESS_AWARE

        // Optional Header PE32+ (offset 0x98, 240 bytes)
        let opt = coff + 20;
        pe[opt..opt + 2].copy_from_slice(&0x020Bu16.to_le_bytes()); // PE32+ magic
        // AddressOfEntryPoint at opt + 16: set to 0x2050 (inside .bind which is at RVA 0x2000..0x3000)
        pe[opt + 16..opt + 20].copy_from_slice(&0x2050u32.to_le_bytes());
        // SectionAlignment and FileAlignment
        pe[opt + 32..opt + 36].copy_from_slice(&0x1000u32.to_le_bytes()); // SectionAlignment
        pe[opt + 36..opt + 40].copy_from_slice(&0x200u32.to_le_bytes()); // FileAlignment
        pe[opt + 56..opt + 60].copy_from_slice(&0x4000u32.to_le_bytes()); // SizeOfImage
        pe[opt + 60..opt + 64].copy_from_slice(&0x400u32.to_le_bytes()); // SizeOfHeaders

        // Section Headers (offset opt + opt_hdr_size, 40 bytes each)
        let sec_table = opt + (opt_hdr_size as usize);

        // Section 1: .text
        // Name: ".text\0\0\0"
        pe[sec_table..sec_table + 8].copy_from_slice(b".text\0\0\0");
        pe[sec_table + 8..sec_table + 12].copy_from_slice(&0x1000u32.to_le_bytes()); // VirtualSize: 0x1000
        pe[sec_table + 12..sec_table + 16].copy_from_slice(&0x1000u32.to_le_bytes()); // VirtualAddress: 0x1000
        pe[sec_table + 16..sec_table + 20].copy_from_slice(&0x200u32.to_le_bytes()); // SizeOfRawData: 0x200
        pe[sec_table + 20..sec_table + 24].copy_from_slice(&0x400u32.to_le_bytes()); // PointerToRawData: 0x400
        pe[sec_table + 36..sec_table + 40].copy_from_slice(&0x60000020u32.to_le_bytes()); // Characteristics: CODE | EXECUTE | READ

        // Fill .text raw data with high-entropy pseudo-random pattern (simulating encrypted code)
        for (idx, slot) in pe[0x400..0x600].iter_mut().enumerate() {
            *slot = (((0x400 + idx) * 101 + 37) & 0xFF) as u8;
        }

        // Section 2: .bind (SteamStub stub section)
        let sec2 = sec_table + 40;
        pe[sec2..sec2 + 8].copy_from_slice(b".bind\0\0\0");
        pe[sec2 + 8..sec2 + 12].copy_from_slice(&0x1000u32.to_le_bytes()); // VirtualSize: 0x1000
        pe[sec2 + 12..sec2 + 16].copy_from_slice(&0x2000u32.to_le_bytes()); // VirtualAddress: 0x2000
        pe[sec2 + 16..sec2 + 20].copy_from_slice(&0x200u32.to_le_bytes()); // SizeOfRawData: 0x200
        pe[sec2 + 20..sec2 + 24].copy_from_slice(&0x600u32.to_le_bytes()); // PointerToRawData: 0x600
        pe[sec2 + 36..sec2 + 40].copy_from_slice(&0xE0000020u32.to_le_bytes()); // Characteristics: CODE | EXECUTE | READ | WRITE

        let report = inspect_steam_drm(&pe);
        assert_eq!(report.format, "PE32+");
        assert!(report.has_bind_section);
        assert!(report.entry_point_in_bind);
        assert_eq!(report.bind_section_rva, Some(0x2000));
        assert!(report.is_steamstub_detected);
        assert!(report.summary.contains("SteamStub wrapper detected"));
    }
}
