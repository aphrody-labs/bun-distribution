//! Shared installation discovery. Fast discovery never walks entire disks or contacts a server.
use crate::FormatError;
use std::path::{Path, PathBuf};

pub const SOURCE_ENV: [&str; 4] =
    ["NIE_GAME_SOURCE", "NIE_GAME_DIR", "IECODE_GAME_PATH", "NIE_GAME_PATH"];

#[must_use]
pub fn is_remote(source: &str) -> bool {
    ["http://", "https://", "ssh://", "sftp://"].iter().any(|scheme| source.starts_with(scheme))
}

/// Normalize an installation root, its data directory, or nie.exe without reading game bytes.
#[must_use]
pub fn local_data_dir(path: &Path) -> Option<PathBuf> {
    let path = if path.file_name().is_some_and(|n| n.eq_ignore_ascii_case("nie.exe")) {
        path.parent()?
    } else {
        path
    };
    [path.to_path_buf(), path.join("data")]
        .into_iter()
        .find(|candidate| candidate.join("cpk_list.cfg.bin").is_file())
}

fn config_dir() -> Option<PathBuf> {
    std::env::var_os("NIE_CONFIG_DIR").map(PathBuf::from).or_else(|| {
        std::env::var_os("XDG_CONFIG_HOME")
            .map(PathBuf::from)
            .or_else(|| std::env::var_os("APPDATA").map(PathBuf::from))
            .or_else(|| std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".config")))
            .map(|root| root.join("nie"))
    })
}

/// Store one credential-free source reference atomically, never game records.
pub fn remember(source: &str) -> Result<(), FormatError> {
    let source = normalize(source)?;
    let root = config_dir()
        .ok_or(FormatError::Corrupt("NIE_CONFIG_DIR or user config directory required"))?;
    std::fs::create_dir_all(&root).map_err(|e| FormatError::Malformed(e.to_string()))?;
    use std::io::Write;
    let mut file = tempfile::NamedTempFile::new_in(&root)
        .map_err(|e| FormatError::Malformed(e.to_string()))?;
    file.write_all(source.as_bytes()).map_err(|e| FormatError::Malformed(e.to_string()))?;
    file.persist(root.join("game-source"))
        .map(|_| ())
        .map_err(|e| FormatError::Malformed(e.to_string()))
}

fn normalize(source: &str) -> Result<String, FormatError> {
    if source.is_empty() || source.contains(['\0', '\n', '\r']) {
        return Err(FormatError::Corrupt("invalid game source"));
    }
    if is_remote(source) {
        let (_, rest) =
            source.split_once("://").ok_or(FormatError::Corrupt("invalid game source URI"))?;
        let authority = rest.split('/').next().unwrap_or_default();
        if authority.is_empty()
            || authority.contains(['%', '\\'])
            || source.chars().any(char::is_control)
            || source.contains(['?', '#'])
            || authority.split_once('@').is_some_and(|(user, _)| user.contains(':'))
            || (source.starts_with("http") && authority.contains('@'))
        {
            return Err(FormatError::Corrupt(
                "source URI cannot contain credentials, query or fragment",
            ));
        }
        return Ok(source.to_owned());
    }
    let data = local_data_dir(Path::new(source))
        .ok_or(FormatError::Corrupt("source must contain cpk_list.cfg.bin"))?;
    std::fs::canonicalize(data)
        .map(|p| p.to_string_lossy().into_owned())
        .map_err(|e| FormatError::Malformed(e.to_string()))
}

/// Shared source resolution for Rust, .NET and Bun. A supplied override never silently falls back.
pub fn resolve(hint: Option<&str>) -> Result<String, FormatError> {
    if let Some(source) = hint.filter(|s| !s.is_empty()) {
        return normalize(source);
    }
    for key in SOURCE_ENV {
        if let Ok(source) = std::env::var(key)
            && !source.trim().is_empty()
        {
            return normalize(&source);
        }
    }
    if let Some(root) = config_dir()
        && let Ok(source) = std::fs::read_to_string(root.join("game-source"))
        && let Ok(source) = normalize(source.trim())
    {
        return Ok(source);
    }
    for start in [
        std::env::current_dir().ok(),
        std::env::current_exe().ok().and_then(|p| p.parent().map(Path::to_path_buf)),
    ]
    .into_iter()
    .flatten()
    {
        for candidate in start.ancestors() {
            if let Some(data) = local_data_dir(candidate) {
                let source = std::fs::canonicalize(data)
                    .map_err(|e| FormatError::Malformed(e.to_string()))?
                    .to_string_lossy()
                    .into_owned();
                let _ = remember(&source);
                return Ok(source);
            }
        }
    }
    let home =
        std::env::var_os("HOME").or_else(|| std::env::var_os("USERPROFILE")).map(PathBuf::from);
    let mut steam_roots = Vec::new();
    if let Some(home) = home {
        steam_roots.extend([
            home.join(".local/share/Steam"),
            home.join(".steam/steam"),
            home.join("Library/Application Support/Steam"),
        ]);
    }
    if let Some(program_files) = std::env::var_os("ProgramFiles(x86)") {
        steam_roots.push(PathBuf::from(program_files).join("Steam"));
    }
    for steam in steam_roots.clone() {
        if let Ok(libraries) = std::fs::read_to_string(steam.join("steamapps/libraryfolders.vdf")) {
            steam_roots.extend(libraries.lines().filter_map(|line| {
                let mut fields = line.split('"');
                fields.next()?;
                (fields.next()? == "path")
                    .then(|| fields.nth(1).map(|p| PathBuf::from(p.replace("\\\\", "\\"))))
                    .flatten()
            }));
        }
    }
    for steam in steam_roots {
        let manifest = std::fs::read_to_string(steam.join("steamapps/appmanifest_2799860.acf"))
            .unwrap_or_default();
        let folder = manifest
            .lines()
            .find_map(|line| {
                let mut fields = line.split('"');
                fields.next()?;
                (fields.next()? == "installdir").then(|| fields.nth(1)).flatten()
            })
            .unwrap_or("INAZUMA ELEVEN Victory Road");
        if let Some(data) = local_data_dir(&steam.join("steamapps/common").join(folder)) {
            let source = std::fs::canonicalize(data)
                .map_err(|e| FormatError::Malformed(e.to_string()))?
                .to_string_lossy()
                .into_owned();
            let _ = remember(&source);
            return Ok(source);
        }
    }
    Err(FormatError::Corrupt(
        "game source not indexed: use nie vfs locate --game-dir PATH or --scan-root PATH, or set NIE_GAME_SOURCE to a local/HTTP/SSH source",
    ))
}

/// Explicit one-time indexing for arbitrary locations. Does not follow directory symlinks.
pub fn scan(root: &Path) -> Result<String, FormatError> {
    let mut pending = vec![root.to_path_buf()];
    while let Some(directory) = pending.pop() {
        if let Some(data) = local_data_dir(&directory) {
            let source = std::fs::canonicalize(data)
                .map_err(|e| FormatError::Malformed(e.to_string()))?
                .to_string_lossy()
                .into_owned();
            remember(&source)?;
            return Ok(source);
        }
        let Ok(entries) = std::fs::read_dir(directory) else {
            continue;
        };
        for entry in entries.flatten() {
            if entry.file_type().is_ok_and(|kind| kind.is_dir()) {
                pending.push(entry.path());
            }
        }
    }
    Err(FormatError::Corrupt("no installed VFS found under scan root"))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn discovery_accepts_arbitrary_root_data_or_executable_and_ignores_namesakes() {
        let base = std::env::temp_dir().join(format!("nie-source-{}", std::process::id()));
        let data = base.join("arbitrary location/data");
        std::fs::create_dir_all(&data).unwrap();
        std::fs::write(data.join("cpk_list.cfg.bin"), []).unwrap();
        std::fs::write(data.join("nie.exe"), []).unwrap();
        for path in [data.clone(), data.parent().unwrap().to_path_buf(), data.join("nie.exe")] {
            assert_eq!(local_data_dir(&path), Some(data.clone()));
            assert_eq!(
                resolve(path.to_str()).unwrap(),
                std::fs::canonicalize(&data).unwrap().to_string_lossy()
            );
        }
        assert!(resolve(Some("missing-install")).is_err());
        for source in ["http:///game", "ssh://user%3Asecret@host/game", "https://host/game?token=x"]
        {
            assert!(resolve(Some(source)).is_err());
        }
        assert_eq!(
            resolve(Some("ssh://host/arbitrary/data")).unwrap(),
            "ssh://host/arbitrary/data"
        );
        std::fs::remove_dir_all(base).unwrap();
    }
}
