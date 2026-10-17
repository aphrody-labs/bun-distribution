// SPDX-License-Identifier: Apache-2.0
//! Container readers behind one trait. Each reader lists its entries from the container's own
//! index and reads one entry at a time with positioned reads; none extracts a whole archive.

pub mod cpk;
pub mod godot;
pub mod iostore;
pub mod pak;
pub mod rpa;
pub mod unity;
pub mod zip;

use std::{io::Read, path::Path};

use serde::Serialize;

use super::{AssetError, AssetResult, Keys};

/// One file inside a container.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveEntry {
    /// Normalised path inside the container (`/` separators, mount point applied).
    pub path: String,
    /// Uncompressed size in bytes.
    pub size: u64,
    /// Stored (compressed, padded) size in bytes.
    pub stored: u64,
    /// Compression method name, `""` when stored.
    pub compression: String,
    /// True when the entry payload is encrypted.
    pub encrypted: bool,
}

/// A mounted container.
pub trait Archive: Send + Sync {
    /// Container family (`cpk`, `unreal-pak`, `unreal-iostore`, `unityfs`, `godot-pck`,
    /// `renpy-rpa`, `zip`).
    fn format(&self) -> &'static str;
    /// Container path relative to the install root.
    fn label(&self) -> &str;
    /// Entries in container order.
    fn entries(&self) -> &[ArchiveEntry];
    /// Read and decode entry `index`.
    ///
    /// # Errors
    /// I/O, malformed data, missing user key or unsupported codec.
    fn read(&self, index: usize) -> AssetResult<Vec<u8>>;
    /// Container metadata worth reporting (version, mount point, flags).
    fn info(&self) -> serde_json::Value {
        serde_json::Value::Null
    }
}

/// Archive families recognised from a file name and its first bytes.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum ArchiveKind {
    /// CRI `CPK ` archive.
    Cpk,
    /// CRI-shaped `.cpk` whose header is not `CPK ` (encrypted with an unknown key).
    CpkEncrypted,
    /// Unreal Engine `.pak`.
    UnrealPak,
    /// Unreal Engine IoStore `.utoc` (with `.ucas` payloads).
    UnrealIoStore,
    /// Unity `UnityFS` asset bundle.
    UnityFs,
    /// Godot `GDPC` pack.
    GodotPck,
    /// Ren'Py `RPA-2.0`/`RPA-3.0` archive.
    RenPyRpa,
    /// ZIP (and `.pk3`, `.pak` zips).
    Zip,
    /// 7-Zip archive (detected, not mounted).
    SevenZip,
    /// Valve `.vpk` (detected, not mounted).
    Vpk,
}

/// Classify a file as an archive from its name and its first 16 bytes.
#[must_use]
pub fn sniff(name: &str, head: &[u8]) -> Option<ArchiveKind> {
    let lower = name.to_ascii_lowercase();
    let ext = lower.rsplit_once('.').map_or("", |(_, ext)| ext);
    if head.starts_with(b"CPK ") {
        return Some(ArchiveKind::Cpk);
    }
    if head.starts_with(iostore::TOC_MAGIC) {
        return Some(ArchiveKind::UnrealIoStore);
    }
    if head.starts_with(b"UnityFS\0") {
        return Some(ArchiveKind::UnityFs);
    }
    if head.starts_with(b"GDPC") {
        return Some(ArchiveKind::GodotPck);
    }
    if head.starts_with(b"RPA-3.0 ") || head.starts_with(b"RPA-2.0 ") {
        return Some(ArchiveKind::RenPyRpa);
    }
    if head.starts_with(b"PK\x03\x04") || head.starts_with(b"PK\x05\x06") {
        return Some(ArchiveKind::Zip);
    }
    if head.starts_with(b"7z\xBC\xAF\x27\x1C") {
        return Some(ArchiveKind::SevenZip);
    }
    if head.starts_with(&[0x34, 0x12, 0xAA, 0x55]) && ext == "vpk" {
        return Some(ArchiveKind::Vpk);
    }
    match ext {
        // Pak footers live at the end: the caller confirms with `pak::probe`.
        "pak" => Some(ArchiveKind::UnrealPak),
        "cpk" => Some(ArchiveKind::CpkEncrypted),
        _ => None,
    }
}

/// Open `path` as a mounted archive of `kind`. `label` is the path shown to users.
///
/// # Errors
/// Container errors; `Ok(None)` for kinds that are detected but not mounted.
pub fn open(
    kind: ArchiveKind,
    path: &Path,
    label: String,
    keys: &Keys,
) -> AssetResult<Option<Box<dyn Archive>>> {
    Ok(Some(match kind {
        ArchiveKind::Cpk => Box::new(cpk::CpkArchive::open(path, label)?),
        ArchiveKind::UnrealPak => Box::new(pak::PakArchive::open(path, label, keys)?),
        ArchiveKind::UnrealIoStore => Box::new(iostore::IoStoreArchive::open(path, label, keys)?),
        ArchiveKind::UnityFs => Box::new(unity::UnityFsArchive::open(path, label)?),
        ArchiveKind::GodotPck => Box::new(godot::PckArchive::open(path, label)?),
        ArchiveKind::RenPyRpa => Box::new(rpa::RpaArchive::open(path, label)?),
        ArchiveKind::Zip => Box::new(zip::ZipArchive::open(path, label)?),
        ArchiveKind::CpkEncrypted => {
            return Err(AssetError::KeyRequired(format!(
                "{label} (CPK header is not `CPK `)"
            )));
        }
        ArchiveKind::SevenZip | ArchiveKind::Vpk => return Ok(None),
    }))
}

/// Decompress one block with a named method (`zlib`, `gzip`, `lz4`, `none`).
///
/// # Errors
/// Unsupported methods (Oodle, Zstd, LZMA) and corrupt streams.
pub fn decompress(method: &str, data: &[u8], expected: usize) -> AssetResult<Vec<u8>> {
    let method = method.to_ascii_lowercase();
    let mut out = Vec::with_capacity(expected);
    match method.as_str() {
        "" | "none" => return Ok(data.to_vec()),
        "zlib" => {
            flate2::read::ZlibDecoder::new(data)
                .take(expected as u64)
                .read_to_end(&mut out)
                .map_err(|error| super::format_err("zlib", error.to_string()))?;
        }
        "gzip" => {
            flate2::read::GzDecoder::new(data)
                .take(expected as u64)
                .read_to_end(&mut out)
                .map_err(|error| super::format_err("gzip", error.to_string()))?;
        }
        "deflate" => {
            flate2::read::DeflateDecoder::new(data)
                .take(expected as u64)
                .read_to_end(&mut out)
                .map_err(|error| super::format_err("deflate", error.to_string()))?;
        }
        "lz4" | "lz4hc" => {
            out = lz4_flex::block::decompress(data, expected)
                .map_err(|error| super::format_err("lz4", error.to_string()))?;
        }
        other => {
            return Err(AssetError::Unsupported(format!(
                "`{other}` compression (proprietary or not linked)"
            )));
        }
    }
    if out.len() != expected {
        return Err(super::format_err(
            "decompress",
            format!("{method}: {} bytes instead of {expected}", out.len()),
        ));
    }
    Ok(out)
}

/// AES-256-ECB decryption in place (Unreal containers). `data.len()` must be a multiple of 16.
///
/// # Errors
/// A length that is not a multiple of the block size.
pub fn aes256_ecb_decrypt(key: &[u8; 32], data: &mut [u8]) -> AssetResult<()> {
    use aes::{
        Aes256, Block,
        cipher::{BlockCipherDecrypt, KeyInit},
    };
    if !data.len().is_multiple_of(16) {
        return Err(super::format_err(
            "aes",
            "encrypted length is not a multiple of 16",
        ));
    }
    let cipher = Aes256::new_from_slice(key).map_err(|_| super::format_err("aes", "bad key"))?;
    for chunk in data.chunks_exact_mut(16) {
        let mut block = Block::default();
        block.copy_from_slice(chunk);
        cipher.decrypt_block(&mut block);
        chunk.copy_from_slice(&block);
    }
    Ok(())
}

/// Round `value` up to a multiple of `to`.
#[must_use]
pub const fn align_up(value: u64, to: u64) -> u64 {
    value.div_ceil(to) * to
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sniffs_container_magics() {
        assert_eq!(sniff("a.cpk", b"CPK \0\0\0\0"), Some(ArchiveKind::Cpk));
        assert_eq!(
            sniff("a.cpk", b"\x12\x34\x56\x78"),
            Some(ArchiveKind::CpkEncrypted)
        );
        assert_eq!(
            sniff("x.utoc", b"-==--==--==--==-"),
            Some(ArchiveKind::UnrealIoStore)
        );
        assert_eq!(
            sniff("b.bundle", b"UnityFS\0\0\0\0\x08"),
            Some(ArchiveKind::UnityFs)
        );
        assert_eq!(
            sniff("g.pck", b"GDPC\x02\0\0\0"),
            Some(ArchiveKind::GodotPck)
        );
        assert_eq!(
            sniff("a.rpa", b"RPA-3.0 00000000"),
            Some(ArchiveKind::RenPyRpa)
        );
        assert_eq!(sniff("a.pk3", b"PK\x03\x04"), Some(ArchiveKind::Zip));
        assert_eq!(
            sniff("Game-Windows.pak", b"\0\0\0\0"),
            Some(ArchiveKind::UnrealPak)
        );
        assert_eq!(sniff("readme.txt", b"hello"), None);
    }

    #[test]
    fn decompresses_known_methods() {
        use std::io::Write;
        let mut encoder = flate2::write::ZlibEncoder::new(Vec::new(), flate2::Compression::fast());
        encoder.write_all(b"hello hello hello").unwrap();
        let packed = encoder.finish().unwrap();
        assert_eq!(
            decompress("Zlib", &packed, 17).unwrap(),
            b"hello hello hello"
        );
        let lz4 = lz4_flex::block::compress(b"abcabcabcabc");
        assert_eq!(decompress("LZ4", &lz4, 12).unwrap(), b"abcabcabcabc");
        assert!(matches!(
            decompress("Oodle", b"x", 1),
            Err(AssetError::Unsupported(_))
        ));
    }
}
