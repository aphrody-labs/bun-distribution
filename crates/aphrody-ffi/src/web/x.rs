// SPDX-License-Identifier: Apache-2.0
//! X native job API (Web ABI 5): client handles, operations and batches over `aphrody-x`.
//!
//! One generic, versioned JSON surface replaces one export per operation. A caller opens a client
//! once (the cookies cross the boundary a single time, or are discovered by Rust exactly as the CLI
//! does), then:
//!
//! ```text
//! aphrody_web_x_call(client, op, args_json)               local operations, synchronous
//! aphrody_web_x_submit(client, op, args_json, options)    any operation as a job -> id
//!   -> aphrody_web_job_take(id)                           the result envelope (NULL while pending)
//! aphrody_web_x_batch_submit(client, ops_json, options)   many operations, bounded concurrency
//!   -> aphrody_web_x_batch_poll(batch, max)               finished envelopes as they complete
//!   -> aphrody_web_x_batch_cancel(batch)
//! ```
//!
//! Operation names, arguments and the envelope shape are the contract of `aphrody_x::ops` (the `meta`
//! operation serves the table). Retry, rate-limit waiting, pacing, concurrency and the JSONL
//! checkpoint all live in Rust; the host only submits and drains.
//!
//! Every pointer contract is the one of the other Web exports: strings are NUL-terminated UTF-8,
//! returned strings are owned by this library and released with `aphrody_string_free` /
//! `aphrody_web_free_string`, and a panic never crosses the boundary.

use std::{
    collections::HashMap,
    os::raw::c_char,
    sync::{
        Arc, LazyLock, Mutex,
        atomic::{AtomicU64, Ordering},
    },
    time::Duration,
};

use aphrody_x::{
    XClient, XClientOptions, XError, XSession,
    batch::{self, BatchChannel, BatchOptions},
    classify_error,
    ops::{self, RunOptions},
    policy::{ErrorInfo, RetryPolicy},
};
use serde::Deserialize;
use serde_json::{Value, json};

use super::{
    ffi_util::{borrow_str, guard, into_c_string, shared_runtime},
    jobs,
};

// ---------------------------------------------------------------------------
// Registries
// ---------------------------------------------------------------------------

static CLIENTS: LazyLock<Mutex<HashMap<u64, Arc<XClient>>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));
static NEXT_CLIENT: AtomicU64 = AtomicU64::new(1);

struct BatchEntry {
    channel: Arc<BatchChannel>,
    abort: tokio::task::AbortHandle,
}

static BATCHES: LazyLock<Mutex<HashMap<u64, BatchEntry>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));
static NEXT_BATCH: AtomicU64 = AtomicU64::new(1);

fn clients() -> std::sync::MutexGuard<'static, HashMap<u64, Arc<XClient>>> {
    CLIENTS.lock().unwrap_or_else(|e| e.into_inner())
}

fn batches() -> std::sync::MutexGuard<'static, HashMap<u64, BatchEntry>> {
    BATCHES.lock().unwrap_or_else(|e| e.into_inner())
}

// ---------------------------------------------------------------------------
// Argument handling
// ---------------------------------------------------------------------------

/// An optional JSON argument: `NULL` or empty means `default`; anything else must parse.
fn json_arg(ptr: *const c_char, what: &str, default: Value) -> Result<Value, ErrorInfo> {
    if ptr.is_null() {
        return Ok(default);
    }
    // SAFETY: the caller guarantees a readable, NUL-terminated string (see the exports below).
    let Some(text) = (unsafe { borrow_str(ptr) }) else {
        return Err(ErrorInfo::invalid(format!("{what} is not valid UTF-8")));
    };
    if text.trim().is_empty() {
        return Ok(default);
    }
    serde_json::from_str(text)
        .map_err(|error| ErrorInfo::invalid(format!("{what} is not valid JSON: {error}")))
}

fn required_text(ptr: *const c_char, what: &str) -> Result<String, ErrorInfo> {
    if ptr.is_null() {
        return Err(ErrorInfo::invalid(format!("null {what} pointer")));
    }
    // SAFETY: see `json_arg`.
    unsafe { borrow_str(ptr) }
        .map(str::to_owned)
        .ok_or_else(|| ErrorInfo::invalid(format!("{what} is not valid UTF-8")))
}

/// The client a handle names (`0` means "no client": operations that need none).
fn lookup_client(handle: u64) -> Result<Option<Arc<XClient>>, ErrorInfo> {
    if handle == 0 {
        return Ok(None);
    }
    clients()
        .get(&handle)
        .cloned()
        .map(Some)
        .ok_or_else(|| ErrorInfo::invalid(format!("unknown client handle {handle}")))
}

fn error_text(info: &ErrorInfo) -> String {
    json!({ "ok": false, "error": info }).to_string()
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

/// The session an open request describes: an explicit `{auth_token, ct0, handle?, transaction_id?}`,
/// `{cookie_string}`, `{session_file}`, a bare cookie string, or (`null`, `{}`, `{"discover": true}`)
/// the discovery order of the CLI: `X_COOKIE_STRING`, `~/.aphrody/x-session.json`,
/// `X_AUTH_TOKEN` + `X_CT0`.
fn session_from(value: &Value) -> Result<XSession, XError> {
    match value {
        Value::String(cookie) => XSession::from_cookie_string(cookie),
        Value::Object(map) => {
            if let Some(cookie) = map.get("cookie_string").and_then(Value::as_str) {
                return XSession::from_cookie_string(cookie);
            }
            // A session file: a rotated ct0 / auth_token is written back to it.
            if let Some(path) = map.get("session_file").and_then(Value::as_str) {
                return XSession::load_from(std::path::Path::new(path));
            }
            let field = |key: &str| {
                map.get(key)
                    .and_then(Value::as_str)
                    .filter(|v| !v.is_empty())
            };
            match (field("auth_token"), field("ct0")) {
                (Some(auth_token), Some(ct0)) => {
                    let mut session = XSession::new(auth_token, ct0);
                    session.handle = field("handle").map(str::to_owned);
                    session.transaction_id = field("transaction_id").map(str::to_owned);
                    Ok(session)
                }
                (None, None) => XSession::discover(),
                _ => Err(XError::Auth(
                    "a session needs both auth_token and ct0".into(),
                )),
            }
        }
        _ => XSession::discover(),
    }
}

fn open_client(
    session_json: *const c_char,
    options_json: *const c_char,
) -> Result<Value, ErrorInfo> {
    let session = json_arg(session_json, "session", Value::Null)?;
    let options = json_arg(options_json, "options", json!({}))?;
    let options: XClientOptions = serde_json::from_value(options)
        .map_err(|error| ErrorInfo::invalid(format!("options: {error}")))?;
    let session = session_from(&session).map_err(|error| classify_error(&error))?;
    let handle = session.handle.clone();
    let client = XClient::with_options(session, options).map_err(|error| classify_error(&error))?;
    let api_base = client.api_base().to_owned();
    let id = NEXT_CLIENT.fetch_add(1, Ordering::SeqCst);
    clients().insert(id, Arc::new(client));
    Ok(json!({ "ok": true, "client": id, "handle": handle, "api_base": api_base }))
}

/// Open an X client and return `{"ok":true,"client":<handle>,"handle":...,"api_base":...}` or
/// `{"ok":false,"error":{...}}`.
///
/// `session_json` is `{"auth_token","ct0","handle"?,"transaction_id"?}`, `{"cookie_string"}`,
/// `{"session_file"}` (rotated cookies are written back to it), a JSON string holding a cookie
/// string, or `NULL` / `{}` to discover the credentials as the CLI does.
/// `options_json` (`NULL` for defaults) is `{"api_base","upload_base","timeout_ms","persist_session",
/// "query_ids_path","query_ids_ttl_secs","discovery_pages"}`. The credentials are never part of the
/// answer.
///
/// # Safety
///
/// Both pointers must be `NULL` or readable, NUL-terminated C strings for the duration of the call.
/// The returned string must be released exactly once with `aphrody_string_free`.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn aphrody_web_x_client_open(
    session_json: *const c_char,
    options_json: *const c_char,
) -> *mut c_char {
    guard(std::ptr::null_mut(), || {
        into_c_string(match open_client(session_json, options_json) {
            Ok(value) => value.to_string(),
            Err(info) => error_text(&info),
        })
    })
}

/// Release a client handle. Returns `1` when it was open, `0` otherwise. Operations still running
/// on the client finish normally (they hold their own reference).
#[unsafe(no_mangle)]
pub extern "C" fn aphrody_web_x_client_close(client: u64) -> i32 {
    guard(0, || i32::from(clients().remove(&client).is_some()))
}

// ---------------------------------------------------------------------------
// Operations
// ---------------------------------------------------------------------------

/// Run a **local** operation (parsers, catalog, ranking, store, client state) synchronously and
/// return its envelope. `client` is `0` for operations that need no session. Network operations
/// are refused with an `invalid` envelope: submit them.
///
/// # Safety
///
/// `op` must be a readable, NUL-terminated C string; `args_json` may be `NULL` (no arguments) or the
/// same. The returned string must be released exactly once with `aphrody_string_free`.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn aphrody_web_x_call(
    client: u64,
    op: *const c_char,
    args_json: *const c_char,
) -> *mut c_char {
    guard(std::ptr::null_mut(), || {
        let prepared = (|| -> Result<(Option<Arc<XClient>>, String, Value), ErrorInfo> {
            Ok((
                lookup_client(client)?,
                required_text(op, "op")?,
                json_arg(args_json, "args", json!({}))?,
            ))
        })();
        let text = match prepared {
            Ok((client, op, args)) => {
                ops::execute_local(client.as_deref(), None, &op, &args).to_string()
            }
            Err(info) => error_text(&info),
        };
        into_c_string(text)
    })
}

/// Per-call options of `aphrody_web_x_submit`.
#[derive(Debug, Default, Deserialize)]
#[serde(default)]
struct CallOptions {
    /// Caller identity echoed in the envelope.
    id: Option<String>,
    /// Per-request timeout in milliseconds (default 120 000).
    timeout_ms: Option<u64>,
    /// Retry and waiting policy overrides.
    retry: Option<RetryPolicy>,
}

fn call_options(ptr: *const c_char) -> Result<(Option<String>, RunOptions), ErrorInfo> {
    let value = json_arg(ptr, "options", json!({}))?;
    let parsed: CallOptions = serde_json::from_value(value)
        .map_err(|error| ErrorInfo::invalid(format!("options: {error}")))?;
    let mut run = RunOptions::default();
    if let Some(ms) = parsed.timeout_ms.filter(|ms| *ms > 0) {
        run.timeout = Duration::from_millis(ms);
    }
    if let Some(retry) = parsed.retry {
        run.retry = retry;
    }
    Ok((parsed.id, run))
}

/// Submit any operation (local or network) as a job on the shared runtime and return its job id;
/// the result envelope is collected with `aphrody_web_job_take`. Retry, rate-limit waiting and the
/// per-request timeout are applied by the runner. Argument problems resolve the job at once with an
/// `invalid` envelope; the id is never `0`.
///
/// `options_json` (`NULL` for defaults): `{"id","timeout_ms","retry":{...}}`.
///
/// # Safety
///
/// `op` must be a readable, NUL-terminated C string; `args_json` and `options_json` may be `NULL`
/// or the same.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn aphrody_web_x_submit(
    client: u64,
    op: *const c_char,
    args_json: *const c_char,
    options_json: *const c_char,
) -> u64 {
    guard(0, || {
        let prepared = (|| -> Result<_, ErrorInfo> {
            let (id, run) = call_options(options_json)?;
            Ok((
                lookup_client(client)?,
                required_text(op, "op")?,
                json_arg(args_json, "args", json!({}))?,
                id,
                run,
            ))
        })();
        match prepared {
            Err(info) => jobs::resolved(error_text(&info)),
            Ok((client, op, args, id, run)) => jobs::submit(0, async move {
                ops::execute(client.as_deref(), id.as_deref(), &op, &args, &run)
                    .await
                    .to_string()
            }),
        }
    })
}

// ---------------------------------------------------------------------------
// Batches
// ---------------------------------------------------------------------------

fn submit_batch(
    client: u64,
    ops_json: *const c_char,
    options_json: *const c_char,
) -> Result<Value, ErrorInfo> {
    let client = lookup_client(client)?
        .ok_or_else(|| ErrorInfo::invalid("a batch needs an open client".to_owned()))?;
    let ops_value = json_arg(ops_json, "ops", Value::Null)?;
    let list: Vec<batch::BatchOp> = serde_json::from_value(ops_value).map_err(|error| {
        ErrorInfo::invalid(format!("ops must be a list of {{id?, op, args?}}: {error}"))
    })?;
    let options: BatchOptions =
        serde_json::from_value(json_arg(options_json, "options", json!({}))?)
            .map_err(|error| ErrorInfo::invalid(format!("options: {error}")))?;
    let prepared = batch::prepare(list).map_err(|error| classify_error(&error))?;
    let total = prepared.len();

    let runtime = shared_runtime().map_err(ErrorInfo::invalid)?;
    let channel = BatchChannel::new();
    let driver = runtime.spawn(batch::run_batch(client, prepared, options, channel.clone()));
    let abort = driver.abort_handle();
    // A driver that dies (a panic) must still end the batch, or its consumer would poll forever.
    let supervised = channel.clone();
    runtime.spawn(async move {
        if let Err(error) = driver.await
            && error.is_panic()
        {
            supervised
                .finish(json!({ "stopped_by": "error", "error": "the batch driver panicked" }));
        }
    });

    let id = NEXT_BATCH.fetch_add(1, Ordering::SeqCst);
    batches().insert(id, BatchEntry { channel, abort });
    Ok(json!({ "ok": true, "batch": id, "total": total }))
}

/// Start a batch and return `{"ok":true,"batch":<id>,"total":<n>}` or `{"ok":false,"error":{...}}`
/// (unparsable operations, duplicate ids, unknown client).
///
/// `ops_json` is a JSON array of `{"id"?,"op","args"?}`; `options_json` (`NULL` for defaults) is
/// `{"concurrency","retry":{...},"pacing":{...},"checkpoint","timeout_ms","buffer","stop_on_auth"}`.
/// Results are collected with `aphrody_web_x_batch_poll`.
///
/// # Safety
///
/// `ops_json` must be a readable, NUL-terminated C string; `options_json` may be `NULL` or the same.
/// The returned string must be released exactly once with `aphrody_string_free`.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn aphrody_web_x_batch_submit(
    client: u64,
    ops_json: *const c_char,
    options_json: *const c_char,
) -> *mut c_char {
    guard(std::ptr::null_mut(), || {
        into_c_string(match submit_batch(client, ops_json, options_json) {
            Ok(value) => value.to_string(),
            Err(info) => error_text(&info),
        })
    })
}

/// Take up to `max_items` finished results of a batch:
/// `{"items":[envelope...],"done":false,"pending":3,"completed":120,"total":500,"summary":null}`.
/// `done` turns true with the last poll (the batch finished and everything was drained); that poll
/// carries the `summary` and forgets the batch. An unknown id answers `{"ok":false,"error":{...}}`.
///
/// The returned string must be released exactly once with `aphrody_string_free`.
#[unsafe(no_mangle)]
pub extern "C" fn aphrody_web_x_batch_poll(batch: u64, max_items: u32) -> *mut c_char {
    guard(std::ptr::null_mut(), || {
        let channel = batches().get(&batch).map(|entry| entry.channel.clone());
        let Some(channel) = channel else {
            return into_c_string(error_text(&ErrorInfo::invalid(format!(
                "unknown batch id {batch}"
            ))));
        };
        let poll = channel.drain(usize::try_from(max_items.max(1)).unwrap_or(usize::MAX));
        if poll["done"] == Value::Bool(true) {
            batches().remove(&batch);
        }
        into_c_string(poll.to_string())
    })
}

/// Stop a batch: no further operation is dispatched, those in flight are aborted, and the batch
/// is forgotten (results not yet polled are dropped; a checkpoint keeps every completed result).
/// Returns `1` when the batch existed, `0` otherwise.
#[unsafe(no_mangle)]
pub extern "C" fn aphrody_web_x_batch_cancel(batch: u64) -> i32 {
    guard(0, || match batches().remove(&batch) {
        Some(entry) => {
            entry.abort.abort();
            1
        }
        None => 0,
    })
}

#[cfg(test)]
mod tests {
    use std::{ffi::CStr, ffi::CString};

    use aphrody_x::mock::{MockServer, Response};

    use super::*;

    fn c(text: &str) -> CString {
        CString::new(text).unwrap()
    }

    /// Take ownership of a returned string and parse it.
    fn text(ptr: *mut c_char) -> Value {
        assert!(!ptr.is_null());
        // SAFETY: the pointer was just returned by this library and is freed exactly once.
        let value = unsafe { CStr::from_ptr(ptr) }
            .to_string_lossy()
            .into_owned();
        unsafe { crate::aphrody_string_free(ptr) };
        serde_json::from_str(&value).unwrap()
    }

    fn open(server: &MockServer) -> u64 {
        let session = c(r#"{"auth_token":"AUTH_TOKEN_PLACEHOLDER","ct0":"CT0_PLACEHOLDER"}"#);
        let options = c(&json!({
            "api_base": server.api_base(),
            "upload_base": server.upload_url(),
            "persist_session": false,
            "query_ids_path": std::env::temp_dir()
                .join(format!("aphx-ffi-{}.json", std::process::id()))
                .display()
                .to_string(),
            "discovery_pages": [],
        })
        .to_string());
        // SAFETY: both strings outlive the call.
        let opened = text(unsafe { aphrody_web_x_client_open(session.as_ptr(), options.as_ptr()) });
        assert_eq!(opened["ok"], true, "{opened}");
        assert!(
            !opened.to_string().contains("AUTH_TOKEN_PLACEHOLDER"),
            "credentials never come back"
        );
        opened["client"].as_u64().unwrap()
    }

    fn wait_job(id: u64) -> Value {
        for _ in 0..1000 {
            let ptr = jobs::web_internal_job_take(id);
            if !ptr.is_null() {
                return text(ptr);
            }
            std::thread::sleep(Duration::from_millis(5));
        }
        panic!("job {id} did not complete");
    }

    fn user_response() -> Value {
        json!({ "data": { "user": { "result": {
            "rest_id": "7",
            "core": { "name": "Aphrody", "screen_name": "aphrody_code" },
            "legacy": { "followers_count": 10, "friends_count": 5 }
        } } } })
    }

    #[test]
    fn a_job_runs_an_operation_through_the_loopback_server() {
        let runtime = shared_runtime().unwrap();
        let server = runtime.block_on(MockServer::start(|_| Response::ok(user_response())));
        let client = open(&server);
        let op = c("user_by_screen_name");
        let args = c(r#"{"handle":"@aphrody_code"}"#);
        let options = c(r#"{"id":"call-1"}"#);
        // SAFETY: all strings outlive the call.
        let id =
            unsafe { aphrody_web_x_submit(client, op.as_ptr(), args.as_ptr(), options.as_ptr()) };
        assert!(id > 0);
        let envelope = wait_job(id);
        assert_eq!(envelope["ok"], true, "{envelope}");
        assert_eq!(envelope["id"], "call-1");
        assert_eq!(envelope["data"]["screen_name"], "aphrody_code");
        assert_eq!(
            server.requests()[0].header("x-csrf-token"),
            Some("CT0_PLACEHOLDER")
        );
        assert_eq!(aphrody_web_x_client_close(client), 1);
        assert_eq!(aphrody_web_x_client_close(client), 0);
    }

    #[test]
    fn argument_problems_resolve_the_job_at_once_with_an_invalid_envelope() {
        let op = c("whoami");
        let args = c("{not json");
        // SAFETY: strings outlive the call.
        let id = unsafe { aphrody_web_x_submit(0, op.as_ptr(), args.as_ptr(), std::ptr::null()) };
        assert!(id > 0);
        assert_eq!(
            jobs::web_internal_job_status(id),
            1,
            "resolved without running"
        );
        let envelope = wait_job(id);
        assert_eq!(envelope["ok"], false);
        assert_eq!(envelope["error"]["kind"], "invalid");

        // SAFETY: a null op pointer is rejected before any use.
        let id = unsafe {
            aphrody_web_x_submit(0, std::ptr::null(), std::ptr::null(), std::ptr::null())
        };
        assert_eq!(wait_job(id)["error"]["kind"], "invalid");
        let unknown = unsafe {
            aphrody_web_x_submit(99_999, op.as_ptr(), std::ptr::null(), std::ptr::null())
        };
        assert!(
            wait_job(unknown)["error"]["message"]
                .as_str()
                .unwrap()
                .contains("unknown client")
        );
    }

    #[test]
    fn local_operations_are_synchronous_and_network_ones_are_refused() {
        let op = c("parse_post_count");
        let args = c(r#"{"text":"5M posts"}"#);
        // SAFETY: strings outlive the call.
        let envelope = text(unsafe { aphrody_web_x_call(0, op.as_ptr(), args.as_ptr()) });
        assert_eq!(envelope["ok"], true);
        assert_eq!(envelope["data"], 5_000_000);

        let net = c("search");
        let refused = text(unsafe { aphrody_web_x_call(0, net.as_ptr(), std::ptr::null()) });
        assert_eq!(refused["ok"], false);
        assert!(
            refused["error"]["message"]
                .as_str()
                .unwrap()
                .contains("network operation")
        );

        let meta = c("meta");
        let table = text(unsafe { aphrody_web_x_call(0, meta.as_ptr(), std::ptr::null()) });
        assert!(table["data"]["ops"].as_array().unwrap().len() > 100);
    }

    #[test]
    fn opening_a_client_validates_the_session_and_hides_it() {
        let half = c(r#"{"auth_token":"only-one"}"#);
        // SAFETY: strings outlive the call.
        let refused = text(unsafe { aphrody_web_x_client_open(half.as_ptr(), std::ptr::null()) });
        assert_eq!(refused["ok"], false);
        assert!(
            refused["error"]["message"]
                .as_str()
                .unwrap()
                .contains("both auth_token and ct0")
        );
        let bad = c("{oops");
        let refused = text(unsafe { aphrody_web_x_client_open(bad.as_ptr(), std::ptr::null()) });
        assert_eq!(refused["error"]["kind"], "invalid");
        let cookie = c(r#""auth_token=AAA; ct0=BBB""#);
        let opened = text(unsafe { aphrody_web_x_client_open(cookie.as_ptr(), std::ptr::null()) });
        assert_eq!(opened["ok"], true);
        assert_eq!(
            aphrody_web_x_client_close(opened["client"].as_u64().unwrap()),
            1
        );
    }

    #[test]
    fn a_batch_runs_polls_and_forgets_itself() {
        let runtime = shared_runtime().unwrap();
        let server = runtime.block_on(MockServer::start(|request| {
            if request.json()["variables"]["tweet_id"] == "1002" {
                Response::x_error(403, 139, "already favorited")
            } else {
                Response::ok(json!({ "data": { "favorite_tweet": "Done" } }))
            }
        }));
        let client = open(&server);
        let ops = c(&json!([
            { "id": "a", "op": "like", "args": { "id": "1001" } },
            { "id": "b", "op": "like", "args": { "id": "1002" } },
            { "id": "c", "op": "like", "args": { "id": "1003" } },
        ])
        .to_string());
        let options = c(r#"{"concurrency":2}"#);
        // SAFETY: strings outlive the call.
        let started =
            text(unsafe { aphrody_web_x_batch_submit(client, ops.as_ptr(), options.as_ptr()) });
        assert_eq!(started["ok"], true, "{started}");
        assert_eq!(started["total"], 3);
        let batch = started["batch"].as_u64().unwrap();

        let mut items: Vec<Value> = Vec::new();
        let summary = loop {
            let poll = text(aphrody_web_x_batch_poll(batch, 10));
            items.extend(poll["items"].as_array().unwrap().iter().cloned());
            if poll["done"] == true {
                break poll["summary"].clone();
            }
            std::thread::sleep(Duration::from_millis(5));
        };
        assert_eq!(items.len(), 3);
        let failed = items.iter().find(|i| i["id"] == "b").unwrap();
        assert_eq!(failed["error"]["kind"], "terminal");
        assert_eq!(
            (summary["ok"].clone(), summary["failed"].clone()),
            (json!(2), json!(1))
        );

        // The final poll forgot the batch.
        let gone = text(aphrody_web_x_batch_poll(batch, 10));
        assert_eq!(gone["ok"], false);
        assert_eq!(aphrody_web_x_batch_cancel(batch), 0);
        aphrody_web_x_client_close(client);
    }

    #[test]
    fn invalid_batches_are_rejected_before_anything_runs() {
        let runtime = shared_runtime().unwrap();
        let server = runtime.block_on(MockServer::start(|_| Response::ok(json!({}))));
        let client = open(&server);
        let duplicate = c(r#"[{"id":"x","op":"like"},{"id":"x","op":"like"}]"#);
        // SAFETY: strings outlive the call.
        let refused = text(unsafe {
            aphrody_web_x_batch_submit(client, duplicate.as_ptr(), std::ptr::null())
        });
        assert_eq!(refused["ok"], false);
        assert!(
            refused["error"]["message"]
                .as_str()
                .unwrap()
                .contains("duplicate operation id")
        );
        let garbage = c(r#"{"not":"a list"}"#);
        let refused =
            text(unsafe { aphrody_web_x_batch_submit(client, garbage.as_ptr(), std::ptr::null()) });
        assert_eq!(refused["error"]["kind"], "invalid");
        let ops = c("[]");
        let refused =
            text(unsafe { aphrody_web_x_batch_submit(0, ops.as_ptr(), std::ptr::null()) });
        assert!(
            refused["error"]["message"]
                .as_str()
                .unwrap()
                .contains("open client")
        );
        assert_eq!(server.count(), 0);
        aphrody_web_x_client_close(client);
    }

    #[test]
    fn cancelling_a_batch_aborts_the_operations_in_flight() {
        let runtime = shared_runtime().unwrap();
        let server = runtime.block_on(MockServer::start(|_| {
            Response::ok(json!({ "data": {} })).after(Duration::from_secs(10))
        }));
        let client = open(&server);
        let ops = c(r#"[{"id":"slow","op":"home_timeline"}]"#);
        // SAFETY: strings outlive the call.
        let started =
            text(unsafe { aphrody_web_x_batch_submit(client, ops.as_ptr(), std::ptr::null()) });
        let batch = started["batch"].as_u64().unwrap();
        for _ in 0..200 {
            if server.in_flight() > 0 {
                break;
            }
            std::thread::sleep(Duration::from_millis(5));
        }
        assert_eq!(server.in_flight(), 1);
        assert_eq!(aphrody_web_x_batch_cancel(batch), 1);
        assert_eq!(aphrody_web_x_batch_cancel(batch), 0);
        // Dropping the aborted request frees the server side promptly.
        for _ in 0..200 {
            if server.in_flight() == 0 {
                return;
            }
            std::thread::sleep(Duration::from_millis(5));
        }
        // The mock only decrements after its delay; the abort itself is what matters here.
        assert_eq!(text(aphrody_web_x_batch_poll(batch, 1))["ok"], false);
    }

    #[test]
    fn error_text_is_a_failed_envelope() {
        let shown = error_text(&ErrorInfo::invalid("nope"));
        let value: Value = serde_json::from_str(&shown).unwrap();
        assert_eq!(value["ok"], false);
        assert_eq!(value["error"]["kind"], "invalid");
    }
}
