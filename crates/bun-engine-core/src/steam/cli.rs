//! `bun-engine steam <command>`.

use std::{
    path::{Path, PathBuf},
    process::Command,
    time::{Duration, Instant},
};

use super::{Presence, Steam, SteamOptions, cloud, input, stats};

pub const USAGE: &str = "usage: bun-engine steam status [--appid N]
       bun-engine steam presence <system> <game> [--appid N] [--hold SECS]
       bun-engine steam cloud quota|list|roundtrip [--bytes N] [--appid N]
       bun-engine steam cloud sync|push|pull <rom> [--system S] [--title T] [--dir DIR] [--appid N]
       bun-engine steam input-manifest [--out DIR] [--appid N]
       bun-engine steam input [--appid N] [--seconds S]
       bun-engine steam stats [--appid N]
       bun-engine steam install-shortcut|uninstall-shortcut [shortcut options] (runs packages/bun-engine/src/steam/shortcuts.ts)
       bun-engine run <system> <image> --steam [--steam-appid N] [--steam-title T] [--steam-no-cloud] [--steam-no-input]
                      [--steam-overlay DIALOG --steam-overlay-after S] [--steam-screenshot-after S] [--steam-quit-after S]";

struct Args {
    positional: Vec<String>,
    flags: Vec<(String, Option<String>)>,
}

impl Args {
    fn parse(args: impl Iterator<Item = String>) -> Self {
        let (mut positional, mut flags) = (Vec::new(), Vec::new());
        let mut it = args.peekable();
        while let Some(arg) = it.next() {
            if let Some(name) = arg.strip_prefix("--") {
                let value = it.next_if(|v| !v.starts_with("--"));
                flags.push((name.to_string(), value));
            } else {
                positional.push(arg);
            }
        }
        Self { positional, flags }
    }
    fn get(&self, name: &str) -> Option<&str> {
        self.flags.iter().find(|(n, _)| n == name).and_then(|(_, v)| v.as_deref())
    }
    fn number<T: std::str::FromStr>(&self, name: &str) -> Result<Option<T>, String> {
        self.get(name).map(|v| v.parse().map_err(|_| format!("--{name}: invalid number {v}"))).transpose()
    }
    fn steam(&self) -> Result<Steam, String> {
        let options = self.number::<u32>("appid")?.map_or_else(SteamOptions::default, SteamOptions::with_app_id);
        Steam::init(&options)
    }
}

fn print(value: &impl serde::Serialize) {
    println!("{}", serde_json::to_string_pretty(value).unwrap_or_default());
}

pub fn main(args: impl Iterator<Item = String>) -> Result<(), String> {
    let mut args = args.peekable();
    let command = args.next().unwrap_or_default();
    if matches!(command.as_str(), "install-shortcut" | "uninstall-shortcut" | "shortcuts") {
        return shortcuts(&command, args.collect());
    }
    let args = Args::parse(args);
    match command.as_str() {
        "status" => {
            let steam = args.steam()?;
            steam.pump();
            print(&steam.status());
        }
        "presence" => {
            let [system, game, ..] = args.positional.as_slice() else { return Err(USAGE.into()) };
            let steam = args.steam()?;
            let set = steam.set_presence(&Presence { system: system.clone(), game: game.clone(), state: None });
            let hold = Duration::from_secs_f64(args.number::<f64>("hold")?.unwrap_or(2.0));
            let until = Instant::now() + hold;
            while Instant::now() < until {
                steam.pump();
                std::thread::sleep(Duration::from_millis(50));
            }
            print(&serde_json::json!({
                "set": set,
                "system": steam.presence_value("system"),
                "game": steam.presence_value("game"),
                "status": steam.presence_value("status"),
            }));
        }
        "cloud" => cloud_command(&args)?,
        "input-manifest" => {
            let app_id = args.number::<u32>("appid")?.unwrap_or_else(|| SteamOptions::default().app_id);
            let dir = args.get("out").map_or_else(input::default_dir, PathBuf::from);
            let manifest = input::write_manifest(&dir, app_id)?;
            print(&serde_json::json!({ "manifest": manifest, "dir": dir }));
        }
        "input" => {
            let steam = args.steam()?;
            let mut steam_input = input::SteamInput::new(&steam.client, steam.app_id, &input::default_dir())?;
            let seconds = args.number::<f64>("seconds")?.unwrap_or(0.0);
            let until = Instant::now() + Duration::from_secs_f64(seconds);
            let mut keys = 0;
            loop {
                steam.pump();
                steam_input.poll(|_, _| {});
                if steam_input.keys() != keys {
                    keys = steam_input.keys();
                    eprintln!("steam input: keys {keys:#06x}");
                }
                if Instant::now() >= until {
                    break;
                }
                std::thread::sleep(Duration::from_millis(8));
            }
            print(&serde_json::json!({
                "manifest": steam_input.manifest,
                "manifestAccepted": steam_input.manifest_accepted,
                "actionSets": steam_input.set_handles().map(|h| h.to_string()),
                "resolvedActions": steam_input.resolved_actions(),
                "controllers": steam_input.controllers().len(),
            }));
        }
        "stats" => {
            let steam = args.steam()?;
            steam.pump();
            print(&stats::achievements(&steam.client));
        }
        _ => return Err(USAGE.into()),
    }
    Ok(())
}

fn cloud_command(args: &Args) -> Result<(), String> {
    let sub = args.positional.first().map(String::as_str).unwrap_or("quota");
    let steam = args.steam()?;
    steam.pump();
    match sub {
        "quota" => {
            let (total, available) = cloud::quota();
            let storage = steam.client.remote_storage();
            print(&serde_json::json!({
                "appId": steam.app_id,
                "account": storage.is_cloud_enabled_for_account(),
                "app": storage.is_cloud_enabled_for_app(),
                "total": total,
                "available": available,
            }));
        }
        "list" => print(&cloud::list()),
        "roundtrip" => {
            let bytes = args.number::<usize>("bytes")?.unwrap_or(256 * 1024);
            let (written, read) = cloud::roundtrip(bytes)?;
            print(&serde_json::json!({ "bytes": bytes, "written": written, "read": read, "match": written == read }));
            if written != read {
                return Err("Steam Cloud round trip hash mismatch".into());
            }
        }
        "sync" | "push" | "pull" => {
            let rom = args.positional.get(1).ok_or(USAGE)?;
            let rom_path = Path::new(rom);
            let hash = super::sha256_hex(&std::fs::read(rom_path).map_err(|e| format!("{rom}: {e}"))?);
            let title = args.get("title").map_or_else(
                || rom_path.file_stem().map_or_else(String::new, |s| s.to_string_lossy().into_owned()),
                str::to_string,
            );
            let system = args.get("system").unwrap_or("unknown");
            let dir = args.get("dir").map_or_else(|| cloud::save_dir(&hash), PathBuf::from);
            let direction = match sub {
                "push" => cloud::Direction::Push,
                "pull" => cloud::Direction::Pull,
                _ => cloud::Direction::Sync,
            };
            print(&cloud::sync(&hash, &title, system, &dir, direction)?);
        }
        _ => return Err(USAGE.into()),
    }
    Ok(())
}

/// The Bun half of the shortcut installer (binary `shortcuts.vdf` through `@aphrody/bun-steam`).
fn shortcuts_script() -> Option<PathBuf> {
    const RELATIVE: &str = "packages/bun-engine/src/steam/shortcuts.ts";
    if let Some(root) = std::env::var_os("BUN_OS_ROOT") {
        return Some(PathBuf::from(root).join(RELATIVE));
    }
    let starts = [std::env::current_dir().ok(), std::env::current_exe().ok()];
    starts.into_iter().flatten().find_map(|start| start.ancestors().map(|d| d.join(RELATIVE)).find(|p| p.is_file()))
}

fn shortcuts(command: &str, rest: Vec<String>) -> Result<(), String> {
    let script = shortcuts_script().ok_or("packages/bun-engine/src/steam/shortcuts.ts not found; set BUN_OS_ROOT")?;
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let sub = match command {
        "install-shortcut" => "install",
        "uninstall-shortcut" => "uninstall",
        _ => "list",
    };
    let status = Command::new(std::env::var_os("BUN").unwrap_or_else(|| "bun".into()))
        .arg(&script)
        .arg(sub)
        .arg("--engine")
        .arg(&exe)
        .args(rest)
        .status()
        .map_err(|e| format!("bun {}: {e}", script.display()))?;
    if status.success() { Ok(()) } else { Err(format!("shortcuts.ts exited with {status}")) }
}
