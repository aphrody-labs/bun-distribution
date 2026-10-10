// SPDX-License-Identifier: Apache-2.0
//! The single-GPU lease.
//!
//! A 12 GB card cannot hold an inference server and a training job at once.
//! Everything that occupies VRAM takes this lease first: inference runtimes
//! share it (several small servers may coexist), a training job takes it
//! exclusively — which it can only get once every inference holder has left.
//!
//! The lease is an OS file lock ([`FileLock`]), so a holder that crashes or is
//! killed releases it without any cleanup. Next to the lock, each holder writes
//! a small sidecar describing itself; that is how a process that cannot get the
//! lease reports *who* has the GPU instead of just "busy".

use std::{
    io,
    path::{Path, PathBuf},
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};

use crate::{
    group::process_alive,
    lock::{FileLock, LockKind},
};

/// What the GPU is wanted for; decides how the lease is shared.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LeaseKind {
    /// An inference runtime: coexists with other inference holders.
    Inference,
    /// A training job: alone on the GPU.
    Training,
}

impl LeaseKind {
    fn lock_kind(self) -> LockKind {
        match self {
            Self::Inference => LockKind::Shared,
            Self::Training => LockKind::Exclusive,
        }
    }
}

/// A process currently holding the GPU lease.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct GpuHolder {
    /// What the holder is (`llama-chat`, `llama-embed`, `train-lora`, …).
    pub role: String,
    /// The holding process.
    pub pid: u32,
    /// How it holds the lease.
    pub kind: LeaseKind,
    /// VRAM the holder planned for, in bytes (0 when unknown).
    pub vram_bytes: u64,
    /// When it took the lease, in seconds since the Unix epoch.
    pub since_unix: u64,
}

/// Why the lease could not be taken.
#[derive(Debug, thiserror::Error)]
pub enum LeaseError {
    /// Filesystem error on the lock or a sidecar.
    #[error("gpu lease i/o error: {0}")]
    Io(#[from] io::Error),
    /// The deadline passed while other processes held the GPU.
    #[error("gpu busy after {waited_ms} ms: {}", describe(.holders))]
    Busy {
        /// How long the acquisition waited.
        waited_ms: u64,
        /// Who held the GPU when the wait ended.
        holders: Vec<GpuHolder>,
    },
}

fn describe(holders: &[GpuHolder]) -> String {
    if holders.is_empty() {
        return "held by an unidentified process".to_string();
    }
    holders
        .iter()
        .map(|holder| format!("{} (pid {})", holder.role, holder.pid))
        .collect::<Vec<_>>()
        .join(", ")
}

/// The GPU lease, released when the value is dropped.
#[derive(Debug)]
pub struct GpuLease {
    // Field order matters: the sidecar is removed before the lock is released,
    // so nobody ever reads a sidecar for a lease that is already gone.
    _sidecar: Sidecar,
    _lock: FileLock,
}

#[derive(Debug)]
struct Sidecar(PathBuf);

impl Drop for Sidecar {
    fn drop(&mut self) {
        if let Err(error) = std::fs::remove_file(&self.0)
            && error.kind() != io::ErrorKind::NotFound
        {
            tracing::warn!(path = %self.0.display(), %error, "failed to remove gpu lease sidecar");
        }
    }
}

fn lock_path(locks_dir: &Path) -> PathBuf {
    locks_dir.join("gpu.lock")
}

fn sidecar_dir(locks_dir: &Path) -> PathBuf {
    locks_dir.join("gpu.d")
}

impl GpuLease {
    /// Take the lease under `locks_dir` (the `locks` directory of the aphrody
    /// state dir), waiting up to `timeout` for incompatible holders to leave.
    ///
    /// # Errors
    ///
    /// [`LeaseError::Busy`] (naming the holders) when the deadline passes,
    /// [`LeaseError::Io`] on a filesystem error.
    pub fn acquire(
        locks_dir: impl AsRef<Path>,
        role: &str,
        kind: LeaseKind,
        vram_bytes: u64,
        timeout: Duration,
    ) -> Result<Self, LeaseError> {
        let locks_dir = locks_dir.as_ref();
        let Some(lock) = FileLock::acquire(lock_path(locks_dir), kind.lock_kind(), timeout)? else {
            return Err(LeaseError::Busy {
                waited_ms: u64::try_from(timeout.as_millis()).unwrap_or(u64::MAX),
                holders: Self::holders(locks_dir)?,
            });
        };

        let holder = GpuHolder {
            role: role.to_string(),
            pid: std::process::id(),
            kind,
            vram_bytes,
            since_unix: SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map_or(0, |elapsed| elapsed.as_secs()),
        };
        let dir = sidecar_dir(locks_dir);
        std::fs::create_dir_all(&dir)?;
        // One sidecar per (pid, role): a process may hold the lease for several
        // runtimes at once (chat + embed servers under one supervisor).
        let sidecar = dir.join(format!("{}-{}.json", holder.pid, sanitize(role)));
        std::fs::write(&sidecar, serde_json::to_vec_pretty(&holder).map_err(io::Error::other)?)?;

        Ok(Self { _sidecar: Sidecar(sidecar), _lock: lock })
    }

    /// The live holders of the lease under `locks_dir`.
    ///
    /// Sidecars whose process is gone are deleted on the way: a killed holder
    /// released the lock through the OS but could not remove its own file.
    ///
    /// # Errors
    ///
    /// Propagates a directory read error other than "not found".
    pub fn holders(locks_dir: impl AsRef<Path>) -> io::Result<Vec<GpuHolder>> {
        let dir = sidecar_dir(locks_dir.as_ref());
        let entries = match std::fs::read_dir(&dir) {
            Ok(entries) => entries,
            Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(Vec::new()),
            Err(error) => return Err(error),
        };

        let mut holders = Vec::new();
        for entry in entries {
            let path = entry?.path();
            if path.extension().and_then(|extension| extension.to_str()) != Some("json") {
                continue;
            }
            let holder = std::fs::read(&path)
                .ok()
                .and_then(|bytes| serde_json::from_slice::<GpuHolder>(&bytes).ok());
            match holder {
                Some(holder) if process_alive(holder.pid) => holders.push(holder),
                // Dead holder or unreadable sidecar: stale either way.
                _ => {
                    let _ = std::fs::remove_file(&path);
                },
            }
        }
        holders.sort_by(|a, b| a.since_unix.cmp(&b.since_unix).then_with(|| a.pid.cmp(&b.pid)));
        Ok(holders)
    }
}

/// Keep a role usable as a file-name component.
fn sanitize(role: &str) -> String {
    role.chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == '_' { c } else { '_' })
        .collect()
}
