// SPDX-License-Identifier: Apache-2.0
//! Asset classification: the extension table first, the content magic when the extension is
//! unknown or ambiguous. Files still unknown are left to Magika (`re game index`).

use serde::Serialize;

/// Asset kinds used by the index and the exporter.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum Kind {
    /// Images and texture containers.
    Texture,
    /// Meshes and model descriptors.
    Model,
    /// Skeletons and animation clips.
    Animation,
    /// Sound files and banks.
    Audio,
    /// Movies.
    Video,
    /// Structured data (tables, configs, text banks).
    Table,
    /// Plain text and subtitles.
    Text,
    /// Scripts and bytecode.
    Script,
    /// Shaders.
    Shader,
    /// Fonts.
    Font,
    /// Engine packages holding several asset kinds (`.uasset`, Unity serialized files).
    Package,
    /// Nested containers.
    Archive,
    /// Executables and libraries.
    Executable,
    /// Not recognised.
    Unknown,
}

impl Kind {
    /// Stable lowercase name.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Texture => "texture",
            Self::Model => "model",
            Self::Animation => "animation",
            Self::Audio => "audio",
            Self::Video => "video",
            Self::Table => "table",
            Self::Text => "text",
            Self::Script => "script",
            Self::Shader => "shader",
            Self::Font => "font",
            Self::Package => "package",
            Self::Archive => "archive",
            Self::Executable => "executable",
            Self::Unknown => "unknown",
        }
    }

    /// Parse [`Kind::as_str`].
    #[must_use]
    pub fn parse(text: &str) -> Option<Self> {
        ALL.iter().copied().find(|kind| kind.as_str() == text)
    }
}

/// Every kind, in display order.
pub const ALL: [Kind; 14] = [
    Kind::Texture,
    Kind::Model,
    Kind::Animation,
    Kind::Audio,
    Kind::Video,
    Kind::Table,
    Kind::Text,
    Kind::Script,
    Kind::Shader,
    Kind::Font,
    Kind::Package,
    Kind::Archive,
    Kind::Executable,
    Kind::Unknown,
];

/// Lowercase extension of a path; `.cfg.bin` and `.lua.bin` keep their double extension.
#[must_use]
pub fn extension(path: &str) -> String {
    let name = path.rsplit('/').next().unwrap_or(path).to_ascii_lowercase();
    for double in ["cfg.bin", "lua.bin", "obj.bin"] {
        if name.ends_with(&format!(".{double}")) {
            return double.to_string();
        }
    }
    match name.rfind('.') {
        Some(at) if at > 0 => name[at + 1..].to_string(),
        _ => String::new(),
    }
}

/// Kind from the extension alone.
#[must_use]
pub fn by_extension(ext: &str) -> Kind {
    match ext {
        "png" | "jpg" | "jpeg" | "tga" | "bmp" | "dds" | "ktx" | "ktx2" | "webp" | "hdr"
        | "exr" | "gif" | "tif" | "tiff" | "g4tx" | "emb" | "xtx" | "gtx" | "astc" | "pvr"
        | "tex" => Kind::Texture,
        "glb" | "gltf" | "fbx" | "obj" | "dae" | "3ds" | "ply" | "stl" | "g4md" | "g4mg"
        | "g4pkm" | "emd" | "emo" | "nsk" | "nif" | "mdl" | "smd" | "dmx" | "mesh" => Kind::Model,
        "g4sk" | "esk" | "ean" | "ema" | "anim" | "g4ra" | "g4mt" | "bvh" | "skel" => Kind::Animation,
        "wav" | "ogg" | "opus" | "flac" | "mp3" | "m4a" | "aac" | "hca" | "adx" | "acb" | "awb"
        | "wem" | "bnk" | "fsb" | "bank" | "xwb" | "xsb" | "at9" | "vag" => Kind::Audio,
        "usm" | "bik" | "bk2" | "mp4" | "webm" | "wmv" | "avi" | "mkv" | "mov" | "m2v" | "ivf" => {
            Kind::Video
        },
        "cfg.bin" | "csv" | "tsv" | "json" | "xml" | "yaml" | "yml" | "toml" | "ini" | "msg"
        | "bdm" | "cms" | "cus" | "pup" | "bcs" | "bsa" | "bac" | "bcm" | "emm" | "objbin"
        | "obj.bin" | "mevbin" | "db" | "sqlite" | "tbl" | "dat" | "cfg" | "acf" | "vdf"
        | "csb" | "qed" | "qbt" | "qml" | "qsl" | "qxd" | "idb" | "bev" => Kind::Table,
        "txt" | "srt" | "ass" | "vtt" | "md" | "html" | "htm" | "log" => Kind::Text,
        "lua" | "luac" | "lua.bin" | "rpy" | "rpyc" | "gd" | "gdc" | "py" | "pyc" | "js"
        | "cs" | "nut" | "as" | "mevs" => Kind::Script,
        "hlsl" | "glsl" | "spv" | "cso" | "fxo" | "vfxo" | "pfxo" | "gfxo" | "cfxo" | "dxbc"
        | "shader" | "metal" | "wgsl" => Kind::Shader,
        "ttf" | "otf" | "fnt" | "woff" | "woff2" | "fontdef" | "ufont" => Kind::Font,
        "uasset" | "umap" | "uexp" | "ubulk" | "uptnl" | "assets" | "ress" | "resource"
        | "g4pk" | "cab" => Kind::Package,
        "cpk" | "pak" | "utoc" | "ucas" | "pck" | "rpa" | "zip" | "pk3" | "7z" | "rar" | "vpk"
        | "bundle" | "unity3d" | "ab" | "assetbundle" | "arc" | "xpck" => Kind::Archive,
        "exe" | "dll" | "so" | "dylib" | "elf" | "x86_64" => Kind::Executable,
        _ => Kind::Unknown,
    }
}

/// Format id from the first bytes (`None` when not recognised).
#[must_use]
pub fn sniff(head: &[u8]) -> Option<(&'static str, Kind)> {
    const TABLE: &[(&[u8], &str, Kind)] = &[
        (b"\x89PNG", "png", Kind::Texture),
        (b"\xFF\xD8\xFF", "jpeg", Kind::Texture),
        (b"DDS ", "dds", Kind::Texture),
        (b"\xABKTX 20", "ktx2", Kind::Texture),
        (b"\xABKTX 11", "ktx", Kind::Texture),
        (b"G4TX", "g4tx", Kind::Texture),
        (b"#EMB", "emb", Kind::Texture),
        (b"glTF", "glb", Kind::Model),
        (b"Kaydara FBX", "fbx", Kind::Model),
        (b"G4MD", "g4md", Kind::Model),
        (b"G4MG", "g4mg", Kind::Model),
        (b"#EMD", "emd", Kind::Model),
        (b"#ESK", "esk", Kind::Animation),
        (b"#EAN", "ean", Kind::Animation),
        (b"G4SK", "g4sk", Kind::Animation),
        (b"OggS", "ogg", Kind::Audio),
        (b"fLaC", "flac", Kind::Audio),
        (b"ID3", "mp3", Kind::Audio),
        (b"HCA\0", "hca", Kind::Audio),
        (b"\xC8\xC3\xC1\0", "hca", Kind::Audio),
        (b"AFS2", "awb", Kind::Audio),
        (b"BKHD", "bnk", Kind::Audio),
        (b"FSB5", "fsb", Kind::Audio),
        (b"CRID", "usm", Kind::Video),
        (b"\x1A\x45\xDF\xA3", "webm", Kind::Video),
        (b"BIK", "bik", Kind::Video),
        (b"KB2", "bk2", Kind::Video),
        (b"DKIF", "ivf", Kind::Video),
        (b"@UTF", "cri-utf", Kind::Table),
        (b"RDBN", "cfg.bin", Kind::Table),
        (b"#MSG", "msg", Kind::Table),
        (b"SQLite format 3", "sqlite", Kind::Table),
        (b"\x1BLua", "lua-bytecode", Kind::Script),
        (b"DXBC", "dxbc", Kind::Shader),
        (b"\x03\x02\x23\x07", "spirv", Kind::Shader),
        (b"\0\x01\0\0", "ttf", Kind::Font),
        (b"OTTO", "otf", Kind::Font),
        (b"wOFF", "woff", Kind::Font),
        (b"wOF2", "woff2", Kind::Font),
        (b"\xC1\x83\x2A\x9E", "uasset", Kind::Package),
        (b"UnityFS", "unityfs", Kind::Archive),
        (b"CPK ", "cpk", Kind::Archive),
        (b"GDPC", "gdpc", Kind::Archive),
        (b"PK\x03\x04", "zip", Kind::Archive),
        (b"7z\xBC\xAF", "7z", Kind::Archive),
        (b"CRILAYLA", "crilayla", Kind::Archive),
        (b"MZ", "pe", Kind::Executable),
        (b"\x7FELF", "elf", Kind::Executable),
    ];
    if head.len() >= 12 && &head[..4] == b"RIFF" {
        return Some(match &head[8..12] {
            b"WAVE" => ("wav", Kind::Audio),
            b"WEBP" => ("webp", Kind::Texture),
            b"AVI " => ("avi", Kind::Video),
            _ => ("riff", Kind::Unknown),
        });
    }
    if head.len() >= 8 && &head[4..8] == b"ftyp" {
        return Some(("mp4", Kind::Video));
    }
    TABLE.iter().find(|(magic, _, _)| head.starts_with(magic)).map(|(_, id, kind)| (*id, *kind))
}

/// Classify a path, using `head` (first bytes) when the extension is unknown or generic.
#[must_use]
pub fn classify(path: &str, head: Option<&[u8]>) -> (Kind, String) {
    let ext = extension(path);
    let by_ext = by_extension(&ext);
    let generic = matches!(ext.as_str(), "" | "bin" | "dat" | "tex" | "pak");
    if (by_ext == Kind::Unknown || generic)
        && let Some(head) = head
        && let Some((id, kind)) = sniff(head)
    {
        return (kind, id.to_string());
    }
    (by_ext, ext)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extension_then_magic() {
        assert_eq!(extension("data/common/a.cfg.bin"), "cfg.bin");
        assert_eq!(classify("a/b.g4tx", None).0, Kind::Texture);
        assert_eq!(classify("chara/GOK/GOK_000.emd", None).0, Kind::Model);
        assert_eq!(classify("noext", Some(b"OggS\0")).0, Kind::Audio);
        assert_eq!(classify("x.bin", Some(b"DDS |")), (Kind::Texture, "dds".to_string()));
        assert_eq!(classify("y.bin", Some(b"RIFF\0\0\0\0WAVEfmt ")).0, Kind::Audio);
        assert_eq!(classify("z.unknownext", Some(b"zzzz")).0, Kind::Unknown);
    }
}
