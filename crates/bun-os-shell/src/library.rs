//! The game library the shell shows: Steam (installed apps through `bun-steam`, plus owned apps
//! with cached art), the bep emulator library (`library.db`, written by packages/bun-engine) and
//! the browser (wasm) cores of `dist/web-emulation`.

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use rusqlite::{Connection, OpenFlags};

use crate::paths::Paths;

/// Systems the shell runs in-process on Bun Engine machines (instant resume).
pub const NATIVE_SYSTEMS: [&str; 4] = ["nes", "gba", "psx", "nds"];

#[derive(Clone, Debug, PartialEq)]
pub enum Kind {
    /// A Steam app; `installed` apps launch through `steam://rungameid`.
    Steam { app_id: u32, installed: bool },
    /// A bep library game run in-process on a Bun Engine machine.
    Native {
        id: i64,
        system: String,
        path: PathBuf,
    },
    /// A bep library game whose route is a release emulator or RetroArch (usr/).
    Route {
        id: i64,
        system: String,
        route: Option<String>,
    },
    /// A browser build of a Bun Engine core (wasm).
    Web { core: String, systems: Vec<String> },
}

#[derive(Clone, Debug)]
pub struct Game {
    /// Stable key shared with profiles and suspend states: `steam:<id>`, `bep:<id>`, `web:<core>`.
    pub key: String,
    pub title: String,
    /// Platform line (`Steam`, `Nintendo Entertainment System`, ...).
    pub platform: String,
    pub kind: Kind,
    pub hero: Option<PathBuf>,
    pub tile: Option<PathBuf>,
    pub last_played: Option<String>,
    pub play_count: i64,
    pub size: u64,
    pub developer: Option<String>,
    pub year: Option<String>,
}

impl Game {
    pub fn is_native(&self) -> bool {
        matches!(self.kind, Kind::Native { .. })
    }

    pub fn source(&self) -> Source {
        match self.kind {
            Kind::Steam { .. } => Source::Steam,
            Kind::Native { .. } | Kind::Route { .. } => Source::Emulators,
            Kind::Web { .. } => Source::Web,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Source {
    Steam,
    Emulators,
    Web,
}

/// One Steam content transfer (download or update) read from `appmanifest_*.acf`.
#[derive(Clone, Debug)]
pub struct Download {
    pub title: String,
    pub app_id: u32,
    pub done: u64,
    pub total: u64,
    pub state: String,
}

/// One bep release package (`local.db`).
#[derive(Clone, Debug)]
pub struct Package {
    pub id: String,
    pub version: String,
    pub installed_at: String,
}

#[derive(Clone, Debug, Default)]
pub struct Library {
    pub games: Vec<Game>,
    pub downloads: Vec<Download>,
    pub packages: Vec<Package>,
    pub steam_root: Option<PathBuf>,
}

pub fn system_label(system: &str) -> &'static str {
    match system {
        "nes" => "Nintendo Entertainment System",
        "gba" => "Game Boy Advance",
        "nds" => "Nintendo DS",
        "psx" => "PlayStation",
        "gc" => "GameCube",
        "wii" => "Wii",
        "3ds" => "Nintendo 3DS",
        "snes" => "Super Nintendo",
        "genesis" | "md" => "Mega Drive",
        "n64" => "Nintendo 64",
        "ps2" => "PlayStation 2",
        "psp" => "PlayStation Portable",
        _ => "Emulator",
    }
}

fn steam_names(steam: &Path) -> HashMap<u32, (String, String)> {
    let mut names = HashMap::new();
    let Ok(bytes) = std::fs::read(steam.join("appcache").join("appinfo.vdf")) else {
        return names;
    };
    let Ok(file) = bun_steam::vdf::parse_appinfo(&bytes) else {
        return names;
    };
    for app in file.apps {
        let Some(kv) = app.kv.as_ref() else { continue };
        let root = kv.get("appinfo").unwrap_or(kv);
        let Some(common) = root.get("common") else {
            continue;
        };
        let name = common
            .get("name")
            .and_then(|v| v.as_text())
            .unwrap_or_default();
        let kind = common
            .get("type")
            .and_then(|v| v.as_text())
            .unwrap_or_default();
        if !name.is_empty() {
            names.insert(app.app_id, (name, kind.to_ascii_lowercase()));
        }
    }
    names
}

fn steam_art(steam: &Path, app_id: u32) -> (Option<PathBuf>, Option<PathBuf>) {
    let dir = steam
        .join("appcache")
        .join("librarycache")
        .join(app_id.to_string());
    let pick = |names: &[&str]| names.iter().map(|n| dir.join(n)).find(|p| p.is_file());
    let mut any = None;
    if let Ok(entries) = std::fs::read_dir(&dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path
                .extension()
                .is_some_and(|e| e.eq_ignore_ascii_case("jpg"))
            {
                any = Some(path);
                break;
            }
        }
    }
    let hero =
        pick(&["library_hero.jpg", "library_hero.png", "header.jpg"]).or_else(|| any.clone());
    let tile = pick(&[
        "header.jpg",
        "header_english.jpg",
        "header_french.jpg",
        "library_600x900.jpg",
    ])
    .or(any);
    (hero, tile)
}

fn load_steam(library: &mut Library) {
    let Some(steam) = bun_steam::find_steam_dir() else {
        return;
    };
    let names = steam_names(&steam);
    let mut seen = std::collections::HashSet::new();
    if let Ok(installed) = bun_steam::list_installed_games(&steam) {
        for game in installed {
            let m = &game.manifest;
            let kind = names.get(&m.app_id).map_or("game", |(_, k)| k.as_str());
            if m.bytes_to_download > m.bytes_downloaded
                || m.is_update_required()
                || m.is_downloading()
            {
                library.downloads.push(Download {
                    title: m.name.clone(),
                    app_id: m.app_id,
                    done: m.bytes_downloaded,
                    total: m.bytes_to_download,
                    state: m.state_flag_descriptions().join(", "),
                });
            }
            if kind != "game" && !kind.is_empty() {
                continue;
            }
            seen.insert(m.app_id);
            let (hero, tile) = steam_art(&steam, m.app_id);
            library.games.push(Game {
                key: format!("steam:{}", m.app_id),
                title: m.name.clone(),
                platform: "Steam".into(),
                kind: Kind::Steam {
                    app_id: m.app_id,
                    installed: m.is_installed(),
                },
                hero,
                tile,
                last_played: None,
                play_count: 0,
                size: m.size_on_disk,
                developer: None,
                year: None,
            });
        }
    }
    // Owned apps with cached art (not installed here): shown so the library matches the client.
    let mut cached = Vec::new();
    if let Ok(entries) = std::fs::read_dir(steam.join("appcache").join("librarycache")) {
        for entry in entries.flatten() {
            let Some(app_id) = entry
                .file_name()
                .to_str()
                .and_then(|s| s.parse::<u32>().ok())
            else {
                continue;
            };
            if seen.contains(&app_id) {
                continue;
            }
            let Some((name, kind)) = names.get(&app_id) else {
                continue;
            };
            if kind != "game" {
                continue;
            }
            let (hero, tile) = steam_art(&steam, app_id);
            if tile.is_none() {
                continue;
            }
            cached.push(Game {
                key: format!("steam:{app_id}"),
                title: name.clone(),
                platform: "Steam · not installed".into(),
                kind: Kind::Steam {
                    app_id,
                    installed: false,
                },
                hero,
                tile,
                last_played: None,
                play_count: 0,
                size: 0,
                developer: None,
                year: None,
            });
        }
    }
    cached.sort_by(|a, b| a.title.cmp(&b.title));
    cached.truncate(48);
    library.games.extend(cached);
    library.steam_root = Some(steam);
}

fn load_bep(library: &mut Library, paths: &Paths) {
    let flags = OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX;
    if let Ok(db) = Connection::open_with_flags(paths.bep.join("library.db"), flags)
        && let Ok(mut statement) = db.prepare(
            "SELECT id, system, path, name, title, size, developer, year, route, playCount, lastPlayed \
             FROM games ORDER BY lastPlayed IS NULL, lastPlayed DESC, playCount DESC, COALESCE(title, name)",
        )
    {
        let rows = statement.query_map([], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, Option<String>>(4)?,
                row.get::<_, i64>(5)?,
                row.get::<_, Option<String>>(6)?,
                row.get::<_, Option<String>>(7)?,
                row.get::<_, Option<String>>(8)?,
                row.get::<_, i64>(9)?,
                row.get::<_, Option<String>>(10)?,
            ))
        });
        if let Ok(rows) = rows {
            for (id, system, path, name, title, size, developer, year, route, plays, last) in rows.flatten() {
                let native_route = route.as_deref().is_none_or(|r| r.starts_with("native:"));
                let kind = if NATIVE_SYSTEMS.contains(&system.as_str()) && native_route {
                    Kind::Native { id, system: system.clone(), path: PathBuf::from(&path) }
                } else {
                    Kind::Route { id, system: system.clone(), route }
                };
                let title = title
                    .map(|t| t.split(" (").next().unwrap_or(&t).to_string())
                    .unwrap_or_else(|| name.replace('_', " "));
                library.games.push(Game {
                    key: format!("bep:{id}"),
                    title,
                    platform: system_label(&system).into(),
                    kind,
                    hero: None,
                    tile: None,
                    last_played: last,
                    play_count: plays,
                    size: size.max(0) as u64,
                    developer,
                    year,
                });
            }
        }
    }
    if let Ok(db) = Connection::open_with_flags(paths.bep.join("local.db"), flags)
        && let Ok(mut statement) =
            db.prepare("SELECT id, version, installedAt FROM packages ORDER BY id")
        && let Ok(rows) = statement.query_map([], |row| {
            Ok(Package {
                id: row.get(0)?,
                version: row.get(1)?,
                installed_at: row.get(2)?,
            })
        })
    {
        library.packages.extend(rows.flatten());
    }
}

fn load_web(library: &mut Library, paths: &Paths) {
    let index = paths
        .repo
        .join("dist")
        .join("web-emulation")
        .join("index.json");
    let Ok(text) = std::fs::read_to_string(index) else {
        return;
    };
    let Ok(value) = serde_json::from_str::<serde_json::Value>(&text) else {
        return;
    };
    let cores = value
        .get("cores")
        .and_then(|c| c.as_array())
        .cloned()
        .or_else(|| value.as_array().cloned());
    for core in cores.unwrap_or_default() {
        let Some(id) = core.get("id").and_then(|v| v.as_str()) else {
            continue;
        };
        let name = core.get("name").and_then(|v| v.as_str()).unwrap_or(id);
        let systems = core
            .get("systems")
            .and_then(|v| v.as_array())
            .map(|a| {
                a.iter()
                    .filter_map(|s| s.as_str().map(String::from))
                    .collect()
            })
            .unwrap_or_default();
        library.games.push(Game {
            key: format!("web:{id}"),
            title: name.to_string(),
            platform: "Web core (wasm)".into(),
            kind: Kind::Web {
                core: id.to_string(),
                systems,
            },
            hero: None,
            tile: None,
            last_played: None,
            play_count: 0,
            size: 0,
            developer: None,
            year: None,
        });
    }
}

/// Free open-source PlayStation BIOS from the bep firmware store (512 KiB image).
pub fn psx_bios(paths: &Paths) -> Option<PathBuf> {
    let dir = paths
        .usr
        .join("share")
        .join("bun-engine")
        .join("firmware")
        .join("sony-playstation");
    std::fs::read_dir(dir)
        .ok()?
        .flatten()
        .map(|e| e.path())
        .find(|p| {
            p.extension().is_some_and(|e| e == "bin")
                && std::fs::metadata(p).is_ok_and(|m| m.len() == 512 * 1024)
        })
}

impl Library {
    pub fn load(paths: &Paths) -> Self {
        let mut library = Self::default();
        load_bep(&mut library, paths);
        load_steam(&mut library);
        load_web(&mut library, paths);
        // Played first (bep order already carries it), then installed Steam games, then the rest.
        library.games.sort_by_key(|g| match &g.kind {
            Kind::Native { .. } | Kind::Route { .. } if g.last_played.is_some() => 0,
            Kind::Steam {
                installed: true, ..
            } => 1,
            Kind::Native { .. } => 2,
            Kind::Web { .. } => 3,
            Kind::Route { .. } => 4,
            Kind::Steam {
                installed: false, ..
            } => 5,
        });
        library
    }

    pub fn find(&self, key: &str) -> Option<&Game> {
        self.games.iter().find(|g| g.key == key)
    }
}
