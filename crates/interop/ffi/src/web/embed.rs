// SPDX-License-Identifier: Apache-2.0
//! Web embedding ABI backed by one persistent Aphrody AI process.
//!
//! The worker owns model inference and installation. This bridge preserves the
//! Bun C ABI without linking an AI crate into the OS workspace.

use aphrody_proc::NoWindow as _;
use std::{os::raw::c_char, process::Stdio, sync::OnceLock, time::Duration};

use serde_json::{Value, json};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    process::{Child, ChildStdin, ChildStdout, Command},
    sync::Mutex,
};

use super::{
    ffi_util::{borrow_str, error_json_string, guard, into_c_string, shared_runtime},
    jobs,
};

const MAX_REQUEST_BYTES: usize = 8 * 1024 * 1024;
const MAX_RESPONSE_BYTES: usize = 64 * 1024 * 1024;

struct Worker {
    _child: Child,
    stdin: ChildStdin,
    stdout: ChildStdout,
    // An aborted request leaves an unread response. Restart before the next
    // request rather than mistaking that response for a later one.
    inflight: bool,
}

fn worker_slot() -> &'static Mutex<Option<Worker>> {
    static WORKER: OnceLock<Mutex<Option<Worker>>> = OnceLock::new();
    WORKER.get_or_init(|| Mutex::new(None))
}

fn worker_binary() -> std::ffi::OsString {
    std::env::var_os("APHRODY_WEB_EMBED_BIN")
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "aphrody-embed".into())
}

fn spawn_worker() -> Result<Worker, String> {
    let mut child = Command::new(worker_binary()).no_window()
        .arg("worker")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true)
        .spawn()
        .map_err(|err| format!("Aphrody embedding worker unavailable: {err}"))?;
    let stdin = child.stdin.take().ok_or("embedding worker has no stdin")?;
    let stdout = child.stdout.take().ok_or("embedding worker has no stdout")?;
    Ok(Worker { _child: child, stdin, stdout, inflight: false })
}

async fn call_worker(request: Value) -> String {
    let payload = request.to_string().into_bytes();
    if payload.len() > MAX_REQUEST_BYTES {
        return error_json_string("embedding request too large");
    }
    let mut slot = worker_slot().lock().await;
    if slot.as_ref().is_some_and(|worker| worker.inflight) {
        *slot = None;
    }
    if slot.is_none() {
        match spawn_worker() {
            Ok(worker) => *slot = Some(worker),
            Err(err) => return error_json_string(err),
        }
    }
    let worker = slot.as_mut().expect("worker inserted above");
    worker.inflight = true;
    let result = async {
        worker.stdin.write_all(&(payload.len() as u32).to_le_bytes()).await?;
        worker.stdin.write_all(&payload).await?;
        worker.stdin.flush().await?;
        let mut prefix = [0u8; 4];
        worker.stdout.read_exact(&mut prefix).await?;
        let size = u32::from_le_bytes(prefix) as usize;
        if size > MAX_RESPONSE_BYTES {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                "embedding response too large",
            ));
        }
        let mut response = vec![0u8; size];
        worker.stdout.read_exact(&mut response).await?;
        serde_json::from_slice::<Value>(&response)
            .map_err(|err| std::io::Error::new(std::io::ErrorKind::InvalidData, err))
    }
    .await;
    match result {
        Ok(value) => {
            worker.inflight = false;
            value.to_string()
        },
        Err(err) => {
            *slot = None;
            error_json_string(format!("Aphrody embedding worker failed: {err}"))
        },
    }
}

fn parse_string_array(raw: &str) -> Result<Value, String> {
    let value: Value = serde_json::from_str(raw)
        .map_err(|err| format!("expected a JSON array of strings: {err}"))?;
    if value.as_array().is_some_and(|items| items.iter().all(Value::is_string)) {
        Ok(value)
    } else {
        Err("expected a JSON array of strings".into())
    }
}

/// Submit an embedding job. The result is a base64 packed f32 array.
///
/// # Safety
/// The pointers must be null or valid NUL-terminated strings for this call.
pub unsafe extern "C" fn web_internal_embed_submit(
    texts_json_ptr: *const c_char,
    kind_ptr: *const c_char,
    timeout_ms: u32,
) -> u64 {
    guard(0, || {
        let Some(raw) = (unsafe { borrow_str(texts_json_ptr) }) else {
            return jobs::resolved(error_json_string("invalid texts json"));
        };
        let texts = match parse_string_array(raw) {
            Ok(texts) => texts,
            Err(err) => return jobs::resolved(error_json_string(err)),
        };
        let kind = unsafe { borrow_str(kind_ptr) }.unwrap_or("passage").to_string();
        jobs::submit(
            timeout_ms,
            call_worker(json!({ "op": "embed", "texts": texts, "kind": kind })),
        )
    })
}

/// Submit cross-encoder ranking for passages.
///
/// # Safety
/// The pointers must be null or valid NUL-terminated strings for this call.
pub unsafe extern "C" fn web_internal_rerank_submit(
    query_ptr: *const c_char,
    passages_json_ptr: *const c_char,
    timeout_ms: u32,
) -> u64 {
    guard(0, || {
        let (Some(query), Some(raw)) =
            (unsafe { borrow_str(query_ptr) }, unsafe { borrow_str(passages_json_ptr) })
        else {
            return jobs::resolved(error_json_string("invalid rerank arguments"));
        };
        let passages = match parse_string_array(raw) {
            Ok(passages) => passages,
            Err(err) => return jobs::resolved(error_json_string(err)),
        };
        jobs::submit(
            timeout_ms,
            call_worker(json!({
                "op": "rerank", "query": query, "passages": passages,
            })),
        )
    })
}

/// Inspect configured models without loading them or reaching the network.
pub extern "C" fn web_internal_embed_info() -> *mut c_char {
    guard(std::ptr::null_mut(), || {
        let runtime = match shared_runtime() {
            Ok(runtime) => runtime,
            Err(err) => return into_c_string(error_json_string(err)),
        };
        let response = runtime.block_on(async {
            match tokio::time::timeout(Duration::from_secs(3), call_worker(json!({ "op": "info" })))
                .await
            {
                Ok(response) => response,
                Err(_) => error_json_string("Aphrody embedding worker info timed out"),
            }
        });
        into_c_string(response)
    })
}

/// Submit an explicit model installation job.
///
/// # Safety
/// `model_id_ptr` must be null or a valid NUL-terminated string for this call.
pub unsafe extern "C" fn web_internal_embed_install_submit(
    model_id_ptr: *const c_char,
    timeout_ms: u32,
) -> u64 {
    guard(0, || {
        let Some(model_id) = (unsafe { borrow_str(model_id_ptr) }) else {
            return jobs::resolved(error_json_string("invalid model id"));
        };
        jobs::submit(timeout_ms, call_worker(json!({ "op": "install", "model_id": model_id })))
    })
}

#[cfg(test)]
mod tests {
    use super::parse_string_array;

    #[test]
    fn rejects_non_string_arrays_before_spawning_worker() {
        assert!(parse_string_array("[\"a\",\"b\"]").is_ok());
        assert!(parse_string_array("[1]").is_err());
        assert!(parse_string_array("{}").is_err());
    }
}
