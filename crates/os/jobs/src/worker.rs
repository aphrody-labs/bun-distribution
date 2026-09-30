// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 aphrody contributors
//
//! The consumer side: handlers, and the loop that drives them.
//!
//! # Why handlers are registered rather than enumerated
//!
//! The queue does not know what OCR or transcription are. A handler is a
//! `kind` string plus an async function; the CLI registers the real ones. That
//! keeps this crate free of every model dependency, and means adding a task
//! type is a registration, not a schema change.

use std::{collections::HashMap, sync::Arc};

use chrono::Duration;

use crate::{
    error::{JobError, Result},
    log::{JobLogs, LogLevel, LogLine},
    spec::Job,
    store::{JobStore, RecoveryReport},
};

/// What a handler can go wrong with.
///
/// The distinction is the point: a [`Self::Permanent`] failure skips the
/// remaining attempts. Retrying a malformed payload or a missing input file
/// burns the retry budget on an outcome that cannot change, and buries the real
/// error under identical repeats.
#[derive(Debug, thiserror::Error)]
pub enum HandlerError {
    /// Worth another attempt (a busy GPU, a locked file, a flaky mount).
    #[error("{0}")]
    Retryable(String),
    /// Retrying cannot help (bad payload, missing input, unsupported format).
    #[error("{0}")]
    Permanent(String),
}

impl HandlerError {
    /// Whether the queue should schedule another attempt.
    #[must_use]
    pub const fn is_retryable(&self) -> bool {
        matches!(self, Self::Retryable(_))
    }
}

/// Executes one kind of job.
#[async_trait::async_trait]
pub trait JobHandler: Send + Sync {
    /// The `kind` this handler answers for.
    fn kind(&self) -> &str;

    /// Run one job.
    ///
    /// `ctx` carries the log sink, so a long-running handler can report
    /// progress that is readable while the job is still in flight.
    ///
    /// # Errors
    ///
    /// [`HandlerError`], whose variant decides whether the job is retried.
    async fn run(
        &self,
        job: &Job,
        ctx: &JobContext,
    ) -> core::result::Result<serde_json::Value, HandlerError>;
}

/// What a handler is given alongside the job.
#[derive(Debug, Clone)]
pub struct JobContext {
    /// The job's id, for log lines.
    pub job_id: String,
    /// Where to append progress.
    pub logs: JobLogs,
}

impl JobContext {
    /// Append an info line to this job's log.
    ///
    /// Errors are swallowed: failing a successful transcription because its log
    /// file could not be written would trade a real result for a bookkeeping
    /// problem.
    pub fn info(&self, message: impl Into<String>) {
        let _ = self.logs.info(&self.job_id, message);
    }

    /// Append a structured line.
    pub fn log(&self, level: LogLevel, message: impl Into<String>, data: serde_json::Value) {
        let _ = self.logs.append(
            &self.job_id,
            &LogLine { at: chrono::Utc::now(), level, message: message.into(), data: Some(data) },
        );
    }
}

/// The result of running one job to completion.
#[derive(Debug, Clone, PartialEq)]
pub enum Outcome {
    /// The handler succeeded.
    Succeeded(String),
    /// The handler failed and the job went back to the queue.
    Retrying(String),
    /// The handler failed terminally, or ran out of attempts.
    Failed(String),
    /// The job was cancelled while running; its result is discarded.
    Cancelled(String),
}

/// A worker: a store, a log directory, and a set of handlers.
pub struct Worker {
    store: JobStore,
    logs: JobLogs,
    handlers: HashMap<String, Arc<dyn JobHandler>>,
    name: String,
    lease: Duration,
    backoff: Duration,
}

impl core::fmt::Debug for Worker {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        f.debug_struct("Worker")
            .field("name", &self.name)
            .field("lease", &self.lease)
            .field("kinds", &self.handlers.keys().collect::<Vec<_>>())
            .field("backoff", &self.backoff)
            .field("store", &self.store.path())
            .field("logs", &self.logs.root())
            .finish()
    }
}

impl Worker {
    /// A worker consuming `store` and logging under `logs`.
    ///
    /// `name` identifies the claim holder; it appears in `worker` on every
    /// running job, which is what makes a stuck job attributable.
    pub fn new(store: JobStore, logs: JobLogs, name: impl Into<String>) -> Self {
        Self {
            store,
            logs,
            handlers: HashMap::new(),
            name: name.into(),
            lease: crate::store::DEFAULT_LEASE,
            backoff: Duration::seconds(5),
        }
    }

    /// Register a handler, replacing any previous one for the same kind.
    #[must_use]
    pub fn with_handler(mut self, handler: Arc<dyn JobHandler>) -> Self {
        self.handlers.insert(handler.kind().to_owned(), handler);
        self
    }

    /// Override the claim lease.
    #[must_use]
    pub const fn with_lease(mut self, lease: Duration) -> Self {
        self.lease = lease;
        self
    }

    /// Override the delay before a retryable failure becomes claimable again.
    #[must_use]
    pub const fn with_backoff(mut self, backoff: Duration) -> Self {
        self.backoff = backoff;
        self
    }

    /// The queue this worker consumes.
    #[must_use]
    pub const fn store(&self) -> &JobStore {
        &self.store
    }

    /// The kinds this worker can run.
    #[must_use]
    pub fn kinds(&self) -> Vec<&str> {
        let mut kinds: Vec<&str> = self.handlers.keys().map(String::as_str).collect();
        kinds.sort_unstable();
        kinds
    }

    /// Return whatever a previous run abandoned to the queue.
    ///
    /// Call this before consuming: jobs a killed worker was holding stay
    /// `running` until someone does, and `running` reads as healthy.
    ///
    /// # Errors
    ///
    /// [`JobError::Sqlite`] on write failure.
    pub fn recover(&self) -> Result<RecoveryReport> {
        self.store.recover()
    }

    /// Claim and run at most one job. `Ok(None)` means the queue was empty.
    ///
    /// # Errors
    ///
    /// [`JobError`] from the store. A handler failure is **not** an error here:
    /// it is recorded on the job and reported as [`Outcome::Retrying`] or
    /// [`Outcome::Failed`], because a failing job is the queue working, not the
    /// worker breaking.
    pub async fn run_once(&self) -> Result<Option<Outcome>> {
        let Some(job) = self.store.claim(&self.name, self.lease)? else {
            return Ok(None);
        };

        let Some(handler) = self.handlers.get(&job.kind).map(Arc::clone) else {
            // An unregistered kind is permanent for *this* worker but not for
            // the queue: another worker may know the kind. Failing the job
            // outright would delete work a differently-configured process could
            // do, so it goes back with its attempt refunded only in the sense
            // that the error names the missing handler.
            let message = JobError::UnknownKind(job.kind.clone()).to_string();
            let _ = self.logs.error(&job.id, message.clone());
            let after = self.store.fail(&job.id, &message)?;
            return Ok(Some(if after.state == crate::JobState::Queued {
                Outcome::Retrying(job.id)
            } else {
                Outcome::Failed(job.id)
            }));
        };

        let ctx = JobContext { job_id: job.id.clone(), logs: self.logs.clone() };
        ctx.info(format!("attempt {}/{} of `{}`", job.attempts, job.max_attempts, job.kind));

        let outcome = handler.run(&job, &ctx).await;

        // The job may have been cancelled while the handler ran. Writing a
        // result over a cancellation would make `cancel` a lie.
        if !self.store.heartbeat(&job.id, &self.name, self.lease)? {
            ctx.info("claim lost while running (cancelled, or recovered by another worker)");
            return Ok(Some(Outcome::Cancelled(job.id)));
        }

        match outcome {
            Ok(result) => {
                ctx.info("succeeded");
                self.store.succeed(&job.id, &result)?;
                Ok(Some(Outcome::Succeeded(job.id)))
            },
            Err(err) => {
                let message = err.to_string();
                let _ = self.logs.error(&job.id, message.clone());
                let after = if err.is_retryable() {
                    self.store.fail_at(&job.id, &message, chrono::Utc::now(), Some(self.backoff))?
                } else {
                    // A permanent failure must not consume the remaining
                    // attempts one identical error at a time.
                    self.store.fail_permanently(&job.id, &message)?
                };
                Ok(Some(if after.state == crate::JobState::Queued {
                    Outcome::Retrying(job.id)
                } else {
                    Outcome::Failed(job.id)
                }))
            },
        }
    }

    /// Consume the queue until it is empty, and report each outcome in order.
    ///
    /// `max_jobs` bounds the batch so a job that enqueues more work cannot make
    /// this call run forever.
    ///
    /// # Errors
    ///
    /// [`JobError`] from the store.
    pub async fn drain(&self, max_jobs: usize) -> Result<Vec<Outcome>> {
        let mut outcomes = Vec::new();
        while outcomes.len() < max_jobs {
            match self.run_once().await? {
                Some(outcome) => outcomes.push(outcome),
                None => break,
            }
        }
        Ok(outcomes)
    }

    /// Run forever: recover, then consume, sleeping `idle` between empty polls.
    ///
    /// Returns only on a store error — the caller owns the shutdown signal and
    /// drops the future to stop.
    ///
    /// # Errors
    ///
    /// [`JobError`] from the store.
    pub async fn run_forever(&self, idle: std::time::Duration) -> Result<()> {
        self.recover()?;
        loop {
            if self.run_once().await?.is_none() {
                tokio::time::sleep(idle).await;
                // A worker that only polls would never reclaim the jobs a
                // *sibling* worker abandoned, so recovery belongs in the idle
                // path too, not only at startup.
                self.recover()?;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{JobSpec, JobState, store::ListFilter};

    struct Fixed {
        kind: &'static str,
        answer: core::result::Result<serde_json::Value, &'static str>,
        permanent: bool,
    }

    #[async_trait::async_trait]
    impl JobHandler for Fixed {
        fn kind(&self) -> &str {
            self.kind
        }

        async fn run(
            &self,
            _job: &Job,
            ctx: &JobContext,
        ) -> core::result::Result<serde_json::Value, HandlerError> {
            ctx.info("working");
            match &self.answer {
                Ok(value) => Ok(value.clone()),
                Err(msg) => Err(if self.permanent {
                    HandlerError::Permanent((*msg).to_owned())
                } else {
                    HandlerError::Retryable((*msg).to_owned())
                }),
            }
        }
    }

    fn worker(handler: Fixed) -> (Worker, tempfile::TempDir) {
        let dir = tempfile::tempdir().unwrap();
        let store = JobStore::in_memory().unwrap();
        let logs = JobLogs::new(dir.path());
        (Worker::new(store, logs, "test-worker").with_handler(Arc::new(handler)), dir)
    }

    #[tokio::test]
    async fn an_empty_queue_yields_no_outcome() {
        let (w, _dir) =
            worker(Fixed { kind: "x", answer: Ok(serde_json::json!(1)), permanent: false });
        assert!(w.run_once().await.unwrap().is_none());
    }

    #[tokio::test]
    async fn a_successful_job_stores_its_result_and_logs_it() {
        let (w, _dir) = worker(Fixed {
            kind: "x",
            answer: Ok(serde_json::json!({ "ok": true })),
            permanent: false,
        });
        let job = w.store().submit(&JobSpec::new("x", serde_json::json!({}))).unwrap();

        assert_eq!(w.run_once().await.unwrap(), Some(Outcome::Succeeded(job.id.clone())));
        let done = w.store().get(&job.id).unwrap();
        assert_eq!(done.state, JobState::Succeeded);
        assert_eq!(done.result, Some(serde_json::json!({ "ok": true })));

        let log = w.logs.read(&job.id, None).unwrap();
        assert!(log.iter().any(|l| l.message.contains("attempt 1/1")));
        assert!(log.iter().any(|l| l.message == "working"));
    }

    #[tokio::test]
    async fn a_retryable_failure_returns_the_job_to_the_queue() {
        let (w, _dir) = worker(Fixed { kind: "x", answer: Err("busy"), permanent: false });
        let job = w
            .store()
            .submit(&JobSpec::new("x", serde_json::json!({})).with_max_attempts(2))
            .unwrap();

        assert_eq!(w.run_once().await.unwrap(), Some(Outcome::Retrying(job.id.clone())));
        let after = w.store().get(&job.id).unwrap();
        assert_eq!(after.state, JobState::Queued);
        assert_eq!(after.last_error.as_deref(), Some("busy"));
    }

    #[tokio::test]
    async fn a_permanent_failure_skips_the_remaining_attempts() {
        // The point of the distinction: a malformed payload must not be retried
        // three times to produce the same error three times.
        let (w, _dir) = worker(Fixed { kind: "x", answer: Err("bad payload"), permanent: true });
        let job = w
            .store()
            .submit(&JobSpec::new("x", serde_json::json!({})).with_max_attempts(5))
            .unwrap();

        assert_eq!(w.run_once().await.unwrap(), Some(Outcome::Failed(job.id.clone())));
        let after = w.store().get(&job.id).unwrap();
        assert_eq!(after.state, JobState::Failed);
        assert_eq!(after.attempts, 1, "a permanent failure must not burn the retry budget");
    }

    #[tokio::test]
    async fn an_unregistered_kind_is_reported_by_name() {
        let (w, _dir) =
            worker(Fixed { kind: "known", answer: Ok(serde_json::json!(1)), permanent: false });
        let job = w.store().submit(&JobSpec::new("unknown", serde_json::json!({}))).unwrap();

        assert_eq!(w.run_once().await.unwrap(), Some(Outcome::Failed(job.id.clone())));
        let after = w.store().get(&job.id).unwrap();
        assert!(after.last_error.as_deref().unwrap().contains("unknown"), "{after:?}");
    }

    #[tokio::test]
    async fn draining_stops_at_the_cap() {
        let (w, _dir) =
            worker(Fixed { kind: "x", answer: Ok(serde_json::json!(1)), permanent: false });
        for _ in 0..5 {
            w.store().submit(&JobSpec::new("x", serde_json::json!({}))).unwrap();
        }
        assert_eq!(w.drain(3).await.unwrap().len(), 3);
        assert_eq!(
            w.store().list(&ListFilter::default().state(JobState::Queued)).unwrap().len(),
            2
        );
    }

    #[tokio::test]
    async fn draining_an_empty_queue_returns_nothing_rather_than_spinning() {
        let (w, _dir) =
            worker(Fixed { kind: "x", answer: Ok(serde_json::json!(1)), permanent: false });
        assert!(w.drain(100).await.unwrap().is_empty());
    }

    #[test]
    fn registered_kinds_are_reported_sorted() {
        let dir = tempfile::tempdir().unwrap();
        let w = Worker::new(JobStore::in_memory().unwrap(), JobLogs::new(dir.path()), "w")
            .with_handler(Arc::new(Fixed {
                kind: "ocr",
                answer: Ok(serde_json::json!(1)),
                permanent: false,
            }))
            .with_handler(Arc::new(Fixed {
                kind: "transcribe",
                answer: Ok(serde_json::json!(1)),
                permanent: false,
            }));
        assert_eq!(w.kinds(), vec!["ocr", "transcribe"]);
    }
}
