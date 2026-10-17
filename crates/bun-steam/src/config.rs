// SPDX-License-Identifier: Apache-2.0
//! Steam client configuration across hosts.
//!
//! - `config/loginusers.vdf`: account names, persona names and login flags. Account names are
//!   not secrets; nothing else from the file is surfaced.
//! - `config/config.vdf`: `CompatToolMapping` (per-game Proton selection) read and edit, and the
//!   cached-session check: `ConnectCache` holds one entry per account under the key
//!   `crc32(lowercase account name)` in lowercase hex followed by `1`. Only the presence of the
//!   entry is reported; its value is never returned, logged or printed.
//! - Client registry: `HKCU\Software\Valve\Steam` on Windows, `~/.steam/registry.vdf` on Linux
//!   (`AutoLoginUser`, `RememberPassword`, `SteamPath`, `RunningAppID`).
//! - `libraryfolders.vdf` edits for adding a library on a faster disk, and the move plan of one
//!   installed app between libraries.
//!
//! Document edits are pure (`&mut VdfValue`); callers write the file while Steam is not running.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::SteamError;
use crate::vdf::VdfValue;

/// Path of the Steam settings block inside `config.vdf`.
pub const CONFIG_STEAM_PATH: &[&str] = &["InstallConfigStore", "Software", "Valve", "Steam"];

// ---------------------------------------------------------------------------
// loginusers.vdf
// ---------------------------------------------------------------------------

/// One account remembered by the client.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct LoginUser {
    /// SteamID64.
    pub steam_id: String,
    /// Login account name.
    pub account_name: String,
    /// Persona (display) name.
    pub persona_name: String,
    /// "Remember password" was ticked for this account.
    pub remember_password: bool,
    /// Last account used.
    pub most_recent: bool,
    /// Auto-login allowed.
    pub allow_auto_login: bool,
    /// Starts in offline mode.
    pub wants_offline_mode: bool,
    /// Unix time of the last login.
    pub timestamp: Option<u64>,
}

fn flag(node: &VdfValue, key: &str) -> bool {
    node.get_str(key).is_some_and(|v| v == "1")
}

/// Parses a `loginusers.vdf` document.
#[must_use]
pub fn login_users(doc: &VdfValue) -> Vec<LoginUser> {
    let Some(users) = doc.get("users").and_then(VdfValue::entries) else {
        return Vec::new();
    };
    users
        .iter()
        .filter(|(_, node)| matches!(node, VdfValue::Table(_)))
        .map(|(steam_id, node)| LoginUser {
            steam_id: steam_id.clone(),
            account_name: node.get_str("AccountName").unwrap_or_default().to_owned(),
            persona_name: node.get_str("PersonaName").unwrap_or_default().to_owned(),
            remember_password: flag(node, "RememberPassword"),
            most_recent: flag(node, "MostRecent") || flag(node, "mostrecent"),
            allow_auto_login: flag(node, "AllowAutoLogin"),
            wants_offline_mode: flag(node, "WantsOfflineMode"),
            timestamp: node.get_u64("Timestamp"),
        })
        .collect()
}

// ---------------------------------------------------------------------------
// config.vdf: ConnectCache presence
// ---------------------------------------------------------------------------

/// `ConnectCache` key of an account: `crc32(lowercase name)` in lowercase hex, then `1`.
#[must_use]
pub fn connect_cache_key(account_name: &str) -> String {
    let crc = crc32fast::hash(account_name.to_lowercase().as_bytes());
    format!("{crc:x}1")
}

/// Whether `config.vdf` holds a cached session for `account_name` (the client or steamcmd can log
/// in without a password). Returns only a boolean; the cached value is never exposed.
#[must_use]
pub fn has_cached_session(config: &VdfValue, account_name: &str) -> bool {
    let Some(cache) = config
        .get_path(CONFIG_STEAM_PATH)
        .and_then(|steam| steam.get("ConnectCache"))
        .and_then(VdfValue::entries)
    else {
        return false;
    };
    let crc = crc32fast::hash(account_name.to_lowercase().as_bytes());
    let keys = [format!("{crc:x}1"), format!("{crc:08x}1")];
    cache.iter().any(|(key, value)| {
        keys.iter().any(|k| key.eq_ignore_ascii_case(k))
            && matches!(value, VdfValue::Str(v) if !v.is_empty())
    })
}

/// Account names (from `loginusers.vdf`) with a cached session in `config.vdf`.
#[must_use]
pub fn cached_accounts(config: &VdfValue, users: &[LoginUser]) -> Vec<String> {
    users
        .iter()
        .filter(|user| has_cached_session(config, &user.account_name))
        .map(|user| user.account_name.clone())
        .collect()
}

// ---------------------------------------------------------------------------
// config.vdf: CompatToolMapping
// ---------------------------------------------------------------------------

/// One `CompatToolMapping` entry. App id `0` is the default for every Windows title.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CompatToolEntry {
    /// App id (`0` = global default).
    pub app_id: u32,
    /// Tool internal name (`proton_experimental`, `GE-Proton11-9`, ...).
    pub name: String,
    /// Tool configuration string.
    pub config: String,
    /// Priority (`250` for user choices, `75` for Valve defaults).
    pub priority: String,
}

/// Reads `CompatToolMapping` from a `config.vdf` document.
#[must_use]
pub fn compat_tool_mapping(config: &VdfValue) -> Vec<CompatToolEntry> {
    let Some(entries) = config
        .get_path(CONFIG_STEAM_PATH)
        .and_then(|steam| steam.get("CompatToolMapping"))
        .and_then(VdfValue::entries)
    else {
        return Vec::new();
    };
    entries
        .iter()
        .filter_map(|(app, node)| {
            Some(CompatToolEntry {
                app_id: app.parse().ok()?,
                name: node.get_str("name")?.to_owned(),
                config: node.get_str("config").unwrap_or_default().to_owned(),
                priority: node.get_str("priority").unwrap_or_default().to_owned(),
            })
        })
        .collect()
}

/// Sets the compatibility tool of `app_id` (`0` = default) in a `config.vdf` document; an empty
/// `tool` removes the mapping. Returns `false` when the document is not a table.
pub fn set_compat_tool(config: &mut VdfValue, app_id: u32, tool: &str) -> bool {
    let Some(steam) = config.path_mut(CONFIG_STEAM_PATH) else {
        return false;
    };
    let Some(mapping) = steam.table_mut("CompatToolMapping") else {
        return false;
    };
    let key = app_id.to_string();
    if tool.is_empty() {
        mapping.remove(&key);
        return true;
    }
    mapping.set(
        &key,
        VdfValue::Table(vec![
            ("name".into(), VdfValue::Str(tool.into())),
            ("config".into(), VdfValue::Str(String::new())),
            ("priority".into(), VdfValue::Str("250".into())),
        ]),
    );
    true
}

// ---------------------------------------------------------------------------
// Client registry (Windows registry / Linux registry.vdf)
// ---------------------------------------------------------------------------

/// Client registry values that select the auto-login account and the install.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct ClientRegistry {
    /// Account the client logs in with at start (`AutoLoginUser`).
    pub auto_login_user: Option<String>,
    /// `RememberPassword` (DWORD 0/1).
    pub remember_password: Option<bool>,
    /// Install root (`SteamPath`).
    pub steam_path: Option<String>,
    /// `SteamExe`.
    pub steam_exe: Option<String>,
    /// Client UI language.
    pub language: Option<String>,
    /// App currently running (`RunningAppID`, 0 when idle).
    pub running_app_id: Option<u32>,
    /// Where the values were read: `hkcu` or the `registry.vdf` path.
    pub source: String,
}

/// Path of the Steam key inside Linux `registry.vdf`.
pub const REGISTRY_VDF_STEAM_PATH: &[&str] = &["Registry", "HKCU", "Software", "Valve", "Steam"];

/// Reads the client registry block of a Linux `registry.vdf` document.
#[must_use]
pub fn client_registry_from_vdf(doc: &VdfValue, source: &str) -> ClientRegistry {
    let Some(steam) = doc.get_path(REGISTRY_VDF_STEAM_PATH) else {
        return ClientRegistry {
            source: source.into(),
            ..ClientRegistry::default()
        };
    };
    let text = |key: &str| {
        steam
            .get_str(key)
            .map(str::to_owned)
            .filter(|v| !v.is_empty())
    };
    ClientRegistry {
        auto_login_user: text("AutoLoginUser"),
        remember_password: steam.get_str("RememberPassword").map(|v| v == "1"),
        steam_path: text("SteamPath"),
        steam_exe: text("SteamExe"),
        language: text("language"),
        running_app_id: steam
            .get_u64("RunningAppID")
            .and_then(|v| u32::try_from(v).ok()),
        source: source.into(),
    }
}

/// Sets `AutoLoginUser` / `RememberPassword` in a Linux `registry.vdf` document.
pub fn set_auto_login_vdf(doc: &mut VdfValue, account_name: &str, remember: bool) -> bool {
    let Some(steam) = doc.path_mut(REGISTRY_VDF_STEAM_PATH) else {
        return false;
    };
    steam.set("AutoLoginUser", VdfValue::Str(account_name.into()));
    steam.set(
        "RememberPassword",
        VdfValue::Str(if remember { "1" } else { "0" }.into()),
    );
    true
}

/// `~/.steam/registry.vdf` (Linux client).
#[must_use]
pub fn linux_registry_vdf_path() -> Option<PathBuf> {
    std::env::var_os("HOME").map(|home| PathBuf::from(home).join(".steam").join("registry.vdf"))
}

/// Reads the client registry of this host: `HKCU\Software\Valve\Steam` on Windows,
/// `~/.steam/registry.vdf` elsewhere.
pub fn read_client_registry() -> Result<ClientRegistry, SteamError> {
    #[cfg(windows)]
    {
        winreg::read()
    }
    #[cfg(not(windows))]
    {
        let path = linux_registry_vdf_path()
            .ok_or_else(|| SteamError::NotFound("HOME is not set".into()))?;
        let text = std::fs::read_to_string(&path)?;
        let doc = crate::vdf::parse_vdf(&text)?;
        Ok(client_registry_from_vdf(&doc, &path.to_string_lossy()))
    }
}

/// Writes `AutoLoginUser` / `RememberPassword` for this host's client (registry on Windows,
/// `registry.vdf` elsewhere). Run it while Steam is closed; no secret is involved.
pub fn write_auto_login(account_name: &str, remember: bool) -> Result<(), SteamError> {
    #[cfg(windows)]
    {
        winreg::write_auto_login(account_name, remember)
    }
    #[cfg(not(windows))]
    {
        let path = linux_registry_vdf_path()
            .ok_or_else(|| SteamError::NotFound("HOME is not set".into()))?;
        let text = std::fs::read_to_string(&path)?;
        let mut doc = crate::vdf::parse_vdf(&text)?;
        set_auto_login_vdf(&mut doc, account_name, remember);
        std::fs::write(&path, doc.to_vdf_string())?;
        Ok(())
    }
}

#[cfg(windows)]
mod winreg {
    use windows::Win32::Foundation::ERROR_SUCCESS;
    use windows::Win32::System::Registry::{
        HKEY_CURRENT_USER, REG_DWORD, REG_SZ, REG_VALUE_TYPE, RRF_RT_REG_DWORD, RRF_RT_REG_SZ,
        RegGetValueW, RegSetKeyValueW,
    };
    use windows::core::{HSTRING, PCWSTR};

    use super::ClientRegistry;
    use crate::SteamError;

    const KEY: &str = r"Software\Valve\Steam";

    fn get_string(name: &str) -> Option<String> {
        let key = HSTRING::from(KEY);
        let value = HSTRING::from(name);
        let mut size = 0u32;
        // SAFETY: size query with a null buffer; the strings outlive the call.
        let status = unsafe {
            RegGetValueW(
                HKEY_CURRENT_USER,
                &key,
                &value,
                RRF_RT_REG_SZ,
                None,
                None,
                Some(&mut size),
            )
        };
        if status != ERROR_SUCCESS || size < 2 {
            return None;
        }
        let mut buffer = vec![0u16; (size as usize).div_ceil(2)];
        // SAFETY: `buffer` holds `size` bytes as reported by the previous call.
        let status = unsafe {
            RegGetValueW(
                HKEY_CURRENT_USER,
                &key,
                &value,
                RRF_RT_REG_SZ,
                None,
                Some(buffer.as_mut_ptr().cast()),
                Some(&mut size),
            )
        };
        if status != ERROR_SUCCESS {
            return None;
        }
        let len = buffer.iter().position(|c| *c == 0).unwrap_or(buffer.len());
        Some(String::from_utf16_lossy(&buffer[..len])).filter(|v| !v.is_empty())
    }

    fn get_dword(name: &str) -> Option<u32> {
        let key = HSTRING::from(KEY);
        let value = HSTRING::from(name);
        let mut data = 0u32;
        let mut size = 4u32;
        // SAFETY: `data` is a 4-byte buffer and `size` says so.
        let status = unsafe {
            RegGetValueW(
                HKEY_CURRENT_USER,
                &key,
                &value,
                RRF_RT_REG_DWORD,
                None,
                Some((&raw mut data).cast()),
                Some(&mut size),
            )
        };
        (status == ERROR_SUCCESS).then_some(data)
    }

    pub(super) fn read() -> Result<ClientRegistry, SteamError> {
        Ok(ClientRegistry {
            auto_login_user: get_string("AutoLoginUser"),
            remember_password: get_dword("RememberPassword").map(|v| v != 0),
            steam_path: get_string("SteamPath"),
            steam_exe: get_string("SteamExe"),
            language: get_string("Language"),
            running_app_id: get_dword("RunningAppID"),
            source: r"HKCU\Software\Valve\Steam".into(),
        })
    }

    fn set(name: &str, kind: REG_VALUE_TYPE, data: &[u8]) -> Result<(), SteamError> {
        let key = HSTRING::from(KEY);
        let value = HSTRING::from(name);
        let len = u32::try_from(data.len()).map_err(|e| SteamError::Registry(e.to_string()))?;
        // SAFETY: `data` is valid for `len` bytes for the duration of the call.
        let status = unsafe {
            RegSetKeyValueW(
                HKEY_CURRENT_USER,
                PCWSTR(key.as_ptr()),
                PCWSTR(value.as_ptr()),
                kind.0,
                Some(data.as_ptr().cast()),
                len,
            )
        };
        if status == ERROR_SUCCESS {
            Ok(())
        } else {
            Err(SteamError::Registry(format!(
                "RegSetKeyValueW({name}) failed: {}",
                status.0
            )))
        }
    }

    pub(super) fn write_auto_login(account_name: &str, remember: bool) -> Result<(), SteamError> {
        let wide: Vec<u8> = account_name
            .encode_utf16()
            .chain(std::iter::once(0))
            .flat_map(u16::to_le_bytes)
            .collect();
        set("AutoLoginUser", REG_SZ, &wide)?;
        set(
            "RememberPassword",
            REG_DWORD,
            &u32::from(remember).to_le_bytes(),
        )
    }
}

// ---------------------------------------------------------------------------
// libraryfolders.vdf
// ---------------------------------------------------------------------------

/// One entry of `libraryfolders.vdf`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct LibraryFolder {
    /// Entry index (`"0"`, `"1"`, ...).
    pub index: String,
    /// Library root.
    pub path: String,
    /// User label.
    pub label: String,
    /// Disk size recorded by the client.
    pub total_size: Option<u64>,
    /// App id -> size on disk.
    pub apps: Vec<(u32, u64)>,
}

fn library_root(doc: &VdfValue) -> Option<&VdfValue> {
    doc.get("libraryfolders")
        .or_else(|| doc.get("LibraryFolders"))
}

/// Lists the libraries of a `libraryfolders.vdf` document.
#[must_use]
pub fn library_folders(doc: &VdfValue) -> Vec<LibraryFolder> {
    let Some(entries) = library_root(doc).and_then(VdfValue::entries) else {
        return Vec::new();
    };
    entries
        .iter()
        .filter_map(|(index, node)| {
            let path = node.get_str("path")?.to_owned();
            let apps = node
                .get("apps")
                .and_then(VdfValue::entries)
                .map(|apps| {
                    apps.iter()
                        .filter_map(|(id, size)| match size {
                            VdfValue::Str(size) => {
                                Some((id.parse().ok()?, size.parse().unwrap_or(0)))
                            }
                            VdfValue::Table(_) => None,
                        })
                        .collect()
                })
                .unwrap_or_default();
            Some(LibraryFolder {
                index: index.clone(),
                path,
                label: node.get_str("label").unwrap_or_default().to_owned(),
                total_size: node.get_u64("totalsize"),
                apps,
            })
        })
        .collect()
}

/// Adds a library at `path` (no-op when an entry already points there). Returns its index.
pub fn add_library_folder(doc: &mut VdfValue, path: &str, label: &str) -> Option<String> {
    let same = |a: &str| {
        a.replace('\\', "/")
            .trim_end_matches('/')
            .eq_ignore_ascii_case(path.replace('\\', "/").trim_end_matches('/'))
    };
    if let Some(existing) = library_folders(doc).into_iter().find(|f| same(&f.path)) {
        return Some(existing.index);
    }
    if doc.get("libraryfolders").is_none() && doc.get("LibraryFolders").is_none() {
        doc.set("libraryfolders", VdfValue::Table(Vec::new()));
    }
    let root_key = if doc.get("libraryfolders").is_some() {
        "libraryfolders"
    } else {
        "LibraryFolders"
    };
    let root = doc.get_mut(root_key)?;
    let next = root
        .entries()
        .map(|entries| {
            entries
                .iter()
                .filter_map(|(k, _)| k.parse::<u32>().ok())
                .max()
                .map_or(0, |m| m + 1)
        })
        .unwrap_or(0)
        .to_string();
    root.set(
        &next,
        VdfValue::Table(vec![
            ("path".into(), VdfValue::Str(path.into())),
            ("label".into(), VdfValue::Str(label.into())),
            ("contentid".into(), VdfValue::Str("0".into())),
            ("totalsize".into(), VdfValue::Str("0".into())),
            ("update_clean_bytes_tally".into(), VdfValue::Str("0".into())),
            (
                "time_last_update_verified".into(),
                VdfValue::Str("0".into()),
            ),
            ("apps".into(), VdfValue::Table(Vec::new())),
        ]),
    );
    Some(next)
}

/// Moves the `apps` record of `app_id` from one library entry to another inside
/// `libraryfolders.vdf`. Returns `false` when either library is missing.
pub fn move_app_record(doc: &mut VdfValue, app_id: u32, from_path: &str, to_path: &str) -> bool {
    let folders = library_folders(doc);
    let norm = |a: &str| {
        a.replace('\\', "/")
            .trim_end_matches('/')
            .to_ascii_lowercase()
    };
    let find = |p: &str| {
        folders
            .iter()
            .find(|f| norm(&f.path) == norm(p))
            .map(|f| f.index.clone())
    };
    let (Some(from), Some(to)) = (find(from_path), find(to_path)) else {
        return false;
    };
    let key = app_id.to_string();
    let root_key = if doc.get("libraryfolders").is_some() {
        "libraryfolders"
    } else {
        "LibraryFolders"
    };
    let Some(root) = doc.get_mut(root_key) else {
        return false;
    };
    let mut size = VdfValue::Str("0".into());
    if let Some(apps) = root.get_mut(&from).and_then(|f| f.table_mut("apps")) {
        if let Some(VdfValue::Str(s)) = apps.get(&key) {
            size = VdfValue::Str(s.clone());
        }
        apps.remove(&key);
    }
    if let Some(apps) = root.get_mut(&to).and_then(|f| f.table_mut("apps")) {
        apps.set(&key, size);
    }
    true
}

/// File moves that relocate one installed app between two library roots.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AppMovePlan {
    /// App id.
    pub app_id: u32,
    /// `(from, to)` for `appmanifest_<id>.acf`.
    pub manifest: (PathBuf, PathBuf),
    /// `(from, to)` for `steamapps/common/<installdir>`.
    pub content: (PathBuf, PathBuf),
    /// `(from, to)` for `steamapps/compatdata/<id>` (Proton prefix), when it exists.
    pub compatdata: Option<(PathBuf, PathBuf)>,
    /// `(from, to)` for `steamapps/shadercache/<id>`, when it exists.
    pub shadercache: Option<(PathBuf, PathBuf)>,
}

/// Plans the move of an installed app from `from_library` to `to_library` (library roots).
pub fn plan_app_move(
    app_id: u32,
    from_library: &Path,
    to_library: &Path,
) -> Result<AppMovePlan, SteamError> {
    let from_apps = from_library.join("steamapps");
    let to_apps = to_library.join("steamapps");
    let manifest_name = format!("appmanifest_{app_id}.acf");
    let manifest_from = from_apps.join(&manifest_name);
    let text = std::fs::read_to_string(&manifest_from)
        .map_err(|_| SteamError::NotFound(manifest_from.to_string_lossy().into_owned()))?;
    let manifest = crate::install::AppManifest::parse(&text)?;
    let install_dir = Path::new(&manifest.install_dir);
    if manifest.install_dir.is_empty()
        || install_dir.components().count() != 1
        || !matches!(
            install_dir.components().next(),
            Some(std::path::Component::Normal(_))
        )
    {
        return Err(SteamError::MalformedAcf(format!(
            "unsafe installdir {:?}",
            manifest.install_dir
        )));
    }
    let optional = |sub: &str| {
        let from = from_apps.join(sub).join(app_id.to_string());
        from.exists()
            .then(|| (from, to_apps.join(sub).join(app_id.to_string())))
    };
    Ok(AppMovePlan {
        app_id,
        manifest: (manifest_from, to_apps.join(&manifest_name)),
        content: (
            from_apps.join("common").join(install_dir),
            to_apps.join("common").join(install_dir),
        ),
        compatdata: optional("compatdata"),
        shadercache: optional("shadercache"),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::vdf::parse_vdf;

    #[test]
    fn connect_cache_presence_only() {
        let key = connect_cache_key("Alice");
        assert_eq!(key, format!("{:x}1", crc32fast::hash(b"alice")));
        let text = format!(
            "\"InstallConfigStore\" {{ \"Software\" {{ \"Valve\" {{ \"Steam\" {{ \"ConnectCache\" {{ \"{key}\" \"opaque\" }} }} }} }} }}"
        );
        let doc = parse_vdf(&text).unwrap();
        assert!(has_cached_session(&doc, "ALICE"));
        assert!(!has_cached_session(&doc, "bob"));
    }

    #[test]
    fn compat_tool_mapping_round_trip() {
        let mut doc =
            parse_vdf("\"InstallConfigStore\" { \"Software\" { \"valve\" { \"Steam\" { } } } }")
                .unwrap();
        assert!(set_compat_tool(&mut doc, 2_799_860, "GE-Proton11-9"));
        assert!(set_compat_tool(&mut doc, 0, "proton_experimental"));
        let reparsed = parse_vdf(&doc.to_vdf_string()).unwrap();
        let mapping = compat_tool_mapping(&reparsed);
        assert_eq!(mapping.len(), 2);
        assert_eq!(mapping[0].name, "GE-Proton11-9");
        assert!(set_compat_tool(&mut doc, 0, ""));
        assert_eq!(compat_tool_mapping(&doc).len(), 1);
    }

    #[test]
    fn library_add_and_move() {
        let mut doc = parse_vdf(
            "\"libraryfolders\" { \"0\" { \"path\" \"C:\\\\Steam\" \"apps\" { \"730\" \"100\" } } }",
        )
        .unwrap();
        assert_eq!(
            add_library_folder(&mut doc, "D:\\Fast", "fast").as_deref(),
            Some("1")
        );
        assert_eq!(
            add_library_folder(&mut doc, "D:/Fast/", "fast").as_deref(),
            Some("1")
        );
        assert!(move_app_record(&mut doc, 730, "C:\\Steam", "D:\\Fast"));
        let folders = library_folders(&doc);
        assert!(folders[0].apps.is_empty());
        assert_eq!(folders[1].apps, vec![(730, 100)]);
    }

    #[test]
    fn login_users_flags() {
        let doc = parse_vdf(
            "\"users\" { \"7656\" { \"AccountName\" \"alice\" \"PersonaName\" \"A\" \"RememberPassword\" \"1\" \"MostRecent\" \"1\" } }",
        )
        .unwrap();
        let users = login_users(&doc);
        assert_eq!(users[0].account_name, "alice");
        assert!(users[0].remember_password && users[0].most_recent);
    }
}
