// SPDX-License-Identifier: Apache-2.0
//! Bounded, evidence-based engine detection over a game install directory. Every score comes
//! with the files that justify it. Only names, sizes and the first or last bytes of candidate
//! containers are read. Anti-cheat runtimes are reported for information and never touched.

use std::{
    collections::BTreeMap,
    path::{Path, PathBuf},
};

use serde::Serialize;

use super::{
    AssetError, AssetResult,
    archive::{ArchiveKind, godot, pak, sniff},
    source::FileSource,
};

/// Engine families the pipeline recognises.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum Engine {
    /// Unreal Engine (`.pak`, IoStore).
    Unreal,
    /// Unity (`UnityPlayer`, `*_Data`, UnityFS bundles).
    Unity,
    /// CRI Middleware containers (`.cpk`, `.acb`/`.awb`, `.usm`).
    Cri,
    /// Level-5 (`data/cpk_list.cfg.bin`, `G4*` formats).
    Level5,
    /// Ren'Py (`renpy/`, `.rpa`, `.rpyc`).
    RenPy,
    /// Godot (`GDPC` packs).
    Godot,
    /// Valve Source (`.vpk`).
    Source,
    /// Generic archives (`.zip`, `.pk3`, `.7z`).
    Generic,
}

/// Score of one engine with its evidence.
#[derive(Debug, Clone, Serialize)]
pub struct EngineScore {
    /// Engine.
    pub engine: Engine,
    /// Sum of evidence weights.
    pub score: u32,
    /// Up to 12 justifying observations.
    pub evidence: Vec<String>,
}

/// A container found during detection.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FoundArchive {
    /// Path relative to the root.
    pub path: String,
    /// Detected family.
    pub kind: ArchiveKind,
    /// Size in bytes.
    pub size: u64,
}

/// Detection report.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineReport {
    /// Install root.
    pub root: String,
    /// Highest-scoring engine (`None` when nothing matched).
    pub primary: Option<Engine>,
    /// Every engine with a positive score, best first.
    pub engines: Vec<EngineScore>,
    /// Containers worth mounting, in path order.
    pub archives: Vec<FoundArchive>,
    /// Executables at the top two levels.
    pub executables: Vec<String>,
    /// Anti-cheat runtimes present (reported only; never mounted or modified).
    pub anti_cheat: Vec<String>,
    /// Steam app id from `steam_appid.txt` or the enclosing library's app manifests.
    pub steam_app_id: Option<u32>,
    /// Files visited.
    pub files_scanned: usize,
    /// Total size of visited files.
    pub bytes_scanned: u64,
    /// True when the walk stopped at its bound.
    pub truncated: bool,
}

/// Bounds of a detection walk.
#[derive(Debug, Clone, Copy)]
pub struct DetectLimits {
    /// Deepest directory level visited.
    pub max_depth: usize,
    /// Files visited before stopping.
    pub max_files: usize,
}

impl Default for DetectLimits {
    fn default() -> Self {
        Self { max_depth: 10, max_files: 400_000 }
    }
}

/// Directories holding anti-cheat runtimes: reported, never descended into.
pub const ANTI_CHEAT_DIRS: [&str; 4] = ["easyanticheat", "battleye", "eac", "anticheat"];
const ANTI_CHEAT_FILES: [&str; 5] =
    ["eaclauncher.exe", "start_protected_game.exe", "beservice.exe", "beservice_x64.exe", "battleye"];

#[derive(Default)]
struct Scores(BTreeMap<Engine, (u32, Vec<String>)>);

impl Scores {
    fn add(&mut self, engine: Engine, weight: u32, why: String) {
        let slot = self.0.entry(engine).or_default();
        slot.0 = slot.0.saturating_add(weight);
        if slot.1.len() < 12 {
            slot.1.push(why);
        }
    }
}

fn relative(root: &Path, path: &Path) -> String {
    path.strip_prefix(root).unwrap_or(path).to_string_lossy().replace('\\', "/")
}

/// One step of [`walk`].
pub(crate) enum WalkEvent<'a> {
    /// A regular file.
    File {
        /// Absolute path.
        path: &'a Path,
        /// Path relative to the root, `/`-separated.
        rel: &'a str,
        /// Directory depth (0 = root).
        depth: usize,
        /// Size in bytes.
        size: u64,
    },
    /// A directory (anti-cheat directories are reported but not descended into).
    Dir {
        /// Path relative to the root.
        rel: &'a str,
    },
}

/// Walk `root` (skipping anti-cheat directories and symlinks). Returns
/// `(files, bytes, truncated)`.
pub(crate) fn walk(
    root: &Path,
    limits: DetectLimits,
    mut visit: impl FnMut(WalkEvent<'_>),
) -> AssetResult<(usize, u64, bool)> {
    let mut pending = vec![(root.to_path_buf(), 0usize)];
    let (mut files, mut bytes) = (0usize, 0u64);
    while let Some((dir, depth)) = pending.pop() {
        let read = match std::fs::read_dir(&dir) {
            Ok(read) => read,
            Err(source) if dir == root => {
                return Err(AssetError::Io { path: root.display().to_string(), source });
            },
            Err(_) => continue,
        };
        let mut children: Vec<_> = read.flatten().collect();
        children.sort_by_key(std::fs::DirEntry::file_name);
        for child in children {
            let Ok(kind) = child.file_type() else { continue };
            if kind.is_symlink() {
                continue;
            }
            let path = child.path();
            let rel = relative(root, &path);
            if kind.is_dir() {
                visit(WalkEvent::Dir { rel: &rel });
                let lower = child.file_name().to_string_lossy().to_ascii_lowercase();
                if depth < limits.max_depth && !ANTI_CHEAT_DIRS.contains(&lower.as_str()) {
                    pending.push((path, depth + 1));
                }
            } else if kind.is_file() {
                files += 1;
                let size = child.metadata().map(|m| m.len()).unwrap_or(0);
                bytes += size;
                visit(WalkEvent::File { path: &path, rel: &rel, depth, size });
                if files >= limits.max_files {
                    return Ok((files, bytes, true));
                }
            }
        }
    }
    Ok((files, bytes, false))
}

/// Read the Steam app id of an install: `steam_appid.txt`, else the enclosing library's
/// `appmanifest_*.acf` whose `installdir` matches (through `bun-steam`).
#[must_use]
pub fn steam_app_id(root: &Path) -> Option<u32> {
    if let Ok(text) = std::fs::read_to_string(root.join("steam_appid.txt"))
        && let Ok(id) = text.trim().parse()
    {
        return Some(id);
    }
    let name = root.file_name()?.to_string_lossy().to_string();
    let common = root.parent()?;
    if !common.file_name()?.to_string_lossy().eq_ignore_ascii_case("common") {
        return None;
    }
    let steamapps = common.parent()?;
    bun_steam::scan_manifests_in_steamapps(steamapps)
        .into_iter()
        .find(|manifest| manifest.install_dir.eq_ignore_ascii_case(&name))
        .map(|manifest| manifest.app_id)
}

/// Detect the engine(s) of the install at `root`.
///
/// # Errors
/// The root cannot be listed.
#[allow(clippy::too_many_lines)]
pub fn detect(root: &Path, limits: DetectLimits) -> AssetResult<EngineReport> {
    let mut scores = Scores::default();
    let mut archives = Vec::new();
    let mut executables = Vec::new();
    let mut anti_cheat = Vec::new();
    let mut candidates: Vec<(PathBuf, String, u64)> = Vec::new();
    let mut cri_media = 0u32;
    let mut level5_assets = 0u32;
    let mut unity_assets = 0u32;
    let mut unreal_packages = 0u32;
    let (files, bytes, truncated) = walk(root, limits, |event| match event {
        WalkEvent::File { path, rel, depth, size } => {
            let lower = rel.to_ascii_lowercase();
            let name = lower.rsplit('/').next().unwrap_or(&lower).to_string();
            let ext = name.rsplit_once('.').map_or("", |(_, ext)| ext);
            if ANTI_CHEAT_FILES.contains(&name.as_str()) {
                anti_cheat.push(rel.to_string());
            }
            if depth <= 1 && matches!(ext, "exe" | "x86_64" | "app" | "sh") {
                executables.push(rel.to_string());
            }
            match name.as_str() {
                "unityplayer.dll" | "unityplayer.so" | "unityplayer.dylib" => {
                    scores.add(Engine::Unity, 10, format!("{rel}: Unity player"));
                },
                "globalgamemanagers" | "maindata" | "data.unity3d" => {
                    scores.add(Engine::Unity, 10, format!("{rel}: Unity player data"));
                },
                "gameassembly.dll" => scores.add(Engine::Unity, 3, format!("{rel}: IL2CPP")),
                "cpk_list.cfg.bin" => {
                    scores.add(Engine::Level5, 10, format!("{rel}: Level-5 CPK index"));
                },
                _ => {},
            }
            if name.ends_with("-shipping.exe") {
                scores.add(Engine::Unreal, 5, format!("{rel}: Unreal shipping binary"));
            }
            if lower.contains("/engine/binaries/") || lower.starts_with("engine/binaries/") {
                scores.add(Engine::Unreal, 2, format!("{rel}: Unreal Engine/Binaries"));
            }
            match ext {
                "acb" | "awb" | "usm" | "hca" | "adx" => cri_media += 1,
                "g4tx" | "g4md" | "g4mg" | "g4pkm" => level5_assets += 1,
                "assets" | "ress" | "resource" => unity_assets += 1,
                "uasset" | "umap" | "uexp" => unreal_packages += 1,
                "rpyc" | "rpy" => scores.add(Engine::RenPy, 1, format!("{rel}: Ren'Py script")),
                _ => {},
            }
            if matches!(
                ext,
                "cpk" | "pak" | "utoc" | "pck" | "rpa" | "zip" | "pk3" | "7z" | "vpk" | "bundle"
                    | "unity3d" | "ab" | "assetbundle"
            ) || (depth <= 1 && ext == "exe")
            {
                candidates.push((path.to_path_buf(), rel.to_string(), size));
            }
        },
        WalkEvent::Dir { rel: dir } => {
            let lower = dir.to_ascii_lowercase();
            let leaf = lower.rsplit('/').next().unwrap_or(&lower);
            if leaf == "renpy" {
                scores.add(Engine::RenPy, 10, format!("{dir}/: Ren'Py runtime"));
            }
            if ANTI_CHEAT_DIRS.contains(&leaf) {
                anti_cheat.push(format!("{dir}/"));
            }
            if leaf.ends_with("_data") && !lower.contains('/') {
                scores.add(Engine::Unity, 2, format!("{dir}/: Unity data folder"));
            }
        },
    })?;

    for (path, rel, size) in candidates {
        let Ok(source) = FileSource::open(&path) else { continue };
        let head = source.read_clamped(0, 16).unwrap_or_default();
        let lower = rel.to_ascii_lowercase();
        let Some(kind) = sniff(&lower, &head) else {
            if lower.ends_with(".exe") && godot::locate(&source).ok().flatten().is_some() {
                scores.add(Engine::Godot, 10, format!("{rel}: embedded GDPC pack"));
                archives.push(FoundArchive { path: rel, kind: ArchiveKind::GodotPck, size });
            }
            continue;
        };
        if kind == ArchiveKind::UnrealPak {
            match pak::probe(&source) {
                Ok(Some(footer)) => {
                    scores.add(Engine::Unreal, 10, format!("{rel}: pak v{}", footer.version));
                },
                _ => continue,
            }
        }
        match kind {
            ArchiveKind::Cpk => scores.add(Engine::Cri, 10, format!("{rel}: CPK")),
            ArchiveKind::CpkEncrypted => {
                scores.add(Engine::Cri, 3, format!("{rel}: CPK with an unreadable header"));
            },
            ArchiveKind::UnrealIoStore => scores.add(Engine::Unreal, 10, format!("{rel}: IoStore")),
            ArchiveKind::UnityFs => scores.add(Engine::Unity, 5, format!("{rel}: UnityFS bundle")),
            ArchiveKind::GodotPck => scores.add(Engine::Godot, 10, format!("{rel}: GDPC pack")),
            ArchiveKind::RenPyRpa => scores.add(Engine::RenPy, 10, format!("{rel}: RPA archive")),
            ArchiveKind::Vpk => scores.add(Engine::Source, 5, format!("{rel}: VPK")),
            ArchiveKind::Zip | ArchiveKind::SevenZip => {
                scores.add(Engine::Generic, 1, format!("{rel}: generic archive"));
            },
            ArchiveKind::UnrealPak => {},
        }
        archives.push(FoundArchive { path: rel, kind, size });
    }
    if cri_media > 0 {
        scores.add(Engine::Cri, cri_media.min(10), format!("{cri_media} CRI media files"));
    }
    if level5_assets > 0 {
        scores.add(Engine::Level5, level5_assets.min(5), format!("{level5_assets} loose G4 files"));
    }
    if unity_assets > 0 {
        scores.add(Engine::Unity, unity_assets.min(5), format!("{unity_assets} serialized files"));
    }
    if unreal_packages > 0 {
        scores.add(Engine::Unreal, unreal_packages.min(5), format!("{unreal_packages} packages"));
    }
    // Level-5 IEVR ships CRI containers: the Level-5 index outranks the CRI evidence.
    let mut engines: Vec<EngineScore> = scores
        .0
        .into_iter()
        .map(|(engine, (score, evidence))| EngineScore { engine, score, evidence })
        .collect();
    engines.sort_by(|a, b| b.score.cmp(&a.score).then(a.engine.cmp(&b.engine)));
    let primary = if engines.iter().any(|e| e.engine == Engine::Level5 && e.score >= 10) {
        Some(Engine::Level5)
    } else {
        engines.first().map(|e| e.engine)
    };
    archives.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(EngineReport {
        root: root.display().to_string(),
        primary,
        engines,
        archives,
        executables,
        anti_cheat,
        steam_app_id: steam_app_id(root),
        files_scanned: files,
        bytes_scanned: bytes,
        truncated,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_unreal_from_a_pak_and_skips_anti_cheat() {
        let dir = tempfile::tempdir().unwrap();
        let content = dir.path().join("Game/Content/Paks");
        std::fs::create_dir_all(&content).unwrap();
        std::fs::write(content.join("Game-Windows.pak"), crate::game::assets::archive::pak::tests::sample_pak())
            .unwrap();
        std::fs::create_dir_all(dir.path().join("EasyAntiCheat")).unwrap();
        std::fs::write(dir.path().join("EasyAntiCheat/settings.json"), b"{}").unwrap();
        std::fs::write(dir.path().join("Game-Win64-Shipping.exe"), b"MZ").unwrap();
        let report = detect(dir.path(), DetectLimits::default()).unwrap();
        assert_eq!(report.primary, Some(Engine::Unreal));
        assert_eq!(report.archives.len(), 1);
        assert_eq!(report.anti_cheat, ["EasyAntiCheat/"]);
        assert_eq!(report.files_scanned, 2);
    }
}
