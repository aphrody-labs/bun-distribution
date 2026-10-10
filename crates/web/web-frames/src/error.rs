// SPDX-License-Identifier: Apache-2.0
use std::path::PathBuf;

#[derive(Debug, thiserror::Error)]
pub enum FramesError {
    #[error("invalid ColorLayout vector: {0}")]
    InvalidVector(String),
    #[error("invalid frame request: {0}")]
    InvalidRequest(String),
    #[error("I/O error at {path}: {source}")]
    Io {
        path: PathBuf,
        #[source]
        source: std::io::Error,
    },
    #[error("SQLite error: {0}")]
    Sql(#[from] rusqlite::Error),
    #[error("FFmpeg command failed: {0}")]
    Ffmpeg(String),
    #[error("trace.moe request failed: {0}")]
    TraceMoe(String),
    #[error("JSON error: {0}")]
    Json(#[from] serde_json::Error),
}

pub type Result<T> = std::result::Result<T, FramesError>;
