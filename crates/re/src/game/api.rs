// SPDX-License-Identifier: Apache-2.0
//! In-memory DBXV2 surface shared by the WebAssembly bindings and the `shenron-dbxv2` C ABI
//! (feature `dbxv2`): identify a buffer, list and extract plain CPK entries, summarise a
//! container or gameplay file as JSON, and decode CRI audio to WAV. Nothing here touches the
//! file system, so a host (browser, Bun, C) only ever hands over bytes it already owns.

use aphrody_nie_formats::cpk::{CpkEntry, CpkReader};
use serde::Serialize;
use serde_json::{Value, json};

#[cfg(feature = "dbxv2")]
use crate::game::convert;
use crate::game::{
    ReError, Result,
    formats::{
        cms::CmsFile, cus::CusFile, emb_archive::EmbArchive, emd::EmdFile, esk::EskFile,
        msg::MsgFile, pup::PupFile,
    },
    gameplay::{self, Loaded},
};

/// Format identification of one buffer.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FormatInfo {
    /// Lower-case extension the format is catalogued under (`emb`, `cpk`, `acb`...).
    pub format: &'static str,
    /// Catalogue category (`archive`, `model`, `texture`, `audio`, ...).
    pub category: &'static str,
    /// Whether [`summarize`] can turn this format into JSON.
    pub parsable: bool,
}

/// Category of a DBXV2 extension, from the dbxv2 `formats.json` catalogue.
pub fn category_of(extension: &str) -> &'static str {
    match extension {
        "cpk" => "archive",
        "emd" | "emo" | "nsk" | "emg" => "model",
        "esk" => "skeleton",
        "ean" | "cam" => "animation",
        "bac" | "bcm" | "bdm" | "bsa" | "bas" => "battle",
        "bai" => "ai",
        "bcs" | "cms" | "cus" | "cso" | "psc" | "pup" => "character",
        "eepk" | "emp" | "etr" | "ecf" | "aur" | "ait" => "effect",
        "emb" | "emm" | "dds" | "dyt" => "texture",
        "hca" | "acb" | "awb" | "afs2" | "adx" | "csb" | "aax" => "audio",
        "usm" => "video",
        "msg" => "text",
        "idb" => "data",
        "qxd" | "qml" | "tsd" | "tnl" | "tsr" => "quest",
        "iggy" | "gfx" => "ui",
        "spm" | "map" => "stage",
        "sds" => "shader",
        "vlc" => "system",
        _ => "unknown",
    }
}

const KNOWN: [&str; 46] = [
    "cpk", "emd", "emo", "nsk", "emg", "esk", "ean", "cam", "bac", "bcm", "bdm", "bsa", "bas",
    "bai", "bcs", "cms", "cus", "cso", "psc", "pup", "eepk", "emp", "etr", "ecf", "aur", "ait",
    "emb", "emm", "dds", "dyt", "hca", "acb", "awb", "afs2", "adx", "usm", "msg", "idb", "qxd",
    "qml", "tsd", "tnl", "tsr", "iggy", "gfx", "spm",
];

#[cfg(feature = "dbxv2")]
fn bare_audio(bytes: &[u8]) -> Option<&'static str> {
    use aphrody_nie_formats::cri_audio::{is_adx, is_hca};
    if is_hca(bytes) {
        Some("hca")
    } else if is_adx(bytes) {
        Some("adx")
    } else {
        None
    }
}

#[cfg(not(feature = "dbxv2"))]
fn bare_audio(_bytes: &[u8]) -> Option<&'static str> {
    None
}

/// Identify a buffer by magic first, then by the extension of `file_name`.
pub fn identify(bytes: &[u8], file_name: &str) -> FormatInfo {
    let tag = bytes.get(..4).unwrap_or(&[]);
    let by_magic: Option<&'static str> = match tag {
        b"CPK " => Some("cpk"),
        b"AFS2" => Some("awb"),
        b"@UTF" => Some("acb"),
        b"DDS " => Some("dds"),
        b"CRID" => Some("usm"),
        b"#EMB" => Some("emb"),
        b"#EMD" => Some("emd"),
        b"#ESK" => Some("esk"),
        b"#EAN" => Some("ean"),
        b"#EMM" => Some("emm"),
        b"#BAC" => Some("bac"),
        b"#BCM" => Some("bcm"),
        b"#BCS" => Some("bcs"),
        b"#BDM" => Some("bdm"),
        b"#BSA" => Some("bsa"),
        b"#CMS" => Some("cms"),
        b"#CUS" => Some("cus"),
        b"#PUP" => Some("pup"),
        b"#MSG" => Some("msg"),
        _ => bare_audio(bytes),
    };
    let extension = file_name
        .rsplit_once('.')
        .map(|(_, extension)| extension.to_ascii_lowercase())
        .unwrap_or_default();
    let format = by_magic.unwrap_or_else(|| {
        KNOWN.iter().find(|known| **known == extension).copied().unwrap_or("unknown")
    });
    let parsable = matches!(
        format,
        "emb" | "emd" | "esk" | "bac" | "bcm" | "bcs" | "bdm" | "bsa" | "ean" | "emm" | "cms"
            | "cus" | "pup" | "msg"
    );
    FormatInfo { format, category: category_of(format), parsable }
}

fn plain_cpk(bytes: &[u8]) -> Result<CpkReader> {
    if !bytes.starts_with(b"CPK ") {
        return Err(ReError::CorruptHeader("not a plain CPK (header is not `CPK `)".into()));
    }
    CpkReader::new(bytes, "")
        .map_err(|error| ReError::ParseError { context: "CPK", details: error.to_string() })
}

/// File table of a plain CPK held in memory.
pub fn cpk_list(bytes: &[u8]) -> Result<Vec<CpkEntry>> {
    Ok(plain_cpk(bytes)?.entries)
}

/// Extract one entry (by path or name) of a plain CPK; CRILAYLA entries are decompressed.
pub fn cpk_extract(bytes: &[u8], name: &str) -> Result<Vec<u8>> {
    let reader = plain_cpk(bytes)?;
    let entry = reader.find_file(name).ok_or_else(|| ReError::ParseError {
        context: "CPK",
        details: format!("{name}: not in the archive"),
    })?;
    reader
        .extract(bytes, entry)
        .map_err(|error| ReError::ParseError { context: "CPK", details: error.to_string() })
}

fn to_value(value: &impl Serialize) -> Result<Value> {
    Ok(serde_json::to_value(value)?)
}

/// JSON summary of a container or gameplay file. EMD is summarised (counts per part) because
/// full geometry belongs to the glTF export, not to a header probe.
pub fn summarize(bytes: &[u8], file_name: &str) -> Result<Value> {
    let found = identify(bytes, file_name);
    let data = match found.format {
        "emb" => to_value(&EmbArchive::parse(bytes)?)?,
        "esk" => to_value(&EskFile::parse(bytes)?)?,
        "emd" => {
            let model = EmdFile::parse(bytes)?;
            let parts: Vec<Value> = model
                .parts
                .iter()
                .map(|part| {
                    let submeshes: usize =
                        part.meshes.iter().map(|mesh| mesh.submeshes.len()).sum();
                    json!({ "name": part.name, "meshes": part.meshes.len(), "submeshes": submeshes })
                })
                .collect();
            json!({
                "name": model.name,
                "vertices": model.total_vertices(),
                "triangles": model.total_triangles(),
                "parts": parts,
            })
        },
        "cms" => to_value(&CmsFile::parse(bytes)?)?,
        "cus" => to_value(&CusFile::parse(bytes)?)?,
        "pup" => to_value(&PupFile::parse(bytes)?)?,
        "msg" => to_value(&MsgFile::parse(bytes)?)?,
        "bac" | "bcm" | "bcs" | "bdm" | "bsa" | "ean" | "emm" => {
            match gameplay::load(found.format, bytes, file_name) {
                Some(Ok(Loaded::Json(value))) => value,
                Some(Ok(Loaded::Skipped)) => {
                    return Err(ReError::CorruptHeader(format!("{file_name}: signature rejected")));
                },
                Some(Err(error)) => {
                    return Err(ReError::ParseError { context: "gameplay", details: error.0 });
                },
                None => {
                    return Err(ReError::ParseError {
                        context: "gameplay",
                        details: format!("no loader for `{}`", found.format),
                    });
                },
            }
        },
        other => {
            return Err(ReError::ParseError {
                context: "summarize",
                details: format!("no JSON summary for format `{other}`"),
            });
        },
    };
    Ok(json!({ "format": found.format, "category": found.category, "data": data }))
}

/// Decode every subsong of an HCA/ADX/AWB/ACB buffer to PCM16 WAV images, in bank order.
/// A streamed ACB (waveforms in a sibling `.awb`) yields an empty list.
#[cfg(feature = "dbxv2")]
pub fn audio_to_wav(bytes: &[u8]) -> Result<Vec<Vec<u8>>> {
    convert::decode_audio_subsongs(bytes)
        .map_err(|details| ReError::ParseError { context: "audio", details })
}

// ---------------------------------------------------------------------------
// On-demand CPK service: range-read index, find and read (never the whole archive).
// ---------------------------------------------------------------------------

use aphrody_nie_formats::FormatError;

/// Stable index row of one CPK entry.
#[derive(Debug, Clone, Serialize)]
pub struct IndexEntry {
    /// Archive label (file stem, e.g. `data2`).
    pub cpk: String,
    /// Virtual path `dir/file`.
    pub path: String,
    /// Absolute byte offset of the stored payload in the archive.
    pub offset: u64,
    /// Stored (possibly CRILAYLA-compressed) size.
    pub size: u64,
    pub extract_size: u64,
    pub compressed: bool,
}

/// A CPK whose table of contents was read through a range reader.
pub struct CpkIndex {
    pub label: String,
    reader: CpkReader,
}

fn entry_path(entry: &CpkEntry) -> String {
    if entry.directory.is_empty() {
        entry.filename.clone()
    } else {
        format!("{}/{}", entry.directory, entry.filename)
    }
}

fn cpk_error(error: FormatError) -> ReError {
    ReError::ParseError { context: "CPK", details: error.to_string() }
}

impl CpkIndex {
    /// Read only the header and TOC through `read(offset, len)`; `file_name` feeds the key
    /// derivation of encrypted archives.
    pub fn open<F>(label: &str, file_name: &str, read: F) -> Result<Self>
    where
        F: FnMut(u64, usize) -> std::result::Result<Vec<u8>, FormatError>,
    {
        let reader = CpkReader::from_reader(file_name, read).map_err(cpk_error)?;
        Ok(Self { label: label.to_owned(), reader })
    }

    fn row(&self, entry: &CpkEntry) -> IndexEntry {
        IndexEntry {
            cpk: self.label.clone(),
            path: entry_path(entry),
            offset: entry.offset,
            size: entry.size,
            extract_size: entry.extract_size,
            compressed: entry.is_compressed,
        }
    }

    /// Every entry, in TOC order.
    pub fn list(&self) -> Vec<IndexEntry> {
        self.reader.entries.iter().map(|entry| self.row(entry)).collect()
    }

    /// Entries matching `query`: `ext:emb` (extension), a pattern with `*`/`?` (glob over the full
    /// path, case-insensitive) or an exact path.
    pub fn find(&self, query: &str) -> Vec<IndexEntry> {
        let matches: Box<dyn Fn(&str) -> bool> = if let Some(ext) = query.strip_prefix("ext:") {
            let suffix = format!(".{}", ext.trim_start_matches('.').to_ascii_lowercase());
            Box::new(move |path: &str| path.to_ascii_lowercase().ends_with(&suffix))
        } else if query.contains(['*', '?']) {
            let pattern = query.to_ascii_lowercase();
            Box::new(move |path: &str| glob(pattern.as_bytes(), path.to_ascii_lowercase().as_bytes()))
        } else {
            let exact = query.to_ascii_lowercase();
            Box::new(move |path: &str| path.to_ascii_lowercase() == exact)
        };
        self.reader
            .entries
            .iter()
            .filter(|entry| matches(&entry_path(entry)))
            .map(|entry| self.row(entry))
            .collect()
    }

    /// Read one entry (CRILAYLA decompressed), optionally the `(start, len)` window of its
    /// extracted bytes. Plain stored entries are range-read without touching the rest.
    pub fn read<F>(&self, path: &str, range: Option<(u64, u64)>, mut read: F) -> Result<Vec<u8>>
    where
        F: FnMut(u64, usize) -> std::result::Result<Vec<u8>, FormatError>,
    {
        let entry = self.reader.find_file(path).ok_or_else(|| ReError::ParseError {
            context: "CPK",
            details: format!("{path}: not in the archive"),
        })?;
        if let (Some((start, len)), false, false) =
            (range, entry.is_compressed, self.reader.is_encrypted)
        {
            let available = entry.size.saturating_sub(start);
            let take = usize::try_from(len.min(available))
                .map_err(|e| ReError::ParseError { context: "CPK", details: e.to_string() })?;
            if take == 0 {
                return Ok(Vec::new());
            }
            return read(entry.offset + start, take).map_err(cpk_error);
        }
        let bytes = self.reader.extract_from_reader(entry, read).map_err(cpk_error)?;
        Ok(match range {
            None => bytes,
            Some((start, len)) => {
                let from = usize::try_from(start).unwrap_or(usize::MAX).min(bytes.len());
                let to =
                    usize::try_from(start.saturating_add(len)).unwrap_or(usize::MAX).min(bytes.len());
                bytes[from..to].to_vec()
            },
        })
    }
}

/// Case-folded `*` / `?` glob over bytes.
fn glob(pattern: &[u8], text: &[u8]) -> bool {
    match pattern.split_first() {
        None => text.is_empty(),
        Some((b'*', rest)) => (0..=text.len()).any(|skip| glob(rest, &text[skip..])),
        Some((b'?', rest)) => !text.is_empty() && glob(rest, &text[1..]),
        Some((byte, rest)) => text.first() == Some(byte) && glob(rest, &text[1..]),
    }
}

// ---------------------------------------------------------------------------
// One function per conversion (bytes in, bytes out).
// ---------------------------------------------------------------------------

/// Decode entry `index` of a `#EMB` container (DDS payload) to PNG.
#[cfg(feature = "dbxv2")]
pub fn emb_to_png(bytes: &[u8], index: usize) -> Result<Vec<u8>> {
    use aphrody_nie_formats::g4tx_decode::{decode_dds_to_rgba, encode_rgba_to_png};
    let archive = EmbArchive::parse(bytes)?;
    let data = archive.entry_bytes(bytes, index)?;
    let fail = |details: &str| ReError::ParseError { context: "emb_to_png", details: details.into() };
    let (width, height, rgba) =
        decode_dds_to_rgba(data).ok_or_else(|| fail("entry is not a decodable DDS"))?;
    encode_rgba_to_png(&rgba, width as usize, height as usize)
        .ok_or_else(|| fail("PNG encoding failed"))
}

fn assemble(
    name: &str,
    emd: &[u8],
    emb: Option<&[u8]>,
    esk: Option<&[u8]>,
) -> Result<crate::game::formats::model_assemble::AssembledCharacterModel> {
    use crate::game::formats::{emb::EmbFile, model_assemble::AssembledCharacterModel};
    let emd = EmdFile::parse(emd)?;
    let emb = emb.map(EmbFile::parse).transpose()?;
    let esk = esk.map(EskFile::parse).transpose()?;
    Ok(AssembledCharacterModel::assemble(name, &emd, emb.as_ref(), esk.as_ref(), None))
}

/// Assembled character model (EMD geometry, optional EMB textures and ESK skeleton) as JSON.
/// `textures` lists the decoded rasters (`width`, `height`, `format`); pixels come from
/// [`emb_to_png`] with the primitive's `textureIndex`.
pub fn model_json(
    name: &str,
    emd: &[u8],
    emb: Option<&[u8]>,
    esk: Option<&[u8]>,
) -> Result<Value> {
    let model = assemble(name, emd, emb, esk)?;
    let primitives: Vec<Value> = model
        .primitives
        .iter()
        .map(|primitive| {
            json!({
                "name": primitive.name,
                "materialName": primitive.material_name,
                "positions": primitive.positions,
                "normals": primitive.normals,
                "uv": primitive.uv,
                "indices": primitive.indices,
                "textureIndex": primitive.texture_index,
            })
        })
        .collect();
    let textures: Vec<Value> = model
        .textures
        .iter()
        .map(|t| json!({ "width": t.width, "height": t.height, "format": t.format }))
        .collect();
    Ok(json!({
        "name": model.name,
        "vertices": model.total_vertices(),
        "triangles": model.total_triangles(),
        "primitives": primitives,
        "textures": textures,
        "skeleton": model.skeleton.as_ref().map(serde_json::to_value).transpose()?,
    }))
}

/// Same model as a binary glTF (`.glb`).
pub fn model_glb(
    name: &str,
    emd: &[u8],
    emb: Option<&[u8]>,
    esk: Option<&[u8]>,
) -> Result<Vec<u8>> {
    assemble(name, emd, emb, esk)?.to_glb()
}

#[cfg(feature = "dbxv2")]
fn usm_error(error: FormatError) -> ReError {
    ReError::ParseError { context: "usm", details: error.to_string() }
}

/// Remux a CRI USM: MP4 for H.264, WebM for VP9, raw `.m2v` elementary stream for MPEG-2 (what
/// DBXV2 movies use). Returns the bytes and the extension.
#[cfg(feature = "dbxv2")]
pub fn usm_to_video(bytes: &[u8]) -> Result<(Vec<u8>, &'static str)> {
    use aphrody_nie_formats::usm;
    let usm = usm::demuxer(bytes).map_err(usm_error)?;
    use aphrody_nie_formats::usm::CodecVideo;
    match usm.codec {
        CodecVideo::H264 => usm.en_mp4().map(|(out, _)| (out, "mp4")).map_err(usm_error),
        CodecVideo::Vp9 => usm.en_webm().map(|(out, _)| (out, "webm")).map_err(usm_error),
        // The game's own movies are Sofdec Prime: no MP4/WebM mapping exists, so the MPEG-2 video
        // elementary stream is returned for an external player or transcoder.
        CodecVideo::Mpeg2 => Ok((usm.flux_brut(), "m2v")),
        other => Err(ReError::ParseError {
            context: "usm",
            details: format!("video codec `{}` cannot be extracted", other.nom()),
        }),
    }
}

/// Fonts: TrueType/OpenType/WOFF payloads are validated and returned as-is. The game's own UI
/// fonts are Scaleform Iggy bundles (`.iggy`/`.iggytex`), which no reader here decodes; they are
/// refused explicitly instead of guessed.
pub fn font_to_sfnt(bytes: &[u8]) -> Result<(Vec<u8>, &'static str)> {
    let kind = match bytes.get(..4) {
        Some([0, 1, 0, 0]) | Some(b"true") => "ttf",
        Some(b"OTTO") => "otf",
        Some(b"wOFF") => "woff",
        Some(b"wOF2") => "woff2",
        _ => {
            return Err(ReError::ParseError {
                context: "font",
                details: "not an sfnt/WOFF font (Iggy bundles are not decoded)".into(),
            });
        },
    };
    Ok((bytes.to_vec(), kind))
}

// ---------------------------------------------------------------------------
// File-backed CPK service (positioned reads; a 9 GB archive is never loaded).
// ---------------------------------------------------------------------------

#[cfg(feature = "dbxv2")]
fn ranged(file: &mut std::fs::File) -> impl FnMut(u64, usize) -> std::result::Result<Vec<u8>, FormatError> + '_ {
    use std::io::{Read, Seek, SeekFrom};
    move |offset, size| {
        let mut buffer = vec![0u8; size];
        file.seek(SeekFrom::Start(offset))
            .and_then(|_| file.read_exact(&mut buffer))
            .map_err(|_| FormatError::TooShort { got: 0, need: size })?;
        Ok(buffer)
    }
}

/// Open the table of contents of a CPK on disk.
#[cfg(feature = "dbxv2")]
pub fn cpk_open(path: &std::path::Path) -> Result<CpkIndex> {
    let mut file = std::fs::File::open(path)?;
    let name = path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    let label = path.file_stem().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    CpkIndex::open(&label, &name, ranged(&mut file))
}

/// `find` over a CPK on disk; an empty query lists every entry.
#[cfg(feature = "dbxv2")]
pub fn cpk_find_file(path: &std::path::Path, query: &str) -> Result<Vec<IndexEntry>> {
    let index = cpk_open(path)?;
    Ok(if query.is_empty() { index.list() } else { index.find(query) })
}

/// `read` one entry of a CPK on disk, optionally a `(start, len)` window.
#[cfg(feature = "dbxv2")]
pub fn cpk_read_file(
    path: &std::path::Path,
    entry: &str,
    range: Option<(u64, u64)>,
) -> Result<Vec<u8>> {
    let index = cpk_open(path)?;
    let mut file = std::fs::File::open(path)?;
    index.read(entry, range, ranged(&mut file))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn identify_uses_magic_then_extension() {
        assert_eq!(identify(b"#EMB....", "x.bin").format, "emb");
        assert_eq!(identify(b"????", "chara.BAC").format, "bac");
        assert_eq!(identify(b"????", "x.zzz").format, "unknown");
    }

    #[test]
    fn glob_matches_case_folded_paths() {
        assert!(glob(b"data/chara/*/*.emb", b"data/chara/gok/gok.emb"));
        assert!(!glob(b"*.emd", b"a.emb"));
        assert!(glob(b"a?c", b"abc"));
    }
}
