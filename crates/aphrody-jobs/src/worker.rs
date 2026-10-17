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

use std::{
    collections::HashMap,
    future::{Future, poll_fn},
    num::NonZeroUsize,
    pin::Pin,
    sync::Arc,
    task::Poll,
};

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
    /// The future is dropped if the claim is cancelled or lost. Own all child
    /// operations and make dropping the future cancel them; do not detach mutations.
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
            &LogLine {
                at: chrono::Utc::now(),
                level,
                message: message.into(),
                data: Some(data),
            },
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
    host: Option<String>,
}

impl core::fmt::Debug for Worker {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        f.debug_struct("Worker")
            .field("name", &self.name)
            .field("lease", &self.lease)
            .field("kinds", &self.handlers.keys().collect::<Vec<_>>())
            .field("backoff", &self.backoff)
            .field("host", &self.host)
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
            host: None,
        }
    }

    /// Register a handler, replacing any previous one for the same kind.
    #[must_use]
    pub fn with_handler(mut self, handler: Arc<dyn JobHandler>) -> Self {
        self.handlers.insert(handler.kind().to_owned(), handler);
        self
    }

    /// Catalog host identity used by the persistent placement filter.
    #[must_use]
    pub fn with_host(mut self, host: impl Into<String>) -> Self {
        self.host = Some(host.into());
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
        let kinds = self.kinds();
        let Some(job) =
            self.store
                .claim_matching(&self.name, self.host.as_deref(), &kinds, self.lease)?
        else {
            return Ok(None);
        };

        let Some(handler) = self.handlers.get(&job.kind).map(Arc::clone) else {
            // The immutable registry supplied the same capability list to the claim.
            return Err(JobError::UnknownKind(job.kind.clone()));
        };

        let ctx = JobContext {
            job_id: job.id.clone(),
            logs: self.logs.clone(),
        };
        ctx.info(format!(
            "attempt {}/{} of `{}`",
            job.attempts, job.max_attempts, job.kind
        ));

        let lease = self
            .lease
            .to_std()
            .map_err(|_| JobError::InvalidWorkerConfig("lease must be positive"))?;
        let outcome = {
            let mut heartbeat =
                tokio::time::interval((lease / 3).max(std::time::Duration::from_nanos(1)));
            heartbeat.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
            let execution = handler.run(&job, &ctx);
            tokio::pin!(execution);
            loop {
                tokio::select! {
                    _ = heartbeat.tick() => {
                        if !self.store.heartbeat_owned(&job.id, &self.name, job.attempts, self.lease)? {
                            ctx.info("claim cancelled or lost; cancelling the owned handler future");
                            return Ok(Some(Outcome::Cancelled(job.id.clone())));
                        }
                    }
                    outcome = &mut execution => break outcome,
                }
            }
        };

        // The job may have been cancelled while the handler ran. Writing a
        // result over a cancellation would make `cancel` a lie.
        if !self
            .store
            .heartbeat_owned(&job.id, &self.name, job.attempts, self.lease)?
        {
            ctx.info("claim lost while running (cancelled, or recovered by another worker)");
            return Ok(Some(Outcome::Cancelled(job.id)));
        }

        match outcome {
            Ok(result) => {
                ctx.info("succeeded");
                Ok(Some(
                    if self
                        .store
                        .succeed_owned(&job.id, &self.name, job.attempts, &result)?
                        .is_some()
                    {
                        Outcome::Succeeded(job.id)
                    } else {
                        Outcome::Cancelled(job.id)
                    },
                ))
            }
            Err(err) => {
                let message = err.to_string();
                let _ = self.logs.error(&job.id, message.clone());
                let Some(after) = self.store.fail_owned(
                    &job.id,
                    &self.name,
                    job.attempts,
                    &message,
                    err.is_retryable(),
                    self.backoff,
                )?
                else {
                    return Ok(Some(Outcome::Cancelled(job.id)));
                };
                Ok(Some(if after.state == crate::JobState::Queued {
                    Outcome::Retrying(job.id)
                } else {
                    Outcome::Failed(job.id)
                }))
            }
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

    /// Execute up to `max_jobs` with a bounded number of native handler futures.
    /// SQLite mutations remain synchronous on their owning thread; handlers run
    /// concurrently without sharing a connection across threads or spawning processes.
    ///
    /// # Errors
    /// As [`Self::run_once`]. A store failure stops new claims but the already
    /// owned futures are joined before the error is returned.
    pub async fn drain_parallel(
        &self,
        max_jobs: usize,
        concurrency: NonZeroUsize,
    ) -> Result<Vec<Outcome>> {
        type Pending<'a> = Pin<Box<dyn Future<Output = Result<Option<Outcome>>> + 'a>>;
        let mut pending: Vec<Pending<'_>> = (0..max_jobs.min(concurrency.get()))
            .map(|_| Box::pin(self.run_once()) as Pending<'_>)
            .collect();
        let mut submitted = pending.len();
        let mut outcomes = Vec::new();
        let mut failure = None;
        while !pending.is_empty() {
            let (index, result) = poll_fn(|cx| {
                for (index, future) in pending.iter_mut().enumerate() {
                    if let Poll::Ready(result) = future.as_mut().poll(cx) {
                        return Poll::Ready((index, result));
                    }
                }
                Poll::Pending
            })
            .await;
            drop(pending.swap_remove(index));
            match result {
                Ok(Some(outcome)) => {
                    outcomes.push(outcome);
                    if failure.is_none() && submitted < max_jobs {
                        pending.push(Box::pin(self.run_once()));
                        submitted += 1;
                    }
                }
                Ok(None) => {}
                Err(error) => {
                    if failure.is_none() {
                        failure = Some(error);
                    }
                }
            }
        }
        failure.map_or(Ok(outcomes), Err)
    }

    /// Persistent worker loop with bounded parallelism and idle crash recovery.
    /// The host/service owner owns shutdown and placement; no remote transport is invented here.
    ///
    /// # Errors
    /// As [`Self::drain_parallel`].
    pub async fn run_forever_parallel(
        &self,
        concurrency: NonZeroUsize,
        idle: std::time::Duration,
    ) -> Result<()> {
        self.recover()?;
        loop {
            // Bound retained outcome history even when producers never stop.
            let batch_size = concurrency.get().saturating_mul(8);
            if self
                .drain_parallel(batch_size, concurrency)
                .await?
                .is_empty()
            {
                tokio::time::sleep(idle).await;
            }
            self.recover()?;
        }
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
    use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};

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
        (
            Worker::new(store, logs, "test-worker").with_handler(Arc::new(handler)),
            dir,
        )
    }

    struct Slow {
        active: Arc<AtomicUsize>,
        peak: Arc<AtomicUsize>,
        finished: Arc<AtomicBool>,
    }

    struct Running(Arc<AtomicUsize>);
    impl Drop for Running {
        fn drop(&mut self) {
            self.0.fetch_sub(1, Ordering::SeqCst);
        }
    }
    #[async_trait::async_trait]
    impl JobHandler for Slow {
        fn kind(&self) -> &'static str {
            "slow"
        }
        async fn run(
            &self,
            _job: &Job,
            _ctx: &JobContext,
        ) -> core::result::Result<serde_json::Value, HandlerError> {
            let count = self.active.fetch_add(1, Ordering::SeqCst) + 1;
            self.peak.fetch_max(count, Ordering::SeqCst);
            let _running = Running(Arc::clone(&self.active));
            tokio::time::sleep(std::time::Duration::from_millis(120)).await;
            self.finished.store(true, Ordering::SeqCst);
            Ok(serde_json::json!({"done":true}))
        }
    }
    fn slow_worker(
        store: JobStore,
        dir: &std::path::Path,
    ) -> (Worker, Arc<AtomicUsize>, Arc<AtomicUsize>, Arc<AtomicBool>) {
        let active = Arc::new(AtomicUsize::new(0));
        let peak = Arc::new(AtomicUsize::new(0));
        let finished = Arc::new(AtomicBool::new(false));
        let worker = Worker::new(store, JobLogs::new(dir.join("logs")), "slow-worker")
            .with_host("vps")
            .with_handler(Arc::new(Slow {
                active: Arc::clone(&active),
                peak: Arc::clone(&peak),
                finished: Arc::clone(&finished),
            }))
            .with_lease(Duration::milliseconds(30));
        (worker, active, peak, finished)
    }

    #[tokio::test]
    async fn a_long_running_native_handler_keeps_its_lease_while_a_sibling_recovers() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("jobs.db");
        let store = JobStore::open(&path).unwrap();
        let job = store
            .submit(&JobSpec::new("slow", serde_json::json!({})))
            .unwrap();
        let observer = JobStore::open(&path).unwrap();
        let (worker, _, _, finished) = slow_worker(store, dir.path());
        let observation = async {
            tokio::time::sleep(std::time::Duration::from_millis(70)).await;
            assert!(observer.recover().unwrap().is_clean());
            assert!(
                observer
                    .claim_matching("sibling", Some("vps"), &["slow"], Duration::seconds(1))
                    .unwrap()
                    .is_none()
            );
        };
        let (result, ()) = tokio::join!(worker.run_once(), observation);
        assert_eq!(result.unwrap(), Some(Outcome::Succeeded(job.id)));
        assert!(finished.load(Ordering::SeqCst));
    }

    #[tokio::test]
    async fn cancellation_drops_an_owned_handler_before_it_finishes() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("jobs.db");
        let store = JobStore::open(&path).unwrap();
        let job = store
            .submit(&JobSpec::new("slow", serde_json::json!({})))
            .unwrap();
        let observer = JobStore::open(&path).unwrap();
        let (worker, active, _, finished) = slow_worker(store, dir.path());
        let cancellation = async {
            tokio::time::sleep(std::time::Duration::from_millis(25)).await;
            observer.cancel(&job.id).unwrap();
        };
        let (result, ()) = tokio::join!(worker.run_once(), cancellation);
        assert_eq!(result.unwrap(), Some(Outcome::Cancelled(job.id)));
        assert_eq!(active.load(Ordering::SeqCst), 0);
        assert!(!finished.load(Ordering::SeqCst));
    }

    #[tokio::test]
    async fn bounded_parallel_handlers_run_together_without_overclaiming_the_batch() {
        let dir = tempfile::tempdir().unwrap();
        let (worker, active, peak, _) = slow_worker(JobStore::in_memory().unwrap(), dir.path());
        for _ in 0..9 {
            worker
                .store()
                .submit(&JobSpec::new("slow", serde_json::json!({})))
                .unwrap();
        }
        let outcomes = worker
            .drain_parallel(7, NonZeroUsize::new(3).unwrap())
            .await
            .unwrap();
        assert_eq!(outcomes.len(), 7);
        assert_eq!(peak.load(Ordering::SeqCst), 3);
        assert_eq!(active.load(Ordering::SeqCst), 0);
        assert_eq!(worker.store().stats().unwrap().queued, 2);
        assert!(
            worker
                .drain_parallel(0, NonZeroUsize::new(3).unwrap())
                .await
                .unwrap()
                .is_empty()
        );
    }

    #[tokio::test]
    async fn an_empty_queue_yields_no_outcome() {
        let (w, _dir) = worker(Fixed {
            kind: "x",
            answer: Ok(serde_json::json!(1)),
            permanent: false,
        });
        assert!(w.run_once().await.unwrap().is_none());
    }

    #[tokio::test]
    async fn a_successful_job_stores_its_result_and_logs_it() {
        let (w, _dir) = worker(Fixed {
            kind: "x",
            answer: Ok(serde_json::json!({ "ok": true })),
            permanent: false,
        });
        let job = w
            .store()
            .submit(&JobSpec::new("x", serde_json::json!({})))
            .unwrap();

        assert_eq!(
            w.run_once().await.unwrap(),
            Some(Outcome::Succeeded(job.id.clone()))
        );
        let done = w.store().get(&job.id).unwrap();
        assert_eq!(done.state, JobState::Succeeded);
        assert_eq!(done.result, Some(serde_json::json!({ "ok": true })));

        let log = w.logs.read(&job.id, None).unwrap();
        assert!(log.iter().any(|l| l.message.contains("attempt 1/1")));
        assert!(log.iter().any(|l| l.message == "working"));
    }

    #[tokio::test]
    async fn a_retryable_failure_returns_the_job_to_the_queue() {
        let (w, _dir) = worker(Fixed {
            kind: "x",
            answer: Err("busy"),
            permanent: false,
        });
        let job = w
            .store()
            .submit(&JobSpec::new("x", serde_json::json!({})).with_max_attempts(2))
            .unwrap();

        assert_eq!(
            w.run_once().await.unwrap(),
            Some(Outcome::Retrying(job.id.clone()))
        );
        let after = w.store().get(&job.id).unwrap();
        assert_eq!(after.state, JobState::Queued);
        assert_eq!(after.last_error.as_deref(), Some("busy"));
    }

    #[tokio::test]
    async fn a_permanent_failure_skips_the_remaining_attempts() {
        // The point of the distinction: a malformed payload must not be retried
        // three times to produce the same error three times.
        let (w, _dir) = worker(Fixed {
            kind: "x",
            answer: Err("bad payload"),
            permanent: true,
        });
        let job = w
            .store()
            .submit(&JobSpec::new("x", serde_json::json!({})).with_max_attempts(5))
            .unwrap();

        assert_eq!(
            w.run_once().await.unwrap(),
            Some(Outcome::Failed(job.id.clone()))
        );
        let after = w.store().get(&job.id).unwrap();
        assert_eq!(after.state, JobState::Failed);
        assert_eq!(
            after.attempts, 1,
            "a permanent failure must not burn the retry budget"
        );
    }

    #[tokio::test]
    async fn an_unregistered_kind_stays_queued_without_consuming_attempts() {
        let (w, _dir) = worker(Fixed {
            kind: "known",
            answer: Ok(serde_json::json!(1)),
            permanent: false,
        });
        let job = w
            .store()
            .submit(&JobSpec::new("unknown", serde_json::json!({})))
            .unwrap();

        assert_eq!(w.run_once().await.unwrap(), None);
        let after = w.store().get(&job.id).unwrap();
        assert_eq!(after.state, JobState::Queued);
        assert_eq!(after.attempts, 0);
        assert!(after.last_error.is_none());
    }

    #[tokio::test]
    async fn draining_stops_at_the_cap() {
        let (w, _dir) = worker(Fixed {
            kind: "x",
            answer: Ok(serde_json::json!(1)),
            permanent: false,
        });
        for _ in 0..5 {
            w.store()
                .submit(&JobSpec::new("x", serde_json::json!({})))
                .unwrap();
        }
        assert_eq!(w.drain(3).await.unwrap().len(), 3);
        assert_eq!(
            w.store()
                .list(&ListFilter::default().state(JobState::Queued))
                .unwrap()
                .len(),
            2
        );
    }

    #[tokio::test]
    async fn draining_an_empty_queue_returns_nothing_rather_than_spinning() {
        let (w, _dir) = worker(Fixed {
            kind: "x",
            answer: Ok(serde_json::json!(1)),
            permanent: false,
        });
        assert!(w.drain(100).await.unwrap().is_empty());
    }

    #[test]
    fn registered_kinds_are_reported_sorted() {
        let dir = tempfile::tempdir().unwrap();
        let w = Worker::new(
            JobStore::in_memory().unwrap(),
            JobLogs::new(dir.path()),
            "w",
        )
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
