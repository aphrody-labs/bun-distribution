// SPDX-License-Identifier: Apache-2.0
//! # Android Reverse Engineering Primitives
//!
//! Pure-Rust, zero-unsafe module for inspecting Android application packages (APK)
//! and Android App Bundles (AAB):
//!
//! - **APK / AAB Container Inspection**: ZIP central directory parsing, file census,
//!   and payload extraction (uncompressed or Deflated via pure-Rust `flate2`).
//! - **AndroidManifest.xml Decoder**: Binary XML (AXML) chunk parser (`RES_XML_TYPE`,
//!   `RES_STRING_POOL_TYPE`, `RES_XML_RESOURCE_MAP_TYPE`, `RES_XML_START_ELEMENT_TYPE`,
//!   `RES_XML_END_ELEMENT_TYPE`). Extracts package name, versionCode, versionName,
//!   SDK constraints, permissions, activities, services, receivers, and providers.
//! - **`classes.dex` Parser**: Dalvik Executable (DEX) header verification (`dex\n035\0`..`dex\n039\0`),
//!   Adler32 checksum, SHA-1 signature, string pool decoding (ULEB128 + MUTF-8), type IDs,
//!   and class descriptors with access flags and superclasses.
//! - **Native `.so` Libraries Inventory**: Classification across Android ABIs (`arm64-v8a`,
//!   `armeabi-v7a`, `armeabi`, `x86_64`, `x86`, `mips`, `mips64`, `riscv64`).
//! - **Signature Scheme Detector**: Verification of APK Signing Block v2 (`0x7109871a`),
//!   v3 (`0xf05368c0`), v3.1 (`0x1b93861b`), SourceStamp (`0x42726577`), and v1 JAR signatures.

use flate2::read::DeflateDecoder;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::io::Read;
use thiserror::Error;

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/// Errors encountered while parsing Android containers, manifests, or DEX files.
#[derive(Debug, Error)]
pub enum AndroidError {
    /// Input buffer is too small or truncated at a given offset.
    #[error(
        "truncated Android binary data at offset {offset}: needed {needed} bytes, got {available}"
    )]
    Truncated { offset: usize, needed: usize, available: usize },

    /// Corrupt or invalid ZIP structure in APK / AAB.
    #[error("invalid ZIP / APK structure: {0}")]
    InvalidZip(String),

    /// Missing End of Central Directory record in ZIP container.
    #[error("End of Central Directory (EOCD) record not found in APK / AAB")]
    EocdNotFound,

    /// Malformed Android binary XML (AXML).
    #[error("malformed Android binary XML: {0}")]
    MalformedAxml(String),

    /// Malformed Dalvik Executable (DEX).
    #[error("malformed DEX file: {0}")]
    MalformedDex(String),

    /// Decompression failure.
    #[error("failed to decompress ZIP entry: {0}")]
    Decompression(String),

    /// CRC-32 integrity mismatch.
    #[error(
        "CRC-32 checksum mismatch for '{path}': expected {expected:#010x}, calculated {calculated:#010x}"
    )]
    CrcMismatch { path: String, expected: u32, calculated: u32 },
}

// ---------------------------------------------------------------------------
// ZIP Container Inspection & Central Directory
// ---------------------------------------------------------------------------

const EOCD_SIGNATURE: u32 = 0x06054b50; // PK\x05\x06
const CD_HEADER_SIGNATURE: u32 = 0x02014b50; // PK\x01\x02
const LOCAL_HEADER_SIGNATURE: u32 = 0x04034b50; // PK\x03\x04
const APK_SIG_BLOCK_MAGIC: &[u8; 16] = b"APK Sig Block 42";

/// Summary of an individual file entry in an APK or AAB archive.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ZipEntryInfo {
    /// Relative path inside the archive (e.g. `AndroidManifest.xml`, `classes.dex`, `lib/arm64-v8a/libnative.so`).
    pub path: String,
    /// Uncompressed size in bytes.
    pub uncompressed_size: u64,
    /// Compressed size in bytes.
    pub compressed_size: u64,
    /// Compression method (0 = Stored, 8 = Deflate).
    pub compression_method: u16,
    /// CRC-32 checksum stored in the Central Directory.
    pub crc32: u32,
    /// Byte offset of the local file header from the start of the archive.
    pub local_header_offset: u64,
}

/// Categorized census of files contained in an APK / AAB archive.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct FileCensus {
    /// Total count of entries in the ZIP archive.
    pub total_files: usize,
    /// Sum of uncompressed sizes of all entries.
    pub total_uncompressed_bytes: u64,
    /// Sum of compressed sizes of all entries.
    pub total_compressed_bytes: u64,
    /// DEX files (`classes.dex`, `classes2.dex`, etc.).
    pub dex_files: Vec<String>,
    /// Native `.so` libraries (`lib/<abi>/*.so`).
    pub native_libraries: Vec<String>,
    /// Manifest files (`AndroidManifest.xml` or `base/manifest/AndroidManifest.xml`).
    pub manifest_files: Vec<String>,
    /// Compiled resource tables (`resources.arsc`).
    pub resource_tables: Vec<String>,
    /// Assets (`assets/*`).
    pub assets_count: usize,
    /// Res folder entries (`res/*`).
    pub res_count: usize,
    /// Signature and metadata entries (`META-INF/*`).
    pub meta_inf_files: Vec<String>,
}

/// Container format detected.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum AndroidContainerType {
    /// Standard Android Application Package (`.apk`).
    Apk,
    /// Android App Bundle (`.aab`).
    Aab,
    /// Generic ZIP archive containing Android artifacts.
    GenericZip,
}

/// Parsed APK / AAB container with its Central Directory and signing blocks.
#[derive(Debug, Clone)]
pub struct AndroidContainer<'a> {
    raw: &'a [u8],
    /// Detected container type.
    pub container_type: AndroidContainerType,
    /// All entries parsed from the ZIP Central Directory.
    pub entries: Vec<ZipEntryInfo>,
    /// File census categorized by role.
    pub census: FileCensus,
    /// Detected APK signature schemes.
    pub signatures: ApkSignatures,
    /// Central Directory start byte offset.
    pub cd_offset: u64,
    /// Central Directory total size in bytes.
    pub cd_size: u64,
}

impl<'a> AndroidContainer<'a> {
    /// Parse an APK or AAB from a byte slice.
    pub fn parse(bytes: &'a [u8]) -> Result<Self, AndroidError> {
        let (eocd_pos, cd_offset, cd_size, total_entries) = find_and_parse_eocd(bytes)?;

        let mut entries = Vec::with_capacity(total_entries as usize);
        let mut cur = cd_offset as usize;
        let cd_end = cur.checked_add(cd_size as usize).ok_or_else(|| {
            AndroidError::InvalidZip("Central Directory bounds overflow".to_string())
        })?;

        if cd_end > bytes.len() {
            return Err(AndroidError::Truncated {
                offset: cur,
                needed: cd_size as usize,
                available: bytes.len().saturating_sub(cur),
            });
        }

        while cur + 46 <= cd_end {
            let sig = read_u32_le(bytes, cur)?;
            if sig != CD_HEADER_SIGNATURE {
                break;
            }

            let compression = read_u16_le(bytes, cur + 10)?;
            let crc = read_u32_le(bytes, cur + 16)?;
            let comp_size = read_u32_le(bytes, cur + 20)? as u64;
            let uncomp_size = read_u32_le(bytes, cur + 24)? as u64;
            let name_len = read_u16_le(bytes, cur + 28)? as usize;
            let extra_len = read_u16_le(bytes, cur + 30)? as usize;
            let comment_len = read_u16_le(bytes, cur + 32)? as usize;
            let local_offset = read_u32_le(bytes, cur + 42)? as u64;

            let name_start = cur + 46;
            let name_end = name_start.checked_add(name_len).ok_or_else(|| {
                AndroidError::InvalidZip("Entry file name length overflow".to_string())
            })?;
            if name_end > cd_end {
                return Err(AndroidError::Truncated {
                    offset: name_start,
                    needed: name_len,
                    available: cd_end.saturating_sub(name_start),
                });
            }

            let path = String::from_utf8_lossy(&bytes[name_start..name_end]).to_string();

            entries.push(ZipEntryInfo {
                path,
                uncompressed_size: uncomp_size,
                compressed_size: comp_size,
                compression_method: compression,
                crc32: crc,
                local_header_offset: local_offset,
            });

            cur = name_end + extra_len + comment_len;
        }

        let signatures = detect_apk_signatures(bytes, cd_offset, &entries);

        // Build file census
        let mut census = FileCensus { total_files: entries.len(), ..Default::default() };

        let mut has_base_manifest = false;
        let mut has_root_manifest = false;

        for entry in &entries {
            census.total_uncompressed_bytes =
                census.total_uncompressed_bytes.saturating_add(entry.uncompressed_size);
            census.total_compressed_bytes =
                census.total_compressed_bytes.saturating_add(entry.compressed_size);

            let p = &entry.path;
            if p == "AndroidManifest.xml" {
                has_root_manifest = true;
                census.manifest_files.push(p.clone());
            } else if p.ends_with("AndroidManifest.xml") {
                if p == "base/manifest/AndroidManifest.xml" {
                    has_base_manifest = true;
                }
                census.manifest_files.push(p.clone());
            } else if p.ends_with(".dex") {
                census.dex_files.push(p.clone());
            } else if p.ends_with(".so") && (p.starts_with("lib/") || p.contains("/lib/")) {
                census.native_libraries.push(p.clone());
            } else if p.ends_with("resources.arsc") {
                census.resource_tables.push(p.clone());
            } else if p.starts_with("assets/") || p.contains("/assets/") {
                census.assets_count += 1;
            } else if p.starts_with("res/") || p.contains("/res/") {
                census.res_count += 1;
            } else if p.starts_with("META-INF/") {
                census.meta_inf_files.push(p.clone());
            }
        }

        let container_type = if has_base_manifest
            || entries.iter().any(|e| e.path.starts_with("BUNDLE-METADATA/"))
        {
            AndroidContainerType::Aab
        } else if has_root_manifest {
            AndroidContainerType::Apk
        } else {
            AndroidContainerType::GenericZip
        };

        let _ = eocd_pos;

        Ok(Self { raw: bytes, container_type, entries, census, signatures, cd_offset, cd_size })
    }

    /// Read and optionally decompress the raw bytes of a named entry.
    pub fn read_entry(&self, path: &str) -> Result<Vec<u8>, AndroidError> {
        let entry = self.entries.iter().find(|e| e.path == path).ok_or_else(|| {
            AndroidError::InvalidZip(format!("entry '{path}' not found in archive"))
        })?;

        self.read_entry_info(entry)
    }

    /// Read and decompress a specific entry info record.
    pub fn read_entry_info(&self, entry: &ZipEntryInfo) -> Result<Vec<u8>, AndroidError> {
        let loc = entry.local_header_offset as usize;
        if loc + 30 > self.raw.len() {
            return Err(AndroidError::Truncated {
                offset: loc,
                needed: 30,
                available: self.raw.len().saturating_sub(loc),
            });
        }

        let sig = read_u32_le(self.raw, loc)?;
        if sig != LOCAL_HEADER_SIGNATURE {
            return Err(AndroidError::InvalidZip(format!(
                "invalid local file header signature {sig:#010x} at offset {loc}"
            )));
        }

        let local_name_len = read_u16_le(self.raw, loc + 26)? as usize;
        let local_extra_len = read_u16_le(self.raw, loc + 28)? as usize;
        let data_start = loc + 30 + local_name_len + local_extra_len;
        let comp_size = entry.compressed_size as usize;
        let data_end = data_start
            .checked_add(comp_size)
            .ok_or_else(|| AndroidError::InvalidZip("entry payload bounds overflow".to_string()))?;

        if data_end > self.raw.len() {
            return Err(AndroidError::Truncated {
                offset: data_start,
                needed: comp_size,
                available: self.raw.len().saturating_sub(data_start),
            });
        }

        let compressed_slice = &self.raw[data_start..data_end];
        let decompressed = match entry.compression_method {
            0 => compressed_slice.to_vec(),
            8 => {
                let mut decoder = DeflateDecoder::new(compressed_slice);
                let mut out = Vec::with_capacity(entry.uncompressed_size as usize);
                decoder
                    .read_to_end(&mut out)
                    .map_err(|e| AndroidError::Decompression(format!("{}: {}", entry.path, e)))?;
                out
            },
            other => {
                return Err(AndroidError::Decompression(format!(
                    "unsupported compression method {other} for '{}'",
                    entry.path
                )));
            },
        };

        // Validate CRC32
        let mut hasher = crc32fast::Hasher::new();
        hasher.update(&decompressed);
        let calc_crc = hasher.finalize();
        if calc_crc != entry.crc32 {
            return Err(AndroidError::CrcMismatch {
                path: entry.path.clone(),
                expected: entry.crc32,
                calculated: calc_crc,
            });
        }

        Ok(decompressed)
    }

    /// Inventory of native shared libraries organized by ABI.
    pub fn native_libraries(&self) -> BTreeMap<AndroidAbi, Vec<NativeLibraryInfo>> {
        let mut map: BTreeMap<AndroidAbi, Vec<NativeLibraryInfo>> = BTreeMap::new();

        for entry in &self.entries {
            if entry.path.ends_with(".so")
                && let Some((abi, lib_name)) = parse_abi_and_lib_name(&entry.path)
            {
                map.entry(abi).or_default().push(NativeLibraryInfo {
                    name: lib_name,
                    path: entry.path.clone(),
                    uncompressed_size: entry.uncompressed_size,
                    compressed_size: entry.compressed_size,
                    crc32: entry.crc32,
                });
            }
        }

        map
    }
}

// ---------------------------------------------------------------------------
// Native ABI Classification
// ---------------------------------------------------------------------------

/// Android Native Application Binary Interfaces.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
pub enum AndroidAbi {
    /// 64-bit ARM (`ARMv8-A` / `aarch64`).
    #[serde(rename = "arm64-v8a")]
    Arm64V8a,
    /// 32-bit ARM (`ARMv7-A`).
    #[serde(rename = "armeabi-v7a")]
    ArmeabiV7a,
    /// 32-bit ARM legacy (`ARMv5TE` / `ARMv6`).
    #[serde(rename = "armeabi")]
    Armeabi,
    /// 64-bit x86-64 (`AMD64` / `x86_64`).
    #[serde(rename = "x86_64")]
    X86_64,
    /// 32-bit x86 (`IA-32`).
    #[serde(rename = "x86")]
    X86,
    /// 32-bit MIPS.
    #[serde(rename = "mips")]
    Mips,
    /// 64-bit MIPS.
    #[serde(rename = "mips64")]
    Mips64,
    /// 64-bit RISC-V (`rv64gcv`).
    #[serde(rename = "riscv64")]
    RiscV64,
    /// Unknown ABI identifier.
    #[serde(rename = "unknown")]
    Unknown,
}

impl AndroidAbi {
    /// Return the canonical directory name string used in APKs (e.g. `"arm64-v8a"`).
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Arm64V8a => "arm64-v8a",
            Self::ArmeabiV7a => "armeabi-v7a",
            Self::Armeabi => "armeabi",
            Self::X86_64 => "x86_64",
            Self::X86 => "x86",
            Self::Mips => "mips",
            Self::Mips64 => "mips64",
            Self::RiscV64 => "riscv64",
            Self::Unknown => "unknown",
        }
    }

    /// Parse from an ABI directory component.
    pub fn from_name(name: &str) -> Self {
        match name {
            "arm64-v8a" => Self::Arm64V8a,
            "armeabi-v7a" => Self::ArmeabiV7a,
            "armeabi" => Self::Armeabi,
            "x86_64" => Self::X86_64,
            "x86" => Self::X86,
            "mips" => Self::Mips,
            "mips64" => Self::Mips64,
            "riscv64" => Self::RiscV64,
            _ => Self::Unknown,
        }
    }
}

/// Metadata describing a native `.so` library found in the archive.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct NativeLibraryInfo {
    /// File name of the shared object (e.g. `libmain.so`).
    pub name: String,
    /// Full archive path (e.g. `lib/arm64-v8a/libmain.so`).
    pub path: String,
    /// Uncompressed size in bytes.
    pub uncompressed_size: u64,
    /// Compressed size in bytes.
    pub compressed_size: u64,
    /// Stored CRC-32 checksum.
    pub crc32: u32,
}

fn parse_abi_and_lib_name(path: &str) -> Option<(AndroidAbi, String)> {
    // Normal format: lib/<abi>/<libname>.so or base/lib/<abi>/<libname>.so
    let parts: Vec<&str> = path.split('/').collect();
    let lib_idx = parts.iter().position(|&p| p == "lib")?;
    if parts.len() >= lib_idx + 3 {
        let abi = AndroidAbi::from_name(parts[lib_idx + 1]);
        let filename = parts[lib_idx + 2].to_string();
        Some((abi, filename))
    } else {
        None
    }
}

// ---------------------------------------------------------------------------
// APK Signature Scheme Detection
// ---------------------------------------------------------------------------

/// IDs defined by the Android Open Source Project (AOSP) for the APK Signing Block.
pub mod sig_scheme_ids {
    /// APK Signature Scheme v2 (Android 7.0+).
    pub const APK_SIGNATURE_SCHEME_V2_BLOCK_ID: u32 = 0x7109871a;
    /// APK Signature Scheme v3 (Android 9.0+).
    pub const APK_SIGNATURE_SCHEME_V3_BLOCK_ID: u32 = 0xf05368c0;
    /// APK Signature Scheme v3.1 (Android 13+).
    pub const APK_SIGNATURE_SCHEME_V3_1_BLOCK_ID: u32 = 0x1b93861b;
    /// SourceStamp signature block.
    pub const SOURCE_STAMP_BLOCK_ID: u32 = 0x42726577;
    /// Verity padding block ID.
    pub const VERITY_PADDING_BLOCK_ID: u32 = 0x42726578;
}

/// Information about cryptographic signature schemes present on the APK.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct ApkSignatures {
    /// Presence of JAR signing (v1 scheme: `META-INF/*.SF` and signature block).
    pub v1_jar_signed: bool,
    /// Files detected in `META-INF/` that form the v1 signature.
    pub v1_signature_files: Vec<String>,
    /// Whether an APK Signing Block is present immediately before the Central Directory.
    pub has_signing_block: bool,
    /// Total size in bytes of the APK Signing Block (if present).
    pub signing_block_size: Option<u64>,
    /// APK Signature Scheme v2 detected (`0x7109871a`).
    pub v2_scheme: bool,
    /// APK Signature Scheme v3 detected (`0xf05368c0`).
    pub v3_scheme: bool,
    /// APK Signature Scheme v3.1 detected (`0x1b93861b`).
    pub v3_1_scheme: bool,
    /// SourceStamp block detected (`0x42726577`).
    pub source_stamp: bool,
    /// All recognized and unrecognized block IDs found in the signing block.
    pub block_ids: Vec<u32>,
}

fn detect_apk_signatures(bytes: &[u8], cd_offset: u64, entries: &[ZipEntryInfo]) -> ApkSignatures {
    let mut sigs = ApkSignatures::default();

    // Check v1 JAR signature in Central Directory
    let mut has_manifest_mf = false;
    let mut has_sf = false;
    let mut has_cert = false;

    for entry in entries {
        if entry.path == "META-INF/MANIFEST.MF" {
            has_manifest_mf = true;
            sigs.v1_signature_files.push(entry.path.clone());
        } else if entry.path.starts_with("META-INF/") {
            if entry.path.ends_with(".SF") {
                has_sf = true;
                sigs.v1_signature_files.push(entry.path.clone());
            } else if entry.path.ends_with(".RSA")
                || entry.path.ends_with(".DSA")
                || entry.path.ends_with(".EC")
            {
                has_cert = true;
                sigs.v1_signature_files.push(entry.path.clone());
            }
        }
    }

    if has_manifest_mf && (has_sf || has_cert) {
        sigs.v1_jar_signed = true;
    }

    // Check APK Signing Block right before Central Directory
    // APK Signing Block format:
    // [offset: cd_offset - 8 - block_size]
    // uint64: block_size (excluding this field)
    // ID-value pairs:
    //   uint64: pair_size
    //   uint32: id
    //   value: pair_size - 4 bytes
    // uint64: block_size (identical to the first field)
    // 16 bytes: magic "APK Sig Block 42"
    let cd_off = cd_offset as usize;
    if cd_off >= 24 && cd_off <= bytes.len() {
        let magic_offset = cd_off - 16;
        if &bytes[magic_offset..cd_off] == APK_SIG_BLOCK_MAGIC {
            // Read trailing block_size
            if let Ok(block_size_end) = read_u64_le(bytes, cd_off - 24) {
                let total_block_len = block_size_end.saturating_add(8) as usize;
                if cd_off >= total_block_len {
                    let block_start = cd_off - total_block_len;
                    if let Ok(block_size_start) = read_u64_le(bytes, block_start)
                        && block_size_start == block_size_end
                    {
                        sigs.has_signing_block = true;
                        sigs.signing_block_size = Some(block_size_end);

                        // Parse ID-value pairs
                        let mut p = block_start + 8;
                        let end_pairs = cd_off - 24;
                        while p + 12 <= end_pairs {
                            if let Ok(pair_len) = read_u64_le(bytes, p) {
                                let pair_len_usize = pair_len as usize;
                                if pair_len_usize < 4 || p + 8 + pair_len_usize > end_pairs {
                                    break;
                                }
                                if let Ok(id) = read_u32_le(bytes, p + 8) {
                                    sigs.block_ids.push(id);
                                    match id {
                                        sig_scheme_ids::APK_SIGNATURE_SCHEME_V2_BLOCK_ID => {
                                            sigs.v2_scheme = true;
                                        },
                                        sig_scheme_ids::APK_SIGNATURE_SCHEME_V3_BLOCK_ID => {
                                            sigs.v3_scheme = true;
                                        },
                                        sig_scheme_ids::APK_SIGNATURE_SCHEME_V3_1_BLOCK_ID => {
                                            sigs.v3_1_scheme = true;
                                        },
                                        sig_scheme_ids::SOURCE_STAMP_BLOCK_ID => {
                                            sigs.source_stamp = true;
                                        },
                                        _ => {},
                                    }
                                }
                                p += 8 + pair_len_usize;
                            } else {
                                break;
                            }
                        }
                    }
                }
            }
        }
    }

    sigs
}

// ---------------------------------------------------------------------------
// AndroidManifest.xml Binary XML (AXML) Decoder
// ---------------------------------------------------------------------------

/// Chunk type constants for Android binary XML.
pub mod axml_chunks {
    /// Root XML document chunk (`RES_XML_TYPE`: type `0x0003`, header_size `8` => `0x00080003`).
    pub const RES_XML_TYPE: u16 = 0x0003;
    /// String pool chunk (`RES_STRING_POOL_TYPE`: type `0x0001` or `0x0002`).
    pub const RES_STRING_POOL_TYPE: u16 = 0x0001;
    /// Alternative string pool marker sometimes present in packed resources.
    pub const RES_STRING_POOL_ALT_TYPE: u16 = 0x0002;
    /// XML resource map chunk (`RES_XML_RESOURCE_MAP_TYPE`: type `0x0180`, header_size `8` => `0x00080180`).
    pub const RES_XML_RESOURCE_MAP_TYPE: u16 = 0x0180;
    /// XML start namespace chunk (`RES_XML_START_NAMESPACE_TYPE`: type `0x0100`).
    pub const RES_XML_START_NAMESPACE_TYPE: u16 = 0x0100;
    /// XML end namespace chunk (`RES_XML_END_NAMESPACE_TYPE`: type `0x0101`).
    pub const RES_XML_END_NAMESPACE_TYPE: u16 = 0x0101;
    /// XML start element chunk (`RES_XML_START_ELEMENT_TYPE`: type `0x0102`, header_size `16` => `0x00100102`).
    pub const RES_XML_START_ELEMENT_TYPE: u16 = 0x0102;
    /// XML end element chunk (`RES_XML_END_ELEMENT_TYPE`: type `0x0103`, header_size `16` => `0x00100103`).
    pub const RES_XML_END_ELEMENT_TYPE: u16 = 0x0103;
    /// XML CDATA chunk (`RES_XML_CDATA_TYPE`: type `0x0104`).
    pub const RES_XML_CDATA_TYPE: u16 = 0x0104;

    /// 32-bit chunk tag for XML document header (`0x00080003`).
    pub const CHUNK_TAG_XML: u32 = 0x00080003;
    /// 32-bit chunk tag for resource map (`0x00080180`).
    pub const CHUNK_TAG_RESOURCE_MAP: u32 = 0x00080180;
    /// 32-bit chunk tag for start element (`0x00100102`).
    pub const CHUNK_TAG_START_ELEMENT: u32 = 0x00100102;
    /// 32-bit chunk tag for end element (`0x00100103`).
    pub const CHUNK_TAG_END_ELEMENT: u32 = 0x00100103;
}

/// A parsed Android XML attribute value.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum AxmlValue {
    /// String literal.
    String(String),
    /// Decimal integer.
    Integer(i32),
    /// Hexadecimal integer / flag mask.
    Hex(u32),
    /// Boolean flag.
    Boolean(bool),
    /// Resource ID reference (`@0x...`).
    Reference(u32),
    /// Raw unparsed typed value.
    Raw { data_type: u8, data: u32 },
}

impl AxmlValue {
    /// Returns the string representation of this value.
    pub fn as_str_value(&self) -> String {
        match self {
            Self::String(s) => s.clone(),
            Self::Integer(i) => i.to_string(),
            Self::Hex(h) => format!("0x{h:08x}"),
            Self::Boolean(b) => b.to_string(),
            Self::Reference(r) => format!("@0x{r:08x}"),
            Self::Raw { data_type, data } => format!("[type 0x{data_type:02x}: 0x{data:08x}]"),
        }
    }
}

/// An attribute in an AXML element.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AxmlAttribute {
    /// Attribute name (e.g. `name`, `versionCode`, `package`).
    pub name: String,
    /// Attribute namespace URI (e.g. `http://schemas.android.com/apk/res/android`), if any.
    pub namespace: Option<String>,
    /// Typed decoded value.
    pub value: AxmlValue,
}

/// An element node in the decoded AXML tree.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AxmlElement {
    /// Element tag name (e.g. `manifest`, `application`, `activity`, `uses-permission`).
    pub tag: String,
    /// Element namespace URI, if specified.
    pub namespace: Option<String>,
    /// All attributes defined on this element.
    pub attributes: Vec<AxmlAttribute>,
    /// Child element nodes.
    pub children: Vec<AxmlElement>,
}

impl AxmlElement {
    /// Retrieve an attribute value by name (ignoring namespace prefix).
    pub fn attr(&self, name: &str) -> Option<&AxmlAttribute> {
        self.attributes.iter().find(|a| a.name == name)
    }

    /// Retrieve an attribute value as string by name.
    pub fn attr_str(&self, name: &str) -> Option<String> {
        self.attr(name).map(|a| a.value.as_str_value())
    }

    /// Find all immediate child elements matching a tag name.
    pub fn find_children(&self, tag: &str) -> Vec<&AxmlElement> {
        self.children.iter().filter(|c| c.tag == tag).collect()
    }
}

/// High-level parsed Android Manifest (`AndroidManifest.xml`).
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct AndroidManifest {
    /// Package name declared in `<manifest package="...">`.
    pub package: String,
    /// Numeric version code (`android:versionCode`).
    pub version_code: Option<i64>,
    /// Human-readable version name (`android:versionName`).
    pub version_name: Option<String>,
    /// Minimum supported Android API level (`android:minSdkVersion`).
    pub min_sdk_version: Option<u32>,
    /// Target Android API level (`android:targetSdkVersion`).
    pub target_sdk_version: Option<u32>,
    /// Compile Android API level (`android:compileSdkVersion`).
    pub compile_sdk_version: Option<u32>,
    /// Declared and requested permissions (`<uses-permission>` and `<permission>`).
    pub permissions: Vec<String>,
    /// Declared activities (`<activity>` and `<activity-alias>`).
    pub activities: Vec<AndroidComponent>,
    /// Declared background services (`<service>`).
    pub services: Vec<AndroidComponent>,
    /// Declared broadcast receivers (`<receiver>`).
    pub receivers: Vec<AndroidComponent>,
    /// Declared content providers (`<provider>`).
    pub providers: Vec<AndroidComponent>,
    /// Application label if declared (`android:label`).
    pub application_label: Option<String>,
    /// Whether application is debuggable (`android:debuggable`).
    pub is_debuggable: bool,
    /// Reconstructed XML text.
    pub raw_xml: Option<String>,
}

/// An Android application component (activity, service, receiver, provider).
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct AndroidComponent {
    /// Component class name (`android:name`).
    pub name: String,
    /// Explicitly exported flag (`android:exported`).
    pub exported: Option<bool>,
    /// Required permission (`android:permission`), if any.
    pub permission: Option<String>,
    /// Intent filter actions (`<action android:name="...">`).
    pub actions: Vec<String>,
    /// Intent filter categories (`<category android:name="...">`).
    pub categories: Vec<String>,
    /// Whether this component acts as the main launcher entrypoint.
    pub is_launcher: bool,
}

/// Decodes binary AXML bytes into an [`AxmlElement`] tree and [`AndroidManifest`].
pub struct AxmlDecoder;

impl AxmlDecoder {
    /// Parse raw Android binary XML bytes.
    pub fn parse(data: &[u8]) -> Result<AndroidManifest, AndroidError> {
        if data.len() < 8 {
            return Err(AndroidError::Truncated { offset: 0, needed: 8, available: data.len() });
        }

        let chunk_type = read_u16_le(data, 0)?;
        let header_size = read_u16_le(data, 2)?;
        let chunk_size = read_u32_le(data, 4)? as usize;

        // Verify XML chunk magic (type 0x0003, header size 8, or 32-bit chunk tag 0x00080003)
        if chunk_type != axml_chunks::RES_XML_TYPE && header_size != 8 {
            return Err(AndroidError::MalformedAxml(format!(
                "invalid XML chunk header: type={chunk_type:#06x}, header_size={header_size}"
            )));
        }

        let total_len = std::cmp::min(data.len(), chunk_size);
        let mut cur = header_size as usize;
        let mut strings = Vec::new();
        let mut root_elements = Vec::new();
        let mut element_stack: Vec<AxmlElement> = Vec::new();

        while cur + 8 <= total_len {
            let c_type = read_u16_le(data, cur)?;
            let c_header_size = read_u16_le(data, cur + 2)? as usize;
            let c_size = read_u32_le(data, cur + 4)? as usize;

            if c_size < 8 || cur + c_size > total_len {
                break;
            }

            match c_type {
                axml_chunks::RES_STRING_POOL_TYPE | axml_chunks::RES_STRING_POOL_ALT_TYPE => {
                    strings = parse_string_pool(&data[cur..cur + c_size])?;
                },
                axml_chunks::RES_XML_START_ELEMENT_TYPE => {
                    if c_header_size + 20 <= c_size && cur + c_header_size + 20 <= total_len {
                        let ns_idx = read_u32_le(data, cur + c_header_size)?;
                        let name_idx = read_u32_le(data, cur + c_header_size + 4)?;
                        let attr_start = read_u16_le(data, cur + c_header_size + 8)? as usize;
                        let attr_size = read_u16_le(data, cur + c_header_size + 10)? as usize;
                        let attr_count = read_u16_le(data, cur + c_header_size + 12)? as usize;

                        let tag = resolve_string(&strings, name_idx)
                            .unwrap_or_else(|| format!("tag_{name_idx}"));
                        let ns = resolve_string(&strings, ns_idx);

                        let mut attrs = Vec::with_capacity(attr_count);
                        let mut attr_offset = cur + c_header_size + attr_start;

                        for _ in 0..attr_count {
                            if attr_offset + 20 <= cur + c_size {
                                let a_ns_idx = read_u32_le(data, attr_offset)?;
                                let a_name_idx = read_u32_le(data, attr_offset + 4)?;
                                let a_raw_idx = read_u32_le(data, attr_offset + 8)?;
                                let a_data_type = data[attr_offset + 15];
                                let a_data = read_u32_le(data, attr_offset + 16)?;

                                let a_name = resolve_string(&strings, a_name_idx)
                                    .unwrap_or_else(|| format!("attr_{a_name_idx}"));
                                let a_ns = resolve_string(&strings, a_ns_idx);

                                let val = if a_raw_idx != 0xFFFF_FFFF {
                                    if let Some(s) = resolve_string(&strings, a_raw_idx) {
                                        AxmlValue::String(s)
                                    } else {
                                        decode_typed_value(a_data_type, a_data, &strings)
                                    }
                                } else {
                                    decode_typed_value(a_data_type, a_data, &strings)
                                };

                                attrs.push(AxmlAttribute {
                                    name: a_name,
                                    namespace: a_ns,
                                    value: val,
                                });

                                attr_offset += attr_size.max(20);
                            }
                        }

                        element_stack.push(AxmlElement {
                            tag,
                            namespace: ns,
                            attributes: attrs,
                            children: Vec::new(),
                        });
                    }
                },
                axml_chunks::RES_XML_END_ELEMENT_TYPE => {
                    if let Some(finished) = element_stack.pop() {
                        if let Some(parent) = element_stack.last_mut() {
                            parent.children.push(finished);
                        } else {
                            root_elements.push(finished);
                        }
                    }
                },
                _ => {
                    // Ignore other chunks (namespaces, CDATA, etc.)
                },
            }

            cur += c_size;
        }

        // Flush any remaining unclosed elements
        while let Some(elem) = element_stack.pop() {
            if let Some(parent) = element_stack.last_mut() {
                parent.children.push(elem);
            } else {
                root_elements.push(elem);
            }
        }

        let root = root_elements.into_iter().find(|e| e.tag == "manifest").unwrap_or_else(|| {
            AxmlElement {
                tag: "manifest".to_string(),
                namespace: None,
                attributes: Vec::new(),
                children: Vec::new(),
            }
        });

        let mut manifest = AndroidManifest {
            package: root.attr_str("package").unwrap_or_default(),
            ..AndroidManifest::default()
        };

        if let Some(vc_attr) = root.attr("versionCode") {
            manifest.version_code = match vc_attr.value {
                AxmlValue::Integer(i) => Some(i as i64),
                AxmlValue::Hex(h) => Some(h as i64),
                AxmlValue::String(ref s) => s.parse::<i64>().ok(),
                _ => None,
            };
        }
        manifest.version_name = root.attr_str("versionName");

        if let Some(sdk) = root.find_children("uses-sdk").first() {
            manifest.min_sdk_version = sdk.attr("minSdkVersion").and_then(val_to_u32);
            manifest.target_sdk_version = sdk.attr("targetSdkVersion").and_then(val_to_u32);
        }
        manifest.compile_sdk_version = root.attr("compileSdkVersion").and_then(val_to_u32);

        // Permissions
        for perm in root.find_children("uses-permission") {
            if let Some(name) = perm.attr_str("name")
                && !manifest.permissions.contains(&name)
            {
                manifest.permissions.push(name);
            }
        }
        for perm in root.find_children("permission") {
            if let Some(name) = perm.attr_str("name")
                && !manifest.permissions.contains(&name)
            {
                manifest.permissions.push(name);
            }
        }

        // Application components
        if let Some(app) = root.find_children("application").first() {
            manifest.application_label = app.attr_str("label");
            if let Some(dbg) = app.attr("debuggable") {
                manifest.is_debuggable = matches!(dbg.value, AxmlValue::Boolean(true));
            }

            for act in app.find_children("activity") {
                manifest.activities.push(parse_component(act));
            }
            for act in app.find_children("activity-alias") {
                manifest.activities.push(parse_component(act));
            }
            for srv in app.find_children("service") {
                manifest.services.push(parse_component(srv));
            }
            for rcv in app.find_children("receiver") {
                manifest.receivers.push(parse_component(rcv));
            }
            for prv in app.find_children("provider") {
                manifest.providers.push(parse_component(prv));
            }
        }

        // Format clean XML reconstruction
        let mut raw_xml_buf = String::new();
        render_element_xml(&root, 0, &mut raw_xml_buf);
        manifest.raw_xml = Some(raw_xml_buf);

        Ok(manifest)
    }
}

fn parse_component(elem: &AxmlElement) -> AndroidComponent {
    let mut comp = AndroidComponent {
        name: elem.attr_str("name").unwrap_or_default(),
        exported: elem.attr("exported").map(|a| matches!(a.value, AxmlValue::Boolean(true))),
        permission: elem.attr_str("permission"),
        actions: Vec::new(),
        categories: Vec::new(),
        is_launcher: false,
    };

    for filter in elem.find_children("intent-filter") {
        for action in filter.find_children("action") {
            if let Some(act_name) = action.attr_str("name") {
                comp.actions.push(act_name);
            }
        }
        for cat in filter.find_children("category") {
            if let Some(cat_name) = cat.attr_str("name") {
                comp.categories.push(cat_name);
            }
        }
    }

    if comp.actions.iter().any(|a| a == "android.intent.action.MAIN")
        && comp.categories.iter().any(|c| c == "android.intent.category.LAUNCHER")
    {
        comp.is_launcher = true;
    }

    comp
}

fn render_element_xml(elem: &AxmlElement, indent: usize, out: &mut String) {
    let pad = "  ".repeat(indent);
    out.push_str(&format!("{pad}<{}", elem.tag));
    for attr in &elem.attributes {
        out.push_str(&format!(" {}=\"{}\"", attr.name, attr.value.as_str_value()));
    }
    if elem.children.is_empty() {
        out.push_str(" />\n");
    } else {
        out.push_str(">\n");
        for child in &elem.children {
            render_element_xml(child, indent + 1, out);
        }
        out.push_str(&format!("{pad}</{}>\n", elem.tag));
    }
}

fn val_to_u32(attr: &AxmlAttribute) -> Option<u32> {
    match attr.value {
        AxmlValue::Integer(i) if i >= 0 => Some(i as u32),
        AxmlValue::Hex(h) => Some(h),
        AxmlValue::String(ref s) => s.parse::<u32>().ok(),
        _ => None,
    }
}

fn decode_typed_value(data_type: u8, data: u32, strings: &[String]) -> AxmlValue {
    match data_type {
        0x01 => AxmlValue::Reference(data),
        0x03 => {
            if let Some(s) = resolve_string(strings, data) {
                AxmlValue::String(s)
            } else {
                AxmlValue::Raw { data_type, data }
            }
        },
        0x10 => AxmlValue::Integer(data as i32),
        0x11 => AxmlValue::Hex(data),
        0x12 => AxmlValue::Boolean(data != 0),
        _ => AxmlValue::Raw { data_type, data },
    }
}

fn resolve_string(strings: &[String], idx: u32) -> Option<String> {
    if idx == 0xFFFF_FFFF { None } else { strings.get(idx as usize).cloned() }
}

fn parse_string_pool(pool_bytes: &[u8]) -> Result<Vec<String>, AndroidError> {
    if pool_bytes.len() < 28 {
        return Err(AndroidError::MalformedAxml("string pool header too short".to_string()));
    }

    let string_count = read_u32_le(pool_bytes, 8)? as usize;
    let flags = read_u32_le(pool_bytes, 16)?;
    let strings_start = read_u32_le(pool_bytes, 20)? as usize;
    let is_utf8 = (flags & (1 << 8)) != 0;

    let mut offsets = Vec::with_capacity(string_count);
    for i in 0..string_count {
        let off_pos = 28 + i * 4;
        if off_pos + 4 <= pool_bytes.len() {
            offsets.push(read_u32_le(pool_bytes, off_pos)? as usize);
        }
    }

    let mut results = Vec::with_capacity(string_count);
    for offset in offsets {
        let abs_off = strings_start + offset;
        if abs_off >= pool_bytes.len() {
            results.push(String::new());
            continue;
        }

        let slice = &pool_bytes[abs_off..];
        if is_utf8 {
            // UTF-8 string: skip character length (1 or 2 bytes), read byte length (1 or 2 bytes)
            let mut p = 0;
            if p < slice.len() && slice[p] >= 0x80 {
                p += 2;
            } else {
                p += 1;
            }
            if p >= slice.len() {
                results.push(String::new());
                continue;
            }
            let byte_len = if slice[p] >= 0x80 {
                if p + 1 >= slice.len() {
                    results.push(String::new());
                    continue;
                }
                let len = (((slice[p] & 0x7f) as usize) << 8) | (slice[p + 1] as usize);
                p += 2;
                len
            } else {
                let len = slice[p] as usize;
                p += 1;
                len
            };

            let end = (p + byte_len).min(slice.len());
            let s = String::from_utf8_lossy(&slice[p..end]).to_string();
            results.push(s);
        } else {
            // UTF-16LE string: length in u16 characters
            if slice.len() < 2 {
                results.push(String::new());
                continue;
            }
            let mut p = 0;
            let first = read_u16_le(slice, p).unwrap_or(0);
            p += 2;
            let char_len = if (first & 0x8000) != 0 {
                if p + 2 > slice.len() {
                    results.push(String::new());
                    continue;
                }
                let second = read_u16_le(slice, p).unwrap_or(0);
                p += 2;
                (((first & 0x7fff) as usize) << 16) | (second as usize)
            } else {
                first as usize
            };

            let byte_len = char_len * 2;
            if p + byte_len <= slice.len() {
                let u16_slice: Vec<u16> = slice[p..p + byte_len]
                    .as_chunks::<2>()
                    .0
                    .iter()
                    .map(|c| u16::from_le_bytes(*c))
                    .collect();
                results.push(String::from_utf16_lossy(&u16_slice));
            } else {
                results.push(String::new());
            }
        }
    }

    Ok(results)
}

// ---------------------------------------------------------------------------
// classes.dex Dalvik Executable Parser
// ---------------------------------------------------------------------------

const DEX_MAGIC: &[u8; 4] = b"dex\n";
const DEX_ENDIAN_CONSTANT: u32 = 0x12345678;

/// Dalvik class access flags.
pub mod dex_access_flags {
    pub const ACC_PUBLIC: u32 = 0x0001;
    pub const ACC_PRIVATE: u32 = 0x0002;
    pub const ACC_PROTECTED: u32 = 0x0004;
    pub const ACC_STATIC: u32 = 0x0008;
    pub const ACC_FINAL: u32 = 0x0010;
    pub const ACC_INTERFACE: u32 = 0x0200;
    pub const ACC_ABSTRACT: u32 = 0x0400;
    pub const ACC_SYNTHETIC: u32 = 0x1000;
    pub const ACC_ANNOTATION: u32 = 0x2000;
    pub const ACC_ENUM: u32 = 0x4000;
}

/// A class definition extracted from a DEX file.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DexClassDef {
    /// Class descriptor (e.g. `Lcom/example/MainActivity;`).
    pub descriptor: String,
    /// Superclass descriptor (e.g. `Landroid/app/Activity;`), if any.
    pub superclass: Option<String>,
    /// Source file name (e.g. `MainActivity.java`), if recorded.
    pub source_file: Option<String>,
    /// Access flags bitmask (`ACC_PUBLIC`, `ACC_FINAL`, etc.).
    pub access_flags: u32,
}

/// Summary report of a Dalvik Executable (`classes.dex`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DexSummary {
    /// DEX version string (e.g. `"035"`, `"037"`, `"038"`, `"039"`).
    pub version: String,
    /// Adler-32 header checksum.
    pub checksum: u32,
    /// SHA-1 20-byte signature in lowercase hexadecimal.
    pub signature: String,
    /// DEX total file size in bytes according to header.
    pub file_size: u32,
    /// Number of string IDs in the string pool.
    pub string_ids_count: u32,
    /// Number of type IDs in the type pool.
    pub type_ids_count: u32,
    /// Number of prototype IDs.
    pub proto_ids_count: u32,
    /// Number of field IDs.
    pub field_ids_count: u32,
    /// Number of method IDs.
    pub method_ids_count: u32,
    /// Number of class definitions.
    pub class_defs_count: u32,
    /// Enumerated class descriptors and definitions.
    pub classes: Vec<DexClassDef>,
}

/// Parser for Dalvik Executable files (`.dex`).
pub struct DexFile;

impl DexFile {
    /// Parse a Dalvik Executable byte slice.
    pub fn parse(bytes: &[u8]) -> Result<DexSummary, AndroidError> {
        if bytes.len() < 112 {
            return Err(AndroidError::Truncated { offset: 0, needed: 112, available: bytes.len() });
        }

        // Magic verification: 'dex\n' + 3 ascii version bytes + '\0'
        if &bytes[0..4] != DEX_MAGIC {
            return Err(AndroidError::MalformedDex(format!(
                "invalid DEX magic: {:?}",
                &bytes[0..4.min(bytes.len())]
            )));
        }

        let version = String::from_utf8_lossy(&bytes[4..7]).to_string();
        if bytes[7] != 0 {
            return Err(AndroidError::MalformedDex("DEX magic not null-terminated".to_string()));
        }

        let checksum = read_u32_le(bytes, 8)?;
        let signature = hex::encode(&bytes[12..32]);
        let file_size = read_u32_le(bytes, 32)?;
        let header_size = read_u32_le(bytes, 36)?;
        let endian_tag = read_u32_le(bytes, 40)?;

        if endian_tag != DEX_ENDIAN_CONSTANT {
            return Err(AndroidError::MalformedDex(format!(
                "unsupported DEX endian tag {endian_tag:#010x}"
            )));
        }

        if (header_size as usize) > bytes.len() {
            return Err(AndroidError::MalformedDex(format!(
                "header size {header_size} exceeds file length {}",
                bytes.len()
            )));
        }

        let string_ids_size = read_u32_le(bytes, 56)? as usize;
        let string_ids_off = read_u32_le(bytes, 60)? as usize;
        let type_ids_size = read_u32_le(bytes, 64)? as usize;
        let type_ids_off = read_u32_le(bytes, 68)? as usize;
        let proto_ids_size = read_u32_le(bytes, 72)? as usize;
        let field_ids_size = read_u32_le(bytes, 80)? as usize;
        let method_ids_size = read_u32_le(bytes, 88)? as usize;
        let class_defs_size = read_u32_le(bytes, 96)? as usize;
        let class_defs_off = read_u32_le(bytes, 100)? as usize;

        // Parse String IDs
        let mut strings = Vec::with_capacity(string_ids_size);
        for i in 0..string_ids_size {
            let p = string_ids_off + i * 4;
            if p + 4 <= bytes.len() {
                let data_off = read_u32_le(bytes, p)? as usize;
                if data_off < bytes.len() {
                    let s = read_dex_mutf8(bytes, data_off)?;
                    strings.push(s);
                } else {
                    strings.push(String::new());
                }
            } else {
                break;
            }
        }

        // Parse Type IDs (each is a uint32 index into strings)
        let mut types = Vec::with_capacity(type_ids_size);
        for i in 0..type_ids_size {
            let p = type_ids_off + i * 4;
            if p + 4 <= bytes.len() {
                let descriptor_idx = read_u32_le(bytes, p)? as usize;
                if descriptor_idx < strings.len() {
                    types.push(strings[descriptor_idx].clone());
                } else {
                    types.push(String::new());
                }
            } else {
                break;
            }
        }

        // Parse Class Defs (each is 32 bytes)
        let mut classes = Vec::with_capacity(class_defs_size);
        for i in 0..class_defs_size {
            let p = class_defs_off + i * 32;
            if p + 32 <= bytes.len() {
                let class_idx = read_u32_le(bytes, p)? as usize;
                let access_flags = read_u32_le(bytes, p + 4)?;
                let superclass_idx = read_u32_le(bytes, p + 8)?;
                let source_file_idx = read_u32_le(bytes, p + 16)?;

                let descriptor =
                    types.get(class_idx).cloned().unwrap_or_else(|| format!("Type_{class_idx}"));
                let superclass = if superclass_idx != 0xFFFF_FFFF {
                    types.get(superclass_idx as usize).cloned()
                } else {
                    None
                };
                let source_file = if source_file_idx != 0xFFFF_FFFF {
                    strings.get(source_file_idx as usize).cloned()
                } else {
                    None
                };

                classes.push(DexClassDef { descriptor, superclass, source_file, access_flags });
            } else {
                break;
            }
        }

        Ok(DexSummary {
            version,
            checksum,
            signature,
            file_size,
            string_ids_count: string_ids_size as u32,
            type_ids_count: type_ids_size as u32,
            proto_ids_count: proto_ids_size as u32,
            field_ids_count: field_ids_size as u32,
            method_ids_count: method_ids_size as u32,
            class_defs_count: class_defs_size as u32,
            classes,
        })
    }
}

/// Read a Modified UTF-8 string prefixed with a ULEB128 character count from a DEX slice.
fn read_dex_mutf8(bytes: &[u8], mut offset: usize) -> Result<String, AndroidError> {
    if offset >= bytes.len() {
        return Ok(String::new());
    }

    // Read ULEB128 character count
    let (_char_count, bytes_read) = read_uleb128(&bytes[offset..])?;
    offset += bytes_read;

    // Read null-terminated MUTF-8 bytes
    let start = offset;
    while offset < bytes.len() && bytes[offset] != 0 {
        offset += 1;
    }

    let mutf8_bytes = &bytes[start..offset];
    // Convert MUTF-8 null byte (0xc0, 0x80) to 0x00 and lossy convert
    let mut out = String::with_capacity(mutf8_bytes.len());
    let mut i = 0;
    while i < mutf8_bytes.len() {
        if mutf8_bytes[i] == 0xC0 && i + 1 < mutf8_bytes.len() && mutf8_bytes[i + 1] == 0x80 {
            out.push('\0');
            i += 2;
        } else {
            let ch_len = match mutf8_bytes[i] {
                0..=0x7F => 1,
                0xC2..=0xDF => 2,
                0xE0..=0xEF => 3,
                _ => 1,
            };
            if i + ch_len <= mutf8_bytes.len() {
                if let Ok(s) = std::str::from_utf8(&mutf8_bytes[i..i + ch_len]) {
                    out.push_str(s);
                } else {
                    out.push('\u{FFFD}');
                }
                i += ch_len;
            } else {
                out.push('\u{FFFD}');
                break;
            }
        }
    }

    Ok(out)
}

/// Decode an unsigned LEB128 value.
pub fn read_uleb128(bytes: &[u8]) -> Result<(u32, usize), AndroidError> {
    let mut result: u32 = 0;
    let mut shift = 0;
    let mut count = 0;

    for &byte in bytes.iter().take(5) {
        count += 1;
        result |= ((byte & 0x7F) as u32) << shift;
        if (byte & 0x80) == 0 {
            return Ok((result, count));
        }
        shift += 7;
    }

    Err(AndroidError::MalformedDex("invalid ULEB128 sequence".to_string()))
}

// ---------------------------------------------------------------------------
// Unified Android Package Analysis
// ---------------------------------------------------------------------------

/// Full reverse-engineering report of an Android APK or AAB.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AndroidReport {
    /// Container format (APK, AAB, or generic ZIP).
    pub container_type: AndroidContainerType,
    /// Decoded `AndroidManifest.xml` if present.
    pub manifest: Option<AndroidManifest>,
    /// Summary of primary `classes.dex` and secondary DEX files.
    pub dex_summaries: Vec<DexSummary>,
    /// Native libraries grouped by ABI.
    pub native_libraries: BTreeMap<AndroidAbi, Vec<NativeLibraryInfo>>,
    /// Cryptographic signatures and signing blocks.
    pub signatures: ApkSignatures,
    /// Detailed file census.
    pub census: FileCensus,
}

/// Analyze an APK or AAB byte slice end-to-end.
pub fn analyze_apk(bytes: &[u8]) -> Result<AndroidReport, AndroidError> {
    let container = AndroidContainer::parse(bytes)?;

    // Manifest extraction
    let mut manifest = None;
    for manifest_path in &container.census.manifest_files {
        if let Ok(manifest_data) = container.read_entry(manifest_path)
            && let Ok(parsed) = AxmlDecoder::parse(&manifest_data)
        {
            manifest = Some(parsed);
            break;
        }
    }

    // DEX parsing
    let mut dex_summaries = Vec::new();
    for dex_path in &container.census.dex_files {
        if let Ok(dex_data) = container.read_entry(dex_path)
            && let Ok(summary) = DexFile::parse(&dex_data)
        {
            dex_summaries.push(summary);
        }
    }

    let native_libraries = container.native_libraries();
    let signatures = container.signatures.clone();
    let census = container.census.clone();
    let container_type = container.container_type;

    Ok(AndroidReport {
        container_type,
        manifest,
        dex_summaries,
        native_libraries,
        signatures,
        census,
    })
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn read_u16_le(slice: &[u8], offset: usize) -> Result<u16, AndroidError> {
    if offset + 2 > slice.len() {
        return Err(AndroidError::Truncated {
            offset,
            needed: 2,
            available: slice.len().saturating_sub(offset),
        });
    }
    Ok(u16::from_le_bytes([slice[offset], slice[offset + 1]]))
}

fn read_u32_le(slice: &[u8], offset: usize) -> Result<u32, AndroidError> {
    if offset + 4 > slice.len() {
        return Err(AndroidError::Truncated {
            offset,
            needed: 4,
            available: slice.len().saturating_sub(offset),
        });
    }
    Ok(u32::from_le_bytes([slice[offset], slice[offset + 1], slice[offset + 2], slice[offset + 3]]))
}

fn read_u64_le(slice: &[u8], offset: usize) -> Result<u64, AndroidError> {
    if offset + 8 > slice.len() {
        return Err(AndroidError::Truncated {
            offset,
            needed: 8,
            available: slice.len().saturating_sub(offset),
        });
    }
    let mut arr = [0u8; 8];
    arr.copy_from_slice(&slice[offset..offset + 8]);
    Ok(u64::from_le_bytes(arr))
}

fn find_and_parse_eocd(bytes: &[u8]) -> Result<(usize, u64, u64, u16), AndroidError> {
    if bytes.len() < 22 {
        return Err(AndroidError::EocdNotFound);
    }

    // The maximum comment length in ZIP is 65535, so EOCD is within the last 65557 bytes
    let scan_start = bytes.len().saturating_sub(65535 + 22);
    let mut pos = bytes.len() - 22;

    while pos >= scan_start {
        if read_u32_le(bytes, pos).unwrap_or(0) == EOCD_SIGNATURE {
            let total_entries = read_u16_le(bytes, pos + 10)?;
            let cd_size = read_u32_le(bytes, pos + 12)? as u64;
            let cd_offset = read_u32_le(bytes, pos + 16)? as u64;
            let comment_len = read_u16_le(bytes, pos + 20)? as usize;

            if pos + 22 + comment_len <= bytes.len() {
                return Ok((pos, cd_offset, cd_size, total_entries));
            }
        }
        if pos == 0 {
            break;
        }
        pos -= 1;
    }

    Err(AndroidError::EocdNotFound)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_dex_header_and_classes() {
        // Build a synthetic valid DEX binary
        let mut dex = vec![0u8; 256];
        dex[0..8].copy_from_slice(b"dex\n035\0");
        dex[8..12].copy_from_slice(&0x12345678u32.to_le_bytes()); // checksum
        dex[32..36].copy_from_slice(&256u32.to_le_bytes()); // file_size
        dex[36..40].copy_from_slice(&112u32.to_le_bytes()); // header_size
        dex[40..44].copy_from_slice(&0x12345678u32.to_le_bytes()); // endian_tag

        // 1 string id at offset 120
        dex[56..60].copy_from_slice(&1u32.to_le_bytes());
        dex[60..64].copy_from_slice(&120u32.to_le_bytes());
        // String offset points to 140
        dex[120..124].copy_from_slice(&140u32.to_le_bytes());

        // String at 140: ULEB128 len = 19, string = "Lcom/test/MyClass;"
        let str_val = b"Lcom/test/MyClass;\0";
        dex[140] = 18; // uleb128 char count
        dex[141..141 + str_val.len()].copy_from_slice(str_val);

        // 1 type id at offset 170 pointing to string 0
        dex[64..68].copy_from_slice(&1u32.to_le_bytes());
        dex[68..72].copy_from_slice(&170u32.to_le_bytes());
        dex[170..174].copy_from_slice(&0u32.to_le_bytes());

        // 1 class def at offset 180
        dex[96..100].copy_from_slice(&1u32.to_le_bytes());
        dex[100..104].copy_from_slice(&180u32.to_le_bytes());
        // class_idx = 0
        dex[180..184].copy_from_slice(&0u32.to_le_bytes());
        // access_flags = ACC_PUBLIC (1)
        dex[184..188].copy_from_slice(&1u32.to_le_bytes());
        // superclass_idx = NO_INDEX (0xFFFFFFFF)
        dex[188..192].copy_from_slice(&0xFFFF_FFFFu32.to_le_bytes());
        // source_file_idx = NO_INDEX
        dex[196..200].copy_from_slice(&0xFFFF_FFFFu32.to_le_bytes());

        let summary = DexFile::parse(&dex).expect("dex parse should succeed");
        assert_eq!(summary.version, "035");
        assert_eq!(summary.class_defs_count, 1);
        assert_eq!(summary.classes.len(), 1);
        assert_eq!(summary.classes[0].descriptor, "Lcom/test/MyClass;");
        assert_eq!(summary.classes[0].access_flags, 1);
    }

    #[test]
    fn test_axml_manifest_decoder() {
        // Construct a minimal valid AXML document containing a string pool and a start/end element
        let mut axml = Vec::new();

        // String pool chunk:
        // strings: ["manifest", "package", "com.aphrody.demo", "versionCode", "uses-permission", "android.permission.INTERNET"]
        let strings = vec![
            "manifest",
            "package",
            "com.aphrody.demo",
            "versionCode",
            "uses-permission",
            "android.permission.INTERNET",
            "name",
        ];

        let mut pool_chunk = Vec::new();
        // chunk_type = 0x0001 (RES_STRING_POOL_TYPE), header_size = 28
        pool_chunk.extend_from_slice(&1u16.to_le_bytes());
        pool_chunk.extend_from_slice(&28u16.to_le_bytes());
        let pool_size_pos = pool_chunk.len();
        pool_chunk.extend_from_slice(&0u32.to_le_bytes()); // placeholder chunk_size
        pool_chunk.extend_from_slice(&(strings.len() as u32).to_le_bytes());
        pool_chunk.extend_from_slice(&0u32.to_le_bytes()); // style count
        pool_chunk.extend_from_slice(&(1u32 << 8).to_le_bytes()); // flags: UTF-8
        let str_start_pos = 28 + strings.len() * 4;
        pool_chunk.extend_from_slice(&(str_start_pos as u32).to_le_bytes());
        pool_chunk.extend_from_slice(&0u32.to_le_bytes()); // styles start

        let mut str_bytes = Vec::new();
        let mut offsets = Vec::new();
        for s in &strings {
            offsets.push(str_bytes.len() as u32);
            // UTF-8 encoding: char len (1 byte), byte len (1 byte), bytes, null byte
            str_bytes.push(s.len() as u8);
            str_bytes.push(s.len() as u8);
            str_bytes.extend_from_slice(s.as_bytes());
            str_bytes.push(0);
        }

        for off in offsets {
            pool_chunk.extend_from_slice(&off.to_le_bytes());
        }
        pool_chunk.extend_from_slice(&str_bytes);
        let pool_chunk_size = pool_chunk.len() as u32;
        pool_chunk[pool_size_pos..pool_size_pos + 4]
            .copy_from_slice(&pool_chunk_size.to_le_bytes());

        // Start element: <manifest package="com.aphrody.demo" versionCode="42">
        let mut start_elem = Vec::new();
        start_elem.extend_from_slice(&0x0102u16.to_le_bytes()); // RES_XML_START_ELEMENT_TYPE
        start_elem.extend_from_slice(&16u16.to_le_bytes()); // header_size
        let start_elem_size_pos = start_elem.len();
        start_elem.extend_from_slice(&0u32.to_le_bytes()); // chunk_size placeholder
        start_elem.extend_from_slice(&1u32.to_le_bytes()); // line number
        start_elem.extend_from_slice(&0xFFFF_FFFFu32.to_le_bytes()); // comment
        start_elem.extend_from_slice(&0xFFFF_FFFFu32.to_le_bytes()); // ns = none
        start_elem.extend_from_slice(&0u32.to_le_bytes()); // name_idx = 0 ("manifest")
        start_elem.extend_from_slice(&20u16.to_le_bytes()); // attr_start
        start_elem.extend_from_slice(&20u16.to_le_bytes()); // attr_size
        start_elem.extend_from_slice(&2u16.to_le_bytes()); // attr_count = 2
        start_elem.extend_from_slice(&0u16.to_le_bytes()); // id index
        start_elem.extend_from_slice(&0u16.to_le_bytes()); // class index
        start_elem.extend_from_slice(&0u16.to_le_bytes()); // style index

        // Attribute 1: package="com.aphrody.demo"
        start_elem.extend_from_slice(&0xFFFF_FFFFu32.to_le_bytes()); // ns
        start_elem.extend_from_slice(&1u32.to_le_bytes()); // name_idx = 1 ("package")
        start_elem.extend_from_slice(&2u32.to_le_bytes()); // raw_val = 2 ("com.aphrody.demo")
        start_elem.extend_from_slice(&8u16.to_le_bytes()); // typed size
        start_elem.push(0); // res0
        start_elem.push(0x03); // type = string
        start_elem.extend_from_slice(&2u32.to_le_bytes()); // data = 2

        // Attribute 2: versionCode=42
        start_elem.extend_from_slice(&0xFFFF_FFFFu32.to_le_bytes()); // ns
        start_elem.extend_from_slice(&3u32.to_le_bytes()); // name_idx = 3 ("versionCode")
        start_elem.extend_from_slice(&0xFFFF_FFFFu32.to_le_bytes()); // raw_val = none
        start_elem.extend_from_slice(&8u16.to_le_bytes()); // typed size
        start_elem.push(0); // res0
        start_elem.push(0x10); // type = int_dec
        start_elem.extend_from_slice(&42u32.to_le_bytes()); // data = 42

        let start_elem_size = start_elem.len() as u32;
        start_elem[start_elem_size_pos..start_elem_size_pos + 4]
            .copy_from_slice(&start_elem_size.to_le_bytes());

        // Inner element: <uses-permission name="android.permission.INTERNET" />
        let mut perm_elem = Vec::new();
        perm_elem.extend_from_slice(&0x0102u16.to_le_bytes());
        perm_elem.extend_from_slice(&16u16.to_le_bytes());
        let perm_elem_size_pos = perm_elem.len();
        perm_elem.extend_from_slice(&0u32.to_le_bytes());
        perm_elem.extend_from_slice(&2u32.to_le_bytes());
        perm_elem.extend_from_slice(&0xFFFF_FFFFu32.to_le_bytes());
        perm_elem.extend_from_slice(&0xFFFF_FFFFu32.to_le_bytes());
        perm_elem.extend_from_slice(&4u32.to_le_bytes()); // "uses-permission"
        perm_elem.extend_from_slice(&20u16.to_le_bytes());
        perm_elem.extend_from_slice(&20u16.to_le_bytes());
        perm_elem.extend_from_slice(&1u16.to_le_bytes()); // 1 attribute
        perm_elem.extend_from_slice(&0u16.to_le_bytes());
        perm_elem.extend_from_slice(&0u16.to_le_bytes());
        perm_elem.extend_from_slice(&0u16.to_le_bytes());

        // Attribute: name="android.permission.INTERNET"
        perm_elem.extend_from_slice(&0xFFFF_FFFFu32.to_le_bytes());
        perm_elem.extend_from_slice(&6u32.to_le_bytes()); // "name"
        perm_elem.extend_from_slice(&5u32.to_le_bytes()); // "android.permission.INTERNET"
        perm_elem.extend_from_slice(&8u16.to_le_bytes());
        perm_elem.push(0);
        perm_elem.push(0x03);
        perm_elem.extend_from_slice(&5u32.to_le_bytes());

        let perm_elem_size = perm_elem.len() as u32;
        perm_elem[perm_elem_size_pos..perm_elem_size_pos + 4]
            .copy_from_slice(&perm_elem_size.to_le_bytes());

        // End inner element
        let mut perm_end = Vec::new();
        perm_end.extend_from_slice(&0x0103u16.to_le_bytes());
        perm_end.extend_from_slice(&16u16.to_le_bytes());
        perm_end.extend_from_slice(&24u32.to_le_bytes()); // chunk_size
        perm_end.extend_from_slice(&2u32.to_le_bytes());
        perm_end.extend_from_slice(&0xFFFF_FFFFu32.to_le_bytes());
        perm_end.extend_from_slice(&0xFFFF_FFFFu32.to_le_bytes());
        perm_end.extend_from_slice(&4u32.to_le_bytes()); // "uses-permission"

        // End element: </manifest>
        let mut end_elem = Vec::new();
        end_elem.extend_from_slice(&0x0103u16.to_le_bytes()); // RES_XML_END_ELEMENT_TYPE
        end_elem.extend_from_slice(&16u16.to_le_bytes());
        end_elem.extend_from_slice(&24u32.to_le_bytes());
        end_elem.extend_from_slice(&3u32.to_le_bytes());
        end_elem.extend_from_slice(&0xFFFF_FFFFu32.to_le_bytes());
        end_elem.extend_from_slice(&0xFFFF_FFFFu32.to_le_bytes());
        end_elem.extend_from_slice(&0u32.to_le_bytes()); // "manifest"

        // Assemble root XML chunk
        let total_size = 8
            + pool_chunk.len()
            + start_elem.len()
            + perm_elem.len()
            + perm_end.len()
            + end_elem.len();
        axml.extend_from_slice(&0x0003u16.to_le_bytes()); // RES_XML_TYPE
        axml.extend_from_slice(&8u16.to_le_bytes()); // header_size
        axml.extend_from_slice(&(total_size as u32).to_le_bytes());
        axml.extend_from_slice(&pool_chunk);
        axml.extend_from_slice(&start_elem);
        axml.extend_from_slice(&perm_elem);
        axml.extend_from_slice(&perm_end);
        axml.extend_from_slice(&end_elem);

        let manifest = AxmlDecoder::parse(&axml).expect("axml should parse successfully");
        assert_eq!(manifest.package, "com.aphrody.demo");
        assert_eq!(manifest.version_code, Some(42));
        assert_eq!(manifest.permissions, vec!["android.permission.INTERNET"]);
    }

    #[test]
    fn test_synthetic_apk_with_signing_block_and_census() {
        // Build a synthetic APK with stored entries, an APK Signing Block v2/v3, and Central Directory
        let mut apk = Vec::new();

        // 1. Entry 1: AndroidManifest.xml (stored)
        let manifest_content = b"<manifest />";
        let e1_loc = apk.len();
        apk.extend_from_slice(&LOCAL_HEADER_SIGNATURE.to_le_bytes());
        apk.extend_from_slice(&20u16.to_le_bytes()); // version
        apk.extend_from_slice(&0u16.to_le_bytes()); // flags
        apk.extend_from_slice(&0u16.to_le_bytes()); // compression = 0
        apk.extend_from_slice(&0u32.to_le_bytes()); // time/date
        let mut h1 = crc32fast::Hasher::new();
        h1.update(manifest_content);
        let e1_crc = h1.finalize();
        apk.extend_from_slice(&e1_crc.to_le_bytes());
        apk.extend_from_slice(&(manifest_content.len() as u32).to_le_bytes());
        apk.extend_from_slice(&(manifest_content.len() as u32).to_le_bytes());
        apk.extend_from_slice(&(b"AndroidManifest.xml".len() as u16).to_le_bytes());
        apk.extend_from_slice(&0u16.to_le_bytes()); // extra_len
        apk.extend_from_slice(b"AndroidManifest.xml");
        apk.extend_from_slice(manifest_content);

        // 2. Entry 2: lib/arm64-v8a/libnative.so (stored)
        let lib_content = b"\x7fELFfake_arm64_so";
        let e2_loc = apk.len();
        apk.extend_from_slice(&LOCAL_HEADER_SIGNATURE.to_le_bytes());
        apk.extend_from_slice(&20u16.to_le_bytes());
        apk.extend_from_slice(&0u16.to_le_bytes());
        apk.extend_from_slice(&0u16.to_le_bytes());
        apk.extend_from_slice(&0u32.to_le_bytes());
        let mut h2 = crc32fast::Hasher::new();
        h2.update(lib_content);
        let e2_crc = h2.finalize();
        apk.extend_from_slice(&e2_crc.to_le_bytes());
        apk.extend_from_slice(&(lib_content.len() as u32).to_le_bytes());
        apk.extend_from_slice(&(lib_content.len() as u32).to_le_bytes());
        let lib_path = b"lib/arm64-v8a/libnative.so";
        apk.extend_from_slice(&(lib_path.len() as u16).to_le_bytes());
        apk.extend_from_slice(&0u16.to_le_bytes());
        apk.extend_from_slice(lib_path);
        apk.extend_from_slice(lib_content);

        // 3. APK Signing Block immediately preceding Central Directory
        // Pair 1: v2 signature scheme (0x7109871a) with 4 dummy bytes
        // pair_size = 4 (id) + 4 (data) = 8
        let mut sig_block_pairs = Vec::new();
        sig_block_pairs.extend_from_slice(&8u64.to_le_bytes()); // pair len
        sig_block_pairs
            .extend_from_slice(&sig_scheme_ids::APK_SIGNATURE_SCHEME_V2_BLOCK_ID.to_le_bytes());
        sig_block_pairs.extend_from_slice(&[1, 2, 3, 4]);

        // Pair 2: v3 signature scheme (0xf05368c0) with 4 dummy bytes
        sig_block_pairs.extend_from_slice(&8u64.to_le_bytes());
        sig_block_pairs
            .extend_from_slice(&sig_scheme_ids::APK_SIGNATURE_SCHEME_V3_BLOCK_ID.to_le_bytes());
        sig_block_pairs.extend_from_slice(&[5, 6, 7, 8]);

        // Total block size = len(pairs) + 8 (block_size_end) + 16 (magic)
        let block_size = (sig_block_pairs.len() + 24) as u64;

        apk.extend_from_slice(&block_size.to_le_bytes());
        apk.extend_from_slice(&sig_block_pairs);
        apk.extend_from_slice(&block_size.to_le_bytes());
        apk.extend_from_slice(APK_SIG_BLOCK_MAGIC);

        // 4. Central Directory starts right here
        let cd_offset = apk.len() as u64;

        // CD Entry 1
        let cd1_start = apk.len();
        apk.extend_from_slice(&CD_HEADER_SIGNATURE.to_le_bytes());
        apk.extend_from_slice(&20u16.to_le_bytes());
        apk.extend_from_slice(&20u16.to_le_bytes());
        apk.extend_from_slice(&0u16.to_le_bytes());
        apk.extend_from_slice(&0u16.to_le_bytes());
        apk.extend_from_slice(&0u32.to_le_bytes());
        apk.extend_from_slice(&e1_crc.to_le_bytes());
        apk.extend_from_slice(&(manifest_content.len() as u32).to_le_bytes());
        apk.extend_from_slice(&(manifest_content.len() as u32).to_le_bytes());
        apk.extend_from_slice(&(b"AndroidManifest.xml".len() as u16).to_le_bytes());
        apk.extend_from_slice(&0u16.to_le_bytes()); // extra len
        apk.extend_from_slice(&0u16.to_le_bytes()); // comment len
        apk.extend_from_slice(&0u16.to_le_bytes()); // disk
        apk.extend_from_slice(&0u16.to_le_bytes()); // int attr
        apk.extend_from_slice(&0u32.to_le_bytes()); // ext attr
        apk.extend_from_slice(&(e1_loc as u32).to_le_bytes());
        apk.extend_from_slice(b"AndroidManifest.xml");

        // CD Entry 2
        apk.extend_from_slice(&CD_HEADER_SIGNATURE.to_le_bytes());
        apk.extend_from_slice(&20u16.to_le_bytes());
        apk.extend_from_slice(&20u16.to_le_bytes());
        apk.extend_from_slice(&0u16.to_le_bytes());
        apk.extend_from_slice(&0u16.to_le_bytes());
        apk.extend_from_slice(&0u32.to_le_bytes());
        apk.extend_from_slice(&e2_crc.to_le_bytes());
        apk.extend_from_slice(&(lib_content.len() as u32).to_le_bytes());
        apk.extend_from_slice(&(lib_content.len() as u32).to_le_bytes());
        apk.extend_from_slice(&(lib_path.len() as u16).to_le_bytes());
        apk.extend_from_slice(&0u16.to_le_bytes());
        apk.extend_from_slice(&0u16.to_le_bytes());
        apk.extend_from_slice(&0u16.to_le_bytes());
        apk.extend_from_slice(&0u16.to_le_bytes());
        apk.extend_from_slice(&0u32.to_le_bytes());
        apk.extend_from_slice(&(e2_loc as u32).to_le_bytes());
        apk.extend_from_slice(lib_path);

        let cd_size = (apk.len() - cd1_start) as u64;

        // 5. End of Central Directory (EOCD)
        apk.extend_from_slice(&EOCD_SIGNATURE.to_le_bytes());
        apk.extend_from_slice(&0u16.to_le_bytes()); // disk
        apk.extend_from_slice(&0u16.to_le_bytes()); // start disk
        apk.extend_from_slice(&2u16.to_le_bytes()); // entries on disk
        apk.extend_from_slice(&2u16.to_le_bytes()); // total entries
        apk.extend_from_slice(&(cd_size as u32).to_le_bytes());
        apk.extend_from_slice(&(cd_offset as u32).to_le_bytes());
        apk.extend_from_slice(&0u16.to_le_bytes()); // comment len

        let container = AndroidContainer::parse(&apk).expect("apk parse must succeed");
        assert_eq!(container.container_type, AndroidContainerType::Apk);
        assert_eq!(container.census.total_files, 2);
        assert_eq!(container.census.native_libraries.len(), 1);
        assert!(container.signatures.has_signing_block);
        assert!(container.signatures.v2_scheme);
        assert!(container.signatures.v3_scheme);
        assert!(!container.signatures.v3_1_scheme);

        let nlibs = container.native_libraries();
        assert!(nlibs.contains_key(&AndroidAbi::Arm64V8a));
        assert_eq!(nlibs[&AndroidAbi::Arm64V8a][0].name, "libnative.so");

        // Read entry content and verify CRC
        let read_manifest = container.read_entry("AndroidManifest.xml").expect("read entry");
        assert_eq!(read_manifest, manifest_content);
    }

    #[test]
    fn test_compressed_apk_entry_deflate() {
        use flate2::Compression;
        use flate2::write::DeflateEncoder;
        use std::io::Write;

        let raw_payload = b"Hello Android World from a deflated classes.dex payload that repeats for compression efficiency! ".repeat(10);
        let mut encoder = DeflateEncoder::new(Vec::new(), Compression::default());
        encoder.write_all(&raw_payload).expect("deflate write");
        let compressed = encoder.finish().expect("deflate finish");

        let mut h = crc32fast::Hasher::new();
        h.update(&raw_payload);
        let crc = h.finalize();

        let mut apk = Vec::new();
        let e_loc = apk.len();
        apk.extend_from_slice(&LOCAL_HEADER_SIGNATURE.to_le_bytes());
        apk.extend_from_slice(&20u16.to_le_bytes());
        apk.extend_from_slice(&0u16.to_le_bytes());
        apk.extend_from_slice(&8u16.to_le_bytes()); // compression = 8 (Deflate)
        apk.extend_from_slice(&0u32.to_le_bytes());
        apk.extend_from_slice(&crc.to_le_bytes());
        apk.extend_from_slice(&(compressed.len() as u32).to_le_bytes());
        apk.extend_from_slice(&(raw_payload.len() as u32).to_le_bytes());
        apk.extend_from_slice(&(b"classes.dex".len() as u16).to_le_bytes());
        apk.extend_from_slice(&0u16.to_le_bytes());
        apk.extend_from_slice(b"classes.dex");
        apk.extend_from_slice(&compressed);

        let cd_offset = apk.len() as u64;
        let cd_start = apk.len();
        apk.extend_from_slice(&CD_HEADER_SIGNATURE.to_le_bytes());
        apk.extend_from_slice(&20u16.to_le_bytes());
        apk.extend_from_slice(&20u16.to_le_bytes());
        apk.extend_from_slice(&0u16.to_le_bytes());
        apk.extend_from_slice(&8u16.to_le_bytes()); // Deflate
        apk.extend_from_slice(&0u32.to_le_bytes());
        apk.extend_from_slice(&crc.to_le_bytes());
        apk.extend_from_slice(&(compressed.len() as u32).to_le_bytes());
        apk.extend_from_slice(&(raw_payload.len() as u32).to_le_bytes());
        apk.extend_from_slice(&(b"classes.dex".len() as u16).to_le_bytes());
        apk.extend_from_slice(&0u16.to_le_bytes());
        apk.extend_from_slice(&0u16.to_le_bytes());
        apk.extend_from_slice(&0u16.to_le_bytes());
        apk.extend_from_slice(&0u16.to_le_bytes());
        apk.extend_from_slice(&0u32.to_le_bytes());
        apk.extend_from_slice(&(e_loc as u32).to_le_bytes());
        apk.extend_from_slice(b"classes.dex");

        let cd_size = (apk.len() - cd_start) as u64;
        apk.extend_from_slice(&EOCD_SIGNATURE.to_le_bytes());
        apk.extend_from_slice(&0u16.to_le_bytes());
        apk.extend_from_slice(&0u16.to_le_bytes());
        apk.extend_from_slice(&1u16.to_le_bytes());
        apk.extend_from_slice(&1u16.to_le_bytes());
        apk.extend_from_slice(&(cd_size as u32).to_le_bytes());
        apk.extend_from_slice(&(cd_offset as u32).to_le_bytes());
        apk.extend_from_slice(&0u16.to_le_bytes());

        let container = AndroidContainer::parse(&apk).expect("parse deflated apk");
        let decomp = container.read_entry("classes.dex").expect("decompress entry");
        assert_eq!(decomp, raw_payload);
    }

    #[test]
    fn test_aab_detection_and_census() {
        let mut aab = Vec::new();
        let paths: &[&[u8]] = &[
            b"base/manifest/AndroidManifest.xml",
            b"base/dex/classes.dex",
            b"base/lib/x86_64/libengine.so",
            b"BUNDLE-METADATA/com.android.tools.build.gradle/app-metadata.properties",
        ];

        let mut cd_entries = Vec::new();
        for path in paths {
            let loc = aab.len();
            let content = b"stub_payload";
            let mut h = crc32fast::Hasher::new();
            h.update(content);
            let crc = h.finalize();

            aab.extend_from_slice(&LOCAL_HEADER_SIGNATURE.to_le_bytes());
            aab.extend_from_slice(&20u16.to_le_bytes());
            aab.extend_from_slice(&0u16.to_le_bytes());
            aab.extend_from_slice(&0u16.to_le_bytes());
            aab.extend_from_slice(&0u32.to_le_bytes());
            aab.extend_from_slice(&crc.to_le_bytes());
            aab.extend_from_slice(&(content.len() as u32).to_le_bytes());
            aab.extend_from_slice(&(content.len() as u32).to_le_bytes());
            aab.extend_from_slice(&(path.len() as u16).to_le_bytes());
            aab.extend_from_slice(&0u16.to_le_bytes());
            aab.extend_from_slice(path);
            aab.extend_from_slice(content);

            cd_entries.push((path, loc, crc, content.len() as u32));
        }

        let cd_offset = aab.len() as u64;
        let cd_start = aab.len();
        for (path, loc, crc, sz) in cd_entries {
            aab.extend_from_slice(&CD_HEADER_SIGNATURE.to_le_bytes());
            aab.extend_from_slice(&20u16.to_le_bytes());
            aab.extend_from_slice(&20u16.to_le_bytes());
            aab.extend_from_slice(&0u16.to_le_bytes());
            aab.extend_from_slice(&0u16.to_le_bytes());
            aab.extend_from_slice(&0u32.to_le_bytes());
            aab.extend_from_slice(&crc.to_le_bytes());
            aab.extend_from_slice(&sz.to_le_bytes());
            aab.extend_from_slice(&sz.to_le_bytes());
            aab.extend_from_slice(&(path.len() as u16).to_le_bytes());
            aab.extend_from_slice(&0u16.to_le_bytes());
            aab.extend_from_slice(&0u16.to_le_bytes());
            aab.extend_from_slice(&0u16.to_le_bytes());
            aab.extend_from_slice(&0u16.to_le_bytes());
            aab.extend_from_slice(&0u32.to_le_bytes());
            aab.extend_from_slice(&(loc as u32).to_le_bytes());
            aab.extend_from_slice(path);
        }

        let cd_size = (aab.len() - cd_start) as u64;
        aab.extend_from_slice(&EOCD_SIGNATURE.to_le_bytes());
        aab.extend_from_slice(&0u16.to_le_bytes());
        aab.extend_from_slice(&0u16.to_le_bytes());
        aab.extend_from_slice(&(paths.len() as u16).to_le_bytes());
        aab.extend_from_slice(&(paths.len() as u16).to_le_bytes());
        aab.extend_from_slice(&(cd_size as u32).to_le_bytes());
        aab.extend_from_slice(&(cd_offset as u32).to_le_bytes());
        aab.extend_from_slice(&0u16.to_le_bytes());

        let container = AndroidContainer::parse(&aab).expect("parse aab");
        assert_eq!(container.container_type, AndroidContainerType::Aab);
        assert_eq!(container.census.total_files, 4);
        assert_eq!(container.census.manifest_files.len(), 1);
        assert_eq!(container.census.dex_files.len(), 1);

        let nlibs = container.native_libraries();
        assert!(nlibs.contains_key(&AndroidAbi::X86_64));
        assert_eq!(nlibs[&AndroidAbi::X86_64][0].name, "libengine.so");
    }

    #[test]
    fn test_v1_jar_signature_scheme() {
        let entries = vec![
            ZipEntryInfo {
                path: "META-INF/MANIFEST.MF".to_string(),
                uncompressed_size: 100,
                compressed_size: 100,
                compression_method: 0,
                crc32: 0,
                local_header_offset: 0,
            },
            ZipEntryInfo {
                path: "META-INF/CERT.SF".to_string(),
                uncompressed_size: 100,
                compressed_size: 100,
                compression_method: 0,
                crc32: 0,
                local_header_offset: 0,
            },
            ZipEntryInfo {
                path: "META-INF/CERT.RSA".to_string(),
                uncompressed_size: 1000,
                compressed_size: 1000,
                compression_method: 0,
                crc32: 0,
                local_header_offset: 0,
            },
        ];

        let sigs = detect_apk_signatures(&[], 0, &entries);
        assert!(sigs.v1_jar_signed);
        assert_eq!(sigs.v1_signature_files.len(), 3);
        assert!(!sigs.has_signing_block);
    }

    #[test]
    fn test_dex_mutf8_null_and_complex_classes() {
        let mut dex = vec![0u8; 512];
        dex[0..8].copy_from_slice(b"dex\n039\0");
        dex[8..12].copy_from_slice(&0x44332211u32.to_le_bytes());
        dex[32..36].copy_from_slice(&512u32.to_le_bytes());
        dex[36..40].copy_from_slice(&112u32.to_le_bytes());
        dex[40..44].copy_from_slice(&DEX_ENDIAN_CONSTANT.to_le_bytes());

        // 3 strings:
        // 0: "Lcom/foo/Service;"
        // 1: "Ljava/lang/Object;"
        // 2: "Service.java"
        dex[56..60].copy_from_slice(&3u32.to_le_bytes()); // string_ids_size
        dex[60..64].copy_from_slice(&120u32.to_le_bytes()); // string_ids_off

        dex[120..124].copy_from_slice(&140u32.to_le_bytes());
        dex[124..128].copy_from_slice(&180u32.to_le_bytes());
        dex[128..132].copy_from_slice(&220u32.to_le_bytes());

        // String 0 at 140: "Lcom/foo/Service;\0"
        dex[140] = 17;
        dex[141..141 + 18].copy_from_slice(b"Lcom/foo/Service;\0");

        // String 1 at 180: "Ljava/lang/Object;\0"
        dex[180] = 18;
        dex[181..181 + 19].copy_from_slice(b"Ljava/lang/Object;\0");

        // String 2 at 220: "Service.java\0"
        dex[220] = 12;
        dex[221..221 + 13].copy_from_slice(b"Service.java\0");

        // 2 types:
        // 0: string 0
        // 1: string 1
        dex[64..68].copy_from_slice(&2u32.to_le_bytes());
        dex[68..72].copy_from_slice(&240u32.to_le_bytes());
        dex[240..244].copy_from_slice(&0u32.to_le_bytes());
        dex[244..248].copy_from_slice(&1u32.to_le_bytes());

        // 1 class def at offset 260
        dex[96..100].copy_from_slice(&1u32.to_le_bytes());
        dex[100..104].copy_from_slice(&260u32.to_le_bytes());
        dex[260..264].copy_from_slice(&0u32.to_le_bytes()); // class_idx = 0 (Lcom/foo/Service;)
        dex[264..268].copy_from_slice(
            &(dex_access_flags::ACC_PUBLIC | dex_access_flags::ACC_ABSTRACT).to_le_bytes(),
        );
        dex[268..272].copy_from_slice(&1u32.to_le_bytes()); // superclass = 1 (Ljava/lang/Object;)
        dex[276..280].copy_from_slice(&2u32.to_le_bytes()); // source_file = 2 (Service.java)

        let summary = DexFile::parse(&dex).expect("dex parse");
        assert_eq!(summary.version, "039");
        assert_eq!(summary.classes.len(), 1);
        let c = &summary.classes[0];
        assert_eq!(c.descriptor, "Lcom/foo/Service;");
        assert_eq!(c.superclass, Some("Ljava/lang/Object;".to_string()));
        assert_eq!(c.source_file, Some("Service.java".to_string()));
        assert_eq!(c.access_flags, dex_access_flags::ACC_PUBLIC | dex_access_flags::ACC_ABSTRACT);
    }

    #[test]
    fn test_corrupt_apk_errors() {
        assert!(matches!(
            AndroidContainer::parse(b"not a zip binary"),
            Err(AndroidError::EocdNotFound)
        ));

        assert!(matches!(
            DexFile::parse(b"corrupt dex binary"),
            Err(AndroidError::Truncated { .. })
        ));

        assert!(matches!(
            DexFile::parse(b"dex\n035\0\0\0\0\0short_header"),
            Err(AndroidError::Truncated { .. })
        ));
    }
}
