// SPDX-License-Identifier: Apache-2.0
//! Steam installation discovery (Linux native/Flatpak/Snap, Windows, WSL mounts, macOS),
//! `libraryfolders.vdf` library enumeration, `appmanifest_<appid>.acf` parsing and installed-game
//! scanning.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::SteamError;
use crate::vdf::{VdfValue, parse_vdf};

// ---------------------------------------------------------------------------
// ACF AppManifest Parser (`appmanifest_<appid>.acf`)
// ---------------------------------------------------------------------------

/// StateFlags bitmask definitions used in Steam `appmanifest_<appid>.acf`.
pub mod state_flags {
    /// App is not installed.
    pub const STATE_UNINSTALLED: u64 = 1;
    /// App has an update pending/required.
    pub const STATE_UPDATE_REQUIRED: u64 = 2;
    /// App is fully installed and playable.
    pub const STATE_FULLY_INSTALLED: u64 = 4;
    /// App contents are encrypted.
    pub const STATE_ENCRYPTED: u64 = 8;
    /// App is locked by Steam.
    pub const STATE_LOCKED: u64 = 16;
    /// One or more files are missing.
    pub const STATE_FILES_MISSING: u64 = 32;
    /// App is currently running.
    pub const STATE_APP_RUNNING: u64 = 64;
    /// Files failed integrity check.
    pub const STATE_FILES_CORRUPT: u64 = 128;
    /// Background update in progress.
    pub const STATE_UPDATE_RUNNING: u64 = 256;
    /// Background update is paused.
    pub const STATE_UPDATE_PAUSED: u64 = 512;
    /// Update process has started.
    pub const STATE_UPDATE_STARTED: u64 = 1024;
    /// App is being uninstalled.
    pub const STATE_UNINSTALLING: u64 = 2048;
    /// Backup process running.
    pub const STATE_BACKUP_RUNNING: u64 = 4096;
}

/// Parsed metadata representing a Steam game manifest (`appmanifest_<appid>.acf`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AppManifest {
    /// Steam Application ID (e.g. `730` for Counter-Strike 2, `1091500` for Cyberpunk 2077).
    pub app_id: u32,
    /// Canonical display title.
    pub name: String,
    /// Install subdirectory inside `steamapps/common/`.
    pub install_dir: String,
    /// Current Steam installation state flags bitmask.
    pub state_flags: u64,
    /// Space occupied on disk in bytes (`SizeOnDisk`).
    pub size_on_disk: u64,
    /// Active build ID from Steam depot CDN.
    pub build_id: u64,
    /// Unix timestamp of the last update/manifest sync (`LastUpdated`).
    pub last_updated: u64,
    /// SteamID64 of the purchasing owner account, if recorded.
    pub last_owner: Option<u64>,
    /// Bytes remaining to download (`BytesToDownload`).
    pub bytes_to_download: u64,
    /// Bytes already downloaded (`BytesDownloaded`).
    pub bytes_downloaded: u64,
    /// Staging directory size in bytes (`BytesStaged` or `staging_size`).
    pub staging_size: u64,
    /// Target build ID if update pending (`TargetBuildID`).
    pub target_build_id: u64,
    /// IDs of installed depots.
    pub installed_depots: Vec<u32>,
    /// User config entries (e.g. language, beta branches).
    pub user_config: BTreeMap<String, String>,
}

impl AppManifest {
    /// Parse an ACF file from raw VDF text.
    pub fn parse(input: &str) -> Result<Self, SteamError> {
        let root = parse_vdf(input)?;
        Self::from_vdf(&root)
    }

    /// Construct an [`AppManifest`] from a parsed [`VdfValue`].
    pub fn from_vdf(root: &VdfValue) -> Result<Self, SteamError> {
        // AppState block is typically the root table
        let app_state = root
            .get("AppState")
            .or_else(|| {
                // If top-level keys directly contain "appid", treat root as AppState
                if root.get("appid").is_some() {
                    Some(root)
                } else {
                    None
                }
            })
            .ok_or_else(|| SteamError::MalformedAcf("missing 'AppState' section".to_string()))?;

        let app_id = app_state
            .get_u64("appid")
            .ok_or_else(|| SteamError::MalformedAcf("missing or invalid 'appid'".to_string()))?
            as u32;

        let name = app_state.get_str("name").unwrap_or_default().to_string();

        let install_dir = app_state
            .get_str("installdir")
            .unwrap_or_default()
            .to_string();

        let state_flags = app_state.get_u64("StateFlags").unwrap_or(0);
        let size_on_disk = app_state
            .get_u64("SizeOnDisk")
            .or_else(|| app_state.get_u64("size_on_disk"))
            .unwrap_or(0);
        let build_id = app_state
            .get_u64("buildid")
            .or_else(|| app_state.get_u64("build_id"))
            .unwrap_or(0);
        let last_updated = app_state
            .get_u64("LastUpdated")
            .or_else(|| app_state.get_u64("last_updated"))
            .unwrap_or(0);
        let last_owner = app_state.get_u64("LastOwner");
        let bytes_to_download = app_state.get_u64("BytesToDownload").unwrap_or(0);
        let bytes_downloaded = app_state.get_u64("BytesDownloaded").unwrap_or(0);
        let staging_size = app_state
            .get_u64("BytesStaged")
            .or_else(|| app_state.get_u64("staging_size"))
            .unwrap_or(0);
        let target_build_id = app_state.get_u64("TargetBuildID").unwrap_or(0);

        let mut installed_depots = Vec::new();
        if let Some(depots) = app_state.get_table("InstalledDepots") {
            for (k, _) in depots {
                if let Ok(d_id) = k.parse::<u32>() {
                    installed_depots.push(d_id);
                }
            }
        }

        let mut user_config = BTreeMap::new();
        if let Some(cfg) = app_state.get_table("UserConfig") {
            for (k, v) in cfg {
                if let VdfValue::Str(val) = v {
                    user_config.insert(k.clone(), val.clone());
                }
            }
        }

        Ok(Self {
            app_id,
            name,
            install_dir,
            state_flags,
            size_on_disk,
            build_id,
            last_updated,
            last_owner,
            bytes_to_download,
            bytes_downloaded,
            staging_size,
            target_build_id,
            installed_depots,
            user_config,
        })
    }

    /// Whether the game is fully installed and marked runnable (`STATE_FULLY_INSTALLED = 4`).
    pub fn is_installed(&self) -> bool {
        (self.state_flags & state_flags::STATE_FULLY_INSTALLED) != 0
    }

    /// Whether an update is required (`STATE_UPDATE_REQUIRED = 2`).
    pub fn is_update_required(&self) -> bool {
        (self.state_flags & state_flags::STATE_UPDATE_REQUIRED) != 0
    }

    /// Whether an active or paused download is in progress.
    pub fn is_downloading(&self) -> bool {
        (self.state_flags
            & (state_flags::STATE_UPDATE_RUNNING
                | state_flags::STATE_UPDATE_PAUSED
                | state_flags::STATE_UPDATE_STARTED))
            != 0
    }

    /// Human-readable list of active state flags.
    pub fn state_flag_descriptions(&self) -> Vec<&'static str> {
        let mut list = Vec::new();
        if (self.state_flags & state_flags::STATE_UNINSTALLED) != 0 {
            list.push("Uninstalled");
        }
        if (self.state_flags & state_flags::STATE_UPDATE_REQUIRED) != 0 {
            list.push("Update Required");
        }
        if (self.state_flags & state_flags::STATE_FULLY_INSTALLED) != 0 {
            list.push("Fully Installed");
        }
        if (self.state_flags & state_flags::STATE_ENCRYPTED) != 0 {
            list.push("Encrypted");
        }
        if (self.state_flags & state_flags::STATE_LOCKED) != 0 {
            list.push("Locked");
        }
        if (self.state_flags & state_flags::STATE_FILES_MISSING) != 0 {
            list.push("Files Missing");
        }
        if (self.state_flags & state_flags::STATE_APP_RUNNING) != 0 {
            list.push("App Running");
        }
        if (self.state_flags & state_flags::STATE_FILES_CORRUPT) != 0 {
            list.push("Files Corrupt");
        }
        if (self.state_flags & state_flags::STATE_UPDATE_RUNNING) != 0 {
            list.push("Update Running");
        }
        if (self.state_flags & state_flags::STATE_UPDATE_PAUSED) != 0 {
            list.push("Update Paused");
        }
        if (self.state_flags & state_flags::STATE_UPDATE_STARTED) != 0 {
            list.push("Update Started");
        }
        if (self.state_flags & state_flags::STATE_UNINSTALLING) != 0 {
            list.push("Uninstalling");
        }
        if (self.state_flags & state_flags::STATE_BACKUP_RUNNING) != 0 {
            list.push("Backup Running");
        }
        list
    }
}

// ---------------------------------------------------------------------------
// Steam Multi-Platform Discovery
// ---------------------------------------------------------------------------

/// Host platform categories for Steam installations.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum SteamPlatform {
    /// Native Linux installation (standard, Flatpak, or Snap).
    Linux,
    /// Native Windows installation (`Program Files (x86)\Steam`).
    Windows,
    /// WSL Windows Steam accessed via `/mnt/c/` or drive letter mount.
    Wsl,
    /// macOS (`~/Library/Application Support/Steam`).
    MacOS,
    /// Custom path provided by caller.
    Custom,
}

/// An identified Steam installation directory on the host system.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SteamInstallation {
    /// Host platform type.
    pub platform: SteamPlatform,
    /// Steam root installation directory.
    pub root_path: PathBuf,
    /// Canonical `steamapps` folder.
    pub steamapps_path: PathBuf,
    /// `libraryfolders.vdf` path, if present.
    pub libraryfolders_vdf: Option<PathBuf>,
}

/// Discover all accessible Steam installations across standard Linux, WSL, Windows, and macOS paths.
pub fn find_steam_installations() -> Vec<SteamInstallation> {
    let mut results = Vec::new();
    let home = std::env::var("HOME").ok().map(PathBuf::from);

    // 1. Environment variable overrides
    if let Ok(dir) = std::env::var("STEAM_DIR").or_else(|_| std::env::var("STEAM_HOME")) {
        let p = PathBuf::from(dir);
        if p.exists()
            && let Some(inst) = probe_steam_installation(p, SteamPlatform::Custom)
        {
            results.push(inst);
        }
    }

    // 2. Linux native candidate paths
    if let Some(ref h) = home {
        let linux_candidates = [
            h.join(".steam/steam"),
            h.join(".steam/root"),
            h.join(".local/share/Steam"),
            h.join(".var/app/com.valvesoftware.Steam/.steam/steam"),
            h.join(".var/app/com.valvesoftware.Steam/.local/share/Steam"),
            h.join("snap/steam/common/.local/share/Steam"),
        ];

        for cand in linux_candidates {
            if cand.exists()
                && let Some(inst) = probe_steam_installation(cand, SteamPlatform::Linux)
                && !results.iter().any(|r| r.root_path == inst.root_path)
            {
                results.push(inst);
            }
        }
    }

    // 3. WSL Windows mounts
    let wsl_candidates = [
        PathBuf::from("/mnt/c/Program Files (x86)/Steam"),
        PathBuf::from("/mnt/c/Program Files/Steam"),
        PathBuf::from("/mnt/d/Program Files (x86)/Steam"),
        PathBuf::from("/mnt/d/Steam"),
        PathBuf::from("/mnt/e/Steam"),
    ];

    for cand in wsl_candidates {
        if cand.exists()
            && let Some(inst) = probe_steam_installation(cand, SteamPlatform::Wsl)
            && !results.iter().any(|r| r.root_path == inst.root_path)
        {
            results.push(inst);
        }
    }

    // 4. Windows native paths (if running on Windows target)
    #[cfg(windows)]
    {
        if let Ok(pf86) = std::env::var("ProgramFiles(x86)") {
            let cand = PathBuf::from(pf86).join("Steam");
            if cand.exists()
                && let Some(inst) = probe_steam_installation(cand, SteamPlatform::Windows)
                && !results.iter().any(|r| r.root_path == inst.root_path)
            {
                results.push(inst);
            }
        }
        if let Ok(pf) = std::env::var("ProgramFiles") {
            let cand = PathBuf::from(pf).join("Steam");
            if cand.exists()
                && let Some(inst) = probe_steam_installation(cand, SteamPlatform::Windows)
                && !results.iter().any(|r| r.root_path == inst.root_path)
            {
                results.push(inst);
            }
        }
    }

    // 5. macOS candidates
    if let Some(ref h) = home {
        let mac_cand = h.join("Library/Application Support/Steam");
        if mac_cand.exists()
            && let Some(inst) = probe_steam_installation(mac_cand, SteamPlatform::MacOS)
            && !results.iter().any(|r| r.root_path == inst.root_path)
        {
            results.push(inst);
        }
    }

    results
}

/// Find the primary active Steam directory on the system, if any.
pub fn find_steam_dir() -> Option<PathBuf> {
    find_steam_installations()
        .into_iter()
        .next()
        .map(|i| i.root_path)
}

/// Inspect a directory candidate to see if it represents a valid Steam root installation.
pub fn probe_steam_installation(
    root: PathBuf,
    platform: SteamPlatform,
) -> Option<SteamInstallation> {
    let steamapps = root.join("steamapps");
    let lib_vdf_direct = steamapps.join("libraryfolders.vdf");
    let lib_vdf_config = root.join("config").join("libraryfolders.vdf");

    let libraryfolders_vdf = if lib_vdf_direct.exists() {
        Some(lib_vdf_direct)
    } else if lib_vdf_config.exists() {
        Some(lib_vdf_config)
    } else {
        None
    };

    // A valid root must either have a steamapps folder or libraryfolders.vdf
    if steamapps.exists() || libraryfolders_vdf.is_some() {
        Some(SteamInstallation {
            platform,
            root_path: root,
            steamapps_path: steamapps,
            libraryfolders_vdf,
        })
    } else {
        None
    }
}

// ---------------------------------------------------------------------------
// Steam Library Scanning
// ---------------------------------------------------------------------------

/// A Steam game library folder containing games.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SteamLibrary {
    /// Absolute path to the library root folder (e.g. `/home/user/.local/share/Steam` or `/mnt/d/SteamLibrary`).
    pub path: PathBuf,
    /// Canonical `steamapps` folder for this library.
    pub steamapps_path: PathBuf,
    /// User label (if configured in `libraryfolders.vdf`).
    pub label: String,
    /// Total storage size in bytes if recorded in VDF.
    pub total_size: Option<u64>,
    /// Installed application manifests found in this library.
    pub apps: Vec<AppManifest>,
}

/// An installed game discovered on disk across any Steam library.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct InstalledGame {
    /// AppManifest parsed from `appmanifest_<appid>.acf`.
    pub manifest: AppManifest,
    /// Library folder where this game is stored.
    pub library_path: PathBuf,
    /// Full path to the game installation directory (`<library>/steamapps/common/<installdir>`).
    pub install_path: PathBuf,
    /// Whether the game installation directory actually exists on disk.
    pub exists_on_disk: bool,
}

/// Scan `libraryfolders.vdf` in a Steam root directory and enumerate all libraries and manifests.
pub fn scan_steam_libraries(steam_root: &Path) -> Result<Vec<SteamLibrary>, SteamError> {
    let mut libraries = Vec::new();
    let steamapps = steam_root.join("steamapps");

    // Look for libraryfolders.vdf in steamapps or config
    let vdf_paths = [
        steamapps.join("libraryfolders.vdf"),
        steam_root.join("config").join("libraryfolders.vdf"),
    ];

    let mut found_vdf = None;
    for p in &vdf_paths {
        if p.exists() {
            found_vdf = Some(p.clone());
            break;
        }
    }

    if let Some(vdf_path) = found_vdf {
        let content = std::fs::read_to_string(&vdf_path)?;
        let parsed = parse_vdf(&content)?;
        let lib_folders = parsed
            .get("libraryfolders")
            .or_else(|| parsed.get("LibraryFolders"))
            .unwrap_or(&parsed);

        if let Some(entries) = lib_folders.entries() {
            for (_, folder_val) in entries {
                if let VdfValue::Table(_) = folder_val {
                    let path_str = folder_val
                        .get_str("path")
                        .or_else(|| folder_val.get_str("1"))
                        .unwrap_or_default();

                    if !path_str.is_empty() {
                        let lib_path = PathBuf::from(path_str);
                        let lib_apps = lib_path.join("steamapps");
                        let label = folder_val.get_str("label").unwrap_or_default().to_string();
                        let total_size = folder_val.get_u64("totalsize");

                        let manifests = scan_manifests_in_steamapps(&lib_apps);

                        libraries.push(SteamLibrary {
                            path: lib_path,
                            steamapps_path: lib_apps,
                            label,
                            total_size,
                            apps: manifests,
                        });
                    }
                }
            }
        }
    }

    // Always include the root steamapps folder if not already covered
    if libraries.is_empty() && steamapps.exists() {
        let manifests = scan_manifests_in_steamapps(&steamapps);
        libraries.push(SteamLibrary {
            path: steam_root.to_path_buf(),
            steamapps_path: steamapps,
            label: "Default".to_string(),
            total_size: None,
            apps: manifests,
        });
    }

    Ok(libraries)
}

/// Enumerate and parse all `appmanifest_*.acf` files in a given `steamapps` folder.
pub fn scan_manifests_in_steamapps(steamapps: &Path) -> Vec<AppManifest> {
    let mut manifests = Vec::new();
    let Ok(entries) = std::fs::read_dir(steamapps) else {
        return manifests;
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_file() {
            let file_name = path
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or_default();
            if file_name.starts_with("appmanifest_")
                && file_name.ends_with(".acf")
                && let Ok(content) = std::fs::read_to_string(&path)
                && let Ok(manifest) = AppManifest::parse(&content)
            {
                manifests.push(manifest);
            }
        }
    }

    manifests
}

/// Enumerate all installed games across all Steam libraries.
pub fn list_installed_games(steam_root: &Path) -> Result<Vec<InstalledGame>, SteamError> {
    let libraries = scan_steam_libraries(steam_root)?;
    let mut games = Vec::new();

    for lib in libraries {
        for app in lib.apps {
            let install_path = lib.steamapps_path.join("common").join(&app.install_dir);
            let exists_on_disk = install_path.exists();

            games.push(InstalledGame {
                manifest: app,
                library_path: lib.path.clone(),
                install_path,
                exists_on_disk,
            });
        }
    }

    Ok(games)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_vdf_parser_basic_and_nested() {
        let vdf_text = r#"
        "AppState"
        {
            "appid"        "730"
            "Universe"     "1"
            "name"         "Counter-Strike 2"
            "StateFlags"   "4"
            "installdir"   "Counter-Strike Global Offensive"
            "LastUpdated"  "1700000000"
            "SizeOnDisk"   "35000000000"
            "buildid"      "1234567"
            "UserConfig"
            {
                "language" "english"
                "beta"     "public"
            }
            "InstalledDepots"
            {
                "731"
                {
                    "manifest" "99999999"
                }
                "732"
                {
                    "manifest" "88888888"
                }
            }
        }
        "#;

        let parsed = parse_vdf(vdf_text).expect("vdf should parse");
        let app_state = parsed.get("AppState").expect("AppState section must exist");

        assert_eq!(app_state.get_str("name"), Some("Counter-Strike 2"));
        assert_eq!(app_state.get_u64("appid"), Some(730));
        assert_eq!(app_state.get_u64("StateFlags"), Some(4));
        assert_eq!(app_state.get_u64("buildid"), Some(1234567));

        assert_eq!(
            parsed.get_path(&["AppState", "UserConfig", "language"]),
            Some(&VdfValue::Str("english".to_string()))
        );

        let manifest = AppManifest::from_vdf(&parsed).expect("manifest from vdf");
        assert_eq!(manifest.app_id, 730);
        assert_eq!(manifest.name, "Counter-Strike 2");
        assert_eq!(manifest.install_dir, "Counter-Strike Global Offensive");
        assert!(manifest.is_installed());
        assert!(!manifest.is_update_required());
        assert_eq!(manifest.installed_depots.len(), 2);
        assert!(manifest.installed_depots.contains(&731));
        assert!(manifest.installed_depots.contains(&732));
        assert_eq!(
            manifest.user_config.get("language").map(|s| s.as_str()),
            Some("english")
        );
    }

    #[test]
    fn test_acf_state_flags_descriptions() {
        let acf_text = r#"
        "AppState"
        {
            "appid" "440"
            "name" "Team Fortress 2"
            "StateFlags" "6" // 4 (Fully Installed) + 2 (Update Required)
            "installdir" "Team Fortress 2"
        }
        "#;

        let manifest = AppManifest::parse(acf_text).expect("acf parse");
        assert_eq!(manifest.app_id, 440);
        assert!(manifest.is_installed());
        assert!(manifest.is_update_required());
        let descs = manifest.state_flag_descriptions();
        assert!(descs.contains(&"Fully Installed"));
        assert!(descs.contains(&"Update Required"));
    }

    #[test]
    fn test_steam_library_scanning_mock_filesystem() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let root = temp_dir.path().join("SteamRoot");
        let secondary = temp_dir.path().join("SteamLibrarySecondary");

        let root_steamapps = root.join("steamapps");
        let root_common = root_steamapps.join("common").join("CS2");
        std::fs::create_dir_all(&root_common).expect("create cs2 dir");

        let sec_steamapps = secondary.join("steamapps");
        let sec_common = sec_steamapps.join("common").join("Cyberpunk");
        std::fs::create_dir_all(&sec_common).expect("create cyberpunk dir");

        // Create libraryfolders.vdf in root_steamapps
        let lib_vdf_content = format!(
            r#"
            "libraryfolders"
            {{
                "0"
                {{
                    "path"      "{}"
                    "label"     "Main"
                    "totalsize" "500000000000"
                    "apps"
                    {{
                        "730"   "35000000000"
                    }}
                }}
                "1"
                {{
                    "path"      "{}"
                    "label"     "Secondary"
                    "totalsize" "1000000000000"
                    "apps"
                    {{
                        "1091500" "70000000000"
                    }}
                }}
            }}
            "#,
            root.to_string_lossy().replace('\\', "\\\\"),
            secondary.to_string_lossy().replace('\\', "\\\\")
        );
        std::fs::write(root_steamapps.join("libraryfolders.vdf"), lib_vdf_content)
            .expect("write libraryfolders.vdf");

        // Create appmanifest_730.acf in root_steamapps
        let acf_730 = r#"
        "AppState"
        {
            "appid" "730"
            "name" "Counter-Strike 2"
            "installdir" "CS2"
            "StateFlags" "4"
            "SizeOnDisk" "35000000000"
            "buildid" "999"
        }
        "#;
        std::fs::write(root_steamapps.join("appmanifest_730.acf"), acf_730).expect("write 730 acf");

        // Create appmanifest_1091500.acf in sec_steamapps
        let acf_cyberpunk = r#"
        "AppState"
        {
            "appid" "1091500"
            "name" "Cyberpunk 2077"
            "installdir" "Cyberpunk"
            "StateFlags" "4"
            "SizeOnDisk" "70000000000"
            "buildid" "888"
        }
        "#;
        std::fs::write(sec_steamapps.join("appmanifest_1091500.acf"), acf_cyberpunk)
            .expect("write 1091500 acf");

        // Scan libraries
        let libraries = scan_steam_libraries(&root).expect("scan steam libraries");
        assert_eq!(libraries.len(), 2);

        let games = list_installed_games(&root).expect("list installed games");
        assert_eq!(games.len(), 2);

        let cs2 = games
            .iter()
            .find(|g| g.manifest.app_id == 730)
            .expect("find cs2");
        assert_eq!(cs2.manifest.name, "Counter-Strike 2");
        assert!(cs2.exists_on_disk);
        assert_eq!(cs2.install_path, root_common);

        let cp = games
            .iter()
            .find(|g| g.manifest.app_id == 1091500)
            .expect("find cyberpunk");
        assert_eq!(cp.manifest.name, "Cyberpunk 2077");
        assert!(cp.exists_on_disk);
        assert_eq!(cp.install_path, sec_common);
    }

    #[test]
    fn test_steam_platform_probing() {
        let fake = PathBuf::from("/nonexistent/steam/path/xyz_123");
        assert!(probe_steam_installation(fake, SteamPlatform::Custom).is_none());

        let temp = tempfile::tempdir().expect("tempdir");
        let steamapps = temp.path().join("steamapps");
        std::fs::create_dir_all(&steamapps).expect("create steamapps");

        let probe = probe_steam_installation(temp.path().to_path_buf(), SteamPlatform::Linux);
        assert!(probe.is_some());
        let inst = probe.unwrap();
        assert_eq!(inst.platform, SteamPlatform::Linux);
        assert_eq!(inst.root_path, temp.path());
        assert_eq!(inst.steamapps_path, steamapps);
    }
}
