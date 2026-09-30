// SPDX-License-Identifier: Apache-2.0
//! Exclusive GPU lease arbitration for training (P10).

use std::{path::Path, time::Duration};

use aphrody_proc::{GpuLease, LeaseError, LeaseKind};

/// Acquire exclusive GPU lease for a training job.
///
/// Ensures no `llama-server` inference daemon shares VRAM during training.
///
/// # Errors
///
/// Returns [`LeaseError`] if the lock directory cannot be accessed or another process
/// holds the lease past `timeout`.
pub fn acquire_training_lease(
    locks_dir: &Path,
    job_id: &str,
    timeout: Duration,
) -> Result<GpuLease, LeaseError> {
    let role = format!("train:{job_id}");
    GpuLease::acquire(locks_dir, &role, LeaseKind::Training, 0, timeout)
}
