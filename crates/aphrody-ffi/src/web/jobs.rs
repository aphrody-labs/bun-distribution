// SPDX-License-Identifier: Apache-2.0
//! Non-blocking job handles for network-bound work.
//!
//! The synchronous symbols (`web_internal_dns_recon`, `web_internal_gemini_web_ask`, `web_internal_x_*`)
//! call `Runtime::block_on`, which freezes the caller's thread — in Bun that is
//! the JavaScript event loop, so an MCP server stops answering for the whole
//! request. The job API instead spawns the future on the shared runtime and
//! returns an id immediately:
//!
//! ```text
//! id = web_internal_*_submit(args…, timeout_ms)   // never blocks
//! web_internal_job_completed_seq()                // cheap "anything finished?" probe
//! web_internal_job_take(id) -> JSON | NULL        // NULL while pending
//! web_internal_job_cancel(id)                     // abort + discard
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
    LocalPending(tokio::sync::oneshot::Sender<()>),
    Done(String),
}

struct Registry {
    next_id: AtomicU64,
    completed_seq: AtomicU64,
    local_in_flight: AtomicU64,
    jobs: Mutex<HashMap<u64, JobState>>,
}

fn registry() -> &'static Registry {
    static REGISTRY: OnceLock<Registry> = OnceLock::new();
    REGISTRY.get_or_init(|| Registry {
        next_id: AtomicU64::new(1),
        completed_seq: AtomicU64::new(0),
        local_in_flight: AtomicU64::new(0),
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
    if let Some(state) = jobs.get_mut(&id)
        && matches!(state, JobState::Pending(_) | JobState::LocalPending(_))
    {
        *state = JobState::Done(output);
        reg.completed_seq.fetch_add(1, Ordering::SeqCst);
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

/// Construct and poll a thread-affine future on the shared runtime's worker
/// pool. Only its factory crosses threads. Cancellation is delivered to the
/// local executor; aborting a running spawn_blocking task would not cancel it.
pub(crate) fn submit_local<C, F>(timeout_ms: u32, factory: C) -> u64
where
    C: FnOnce() -> F + Send + 'static,
    F: Future<Output = String> + 'static,
{
    submit_local_inner(timeout_ms, factory, false)
}

/// Compatibility command capture is serialized; structured product workflows
/// use `submit_local` and can run independently without redirecting stdio.
pub(crate) fn submit_captured<C, F>(timeout_ms: u32, factory: C) -> u64
where
    C: FnOnce() -> F + Send + 'static,
    F: Future<Output = String> + 'static,
{
    submit_local_inner(timeout_ms, factory, true)
}

fn submit_local_inner<C, F>(timeout_ms: u32, factory: C, capture: bool) -> u64
where
    C: FnOnce() -> F + Send + 'static,
    F: Future<Output = String> + 'static,
{
    let rt = match shared_runtime() {
        Ok(rt) => rt,
        Err(error) => return resolved(error_json_string(error)),
    };
    let reg = registry();
    let id = reg.next_id.fetch_add(1, Ordering::SeqCst);
    let (cancel, cancelled) = tokio::sync::oneshot::channel();
    // Thread-affine jobs occupy a blocking executor until teardown. Refuse
    // saturation rather than enqueue unbounded futures and thread stacks.
    if reg
        .local_in_flight
        .fetch_update(Ordering::SeqCst, Ordering::SeqCst, |count| (count < 64).then_some(count + 1))
        .is_err()
    {
        return resolved(error_json_string("native workflow executor saturated (64 jobs)"));
    }
    lock_jobs(reg).insert(id, JobState::LocalPending(cancel));
    let deadline = (timeout_ms != 0)
        .then(|| tokio::time::Instant::now() + Duration::from_millis(u64::from(timeout_ms)));
    let work = rt.spawn_blocking(move || {
        let execute = || {
            rt.block_on(async move {
                let future = async move {
                    if let Some(deadline) = deadline {
                        if tokio::time::Instant::now() >= deadline {
                            return error_json_string(format!("timed out after {timeout_ms} ms"));
                        }
                        match tokio::time::timeout_at(deadline, factory()).await {
                            Ok(output) => output,
                            Err(_) => error_json_string(format!("timed out after {timeout_ms} ms")),
                        }
                    } else {
                        factory().await
                    }
                };
                tokio::select! {
                    biased;
                    _ = cancelled => error_json_string("cancelled"),
                    output = future => output,
                }
            })
        };
        if capture { crate::native::capture_job(execute) } else { execute() }
    });
    rt.spawn(async move {
        let output = match work.await {
            Ok(output) => output,
            Err(error) if error.is_panic() => error_json_string("native local job panicked"),
            Err(_) => error_json_string("native local job cancelled"),
        };
        complete(id, output);
        reg.local_in_flight.fetch_sub(1, Ordering::SeqCst);
    });
    id
}

pub(crate) fn local_pending_count() -> u64 {
    registry().local_in_flight.load(Ordering::SeqCst)
}

/// Monotonic counter incremented every time a job completes. Callers poll this
/// single integer and only scan their pending ids when it changes.
pub extern "C" fn web_internal_job_completed_seq() -> u64 {
    registry().completed_seq.load(Ordering::SeqCst)
}

/// Number of jobs that are still running.
pub extern "C" fn web_internal_job_pending_count() -> u32 {
    guard(0, || {
        let count = lock_jobs(registry())
            .values()
            .filter(|state| matches!(state, JobState::Pending(_) | JobState::LocalPending(_)))
            .count();
        u32::try_from(count).unwrap_or(u32::MAX)
    })
}

/// Job state: `0` pending, `1` done (result ready), `-1` unknown id.
pub extern "C" fn web_internal_job_status(id: u64) -> i32 {
    guard(-1, || match lock_jobs(registry()).get(&id) {
        Some(JobState::Pending(_) | JobState::LocalPending(_)) => 0,
        Some(JobState::Done(_)) => 1,
        None => -1,
    })
}

/// Take a finished job's JSON result, removing the job.
///
/// Returns `NULL` while the job is pending and an `{"error": ...}` payload for
/// unknown ids. A non-null result must be released with `web_internal_free_string`.
pub extern "C" fn web_internal_job_take(id: u64) -> *mut c_char {
    guard(std::ptr::null_mut(), || {
        let mut jobs = lock_jobs(registry());
        match jobs.get(&id) {
            Some(JobState::Pending(_) | JobState::LocalPending(_)) => std::ptr::null_mut(),
            Some(JobState::Done(_)) => match jobs.remove(&id) {
                Some(JobState::Done(output)) => into_c_string(output),
                _ => std::ptr::null_mut(),
            },
            None => error_json(format!("unknown job id {id}")),
        }
    })
}

/// Cancel a job and discard its result. Returns `1` when a job was removed.
pub extern "C" fn web_internal_job_cancel(id: u64) -> i32 {
    guard(0, || match lock_jobs(registry()).remove(&id) {
        Some(JobState::LocalPending(cancel)) => {
            let _ = cancel.send(());
            1
        },
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
            let ptr = web_internal_job_take(id);
            if !ptr.is_null() {
                let value = unsafe { CStr::from_ptr(ptr) }.to_string_lossy().into_owned();
                unsafe { crate::web_internal_free_string(ptr) };
                return value;
            }
            std::thread::sleep(Duration::from_millis(2));
        }
        panic!("job {id} did not complete");
    }

    #[test]
    fn submit_returns_immediately_and_resolves() {
        let seq = web_internal_job_completed_seq();
        let id = submit(0, async {
            tokio::time::sleep(Duration::from_millis(30)).await;
            "{\"ok\":true}".to_string()
        });
        assert_eq!(web_internal_job_status(id), 0, "job must be pending right after submit");
        assert!(web_internal_job_take(id).is_null());
        assert_eq!(wait_for(id), "{\"ok\":true}");
        assert!(web_internal_job_completed_seq() > seq);
        assert_eq!(web_internal_job_status(id), -1, "taken jobs are forgotten");
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
        assert_eq!(web_internal_job_cancel(id), 1);
        assert_eq!(web_internal_job_status(id), -1);
        assert_eq!(web_internal_job_cancel(id), 0);
    }

    #[test]
    fn unknown_job_yields_error_payload() {
        let ptr = web_internal_job_take(u64::MAX);
        assert!(!ptr.is_null());
        let value = unsafe { CStr::from_ptr(ptr) }.to_string_lossy().into_owned();
        unsafe { crate::web_internal_free_string(ptr) };
        assert!(value.contains("unknown job"));
    }

    #[test]
    fn local_future_stays_on_its_creation_thread_and_is_cancelled() {
        use std::{
            rc::Rc,
            sync::{Arc, atomic::AtomicBool},
        };
        let entered = Arc::new(AtomicBool::new(false));
        let stopped = Arc::new(AtomicBool::new(false));
        let entered_job = entered.clone();
        let stopped_job = stopped.clone();
        let id = submit_local(0, move || async move {
            struct Teardown(Arc<AtomicBool>);
            impl Drop for Teardown {
                fn drop(&mut self) {
                    self.0.store(true, Ordering::SeqCst);
                }
            }
            let _teardown = Teardown(stopped_job);
            let local = Rc::new(std::thread::current().id());
            entered_job.store(true, Ordering::SeqCst);
            tokio::time::sleep(Duration::from_secs(30)).await;
            assert_eq!(*local, std::thread::current().id());
            "{}".into()
        });
        for _ in 0..500 {
            if entered.load(Ordering::SeqCst) {
                break;
            }
            std::thread::sleep(Duration::from_millis(2));
        }
        assert!(entered.load(Ordering::SeqCst));
        assert_eq!(web_internal_job_cancel(id), 1);
        for _ in 0..500 {
            if stopped.load(Ordering::SeqCst) {
                break;
            }
            std::thread::sleep(Duration::from_millis(2));
        }
        assert!(stopped.load(Ordering::SeqCst), "cancellation must drop the local future");
        assert_eq!(web_internal_job_status(id), -1);
    }

    #[test]
    fn local_future_deadline_and_thread_affinity_are_enforced() {
        let id = submit_local(1000, || async {
            let local = std::rc::Rc::new(std::thread::current().id());
            tokio::time::sleep(Duration::from_millis(2)).await;
            assert_eq!(*local, std::thread::current().id());
            "{\"ok\":true}".into()
        });
        assert_eq!(wait_for(id), "{\"ok\":true}");
        let id = submit_local(5, || async {
            let local = std::rc::Rc::new(42);
            tokio::time::sleep(Duration::from_secs(5)).await;
            local.to_string()
        });
        assert!(wait_for(id).contains("timed out"));
    }
}
