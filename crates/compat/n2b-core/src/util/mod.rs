// Copyright 2026 aphrody-code
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     https://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

use aphrody_n2b_types::types::{Finding, MakeFindingOpts, Severity};
use memchr::memchr_iter;

pub mod edits;
pub use edits::{Edit, apply_edits};

/// Liste les offsets (en octets UTF-8) de chaque '\n' dans `source`.
pub fn line_offsets(source: &str) -> Vec<u32> {
    memchr_iter(b'\n', source.as_bytes()).map(|p| p as u32).collect()
}

/// Convertit un index (offset octet UTF-8) en (line, col) 1-based.
/// Reproduit la sémantique de l'ancien posFromIndex JS ; la colonne
/// compte en octets ici (acceptable pour les règles courantes).
pub fn pos_from_index(offsets: &[u32], index: usize) -> (u32, u32) {
    let idx = index as u32;
    // Plus grand offset strictement < idx.
    let i = offsets.partition_point(|&o| o < idx);
    if i == 0 {
        (1, idx + 1)
    } else {
        let line = (i as u32) + 1;
        let col = idx - offsets[i - 1];
        (line, col)
    }
}

#[allow(clippy::too_many_arguments)] // preexisting: builder pattern would require API churn
pub fn make_finding(
    path: &str,
    offsets: &[u32],
    index: usize,
    rule_id: &str,
    message: impl Into<String>,
    original: impl Into<String>,
    replacement: Option<String>,
    opts: MakeFindingOpts,
) -> Finding {
    let (line, col) = pos_from_index(offsets, index);
    let autofix = opts.autofix.unwrap_or_else(|| replacement.is_some());
    Finding {
        file: path.to_string(),
        line,
        col,
        rule_id: rule_id.to_string(),
        severity: opts.severity.unwrap_or(Severity::Warn),
        message: message.into(),
        original: original.into(),
        replacement,
        autofix,
        aggressive: opts.aggressive,
        compat: opts.compat,
    }
}

pub mod resources {
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
}
