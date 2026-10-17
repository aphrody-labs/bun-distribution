// SPDX-License-Identifier: Apache-2.0
use thiserror::Error;

#[derive(Debug, Error)]
pub enum ReError {
    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),

    #[error("Invalid magic: expected {expected:?}, found {found:?}")]
    InvalidMagic { expected: Vec<u8>, found: Vec<u8> },

    #[error("Buffer too small: required {required} bytes, available {available} bytes")]
    BufferTooSmall { required: usize, available: usize },

    #[error("Corrupt header: {0}")]
    CorruptHeader(String),

    #[error("CRILAYLA decompression failed: {0}")]
    CrilaylaDecompress(String),

    #[error("Unsupported format version: {version}")]
    UnsupportedVersion { version: u32 },

    #[error("Parsing error in {context}: {details}")]
    ParseError {
        context: &'static str,
        details: String,
    },

    #[error("JSON error: {0}")]
    Json(#[from] serde_json::Error),
}

pub type Result<T> = std::result::Result<T, ReError>;
