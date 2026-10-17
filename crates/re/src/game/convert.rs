// SPDX-License-Identifier: Apache-2.0
//! In-place conversion passes of the dbxv2 pipeline over an extracted CPK tree.
//!
//! Every pass walks `root`, writes its outputs next to the inputs and a `<pass>_manifest.json`
//! in `root`, with the same file layout and manifest keys as the dbxv2 Python commands:
//!
//! - `tex`: `#EMB` -> `<file>.emb.unpacked/` entries, DDS -> PNG (feature `dbxv2`);
//! - `audio`: HCA/ADX/AWB/ACB -> `<file>.wav.d/NNN.wav` (feature `dbxv2`);
//! - `text`: MSG -> `<file>.msg.json`;
//! - `models`: EMD metadata;
//! - `parse`: BAC/BCM/BCS/BDM/BSA/EAN/EMM/ESK -> `<file>.json` (pyxenoverse-compatible);
//! - `report`: aggregation of every manifest into `reports/GLOBAL_REPORT.json`.
//!
//! Walks skip symlinks so a pass never leaves `root`.

use std::{
    fs,
    path::{Path, PathBuf},
};

use serde::Serialize;
use serde_json::{Map, Value, json};

use crate::game::{Result, text::extract_msg_text};

/// `#EMD` signature (little-endian u32 of `#EMD`).
const EMD_SIGNATURE: &[u8; 4] = b"#EMD";

/// Recursively list regular files under `root` whose lowercase extension is accepted.
pub fn walk_files(root: &Path, accept: &dyn Fn(&str) -> bool) -> Result<Vec<PathBuf>> {
    let mut files = Vec::new();
    let mut pending = vec![root.to_path_buf()];
    while let Some(directory) = pending.pop() {
        for entry in fs::read_dir(&directory)? {
            let entry = entry?;
            let file_type = entry.file_type()?;
            if file_type.is_symlink() {
                continue;
            }
            let path = entry.path();
            if file_type.is_dir() {
                pending.push(path);
            } else if file_type.is_file()
                && path
                    .extension()
                    .is_some_and(|extension| accept(&extension.to_string_lossy().to_ascii_lowercase()))
            {
                files.push(path);
            }
        }
    }
    files.sort();
    Ok(files)
}

fn relative(root: &Path, path: &Path) -> String {
    path.strip_prefix(root).unwrap_or(path).to_string_lossy().replace('\\', "/")
}

/// Write pretty JSON (2-space indent, UTF-8), creating parent directories.
pub fn write_json(path: &Path, value: &impl Serialize) -> Result<PathBuf> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(path, serde_json::to_vec_pretty(value)?)?;
    Ok(path.to_path_buf())
}

fn load_json(path: &Path) -> Option<Value> {
    serde_json::from_slice(&fs::read(path).ok()?).ok()
}

/// `text`: every `.msg` under `root` -> `<file>.msg.json`, then `text_manifest.json`.
pub fn text_in_place(root: &Path) -> Result<Value> {
    let messages = walk_files(root, &|extension| extension == "msg")?;
    for message in &messages {
        let bytes = fs::read(message)?;
        let mut output = message.clone().into_os_string();
        output.push(".json");
        write_json(Path::new(&output), &extract_msg_text(message, &bytes))?;
    }
    let manifest = json!({ "msgFiles": messages.len(), "converted": messages.len() });
    write_json(&root.join("text_manifest.json"), &manifest)?;
    Ok(manifest)
}

/// `models`: reference every `.emd` (size, `#EMD` signature, header version).
pub fn models_manifest(root: &Path) -> Result<Value> {
    let models = walk_files(root, &|extension| extension == "emd")?;
    let mut records = Vec::with_capacity(models.len());
    for model in &models {
        let bytes = fs::read(model)?;
        let valid = bytes.len() >= 16 && bytes.starts_with(EMD_SIGNATURE);
        let mut record = Map::new();
        record.insert("file".into(), relative(root, model).into());
        record.insert("sizeBytes".into(), bytes.len().into());
        record.insert("validEmd".into(), valid.into());
        if valid {
            record.insert("version".into(), u16::from_le_bytes([bytes[8], bytes[9]]).into());
        }
        records.push(Value::Object(record));
    }
    let manifest = json!({
        "emdFiles": models.len(),
        "models": records,
        "note": "Full geometry -> Blender-XV2-Tools (pemdasu). Metadata only here.",
    });
    write_json(&root.join("models_manifest.json"), &manifest)?;
    Ok(manifest)
}

/// `parse`: gameplay formats (BAC/BCM/BCS/BDM/BSA/EAN/EMM/ESK) -> `<file>.json` with the
/// pyxenoverse-compatible readers of [`crate::game::gameplay`], then `parse_manifest.json`.
pub fn parse_in_place(root: &Path) -> Result<Value> {
    use crate::game::gameplay::{FORMATS, Loaded, load};

    let files = walk_files(root, &|extension| FORMATS.contains(&extension))?;
    let (mut ok, mut skip, mut error) = (0usize, 0usize, 0usize);
    for path in &files {
        let extension = path
            .extension()
            .map(|value| value.to_string_lossy().to_ascii_lowercase())
            .unwrap_or_default();
        let bytes = fs::read(path)?;
        match load(&extension, &bytes, &path.to_string_lossy()) {
            Some(Ok(Loaded::Json(value))) => {
                let mut output = path.clone().into_os_string();
                output.push(".json");
                write_json(Path::new(&output), &value)?;
                ok += 1;
            },
            Some(Ok(Loaded::Skipped)) => skip += 1,
            Some(Err(_)) | None => error += 1,
        }
    }
    let manifest = json!({ "total": files.len(), "ok": ok, "skip": skip, "error": error });
    write_json(&root.join("parse_manifest.json"), &manifest)?;
    Ok(manifest)
}

/// `tex`: unpack every `#EMB` into `<file>.emb.unpacked/` and decode its DDS entries to PNG.
#[cfg(feature = "dbxv2")]
pub fn tex_in_place(root: &Path) -> Result<Value> {
    use aphrody_nie_formats::g4tx_decode::{decode_dds_to_rgba, encode_rgba_to_png};

    use crate::game::formats::emb_archive::EmbArchive;

    let archives = walk_files(root, &|extension| extension == "emb")?;
    let (mut dds_total, mut png_ok, mut png_err, mut emb_err) = (0usize, 0usize, 0usize, 0usize);
    for archive_path in &archives {
        let bytes = fs::read(archive_path)?;
        let Ok(archive) = EmbArchive::parse(&bytes) else {
            emb_err += 1;
            continue;
        };
        let mut unpacked = archive_path.clone().into_os_string();
        unpacked.push(".unpacked");
        let unpacked = PathBuf::from(unpacked);
        fs::create_dir_all(&unpacked)?;
        for (index, entry) in archive.entries.iter().enumerate() {
            let data = archive.entry_bytes(&bytes, index)?;
            let output = unpacked.join(&entry.name);
            fs::write(&output, data)?;
            if !data.starts_with(b"DDS ") {
                continue;
            }
            dds_total += 1;
            let png = decode_dds_to_rgba(data)
                .and_then(|(width, height, rgba)| encode_rgba_to_png(&rgba, width as usize, height as usize));
            match png {
                Some(png) => {
                    fs::write(output.with_extension("png"), png)?;
                    png_ok += 1;
                },
                None => png_err += 1,
            }
        }
    }
    let manifest = json!({
        "embFiles": archives.len(),
        "ddsExtracted": dds_total,
        "pngOk": png_ok,
        "pngErr": png_err,
        "embErr": emb_err,
    });
    write_json(&root.join("tex_manifest.json"), &manifest)?;
    Ok(manifest)
}

/// Audio extensions of the dbxv2 `audio` pass.
pub const AUDIO_EXTENSIONS: [&str; 7] = ["hca", "adx", "acb", "awb", "afs2", "csb", "aax"];

/// Decode every subsong of one CRI audio file to PCM16 WAV images, in bank order.
#[cfg(feature = "dbxv2")]
pub fn decode_audio_subsongs(bytes: &[u8]) -> std::result::Result<Vec<Vec<u8>>, String> {
    use aphrody_nie_formats::cri_audio::{Awb, acb_parse, adx_decode, encode_pcm16_wav, is_adx, is_hca};

    // Keyless decoder of the generic pipeline: DBXV2 ships unencrypted or statically
    // scrambled HCA; no other title's key is ever applied.
    fn decode_one(data: &[u8], subkey: u16) -> std::result::Result<Vec<u8>, String> {
        if is_hca(data) {
            return crate::game::assets::export::hca_to_wav(data, None, subkey)
                .map_err(|error| error.to_string());
        }
        if is_adx(data) {
            let pcm = adx_decode(data).map_err(|error| format!("ADX: {error}"))?;
            return Ok(encode_pcm16_wav(&pcm.samples, pcm.channels, pcm.sample_rate));
        }
        Err("neither HCA nor ADX".into())
    }

    fn decode_bank(data: &[u8]) -> std::result::Result<Vec<Vec<u8>>, String> {
        let bank = Awb::parse(data).map_err(|error| format!("AWB: {error}"))?;
        bank.entries
            .iter()
            .map(|entry| decode_one(bank.entry_bytes(data, entry), bank.subkey))
            .collect()
    }

    if bytes.starts_with(b"AFS2") {
        return decode_bank(bytes);
    }
    if bytes.starts_with(b"@UTF") {
        let cue_bank = acb_parse(bytes).map_err(|error| format!("ACB: {error}"))?;
        if cue_bank.embedded_awb.is_empty() {
            // Streamed cue banks keep their waveforms in the sibling `.awb`, decoded on its own.
            return Ok(Vec::new());
        }
        return decode_bank(&cue_bank.embedded_awb);
    }
    decode_one(bytes, 0).map(|wav| vec![wav])
}

/// `audio`: every CRI audio file -> `<file>.wav.d/NNN.wav` (1-based subsong order).
#[cfg(feature = "dbxv2")]
pub fn audio_in_place(root: &Path) -> Result<Value> {
    let sources = walk_files(root, &|extension| AUDIO_EXTENSIONS.contains(&extension))?;
    let (mut ok, mut err, mut streamed) = (0usize, 0usize, 0usize);
    for source in &sources {
        let bytes = fs::read(source)?;
        match decode_audio_subsongs(&bytes) {
            Ok(waves) if waves.is_empty() => streamed += 1,
            Ok(waves) => {
                let mut directory = source.clone().into_os_string();
                directory.push(".wav.d");
                let directory = PathBuf::from(directory);
                fs::create_dir_all(&directory)?;
                for (index, wave) in waves.iter().enumerate() {
                    fs::write(directory.join(format!("{:03}.wav", index + 1)), wave)?;
                }
                ok += waves.len();
            },
            Err(_) => err += 1,
        }
    }
    let manifest =
        json!({ "audioFiles": sources.len(), "wavOk": ok, "wavErr": err, "streamedAcb": streamed });
    write_json(&root.join("audio_manifest.json"), &manifest)?;
    Ok(manifest)
}

/// Manifests summed by `report`: key, file name, summed fields.
const CONVERSION_MANIFESTS: [(&str, &str, &[&str]); 5] = [
    ("tex", "tex_manifest.json", &["embFiles", "ddsExtracted", "pngOk", "pngErr"]),
    ("audio", "audio_manifest.json", &["audioFiles", "wavOk", "wavErr"]),
    ("text", "text_manifest.json", &["msgFiles", "converted"]),
    ("models", "models_manifest.json", &["emdFiles"]),
    ("parse", "parse_manifest.json", &["total", "ok", "skip", "error"]),
];

/// `report`: aggregate `reports/{map,reverse_report,extract_manifest}.json` and the conversion
/// manifests of every `cpk/<tree>` into `reports/GLOBAL_REPORT.json`.
pub fn global_report(out: &Path, generated_utc: &str) -> Result<Value> {
    let reports = out.join("reports");
    let game = load_json(&reports.join("map.json")).unwrap_or_else(|| json!({}));
    let reverse = load_json(&reports.join("reverse_report.json")).unwrap_or_else(|| json!({}));
    let extract = load_json(&reports.join("extract_manifest.json")).unwrap_or_else(|| json!({}));

    let mut totals = Map::new();
    for (key, _, fields) in CONVERSION_MANIFESTS {
        totals.insert(key.into(), Value::Object(fields.iter().map(|field| ((*field).into(), 0.into())).collect()));
    }
    let mut by_dir = Map::new();
    let cpk = out.join("cpk");
    let mut trees: Vec<PathBuf> = fs::read_dir(&cpk)
        .into_iter()
        .flatten()
        .flatten()
        .filter(|entry| entry.file_type().is_ok_and(|kind| kind.is_dir()))
        .map(|entry| entry.path())
        .collect();
    trees.sort();
    for tree in trees {
        let mut tree_report = Map::new();
        for (key, file, fields) in CONVERSION_MANIFESTS {
            let Some(manifest) = load_json(&tree.join(file)) else { continue };
            let mut row = Map::new();
            for field in fields {
                let value = manifest.get(*field).and_then(Value::as_u64).unwrap_or(0);
                row.insert((*field).into(), value.into());
                let total = &mut totals[key][*field];
                *total = (total.as_u64().unwrap_or(0) + value).into();
            }
            tree_report.insert(key.into(), Value::Object(row));
        }
        if !tree_report.is_empty() {
            let name = tree.file_name().map(|name| name.to_string_lossy().into_owned()).unwrap_or_default();
            by_dir.insert(name, Value::Object(tree_report));
        }
    }

    let mut game_summary = game.get("game").and_then(Value::as_object).cloned().unwrap_or_default();
    if let Some(scan) = game.get("scan").and_then(Value::as_object) {
        game_summary.extend(scan.clone());
    }
    let skipped: Vec<Value> = extract
        .get("skipped")
        .and_then(Value::as_array)
        .map(|rows| rows.iter().filter_map(|row| row.get(0).cloned()).collect())
        .unwrap_or_default();
    let drm: Vec<Value> = reverse
        .get("binaries")
        .and_then(Value::as_array)
        .map(|rows| {
            rows.iter()
                .filter(|row| row.get("drm").is_some_and(|drm| !drm.is_null()))
                .filter_map(|row| row.get("file").cloned())
                .collect()
        })
        .unwrap_or_default();
    let report = json!({
        "generatedUtc": generated_utc,
        "game": game_summary,
        "extraction": {
            "cpkSelected": extract.get("selected").cloned().unwrap_or(Value::Null),
            "cpkSkipped": skipped,
            "results": extract.get("results").cloned().unwrap_or_else(|| json!([])),
        },
        "reverse": { "binaries": reverse.get("count").cloned().unwrap_or(Value::Null), "drm": drm },
        "conversion": { "totals": totals, "byDir": by_dir },
    });
    write_json(&reports.join("GLOBAL_REPORT.json"), &report)?;
    Ok(report)
}
