// SPDX-License-Identifier: Apache-2.0
//! Shared seven-file contract and validated revisions for external syncs.
//!
//! Google transport belongs to `@aphrody/google`; this crate owns which
//! documents form the live agent identity and how a revision is validated.

use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::{HomeError, filenames::BootstrapFile, guard::WorkspaceGuard, soul::Soul};

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
    /// Hash of ordered filenames and document hashes.
    pub revision: String,
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
        Ok(Self { revision: hasher.finalize().to_hex().to_string(), documents })
    }
}
