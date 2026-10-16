// SPDX-License-Identifier: Apache-2.0
//! Read-only Steam library inventory and DBXV2 installation inspection.
//!
//! Adapts Steam app data discovery, manifest planning, and depot inspection
//! patterns from `aphrody-nie-steam` tailored for Dragon Ball Xenoverse 2 (AppID 454650).
//!
//! Only `steamapps/appmanifest_*.acf` metadata and local directories are read.
//! Account credentials, tokens, and client configuration are never accessed.

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use serde::{Deserialize, Serialize};

/// Steam App ID for Dragon Ball Xenoverse 2 (Dimps / Bandai Namco).
pub const STEAM_APP_ID_DBXV2: u32 = 454650;
/// Steam App ID for Dragon Ball Xenoverse 1.
pub const STEAM_APP_ID_DBXV1: u32 = 323470;
/// Steam App ID for Dragon Ball FighterZ.
pub const STEAM_APP_ID_DB_FIGHTERZ: u32 = 678950;
/// Steam App ID for Dragon Ball Z: Kakarot.
pub const STEAM_APP_ID_DB_KAKAROT: u32 = 851850;
/// Steam App ID for Dragon Ball: Sparking! ZERO.
pub const STEAM_APP_ID_DB_SPARKING_ZERO: u32 = 1790600;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SteamGameInstall {
    pub app_id: u32,
    pub name: String,
    pub install_dir: PathBuf,
    pub manifest: PathBuf,
}

/// Detailed Dragon Ball Xenoverse 2 local installation status and archive presence.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Dbxv2Install {
    pub install_dir: PathBuf,
    pub executable_path: PathBuf,
    pub has_executable: bool,
    pub data2_cpk_exists: bool,
    pub data_cpk_exists: bool,
    pub has_mod_data_dir: bool,
    pub dlc_cpk_count: usize,
    pub dlc_cpk_names: Vec<String>,
}

impl Dbxv2Install {
    /// Returns true if the core executable and base CPK archives are present.
    pub fn is_valid_installation(&self) -> bool {
        self.has_executable && (self.data2_cpk_exists || self.data_cpk_exists)
    }
}

/// Upper bounds applied before processing untrusted manifest inputs (from `aphrody-nie-steam`).
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct SteamPlanningLimits {
    pub max_depots: usize,
    pub max_manifest_entries: usize,
    pub max_collisions: usize,
}

impl Default for SteamPlanningLimits {
    fn default() -> Self {
        Self {
            max_depots: 1024,
            max_manifest_entries: 250_000,
            max_collisions: 2048,
        }
    }
}

/// Normalized Steam depot record for Xenoverse content planning.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct SteamDepotRecord {
    pub depot_id: u32,
    pub name: String,
    pub manifest_id: u64,
    pub is_dlc: bool,
}

/// Inspects a potential DBXV2 installation directory on disk.
pub fn inspect_dbxv2_install(install_dir: &Path) -> Dbxv2Install {
    let exe_in_bin = install_dir.join("bin").join("DBXV2.exe");
    let exe_root = install_dir.join("DBXV2.exe");
    let (executable_path, has_executable) = if exe_in_bin.is_file() {
        (exe_in_bin, true)
    } else if exe_root.is_file() {
        (exe_root, true)
    } else {
        (exe_in_bin, false)
    };

    let data2_cpk = install_dir.join("data2.cpk").is_file();
    let data_cpk = install_dir.join("data.cpk").is_file();
    let has_mod_data_dir = install_dir.join("data").is_dir();

    let mut dlc_cpk_names = Vec::new();
    if let Ok(entries) = std::fs::read_dir(install_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
                let lower = name.to_ascii_lowercase();
                if lower.starts_with("data_d") && lower.ends_with(".cpk") {
                    dlc_cpk_names.push(name.to_string());
                }
            }
        }
        dlc_cpk_names.sort();
    }

    Dbxv2Install {
        install_dir: install_dir.to_path_buf(),
        executable_path,
        has_executable,
        data2_cpk_exists: data2_cpk,
        data_cpk_exists: data_cpk,
        has_mod_data_dir,
        dlc_cpk_count: dlc_cpk_names.len(),
        dlc_cpk_names,
    }
}

/// Find installed Dragon Ball titles in explicitly supplied Steam library roots.
pub fn scan_dragon_ball_installs(libraries: &[PathBuf]) -> std::io::Result<Vec<SteamGameInstall>> {
    let mut installs = Vec::new();
    let mut seen_app_ids = HashSet::new();

    for library in libraries {
        let steamapps = library.join("steamapps");
        let entries = match std::fs::read_dir(&steamapps) {
            Ok(entries) => entries,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
            Err(error) => return Err(error),
        };
        for entry in entries {
            let entry = entry?;
            let file_name = entry.file_name();
            if !file_name.to_string_lossy().starts_with("appmanifest_") {
                continue;
            }
            let manifest = entry.path();
            let content = std::fs::read_to_string(&manifest)?;
            if let Some((app_id, name, install_dir)) = parse_app_manifest(&content) {
                let is_db_app = app_id == STEAM_APP_ID_DBXV2
                    || app_id == STEAM_APP_ID_DBXV1
                    || app_id == STEAM_APP_ID_DB_FIGHTERZ
                    || app_id == STEAM_APP_ID_DB_KAKAROT
                    || app_id == STEAM_APP_ID_DB_SPARKING_ZERO
                    || name.to_ascii_lowercase().contains("dragon ball");

                if is_db_app && seen_app_ids.insert(app_id) {
                    installs.push(SteamGameInstall {
                        app_id,
                        name,
                        install_dir: steamapps.join("common").join(install_dir),
                        manifest,
                    });
                }
            }
        }
    }
    installs.sort_by_key(|left| left.app_id);
    Ok(installs)
}

fn parse_app_manifest(content: &str) -> Option<(u32, String, String)> {
    let app_id = vdf_value(content, "appid")?.parse().ok()?;
    let name = vdf_value(content, "name")?;
    let install_dir = vdf_value(content, "installdir")?;
    let install_dir = Path::new(&install_dir);
    if install_dir.components().count() != 1
        || install_dir.components().any(|part| !matches!(part, std::path::Component::Normal(_)))
    {
        return None;
    }
    Some((app_id, name, install_dir.to_string_lossy().into_owned()))
}

fn vdf_value(content: &str, key: &str) -> Option<String> {
    content.lines().find_map(|line| {
        let mut fields = line.split('"').filter(|field| !field.trim().is_empty());
        (fields.next()? == key).then(|| fields.next().map(str::to_owned)).flatten()
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_steam_app_ids() {
        assert_eq!(STEAM_APP_ID_DBXV2, 454650);
        assert_eq!(STEAM_APP_ID_DBXV1, 323470);
        assert_eq!(STEAM_APP_ID_DB_FIGHTERZ, 678950);
        assert_eq!(STEAM_APP_ID_DB_KAKAROT, 851850);
        assert_eq!(STEAM_APP_ID_DB_SPARKING_ZERO, 1790600);
    }

    #[test]
    fn test_inspect_dbxv2_synthetic_install() {
        let temp_dir = std::env::temp_dir().join(format!("test_dbxv2_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&temp_dir);
        std::fs::create_dir_all(&temp_dir).unwrap();
        let game_dir = &temp_dir;

        let bin_dir = game_dir.join("bin");
        std::fs::create_dir_all(&bin_dir).unwrap();
        std::fs::write(bin_dir.join("DBXV2.exe"), b"MOCK_EXE").unwrap();
        std::fs::write(game_dir.join("data2.cpk"), b"MOCK_DATA2").unwrap();
        std::fs::write(game_dir.join("data_d1_1_xv1.cpk"), b"MOCK_DLC1").unwrap();

        let inspection = inspect_dbxv2_install(game_dir);
        assert!(inspection.has_executable);
        assert!(inspection.data2_cpk_exists);
        assert!(!inspection.data_cpk_exists);
        assert_eq!(inspection.dlc_cpk_count, 1);
        assert_eq!(inspection.dlc_cpk_names, vec!["data_d1_1_xv1.cpk"]);
        assert!(inspection.is_valid_installation());

        let _ = std::fs::remove_dir_all(&temp_dir);
    }
}
