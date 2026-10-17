// SPDX-License-Identifier: Apache-2.0
//! Exhaustive structured registry of Dragon Ball games (Steam, Android, Console).
//!
//! Provides metadata, engines, asset formats, canonical status, save locations,
//! and discovery/detection methods across PC/Steam and Android filesystems.

use std::path::PathBuf;
use serde::{Deserialize, Serialize};

/// Target gaming platform.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Platform {
    Steam,
    Android,
    Windows,
    Ios,
    Console,
}

impl std::fmt::Display for Platform {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Steam => write!(f, "Steam (PC)"),
            Self::Android => write!(f, "Android"),
            Self::Windows => write!(f, "Windows PC"),
            Self::Ios => write!(f, "iOS"),
            Self::Console => write!(f, "Console"),
        }
    }
}

/// Underlying game engine and runtime technology.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum GameEngine {
    Carrot2,
    UnrealEngine4,
    UnrealEngine5,
    Unity,
    Cocos2dx,
    DimpsEngine,
    ArcSystemWorksCustom,
    Custom(String),
}

impl std::fmt::Display for GameEngine {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Carrot2 => write!(f, "Carrot2 (Dimps In-House)"),
            Self::UnrealEngine4 => write!(f, "Unreal Engine 4"),
            Self::UnrealEngine5 => write!(f, "Unreal Engine 5"),
            Self::Unity => write!(f, "Unity Engine"),
            Self::Cocos2dx => write!(f, "Cocos2d-x"),
            Self::DimpsEngine => write!(f, "Dimps Proprietary Engine"),
            Self::ArcSystemWorksCustom => write!(f, "Arc System Works RED Engine (UE4 Custom)"),
            Self::Custom(name) => write!(f, "{name}"),
        }
    }
}

/// Standard game save location descriptor.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SaveLocation {
    pub platform: Platform,
    pub os: String,
    pub path_pattern: String,
    pub description: String,
}

/// Exhaustive metadata entry for a Dragon Ball game release.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DragonBallGame {
    /// Unique internal identifier (e.g. `dbxv2`, `dbsz`, `dblegends`).
    pub id: String,
    /// Official canonical Western title.
    pub title: String,
    /// Japanese title in original kanji/katakana.
    pub title_ja: Option<String>,
    /// Platforms supported by this game.
    pub platforms: Vec<Platform>,
    /// Steam Application ID if released on Steam.
    pub steam_app_id: Option<u32>,
    /// Android Package IDs / Application IDs (including Global WW, JP, regional).
    pub android_package_ids: Vec<String>,
    /// Primary game development studio.
    pub developer: String,
    /// Global or regional publisher.
    pub publisher: String,
    /// Initial release year.
    pub release_year: Option<u16>,
    /// Core 3D/2D game engine.
    pub engine: GameEngine,
    /// Audio / video middleware (e.g. CRI Middleware CPK/ADX2/Sofdec2).
    pub audio_middleware: Option<String>,
    /// Primary file formats and asset extensions used in game data.
    pub primary_formats: Vec<String>,
    /// Canon classification status.
    pub canon_status: String,
    /// Standard save locations across platforms and operating systems.
    pub save_locations: Vec<SaveLocation>,
    /// Default install directory folder names (under Steam common, etc.).
    pub default_install_dirs: Vec<String>,
    /// Additional context, technical notes, or reverse engineering notes.
    pub notes: Option<String>,
}

/// Status of an installed or discovered Dragon Ball game on the host.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DetectedGame {
    pub game: DragonBallGame,
    pub platform: Platform,
    pub install_path: PathBuf,
    pub is_installed: bool,
    pub source_manifest: Option<PathBuf>,
}

/// Official Canon status tag for Dragon Ball video games.
pub const CANON_STATUS_DERIVED_GAME: &str = "Canon Dérivé / Jeu Vidéo";

/// Global static catalog of all major Dragon Ball games on PC/Steam and Android.
pub static DRAGON_BALL_GAMES: &[DragonBallGame] = &[
    // 1. Dragon Ball Xenoverse (Steam)
    DragonBallGame {
        id: String::new(), // Populated or matched
        title: String::new(),
        title_ja: None,
        platforms: Vec::new(),
        steam_app_id: None,
        android_package_ids: Vec::new(),
        developer: String::new(),
        publisher: String::new(),
        release_year: None,
        engine: GameEngine::Carrot2,
        audio_middleware: None,
        primary_formats: Vec::new(),
        canon_status: String::new(),
        save_locations: Vec::new(),
        default_install_dirs: Vec::new(),
        notes: None,
    },
];

// Helper constructor to generate static slice cleanly
#[allow(clippy::too_many_arguments)]
fn make_game(
    id: &str,
    title: &str,
    title_ja: Option<&str>,
    platforms: &[Platform],
    steam_app_id: Option<u32>,
    android_package_ids: &[&str],
    developer: &str,
    publisher: &str,
    release_year: Option<u16>,
    engine: GameEngine,
    audio_middleware: Option<&str>,
    primary_formats: &[&str],
    canon_status: &str,
    save_locations: &[SaveLocation],
    default_install_dirs: &[&str],
    notes: Option<&str>,
) -> DragonBallGame {
    DragonBallGame {
        id: id.to_owned(),
        title: title.to_owned(),
        title_ja: title_ja.map(str::to_owned),
        platforms: platforms.to_vec(),
        steam_app_id,
        android_package_ids: android_package_ids.iter().map(|&s| s.to_owned()).collect(),
        developer: developer.to_owned(),
        publisher: publisher.to_owned(),
        release_year,
        engine,
        audio_middleware: audio_middleware.map(str::to_owned),
        primary_formats: primary_formats.iter().map(|&s| s.to_owned()).collect(),
        canon_status: canon_status.to_owned(),
        save_locations: save_locations.to_vec(),
        default_install_dirs: default_install_dirs.iter().map(|&s| s.to_owned()).collect(),
        notes: notes.map(str::to_owned),
    }
}

/// Returns the comprehensive structured registry of Dragon Ball games.
pub fn get_dragon_ball_catalog() -> Vec<DragonBallGame> {
    vec![
        // ==========================================
        // STEAM (PC) TITLES
        // ==========================================
        make_game(
            "dbxv",
            "Dragon Ball Xenoverse",
            Some("ドラゴンボール ゼノバース"),
            &[Platform::Steam, Platform::Windows, Platform::Console],
            Some(323470),
            &[],
            "Dimps",
            "Bandai Namco Entertainment",
            Some(2015),
            GameEngine::Carrot2,
            Some("CRIWARE CRI ADX2 / Sofdec2"),
            &[".cpk", ".cus", ".msg", ".pup", ".cms", ".bac", ".emb", ".emm", ".emo", ".emz"],
            CANON_STATUS_DERIVED_GAME,
            &[
                SaveLocation {
                    platform: Platform::Steam,
                    os: "windows".into(),
                    path_pattern: "<steam>/userdata/<account_id>/323470/remote".into(),
                    description: "Steam Cloud save data (DBXV.sav)".into(),
                },
                SaveLocation {
                    platform: Platform::Steam,
                    os: "linux".into(),
                    path_pattern: "<steam>/steamapps/compatdata/323470/pfx/drive_c/users/steamuser/AppData/Roaming/DBXV".into(),
                    description: "Proton prefix save directory".into(),
                },
            ],
            &["DB Xenoverse", "Dragon Ball Xenoverse"],
            Some("First entry in the Xenoverse franchise introducing Tokitoki City, the Time Patrol, and Mira & Towa."),
        ),
        make_game(
            "dbxv2",
            "Dragon Ball Xenoverse 2",
            Some("ドラゴンボール ゼノバース2"),
            &[Platform::Steam, Platform::Windows, Platform::Console],
            Some(454650),
            &[],
            "Dimps",
            "Bandai Namco Entertainment",
            Some(2016),
            GameEngine::Carrot2,
            Some("CRIWARE CRI ADX2 / Sofdec2"),
            &[
                ".cpk", ".cus", ".msg", ".pup", ".cms", ".bac", ".bcs", ".bpe", ".emb", ".emm",
                ".emo", ".nsk", ".scd", ".eep", ".aur",
            ],
            CANON_STATUS_DERIVED_GAME,
            &[
                SaveLocation {
                    platform: Platform::Steam,
                    os: "windows".into(),
                    path_pattern: "<steam>/userdata/<account_id>/454650/remote/DBXV21".into(),
                    description: "Steam Cloud main save file (DBXV21 / DBXV20)".into(),
                },
                SaveLocation {
                    platform: Platform::Steam,
                    os: "linux".into(),
                    path_pattern: "<steam>/steamapps/compatdata/454650/pfx/drive_c/users/steamuser/AppData/Roaming/DBXV2".into(),
                    description: "Proton WINE prefix configuration and secondary save path".into(),
                },
            ],
            &["DB Xenoverse 2", "Dragon Ball Xenoverse 2"],
            Some("Conton City, Time Patrol saga, 708 standard skill entries (custom_skill.cus) and deep CRI CPK archive modularity."),
        ),
        make_game(
            "dbfz",
            "DRAGON BALL FighterZ",
            Some("ドラゴンボール ファイターズ"),
            &[Platform::Steam, Platform::Windows, Platform::Console],
            Some(678950),
            &[],
            "Arc System Works",
            "Bandai Namco Entertainment",
            Some(2018),
            GameEngine::ArcSystemWorksCustom,
            Some("CRIWARE CRI ADX2"),
            &[".pak", ".sig", ".uexp", ".uasset", ".acb", ".awb"],
            CANON_STATUS_DERIVED_GAME,
            &[
                SaveLocation {
                    platform: Platform::Steam,
                    os: "windows".into(),
                    path_pattern: "%LOCALAPPDATA%/RED/Saved/SaveGames".into(),
                    description: "Unreal Engine RED save data directory".into(),
                },
                SaveLocation {
                    platform: Platform::Steam,
                    os: "linux".into(),
                    path_pattern: "<steam>/steamapps/compatdata/678950/pfx/drive_c/users/steamuser/AppData/Local/RED/Saved/SaveGames".into(),
                    description: "Proton prefix UE4 RED save path".into(),
                },
            ],
            &["DRAGON BALL FighterZ", "DBFighterZ"],
            Some("Competitive 2.5D fighting game. Introduced Android 21, designed by Akira Toriyama. Custom cell-shaded UE4 rendering pipeline."),
        ),
        make_game(
            "dbzk",
            "DRAGON BALL Z: KAKAROT",
            Some("ドラゴンボールZ カカロット"),
            &[Platform::Steam, Platform::Windows, Platform::Console],
            Some(851850),
            &[],
            "CyberConnect2",
            "Bandai Namco Entertainment",
            Some(2020),
            GameEngine::UnrealEngine4,
            Some("CRIWARE CRI ADX2"),
            &[".pak", ".sig", ".uexp", ".uasset", ".acb", ".awb"],
            CANON_STATUS_DERIVED_GAME,
            &[
                SaveLocation {
                    platform: Platform::Steam,
                    os: "windows".into(),
                    path_pattern: "%LOCALAPPDATA%/AT/Saved/SaveGames".into(),
                    description: "CyberConnect2 AT Project save game slot directory".into(),
                },
                SaveLocation {
                    platform: Platform::Steam,
                    os: "linux".into(),
                    path_pattern: "<steam>/steamapps/compatdata/851850/pfx/drive_c/users/steamuser/AppData/Local/AT/Saved/SaveGames".into(),
                    description: "Proton prefix CC2 save path".into(),
                },
            ],
            &["DRAGON BALL Z KAKAROT", "DBZ Kakarot"],
            Some("Action-RPG retelling the Dragon Ball Z timeline. Features Bonyu and canonical background lore supervisions."),
        ),
        make_game(
            "dbsz",
            "DRAGON BALL: Sparking! ZERO",
            Some("ドラゴンボール Sparking! ZERO"),
            &[Platform::Steam, Platform::Windows, Platform::Console],
            Some(1790600),
            &[],
            "Spike Chunsoft",
            "Bandai Namco Entertainment",
            Some(2024),
            GameEngine::UnrealEngine5,
            Some("CRIWARE CRI ADX2"),
            &[".pak", ".utoc", ".ucas", ".sig", ".uasset", ".uexp", ".acb", ".awb"],
            CANON_STATUS_DERIVED_GAME,
            &[
                SaveLocation {
                    platform: Platform::Steam,
                    os: "windows".into(),
                    path_pattern: "%LOCALAPPDATA%/SparkingZERO/Saved/SaveGames".into(),
                    description: "Unreal Engine 5 SparkingZERO save data".into(),
                },
                SaveLocation {
                    platform: Platform::Steam,
                    os: "linux".into(),
                    path_pattern: "<steam>/steamapps/compatdata/1790600/pfx/drive_c/users/steamuser/AppData/Local/SparkingZERO/Saved/SaveGames".into(),
                    description: "Proton prefix SparkingZERO save directory".into(),
                },
            ],
            &["DRAGON BALL Sparking! ZERO", "SparkingZERO"],
            Some("Budokai Tenkaichi revival in Unreal Engine 5 with IoStore Zen packaging (.utoc / .ucas container archives)."),
        ),
        make_game(
            "dbtb",
            "DRAGON BALL: THE BREAKERS",
            Some("ドラゴンボール ザ ブレイカーズ"),
            &[Platform::Steam, Platform::Windows, Platform::Console],
            Some(1276760),
            &[],
            "Dimps",
            "Bandai Namco Entertainment",
            Some(2022),
            GameEngine::Carrot2,
            Some("CRIWARE CRI ADX2"),
            &[".cpk", ".cus", ".msg", ".bac", ".bcs", ".emb", ".emm"],
            CANON_STATUS_DERIVED_GAME,
            &[
                SaveLocation {
                    platform: Platform::Steam,
                    os: "windows".into(),
                    path_pattern: "<steam>/userdata/<account_id>/1276760/remote".into(),
                    description: "Steam Cloud remote sync for The Breakers".into(),
                },
                SaveLocation {
                    platform: Platform::Steam,
                    os: "linux".into(),
                    path_pattern: "<steam>/steamapps/compatdata/1276760/pfx/drive_c/users/steamuser/AppData/Roaming/DBTB".into(),
                    description: "Proton prefix DBTB save directory".into(),
                },
            ],
            &["DRAGON BALL THE BREAKERS", "DBTHEBREAKERS"],
            Some("Asymmetrical 7v1 survival action sharing engine ancestry and CPK structure with Dragon Ball Xenoverse 2."),
        ),
        make_game(
            "sdbh_wm",
            "Super Dragon Ball Heroes: World Mission",
            Some("スーパードラゴンボールヒーローズ ワールドミッション"),
            &[Platform::Steam, Platform::Windows, Platform::Console],
            Some(798400),
            &[],
            "Dimps / Bandai Namco Entertainment",
            "Bandai Namco Entertainment",
            Some(2019),
            GameEngine::Unity,
            Some("CRIWARE CRI ADX2"),
            &[".assets", ".sharedAssets", ".bundle", ".cpk", ".acb"],
            CANON_STATUS_DERIVED_GAME,
            &[
                SaveLocation {
                    platform: Platform::Steam,
                    os: "windows".into(),
                    path_pattern: "<steam>/userdata/<account_id>/798400/remote".into(),
                    description: "Steam Cloud card inventory and deck saves".into(),
                },
                SaveLocation {
                    platform: Platform::Steam,
                    os: "linux".into(),
                    path_pattern: "<steam>/steamapps/compatdata/798400/pfx/drive_c/users/steamuser/AppData/LocalLow/BANDAI NAMCO Entertainment Inc/Super Dragon Ball Heroes World Mission".into(),
                    description: "Proton Unity persistent data directory".into(),
                },
            ],
            &["Super Dragon Ball Heroes World Mission", "SDBH World Mission"],
            Some("PC port of the arcade card battle phenomenon. Features over 1160 cards, Unity AssetBundles, and CRIWARE audio."),
        ),
        make_game(
            "dbpm",
            "DRAGON BALL PROJECT: Multi",
            Some("ドラゴンボール プロジェクト マルチ"),
            &[Platform::Steam, Platform::Android, Platform::Ios],
            Some(2854740),
            &["com.bandainamcoent.dbpm", "com.bandainamcoent.dbpm_ww"],
            "Ganbarion",
            "Bandai Namco Entertainment",
            Some(2024),
            GameEngine::UnrealEngine4,
            Some("CRIWARE CRI ADX2"),
            &[".pak", ".bundle", ".assets"],
            CANON_STATUS_DERIVED_GAME,
            &[
                SaveLocation {
                    platform: Platform::Steam,
                    os: "windows".into(),
                    path_pattern: "%LOCALAPPDATA%/DBPM/Saved/SaveGames".into(),
                    description: "PC beta client preferences and account cache".into(),
                },
                SaveLocation {
                    platform: Platform::Android,
                    os: "android".into(),
                    path_pattern: "/data/data/com.bandainamcoent.dbpm_ww/files".into(),
                    description: "Android internal data directory".into(),
                },
            ],
            &["DRAGON BALL PROJECT Multi Playtest", "DBPM"],
            Some("First 4v4 team-oriented MOBA title in the franchise, cross-platform PC and Mobile."),
        ),

        // ==========================================
        // ANDROID MOBILE TITLES
        // ==========================================
        make_game(
            "dblegends",
            "Dragon Ball Legends",
            Some("ドラゴンボール レジェンズ"),
            &[Platform::Android, Platform::Ios],
            None,
            &["com.bandainamcoent.dblegends_ww", "com.bandainamcoent.dblegends_jp"],
            "Dimps",
            "Bandai Namco Entertainment",
            Some(2018),
            GameEngine::Unity,
            Some("CRIWARE CRI ADX2"),
            &[".assets", ".bundle", ".unity3d", ".cpk", ".acb", ".awb", ".apk", ".obb"],
            CANON_STATUS_DERIVED_GAME,
            &[
                SaveLocation {
                    platform: Platform::Android,
                    os: "android".into(),
                    path_pattern: "/data/data/com.bandainamcoent.dblegends_ww/shared_prefs".into(),
                    description: "Account tokens, device auth, and graphics preferences".into(),
                },
                SaveLocation {
                    platform: Platform::Android,
                    os: "android".into(),
                    path_pattern: "/data/data/com.bandainamcoent.dblegends_ww/files".into(),
                    description: "Asset cache, cached Unity AssetBundles and CRI audio".into(),
                },
                SaveLocation {
                    platform: Platform::Android,
                    os: "android".into(),
                    path_pattern: "/sdcard/Android/data/com.bandainamcoent.dblegends_ww/files".into(),
                    description: "External downloaded game assets".into(),
                },
            ],
            &["com.bandainamcoent.dblegends_ww", "com.bandainamcoent.dblegends_jp"],
            Some("Mobile card-action game. Features original protagonist Shallot, Zahha, and Giblet with character designs by Akira Toriyama."),
        ),
        make_game(
            "dbzdokkan",
            "Dragon Ball Z Dokkan Battle",
            Some("ドラゴンボールZ ドッカンバトル"),
            &[Platform::Android, Platform::Ios],
            None,
            &["com.bandainamcoent.dbszdokkanww", "com.bandainamcoent.dbzdokkan"],
            "Akatsuki Inc.",
            "Bandai Namco Entertainment",
            Some(2015),
            GameEngine::Cocos2dx,
            Some("CRIWARE CRI ADX2"),
            &[".png", ".cpk", ".acb", ".awb", ".plist", ".lua", ".db", ".sqlite", ".apk"],
            CANON_STATUS_DERIVED_GAME,
            &[
                SaveLocation {
                    platform: Platform::Android,
                    os: "android".into(),
                    path_pattern: "/data/data/com.bandainamcoent.dbszdokkanww/databases".into(),
                    description: "SQLite user databases and card metadata cache".into(),
                },
                SaveLocation {
                    platform: Platform::Android,
                    os: "android".into(),
                    path_pattern: "/data/data/com.bandainamcoent.dbszdokkanww/shared_prefs".into(),
                    description: "Shared preferences, device identifier, and user credentials".into(),
                },
                SaveLocation {
                    platform: Platform::Android,
                    os: "android".into(),
                    path_pattern: "/sdcard/Android/data/com.bandainamcoent.dbszdokkanww/files".into(),
                    description: "Downloaded encrypted CPK sprites and character animations".into(),
                },
            ],
            &["com.bandainamcoent.dbszdokkanww", "com.bandainamcoent.dbzdokkan"],
            Some("Pioneering DB mobile puzzle/board battle game. Millions of global players, encrypted CRIWARE asset streams and SQLite state."),
        ),
        make_game(
            "sdbh_companion",
            "Super Dragon Ball Heroes Companion",
            Some("スーパードラゴンボールヒーローズ 公式アプリ"),
            &[Platform::Android, Platform::Ios],
            None,
            &["com.bandainamcoent.sdbh", "jp.co.bandai.sdbh", "com.bandainamcoent.sdbhworldmission"],
            "Dimps / Bandai Namco Entertainment",
            "Bandai Namco Entertainment",
            Some(2016),
            GameEngine::Unity,
            Some("CRIWARE CRI ADX2"),
            &[".assets", ".bundle", ".unity3d", ".apk"],
            CANON_STATUS_DERIVED_GAME,
            &[
                SaveLocation {
                    platform: Platform::Android,
                    os: "android".into(),
                    path_pattern: "/data/data/jp.co.bandai.sdbh/files".into(),
                    description: "Arcade card sync state, hero avatar profiles, and event logs".into(),
                },
            ],
            &["com.bandainamcoent.sdbh", "jp.co.bandai.sdbh"],
            Some("Official companion and terminal sync application for Data Carddass arcade machines across Japan."),
        ),
        make_game(
            "dbtapbattle",
            "Dragon Ball Tap Battle",
            Some("ドラゴンボール タップバトル"),
            &[Platform::Android],
            None,
            &["com.namcobandaigames.dragonballtap_ww", "com.namcobandaigames.dragonballtap"],
            "Bandai Namco Games",
            "Bandai Namco Games",
            Some(2013),
            GameEngine::Cocos2dx,
            None,
            &[".apk", ".obb", ".png", ".ogg"],
            CANON_STATUS_DERIVED_GAME,
            &[
                SaveLocation {
                    platform: Platform::Android,
                    os: "android".into(),
                    path_pattern: "/data/data/com.namcobandaigames.dragonballtap/files".into(),
                    description: "Local profile and unlocked fighters".into(),
                },
            ],
            &["com.namcobandaigames.dragonballtap_ww", "com.namcobandaigames.dragonballtap"],
            Some("Early 1v1 touch-based fighting game on Android with Bluetooth local multiplayer."),
        ),
    ]
}

/// Find a Dragon Ball game in the catalog by its internal id.
pub fn find_game_by_id(id: &str) -> Option<DragonBallGame> {
    get_dragon_ball_catalog().into_iter().find(|g| g.id.eq_ignore_ascii_case(id))
}

/// Find a Dragon Ball game in the catalog by its Steam App ID.
pub fn find_game_by_steam_app_id(app_id: u32) -> Option<DragonBallGame> {
    get_dragon_ball_catalog().into_iter().find(|g| g.steam_app_id == Some(app_id))
}

/// Find a Dragon Ball game in the catalog by an Android package / application ID.
pub fn find_game_by_android_package(package_id: &str) -> Option<DragonBallGame> {
    get_dragon_ball_catalog().into_iter().find(|g| {
        g.android_package_ids.iter().any(|pkg| pkg.eq_ignore_ascii_case(package_id))
    })
}

/// Filter games by platform (Steam, Android, etc.).
pub fn filter_by_platform(platform: Platform) -> Vec<DragonBallGame> {
    get_dragon_ball_catalog()
        .into_iter()
        .filter(|g| g.platforms.contains(&platform))
        .collect()
}

/// Filter games by engine (Carrot2, Unreal Engine 4/5, Unity, Cocos2dx...).
pub fn filter_by_engine(engine: &GameEngine) -> Vec<DragonBallGame> {
    get_dragon_ball_catalog()
        .into_iter()
        .filter(|g| &g.engine == engine)
        .collect()
}

/// Search games matching a freeform query against id, title, developer, or package ids.
pub fn search_catalog(query: &str) -> Vec<DragonBallGame> {
    let q = query.trim().to_ascii_lowercase();
    if q.is_empty() {
        return get_dragon_ball_catalog();
    }

    get_dragon_ball_catalog()
        .into_iter()
        .filter(|g| {
            g.id.to_ascii_lowercase().contains(&q)
                || g.title.to_ascii_lowercase().contains(&q)
                || g.title_ja.as_deref().unwrap_or("").contains(&q)
                || g.developer.to_ascii_lowercase().contains(&q)
                || g.publisher.to_ascii_lowercase().contains(&q)
                || g.android_package_ids.iter().any(|p| p.to_ascii_lowercase().contains(&q))
                || g.steam_app_id.map(|id| id.to_string().contains(&q)).unwrap_or(false)
        })
        .collect()
}

/// Scans provided Steam library folders for installed Dragon Ball titles in the catalog.
///
/// Reads metadata from `steamapps/appmanifest_*.acf` without touching private user accounts or tokens.
pub fn scan_installed_steam_games(libraries: &[PathBuf]) -> std::io::Result<Vec<DetectedGame>> {
    #[cfg(target_arch = "wasm32")]
    {
        let _ = libraries;
        Ok(Vec::new())
    }

    #[cfg(not(target_arch = "wasm32"))]
    {
        let mut detected = Vec::new();
        let catalog = get_dragon_ball_catalog();

        for library in libraries {
            let steamapps = library.join("steamapps");
            let entries = match std::fs::read_dir(&steamapps) {
                Ok(entries) => entries,
                Err(err) if err.kind() == std::io::ErrorKind::NotFound => continue,
                Err(err) => return Err(err),
            };

            for entry in entries {
                let entry = entry?;
                let file_name = entry.file_name();
                let file_str = file_name.to_string_lossy();
                if !file_str.starts_with("appmanifest_") || !file_str.ends_with(".acf") {
                    continue;
                }

                let manifest_path = entry.path();
                let content = match std::fs::read_to_string(&manifest_path) {
                    Ok(c) => c,
                    Err(_) => continue,
                };

                let Ok(manifest) = bun_steam::AppManifest::parse(&content) else { continue };
                let app_id = manifest.app_id;
                let name = manifest.name;
                let install_dir = manifest.install_dir;

                // Match by Steam AppID first, then by title
                let matched_game = catalog.iter().find(|g| g.steam_app_id == Some(app_id)).cloned().or_else(|| {
                    if name.to_ascii_lowercase().contains("dragon ball") {
                        Some(make_game(
                            &format!("steam_{app_id}"),
                            &name,
                            None,
                            &[Platform::Steam, Platform::Windows],
                            Some(app_id),
                            &[],
                            "Bandai Namco",
                            "Bandai Namco Entertainment",
                            None,
                            GameEngine::Custom("Unknown".into()),
                            None,
                            &[],
                            CANON_STATUS_DERIVED_GAME,
                            &[],
                            &[&install_dir],
                            Some("Discovered via Steam app manifest scan"),
                        ))
                    } else {
                        None
                    }
                });

                if let Some(game) = matched_game {
                    let install_path = steamapps.join("common").join(&install_dir);
                    let is_installed = install_path.exists();
                    detected.push(DetectedGame {
                        game,
                        platform: Platform::Steam,
                        install_path,
                        is_installed,
                        source_manifest: Some(manifest_path),
                    });
                }
            }
        }

        detected.sort_by_key(|d| d.game.steam_app_id.unwrap_or(0));
        Ok(detected)
    }
}

/// Scans given directory roots (e.g. `/data/data`, `/sdcard/Android/data`, or backup folders)
/// for installed Dragon Ball Android package trees.
pub fn scan_installed_android_packages(roots: &[PathBuf]) -> std::io::Result<Vec<DetectedGame>> {
    #[cfg(target_arch = "wasm32")]
    {
        let _ = roots;
        Ok(Vec::new())
    }

    #[cfg(not(target_arch = "wasm32"))]
    {
        let mut detected = Vec::new();
        let catalog = get_dragon_ball_catalog();

        for root in roots {
            let entries = match std::fs::read_dir(root) {
                Ok(entries) => entries,
                Err(err) if err.kind() == std::io::ErrorKind::NotFound => continue,
                Err(err) => return Err(err),
            };

            for entry in entries {
                let entry = entry?;
                let file_name = entry.file_name();
                let dir_str = file_name.to_string_lossy();

                for game in &catalog {
                    if game.android_package_ids.iter().any(|pkg| pkg.eq_ignore_ascii_case(&dir_str)) {
                        let path = entry.path();
                        let is_installed = path.is_dir();
                        detected.push(DetectedGame {
                            game: game.clone(),
                            platform: Platform::Android,
                            install_path: path,
                            is_installed,
                            source_manifest: None,
                        });
                        break;
                    }
                }
            }
        }

        Ok(detected)
    }
}

/// Scans all sources (Steam libraries and Android paths) for installed Dragon Ball titles.
pub fn scan_all_installed_games(
    steam_libraries: &[PathBuf],
    android_roots: &[PathBuf],
) -> std::io::Result<Vec<DetectedGame>> {
    let mut all = scan_installed_steam_games(steam_libraries)?;
    let mut android = scan_installed_android_packages(android_roots)?;
    all.append(&mut android);
    Ok(all)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_catalog_entries_count_and_completeness() {
        let catalog = get_dragon_ball_catalog();
        assert!(catalog.len() >= 10, "Expected at least 10 Dragon Ball games in registry");

        // Verify key Steam games
        assert!(find_game_by_steam_app_id(323470).is_some(), "DBXV must exist");
        assert!(find_game_by_steam_app_id(454650).is_some(), "DBXV2 must exist");
        assert!(find_game_by_steam_app_id(678950).is_some(), "DBFZ must exist");
        assert!(find_game_by_steam_app_id(851850).is_some(), "DBZK must exist");
        assert!(find_game_by_steam_app_id(1790600).is_some(), "Sparking! ZERO must exist");
        assert!(find_game_by_steam_app_id(1276760).is_some(), "The Breakers must exist");

        // Verify key Android games
        let legends = find_game_by_android_package("com.bandainamcoent.dblegends_ww");
        assert!(legends.is_some(), "DB Legends must exist");
        assert_eq!(legends.unwrap().engine, GameEngine::Unity);

        let dokkan = find_game_by_android_package("com.bandainamcoent.dbszdokkanww");
        assert!(dokkan.is_some(), "Dokkan Battle must exist");
        assert_eq!(dokkan.unwrap().canon_status, CANON_STATUS_DERIVED_GAME);
    }

    #[test]
    fn test_filter_by_platform_and_engine() {
        let steam_games = filter_by_platform(Platform::Steam);
        assert!(steam_games.len() >= 7);

        let android_games = filter_by_platform(Platform::Android);
        assert!(android_games.len() >= 4);

        let ue4_games = filter_by_engine(&GameEngine::UnrealEngine4);
        assert!(!ue4_games.is_empty());

        let carrot_games = filter_by_engine(&GameEngine::Carrot2);
        assert!(carrot_games.iter().any(|g| g.id == "dbxv2"));
    }

    #[test]
    fn test_search_catalog() {
        let query_kakarot = search_catalog("kakarot");
        assert_eq!(query_kakarot.len(), 1);
        assert_eq!(query_kakarot[0].id, "dbzk");

        let query_dimps = search_catalog("Dimps");
        assert!(query_dimps.len() >= 4);

        let query_app_id = search_catalog("1790600");
        assert_eq!(query_app_id.len(), 1);
        assert_eq!(query_app_id[0].id, "dbsz");
    }
}
