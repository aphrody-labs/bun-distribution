//! Non-blocking job handles for network-bound work.
//!
//! The synchronous symbols (`bxc_dns_recon`, `bxc_gemini_web_ask`, `bxc_x_*`)
//! call `Runtime::block_on`, which freezes the caller's thread — in Bun that is
//! the JavaScript event loop, so an MCP server stops answering for the whole
//! request. The job API instead spawns the future on the shared runtime and
//! returns an id immediately:
//!
//! ```text
//! id = bxc_*_submit(args…, timeout_ms)   // never blocks
//! bxc_job_completed_seq()                // cheap "anything finished?" probe
//! bxc_job_take(id) -> JSON | NULL        // NULL while pending
//! bxc_job_cancel(id)                     // abort + discard
//! ```
//!
//! Every job resolves to a JSON string. Failures (invalid arguments, timeouts,
//! panics, network errors) resolve to `{"error": "..."}` so the caller has a
//! single completion path.

use std::{
    collections::HashMap,
    future::Future,
    os::raw::c_char,
    sync::{
        Mutex, MutexGuard, OnceLock,
        atomic::{AtomicU64, Ordering},
    },
    time::Duration,
};

use super::ffi_util::{error_json, error_json_string, guard, into_c_string, shared_runtime};

enum JobState {
    Pending(Option<tokio::task::AbortHandle>),
    Done(String),
}

struct Registry {
    next_id: AtomicU64,
    completed_seq: AtomicU64,
    jobs: Mutex<HashMap<u64, JobState>>,
}

fn registry() -> &'static Registry {
    static REGISTRY: OnceLock<Registry> = OnceLock::new();
    REGISTRY.get_or_init(|| Registry {
        next_id: AtomicU64::new(1),
        completed_seq: AtomicU64::new(0),
        jobs: Mutex::new(HashMap::new()),
    })
}

fn lock_jobs(reg: &Registry) -> MutexGuard<'_, HashMap<u64, JobState>> {
    // A panic while holding the lock cannot leave the map half-updated (every
    // mutation is a single insert/replace/remove), so poisoning is ignorable.
    reg.jobs.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn complete(id: u64, output: String) {
    let reg = registry();
    let mut jobs = lock_jobs(reg);
    if let Some(state) = jobs.get_mut(&id) {
        if matches!(state, JobState::Pending(_)) {
            *state = JobState::Done(output);
            reg.completed_seq.fetch_add(1, Ordering::SeqCst);
        }
    }
    // Missing entry: the job was cancelled; the output is simply dropped.
}

/// Register a job that is already finished (argument validation failures).
pub(crate) fn resolved(output: String) -> u64 {
    let reg = registry();
    let id = reg.next_id.fetch_add(1, Ordering::SeqCst);
    lock_jobs(reg).insert(id, JobState::Done(output));
    reg.completed_seq.fetch_add(1, Ordering::SeqCst);
    id
}

/// Spawn `future` on the shared runtime and return its job id.
///
/// `timeout_ms == 0` disables the timeout. A panic inside the future resolves
/// the job with an error payload instead of leaving it pending forever.
pub(crate) fn submit<F>(timeout_ms: u32, future: F) -> u64
where
    F: Future<Output = String> + Send + 'static,
{
    let rt = match shared_runtime() {
        Ok(rt) => rt,
        Err(e) => return resolved(error_json_string(e)),
    };
    let reg = registry();
    let id = reg.next_id.fetch_add(1, Ordering::SeqCst);
    lock_jobs(reg).insert(id, JobState::Pending(None));

    let work = rt.spawn(async move {
        if timeout_ms == 0 {
            future.await
        } else {
            match tokio::time::timeout(Duration::from_millis(u64::from(timeout_ms)), future).await {
                Ok(output) => output,
                Err(_) => error_json_string(format!("timed out after {timeout_ms} ms")),
            }
        }
    });
    let abort = work.abort_handle();
    rt.spawn(async move {
        let output = match work.await {
            Ok(output) => output,
            Err(err) if err.is_panic() => error_json_string("native job panicked"),
            Err(_) => error_json_string("cancelled"),
        };
        complete(id, output);
    });

    if let Some(JobState::Pending(slot)) = lock_jobs(reg).get_mut(&id) {
        *slot = Some(abort);
    }
    id
}

/// Monotonic counter incremented every time a job completes. Callers poll this
/// single integer and only scan their pending ids when it changes.
#[unsafe(no_mangle)]
pub extern "C" fn bxc_job_completed_seq() -> u64 {
    registry().completed_seq.load(Ordering::SeqCst)
}

/// Number of jobs that are still running.
#[unsafe(no_mangle)]
pub extern "C" fn bxc_job_pending_count() -> u32 {
    guard(0, || {
        let count = lock_jobs(registry())
            .values()
            .filter(|state| matches!(state, JobState::Pending(_)))
            .count();
        u32::try_from(count).unwrap_or(u32::MAX)
    })
}

/// Job state: `0` pending, `1` done (result ready), `-1` unknown id.
#[unsafe(no_mangle)]
pub extern "C" fn bxc_job_status(id: u64) -> i32 {
    guard(-1, || match lock_jobs(registry()).get(&id) {
        Some(JobState::Pending(_)) => 0,
        Some(JobState::Done(_)) => 1,
        None => -1,
    })
}

/// Take a finished job's JSON result, removing the job.
///
/// Returns `NULL` while the job is pending and an `{"error": ...}` payload for
/// unknown ids. A non-null result must be released with `bxc_free_string`.
#[unsafe(no_mangle)]
pub extern "C" fn bxc_job_take(id: u64) -> *mut c_char {
    guard(std::ptr::null_mut(), || {
        let mut jobs = lock_jobs(registry());
        match jobs.get(&id) {
            Some(JobState::Pending(_)) => std::ptr::null_mut(),
            Some(JobState::Done(_)) => match jobs.remove(&id) {
                Some(JobState::Done(output)) => into_c_string(output),
                _ => std::ptr::null_mut(),
            },
            None => error_json(format!("unknown job id {id}")),
        }
    })
}

/// Cancel a job and discard its result. Returns `1` when a job was removed.
#[unsafe(no_mangle)]
pub extern "C" fn bxc_job_cancel(id: u64) -> i32 {
    guard(0, || match lock_jobs(registry()).remove(&id) {
        Some(JobState::Pending(Some(abort))) => {
            abort.abort();
            1
        },
        Some(_) => 1,
        None => 0,
    })
}

#[cfg(test)]
mod tests {
    use std::ffi::CStr;

    use super::*;

    fn wait_for(id: u64) -> String {
        for _ in 0..500 {
            let ptr = bxc_job_take(id);
            if !ptr.is_null() {
                let value = unsafe { CStr::from_ptr(ptr) }.to_string_lossy().into_owned();
                unsafe { crate::bxc_free_string(ptr) };
                return value;
            }
            std::thread::sleep(Duration::from_millis(2));
        }
        panic!("job {id} did not complete");
    }

    #[test]
    fn submit_returns_immediately_and_resolves() {
        let seq = bxc_job_completed_seq();
        let id = submit(0, async {
            tokio::time::sleep(Duration::from_millis(30)).await;
            "{\"ok\":true}".to_string()
        });
        assert_eq!(bxc_job_status(id), 0, "job must be pending right after submit");
        assert!(bxc_job_take(id).is_null());
        assert_eq!(wait_for(id), "{\"ok\":true}");
        assert!(bxc_job_completed_seq() > seq);
        assert_eq!(bxc_job_status(id), -1, "taken jobs are forgotten");
    }

    #[test]
    fn timeout_resolves_with_error() {
        let id = submit(10, async {
            tokio::time::sleep(Duration::from_secs(5)).await;
            String::new()
        });
        assert!(wait_for(id).contains("timed out"));
    }

    #[test]
    fn panic_resolves_with_error() {
        let previous = std::panic::take_hook();
        std::panic::set_hook(Box::new(|_| {}));
        let id = submit(0, async { panic!("boom") });
        let out = wait_for(id);
        std::panic::set_hook(previous);
        assert!(out.contains("panicked"));
    }

    #[test]
    fn cancel_discards_pending_job() {
        let id = submit(0, async {
            tokio::time::sleep(Duration::from_secs(5)).await;
            String::new()
        });
        assert_eq!(bxc_job_cancel(id), 1);
        assert_eq!(bxc_job_status(id), -1);
        assert_eq!(bxc_job_cancel(id), 0);
    }

    #[test]
    fn unknown_job_yields_error_payload() {
        let ptr = bxc_job_take(u64::MAX);
        assert!(!ptr.is_null());
        let value = unsafe { CStr::from_ptr(ptr) }.to_string_lossy().into_owned();
        unsafe { crate::bxc_free_string(ptr) };
        assert!(value.contains("unknown job"));
    }
}
