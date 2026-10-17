// SPDX-License-Identifier: Apache-2.0
//! Steam tools over the canonical Bun OS Steam owner (`bun_steam`): live library and app manifest
//! discovery, URI launch and credential state reported as booleans only. The legacy WinClean
//! `steam-scan.db` path is gone; nothing here reads or returns a password, token or `ConnectCache`
//! value.

use std::path::{Path, PathBuf};

use crate::SubsystemError;
use crate::{dispatch::failed, system};
use bun_steam::install::{InstalledGame, find_steam_dir, list_installed_games, scan_steam_libraries};
use serde_json::{Value, json};

pub(crate) fn open_steam_uri(uri: &str) -> Result<Value, SubsystemError> {
    if !bun_steam::launch::is_safe_steam_uri(uri) {
        return Ok(json!({"success":false,"error":"invalid scheme"}));
    }
    #[cfg(windows)]
    {
        crate::system::shell_open(uri).map_err(failed)?;
        Ok(json!({"success":true,"uri":uri}))
    }
    #[cfg(not(windows))]
    {
        Err(SubsystemError::Failed("Steam URI launch through ShellExecute is Windows-only".into()))
    }
}

/// `steam://rungameid/<appId>` for the `appId` argument.
pub(crate) fn rungameid(arguments: &Value, tool: &str) -> Result<String, SubsystemError> {
    let app_id = arguments
        .get("appId")
        .and_then(Value::as_u64)
        .and_then(|id| u32::try_from(id).ok())
        .ok_or_else(|| SubsystemError::InvalidArguments(format!("{tool} requires appId")))?;
    Ok(bun_steam::launch::rungameid_uri(app_id))
}

/// Steam client root: the `steamRoot` argument, then registry/standard locations.
fn steam_root(arguments: &Value) -> Result<PathBuf, SubsystemError> {
    arguments
        .get("steamRoot")
        .and_then(Value::as_str)
        .filter(|v| !v.trim().is_empty())
        .map(PathBuf::from)
        .or_else(find_steam_dir)
        .ok_or_else(|| SubsystemError::Failed("Steam installation not found".into()))
}

fn games(arguments: &Value) -> Result<(PathBuf, Vec<InstalledGame>), SubsystemError> {
    let root = steam_root(arguments)?;
    let games = list_installed_games(&root).map_err(failed)?;
    Ok((root, games))
}

fn game_json(game: &InstalledGame) -> Value {
    let m = &game.manifest;
    json!({
        "app_id": m.app_id,
        "name": m.name,
        "install_dir": m.install_dir,
        "absolute_install_path": game.install_path,
        "library_path": game.library_path,
        "size_on_disk_bytes": m.size_on_disk,
        "state_flags": m.state_flags,
        "build_id": m.build_id,
        "last_updated_unix": m.last_updated,
        "files_present": game.exists_on_disk,
    })
}

fn app_id(arguments: &Value, tool: &str) -> Result<u32, SubsystemError> {
    arguments
        .get("appId")
        .and_then(Value::as_u64)
        .and_then(|id| u32::try_from(id).ok())
        .ok_or_else(|| SubsystemError::InvalidArguments(format!("{tool} requires appId")))
}

pub(crate) fn steam_get_game(arguments: &Value) -> Result<Value, SubsystemError> {
    let id = app_id(arguments, "steam_get_game")?;
    let (_, games) = games(arguments)?;
    Ok(games
        .iter()
        .find(|g| g.manifest.app_id == id)
        .map_or_else(|| json!({"success":false,"error":"app not installed","appId":id}), game_json))
}

pub(crate) fn steam_list_games(arguments: &Value) -> Result<Value, SubsystemError> {
    let include_missing = arguments.get("includeMissing").and_then(Value::as_bool).unwrap_or(false);
    let (_, mut games) = games(arguments)?;
    games.sort_by(|a, b| a.manifest.name.to_lowercase().cmp(&b.manifest.name.to_lowercase()));
    Ok(Value::Array(
        games.iter().filter(|g| include_missing || g.exists_on_disk).map(game_json).collect(),
    ))
}

pub(crate) fn steam_list_libraries(arguments: &Value) -> Result<Value, SubsystemError> {
    let root = steam_root(arguments)?;
    let libraries = scan_steam_libraries(&root).map_err(failed)?;
    Ok(Value::Array(
        libraries
            .iter()
            .enumerate()
            .map(|(id, lib)| {
                json!({
                    "id": id,
                    "path": lib.path,
                    "label": lib.label,
                    "game_count": lib.apps.len(),
                    "total_size_bytes": lib.apps.iter().map(|a| a.size_on_disk).sum::<u64>(),
                    "steam_install_path": root,
                })
            })
            .collect(),
    ))
}

pub(crate) fn steam_scan_summary(arguments: &Value) -> Result<Value, SubsystemError> {
    let root = steam_root(arguments)?;
    let libraries = scan_steam_libraries(&root).map_err(failed)?;
    let games = list_installed_games(&root).map_err(failed)?;
    let present: Vec<_> = games.iter().filter(|g| g.exists_on_disk).collect();
    Ok(json!({
        "success": true,
        "steam_root": root,
        "nb_libraries": libraries.len(),
        "nb_games": games.len(),
        "nb_games_present": present.len(),
        "total_size_bytes": present.iter().map(|g| g.manifest.size_on_disk).sum::<u64>(),
    }))
}

pub(crate) fn steam_get_game_status(arguments: &Value) -> Result<Value, SubsystemError> {
    let id = app_id(arguments, "steam_get_game_status")?;
    let (_, games) = games(arguments)?;
    let game = games.iter().find(|g| g.manifest.app_id == id).ok_or_else(|| {
        SubsystemError::Failed(format!("app {id} is not installed in any Steam library"))
    })?;
    let executable = arguments
        .get("executableName")
        .and_then(Value::as_str)
        .filter(|v| !v.trim().is_empty())
        .map(str::to_owned)
        .unwrap_or_else(|| format!("{}.exe", game.manifest.install_dir));
    let wanted = executable.strip_suffix(".exe").unwrap_or(&executable).to_ascii_lowercase();
    let process = system::list_processes(None, "name", 10_000)
        .processes
        .into_iter()
        .find(|process| process.name.trim_end_matches(".exe").eq_ignore_ascii_case(&wanted));
    Ok(json!({
        "appId": id,
        "running": process.is_some(),
        "pid": process.as_ref().map(|p| p.pid),
        "executable": executable,
        "installDir": game.manifest.install_dir,
        "absoluteInstallPath": game.install_path,
    }))
}

fn read_vdf(path: &Path) -> Option<bun_steam::vdf::VdfValue> {
    std::fs::read_to_string(path).ok().and_then(|text| bun_steam::vdf::parse_vdf(&text).ok())
}

/// steamcmd data home: `STEAMCMD_HOME`, the directory of `STEAMCMD`, then `C:\steamcmd` or
/// `~/.steam/steamcmd`.
fn steamcmd_home() -> Option<PathBuf> {
    std::env::var_os("STEAMCMD_HOME")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("STEAMCMD").and_then(|p| PathBuf::from(p).parent().map(Path::to_path_buf)))
        .or_else(|| {
            let candidate = if cfg!(windows) {
                PathBuf::from(r"C:\steamcmd")
            } else {
                PathBuf::from(std::env::var_os("HOME")?).join(".steam/steamcmd")
            };
            candidate.join("config/config.vdf").is_file().then_some(candidate)
        })
}

/// Credential state without secrets: client accounts with their flags and, per account, whether
/// the client or steamcmd holds a reusable session (`ConnectCache` key presence only).
pub(crate) fn steam_vault_status(arguments: &Value) -> Result<Value, SubsystemError> {
    let root = steam_root(arguments)?;
    let users = read_vdf(&root.join("config/loginusers.vdf"))
        .map(|doc| bun_steam::config::login_users(&doc))
        .unwrap_or_default();
    let client_config = read_vdf(&root.join("config/config.vdf"));
    let steamcmd = steamcmd_home();
    let steamcmd_config = steamcmd.as_ref().and_then(|home| read_vdf(&home.join("config/config.vdf")));
    let accounts: Vec<Value> = users
        .iter()
        .map(|u| {
            json!({
                "account": u.account_name,
                "persona": u.persona_name,
                "rememberPassword": u.remember_password,
                "mostRecent": u.most_recent,
                "allowAutoLogin": u.allow_auto_login,
                "clientCachedSession": client_config
                    .as_ref()
                    .is_some_and(|c| bun_steam::config::has_cached_session(c, &u.account_name)),
                "steamcmdCachedSession": steamcmd_config
                    .as_ref()
                    .is_some_and(|c| bun_steam::config::has_cached_session(c, &u.account_name)),
            })
        })
        .collect();
    Ok(json!({
        "steamRoot": root,
        "steamcmdHome": steamcmd,
        "accounts": accounts,
        "secrets": "never read: passwords, tokens and ConnectCache values stay in the Steam files",
    }))
}
