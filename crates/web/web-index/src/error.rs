//! Error type shared by every fallible index operation.

use thiserror::Error;

/// Errors returned by the index. Corrupt or hostile input never panics; it
/// surfaces as one of these variants.
#[derive(Debug, Error)]
pub enum IndexError {
    #[error("dimension mismatch: expected {expected}, got {got}")]
    DimensionMismatch { expected: usize, got: usize },

    #[error("vector contains NaN or infinite components")]
    NonFiniteVector,

    #[error("vector has zero norm and cannot be normalised for cosine similarity")]
    ZeroVector,

    #[error("invalid parameters: {0}")]
    InvalidParams(String),

    #[error("index capacity exceeded (max {max} slots)")]
    CapacityExceeded { max: usize },

    #[error("io error: {0}")]
    Io(#[from] std::io::Error),

    #[error("not a bxc-index file (bad magic)")]
    BadMagic,

    #[error("unsupported index file version {0}")]
    UnsupportedVersion(u32),

    #[error("checksum mismatch: stored {stored:#018x}, computed {computed:#018x}")]
    ChecksumMismatch { stored: u64, computed: u64 },

    #[error("corrupt index file: {0}")]
    Corrupt(String),

    #[error("json error: {0}")]
    Json(String),
}

impl IndexError {
    /// `true` when a file exists but is not a valid index (bad magic, unknown
    /// version, checksum mismatch or structural corruption). Callers usually
    /// rebuild the index from the source of truth in that case.
    pub fn is_corrupt_file(&self) -> bool {
        matches!(
            self,
            IndexError::BadMagic
                | IndexError::UnsupportedVersion(_)
                | IndexError::ChecksumMismatch { .. }
                | IndexError::Corrupt(_)
        )
    }
}

impl From<serde_json::Error> for IndexError {
    fn from(err: serde_json::Error) -> Self {
        IndexError::Json(err.to_string())
    }
}

/// Crate-wide result alias.
pub type Result<T> = std::result::Result<T, IndexError>;
