// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 aphrody contributors
//
//! Persistent background job queue for the local inference toolbox.
//!
//! The fourth usage of the toolbox cap — *repeated tasks organised as
//! background jobs* — needs work to survive the process that submitted it.
//! Scheduling (*when* something runs) belongs to the caller, for example
//! `Bun.cron` in the Bun fork. This crate keeps jobs across a crash: a `SQLite` file holding one row per job,
//! claimed under a lease, with per-job NDJSON logs.
//!
//! # The one invariant
//!
//! **A worker that dies must not strand its work.** A claim is a lease with a
//! deadline, not a flag, so a job whose worker stopped heartbeating is returned
//! to the queue by [`JobStore::recover`]. A boolean `claimed` column cannot
//! distinguish a running job from an abandoned one, which is how a crash leaves
//! work stuck in a state that reads as healthy.
//!
//! # Shape
//!
//! | Module | Role |
//! |---|---|
//! | [`spec`] | what a job is: id, kind, payload, state machine |
//! | [`store`] | the `SQLite` queue: submit, claim, heartbeat, succeed/fail, recover, purge |
//! | [`log`] | append-only NDJSON, one file per job, readable while it runs |
//! | [`worker`] | handler registry and the loop that drives them |
//!
//! The queue is **agnostic about the work**: `kind` names a handler and
//! `payload` is opaque JSON. Enumerating task types here would drag every model
//! dependency into a crate whose job is bookkeeping, and would make adding a
//! task type a schema change.
//!
//! # Example
//!
//! ```
//! use std::sync::Arc;
//! use aphrody_jobs::{JobLogs, JobSpec, JobStore, Worker, JobHandler, JobContext,
//!                    HandlerError, Job, Outcome};
//!
//! struct Echo;
//!
//! #[async_trait::async_trait]
//! impl JobHandler for Echo {
//!     fn kind(&self) -> &str { "echo" }
//!     async fn run(&self, job: &Job, ctx: &JobContext)
//!         -> Result<serde_json::Value, HandlerError>
//!     {
//!         ctx.info("echoing");
//!         Ok(job.payload.clone())
//!     }
//! }
//!
//! # #[tokio::main(flavor = "current_thread")]
//! # async fn main() -> Result<(), Box<dyn std::error::Error>> {
//! let dir = tempfile::tempdir()?;
//! let store = JobStore::open(dir.path().join("jobs.db"))?;
//! let submitted = store.submit(&JobSpec::new("echo", serde_json::json!({ "n": 1 })))?;
//!
//! let worker = Worker::new(store, JobLogs::new(dir.path().join("logs")), "worker-1")
//!     .with_handler(Arc::new(Echo));
//! assert_eq!(worker.run_once().await?, Some(Outcome::Succeeded(submitted.id.clone())));
//! assert_eq!(
//!     worker.store().get(&submitted.id)?.result,
//!     Some(serde_json::json!({ "n": 1 })),
//! );
//! # Ok(())
//! # }
//! ```

#![forbid(unsafe_code)]
#![warn(clippy::pedantic)]

/// The crate's error type.
pub mod error;
/// Append-only NDJSON logs, one file per job.
pub mod log;
/// What a job is: identity, payload, and its state machine.
pub mod spec;
/// The persistent `SQLite` queue.
pub mod store;
/// Handlers and the loop that drives them.
pub mod worker;

pub use error::{JobError, Result};
pub use log::{JobLogs, LogLevel, LogLine};
pub use spec::{HostAffinity, Job, JobSpec, JobState};
pub use store::{DEFAULT_LEASE, JobStore, ListFilter, QueueStats, RecoveryReport};
pub use worker::{HandlerError, JobContext, JobHandler, Outcome, Worker};

/// Default queue location: `<root>/jobs/jobs.db`, alongside the model store.
///
/// Keeping jobs under the same `~/.aphrody` root as models and runtimes means
/// one directory holds everything the toolbox owns on a machine.
#[must_use]
pub fn default_db_path(aphrody_root: &std::path::Path) -> std::path::PathBuf {
    aphrody_root.join("jobs").join("jobs.db")
}

/// Default log directory: `<root>/jobs/logs`.
#[must_use]
pub fn default_log_dir(aphrody_root: &std::path::Path) -> std::path::PathBuf {
    aphrody_root.join("jobs").join("logs")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_default_paths_sit_together_under_one_root() {
        let root = std::path::Path::new("/home/u/.aphrody");
        let db = default_db_path(root);
        let logs = default_log_dir(root);
        assert_eq!(db.parent(), logs.parent());
        assert!(db.ends_with("jobs/jobs.db") || db.ends_with("jobs\\jobs.db"));
    }
}
