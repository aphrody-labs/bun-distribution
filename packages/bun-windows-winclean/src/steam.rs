// SPDX-License-Identifier: Apache-2.0
//! Steam compatibility database queries and URI launch.

use crate::{dispatch::failed, system};
use crate::SubsystemError;
use serde_json::Value;

pub(crate) fn open_steam_uri(uri: &str) -> Result<Value, SubsystemError> {
    if !uri.starts_with("steam://") || uri.chars().any(|c| c.is_control() || c == '"') {
        return Ok(serde_json::json!({"success":false,"error":"invalid scheme"}));
    }
    #[cfg(windows)]
    {
        crate::system::shell_open(uri).map_err(failed)?;
        Ok(serde_json::json!({"success":true,"uri":uri}))
    }
    #[cfg(not(windows))]
    {
        Err(SubsystemError::Failed("Steam URI launch is Windows-only".into()))
    }
}

fn steam_db_path(arguments: &Value) -> std::path::PathBuf {
    arguments
        .get("dbPath")
        .and_then(Value::as_str)
        .filter(|v| !v.trim().is_empty())
        .map(std::path::PathBuf::from)
        .or_else(|| std::env::var_os("WINCLEAN_STEAM_SCAN_DB").map(std::path::PathBuf::from))
        .unwrap_or_else(|| {
            std::env::current_dir()
                .unwrap_or_else(|_| std::path::PathBuf::from("."))
                .join("var/data/steam-scan.db")
        })
}

fn steam_connection(
    arguments: &Value,
) -> Result<(rusqlite::Connection, std::path::PathBuf), SubsystemError> {
    let path = steam_db_path(arguments);
    if !path.is_file() {
        return Err(SubsystemError::Failed(format!(
            "steam-scan.db not found at {}",
            path.display()
        )));
    }
    let conn =
        rusqlite::Connection::open_with_flags(&path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)
            .map_err(failed)?;
    conn.busy_timeout(std::time::Duration::from_secs(5)).map_err(failed)?;
    Ok((conn, path))
}

fn steam_game_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<Value> {
    Ok(serde_json::json!({
        "app_id": row.get::<_, i64>(0)?, "name": row.get::<_, Option<String>>(1)?.unwrap_or_default(),
        "install_dir": row.get::<_, Option<String>>(2)?.unwrap_or_default(), "absolute_install_path": row.get::<_, Option<String>>(3)?.unwrap_or_default(),
        "size_on_disk_bytes": row.get::<_, Option<i64>>(4)?.unwrap_or(0), "state_flags": row.get::<_, Option<i64>>(5)?.unwrap_or(0),
        "last_updated_unix": row.get::<_, Option<i64>>(6)?.unwrap_or(0), "last_played_unix": row.get::<_, Option<i64>>(7)?.unwrap_or(0),
        "files_present": row.get::<_, Option<i64>>(8)?.unwrap_or(0), "scanned_at": row.get::<_, Option<String>>(9)?.unwrap_or_default()
    }))
}

pub(crate) fn steam_get_game(arguments: &Value) -> Result<Value, SubsystemError> {
    let app_id = arguments
        .get("appId")
        .and_then(Value::as_i64)
        .ok_or_else(|| SubsystemError::InvalidArguments("steam_get_game requires appId".into()))?;
    let (conn, _) = steam_connection(arguments)?;
    conn.query_row(
        "SELECT app_id,name,install_dir,absolute_install_path,size_on_disk_bytes,state_flags,\
         last_updated_unix,last_played_unix,files_present,scanned_at FROM steam_game WHERE \
         app_id=?1",
        [app_id],
        steam_game_row,
    )
    .map_err(|error| SubsystemError::Failed(error.to_string()))
}

pub(crate) fn steam_list_games(arguments: &Value) -> Result<Value, SubsystemError> {
    let include_missing = arguments.get("includeMissing").and_then(Value::as_bool).unwrap_or(false);
    let (conn, _) = steam_connection(arguments)?;
    let sql = if include_missing {
        "SELECT app_id,name,install_dir,absolute_install_path,size_on_disk_bytes,state_flags,\
         last_updated_unix,last_played_unix,files_present,scanned_at FROM steam_game ORDER BY name"
    } else {
        "SELECT app_id,name,install_dir,absolute_install_path,size_on_disk_bytes,state_flags,\
         last_updated_unix,last_played_unix,files_present,scanned_at FROM steam_game WHERE \
         files_present > 0 ORDER BY name"
    };
    let mut statement = conn.prepare(sql).map_err(failed)?;
    let rows = statement
        .query_map([], steam_game_row)
        .map_err(failed)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(failed)?;
    Ok(Value::Array(rows))
}

pub(crate) fn steam_list_libraries(arguments: &Value) -> Result<Value, SubsystemError> {
    let (conn, _) = steam_connection(arguments)?;
    let mut statement = conn
        .prepare(
            "SELECT l.id,l.path,l.game_count,l.total_size_bytes,i.path FROM steam_library l JOIN \
             steam_install i ON i.id=l.install_id ORDER BY l.path",
        )
        .map_err(failed)?;
    let rows = statement.query_map([], |row| Ok(serde_json::json!({"id":row.get::<_,i64>(0)?,"path":row.get::<_,Option<String>>(1)?.unwrap_or_default(),"game_count":row.get::<_,i64>(2)?,"total_size_bytes":row.get::<_,i64>(3)?,"steam_install_path":row.get::<_,Option<String>>(4)?.unwrap_or_default()}))).map_err(failed)?.collect::<Result<Vec<_>, _>>().map_err(failed)?;
    Ok(Value::Array(rows))
}

pub(crate) fn steam_scan_summary(arguments: &Value) -> Result<Value, SubsystemError> {
    let (conn, path) = steam_connection(arguments)?;
    let count = |sql: &str| conn.query_row(sql, [], |row| row.get::<_, i64>(0)).map_err(failed);
    Ok(
        serde_json::json!({"success":true,"db_path":path,"nb_installs":count("SELECT COUNT(*) FROM steam_install")?,"nb_libraries":count("SELECT COUNT(*) FROM steam_library")?,"nb_games":count("SELECT COUNT(*) FROM steam_game")?,"nb_games_present":count("SELECT COUNT(*) FROM steam_game WHERE files_present > 0")?,"total_size_bytes":count("SELECT COALESCE(SUM(size_on_disk_bytes),0) FROM steam_game WHERE files_present > 0")?}),
    )
}

pub(crate) fn steam_get_game_status(arguments: &Value) -> Result<Value, SubsystemError> {
    let app_id = arguments.get("appId").and_then(Value::as_i64).ok_or_else(|| {
        SubsystemError::InvalidArguments("steam_get_game_status requires appId".into())
    })?;
    let (conn, _) = steam_connection(arguments)?;
    let (install_dir, absolute_path): (String, String) = conn
        .query_row(
            "SELECT COALESCE(install_dir,''),COALESCE(absolute_install_path,'') FROM steam_game \
             WHERE app_id=?1",
            [app_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .map_err(failed)?;
    let executable = arguments
        .get("executableName")
        .and_then(Value::as_str)
        .filter(|v| !v.trim().is_empty())
        .map(str::to_owned)
        .unwrap_or_else(|| format!("{install_dir}.exe"));
    let wanted = executable.strip_suffix(".exe").unwrap_or(&executable).to_ascii_lowercase();
    let process = system::list_processes(None, "name", 10_000)
        .processes
        .into_iter()
        .find(|process| process.name.trim_end_matches(".exe").eq_ignore_ascii_case(&wanted));
    Ok(
        serde_json::json!({"appId":app_id,"running":process.is_some(),"pid":process.as_ref().map(|p|p.pid),"executable":executable,"installDir":install_dir,"absoluteInstallPath":absolute_path}),
    )
}

pub(crate) fn steam_vault_status(arguments: &Value) -> Result<Value, SubsystemError> {
    let (conn, _) = steam_connection(arguments)?;
    let mut statement = conn
        .prepare(
            "SELECT target,kind,description,user_hint,last_seen FROM secrets_vault_ref ORDER BY \
             target",
        )
        .map_err(failed)?;
    let refs = statement.query_map([], |row| Ok(serde_json::json!({"target":row.get::<_,Option<String>>(0)?.unwrap_or_default(),"kind":row.get::<_,Option<String>>(1)?.unwrap_or_default(),"description":row.get::<_,Option<String>>(2)?,"user_hint":row.get::<_,Option<String>>(3)?,"last_seen":row.get::<_,Option<String>>(4)?.unwrap_or_default()}))).map_err(failed)?.collect::<Result<Vec<_>, _>>().map_err(failed)?;
    Ok(
        serde_json::json!({"vault_refs":refs,"winclean_steam_auth":{"available":false,"error":"secret material is not exposed by the Rust backend"}}),
    )
}
