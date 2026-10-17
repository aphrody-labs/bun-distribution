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

/// Identify a buffer by magic first, then by the extension of `file_name`.
pub fn identify(bytes: &[u8], file_name: &str) -> FormatInfo {
    use aphrody_nie_formats::cri_audio::{is_adx, is_hca};
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
        _ if is_hca(bytes) => Some("hca"),
        _ if is_adx(bytes) => Some("adx"),
        _ => None,
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn identify_uses_magic_then_extension() {
        assert_eq!(identify(b"#EMB....", "x.bin").format, "emb");
        assert_eq!(identify(b"????", "chara.BAC").format, "bac");
        assert_eq!(identify(b"????", "x.zzz").format, "unknown");
    }
}
