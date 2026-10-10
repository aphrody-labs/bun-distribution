// SPDX-License-Identifier: Apache-2.0
use std::fmt;

/// Result alias for VFS operations.
pub type VfsResult<T> = Result<T, VfsError>;

/// Backend-independent error kinds; every backend maps its failures onto these.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum VfsError {
    NotFound,
    AlreadyExists,
    NotADirectory,
    IsADirectory,
    DirectoryNotEmpty,
    /// Relative, NUL byte, or component/path too long.
    InvalidPath,
    /// Operation not meaningful (remove root, move dir into itself).
    InvalidInput,
    /// A single file would exceed the per-file cap.
    FileTooLarge,
    /// Total bytes or inode cap would be exceeded.
    QuotaExceeded,
    /// Backend specific failure (host I/O).
    Io(String),
}

impl fmt::Display for VfsError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::NotFound => f.write_str("no such file or directory"),
            Self::AlreadyExists => f.write_str("file exists"),
            Self::NotADirectory => f.write_str("not a directory"),
            Self::IsADirectory => f.write_str("is a directory"),
            Self::DirectoryNotEmpty => f.write_str("directory not empty"),
            Self::InvalidPath => f.write_str("invalid path"),
            Self::InvalidInput => f.write_str("invalid argument"),
            Self::FileTooLarge => f.write_str("file too large"),
            Self::QuotaExceeded => f.write_str("quota exceeded"),
            Self::Io(m) => write!(f, "i/o error: {m}"),
        }
    }
}

impl std::error::Error for VfsError {}
