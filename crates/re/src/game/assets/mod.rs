// SPDX-License-Identifier: Apache-2.0
//! Game-agnostic asset pipeline (feature `assets`): detect the engine of any installed game,
//! mount its archives into one virtual file system, index it, convert its content to open
//! formats and serve it. The CLI surface is `bunre game` (native) and `re game` (Bun: Steam
//! resolution, `bun:sqlite` index, HTTP API).
//!
//! Layers, from bytes to files:
//!
//! - [`source`]: positioned reads over a local file;
//! - [`archive`]: one reader per container family — CRI CPK (canonical `aphrody-nie-formats`
//!   reader), Unreal `.pak` and IoStore `.utoc`/`.ucas`, UnityFS bundles, Godot `.pck`,
//!   Ren'Py `.rpa`, ZIP;
//! - [`engine`]: bounded, evidence-based engine detection over an install directory;
//! - [`profile`]: per-game profiles (mount order, key policy, owner delegation);
//! - [`vfs`]: [`vfs::GameVfs`], the mounted view (first mounted path wins, loose files last);
//! - [`classify`]: extension and magic classification into asset kinds;
//! - [`export`]: conversions to PNG, WAV, glTF binary, MP4/WebM and JSON, and bounded
//!   stratified batch export.
//!
//! Key policy: the generic layer never embeds a key. Encrypted containers are listed and
//! refused unless the user supplies the key at run time. Inazuma Eleven: Victory Road is
//! mounted through its own owner (`aphrody-nie-formats`, IEVR profile only); no other title
//! reaches that owner's key material.
//!
//! Out of scope by design: anti-cheat files are reported by [`engine`] but never mounted or
//! modified, nothing reads or writes the memory of a running game, and nothing talks to game
//! servers.

pub mod archive;
pub mod classify;
pub mod engine;
pub mod export;
pub mod profile;
pub mod source;
pub mod vfs;

use thiserror::Error;

/// Errors of the asset pipeline.
#[derive(Debug, Error)]
pub enum AssetError {
    /// Filesystem error on a named path.
    #[error("I/O error on {path}: {source}")]
    Io {
        /// Path or archive label.
        path: String,
        /// Underlying error.
        source: std::io::Error,
    },
    /// Malformed or truncated container or asset.
    #[error("{format}: {details}")]
    Format {
        /// Format family (`unreal-pak`, `cpk`, ...).
        format: &'static str,
        /// Description.
        details: String,
    },
    /// The content is encrypted and no user-provided key was supplied.
    #[error("{0} is encrypted: supply the key yourself (--aes-key / BUNRE_GAME_AES_KEY, --hca-key)")]
    KeyRequired(String),
    /// A known but unsupported variant (proprietary codec, legacy layout).
    #[error("unsupported: {0}")]
    Unsupported(String),
    /// Path absent from the mounted view.
    #[error("not found: {0}")]
    NotFound(String),
}

/// Result alias of the asset pipeline.
pub type AssetResult<T> = Result<T, AssetError>;

pub(crate) fn format_err(format: &'static str, details: impl Into<String>) -> AssetError {
    AssetError::Format { format, details: details.into() }
}

/// User-provided decryption material for one run. Never persisted, never printed.
#[derive(Clone, Default)]
pub struct Keys {
    /// AES-256 key for Unreal `.pak`/IoStore containers.
    pub aes: Option<[u8; 32]>,
    /// CRI HCA key (`ciph_type` 56).
    pub hca: Option<u64>,
}

impl std::fmt::Debug for Keys {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Keys")
            .field("aes", &self.aes.is_some())
            .field("hca", &self.hca.is_some())
            .finish()
    }
}

impl Keys {
    /// Parse a 32-byte AES key given as 64 hexadecimal digits (an optional `0x` prefix is
    /// accepted).
    ///
    /// # Errors
    /// Returns a message when the text is not exactly 32 bytes of hexadecimal.
    pub fn parse_aes(text: &str) -> Result<[u8; 32], String> {
        let clean = text.trim().trim_start_matches("0x").trim_start_matches("0X");
        let bytes = hex::decode(clean).map_err(|_| "AES key must be hexadecimal".to_string())?;
        bytes.try_into().map_err(|_| "AES key must be 32 bytes (64 hex digits)".to_string())
    }

    /// Parse an HCA key given in decimal or `0x` hexadecimal.
    ///
    /// # Errors
    /// Returns a message when the text is not a 64-bit integer.
    pub fn parse_hca(text: &str) -> Result<u64, String> {
        let text = text.trim();
        let parsed = match text.strip_prefix("0x").or_else(|| text.strip_prefix("0X")) {
            Some(hex) => u64::from_str_radix(hex, 16),
            None => text.parse(),
        };
        parsed.map_err(|_| "HCA key must be a 64-bit integer".to_string())
    }

    /// Keys from the environment (`BUNRE_GAME_AES_KEY`, `BUNRE_GAME_HCA_KEY`).
    ///
    /// # Errors
    /// Returns a message when a variable is set but malformed.
    pub fn from_env() -> Result<Self, String> {
        let mut keys = Self::default();
        if let Ok(value) = std::env::var("BUNRE_GAME_AES_KEY")
            && !value.trim().is_empty()
        {
            keys.aes = Some(Self::parse_aes(&value)?);
        }
        if let Ok(value) = std::env::var("BUNRE_GAME_HCA_KEY")
            && !value.trim().is_empty()
        {
            keys.hca = Some(Self::parse_hca(&value)?);
        }
        Ok(keys)
    }
}

/// Normalise a container path: `/` separators, no leading `./`, `/` or `../` segments.
#[must_use]
pub fn normalize_path(path: &str) -> String {
    let unified = path.replace('\\', "/");
    let mut parts: Vec<&str> = Vec::new();
    for part in unified.split('/') {
        match part {
            "" | "." => {},
            ".." => {
                parts.pop();
            },
            other => parts.push(other),
        }
    }
    parts.join("/")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_mount_points_and_separators() {
        assert_eq!(normalize_path("../../../Game/Content/a.uasset"), "Game/Content/a.uasset");
        assert_eq!(normalize_path(".\\data\\common/x.g4tx"), "data/common/x.g4tx");
    }

    #[test]
    fn parses_user_keys() {
        assert!(Keys::parse_aes(&"ab".repeat(32)).is_ok());
        assert!(Keys::parse_aes("abcd").is_err());
        assert_eq!(Keys::parse_hca("0x10").unwrap(), 16);
        assert_eq!(Keys::parse_hca("42").unwrap(), 42);
        assert!(!format!("{:?}", Keys { aes: Some([1; 32]), hca: None }).contains('1'));
    }
}
