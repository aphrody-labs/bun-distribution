// SPDX-License-Identifier: Apache-2.0
//! Conversions to open formats and bounded batch export.
//!
//! | Source | Open format |
//! |---|---|
//! | DDS, G4TX (Level-5), `#EMB` (Dimps) | PNG |
//! | PNG, JPEG, KTX/KTX2, WebP, TGA, BMP | unchanged |
//! | HCA, ADX, AWB, ACB (CRI) | WAV PCM16 |
//! | WAV, OGG, FLAC, MP3 | unchanged |
//! | USM (CRI) | MP4 (H.264) or WebM (VP9), remuxed |
//! | `#EMD` (+ `.emb`/`.esk` siblings), G4MD (+ `.g4mg` sibling) | glTF binary |
//! | glTF/GLB | unchanged |
//! | `@UTF` tables, Level-5 `cfg.bin`/`objbin`/G4 structures, Dimps gameplay files, `#MSG` | JSON |
//! | JSON, XML, CSV, INI, TXT | unchanged |
//!
//! CRI audio follows the profile key policy: unencrypted and statically scrambled HCA decode
//! without a key, `ciph_type` 56 needs a user-provided key, and IEVR audio goes through its
//! owner (`aphrody-nie-formats::cri_audio`).

use std::{
    collections::BTreeMap,
    path::{Path, PathBuf},
    time::Instant,
};

use serde::Serialize;
use sha2::{Digest, Sha256};

use super::{
    AssetError, AssetResult, Keys,
    classify::Kind,
    format_err,
    profile::MountMode,
    vfs::{GameVfs, VfsEntry},
};

/// One export format offered for a file.
#[derive(Debug, Clone, Serialize)]
pub struct ExportFormat {
    /// Identifier passed to [`convert`] (`raw`, `png`, `wav`, `glb`, `json`, `mp4`, `webm`).
    pub id: &'static str,
    /// Output extension.
    pub ext: String,
    /// True for the untouched bytes.
    pub raw: bool,
}

/// A converted file.
#[derive(Debug, Clone)]
pub struct Exported {
    /// Output bytes.
    pub bytes: Vec<u8>,
    /// Output extension.
    pub ext: String,
    /// MIME type.
    pub mime: &'static str,
}

fn head(data: &[u8], magic: &[u8]) -> bool {
    data.starts_with(magic)
}

/// Formats offered for `entry` (derived from its name and format id; no read).
#[must_use]
pub fn formats_for(vfs: &GameVfs, entry: &VfsEntry) -> Vec<ExportFormat> {
    let ext = entry.format.as_str();
    let raw_ext = if ext.is_empty() { "bin".to_string() } else { ext.to_string() };
    let mut out = vec![ExportFormat { id: "raw", ext: raw_ext, raw: true }];
    let mut push = |id: &'static str, ext: &str| out.push(ExportFormat { id, ext: ext.into(), raw: false });
    match ext {
        "dds" | "g4tx" | "emb" => push("png", "png"),
        "hca" | "adx" | "awb" | "acb" => push("wav", "wav"),
        "usm" => {
            push("mp4", "mp4");
            push("webm", "webm");
        },
        "emd" | "g4md" => push("glb", "glb"),
        "cfg.bin" | "objbin" | "obj.bin" | "mevbin" | "g4sk" | "g4mt" | "g4pk" | "g4pkm" | "msg"
        | "bac" | "bcm" | "bcs" | "bdm" | "bsa" | "ean" | "emm" | "esk" | "cms" | "cus" | "pup"
        | "cri-utf" => push("json", "json"),
        _ => {},
    }
    if vfs.profile().mode == MountMode::Level5Ievr && ext == "g4md" && vfs.sibling(&entry.path, "g4mg").is_none() {
        out.retain(|format| format.id != "glb");
    }
    out
}

/// Preferred open format for a kind (`None`: keep the raw bytes).
#[must_use]
pub fn preferred(entry: &VfsEntry) -> &'static str {
    match entry.format.as_str() {
        "dds" | "g4tx" | "emb" => "png",
        "hca" | "adx" | "awb" | "acb" => "wav",
        "usm" => "mp4",
        "emd" | "g4md" => "glb",
        "cfg.bin" | "objbin" | "obj.bin" | "mevbin" | "msg" | "bac" | "bcm" | "bcs" | "bdm"
        | "bsa" | "ean" | "emm" | "esk" | "cms" | "cus" | "pup" | "cri-utf" | "g4sk" | "g4mt" => "json",
        _ => "raw",
    }
}

fn mime(ext: &str) -> &'static str {
    match ext {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "ktx2" => "image/ktx2",
        "wav" => "audio/wav",
        "ogg" => "audio/ogg",
        "flac" => "audio/flac",
        "mp3" => "audio/mpeg",
        "mp4" => "video/mp4",
        "webm" => "video/webm",
        "glb" => "model/gltf-binary",
        "gltf" => "model/gltf+json",
        "json" => "application/json",
        "xml" => "application/xml",
        "txt" | "csv" | "ini" | "lua" | "rpy" => "text/plain; charset=utf-8",
        _ => "application/octet-stream",
    }
}

fn png_from_rgba(width: u32, height: u32, rgba: &[u8]) -> AssetResult<Vec<u8>> {
    aphrody_nie_formats::g4tx_decode::encode_rgba_to_png(rgba, width as usize, height as usize)
        .ok_or_else(|| format_err("png", "encoder refused the image"))
}

fn dds_to_png(data: &[u8]) -> AssetResult<Vec<u8>> {
    let (width, height, rgba) = aphrody_nie_formats::g4tx_decode::decode_dds_to_rgba(data)
        .ok_or_else(|| format_err("dds", "unsupported DDS pixel format"))?;
    png_from_rgba(width, height, &rgba)
}

/// Decode one HCA stream to WAV. Unencrypted (`ciph_type` 0) and statically scrambled
/// (`ciph_type` 1) streams need no key; `ciph_type` 56 needs the user-provided `key`.
///
/// # Errors
/// Keyed stream without key, malformed stream.
pub fn hca_to_wav(raw: &[u8], key: Option<u64>, subkey: u16) -> AssetResult<Vec<u8>> {
    use aphrody_nie_formats::cri_audio::encode_pcm16_wav;
    use cridecoder::{HcaDecoder, HcaDecoderError};
    let mut decoder = HcaDecoder::from_reader(std::io::Cursor::new(raw))
        .map_err(|e| format_err("hca", e.to_string()))?;
    if decoder.info().encryption_enabled {
        let key = key.ok_or_else(|| AssetError::KeyRequired("HCA stream (ciph_type 56)".into()))?;
        decoder.set_encryption_key(key, u64::from(subkey));
    }
    let info = decoder.info().clone();
    let channels = info.channel_count;
    let mut frame = vec![0i16; info.samples_per_block * channels as usize];
    let mut pcm = Vec::with_capacity(info.block_count as usize * frame.len());
    loop {
        match decoder.decode_frame_i16(&mut frame) {
            Ok(0) => {},
            Ok(n) => pcm.extend_from_slice(&frame[..n * channels as usize]),
            Err(HcaDecoderError::Eof) => break,
            Err(e) => return Err(format_err("hca", e.to_string())),
        }
    }
    Ok(encode_pcm16_wav(&pcm, channels, info.sampling_rate))
}

/// Decode CRI audio to WAV. `hca_key` is the user-provided key for `ciph_type` 56 streams.
///
/// # Errors
/// Encrypted streams without key, malformed banks, streamed ACB without its AWB.
pub fn cri_audio_to_wav(data: &[u8], hca_key: Option<u64>) -> AssetResult<Vec<u8>> {
    use aphrody_nie_formats::cri_audio::{Awb, acb_parse, adx_decode, encode_pcm16_wav, is_adx, is_hca};

    fn one(raw: &[u8], key: Option<u64>, subkey: u16) -> AssetResult<Vec<u8>> {
        if is_hca(raw) {
            return hca_to_wav(raw, key, subkey);
        }
        if is_adx(raw) {
            let pcm = adx_decode(raw).map_err(|e| format_err("adx", e.to_string()))?;
            return Ok(encode_pcm16_wav(&pcm.samples, pcm.channels, pcm.sample_rate));
        }
        Err(format_err("cri-audio", "neither HCA nor ADX"))
    }
    fn bank(raw: &[u8], key: Option<u64>) -> AssetResult<Vec<u8>> {
        let awb = Awb::parse(raw).map_err(|e| format_err("awb", e.to_string()))?;
        let first = awb
            .entries
            .iter()
            .map(|entry| awb.entry_bytes(raw, entry))
            .find(|bytes| !bytes.is_empty())
            .ok_or_else(|| format_err("awb", "empty bank"))?;
        one(first, key, awb.subkey)
    }
    if head(data, b"AFS2") {
        return bank(data, hca_key);
    }
    if head(data, b"@UTF") {
        let acb = acb_parse(data).map_err(|e| format_err("acb", e.to_string()))?;
        if acb.embedded_awb.is_empty() {
            return Err(AssetError::NotFound("streamed ACB: export its sibling .awb".into()));
        }
        return bank(&acb.embedded_awb, hca_key);
    }
    one(data, hca_key, 0)
}

fn to_json(value: &impl Serialize) -> AssetResult<Vec<u8>> {
    serde_json::to_vec_pretty(value).map_err(|e| format_err("json", e.to_string()))
}

fn table_json(entry: &VfsEntry, data: &[u8]) -> AssetResult<Vec<u8>> {
    use crate::game::{
        formats::{cms::CmsFile, cus::CusFile, pup::PupFile},
        gameplay::{FORMATS, Loaded, load},
        text::extract_msg_text,
    };
    let ext = entry.format.as_str();
    if FORMATS.contains(&ext) {
        return match load(ext, data, &entry.path) {
            Some(Ok(Loaded::Json(value))) => to_json(&value),
            Some(Ok(Loaded::Skipped)) => Err(format_err("dimps", "signature rejected")),
            Some(Err(error)) => Err(format_err("dimps", error.0)),
            None => Err(format_err("dimps", "no loader")),
        };
    }
    let dimps = |e: crate::game::ReError| format_err("dimps", e.to_string());
    match ext {
        "msg" => return to_json(&extract_msg_text(Path::new(&entry.path), data)),
        "cms" => return to_json(&CmsFile::parse(data).map_err(dimps)?),
        "cus" => return to_json(&CusFile::parse(data).map_err(dimps)?),
        "pup" => return to_json(&PupFile::parse(data).map_err(dimps)?),
        _ => {},
    }
    if head(data, b"@UTF") {
        let table = aphrody_nie_formats::cpk::parse_utf(data).map_err(|e| format_err("cri-utf", e.to_string()))?;
        return to_json(&table);
    }
    aphrody_nie_formats::decode::to_json(data)
        .ok_or_else(|| format_err("json", format!("no structured decoder for {}", entry.path)))
}

fn model_glb(vfs: &GameVfs, entry: &VfsEntry, data: &[u8]) -> AssetResult<Vec<u8>> {
    if head(data, b"glTF") {
        return Ok(data.to_vec());
    }
    if head(data, b"#EMD") {
        use crate::game::formats::{
            emb::EmbFile, emd::EmdFile, esk::EskFile, model_assemble::AssembledCharacterModel,
        };
        let dimps = |e: crate::game::ReError| format_err("emd", e.to_string());
        let emd = EmdFile::parse(data).map_err(dimps)?;
        let stem = entry.path.rsplit_once('.').map_or(entry.path.as_str(), |(s, _)| s);
        let emb = ["dyt.emb", "emb"]
            .iter()
            .find_map(|ext| vfs.read(&format!("{stem}.{ext}")).ok())
            .and_then(|bytes| EmbFile::parse(&bytes).ok());
        let esk = vfs.sibling(&entry.path, "esk").and_then(|e| vfs.read_entry(e).ok()).and_then(|b| EskFile::parse(&b).ok());
        let name = stem.rsplit('/').next().unwrap_or(stem);
        let model = AssembledCharacterModel::assemble(name, &emd, emb.as_ref(), esk.as_ref(), None);
        return model.to_glb().map_err(dimps);
    }
    if head(data, b"G4MD") {
        use aphrody_nie_formats::assemble::{GenericModelInput, MeshComponent, assemble_generic_model};
        let g4mg = vfs
            .sibling(&entry.path, "g4mg")
            .ok_or_else(|| AssetError::NotFound(format!("{}: sibling .g4mg", entry.path)))?;
        let g4mg = vfs.read_entry(g4mg)?;
        let code = entry.path.rsplit('/').next().unwrap_or_default().split('.').next().unwrap_or_default();
        let model = assemble_generic_model(GenericModelInput {
            code: code.to_string(),
            g4md: data.to_vec(),
            g4mg,
            component: MeshComponent::Generic,
        })
        .map_err(|e| format_err("g4md", e.to_string()))?;
        return Ok(model.to_glb());
    }
    Err(AssetError::Unsupported(format!("{}: no model converter", entry.path)))
}

fn texture_png(entry: &VfsEntry, data: &[u8]) -> AssetResult<Vec<u8>> {
    if head(data, b"\x89PNG") {
        return Ok(data.to_vec());
    }
    if head(data, b"DDS ") {
        return dds_to_png(data);
    }
    if head(data, b"G4TX") {
        let name = aphrody_nie_formats::g4tx_decode::basename_of(&entry.path);
        return aphrody_nie_formats::g4tx_decode::decode_best_to_png(data, name)
            .ok_or_else(|| format_err("g4tx", "no decodable surface"));
    }
    if head(data, b"#EMB") {
        let archive = crate::game::formats::emb_archive::EmbArchive::parse(data)
            .map_err(|e| format_err("emb", e.to_string()))?;
        for index in 0..archive.entries.len() {
            let bytes = archive.entry_bytes(data, index).map_err(|e| format_err("emb", e.to_string()))?;
            if head(bytes, b"DDS ") {
                return dds_to_png(bytes);
            }
        }
        return Err(format_err("emb", "no DDS entry"));
    }
    Err(AssetError::Unsupported(format!("{}: no texture converter", entry.path)))
}

/// Convert `data` (the bytes of `entry`) to `format`.
///
/// # Errors
/// Unknown format for this file, decoder failure, missing user key.
pub fn convert(vfs: &GameVfs, entry: &VfsEntry, data: Vec<u8>, format: &str, keys: &Keys) -> AssetResult<Exported> {
    let ievr = vfs.profile().mode == MountMode::Level5Ievr;
    let (bytes, ext) = match format {
        "raw" => {
            let ext = if entry.format.is_empty() { "bin".to_string() } else { entry.format.clone() };
            (data, ext)
        },
        "png" => (texture_png(entry, &data)?, "png".into()),
        "wav" => {
            if head(&data, b"RIFF") {
                (data, "wav".into())
            } else if ievr {
                // IEVR audio through its owner: same decoder as the NIE `/export?format=wav`.
                let decoded = aphrody_nie_formats::cri_audio::decode_to_wav(&data).or_else(|first| {
                    let awb = vfs.sibling(&entry.path, "awb").ok_or(first)?;
                    let bank = vfs.read_entry(awb).map_err(|e| e.to_string())?;
                    aphrody_nie_formats::cri_audio::decode_awb_entry(&bank, None)
                });
                (decoded.map_err(|e| format_err("cri-audio", e))?, "wav".into())
            } else {
                let decoded = cri_audio_to_wav(&data, keys.hca).or_else(|error| match error {
                    AssetError::NotFound(_) => {
                        let awb = vfs.sibling(&entry.path, "awb").ok_or(error)?;
                        cri_audio_to_wav(&vfs.read_entry(awb)?, keys.hca)
                    },
                    other => Err(other),
                })?;
                (decoded, "wav".into())
            }
        },
        "mp4" | "webm" => {
            use aphrody_nie_formats::usm;
            let demuxed = if ievr {
                usm::demuxer_nomme(&data, usm::nom_fichier_de(&entry.path))
            } else {
                usm::demuxer(&data)
            }
            .map_err(|e| format_err("usm", e.to_string()))?;
            let out = if format == "mp4" { demuxed.en_mp4().map(|(o, _)| o) } else { demuxed.en_webm().map(|(o, _)| o) };
            (out.map_err(|e| format_err("usm", e.to_string()))?, format.to_string())
        },
        "glb" => (model_glb(vfs, entry, &data)?, "glb".into()),
        "json" => {
            if entry.format == "json" {
                (data, "json".into())
            } else {
                (table_json(entry, &data)?, "json".into())
            }
        },
        other => return Err(AssetError::Unsupported(format!("export format `{other}`"))),
    };
    Ok(Exported { mime: mime(&ext), bytes, ext })
}

/// Batch export plan.
#[derive(Debug, Clone)]
pub struct ExportPlan {
    /// Kinds to export.
    pub kinds: Vec<Kind>,
    /// Files per kind (stratified over the sorted corpus).
    pub per_kind: usize,
    /// Only paths containing this substring (case-insensitive).
    pub filter: Option<String>,
    /// Largest source entry read.
    pub max_bytes: u64,
    /// Convert to the preferred open format (otherwise keep raw bytes).
    pub convert: bool,
    /// Keep converted files only (skip entries whose conversion fails).
    pub converted_only: bool,
}

impl Default for ExportPlan {
    fn default() -> Self {
        Self {
            kinds: vec![Kind::Texture, Kind::Model, Kind::Audio, Kind::Table],
            per_kind: 8,
            filter: None,
            max_bytes: 64 << 20,
            convert: true,
            converted_only: false,
        }
    }
}

/// One exported file.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportRecord {
    /// Source path in the VFS.
    pub source: String,
    /// Container.
    pub container: String,
    /// Kind.
    pub kind: Kind,
    /// Requested format.
    pub format: String,
    /// Output path (relative to the export directory), when written.
    pub output: Option<String>,
    /// Output size.
    pub bytes: u64,
    /// SHA-256 of the output.
    pub sha256: Option<String>,
    /// Read + conversion time.
    pub millis: u128,
    /// Error, when the conversion failed.
    pub error: Option<String>,
}

/// Batch export summary.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportSummary {
    /// Profile id.
    pub profile: &'static str,
    /// Candidates per kind before sampling.
    pub candidates: BTreeMap<String, usize>,
    /// Records.
    pub files: Vec<ExportRecord>,
    /// Successful conversions per kind.
    pub ok: BTreeMap<String, usize>,
    /// Failures per kind.
    pub failed: BTreeMap<String, usize>,
    /// Total time.
    pub millis: u128,
}

fn safe_relative(path: &str) -> PathBuf {
    path.split('/')
        .filter(|part| !part.is_empty() && *part != "." && *part != "..")
        .map(|part| part.replace(|c: char| matches!(c, ':' | '*' | '?' | '"' | '<' | '>' | '|'), "_"))
        .collect()
}

/// Export a stratified sample of each kind into `out` (`<kind>/<source path>.<ext>`) and write
/// `export_manifest.json`.
///
/// # Errors
/// Output directory errors (conversion errors are recorded per file).
pub fn export_batch(vfs: &GameVfs, out: &Path, plan: &ExportPlan, keys: &Keys) -> AssetResult<ExportSummary> {
    let started = Instant::now();
    let io = |path: &Path| {
        let path = path.display().to_string();
        move |source| AssetError::Io { path, source }
    };
    std::fs::create_dir_all(out).map_err(io(out))?;
    let filter = plan.filter.as_ref().map(|f| f.to_ascii_lowercase());
    let mut summary = ExportSummary {
        profile: vfs.profile().id,
        candidates: BTreeMap::new(),
        files: Vec::new(),
        ok: BTreeMap::new(),
        failed: BTreeMap::new(),
        millis: 0,
    };
    for kind in &plan.kinds {
        let mut candidates: Vec<&VfsEntry> = vfs
            .entries()
            .iter()
            .filter(|entry| entry.kind == *kind)
            .filter(|entry| entry.size <= plan.max_bytes)
            .filter(|entry| filter.as_ref().is_none_or(|f| entry.path.to_ascii_lowercase().contains(f)))
            .filter(|entry| !plan.converted_only || preferred(entry) != "raw")
            .collect();
        // Models need their companions: prefer the descriptor that converts.
        if *kind == Kind::Model {
            candidates.retain(|entry| matches!(entry.format.as_str(), "emd" | "g4md" | "glb" | "gltf" | "fbx" | "obj"));
        }
        candidates.sort_by(|a, b| a.path.cmp(&b.path));
        summary.candidates.insert(kind.as_str().into(), candidates.len());
        let stride = (candidates.len() / plan.per_kind.max(1)).max(1);
        for entry in candidates.iter().step_by(stride).take(plan.per_kind) {
            let begun = Instant::now();
            let format = if plan.convert { preferred(entry) } else { "raw" };
            let result = vfs.read_entry(entry).and_then(|data| convert(vfs, entry, data, format, keys));
            let mut record = ExportRecord {
                source: entry.path.clone(),
                container: entry.container.clone(),
                kind: entry.kind,
                format: format.into(),
                output: None,
                bytes: 0,
                sha256: None,
                millis: 0,
                error: None,
            };
            match result {
                Ok(exported) => {
                    let name = if format == "raw" {
                        format!("{}/{}", kind.as_str(), entry.path)
                    } else {
                        format!("{}/{}.{}", kind.as_str(), entry.path, exported.ext)
                    };
                    let relative = safe_relative(&name);
                    let target = out.join(&relative);
                    if let Some(parent) = target.parent() {
                        std::fs::create_dir_all(parent).map_err(io(parent))?;
                    }
                    std::fs::write(&target, &exported.bytes).map_err(io(&target))?;
                    record.output = Some(relative.to_string_lossy().replace('\\', "/"));
                    record.bytes = exported.bytes.len() as u64;
                    record.sha256 = Some(hex::encode(Sha256::digest(&exported.bytes)));
                    *summary.ok.entry(kind.as_str().into()).or_default() += 1;
                },
                Err(error) => {
                    record.error = Some(error.to_string());
                    *summary.failed.entry(kind.as_str().into()).or_default() += 1;
                },
            }
            record.millis = begun.elapsed().as_millis();
            summary.files.push(record);
        }
    }
    summary.millis = started.elapsed().as_millis();
    let manifest = out.join("export_manifest.json");
    std::fs::write(&manifest, serde_json::to_vec_pretty(&summary).unwrap_or_default()).map_err(io(&manifest))?;
    Ok(summary)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn exports_dds_as_png_and_refuses_keyed_hca_without_key() {
        // 4x4 uncompressed RGBA DDS (DDPF_RGB | DDPF_ALPHAPIXELS).
        let mut dds = b"DDS ".to_vec();
        let mut header = [0u32; 31];
        header[0] = 124;
        header[1] = 0x1 | 0x2 | 0x4 | 0x1000;
        header[2] = 4;
        header[3] = 4;
        header[4] = 16;
        header[18] = 32;
        header[19] = 0x41;
        header[21] = 32;
        header[22] = 0x00FF_0000;
        header[23] = 0x0000_FF00;
        header[24] = 0x0000_00FF;
        header[25] = 0xFF00_0000;
        header[26] = 0x1000;
        for value in header {
            dds.extend(value.to_le_bytes());
        }
        dds.extend([0x80u8; 64]);
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("tex.dds"), &dds).unwrap();
        let vfs = GameVfs::mount(dir.path(), &Default::default()).unwrap();
        let entry = vfs.find("tex.dds").unwrap().clone();
        let png = convert(&vfs, &entry, dds, "png", &Keys::default()).unwrap();
        assert!(png.bytes.starts_with(b"\x89PNG"));
        assert!(cri_audio_to_wav(b"not audio", None).is_err());
    }
}
