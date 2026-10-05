// SPDX-License-Identifier: MIT
//! Resource owner shared by native repository and migration scans in one linked
//! native library. Separately loaded copies and other processes have distinct owners.

use std::{
  error::Error,
  fmt,
  sync::{Mutex, MutexGuard},
};

pub const MAX_SCAN_WORKERS: usize = 6;
static SCAN_OWNER: Mutex<()> = Mutex::new(());

pub fn default_scan_workers() -> usize {
  std::thread::available_parallelism()
    .map_or(1, usize::from)
    .min(MAX_SCAN_WORKERS)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ScanLeaseError {
  InvalidJobs(usize),
  Poisoned,
}

impl fmt::Display for ScanLeaseError {
  fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
    match self {
      Self::InvalidJobs(jobs) => write!(
        formatter,
        "jobs must be between 1 and {MAX_SCAN_WORKERS} (got {jobs})"
      ),
      Self::Poisoned => formatter.write_str("shared native scan owner is poisoned"),
    }
  }
}

impl Error for ScanLeaseError {}

/// Exclusive scan ownership. Dropping it releases the owner; no pool is created.
/// Holding the lease while recursively entering a scan is unsupported.
pub struct ScanLease {
  _guard: MutexGuard<'static, ()>,
  workers: usize,
}

impl ScanLease {
  pub fn workers(&self) -> usize {
    self.workers
  }
}

pub fn acquire_scan_lease(jobs: usize) -> Result<ScanLease, ScanLeaseError> {
  if !(1..=MAX_SCAN_WORKERS).contains(&jobs) {
    return Err(ScanLeaseError::InvalidJobs(jobs));
  }
  let guard = SCAN_OWNER.lock().map_err(|_| ScanLeaseError::Poisoned)?;
  Ok(ScanLease {
    _guard: guard,
    workers: jobs,
  })
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn validates_budget_and_owns_no_worker_pool() {
    for invalid in [0, 7, usize::MAX] {
      assert!(
        matches!(acquire_scan_lease(invalid), Err(ScanLeaseError::InvalidJobs(actual)) if actual == invalid)
      );
    }
    assert!((1..=MAX_SCAN_WORKERS).contains(&default_scan_workers()));
    let lease = acquire_scan_lease(2).unwrap();
    assert_eq!(lease.workers(), 2);
    assert!(matches!(
      SCAN_OWNER.try_lock(),
      Err(std::sync::TryLockError::WouldBlock)
    ));
    drop(lease);
    assert!(SCAN_OWNER.try_lock().is_ok());
  }
}
