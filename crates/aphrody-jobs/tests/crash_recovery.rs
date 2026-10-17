// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 aphrody contributors
//
//! Crash recovery against a real file, not an in-memory database.
//!
//! The unit tests drive `recover_at` with a synthetic clock. That proves the
//! rule but not the plumbing: it never closes a connection, never reopens the
//! file, and never checks that a claim written by one process is visible to the
//! next. This does all three — which is the actual failure being guarded
//! against, a worker killed mid-job leaving work stranded in `running`.

use std::sync::Arc;

use aphrody_jobs::{
    HandlerError, Job, JobContext, JobHandler, JobLogs, JobSpec, JobState, JobStore, Worker,
};
use chrono::Duration;

/// A handler that never returns — it stands in for a worker killed mid-job.
struct NeverFinishes;

#[async_trait::async_trait]
impl JobHandler for NeverFinishes {
    fn kind(&self) -> &str {
        "slow"
    }

    async fn run(&self, _job: &Job, ctx: &JobContext) -> Result<serde_json::Value, HandlerError> {
        ctx.info("started, and about to be killed");
        futures_hang().await
    }
}

async fn futures_hang() -> Result<serde_json::Value, HandlerError> {
    // A future that is never ready: dropping it is what a SIGKILL looks like
    // from the queue's point of view — a claim with no completion.
    core::future::pending().await
}

struct Echo;

#[async_trait::async_trait]
impl JobHandler for Echo {
    fn kind(&self) -> &str {
        "slow"
    }

    async fn run(&self, job: &Job, _ctx: &JobContext) -> Result<serde_json::Value, HandlerError> {
        Ok(job.payload.clone())
    }
}

#[tokio::test]
async fn a_job_abandoned_by_a_dead_worker_is_finished_by_the_next_one() {
    let dir = tempfile::tempdir().unwrap();
    let db = dir.path().join("jobs.db");
    let logs = JobLogs::new(dir.path().join("logs"));

    // --- the doomed worker -------------------------------------------------
    let job_id = {
        let worker = Worker::new(JobStore::open(&db).unwrap(), logs.clone(), "worker-doomed")
            .with_handler(Arc::new(NeverFinishes))
            // A lease short enough that the test does not have to wait a minute.
            .with_lease(Duration::seconds(1));

        let submitted = worker
            .store()
            .submit(&JobSpec::new("slow", serde_json::json!({ "n": 7 })).with_max_attempts(2))
            .unwrap();

        // Let it claim and start, then drop the future mid-flight: no success,
        // no failure, no heartbeat. Exactly what a killed process leaves.
        let running = worker.run_once();
        let killed = tokio::time::timeout(std::time::Duration::from_millis(200), running).await;
        assert!(
            killed.is_err(),
            "the handler must still have been running when dropped"
        );

        let stranded = worker.store().get(&submitted.id).unwrap();
        assert_eq!(
            stranded.state,
            JobState::Running,
            "the claim must be on disk"
        );
        assert_eq!(stranded.worker.as_deref(), Some("worker-doomed"));
        submitted.id
    }; // both the worker and its connection go away here, as on a crash

    // --- the next worker, in a fresh process's shoes -----------------------
    // Wait past the lease so the claim is genuinely expired, using real time
    // rather than an injected clock.
    tokio::time::sleep(std::time::Duration::from_millis(1_200)).await;

    let worker =
        Worker::new(JobStore::open(&db).unwrap(), logs, "worker-next").with_handler(Arc::new(Echo));

    // Without recovery the job is invisible: it still reads as running.
    assert!(
        worker.run_once().await.unwrap().is_none(),
        "a stale claim must not be claimable"
    );

    let report = worker.recover().unwrap();
    assert_eq!(
        report.requeued,
        vec![job_id.clone()],
        "the stranded job must come back"
    );

    let outcome = worker.run_once().await.unwrap();
    assert_eq!(
        outcome,
        Some(aphrody_jobs::Outcome::Succeeded(job_id.clone()))
    );

    let done = worker.store().get(&job_id).unwrap();
    assert_eq!(done.state, JobState::Succeeded);
    assert_eq!(done.result, Some(serde_json::json!({ "n": 7 })));
    assert_eq!(done.attempts, 2, "the abandoned run counts as an attempt");
}

#[tokio::test]
async fn the_log_written_before_the_crash_survives_it() {
    let dir = tempfile::tempdir().unwrap();
    let db = dir.path().join("jobs.db");
    let logs = JobLogs::new(dir.path().join("logs"));

    let job_id = {
        let worker = Worker::new(JobStore::open(&db).unwrap(), logs.clone(), "doomed")
            .with_handler(Arc::new(NeverFinishes))
            .with_lease(Duration::seconds(1));
        let submitted = worker
            .store()
            .submit(&JobSpec::new("slow", serde_json::json!({})))
            .unwrap();
        let _ =
            tokio::time::timeout(std::time::Duration::from_millis(200), worker.run_once()).await;
        submitted.id
    };

    // The whole point of appending per line: what was written before the kill
    // is readable afterwards, which is when someone wants to know how far it got.
    let lines = logs.read(&job_id, None).unwrap();
    assert!(
        lines
            .iter()
            .any(|l| l.message.contains("about to be killed")),
        "progress logged before the crash must survive it: {lines:?}"
    );
}
