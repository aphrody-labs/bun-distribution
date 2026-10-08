// SPDX-License-Identifier: Apache-2.0
//! # Steam Reverse Engineering & Forensic Primitives
//!
//! Pure-Rust, zero-unsafe module for discovering, querying, and analyzing Steam installations,
//! game libraries, AppManifest ACF files, VDF KeyValues structures, and Steam DRM / SteamStub protection:
//!
//! - **Multi-Platform Discovery**: Locates Steam directories across Linux (`~/.steam`, `~/.local/share/Steam`,
//!   Flatpak, Snap), Windows (`Program Files (x86)\Steam`), WSL mounts (`/mnt/c/Program Files (x86)/Steam`),
//!   and macOS (`~/Library/Application Support/Steam`).
//! - **VDF / KeyValues Parser**: Recursive parser for Valve Data Format (`libraryfolders.vdf`, `config.vdf`),
//!   supporting quoted/unquoted keys, nested blocks, C++ style comments, and escape characters.
//! - **ACF AppManifest Parser**: Structured extraction of `appmanifest_<appid>.acf` attributes (app_id,
//!   name, installdir, StateFlags, SizeOnDisk, buildid, LastUpdated, installed depots).
//! - **Steam DRM & SteamStub Detection**: Inspection of PE/ELF sections for `.bind` and `.steam` sections,
//!   detection of entry point pointing inside `.bind`, Shannon entropy analysis of encrypted `.text`,
//!   and dependency scans for `steam_api.dll`, `steam_api64.dll`, `libsteam_api.so`.
//! - **Library Scanning**: Aggregates installed games across multi-drive Steam library folders with
//!   filtering and integrity validation.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use thiserror::Error;

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/// Errors produced by the Steam module.
#[derive(Debug, Error)]
pub enum SteamError {
    /// Standard filesystem I/O error.
    #[error("filesystem I/O error: {0}")]
    Io(#[from] std::io::Error),

    /// Syntax or structure error encountered while parsing VDF / KeyValues text.
    #[error("VDF parse error at line {line}, col {col}: {message}")]
    VdfParse { line: usize, col: usize, message: String },

    /// Malformed `appmanifest_<appid>.acf` document.
    #[error("malformed AppManifest ACF: {0}")]
    MalformedAcf(String),

    /// Missing or inaccessible Steam installation.
    #[error("Steam installation not found at '{0}'")]
    NotFound(String),

    /// Executable binary format parsing error during DRM inspection.
    #[error("binary triage error: {0}")]
    BinaryParse(String),
}

// ---------------------------------------------------------------------------
// VDF / KeyValues Parser
// ---------------------------------------------------------------------------

/// A parsed Valve Data Format (VDF / KeyValues1) value node.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum VdfValue {
    /// String scalar value.
    Str(String),
    /// Nested Key-Value table preserving ordering and supporting repeated keys.
    Table(Vec<(String, VdfValue)>),
}

impl VdfValue {
    /// Retrieve the first child value matching a key name (case-insensitive).
    pub fn get(&self, key: &str) -> Option<&VdfValue> {
        match self {
            Self::Table(entries) => {
                entries.iter().find(|(k, _)| k.eq_ignore_ascii_case(key)).map(|(_, v)| v)
            },
            _ => None,
        }
    }

    /// Retrieve the first child string scalar matching a key name.
    pub fn get_str(&self, key: &str) -> Option<&str> {
        match self.get(key) {
            Some(Self::Str(s)) => Some(s.as_str()),
            _ => None,
        }
    }

    /// Retrieve a nested table slice matching a key name.
    pub fn get_table(&self, key: &str) -> Option<&[(String, VdfValue)]> {
        match self.get(key) {
            Some(Self::Table(entries)) => Some(entries.as_slice()),
            _ => None,
        }
    }

    /// Retrieve a child scalar parsed as an unsigned 64-bit integer.
    pub fn get_u64(&self, key: &str) -> Option<u64> {
        self.get_str(key).and_then(|s| s.parse::<u64>().ok())
    }

    /// Retrieve a child scalar parsed as a signed 64-bit integer.
    pub fn get_i64(&self, key: &str) -> Option<i64> {
        self.get_str(key).and_then(|s| s.parse::<i64>().ok())
    }

    /// Traverse a nested path of keys (e.g. `&["AppState", "UserConfig", "language"]`).
    pub fn get_path(&self, keys: &[&str]) -> Option<&VdfValue> {
        let mut cur = self;
        for &k in keys {
            cur = cur.get(k)?;
        }
        Some(cur)
    }

    /// Iterate over key-value pairs if this value is a table.
    pub fn entries(&self) -> Option<&[(String, VdfValue)]> {
        match self {
            Self::Table(entries) => Some(entries.as_slice()),
            Self::Str(_) => None,
        }
    }

    /// Render this VDF tree back into formatted KeyValues text.
    pub fn to_vdf_string(&self) -> String {
        let mut out = String::new();
        render_vdf_node(self, 0, &mut out);
        out
    }
}

fn render_vdf_node(node: &VdfValue, indent: usize, out: &mut String) {
    let pad = "\t".repeat(indent);
    match node {
        VdfValue::Str(s) => {
            out.push_str(&format!("\"{s}\"\n"));
        },
        VdfValue::Table(entries) => {
            for (k, v) in entries {
                match v {
                    VdfValue::Str(val_str) => {
                        out.push_str(&format!("{pad}\"{k}\"\t\t\"{val_str}\"\n"));
                    },
                    VdfValue::Table(_) => {
                        out.push_str(&format!("{pad}\"{k}\"\n{pad}{{\n"));
                        render_vdf_node(v, indent + 1, out);
                        out.push_str(&format!("{pad}}}\n"));
                    },
                }
            }
        },
    }
}

/// Token in the VDF lexical stream.
#[derive(Debug, PartialEq, Eq)]
enum VdfToken {
    String(String),
    OpenBrace,
    CloseBrace,
}

struct VdfLexer<'a> {
    chars: std::iter::Peekable<std::str::CharIndices<'a>>,
    input: &'a str,
    line: usize,
    col: usize,
}

impl<'a> VdfLexer<'a> {
    fn new(input: &'a str) -> Self {
        Self { chars: input.char_indices().peekable(), input, line: 1, col: 1 }
    }

    fn next_token(&mut self) -> Result<Option<(VdfToken, usize, usize)>, SteamError> {
        {
            self.skip_whitespace_and_comments()?;

            let token_line = self.line;
            let token_col = self.col;

            let Some(&(start_idx, ch)) = self.chars.peek() else {
                return Ok(None);
            };

            match ch {
                '{' => {
                    self.bump();
                    Ok(Some((VdfToken::OpenBrace, token_line, token_col)))
                },
                '}' => {
                    self.bump();
                    Ok(Some((VdfToken::CloseBrace, token_line, token_col)))
                },
                '"' => {
                    // Quoted string
                    self.bump(); // consume opening quote
                    let mut s = String::new();
                    let mut escaped = false;

                    while let Some((_, c)) = self.bump() {
                        if escaped {
                            match c {
                                'n' => s.push('\n'),
                                'r' => s.push('\r'),
                                't' => s.push('\t'),
                                '\\' => s.push('\\'),
                                '"' => s.push('"'),
                                other => s.push(other),
                            }
                            escaped = false;
                        } else if c == '\\' {
                            escaped = true;
                        } else if c == '"' {
                            return Ok(Some((VdfToken::String(s), token_line, token_col)));
                        } else {
                            s.push(c);
                        }
                    }

                    Err(SteamError::VdfParse {
                        line: token_line,
                        col: token_col,
                        message: "unclosed quoted string in VDF".to_string(),
                    })
                },
                _ => {
                    // Bare / unquoted identifier
                    let mut end_idx = start_idx;
                    while let Some(&(idx, c)) = self.chars.peek() {
                        if c.is_whitespace() || c == '{' || c == '}' || c == '"' {
                            break;
                        }
                        end_idx = idx + c.len_utf8();
                        self.bump();
                    }

                    let bare = &self.input[start_idx..end_idx];
                    Ok(Some((VdfToken::String(bare.to_string()), token_line, token_col)))
                },
            }
        }
    }

    fn bump(&mut self) -> Option<(usize, char)> {
        let item = self.chars.next();
        if let Some((_, c)) = item {
            if c == '\n' {
                self.line += 1;
                self.col = 1;
            } else {
                self.col += 1;
            }
        }
        item
    }

    fn skip_whitespace_and_comments(&mut self) -> Result<(), SteamError> {
        loop {
            // Skip whitespace
            while let Some(&(_, c)) = self.chars.peek() {
                if c.is_whitespace() {
                    self.bump();
                } else {
                    break;
                }
            }

            // Check for line comment //
            if let Some(&(idx, '/')) = self.chars.peek() {
                let rest = &self.input[idx..];
                if rest.starts_with("//") {
                    // Consume until newline
                    while let Some((_, c)) = self.bump() {
                        if c == '\n' {
                            break;
                        }
                    }
                    continue;
                }
            }

            break;
        }
        Ok(())
    }
}

/// Parse a raw Valve Data Format string into a [`VdfValue`].
pub fn parse_vdf(input: &str) -> Result<VdfValue, SteamError> {
    let mut lexer = VdfLexer::new(input);
    let mut entries = Vec::new();

    while let Some((token, line, col)) = lexer.next_token()? {
        match token {
            VdfToken::String(key) => {
                let val = parse_vdf_value(&mut lexer, line, col)?;
                entries.push((key, val));
            },
            VdfToken::CloseBrace => {
                return Err(SteamError::VdfParse {
                    line,
                    col,
                    message: "unexpected closing brace at top level".to_string(),
                });
            },
            VdfToken::OpenBrace => {
                return Err(SteamError::VdfParse {
                    line,
                    col,
                    message: "unexpected opening brace without key".to_string(),
                });
            },
        }
    }

    Ok(VdfValue::Table(entries))
}

fn parse_vdf_value(
    lexer: &mut VdfLexer<'_>,
    key_line: usize,
    key_col: usize,
) -> Result<VdfValue, SteamError> {
    let Some((token, line, col)) = lexer.next_token()? else {
        return Err(SteamError::VdfParse {
            line: key_line,
            col: key_col,
            message: "unexpected end of file after key".to_string(),
        });
    };

    match token {
        VdfToken::String(val_str) => Ok(VdfValue::Str(val_str)),
        VdfToken::OpenBrace => {
            let mut entries = Vec::new();
            while let Some((inner_token, inner_line, inner_col)) = lexer.next_token()? {
                match inner_token {
                    VdfToken::String(k) => {
                        let v = parse_vdf_value(lexer, inner_line, inner_col)?;
                        entries.push((k, v));
                    },
                    VdfToken::CloseBrace => {
                        return Ok(VdfValue::Table(entries));
                    },
                    VdfToken::OpenBrace => {
                        return Err(SteamError::VdfParse {
                            line: inner_line,
                            col: inner_col,
                            message: "unexpected opening brace inside table".to_string(),
                        });
                    },
                }
            }
            Err(SteamError::VdfParse {
                line,
                col,
                message: "unclosed table brace in VDF".to_string(),
            })
        },
        VdfToken::CloseBrace => Err(SteamError::VdfParse {
            line,
            col,
            message: "unexpected closing brace when expecting value".to_string(),
        }),
    }
}

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
                if root.get("appid").is_some() { Some(root) } else { None }
            })
            .ok_or_else(|| SteamError::MalformedAcf("missing 'AppState' section".to_string()))?;

        let app_id = app_state
            .get_u64("appid")
            .ok_or_else(|| SteamError::MalformedAcf("missing or invalid 'appid'".to_string()))?
            as u32;

        let name = app_state.get_str("name").unwrap_or_default().to_string();

        let install_dir = app_state.get_str("installdir").unwrap_or_default().to_string();

        let state_flags = app_state.get_u64("StateFlags").unwrap_or(0);
        let size_on_disk = app_state
            .get_u64("SizeOnDisk")
            .or_else(|| app_state.get_u64("size_on_disk"))
            .unwrap_or(0);
        let build_id =
            app_state.get_u64("buildid").or_else(|| app_state.get_u64("build_id")).unwrap_or(0);
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
    find_steam_installations().into_iter().next().map(|i| i.root_path)
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
            let file_name = path.file_name().and_then(|n| n.to_str()).unwrap_or_default();
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

// ---------------------------------------------------------------------------
// Steam DRM & SteamStub Detection
// ---------------------------------------------------------------------------

/// Forensic assessment report for Steam DRM and SteamStub protection.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SteamDrmReport {
    /// Binary format classified by goblin (e.g. `"PE32+"`, `"PE32"`, `"ELF64"`, `"Unknown"`).
    pub format: String,
    /// High-confidence detection of the SteamStub executable wrapper.
    pub is_steamstub_detected: bool,
    /// Presence of the `.bind` section (characteristic SteamStub entry vector).
    pub has_bind_section: bool,
    /// Presence of the `.steam` section (legacy SteamStub / DRM marker).
    pub has_steam_section: bool,
    /// Whether the binary entry point RVA falls directly inside the `.bind` section.
    pub entry_point_in_bind: bool,
    /// Relative Virtual Address (RVA) of `.bind` section if present.
    pub bind_section_rva: Option<u64>,
    /// Virtual size of `.bind` section in bytes.
    pub bind_section_size: Option<u64>,
    /// Shannon entropy of the primary executable `.text` code section.
    pub text_entropy: Option<f64>,
    /// Whether `.text` exhibits abnormally high entropy (> 7.2), indicating encrypted/compressed payload.
    pub is_text_encrypted: bool,
    /// Whether the binary imports Steamworks API (`steam_api.dll`, `steam_api64.dll`, `libsteam_api.so`).
    pub steam_api_dependency: bool,
    /// Specific Steam API library name detected in imports.
    pub steam_api_library: Option<String>,
    /// Detected Steamworks API function symbols (e.g. `SteamAPI_Init`, `SteamAPI_RestartAppIfNecessary`).
    pub steamworks_symbols: Vec<String>,
    /// Human-readable diagnostic assessment summary.
    pub summary: String,
}

/// Known Steamworks API function signatures scanned in import tables and string pools.
const STEAMWORKS_API_SYMBOLS: &[&str] = &[
    "SteamAPI_Init",
    "SteamAPI_InitFlat",
    "SteamAPI_RestartAppIfNecessary",
    "SteamAPI_Shutdown",
    "SteamAPI_RunCallbacks",
    "SteamAPI_RegisterCallback",
    "SteamAPI_UnregisterCallback",
    "SteamInternal_CreateInterface",
    "SteamGameServer_Init",
    "SteamGameServer_Shutdown",
];

/// Known Steamworks DLL and SO library file names.
const STEAM_API_LIBRARIES: &[&str] =
    &["steam_api.dll", "steam_api64.dll", "libsteam_api.so", "libsteam_api.dylib"];

/// Inspect executable binary bytes for Steam DRM, SteamStub wrapper sections, and Steamworks API hooks.
pub fn inspect_steam_drm(bytes: &[u8]) -> Result<SteamDrmReport, SteamError> {
    let mut format = "Unknown".to_string();
    let mut has_bind_section = false;
    let mut has_steam_section = false;
    let mut entry_point_in_bind = false;
    let mut bind_section_rva = None;
    let mut bind_section_size = None;
    let mut text_entropy = None;
    let mut steam_api_dependency = false;
    let mut steam_api_library = None;
    let mut steamworks_symbols = Vec::new();

    // Parse with goblin PE / ELF
    if let Ok(pe) = goblin::pe::PE::parse(bytes) {
        format = if pe.is_64 { "PE32+".to_string() } else { "PE32".to_string() };

        let entry_point = pe.entry as u64;

        // Inspect sections
        for section in &pe.sections {
            let name = section.name().unwrap_or_default();
            let sec_rva = section.virtual_address as u64;
            let sec_size = section.virtual_size as u64;

            if name == ".bind" {
                has_bind_section = true;
                bind_section_rva = Some(sec_rva);
                bind_section_size = Some(sec_size);

                if entry_point >= sec_rva && entry_point < sec_rva.saturating_add(sec_size) {
                    entry_point_in_bind = true;
                }
            } else if name == ".steam" {
                has_steam_section = true;
            } else if name == ".text" {
                let offset = section.pointer_to_raw_data as usize;
                let size = section.size_of_raw_data as usize;
                if offset + size <= bytes.len() {
                    let entropy = crate::shannon_entropy(&bytes[offset..offset + size]);
                    text_entropy = Some(entropy);
                }
            }
        }

        // Inspect PE imported libraries
        for lib in &pe.libraries {
            let lib_lower = lib.to_ascii_lowercase();
            for &target in STEAM_API_LIBRARIES {
                if lib_lower == target {
                    steam_api_dependency = true;
                    steam_api_library = Some(target.to_string());
                    break;
                }
            }
        }

        // Inspect PE imported symbols
        for import in &pe.imports {
            let sym_name = import.name.as_ref();
            for &target_sym in STEAMWORKS_API_SYMBOLS {
                if sym_name == target_sym && !steamworks_symbols.iter().any(|s| s == target_sym) {
                    steamworks_symbols.push(target_sym.to_string());
                }
            }
        }
    } else if let Ok(elf) = goblin::elf::Elf::parse(bytes) {
        format = if elf.is_64 { "ELF64".to_string() } else { "ELF32".to_string() };

        // Inspect section headers for .bind / .steam
        for sh in &elf.section_headers {
            if let Some(name) = elf.shdr_strtab.get_at(sh.sh_name) {
                if name == ".bind" {
                    has_bind_section = true;
                } else if name == ".steam" {
                    has_steam_section = true;
                } else if name == ".text" {
                    let offset = sh.sh_offset as usize;
                    let size = sh.sh_size as usize;
                    if offset + size <= bytes.len() {
                        text_entropy = Some(crate::shannon_entropy(&bytes[offset..offset + size]));
                    }
                }
            }
        }

        // Inspect dynamic DT_NEEDED dependencies
        for lib in &elf.libraries {
            if *lib == "libsteam_api.so" {
                steam_api_dependency = true;
                steam_api_library = Some("libsteam_api.so".to_string());
            }
        }

        // Inspect dynamic symbols
        for sym in &elf.dynsyms {
            if let Some(sym_name) = elf.dynstrtab.get_at(sym.st_name) {
                for &target_sym in STEAMWORKS_API_SYMBOLS {
                    if sym_name == target_sym && !steamworks_symbols.iter().any(|s| s == target_sym)
                    {
                        steamworks_symbols.push(target_sym.to_string());
                    }
                }
            }
        }
    }

    // Fallback string search if imports were stripped or static
    if !steam_api_dependency {
        for &target in STEAM_API_LIBRARIES {
            if contains_subslice(bytes, target.as_bytes()) {
                steam_api_dependency = true;
                steam_api_library = Some(target.to_string());
                break;
            }
        }
    }

    if steamworks_symbols.is_empty() {
        for &sym in STEAMWORKS_API_SYMBOLS {
            if contains_subslice(bytes, sym.as_bytes()) {
                steamworks_symbols.push(sym.to_string());
            }
        }
    }

    let is_text_encrypted = text_entropy.map(|h| h >= 7.2).unwrap_or(false);

    // SteamStub is detected if .bind exists and entry point is inside .bind,
    // or if .bind section exists alongside high text entropy
    let is_steamstub_detected =
        (has_bind_section && entry_point_in_bind) || (has_bind_section && is_text_encrypted);

    let summary = if is_steamstub_detected {
        format!(
            "SteamStub wrapper detected: .bind section present (RVA {:#x}), entry in .bind: {}, text entropy: {:.2}",
            bind_section_rva.unwrap_or(0),
            entry_point_in_bind,
            text_entropy.unwrap_or(0.0)
        )
    } else if steam_api_dependency {
        format!(
            "Steamworks API integrated ({}), {} Steam API symbols detected",
            steam_api_library.as_deref().unwrap_or("unknown"),
            steamworks_symbols.len()
        )
    } else {
        "No Steam DRM or Steamworks API hooks detected".to_string()
    };

    Ok(SteamDrmReport {
        format,
        is_steamstub_detected,
        has_bind_section,
        has_steam_section,
        entry_point_in_bind,
        bind_section_rva,
        bind_section_size,
        text_entropy,
        is_text_encrypted,
        steam_api_dependency,
        steam_api_library,
        steamworks_symbols,
        summary,
    })
}

fn contains_subslice(haystack: &[u8], needle: &[u8]) -> bool {
    haystack.windows(needle.len()).any(|w| w == needle)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

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
        assert_eq!(manifest.user_config.get("language").map(|s| s.as_str()), Some("english"));
    }

    #[test]
    fn test_vdf_libraryfolders_parsing() {
        let vdf_text = r#"
        "libraryfolders"
        {
            "0"
            {
                "path"         "/home/user/.local/share/Steam"
                "label"        ""
                "contentid"    "123456789"
                "totalsize"    "500000000000"
                "apps"
                {
                    "730"      "35000000000"
                    "570"      "45000000000"
                }
            }
            "1"
            {
                "path"         "/mnt/games/SteamLibrary"
                "label"        "GamesSSD"
                "totalsize"    "1000000000000"
                "apps"
                {
                    "1091500"  "75000000000"
                }
            }
        }
        "#;

        let parsed = parse_vdf(vdf_text).expect("libraryfolders should parse");
        let root = parsed.get("libraryfolders").expect("libraryfolders table");

        let lib0 = root.get("0").expect("folder 0");
        assert_eq!(lib0.get_str("path"), Some("/home/user/.local/share/Steam"));
        assert_eq!(lib0.get_u64("totalsize"), Some(500000000000));

        let lib1 = root.get("1").expect("folder 1");
        assert_eq!(lib1.get_str("path"), Some("/mnt/games/SteamLibrary"));
        assert_eq!(lib1.get_str("label"), Some("GamesSSD"));
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
    fn test_steam_drm_inspection_on_synthetic_binary() {
        // Build a synthetic byte buffer containing Steamworks API strings
        let mut bin = Vec::new();
        bin.extend_from_slice(b"SOME_HEADER_DATA_PADDING");
        bin.extend_from_slice(b"steam_api64.dll\0");
        bin.extend_from_slice(b"SteamAPI_Init\0");
        bin.extend_from_slice(b"SteamAPI_RestartAppIfNecessary\0");
        bin.extend_from_slice(b"MORE_DATA_TRAILING");

        let report = inspect_steam_drm(&bin).expect("drm triage");
        assert!(report.steam_api_dependency);
        assert_eq!(report.steam_api_library, Some("steam_api64.dll".to_string()));
        assert!(report.steamworks_symbols.contains(&"SteamAPI_Init".to_string()));
        assert!(report.steamworks_symbols.contains(&"SteamAPI_RestartAppIfNecessary".to_string()));
        assert!(!report.is_steamstub_detected);
    }

    #[test]
    fn test_vdf_parser_comments_and_escapes() {
        let vdf_text = r#"
        // Top-level comment
        "RootNode"
        {
            // Comment inside block
            "quoted_key"    "quoted \"escaped\" value\nwith newline"
            bare_key        bare_value // inline comment
            "path_key"      "C:\\Program Files (x86)\\Steam"
        }
        "#;

        let parsed = parse_vdf(vdf_text).expect("parse with comments and escapes");
        let root = parsed.get("RootNode").expect("RootNode");

        assert_eq!(root.get_str("quoted_key"), Some("quoted \"escaped\" value\nwith newline"));
        assert_eq!(root.get_str("bare_key"), Some("bare_value"));
        assert_eq!(root.get_str("path_key"), Some("C:\\Program Files (x86)\\Steam"));
    }

    #[test]
    fn test_vdf_error_reporting() {
        let unclosed_quote = "\"AppState\" { \"name\" \"unclosed string }";
        assert!(matches!(parse_vdf(unclosed_quote), Err(SteamError::VdfParse { .. })));

        let unexpected_brace = "}";
        assert!(matches!(parse_vdf(unexpected_brace), Err(SteamError::VdfParse { .. })));
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

        let cs2 = games.iter().find(|g| g.manifest.app_id == 730).expect("find cs2");
        assert_eq!(cs2.manifest.name, "Counter-Strike 2");
        assert!(cs2.exists_on_disk);
        assert_eq!(cs2.install_path, root_common);

        let cp = games.iter().find(|g| g.manifest.app_id == 1091500).expect("find cyberpunk");
        assert_eq!(cp.manifest.name, "Cyberpunk 2077");
        assert!(cp.exists_on_disk);
        assert_eq!(cp.install_path, sec_common);
    }

    #[test]
    fn test_steam_drm_pe_bind_section_detection() {
        // Construct a synthetic minimal PE32+ with .text and .bind sections
        // Entry point is set inside the .bind section
        let mut pe = vec![0u8; 4096];

        // DOS header
        pe[0] = b'M';
        pe[1] = b'Z';
        let pe_offset = 0x80usize;
        pe[0x3C..0x40].copy_from_slice(&(pe_offset as u32).to_le_bytes());

        // PE signature
        pe[pe_offset..pe_offset + 4].copy_from_slice(b"PE\0\0");

        // COFF header (offset 0x84, 20 bytes)
        let coff = pe_offset + 4;
        pe[coff..coff + 2].copy_from_slice(&0x8664u16.to_le_bytes()); // Machine: x86_64
        pe[coff + 2..coff + 4].copy_from_slice(&2u16.to_le_bytes()); // 2 sections (.text, .bind)
        let opt_hdr_size = 240u16; // Standard PE32+ optional header size
        pe[coff + 16..coff + 18].copy_from_slice(&opt_hdr_size.to_le_bytes());
        pe[coff + 18..coff + 20].copy_from_slice(&0x0022u16.to_le_bytes()); // Characteristics: EXECUTABLE_IMAGE | LARGE_ADDRESS_AWARE

        // Optional Header PE32+ (offset 0x98, 240 bytes)
        let opt = coff + 20;
        pe[opt..opt + 2].copy_from_slice(&0x020Bu16.to_le_bytes()); // PE32+ magic
        // AddressOfEntryPoint at opt + 16: set to 0x2050 (inside .bind which is at RVA 0x2000..0x3000)
        pe[opt + 16..opt + 20].copy_from_slice(&0x2050u32.to_le_bytes());
        // SectionAlignment and FileAlignment
        pe[opt + 32..opt + 36].copy_from_slice(&0x1000u32.to_le_bytes()); // SectionAlignment
        pe[opt + 36..opt + 40].copy_from_slice(&0x200u32.to_le_bytes()); // FileAlignment
        pe[opt + 56..opt + 60].copy_from_slice(&0x4000u32.to_le_bytes()); // SizeOfImage
        pe[opt + 60..opt + 64].copy_from_slice(&0x400u32.to_le_bytes()); // SizeOfHeaders

        // Section Headers (offset opt + opt_hdr_size, 40 bytes each)
        let sec_table = opt + (opt_hdr_size as usize);

        // Section 1: .text
        // Name: ".text\0\0\0"
        pe[sec_table..sec_table + 8].copy_from_slice(b".text\0\0\0");
        pe[sec_table + 8..sec_table + 12].copy_from_slice(&0x1000u32.to_le_bytes()); // VirtualSize: 0x1000
        pe[sec_table + 12..sec_table + 16].copy_from_slice(&0x1000u32.to_le_bytes()); // VirtualAddress: 0x1000
        pe[sec_table + 16..sec_table + 20].copy_from_slice(&0x200u32.to_le_bytes()); // SizeOfRawData: 0x200
        pe[sec_table + 20..sec_table + 24].copy_from_slice(&0x400u32.to_le_bytes()); // PointerToRawData: 0x400
        pe[sec_table + 36..sec_table + 40].copy_from_slice(&0x60000020u32.to_le_bytes()); // Characteristics: CODE | EXECUTE | READ

        // Fill .text raw data with high-entropy pseudo-random pattern (simulating encrypted code)
        for (idx, slot) in pe[0x400..0x600].iter_mut().enumerate() {
            *slot = (((0x400 + idx) * 101 + 37) & 0xFF) as u8;
        }

        // Section 2: .bind (SteamStub stub section)
        let sec2 = sec_table + 40;
        pe[sec2..sec2 + 8].copy_from_slice(b".bind\0\0\0");
        pe[sec2 + 8..sec2 + 12].copy_from_slice(&0x1000u32.to_le_bytes()); // VirtualSize: 0x1000
        pe[sec2 + 12..sec2 + 16].copy_from_slice(&0x2000u32.to_le_bytes()); // VirtualAddress: 0x2000
        pe[sec2 + 16..sec2 + 20].copy_from_slice(&0x200u32.to_le_bytes()); // SizeOfRawData: 0x200
        pe[sec2 + 20..sec2 + 24].copy_from_slice(&0x600u32.to_le_bytes()); // PointerToRawData: 0x600
        pe[sec2 + 36..sec2 + 40].copy_from_slice(&0xE0000020u32.to_le_bytes()); // Characteristics: CODE | EXECUTE | READ | WRITE

        let report = inspect_steam_drm(&pe).expect("inspect steam drm");
        assert_eq!(report.format, "PE32+");
        assert!(report.has_bind_section);
        assert!(report.entry_point_in_bind);
        assert_eq!(report.bind_section_rva, Some(0x2000));
        assert!(report.is_steamstub_detected);
        assert!(report.summary.contains("SteamStub wrapper detected"));
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
