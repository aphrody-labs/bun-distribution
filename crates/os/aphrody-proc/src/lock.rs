// SPDX-License-Identifier: Apache-2.0
//! Advisory whole-file locks.

use std::{
    fs::{File, OpenOptions, TryLockError},
    io,
    path::{Path, PathBuf},
    time::{Duration, Instant},
};

/// How a [`FileLock`] is held.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LockKind {
    /// Any number of shared holders, no exclusive one.
    Shared,
    /// A single holder, no shared ones.
    Exclusive,
}

/// An advisory lock on a file, released when the value is dropped.
///
/// Backed by the OS whole-file lock (`flock` / `LockFileEx` through
/// [`std::fs::File`]): it is held by the open file handle, so it disappears
/// with the process even if that process is killed — no stale-lock cleanup is
/// ever needed. It only constrains cooperating processes that take the same
/// lock; it does not stop anyone from reading or writing the file.
#[derive(Debug)]
pub struct FileLock {
    file: File,
    path: PathBuf,
    kind: LockKind,
}

/// How often a bounded acquisition re-tries while the lock is contended.
const POLL_INTERVAL: Duration = Duration::from_millis(50);

impl FileLock {
    fn open(path: &Path) -> io::Result<File> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        OpenOptions::new().read(true).write(true).create(true).truncate(false).open(path)
    }

    /// Take the lock if it is free right now.
    ///
    /// Returns `Ok(None)` when another holder makes `kind` impossible.
    ///
    /// # Errors
    ///
    /// Propagates the error of opening the lock file or of the lock call itself.
    pub fn try_acquire(path: impl AsRef<Path>, kind: LockKind) -> io::Result<Option<Self>> {
        let path = path.as_ref();
        let file = Self::open(path)?;
        let attempt = match kind {
            LockKind::Shared => file.try_lock_shared(),
            LockKind::Exclusive => file.try_lock(),
        };
        match attempt {
            Ok(()) => Ok(Some(Self { file, path: path.to_path_buf(), kind })),
            Err(TryLockError::WouldBlock) => Ok(None),
            Err(TryLockError::Error(error)) => Err(error),
        }
    }

    /// Take the lock, waiting up to `timeout` for the current holders to leave.
    ///
    /// Returns `Ok(None)` when the deadline passes first. A bounded wait is the
    /// only kind offered on purpose: nothing in an unattended agent may block
    /// forever on another process.
    ///
    /// # Errors
    ///
    /// Propagates the error of opening the lock file or of the lock call itself.
    pub fn acquire(
        path: impl AsRef<Path>,
        kind: LockKind,
        timeout: Duration,
    ) -> io::Result<Option<Self>> {
        let path = path.as_ref();
        let deadline = Instant::now() + timeout;
        loop {
            if let Some(lock) = Self::try_acquire(path, kind)? {
                return Ok(Some(lock));
            }
            let now = Instant::now();
            if now >= deadline {
                return Ok(None);
            }
            std::thread::sleep(POLL_INTERVAL.min(deadline - now));
        }
    }

    /// The lock file.
    #[must_use]
    pub fn path(&self) -> &Path {
        &self.path
    }

    /// How the lock is held.
    #[must_use]
    pub fn kind(&self) -> LockKind {
        self.kind
    }
}

impl Drop for FileLock {
    fn drop(&mut self) {
        // Closing the handle releases the lock too; unlocking first makes the
        // release immediate instead of "when the descriptor is finally closed".
        if let Err(error) = self.file.unlock() {
            tracing::warn!(path = %self.path.display(), %error, "failed to release file lock");
        }
    }
}
