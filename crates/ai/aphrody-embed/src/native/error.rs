//! Error type shared by every module of the crate.

use std::path::PathBuf;

/// Convenience alias used across the crate.
pub type Result<T> = std::result::Result<T, Error>;

/// All failures surfaced by `aphrody-embed`.
#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("unknown model `{0}`")]
    UnknownModel(String),

    #[error("model `{model}` is not installed in `{}`; install it with aphrody_embed::native::ensure_model", dir.display())]
    NotInstalled { model: String, dir: PathBuf },

    #[error("model file `{}` is missing and APHRODY_OFFLINE=1 forbids downloading it", .0.display())]
    Offline(PathBuf),

    #[error("download of `{url}` failed: {message}")]
    Download { url: String, message: String },

    #[error(
        "integrity check failed for `{name}`: expected sha256 {expected} ({expected_size} bytes), \
         got {actual} ({actual_size} bytes)"
    )]
    Integrity {
        name: String,
        expected: String,
        actual: String,
        expected_size: u64,
        actual_size: u64,
    },

    #[error("tokenizer error: {0}")]
    Tokenizer(String),

    #[cfg(feature = "candle")]
    #[error("inference error: {0}")]
    Candle(#[from] candle_core::Error),

    #[error("invalid input: {0}")]
    InvalidInput(String),

    #[error("json error: {0}")]
    Json(#[from] serde_json::Error),

    #[error("io error on `{}`: {source}", path.display())]
    Io {
        path: PathBuf,
        #[source]
        source: std::io::Error,
    },
}

impl Error {
    pub(crate) fn io(path: impl Into<PathBuf>, source: std::io::Error) -> Self {
        Self::Io { path: path.into(), source }
    }
}
