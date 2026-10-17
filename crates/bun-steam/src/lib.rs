// SPDX-License-Identifier: Apache-2.0
//! Canonical Steam owner of Bun OS (Rust half; the Bun half is `packages/bun-steam`).
//!
//! - [`vdf`]: text KeyValues parser/writer, binary KeyValues parser/writer (`shortcuts.vdf`),
//!   `appinfo.vdf` / `packageinfo.vdf` readers. Pure and `wasm32`-friendly.
//! - [`install`]: Steam install discovery, `libraryfolders.vdf`, `appmanifest_*.acf`, library
//!   and installed-game scans.
//! - [`config`]: client configuration across hosts: `loginusers.vdf` (account names and flags
//!   only), `config.vdf` `CompatToolMapping`, cached-session presence (`ConnectCache`, as a
//!   boolean), `HKCU\Software\Valve\Steam` on Windows and `registry.vdf` on Linux.
//! - [`proton`]: compatibility tool discovery and the Proton launch environment (ntsync,
//!   DXVK / vkd3d-proton / Mesa caches, llvmpipe threads, gamemode, official anti-cheat runtimes).
//! - [`remote_play`]: Remote Play paired clients (`remoteclients.vdf`) without secrets.
//! - [`launch`]: `steam://` URIs.
//! - [`depot`]: depot planning (always) and, with feature `depot`, the native CM depot client.
//! - `emulator` (feature `emulator`): in-process Steamworks API emulator.
//!
//! Credential policy: nothing in this crate prompts for, logs or prints a password or token value.
//! The `depot` client keeps its pre-existing per-account refresh-token cache; every other module
//! only reports whether cached material exists.

use thiserror::Error;

pub mod config;
pub mod depot;
#[cfg(feature = "emulator")]
pub mod emulator;
pub mod install;
pub mod launch;
pub mod proton;
pub mod remote_play;
pub mod vdf;

#[cfg(feature = "emulator")]
pub use emulator::{FriendRecord, PersonaState, SteamApiEmulator, SteamLobbyRecord};
pub use install::{
    AppManifest, InstalledGame, SteamInstallation, SteamLibrary, SteamPlatform, find_steam_dir,
    find_steam_installations, list_installed_games, probe_steam_installation,
    scan_manifests_in_steamapps, scan_steam_libraries, state_flags,
};
pub use vdf::{BinValue, VdfValue, parse_binary_vdf, parse_vdf, write_binary_vdf};

/// Steam app ID of Inazuma Eleven: Victory Road (LEVEL5). `3593770` is a decoy (name collision).
pub const IEVR_STEAM_APP_ID: u32 = 2_799_860;

/// Errors produced by the Steam owner.
#[derive(Debug, Error)]
pub enum SteamError {
    /// Standard filesystem I/O error.
    #[error("filesystem I/O error: {0}")]
    Io(#[from] std::io::Error),

    /// Syntax or structure error encountered while parsing VDF / KeyValues text.
    #[error("VDF parse error at line {line}, col {col}: {message}")]
    VdfParse {
        /// 1-based line.
        line: usize,
        /// 1-based column.
        col: usize,
        /// Description.
        message: String,
    },

    /// Malformed binary KeyValues, `appinfo.vdf` or `packageinfo.vdf`.
    #[error("binary VDF error at offset {offset}: {message}")]
    BinaryVdf {
        /// Byte offset.
        offset: usize,
        /// Description.
        message: String,
    },

    /// Malformed `appmanifest_<appid>.acf` document.
    #[error("malformed AppManifest ACF: {0}")]
    MalformedAcf(String),

    /// Missing or inaccessible Steam installation or file.
    #[error("Steam installation not found at '{0}'")]
    NotFound(String),

    /// Windows registry access failed.
    #[error("registry: {0}")]
    Registry(String),
}
