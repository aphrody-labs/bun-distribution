// SPDX-License-Identifier: Apache-2.0
//! Pure Rust differential synchronization using the rsync algorithm (fast_rsync).

use fast_rsync::{
    ApplyError, DiffError, Signature, SignatureOptions, SignatureParseError, apply, diff,
};
use serde::{Deserialize, Serialize};
use thiserror::Error;

/// Default block size for differential chunking (2048 bytes).
pub const DEFAULT_BLOCK_SIZE: u32 = 2048;

/// Default strong hash size (16 bytes = MD4/MD5 truncated equivalent).
pub const DEFAULT_CRYPTO_HASH_SIZE: u32 = 16;

#[derive(Debug, Error)]
pub enum RsyncError {
    #[error("failed to calculate signature: {0}")]
    Signature(String),
    #[error("failed to parse signature: {0:?}")]
    SignatureParse(#[from] SignatureParseError),
    #[error("failed to calculate delta diff: {0:?}")]
    Diff(#[from] DiffError),
    #[error("failed to apply delta: {0:?}")]
    Apply(#[from] ApplyError),
}

/// Metadata and summary of a differential sync calculation.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct DifferentialSummary {
    pub original_size: u64,
    pub modified_size: u64,
    pub signature_size: usize,
    pub delta_size: usize,
    /// Percentage bandwidth saved: `100.0 * (1.0 - delta_size / modified_size)`
    pub savings_percentage: u32,
}

/// Options configuring block size and hash strength for rsync diffs.
#[derive(Debug, Clone, Copy)]
pub struct RsyncOptions {
    pub block_size: u32,
    pub crypto_hash_size: u32,
}

impl Default for RsyncOptions {
    fn default() -> Self {
        Self { block_size: DEFAULT_BLOCK_SIZE, crypto_hash_size: DEFAULT_CRYPTO_HASH_SIZE }
    }
}

/// Compute a serialized rsync signature for a block of base data.
pub fn compute_signature(base: &[u8], options: RsyncOptions) -> Vec<u8> {
    let sig = Signature::calculate(
        base,
        SignatureOptions {
            block_size: options.block_size,
            crypto_hash_size: options.crypto_hash_size,
        },
    );
    sig.into_serialized()
}

/// Compute delta bytes between raw signature bytes of base data and modified data.
pub fn compute_delta(sig_bytes: &[u8], modified: &[u8]) -> Result<Vec<u8>, RsyncError> {
    let signature = Signature::deserialize(sig_bytes.to_vec())?;
    let indexed = signature.index();
    let mut delta = Vec::new();
    diff(&indexed, modified, &mut delta)?;
    Ok(delta)
}

/// One-shot delta calculation between raw base and modified buffers.
pub fn compute_delta_from_buffers(
    base: &[u8],
    modified: &[u8],
    options: RsyncOptions,
) -> Result<(Vec<u8>, DifferentialSummary), RsyncError> {
    let sig_bytes = compute_signature(base, options);
    let delta = compute_delta(&sig_bytes, modified)?;

    let mod_len = modified.len() as u64;
    let delta_len = delta.len() as u64;
    let savings = if mod_len > 0 && delta_len < mod_len {
        ((1.0 - (delta_len as f64 / mod_len as f64)) * 100.0).round() as u32
    } else {
        0
    };

    let summary = DifferentialSummary {
        original_size: base.len() as u64,
        modified_size: mod_len,
        signature_size: sig_bytes.len(),
        delta_size: delta.len(),
        savings_percentage: savings,
    };

    Ok((delta, summary))
}

/// Apply a delta patch to the base data to reconstruct the modified data.
pub fn apply_delta(base: &[u8], delta: &[u8]) -> Result<Vec<u8>, RsyncError> {
    let mut out = Vec::new();
    apply(base, delta, &mut out)?;
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_rsync_delta_cycle() {
        let base = b"Hello world! This is a test file for fast-rsync in Aphrody.\nLine 2\nLine 3\n";
        let modified = b"Hello world! This is a MODIFIED test file for fast-rsync in Aphrody.\nLine 2\nLine 3 with additions\n";

        let (delta, summary) =
            compute_delta_from_buffers(base, modified, RsyncOptions::default()).unwrap();
        assert!(!delta.is_empty());
        assert_eq!(summary.original_size, base.len() as u64);
        assert_eq!(summary.modified_size, modified.len() as u64);

        let reconstructed = apply_delta(base, &delta).unwrap();
        assert_eq!(reconstructed.as_slice(), modified.as_slice());
    }

    #[test]
    fn test_rsync_identical_data_produces_minimal_delta() {
        let base = vec![42u8; 10000];
        let (delta, summary) =
            compute_delta_from_buffers(&base, &base, RsyncOptions::default()).unwrap();
        assert!(delta.len() < base.len());
        assert!(summary.savings_percentage > 50);

        let reconstructed = apply_delta(&base, &delta).unwrap();
        assert_eq!(reconstructed, base);
    }
}
