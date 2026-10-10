// SPDX-License-Identifier: Apache-2.0
//! Batches: many operations, one call, bounded concurrency, per-operation error isolation, retry
//! and rate-limit waiting owned by Rust, and a resumable JSONL checkpoint.
//!
//! [`run_batch`] dispatches the operations in input order with at most `concurrency` in flight and
//! pushes one envelope (see [`crate::ops`]) per operation into a [`BatchChannel`] as soon as it
//! completes; the caller drains the channel at its own pace (back pressure stops dispatching when
//! more than `buffer` results wait). The failure of one operation never stops the others, with one
//! exception: an `auth` failure (a dead session) stops the dispatch of the rest, because relaunching
//! against rejected credentials repairs nothing and is exactly what gets an account flagged.
//!
//! # Checkpoint
//!
//! With `checkpoint: "run.jsonl"` every completed operation is appended as one JSON line (its
//! envelope). A later run with the same file replays the *final* results (a success, or a
//! `terminal` / `invalid` failure) flagged `"resumed": true` without executing them again; `transient`,
//! `rate_limit`, `auth` and `other` failures run again. A torn last line (the process was killed
//! mid-write) is ignored. The file holds results, never credentials.

use std::{
    collections::{HashMap, HashSet, VecDeque},
    fs::OpenOptions,
    io::{BufRead, BufReader, Write},
    path::{Path, PathBuf},
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, AtomicUsize, Ordering},
    },
    time::{Duration, Instant},
};

use serde::Deserialize;
use serde_json::{Value, json};
use tokio::{sync::Notify, sync::Semaphore, task::JoinSet};

use crate::{
    Result, XClient, XError,
    ops::{RunOptions, envelope_is_final, envelope_kind, error_envelope, execute},
    policy::{ErrorInfo, ErrorKind, Pacer, PacingOptions, RetryPolicy},
};

/// One operation of a batch.
#[derive(Debug, Clone, Deserialize)]
pub struct BatchOp {
    /// Caller identity of the operation (unique in the batch, stable across runs: it keys the
    /// checkpoint). When absent a stable hash of the operation and its arguments is used.
    #[serde(default)]
    pub id: Option<String>,
    /// The operation name (see [`crate::ops::OPS`]).
    pub op: String,
    /// Its arguments.
    #[serde(default)]
    pub args: Value,
}

/// Options of a batch.
#[derive(Debug, Clone, Deserialize)]
#[serde(default)]
pub struct BatchOptions {
    /// Operations in flight at once (1 to 256, default 4).
    pub concurrency: usize,
    /// Retry and waiting policy.
    pub retry: RetryPolicy,
    /// Pacing of mutating operations (off by default).
    pub pacing: Option<PacingOptions>,
    /// JSONL results file; enables resume.
    pub checkpoint: Option<PathBuf>,
    /// Per-request timeout in milliseconds (default 120 000).
    pub timeout_ms: u64,
    /// Results that may wait to be drained before dispatching pauses (default 10 000).
    pub buffer: usize,
    /// Stop dispatching after an `auth` failure (default true).
    pub stop_on_auth: bool,
}

impl Default for BatchOptions {
    fn default() -> Self {
        Self {
            concurrency: 4,
            retry: RetryPolicy::default(),
            pacing: None,
            checkpoint: None,
            timeout_ms: 120_000,
            buffer: 10_000,
            stop_on_auth: true,
        }
    }
}

/// An operation with its resolved identity.
#[derive(Debug, Clone)]
pub struct PreparedOp {
    /// The identity (explicit or derived).
    pub id: String,
    /// The operation name.
    pub op: String,
    /// Its arguments.
    pub args: Value,
}

fn canonical(value: &Value, out: &mut String) {
    match value {
        Value::Object(map) => {
            let mut keys: Vec<&String> = map.keys().collect();
            keys.sort();
            out.push('{');
            for (index, key) in keys.into_iter().enumerate() {
                if index > 0 {
                    out.push(',');
                }
                out.push_str(&Value::String(key.clone()).to_string());
                out.push(':');
                canonical(&map[key], out);
            }
            out.push('}');
        },
        Value::Array(items) => {
            out.push('[');
            for (index, item) in items.iter().enumerate() {
                if index > 0 {
                    out.push(',');
                }
                canonical(item, out);
            }
            out.push(']');
        },
        other => out.push_str(&other.to_string()),
    }
}

/// The identity of an operation that was given none: its name and a hash of its canonical
/// arguments (key order does not matter), stable across runs and machines.
pub fn default_id(op: &str, args: &Value) -> String {
    let mut text = String::new();
    canonical(args, &mut text);
    // FNV-1a, 64 bit: stable (unlike `DefaultHasher`) and good enough for an identity.
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for byte in text.bytes() {
        hash ^= u64::from(byte);
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    format!("{op}:{hash:016x}")
}

/// Resolve identities and reject duplicates (a checkpoint cannot key two operations alike).
pub fn prepare(ops: Vec<BatchOp>) -> Result<Vec<PreparedOp>> {
    let mut seen: HashSet<String> = HashSet::with_capacity(ops.len());
    let mut out = Vec::with_capacity(ops.len());
    for op in ops {
        let args = if op.args.is_null() { json!({}) } else { op.args };
        let id = op.id.filter(|id| !id.is_empty()).unwrap_or_else(|| default_id(&op.op, &args));
        if !seen.insert(id.clone()) {
            return Err(XError::Invalid(format!(
                "duplicate operation id `{id}` in the batch (give each operation its own id)"
            )));
        }
        out.push(PreparedOp { id, op: op.op, args });
    }
    Ok(out)
}

// ---------------------------------------------------------------------------
// Result channel
// ---------------------------------------------------------------------------

/// Where a running batch puts its results and where its consumer takes them from.
#[derive(Default)]
pub struct BatchChannel {
    queue: Mutex<VecDeque<Value>>,
    drained: Notify,
    done: AtomicBool,
    summary: Mutex<Option<Value>>,
    total: AtomicUsize,
    completed: AtomicUsize,
}

impl BatchChannel {
    /// A new, empty channel.
    pub fn new() -> Arc<Self> {
        Arc::new(Self::default())
    }

    fn push(&self, item: Value) {
        self.queue.lock().unwrap_or_else(|e| e.into_inner()).push_back(item);
        self.completed.fetch_add(1, Ordering::SeqCst);
    }

    /// Mark the batch finished with `summary` (the driver does it; a supervisor does it with an
    /// error summary when the driver dies).
    pub fn finish(&self, summary: Value) {
        *self.summary.lock().unwrap_or_else(|e| e.into_inner()) = Some(summary);
        self.done.store(true, Ordering::SeqCst);
    }

    fn len(&self) -> usize {
        self.queue.lock().unwrap_or_else(|e| e.into_inner()).len()
    }

    /// Results waiting to be drained.
    pub fn backlog(&self) -> usize {
        self.len()
    }

    /// Take up to `max` results.
    ///
    /// ```json
    /// {"items": [...], "done": false, "pending": 3, "completed": 120, "total": 500, "summary": null}
    /// ```
    /// `done` becomes true only when the batch has finished **and** every result was drained; the
    /// `summary` is delivered with that last poll.
    pub fn drain(&self, max: usize) -> Value {
        // Read before locking: a true `done` means every push already happened.
        let finished = self.done.load(Ordering::SeqCst);
        let (items, pending) = {
            let mut queue = self.queue.lock().unwrap_or_else(|e| e.into_inner());
            let take = max.min(queue.len());
            let items: Vec<Value> = queue.drain(..take).collect();
            (items, queue.len())
        };
        self.drained.notify_waiters();
        let done = finished && pending == 0;
        let summary = if done {
            self.summary.lock().unwrap_or_else(|e| e.into_inner()).clone()
        } else {
            None
        };
        json!({
            "items": items,
            "done": done,
            "pending": pending,
            "completed": self.completed.load(Ordering::SeqCst),
            "total": self.total.load(Ordering::SeqCst),
            "summary": summary,
        })
    }

    /// Wait until fewer than `limit` results are queued (back pressure).
    async fn wait_below(&self, limit: usize) {
        loop {
            let notified = self.drained.notified();
            tokio::pin!(notified);
            // Register for the wake-up before checking, so a drain in between is not missed.
            notified.as_mut().enable();
            if self.len() < limit {
                return;
            }
            notified.await;
        }
    }
}

// ---------------------------------------------------------------------------
// Checkpoint
// ---------------------------------------------------------------------------

/// Final results of a previous run, by operation id (the last record of an id wins).
fn load_checkpoint(path: &Path) -> HashMap<String, Value> {
    let Ok(file) = std::fs::File::open(path) else {
        return HashMap::new();
    };
    let mut records: HashMap<String, Value> = HashMap::new();
    for line in BufReader::new(file).lines().map_while(std::result::Result::ok) {
        // A torn line (killed mid-write) simply does not parse.
        let Ok(record) = serde_json::from_str::<Value>(&line) else { continue };
        let Some(id) = record.get("id").and_then(Value::as_str) else { continue };
        records.insert(id.to_owned(), record);
    }
    records.retain(|_, record| envelope_is_final(record));
    records
}

/// Whether the file exists, is not empty, and its last byte is not a newline.
fn ends_without_newline(path: &Path) -> bool {
    use std::io::{Read, Seek, SeekFrom};
    let Ok(mut file) = std::fs::File::open(path) else { return false };
    let Ok(length) = file.seek(SeekFrom::End(0)) else { return false };
    if length == 0 || file.seek(SeekFrom::End(-1)).is_err() {
        return false;
    }
    let mut last = [0u8; 1];
    file.read_exact(&mut last).is_ok() && last[0] != b'\n'
}

struct CheckpointWriter {
    file: std::fs::File,
}

impl CheckpointWriter {
    fn open(path: &Path) -> std::io::Result<Self> {
        if let Some(parent) = path.parent().filter(|p| !p.as_os_str().is_empty()) {
            std::fs::create_dir_all(parent)?;
        }
        let mut options = OpenOptions::new();
        options.create(true).append(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            // Results name the accounts and posts a run touched: owner only.
            options.mode(0o600);
        }
        let mut file = options.open(path)?;
        // A run killed mid-write leaves a line without its newline; the next record must not be
        // glued to it (it would be lost with the torn one).
        if ends_without_newline(path) {
            file.write_all(b"\n")?;
        }
        Ok(Self { file })
    }

    /// One `write_all` of one line: appends are atomic for lines of this size.
    fn append(&mut self, envelope: &Value) {
        let Ok(mut line) = serde_json::to_string(envelope) else { return };
        line.push('\n');
        // A failing disk must not abort the batch: the result is still delivered in memory.
        let _ = self.file.write_all(line.as_bytes());
    }

    fn sync(&mut self) {
        let _ = self.file.sync_all();
    }
}

// ---------------------------------------------------------------------------
// Driver
// ---------------------------------------------------------------------------

#[derive(Default)]
struct Counters {
    ok: AtomicUsize,
    failed: AtomicUsize,
}

/// Run `ops` through `client`; every result goes to `channel`. Returns the summary, which is also
/// delivered with the channel's last poll.
///
/// Dropping (aborting) the returned future cancels the operations in flight; results already
/// delivered, and the checkpoint, stay valid so a rerun resumes.
pub async fn run_batch(
    client: Arc<XClient>,
    ops: Vec<PreparedOp>,
    options: BatchOptions,
    channel: Arc<BatchChannel>,
) -> Value {
    let started = Instant::now();
    let total = ops.len();
    channel.total.store(total, Ordering::SeqCst);

    let checkpoint = options.checkpoint.as_deref().map(load_checkpoint).unwrap_or_default();
    let writer: Option<Arc<Mutex<CheckpointWriter>>> = options
        .checkpoint
        .as_deref()
        .and_then(|path| CheckpointWriter::open(path).ok())
        .map(|w| Arc::new(Mutex::new(w)));

    let concurrency = options.concurrency.clamp(1, 256);
    let buffer = options.buffer.max(1);
    let run_options = Arc::new(RunOptions {
        retry: options.retry.clone(),
        pacing: options.pacing.clone().map(|p| Arc::new(Pacer::new(p))),
        timeout: Duration::from_millis(options.timeout_ms.max(1)),
        batch: true,
    });
    let semaphore = Arc::new(Semaphore::new(concurrency));
    let stop = Arc::new(AtomicBool::new(false));
    let counters = Arc::new(Counters::default());

    let mut tasks: JoinSet<()> = JoinSet::new();
    let mut in_flight: HashMap<tokio::task::Id, (String, String)> = HashMap::new();
    let (mut resumed, mut not_run) = (0usize, 0usize);

    for op in ops {
        if let Some(previous) = checkpoint.get(&op.id) {
            let mut replay = previous.clone();
            replay["resumed"] = Value::Bool(true);
            channel.push(replay);
            resumed += 1;
            continue;
        }
        if stop.load(Ordering::SeqCst) {
            not_run += 1;
            continue;
        }
        channel.wait_below(buffer).await;
        let Ok(permit) = semaphore.clone().acquire_owned().await else {
            not_run += 1;
            continue;
        };
        if stop.load(Ordering::SeqCst) {
            not_run += 1;
            continue;
        }
        // Reap what already finished so the bookkeeping stays small on huge batches.
        while let Some(joined) = tasks.try_join_next_with_id() {
            settle(joined, &mut in_flight, &channel, &writer, &counters);
        }

        let (client, run_options, channel_task, writer_task, stop_task, counters_task) = (
            client.clone(),
            run_options.clone(),
            channel.clone(),
            writer.clone(),
            stop.clone(),
            counters.clone(),
        );
        let stop_on_auth = options.stop_on_auth;
        let (id, name) = (op.id.clone(), op.op.clone());
        let handle = tasks.spawn(async move {
            let envelope =
                execute(Some(client.as_ref()), Some(&op.id), &op.op, &op.args, &run_options).await;
            if envelope["ok"] == Value::Bool(true) {
                counters_task.ok.fetch_add(1, Ordering::SeqCst);
            } else {
                counters_task.failed.fetch_add(1, Ordering::SeqCst);
                if stop_on_auth && envelope_kind(&envelope) == Some(ErrorKind::Auth) {
                    stop_task.store(true, Ordering::SeqCst);
                }
            }
            if let Some(writer) = &writer_task {
                writer.lock().unwrap_or_else(|e| e.into_inner()).append(&envelope);
            }
            channel_task.push(envelope);
            drop(permit);
        });
        in_flight.insert(handle.id(), (id, name));
    }
    while let Some(joined) = tasks.join_next_with_id().await {
        settle(joined, &mut in_flight, &channel, &writer, &counters);
    }
    if let Some(writer) = &writer {
        writer.lock().unwrap_or_else(|e| e.into_inner()).sync();
    }

    let stopped_by = stop.load(Ordering::SeqCst).then_some("auth");
    let summary = json!({
        "total": total,
        "ok": counters.ok.load(Ordering::SeqCst),
        "failed": counters.failed.load(Ordering::SeqCst),
        "resumed": resumed,
        "not_run": not_run,
        "elapsed_ms": u64::try_from(started.elapsed().as_millis()).unwrap_or(u64::MAX),
        "stopped_by": stopped_by,
    });
    channel.finish(summary.clone());
    summary
}

/// Account for a finished task; a task that panicked still yields a result for its operation.
fn settle(
    joined: std::result::Result<(tokio::task::Id, ()), tokio::task::JoinError>,
    in_flight: &mut HashMap<tokio::task::Id, (String, String)>,
    channel: &BatchChannel,
    writer: &Option<Arc<Mutex<CheckpointWriter>>>,
    counters: &Counters,
) {
    match joined {
        Ok((id, ())) => {
            in_flight.remove(&id);
        },
        Err(error) => {
            let Some((op_id, op)) = in_flight.remove(&error.id()) else { return };
            let reason = if error.is_panic() {
                "the operation panicked"
            } else {
                "the operation was cancelled"
            };
            let info = ErrorInfo {
                message: reason.to_owned(),
                kind: ErrorKind::Other,
                code: None,
                status: None,
                reset_epoch: None,
                retry_safe: false,
            };
            let envelope = error_envelope(&op, Some(&op_id), &info, None, 1, Duration::ZERO);
            counters.failed.fetch_add(1, Ordering::SeqCst);
            if let Some(writer) = writer {
                writer.lock().unwrap_or_else(|e| e.into_inner()).append(&envelope);
            }
            channel.push(envelope);
        },
    }
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::AtomicUsize;

    use super::*;
    use crate::{
        XClientOptions, XSession,
        mock::{MockServer, Response},
    };

    fn client_for(server: &MockServer) -> Arc<XClient> {
        Arc::new(
            XClient::with_options(
                XSession::new("AUTH_TOKEN_PLACEHOLDER", "CT0_PLACEHOLDER"),
                XClientOptions {
                    api_base: Some(server.api_base()),
                    upload_base: Some(server.upload_url()),
                    timeout_ms: Some(10_000),
                    persist_session: Some(false),
                    query_ids_path: Some(
                        std::env::temp_dir()
                            .join(format!("aphx-batch-{}.json", uuid::Uuid::new_v4())),
                    ),
                    query_ids_ttl_secs: Some(3600),
                    discovery_pages: Some(Vec::new()),
                },
            )
            .unwrap(),
        )
    }

    fn quick_retry() -> RetryPolicy {
        RetryPolicy {
            max_retries: 2,
            base_ms: 1,
            max_backoff_ms: 2,
            jitter: 0.0,
            max_rate_limit_waits: 2,
            max_wait_secs: 10,
            rate_limit_margin_ms: 0,
            retry_non_idempotent: false,
            wait_rate_limit_mutations: None,
        }
    }

    fn likes(n: usize) -> Vec<BatchOp> {
        (0..n)
            .map(|i| BatchOp {
                id: Some(format!("t{i}")),
                op: "like".into(),
                args: json!({ "id": (1000 + i).to_string() }),
            })
            .collect()
    }

    /// Run a batch to completion and return every item and the summary.
    async fn collect(
        client: Arc<XClient>,
        ops: Vec<BatchOp>,
        options: BatchOptions,
    ) -> (Vec<Value>, Value) {
        let channel = BatchChannel::new();
        let prepared = prepare(ops).unwrap();
        let driver = tokio::spawn(run_batch(client, prepared, options, channel.clone()));
        let mut items = Vec::new();
        loop {
            let poll = channel.drain(100);
            items.extend(poll["items"].as_array().unwrap().iter().cloned());
            if poll["done"] == true {
                let summary = poll["summary"].clone();
                driver.await.unwrap();
                return (items, summary);
            }
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
    }

    fn ids(items: &[Value]) -> Vec<String> {
        let mut ids: Vec<String> =
            items.iter().map(|i| i["id"].as_str().unwrap().to_owned()).collect();
        ids.sort();
        ids
    }

    #[test]
    fn default_ids_are_stable_and_ignore_key_order() {
        let a = default_id("like", &json!({ "id": "1", "extra": [1, 2, { "b": 1, "a": 2 }] }));
        let b = default_id("like", &json!({ "extra": [1, 2, { "a": 2, "b": 1 }], "id": "1" }));
        assert_eq!(a, b);
        assert!(a.starts_with("like:") && a.len() == "like:".len() + 16);
        assert_ne!(a, default_id("like", &json!({ "id": "2" })));
        assert_ne!(
            a,
            default_id("unlike", &json!({ "id": "1", "extra": [1, 2, { "b": 1, "a": 2 }] }))
        );
    }

    #[test]
    fn prepare_rejects_duplicate_ids_and_derives_missing_ones() {
        let dup = prepare(vec![
            BatchOp { id: Some("a".into()), op: "like".into(), args: json!({}) },
            BatchOp { id: Some("a".into()), op: "like".into(), args: json!({}) },
        ])
        .unwrap_err();
        assert!(dup.to_string().contains("duplicate operation id `a`"), "{dup}");

        let derived = prepare(vec![
            BatchOp { id: None, op: "like".into(), args: json!({ "id": "1" }) },
            BatchOp { id: Some(String::new()), op: "like".into(), args: json!({ "id": "2" }) },
        ])
        .unwrap();
        assert!(derived[0].id.starts_with("like:") && derived[1].id.starts_with("like:"));
        let same = prepare(vec![
            BatchOp { id: None, op: "like".into(), args: json!({ "id": "1" }) },
            BatchOp { id: None, op: "like".into(), args: json!({ "id": "1" }) },
        ]);
        assert!(same.is_err(), "identical operations without ids collide");
    }

    #[tokio::test]
    async fn concurrency_is_bounded_and_every_result_arrives() {
        let server = MockServer::start(|_| {
            Response::ok(json!({ "data": { "favorite_tweet": "Done" } }))
                .after(Duration::from_millis(60))
        })
        .await;
        let options =
            BatchOptions { concurrency: 3, retry: quick_retry(), ..BatchOptions::default() };
        let started = Instant::now();
        let (items, summary) = collect(client_for(&server), likes(12), options).await;
        assert_eq!(items.len(), 12);
        assert!(items.iter().all(|i| i["ok"] == true && i["attempts"] == 1));
        let mut expected: Vec<String> = (0..12).map(|i| format!("t{i}")).collect();
        expected.sort();
        assert_eq!(ids(&items), expected);
        assert_eq!(server.max_in_flight(), 3, "the bound is reached and never exceeded");
        assert!(started.elapsed() < Duration::from_millis(60 * 12), "it really ran in parallel");
        assert_eq!(summary["total"], 12);
        assert_eq!(summary["ok"], 12);
        assert_eq!(summary["failed"], 0);
        assert_eq!(summary["stopped_by"], Value::Null);
    }

    #[tokio::test]
    async fn one_failure_never_stops_the_others() {
        let server = MockServer::start(|request| {
            let tweet = request.json()["variables"]["tweet_id"].as_str().unwrap_or("").to_owned();
            match tweet.as_str() {
                "1001" => Response::x_error(403, 139, "already favorited"),
                "1003" => Response::x_error(404, 34, "gone"),
                _ => Response::ok(json!({ "data": { "favorite_tweet": "Done" } })),
            }
        })
        .await;
        let options =
            BatchOptions { concurrency: 2, retry: quick_retry(), ..BatchOptions::default() };
        let (items, summary) = collect(client_for(&server), likes(5), options).await;
        assert_eq!(items.len(), 5);
        let failed: Vec<&Value> = items.iter().filter(|i| i["ok"] == false).collect();
        assert_eq!(failed.len(), 2);
        assert!(failed.iter().all(|i| i["error"]["kind"] == "terminal"));
        assert_eq!((summary["ok"].clone(), summary["failed"].clone()), (json!(3), json!(2)));
        assert_eq!(summary["stopped_by"], Value::Null, "terminal failures do not stop a batch");
    }

    #[tokio::test]
    async fn an_auth_failure_stops_the_dispatch_of_the_rest() {
        let server = MockServer::start(|request| {
            if request.json()["variables"]["tweet_id"] == "1001" {
                Response::x_error(401, 32, "Could not authenticate you")
            } else {
                Response::ok(json!({ "data": { "favorite_tweet": "Done" } }))
            }
        })
        .await;
        let options =
            BatchOptions { concurrency: 1, retry: quick_retry(), ..BatchOptions::default() };
        let (items, summary) = collect(client_for(&server), likes(6), options).await;
        assert_eq!(items.len(), 2, "t0 succeeded, t1 failed with auth, nothing else was sent");
        assert_eq!(items[1]["error"]["kind"], "auth");
        assert_eq!(summary["not_run"], 4);
        assert_eq!(summary["stopped_by"], "auth");
        assert_eq!(server.count(), 2);

        // Opting out dispatches everything.
        let server = MockServer::start(|_| Response::x_error(401, 32, "dead")).await;
        let options = BatchOptions {
            concurrency: 1,
            stop_on_auth: false,
            retry: quick_retry(),
            ..BatchOptions::default()
        };
        let (items, summary) = collect(client_for(&server), likes(3), options).await;
        assert_eq!(items.len(), 3);
        assert_eq!(summary["not_run"], 0);
    }

    #[tokio::test]
    async fn the_checkpoint_replays_final_results_and_reruns_the_rest() {
        let path = std::env::temp_dir().join(format!("aphx-ckpt-{}.jsonl", uuid::Uuid::new_v4()));
        let calls = Arc::new(AtomicUsize::new(0));
        let healthy = Arc::new(AtomicBool::new(false));
        let (seen, health) = (calls.clone(), healthy.clone());
        let server = MockServer::start(move |request| {
            seen.fetch_add(1, Ordering::SeqCst);
            let tweet = request.json()["variables"]["tweet_id"].as_str().unwrap_or("").to_owned();
            if tweet == "1002" && !health.load(Ordering::SeqCst) {
                Response::json(503, Value::Null)
            } else if tweet == "1004" {
                Response::x_error(404, 144, "No status found with that ID")
            } else {
                Response::ok(json!({ "data": { "favorite_tweet": "Done" } }))
            }
        })
        .await;
        let options = || BatchOptions {
            concurrency: 2,
            retry: RetryPolicy { max_retries: 1, ..quick_retry() },
            checkpoint: Some(path.clone()),
            ..BatchOptions::default()
        };

        let (first, summary) = collect(client_for(&server), likes(5), options()).await;
        assert_eq!(first.len(), 5);
        assert_eq!((summary["ok"].clone(), summary["failed"].clone()), (json!(3), json!(2)));
        let after_first = calls.load(Ordering::SeqCst);

        // The file now holds five lines; a torn line from a killed process must not matter.
        let mut file = OpenOptions::new().append(true).open(&path).unwrap();
        file.write_all(b"{\"id\":\"torn\",\"ok\":tr").unwrap();
        drop(file);
        assert_eq!(std::fs::read_to_string(&path).unwrap().lines().count(), 6);

        healthy.store(true, Ordering::SeqCst);
        let (second, summary) = collect(client_for(&server), likes(5), options()).await;
        assert_eq!(second.len(), 5, "the iterator still yields every operation");
        let resumed: Vec<&Value> = second.iter().filter(|i| i["resumed"] == true).collect();
        assert_eq!(resumed.len(), 4, "three successes and the terminal failure are replayed");
        assert!(second.iter().find(|i| i["id"] == "t2").unwrap().get("resumed").is_none());
        assert_eq!(second.iter().find(|i| i["id"] == "t2").unwrap()["ok"], true);
        assert_eq!(
            calls.load(Ordering::SeqCst),
            after_first + 1,
            "only the transient failure ran again"
        );
        assert_eq!(summary["resumed"], 4);
        assert_eq!(summary["ok"], 1);

        // A third run executes nothing.
        let (third, summary) = collect(client_for(&server), likes(5), options()).await;
        assert!(third.iter().all(|i| i["resumed"] == true));
        assert_eq!(summary["resumed"], 5);
        assert_eq!(calls.load(Ordering::SeqCst), after_first + 1);
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(std::fs::metadata(&path).unwrap().permissions().mode() & 0o777, 0o600);
        }
        let _ = std::fs::remove_file(path);
    }

    #[tokio::test]
    async fn dispatch_pauses_when_the_consumer_falls_behind() {
        let server =
            MockServer::start(|_| Response::ok(json!({ "data": { "favorite_tweet": "Done" } })))
                .await;
        let channel = BatchChannel::new();
        let options = BatchOptions {
            concurrency: 1,
            buffer: 2,
            retry: quick_retry(),
            ..BatchOptions::default()
        };
        let driver = tokio::spawn(run_batch(
            client_for(&server),
            prepare(likes(10)).unwrap(),
            options,
            channel.clone(),
        ));
        tokio::time::sleep(Duration::from_millis(300)).await;
        assert!(channel.backlog() <= 3, "backlog {} stays near the buffer", channel.backlog());
        assert!(
            server.count() <= 3,
            "{} requests were sent while nothing was drained",
            server.count()
        );
        let mut seen = 0;
        loop {
            let poll = channel.drain(1);
            seen += poll["items"].as_array().unwrap().len();
            assert!(channel.backlog() <= 3);
            if poll["done"] == true {
                break;
            }
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
        driver.await.unwrap();
        assert_eq!(seen, 10);
        assert_eq!(server.count(), 10);
    }

    #[tokio::test]
    async fn unknown_operations_are_reported_per_operation() {
        let server = MockServer::start(|_| Response::ok(json!({ "data": {} }))).await;
        let ops = vec![
            BatchOp { id: Some("bad".into()), op: "no_such_op".into(), args: Value::Null },
            BatchOp {
                id: Some("good".into()),
                op: "home_timeline".into(),
                args: json!({ "count": 1 }),
            },
        ];
        let (items, summary) = collect(
            client_for(&server),
            ops,
            BatchOptions { retry: quick_retry(), ..BatchOptions::default() },
        )
        .await;
        let bad = items.iter().find(|i| i["id"] == "bad").unwrap();
        assert_eq!(bad["error"]["kind"], "invalid");
        assert!(items.iter().find(|i| i["id"] == "good").unwrap()["ok"] == true);
        assert_eq!(summary["failed"], 1);
    }

    #[tokio::test]
    async fn a_large_batch_completes_with_unique_results() {
        let server =
            MockServer::start(|_| Response::ok(json!({ "data": { "favorite_tweet": "Done" } })))
                .await;
        let options =
            BatchOptions { concurrency: 16, retry: quick_retry(), ..BatchOptions::default() };
        let (items, summary) = collect(client_for(&server), likes(300), options).await;
        assert_eq!(items.len(), 300);
        let unique: HashSet<String> =
            items.iter().map(|i| i["id"].as_str().unwrap().to_owned()).collect();
        assert_eq!(unique.len(), 300);
        assert_eq!(summary["ok"], 300);
        assert_eq!(server.count(), 300);
        assert!(server.max_in_flight() <= 16);
    }

    #[tokio::test]
    async fn aborting_the_driver_cancels_the_operations_in_flight() {
        let server = MockServer::start(|_| {
            Response::ok(json!({ "data": { "favorite_tweet": "Done" } }))
                .after(Duration::from_secs(5))
        })
        .await;
        let channel = BatchChannel::new();
        let driver = tokio::spawn(run_batch(
            client_for(&server),
            prepare(likes(4)).unwrap(),
            BatchOptions { concurrency: 4, retry: quick_retry(), ..BatchOptions::default() },
            channel.clone(),
        ));
        tokio::time::sleep(Duration::from_millis(150)).await;
        driver.abort();
        let _ = driver.await;
        tokio::time::sleep(Duration::from_millis(100)).await;
        assert_eq!(channel.backlog(), 0);
        let poll = channel.drain(10);
        assert_eq!(poll["done"], false, "an aborted batch never reports done");
    }
}
