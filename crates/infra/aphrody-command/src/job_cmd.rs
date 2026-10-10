// SPDX-License-Identifier: Apache-2.0
//! `aphrody job …` — the persistent background queue.
//!
//! Built only with `--features jobs`, which links `aphrody-jobs` (bundled
//! libsqlite3, host-only).
//!
//! This is the surface for the toolbox's fourth usage: work that outlives the
//! process that asked for it. A submission returns immediately with an id; a
//! worker picks it up, and a machine that dies mid-job hands the work back
//! rather than stranding it.
//!
//! # Handlers
//!
//! `aphrody-jobs` knows nothing about transcription — a `kind` names a handler
//! and the payload is opaque JSON. The real handlers are registered here,
//! where the model crates already are.

use std::{future::Future, num::NonZeroUsize, path::PathBuf, sync::Arc};

use aphrody_jobs::{
    HandlerError, HostAffinity, Job, JobContext, JobHandler, JobLogs, JobSpec, JobState, JobStore,
    ListFilter, Outcome, Worker,
};
use aphrody_models::Report;

use crate::model_cmd::OutputOpts;

/// Actions for the `job` subcommand.
#[derive(clap::Subcommand, Debug, Clone)]
pub(crate) enum JobAction {
    /// Queue an audio file for local transcription and return immediately.
    ///
    /// The weights are resolved from the model store at run time, not now:
    /// submitting must not block on a download.
    ///
    /// Example: aphrody job transcribe ./meeting.wav --model whisper-large-v3-turbo-q8
    Transcribe {
        /// Audio file: 16 kHz mono WAV, or raw little-endian f32 samples.
        input: PathBuf,
        /// Catalog id or path to a GGML file.
        #[arg(long, default_value = aphrody_models::LocalRole::Stt.default_model())]
        model: String,
        /// Write the transcript text here when the job succeeds.
        #[arg(long, value_name = "PATH")]
        out_text: Option<PathBuf>,
        /// BCP-47 language tag. Omit to let the model detect it.
        #[arg(long)]
        language: Option<String>,
        /// Total runs allowed, including the first.
        #[arg(long, default_value_t = 3)]
        max_attempts: u32,
        /// Higher runs first.
        #[arg(long, default_value_t = 0)]
        priority: i64,
        /// Restrict placement to these existing catalog host identities.
        #[arg(long = "host", value_name = "HOST")]
        hosts: Vec<String>,
        /// Stable durable intent key for safe retries after a lost acknowledgement.
        #[arg(long)]
        idempotency_key: Option<String>,
        #[command(flatten)]
        output: OutputOpts,
    },
    /// Queue a job of any registered kind with a raw JSON payload.
    ///
    /// Example: aphrody job submit transcribe --payload '{"input":"a.wav"}'
    Submit {
        /// Handler name.
        kind: String,
        /// Handler arguments, as a JSON object.
        #[arg(long, default_value = "{}")]
        payload: String,
        /// Total runs allowed, including the first.
        #[arg(long, default_value_t = 1)]
        max_attempts: u32,
        /// Higher runs first.
        #[arg(long, default_value_t = 0)]
        priority: i64,
        /// Restrict placement to these existing catalog host identities.
        #[arg(long = "host", value_name = "HOST")]
        hosts: Vec<String>,
        /// Stable durable intent key for safe retries after a lost acknowledgement.
        #[arg(long)]
        idempotency_key: Option<String>,
        #[command(flatten)]
        output: OutputOpts,
    },
    /// List jobs, newest first.
    ///
    /// Example: aphrody job list --state failed --json
    List {
        /// Only this state: queued, running, succeeded, failed, cancelled.
        #[arg(long)]
        state: Option<String>,
        /// Only this handler kind.
        #[arg(long)]
        kind: Option<String>,
        /// At most this many rows.
        #[arg(long, default_value_t = 50)]
        limit: u32,
        #[command(flatten)]
        output: OutputOpts,
    },
    /// Show one job, including its result or its last error.
    Status {
        /// Job id.
        id: String,
        #[command(flatten)]
        output: OutputOpts,
    },
    /// Print a job's NDJSON log.
    ///
    /// Readable while the job is still running — that is the point of writing
    /// it per line rather than at the end.
    Logs {
        /// Job id.
        id: String,
        /// Only the last N lines.
        #[arg(long)]
        tail: Option<usize>,
    },
    /// Cancel a queued or running job.
    ///
    /// A running job is not killed: its worker observes the cancellation at
    /// the next heartbeat and stops. The exit status reflects the state
    /// change, not the death of a child process.
    Cancel {
        /// Job id.
        id: String,
        #[command(flatten)]
        output: OutputOpts,
    },
    /// Run jobs: recover what a previous run abandoned, then consume.
    ///
    /// Example: aphrody job run --forever
    Run {
        /// Keep polling instead of stopping when the queue empties.
        #[arg(long)]
        forever: bool,
        /// Stop after this many jobs (ignored with `--forever`).
        #[arg(long, default_value_t = 100)]
        max_jobs: usize,
        /// Seconds to wait between polls of an empty queue.
        #[arg(long, default_value_t = 2)]
        idle_secs: u64,
        /// Name recorded on every claim this worker takes.
        #[arg(long)]
        worker: Option<String>,
        /// This worker's catalog host identity, used for placement filtering.
        #[arg(long)]
        host: Option<String>,
        /// Maximum jobs executing concurrently on this host.
        #[arg(long, default_value = "1")]
        concurrency: NonZeroUsize,
        #[command(flatten)]
        output: OutputOpts,
    },
    /// Counts per state, and where the queue lives.
    Stats {
        #[command(flatten)]
        output: OutputOpts,
    },
    /// Delete finished jobs older than N days, with their logs.
    ///
    /// Queued and running jobs are never removed, whatever their age.
    Purge {
        /// Age threshold in days.
        #[arg(long, default_value_t = 30)]
        older_than_days: i64,
        #[command(flatten)]
        output: OutputOpts,
    },
}

/// Run a `job` action.
///
/// # Errors
///
/// Returns a `miette` report when the queue cannot be opened, the id is
/// unknown, or a payload is not JSON.
pub(crate) async fn run(action: JobAction) -> miette::Result<()> {
    match action {
        JobAction::Transcribe {
            input,
            model,
            out_text,
            language,
            max_attempts,
            priority,
            hosts,
            idempotency_key,
            output,
        } => {
            let payload = serde_json::json!({
                "input": input,
                "model": model,
                "out_text": out_text,
                "language": language,
            });
            submit(
                &JobSpec::new(TranscribeHandler::KIND, payload)
                    .with_max_attempts(max_attempts)
                    .with_priority(priority)
                    .with_host_affinity(affinity(hosts))
                    .with_optional_idempotency_key(idempotency_key),
                &output,
            )
        },
        JobAction::Submit {
            kind,
            payload,
            max_attempts,
            priority,
            hosts,
            idempotency_key,
            output,
        } => {
            let parsed: serde_json::Value = serde_json::from_str(&payload)
                .map_err(|e| miette::miette!("--payload is not valid JSON: {e}"))?;
            submit(
                &JobSpec::new(kind, parsed)
                    .with_max_attempts(max_attempts)
                    .with_priority(priority)
                    .with_host_affinity(affinity(hosts))
                    .with_optional_idempotency_key(idempotency_key),
                &output,
            )
        },
        JobAction::List { state, kind, limit, output } => {
            list(state.as_deref(), kind, limit, &output)
        },
        JobAction::Status { id, output } => status(&id, &output),
        JobAction::Logs { id, tail } => logs(&id, tail),
        JobAction::Cancel { id, output } => cancel(&id, &output),
        JobAction::Run { forever, max_jobs, idle_secs, worker, host, concurrency, output } => {
            run_worker(forever, max_jobs, idle_secs, worker, host, concurrency, &output).await
        },
        JobAction::Stats { output } => stats(&output),
        JobAction::Purge { older_than_days, output } => purge(older_than_days, &output),
    }
}

// -- wiring -------------------------------------------------------------------

/// Where the queue and its logs live, under the same root as models and
/// runtimes so one directory holds everything the toolbox owns.
fn paths() -> miette::Result<(PathBuf, PathBuf)> {
    let root = aphrody_root()?;
    Ok((aphrody_jobs::default_db_path(&root), aphrody_jobs::default_log_dir(&root)))
}

fn aphrody_root() -> miette::Result<PathBuf> {
    // One authority for `~/.aphrody` (`aphrody_models::paths`), so the queue
    // and the weights it resolves at run time always live in the same tree.
    aphrody_models::paths::state_dir()
        .map_err(|_| miette::miette!("cannot locate the home directory (set APHRODY_HOME)"))
}

fn store() -> miette::Result<JobStore> {
    let (db, _) = paths()?;
    JobStore::open(&db)
        .map_err(|e| miette::miette!("cannot open the job queue at {}: {e}", db.display()))
}

fn job_logs() -> miette::Result<JobLogs> {
    let (_, dir) = paths()?;
    Ok(JobLogs::new(dir))
}

// -- the real handler ---------------------------------------------------------

/// Transcribes an audio file with the local whisper.cpp backend.
///
/// The weights are resolved when the job runs, not when it is submitted: a
/// queue whose submissions blocked on a download would not be a queue.
struct TranscribeHandler;

impl TranscribeHandler {
    const KIND: &'static str = "transcribe";
}

/// The payload `transcribe` accepts.
#[derive(serde::Deserialize)]
struct TranscribePayload {
    input: PathBuf,
    #[serde(default = "default_model")]
    model: String,
    #[serde(default)]
    out_text: Option<PathBuf>,
    #[serde(default)]
    language: Option<String>,
}

fn default_model() -> String {
    aphrody_models::LocalRole::Stt.default_model().to_owned()
}

#[async_trait::async_trait]
impl JobHandler for TranscribeHandler {
    fn kind(&self) -> &str {
        Self::KIND
    }

    async fn run(&self, job: &Job, ctx: &JobContext) -> Result<serde_json::Value, HandlerError> {
        use aphrody_voice::stt::{SttOptions, SttProvider as _, whisper_cpp::WhisperCppBackend};

        let payload: TranscribePayload = serde_json::from_value(job.payload.clone())
            .map_err(|e| HandlerError::Permanent(format!("bad payload: {e}")))?;

        // A missing input cannot be fixed by trying again.
        let audio = tokio::fs::read(&payload.input).await.map_err(|e| {
            HandlerError::Permanent(format!("cannot read {}: {e}", payload.input.display()))
        })?;
        ctx.info(format!(
            "transcribing {} ({} bytes) with `{}`",
            payload.input.display(),
            audio.len(),
            payload.model
        ));

        let backend = WhisperCppBackend::new(payload.model.clone());
        let opts = SttOptions { language: payload.language.clone(), ..SttOptions::default() };

        let transcript = backend.transcribe(&audio, opts).await.map_err(classify)?;

        if let Some(target) = &payload.out_text {
            tokio::fs::write(target, &transcript.text).await.map_err(|e| {
                HandlerError::Permanent(format!("cannot write {}: {e}", target.display()))
            })?;
            ctx.info(format!("wrote {}", target.display()));
        }

        Ok(serde_json::json!({
            "text": transcript.text,
            "language": transcript.language,
            "duration_s": transcript.duration_s,
            "segments": transcript.segments,
        }))
    }
}

/// Decide whether a transcription failure is worth another attempt.
///
/// The split matters: a missing model or an unreadable file produces the same
/// error on every retry, so burning the attempt budget on it only buries the
/// message under its own repeats. A child process that failed to spawn, on the
/// other hand, may well work on the next pass.
fn classify(err: aphrody_voice::stt::SttError) -> HandlerError {
    use aphrody_voice::stt::SttError;
    match err {
        // The machine has no whisper.cpp, or the model is not pulled: state of
        // the host, not of this run.
        SttError::NotImplemented { .. } | SttError::EmptyInput => {
            HandlerError::Permanent(err.to_string())
        },
        SttError::Other(msg) => {
            let permanent = msg.contains("is not installed")
                || msg.contains("unknown model spec")
                || msg.contains("unrecognised audio")
                || msg.contains("requires");
            if permanent { HandlerError::Permanent(msg) } else { HandlerError::Retryable(msg) }
        },
        other => HandlerError::Retryable(other.to_string()),
    }
}

fn affinity(hosts: Vec<String>) -> HostAffinity {
    if hosts.is_empty() { HostAffinity::Any } else { HostAffinity::Hosts(hosts) }
}

/// Construct the product worker against the protected local queue and logs.
/// Service owners drive its bounded loop directly, without command-output capture.
///
/// # Errors
/// Returns an error when the queue or protected state directory cannot be opened.
pub fn create_job_worker(name: String, host: Option<String>) -> miette::Result<Worker> {
    let worker = Worker::new(store()?, job_logs()?, name)
        .with_handler(Arc::new(TranscribeHandler))
        .with_handler(Arc::new(WebPipelineHandler));
    Ok(match host {
        Some(host) => worker.with_host(host),
        None => worker,
    })
}

/// Product Web ingestion runs through the same owner as the CLI and FFI.
struct WebPipelineHandler;

#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields)]
struct WebPipelinePayload {
    args: Vec<String>,
}

#[async_trait::async_trait]
impl JobHandler for WebPipelineHandler {
    fn kind(&self) -> &str {
        "web-pipeline"
    }

    async fn run(&self, job: &Job, ctx: &JobContext) -> Result<serde_json::Value, HandlerError> {
        let payload: WebPipelinePayload = serde_json::from_value(job.payload.clone())
            .map_err(|error| HandlerError::Permanent(format!("bad Web payload: {error}")))?;
        ctx.info("running native Web pipeline");
        let result = run_owned_local(move || crate::run_web_pipeline(payload.args)).await?;
        result.map_err(|error| HandlerError::Permanent(format!("Web pipeline failed: {error}")))
    }
}

/// Native browser futures are not Send. Their factory crosses into the existing
/// runtime's blocking pool; construction, polling and destruction remain on that
/// one thread. Dropping the handler closes the channel and cancels the local
/// future, including when its lease was lost. No new runtime or child process.
async fn run_owned_local<F, Fut, T>(factory: F) -> Result<T, HandlerError>
where
    F: FnOnce() -> Fut + Send + 'static,
    Fut: Future<Output = T>,
    T: Send + 'static,
{
    let handle = tokio::runtime::Handle::current();
    let (_cancel_on_drop, mut cancelled) = tokio::sync::oneshot::channel::<()>();
    let task = tokio::task::spawn_blocking(move || {
        handle.block_on(async move {
            let local = factory();
            tokio::pin!(local);
            tokio::select! {
                biased;
                _ = &mut cancelled => None,
                result = &mut local => Some(result),
            }
        })
    });
    task.await
        .map_err(|error| HandlerError::Retryable(format!("native worker task failed: {error}")))?
        .ok_or_else(|| HandlerError::Permanent("native worker was cancelled".into()))
}

// -- actions ------------------------------------------------------------------

fn submit(spec: &JobSpec, output: &OutputOpts) -> miette::Result<()> {
    let store = store()?;
    let job = store.submit(spec).map_err(|e| miette::miette!("cannot submit: {e}"))?;

    let mut report = Report::new("Submitted", &["ID", "KIND", "STATE", "ATTEMPTS"]);
    report.push(vec![
        job.id.clone(),
        job.kind.clone(),
        job.state.to_string(),
        format!("0/{}", job.max_attempts),
    ]);
    let report = report.with_footer(format!(
        "run it with: aphrody job run   ·   follow it with: aphrody job status {}",
        job.id
    ));
    output.emit_report(&report, &serde_json::to_value(&job).unwrap_or_default())
}

fn list(
    state: Option<&str>,
    kind: Option<String>,
    limit: u32,
    output: &OutputOpts,
) -> miette::Result<()> {
    let mut filter = ListFilter::default().limit(limit);
    if let Some(raw) = state {
        let parsed = JobState::parse(raw).ok_or_else(|| {
            miette::miette!(
                "unknown state `{raw}` (expected one of: queued, running, succeeded, failed, \
                 cancelled)"
            )
        })?;
        filter = filter.state(parsed);
    }
    if let Some(kind) = kind {
        filter = filter.kind(kind);
    }

    let store = store()?;
    let jobs = store.list(&filter).map_err(|e| miette::miette!("cannot list jobs: {e}"))?;

    let mut report = Report::new("Jobs", &["ID", "KIND", "STATE", "ATTEMPTS", "UPDATED"]);
    for job in &jobs {
        report.push(vec![
            job.id.clone(),
            job.kind.clone(),
            job.state.to_string(),
            format!("{}/{}", job.attempts, job.max_attempts),
            job.updated_at.to_rfc3339_opts(chrono::SecondsFormat::Secs, true),
        ]);
    }
    let report = report.with_footer(format!("{} job(s)", jobs.len()));
    output.emit_report(&report, &serde_json::to_value(&jobs).unwrap_or_default())
}

fn status(id: &str, output: &OutputOpts) -> miette::Result<()> {
    let store = store()?;
    let job = store.get(id).map_err(|e| miette::miette!("{e}"))?;

    let mut report = Report::new("Job", &["FIELD", "VALUE"]);
    report.push(vec!["id".into(), job.id.clone()]);
    report.push(vec!["kind".into(), job.kind.clone()]);
    report.push(vec!["state".into(), job.state.to_string()]);
    report.push(vec!["attempts".into(), format!("{}/{}", job.attempts, job.max_attempts)]);
    report.push(vec![
        "created".into(),
        job.created_at.to_rfc3339_opts(chrono::SecondsFormat::Secs, true),
    ]);
    report.push(vec![
        "updated".into(),
        job.updated_at.to_rfc3339_opts(chrono::SecondsFormat::Secs, true),
    ]);
    if let Some(w) = &job.worker {
        report.push(vec!["worker".into(), w.clone()]);
    }
    if let Some(err) = &job.last_error {
        report.push(vec!["last error".into(), err.clone()]);
    }
    if let Some(result) = &job.result {
        // The full result goes to JSON output; the table gets the readable
        // part, because a transcript pasted into a table cell is unreadable.
        let summary = result
            .get("text")
            .and_then(serde_json::Value::as_str)
            .map_or_else(|| result.to_string(), truncate);
        report.push(vec!["result".into(), summary]);
    }
    output.emit_report(&report, &serde_json::to_value(&job).unwrap_or_default())
}

/// Keep a table cell readable without losing the fact that there is more.
fn truncate(text: &str) -> String {
    const MAX: usize = 160;
    let flat = text.replace('\n', " ");
    if flat.chars().count() <= MAX {
        return flat;
    }
    let kept: String = flat.chars().take(MAX).collect();
    format!("{kept}… ({} chars total)", flat.chars().count())
}

fn logs(id: &str, tail: Option<usize>) -> miette::Result<()> {
    let logs = job_logs()?;
    let lines = logs.read(id, tail).map_err(|e| miette::miette!("cannot read the log: {e}"))?;
    if lines.is_empty() {
        eprintln!("no log for job `{id}` (it may not have started yet)");
        return Ok(());
    }
    for line in lines {
        // NDJSON out, one object per line: the same shape the file holds, so a
        // pipe into jq works the same as reading the file.
        println!("{}", serde_json::to_string(&line).unwrap_or_default());
    }
    Ok(())
}

fn cancel(id: &str, output: &OutputOpts) -> miette::Result<()> {
    let store = store()?;
    let job = store.cancel(id).map_err(|e| miette::miette!("{e}"))?;
    let mut report = Report::new("Cancelled", &["ID", "STATE"]);
    report.push(vec![job.id.clone(), job.state.to_string()]);
    let report = report.with_footer("a running job stops at its next heartbeat, not instantly");
    output.emit_report(&report, &serde_json::to_value(&job).unwrap_or_default())
}

async fn run_worker(
    forever: bool,
    max_jobs: usize,
    idle_secs: u64,
    name: Option<String>,
    host: Option<String>,
    concurrency: NonZeroUsize,
    output: &OutputOpts,
) -> miette::Result<()> {
    let name = name.unwrap_or_else(default_worker_name);
    let worker = create_job_worker(name.clone(), host)?;

    let recovered = worker.recover().map_err(|e| miette::miette!("recovery failed: {e}"))?;
    if !recovered.is_clean() {
        eprintln!(
            "recovered {} requeued / {} exhausted job(s) from a previous run",
            recovered.requeued.len(),
            recovered.exhausted.len()
        );
    }

    if forever {
        eprintln!("worker `{name}` consuming {:?}; ctrl-c to stop", worker.kinds());
        worker
            .run_forever_parallel(concurrency, std::time::Duration::from_secs(idle_secs))
            .await
            .map_err(|e| miette::miette!("worker stopped: {e}"))?;
        return Ok(());
    }

    let outcomes = worker
        .drain_parallel(max_jobs, concurrency)
        .await
        .map_err(|e| miette::miette!("worker failed: {e}"))?;

    let mut report = Report::new("Ran", &["OUTCOME", "ID"]);
    for outcome in &outcomes {
        let (label, id) = match outcome {
            Outcome::Succeeded(id) => ("succeeded", id),
            Outcome::Retrying(id) => ("retrying", id),
            Outcome::Failed(id) => ("failed", id),
            Outcome::Cancelled(id) => ("cancelled", id),
        };
        report.push(vec![label.to_owned(), id.clone()]);
    }
    let report = report.with_footer(format!("{} job(s) run by `{name}`", outcomes.len()));
    let json = serde_json::json!({
        "worker": name,
        "recovered": recovered,
        "concurrency": concurrency.get(),
        "ran": outcomes.len(),
    });
    output.emit_report(&report, &json)
}

/// A worker name that identifies the machine and process without needing
/// configuration — this is what makes a stuck claim attributable.
fn default_worker_name() -> String {
    let host = std::env::var("COMPUTERNAME")
        .or_else(|_| std::env::var("HOSTNAME"))
        .unwrap_or_else(|_| "local".to_owned());
    format!("{host}:{}", std::process::id())
}

fn stats(output: &OutputOpts) -> miette::Result<()> {
    let store = store()?;
    let stats = store.stats().map_err(|e| miette::miette!("cannot read the queue: {e}"))?;
    let (db, logs) = paths()?;

    let mut report = Report::new("Queue", &["STATE", "COUNT"]);
    report.push(vec!["queued".into(), stats.queued.to_string()]);
    report.push(vec!["running".into(), stats.running.to_string()]);
    report.push(vec!["succeeded".into(), stats.succeeded.to_string()]);
    report.push(vec!["failed".into(), stats.failed.to_string()]);
    report.push(vec!["cancelled".into(), stats.cancelled.to_string()]);
    let report = report.with_footer(format!("db {}  ·  logs {}", db.display(), logs.display()));

    let json = serde_json::json!({ "stats": stats, "db": db, "logs": logs });
    output.emit_report(&report, &json)
}

fn purge(older_than_days: i64, output: &OutputOpts) -> miette::Result<()> {
    let store = store()?;
    let logs = job_logs()?;
    let cutoff = chrono::Utc::now() - chrono::Duration::days(older_than_days);

    // Collect the ids first: once the rows are gone there is nothing left to
    // tell which log files became orphans.
    let doomed: Vec<String> = store
        .list(&ListFilter::default())
        .map_err(|e| miette::miette!("cannot list jobs: {e}"))?
        .into_iter()
        .filter(|j| j.state.is_terminal() && j.updated_at < cutoff)
        .map(|j| j.id)
        .collect();

    let removed = store.purge_before(cutoff).map_err(|e| miette::miette!("cannot purge: {e}"))?;
    let mut logs_removed = 0u64;
    for id in &doomed {
        if logs.remove(id).unwrap_or(false) {
            logs_removed += 1;
        }
    }

    let mut report = Report::new("Purged", &["WHAT", "COUNT"]);
    report.push(vec!["jobs".into(), removed.to_string()]);
    report.push(vec!["logs".into(), logs_removed.to_string()]);
    let report = report.with_footer(format!("finished jobs older than {older_than_days} day(s)"));
    output.emit_report(
        &report,
        &serde_json::json!({ "jobs": removed, "logs": logs_removed, "cutoff": cutoff }),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn placement_and_concurrency_are_native_command_arguments() {
        #[derive(clap::Parser)]
        struct Request {
            #[command(subcommand)]
            action: JobAction,
        }
        use clap::Parser as _;
        let submit = Request::try_parse_from([
            "job",
            "submit",
            "web-pipeline",
            "--host",
            "vps",
            "--host",
            "wsl",
        ])
        .unwrap();
        match submit.action {
            JobAction::Submit { hosts, .. } => assert_eq!(hosts, ["vps", "wsl"]),
            _ => panic!("expected submit"),
        }
        let run =
            Request::try_parse_from(["job", "run", "--host", "vps", "--concurrency", "3"]).unwrap();
        match run.action {
            JobAction::Run { host, concurrency, .. } => {
                assert_eq!(host.as_deref(), Some("vps"));
                assert_eq!(concurrency.get(), 3);
            },
            _ => panic!("expected run"),
        }
        assert!(Request::try_parse_from(["job", "run", "--concurrency", "0"]).is_err());
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn local_native_future_is_created_and_polled_on_one_thread() {
        let caller = std::thread::current().id();
        let owner = run_owned_local(|| async {
            let local = std::rc::Rc::new(std::thread::current().id());
            tokio::time::sleep(std::time::Duration::from_millis(10)).await;
            assert_eq!(*local, std::thread::current().id());
            *local
        })
        .await
        .unwrap();
        assert_ne!(owner, caller);
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn dropping_handler_cancels_its_owned_native_future() {
        use std::sync::atomic::{AtomicBool, Ordering};
        struct Dropped(Arc<AtomicBool>);
        impl Drop for Dropped {
            fn drop(&mut self) {
                self.0.store(true, Ordering::SeqCst);
            }
        }
        let dropped = Arc::new(AtomicBool::new(false));
        let marker = dropped.clone();
        let (started, ready) = tokio::sync::oneshot::channel();
        let owned = tokio::spawn(run_owned_local(move || async move {
            let _guard = Dropped(marker);
            let local = std::rc::Rc::new(1);
            let _ = started.send(());
            tokio::time::sleep(std::time::Duration::from_secs(5)).await;
            *local
        }));
        ready.await.unwrap();
        owned.abort();
        assert!(owned.await.unwrap_err().is_cancelled());
        tokio::time::timeout(std::time::Duration::from_secs(1), async {
            while !dropped.load(Ordering::SeqCst) {
                tokio::task::yield_now().await;
            }
        })
        .await
        .unwrap();
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn web_handler_rejects_commands_outside_the_pipeline() {
        let result =
            run_owned_local(|| crate::run_web_pipeline(vec!["status".into()])).await.unwrap();
        assert!(result.is_err());
        assert!(
            serde_json::from_value::<WebPipelinePayload>(serde_json::json!({
                "args": ["crawl-index", "https://aphrody.com"], "shell": "not allowed"
            }))
            .is_err()
        );
    }

    #[test]
    fn a_payload_without_a_model_falls_back_to_the_default_catalog_entry() {
        let payload: TranscribePayload =
            serde_json::from_value(serde_json::json!({ "input": "a.wav" })).unwrap();
        assert_eq!(payload.model, aphrody_models::LocalRole::Stt.default_model());
        assert!(payload.out_text.is_none());
    }

    #[test]
    fn a_payload_without_an_input_is_rejected() {
        // The handler turns this into a Permanent failure: no retry can supply
        // a field the caller did not send.
        let parsed: Result<TranscribePayload, _> =
            serde_json::from_value(serde_json::json!({ "model": "whisper-large-v3-turbo-q8" }));
        assert!(parsed.is_err());
    }

    #[test]
    fn a_missing_model_is_permanent_but_a_spawn_failure_is_retryable() {
        use aphrody_voice::stt::SttError;
        assert!(
            !classify(SttError::Other(
                "model `whisper-large-v3-turbo-q8` is not installed; run `aphrody model pull \
                 whisper-large-v3-turbo-q8`"
                    .into()
            ))
            .is_retryable()
        );
        assert!(
            !classify(SttError::NotImplemented { reason: "whisper.cpp is not installed" })
                .is_retryable()
        );
        assert!(
            classify(SttError::Other("cannot spawn whisper-cli.exe: Access is denied".into()))
                .is_retryable()
        );
    }

    #[test]
    fn a_long_transcript_is_truncated_with_its_true_length() {
        let long = "a".repeat(500);
        let shown = truncate(&long);
        assert!(shown.contains("500 chars total"), "{shown}");
        assert!(shown.chars().count() < 200);
    }

    #[test]
    fn a_short_transcript_is_shown_whole_and_flattened() {
        assert_eq!(truncate("one\ntwo"), "one two");
    }

    #[test]
    fn the_worker_name_carries_the_process_id() {
        let name = default_worker_name();
        assert!(name.contains(&std::process::id().to_string()), "{name}");
    }
}
