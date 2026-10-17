// SPDX-License-Identifier: Apache-2.0
//! The persistent sync state: one byte offset + head fingerprint per source
//! file, and the committed length of every mirror file.

use std::{
    collections::BTreeMap,
    fs::{self, File},
    io::{self, Read, Write},
    path::Path,
};

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use super::{AgentKind, SyncError};

/// Current [`SyncState::version`].
const STATE_VERSION: u32 = 1;

/// How many leading bytes of a source the fingerprint covers.
pub(super) const HEAD_BYTES: u64 = 1024;

/// What has been ingested so far.
///
/// Keys of `sources` are absolute source paths; keys of `mirrors` are mirror
/// paths relative to the output directory, with `/` separators, so the output
/// directory can be moved as a whole.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SyncState {
    /// Format version.
    pub version: u32,
    /// Per-source progress.
    #[serde(default)]
    pub sources: BTreeMap<String, SourceState>,
    /// Committed length of each mirror file, in bytes.
    #[serde(default)]
    pub mirrors: BTreeMap<String, u64>,
}

impl Default for SyncState {
    fn default() -> Self {
        Self {
            version: STATE_VERSION,
            sources: BTreeMap::new(),
            mirrors: BTreeMap::new(),
        }
    }
}

/// Progress of one source transcript.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SourceState {
    /// The agent that writes the source.
    pub agent: AgentKind,
    /// Session id the mirror is keyed by (stable once assigned).
    pub session_id: String,
    /// Workspace, once known.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub workspace: Option<String>,
    /// Bytes of the source ingested (always the end of a complete line).
    pub offset: u64,
    /// Length of the fingerprinted head.
    #[serde(default)]
    pub head_len: u64,
    /// FNV-1a 64 of the first `head_len` bytes, as 16 hex digits.
    #[serde(default)]
    pub head_fnv: String,
    /// Mirror path relative to the output directory.
    pub mirror: String,
    /// Records this source has contributed so far.
    #[serde(default)]
    pub records: u64,
    /// When this entry was last committed.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub updated_at: Option<DateTime<Utc>>,
}

impl SyncState {
    /// Load the state at `path`; a missing file is an empty state.
    ///
    /// # Errors
    ///
    /// [`SyncError::Io`] when the file cannot be read and
    /// [`SyncError::CorruptState`] when it is not a valid state.
    pub fn load(path: &Path) -> Result<Self, SyncError> {
        let raw = match fs::read(path) {
            Ok(raw) => raw,
            Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(Self::default()),
            Err(error) => return Err(SyncError::io(path)(error)),
        };
        serde_json::from_slice(&raw).map_err(|source| SyncError::CorruptState {
            path: path.to_path_buf(),
            source,
        })
    }

    /// Write the state to `path` atomically (temporary file, `fsync`, rename).
    ///
    /// # Errors
    ///
    /// [`SyncError::Io`] / [`SyncError::Json`] on failure; the previous state
    /// file is then left untouched.
    pub fn save(&self, path: &Path) -> Result<(), SyncError> {
        let body = serde_json::to_vec_pretty(self)?;
        let tmp = path.with_extension("json.tmp");
        {
            let mut file = File::create(&tmp).map_err(SyncError::io(&tmp))?;
            file.write_all(&body).map_err(SyncError::io(&tmp))?;
            file.sync_all().map_err(SyncError::io(&tmp))?;
        }
        fs::rename(&tmp, path).map_err(SyncError::io(path))
    }

    /// Sources whose records go to `mirror`.
    pub(super) fn sources_of_mirror<'a>(
        &'a self,
        mirror: &'a str,
    ) -> impl Iterator<Item = &'a String> + 'a {
        self.sources
            .iter()
            .filter(move |(_, entry)| entry.mirror == mirror)
            .map(|(key, _)| key)
    }
}

/// FNV-1a, 64-bit. Stable across Rust releases, unlike `DefaultHasher`, which
/// matters because the digest is persisted.
pub(super) fn fnv1a64(bytes: &[u8]) -> u64 {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for byte in bytes {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    hash
}

/// Fingerprint of the first `len` bytes of `path`: `(bytes actually read,
/// hex digest)`. Fewer bytes than asked means the file is shorter than `len`.
pub(super) fn head_fingerprint(path: &Path, len: u64) -> io::Result<(u64, String)> {
    let mut head = Vec::new();
    File::open(path)?.take(len).read_to_end(&mut head)?;
    Ok((head.len() as u64, format!("{:016x}", fnv1a64(&head))))
}
