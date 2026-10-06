// SPDX-License-Identifier: Apache-2.0
//! Shared seven-file contract and validated revisions for external syncs.
//!
//! Google transport belongs to `@aphrody/google`; this crate owns which
//! documents form the live agent identity and how a revision is validated.

use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::{
    HomeError,
    filenames::BootstrapFile,
    fsutil::sha256_hex,
    guard::WorkspaceGuard,
    revision::{FileDigest, manifest_revision},
    soul::Soul,
};

const CONTRACT: &str = include_str!("../sync-contract.json");

/// Default documents in prompt injection order. This JSON contract is also
/// consumed by the Bun Google transport and Infra watcher.
pub fn sync_defaults() -> Result<Vec<BootstrapFile>, HomeError> {
    let names: Vec<String> = serde_json::from_str(CONTRACT)?;
    if names.len() != 7 {
        return Err(HomeError::SyncContract("expected exactly seven documents".into()));
    }
    let mut files = Vec::with_capacity(7);
    for name in names {
        let file = BootstrapFile::from_basename(&name)
            .filter(|file| file.filename() == name)
            .ok_or_else(|| HomeError::SyncContract(format!("unknown document: {name}")))?;
        if matches!(file, BootstrapFile::Bootstrap | BootstrapFile::Memory) || files.contains(&file)
        {
            return Err(HomeError::SyncContract(format!(
                "duplicate or out-of-scope document: {name}"
            )));
        }
        files.push(file);
    }
    Ok(files)
}

/// A validated Markdown document and its content address.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncDocument {
    /// Basename in the Agent Home root.
    pub filename: String,
    /// BLAKE3 hash of the UTF-8 Markdown bytes.
    pub hash: String,
    /// Original Markdown, retained for memory ingestion.
    pub content: String,
}

/// One coherent local revision of the seven default documents.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncSnapshot {
    /// BLAKE3 hash of ordered filenames and document hashes (stable key used
    /// by the memory and training ledgers).
    pub revision: String,
    /// Runtime-portable revision of the same seven documents: the
    /// [`crate::revision`] `sha256-v1` manifest applied to the documents in
    /// contract order (`<sha256> <size> <filename>\n` per document). Bun
    /// recomputes it natively; see `docs/reference/ai/AGENT-HOME.md`.
    #[serde(default)]
    pub revision_sha256: String,
    /// Validated documents in prompt injection order.
    pub documents: Vec<SyncDocument>,
}

impl SyncSnapshot {
    /// Read and validate the seven default files after a Drive sync.
    /// The guarded read enforces the workspace boundary and 2 MiB file cap.
    pub fn capture(root: impl AsRef<Path>) -> Result<Self, HomeError> {
        let guard = WorkspaceGuard::new(root);
        let mut documents = Vec::with_capacity(7);
        let mut hasher = blake3::Hasher::new();
        for file in sync_defaults()? {
            let name = file.filename();
            let path = guard.resolve(name)?;
            let metadata = std::fs::symlink_metadata(&path).map_err(|e| HomeError::io(&path, e))?;
            if !metadata.file_type().is_file() {
                return Err(HomeError::SyncContract(format!("{name} must be a regular file")));
            }
            let content = guard
                .read_to_string(name)?
                .ok_or_else(|| HomeError::SyncContract(format!("missing document: {name}")))?;
            if content.trim().is_empty() {
                return Err(HomeError::SyncContract(format!("empty document: {name}")));
            }
            if file == BootstrapFile::Soul {
                Soul::parse(&content)?;
            }
            let hash = blake3::hash(content.as_bytes()).to_hex().to_string();
            hasher.update(name.as_bytes());
            hasher.update(&[0]);
            hasher.update(hash.as_bytes());
            documents.push(SyncDocument { filename: name.into(), hash, content });
        }
        // An editor may save during capture. Refuse a mixed revision and
        // let the next watcher or cron pass capture a coherent set.
        for document in &documents {
            let current = guard.read_to_string(&document.filename)?.ok_or_else(|| {
                HomeError::SyncContract(format!("document disappeared: {}", document.filename))
            })?;
            if blake3::hash(current.as_bytes()).to_hex().as_str() != document.hash {
                return Err(HomeError::SyncContract(format!(
                    "document changed during capture: {}",
                    document.filename
                )));
            }
        }
        let digests: Vec<FileDigest> = documents
            .iter()
            .map(|d| FileDigest {
                path: d.filename.clone(),
                size: d.content.len() as u64,
                sha256: sha256_hex(d.content.as_bytes()),
            })
            .collect();
        Ok(Self {
            revision: hasher.finalize().to_hex().to_string(),
            revision_sha256: manifest_revision(&digests),
            documents,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::onboard::{OnboardOptions, seed_workspace};

    #[test]
    fn sha256_revision_follows_the_documented_manifest() {
        let td = tempfile::tempdir().unwrap();
        seed_workspace(&OnboardOptions::new(td.path())).unwrap();
        let snapshot = SyncSnapshot::capture(td.path()).unwrap();
        let mut manifest = String::new();
        for name in sync_defaults().unwrap() {
            let bytes = std::fs::read(td.path().join(name.filename())).unwrap();
            let line = [sha256_hex(&bytes), bytes.len().to_string(), name.filename().to_string()];
            manifest.push_str(&line.join(" "));
            manifest.push('\n');
        }
        assert_eq!(
            snapshot.revision_sha256,
            format!("sha256-v1:{}", sha256_hex(manifest.as_bytes()))
        );
        assert_eq!(snapshot.revision.len(), 64);
    }
}
