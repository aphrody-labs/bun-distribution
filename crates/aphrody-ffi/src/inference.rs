// SPDX-License-Identifier: Apache-2.0
//! Small, asynchronous Bun/C boundary over the existing native model owner.
//! No command dispatcher, HTTP listener, subprocess, model download or environment mutation.

use std::{
    collections::HashMap,
    ffi::{CString, c_char},
    fs::{File, TryLockError},
    panic::{AssertUnwindSafe, catch_unwind},
    path::PathBuf,
    sync::{
        Arc, Mutex, OnceLock,
        atomic::{AtomicU64, Ordering},
    },
};

use aphrody_agent_home::{AgentHome, BootstrapBudget, BootstrapFile, HomeOptions};
use aphrody_llama_server::in_process::{InProcessLlama, LoadOptions, LoraSpec};
use aphrody_model_client::{ChatMessage, ChatTurn, ModelClient, ModelStreamEvent, TurnOptions};
use futures::StreamExt;
use serde::Deserialize;
use serde_json::{Value, json};
use tokio::{runtime::Runtime, task::JoinHandle};

const MAX_INPUT: u32 = 1024 * 1024;
const MAX_JOBS: usize = 16;
struct Job {
    task: JoinHandle<Result<Value, String>>,
    opening: bool,
}

#[derive(Default)]
struct State {
    jobs: HashMap<u64, Job>,
    models: HashMap<u64, Arc<Session>>,
}

struct Session {
    engine: InProcessLlama,
    profile: String,
    home: PathBuf,
}

fn resident_file_at(path: &std::path::Path) -> Result<File, String> {
    let mut options = File::options();
    options.create(true).read(true).write(true).truncate(false);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    options
        .open(path)
        .map_err(|e| format!("resident model lease unavailable: {e}"))
}

#[cfg(test)]
fn resident_lease_at(path: &std::path::Path) -> Result<File, String> {
    let file = resident_file_at(path)?;
    file.try_lock().map_err(|e| e.to_string())?;
    Ok(file)
}

async fn resident_lease(id: u64) -> Result<File, String> {
    // Use the host owner's common state root, not a domain APHRODY_HOME override: profiles
    // keep their data isolated while every bot process shares the same hardware budget.
    let root = aphrody_agent_home::paths::home_dir()
        .map_err(|e| e.to_string())?
        .join(".aphrody/locks");
    let mut directory = std::fs::DirBuilder::new();
    directory.recursive(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::DirBuilderExt;
        directory.mode(0o700);
    }
    directory
        .create(&root)
        .map_err(|e| format!("resident model lease directory unavailable: {e}"))?;
    let file = resident_file_at(&root.join("native-inference.lock"))?;
    wait_resident_lease(file, id).await
}

async fn wait_resident_lease(file: File, id: u64) -> Result<File, String> {
    let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(90);
    loop {
        if !state()?.jobs.contains_key(&id) {
            return Err("model lease request was cancelled".into());
        }
        match file.try_lock() {
            Ok(()) => return Ok(file),
            Err(TryLockError::Error(error)) => {
                return Err(format!("resident model lease unavailable: {error}"));
            }
            Err(TryLockError::WouldBlock) if tokio::time::Instant::now() >= deadline => {
                return Err("another native inference process owns the resident model lease; observation deadline exceeded".into());
            }
            Err(TryLockError::WouldBlock) => {
                tokio::time::sleep(std::time::Duration::from_millis(250)).await
            }
        }
    }
}

static STATE: OnceLock<Mutex<State>> = OnceLock::new();
static RUNTIME: OnceLock<Result<Runtime, String>> = OnceLock::new();
static NEXT: AtomicU64 = AtomicU64::new(1);

fn state() -> Result<std::sync::MutexGuard<'static, State>, String> {
    STATE
        .get_or_init(|| Mutex::new(State::default()))
        .lock()
        .map_err(|_| "inference state unavailable".into())
}

fn runtime() -> Result<&'static Runtime, String> {
    RUNTIME
        .get_or_init(|| {
            tokio::runtime::Builder::new_multi_thread()
                .worker_threads(2)
                .enable_all()
                .build()
                .map_err(|error| error.to_string())
        })
        .as_ref()
        .map_err(Clone::clone)
}

#[derive(Deserialize)]
#[serde(tag = "operation", rename_all = "snake_case", deny_unknown_fields)]
enum Request {
    Open {
        model: String,
        profile: String,
        #[serde(default)]
        context: Option<u32>,
        #[serde(default)]
        gpu_layers: Option<u32>,
        #[serde(default)]
        lora: Option<PathBuf>,
    },
    Chat {
        session: u64,
        messages: Vec<ChatMessage>,
        #[serde(default)]
        system: Option<String>,
        #[serde(default)]
        max_tokens: Option<u32>,
        #[serde(default)]
        temperature: Option<f32>,
    },
    Close {
        session: u64,
    },
}

fn named_home(profile: &str) -> Result<PathBuf, String> {
    if profile.is_empty()
        || profile.len() > 64
        || !profile
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, b'_' | b'-'))
    {
        return Err("an explicit named Agent Home profile is required".into());
    }
    let state = aphrody_agent_home::paths::state_dir().map_err(|e| e.to_string())?;
    Ok(aphrody_agent_home::paths::named_profile_workspace(
        &state, profile,
    ))
}

fn home_prompt(path: PathBuf) -> Result<String, String> {
    let home = AgentHome::open(HomeOptions {
        workspace: Some(path),
        ..HomeOptions::default()
    })
    .map_err(|e| e.to_string())?;
    if home.soul().is_none() {
        return Err("the selected Agent Home has no SOUL.md; refusing a synthetic persona".into());
    }
    // This boundary performs tool-less chat. Agent execution guides are not model persona.
    // Preserve the complete protected identity; token fit is checked by the native decoder.
    let mut view = home.system_prompt(&BootstrapBudget {
        max_chars: usize::MAX,
        total_max_chars: usize::MAX,
        ..BootstrapBudget::default()
    });
    view.sections.retain(|section| {
        matches!(
            section.file,
            BootstrapFile::Soul | BootstrapFile::Identity | BootstrapFile::User
        )
    });
    if view.sections.iter().any(|section| section.truncated) {
        return Err(
            "the protected inference identity was truncated; refusing a partial persona".into(),
        );
    }
    view.truncation = None;
    Ok(view.render())
}

fn model_path(model: &str) -> Result<PathBuf, String> {
    use aphrody_models::{Catalog, ModelRef, ModelStore};
    let reference = match Catalog::builtin().get(model) {
        Ok(entry) => entry
            .primary()
            .ok_or("model has no weights")?
            .reference
            .clone(),
        Err(_) => model.parse::<ModelRef>().map_err(|e| e.to_string())?,
    };
    let store = ModelStore::open().map_err(|e| e.to_string())?;
    let installed = store
        .get(&reference)
        .map_err(|e| e.to_string())?
        .ok_or("model is not installed in the protected model store")?;
    let _ = store.touch(&reference);
    Ok(installed.path)
}

async fn execute(request: Request, id: u64) -> Result<Value, String> {
    match request {
        Request::Open {
            model,
            profile,
            context,
            gpu_layers,
            lora,
        } => {
            if context.is_some_and(|n| !(512..=32768).contains(&n)) {
                return Err("context must be between 512 and 32768 tokens".into());
            }
            // One resident model per library keeps GPU ownership bounded. Concurrent opens are
            // serialized independently of polling, status and cancellation.
            static OPEN: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());
            let _open = OPEN.lock().await;
            if !state()?.models.is_empty() {
                return Err("close the resident model before opening another".into());
            }
            let home = named_home(&profile)?;
            let home_check = home.clone();
            tokio::task::spawn_blocking(move || home_prompt(home_check))
                .await
                .map_err(|e| e.to_string())??;
            let path = model_path(&model)?;
            let resident_lease = resident_lease(id).await?;
            let options = LoadOptions {
                ctx: context,
                gpu_layers: gpu_layers.unwrap_or(u32::MAX),
                lora: lora
                    .into_iter()
                    .map(|path| LoraSpec { path, scale: 1.0 })
                    .collect(),
                ..LoadOptions::default()
            };
            let engine = InProcessLlama::load_with_residency_guard(
                path,
                &model,
                options,
                Arc::new(resident_lease),
            )
            .await
            .map_err(|e| e.to_string())?;
            let context = engine.context_window();
            {
                let mut state = state()?;
                if !state.jobs.contains_key(&id) {
                    return Err("model load was cancelled".into());
                }
                state.models.insert(
                    id,
                    Arc::new(Session {
                        engine,
                        profile: profile.clone(),
                        home,
                    }),
                );
            }
            Ok(
                json!({ "session": id, "model": model, "profile": profile, "context": context, "backend": "in-process" }),
            )
        }
        Request::Chat {
            session,
            messages,
            system,
            max_tokens,
            temperature,
        } => {
            if messages.is_empty() || messages.len() > 64 {
                return Err("chat requires 1 to 64 messages".into());
            }
            if max_tokens.is_some_and(|n| n == 0 || n > 8192) {
                return Err("max_tokens must be between 1 and 8192".into());
            }
            if temperature.is_some_and(|n| !n.is_finite() || !(0.0..=2.0).contains(&n)) {
                return Err("temperature must be between 0 and 2".into());
            }
            let session = state()?
                .models
                .get(&session)
                .cloned()
                .ok_or("unknown model session")?;
            let home = session.home.clone();
            // Re-open through the canonical owner each turn: SOUL edits take effect without
            // restarting the bot, and the selected profile never depends on process-global env.
            let mut prompt = tokio::task::spawn_blocking(move || home_prompt(home))
                .await
                .map_err(|e| e.to_string())??;
            if let Some(system) = system {
                prompt.push_str("\n\n");
                prompt.push_str(&system);
            }
            let turn = ChatTurn {
                system: Some(prompt),
                messages,
                options: TurnOptions {
                    max_output_tokens: Some(max_tokens.unwrap_or(1024)),
                    temperature,
                    ..TurnOptions::default()
                },
                ..ChatTurn::default()
            };
            let mut stream = session
                .engine
                .stream(turn)
                .await
                .map_err(|e| e.to_string())?;
            let mut text = String::new();
            let mut usage = Value::Null;
            let mut finish = None;
            while let Some(event) = stream.next().await {
                match event.map_err(|e| e.to_string())? {
                    ModelStreamEvent::TextDelta(delta) => text.push_str(&delta),
                    ModelStreamEvent::Completed { usage: tokens, finish_reason } => {
                        usage = tokens.map_or(Value::Null, |u| json!({ "input": u.input_tokens, "output": u.output_tokens, "total": u.total_tokens }));
                        finish = finish_reason;
                    },
                    ModelStreamEvent::ToolCall { .. } => return Err("tools require the agent runtime; chat does not execute model-generated commands".into()),
                    _ => {},
                }
                if text.len() > MAX_INPUT as usize {
                    return Err("model output exceeded the response limit".into());
                }
            }
            if text.trim().is_empty() {
                return Err("model returned no assistant text".into());
            }
            Ok(
                json!({ "text": text, "model": session.engine.model_id(), "profile": session.profile, "usage": usage, "finish_reason": finish }),
            )
        }
        Request::Close { session } => {
            let removed = {
                let mut state = state()?;
                // Active streams retain their own Arc until cooperative cancellation completes.
                // Removing the handle prevents new work without invalidating a decoder's memory.
                state
                    .models
                    .remove(&session)
                    .ok_or("unknown model session")?
            };
            drop(removed);
            Ok(json!({ "closed": true }))
        }
    }
}

fn submit(input: &[u8]) -> Result<Value, String> {
    let request = serde_json::from_slice::<Request>(input).map_err(|e| e.to_string())?;
    let runtime = runtime()?;
    let mut state = state()?;
    if state.jobs.len() >= MAX_JOBS {
        return Err("inference queue is full".into());
    }
    let id = NEXT.fetch_add(1, Ordering::Relaxed);
    let opening = matches!(request, Request::Open { .. });
    state.jobs.insert(
        id,
        Job {
            task: runtime.spawn(execute(request, id)),
            opening,
        },
    );
    Ok(json!({ "job": id }))
}

fn boundary(operation: impl FnOnce() -> Result<Value, String>) -> *mut c_char {
    let value = match catch_unwind(AssertUnwindSafe(operation)) {
        Ok(Ok(value)) => value,
        Ok(Err(error)) => json!({ "error": error }),
        Err(_) => json!({ "error": "native inference panicked" }),
    };
    // serde_json always escapes interior NULs.
    CString::new(value.to_string()).map_or(std::ptr::null_mut(), CString::into_raw)
}

/// Version of this independent inference ABI.
#[unsafe(no_mangle)]
pub extern "C" fn aphrody_inference_abi_version() -> u32 {
    1
}

/// Submit bounded UTF-8 JSON; returns a job id or an error. Free with `aphrody_inference_free`.
/// # Safety
/// `input` must point to `length` readable bytes for this call.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn aphrody_inference_submit(input: *const u8, length: u32) -> *mut c_char {
    boundary(|| {
        if input.is_null() || length == 0 || length > MAX_INPUT {
            return Err("invalid inference request buffer".into());
        }
        submit(unsafe { std::slice::from_raw_parts(input, length as usize) })
    })
}

/// Poll a job. Pending jobs return `pending:true`; completed jobs are consumed exactly once.
#[unsafe(no_mangle)]
pub extern "C" fn aphrody_inference_poll(id: u64) -> *mut c_char {
    boundary(|| {
        let task = {
            let mut state = state()?;
            let task = state.jobs.get(&id).ok_or("unknown inference job")?;
            if !task.task.is_finished() {
                return Ok(json!({ "pending": true }));
            }
            state.jobs.remove(&id).ok_or("unknown inference job")?.task
        };
        runtime()?
            .block_on(task)
            .map_err(|_| "inference task failed".to_owned())?
    })
}

/// Cancel/drop a job. Dropping its model stream stops decoding cooperatively.
#[unsafe(no_mangle)]
pub extern "C" fn aphrody_inference_cancel(id: u64) {
    let _ = catch_unwind(|| {
        let removed = if let Ok(mut state) = state() {
            if let Some(task) = state.jobs.remove(&id) {
                // Loading uses spawn_blocking and cannot be interrupted. Keep OPEN locked until
                // it finishes; execute notices the missing job and drops the abandoned model.
                if !task.opening {
                    task.task.abort();
                }
                state.models.remove(&id)
            } else {
                None
            }
        } else {
            None
        };
        if let Some(model) = removed
            && let Ok(runtime) = runtime()
        {
            runtime.spawn_blocking(move || drop(model));
        }
    });
}

/// Release one response buffer returned by this library. Null is accepted.
/// # Safety
/// `value` must be null or an unreleased pointer allocated by this library.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn aphrody_inference_free(value: *mut c_char) {
    if !value.is_null() {
        drop(unsafe { CString::from_raw(value) });
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::ffi::CStr;

    #[test]
    fn resident_lease_probe_child() {
        if let Some(path) = std::env::var_os("APHRODY_INFERENCE_LEASE_TEST") {
            assert!(resident_lease_at(std::path::Path::new(&path)).is_err());
        }
    }

    #[test]
    fn resident_model_lease_is_cross_process_and_released_on_last_reference() {
        let directory = tempfile::tempdir().expect("test directory");
        let path = directory.path().join("resident.lock");
        let lease = Arc::new(resident_lease_at(&path).expect("first lease"));
        let active_stream = Arc::clone(&lease);
        drop(lease);
        assert!(resident_lease_at(&path).is_err());
        let child = std::process::Command::new(std::env::current_exe().expect("test executable"))
            .args([
                "--exact",
                "inference::tests::resident_lease_probe_child",
                "--nocapture",
            ])
            .env("APHRODY_INFERENCE_LEASE_TEST", &path)
            .output()
            .expect("separate process");
        assert!(child.status.success());
        assert!(String::from_utf8_lossy(&child.stdout).contains("1 passed"));
        drop(active_stream);
        let _next = resident_lease_at(&path).expect("released lease");
    }

    #[test]
    fn cancellation_during_lease_wait_does_not_load_or_retain_a_model() {
        let directory = tempfile::tempdir().expect("test directory");
        let path = directory.path().join("resident.lock");
        let owner = resident_lease_at(&path).expect("resident owner");
        let waiter = resident_file_at(&path).expect("waiting process file");
        let runtime = runtime().expect("runtime");
        let id = NEXT.fetch_add(1, Ordering::Relaxed);
        state().expect("state").jobs.insert(
            id,
            Job {
                task: runtime.spawn(std::future::pending()),
                opening: false,
            },
        );
        runtime.spawn(async move {
            tokio::time::sleep(std::time::Duration::from_millis(20)).await;
            aphrody_inference_cancel(id);
        });
        let result = runtime.block_on(wait_resident_lease(waiter, id));
        assert!(result.expect_err("cancelled wait").contains("cancelled"));
        assert!(!state().expect("state").jobs.contains_key(&id));
        drop(owner);
        let _next = resident_lease_at(&path).expect("no waiting lease remains");
    }

    unsafe fn take(pointer: *mut c_char) -> Value {
        let value = serde_json::from_slice(unsafe { CStr::from_ptr(pointer) }.to_bytes()).unwrap();
        unsafe {
            aphrody_inference_free(pointer);
        }
        value
    }

    #[test]
    fn rejects_bad_ffi_buffers_and_unknown_jobs() {
        assert!(
            unsafe { take(aphrody_inference_submit(std::ptr::null(), 1)) }["error"].is_string()
        );
        assert!(unsafe { take(aphrody_inference_poll(u64::MAX)) }["error"].is_string());
        assert!(submit(b"{}").is_err());
        aphrody_inference_cancel(u64::MAX);
    }

    #[test]
    fn explicit_home_refuses_missing_soul_and_path_traversal() {
        assert!(named_home("../aphrody").is_err());
        let directory = tempfile::tempdir().unwrap();
        assert!(
            home_prompt(directory.path().to_owned())
                .unwrap_err()
                .contains("SOUL.md")
        );
        std::fs::write(
            directory.path().join("SOUL.md"),
            "# Fixture\nA test persona.",
        )
        .unwrap();
        assert!(
            home_prompt(directory.path().to_owned())
                .unwrap()
                .contains("A test persona.")
        );
    }

    #[test]
    fn inference_identity_is_complete_without_execution_bootstrap() {
        let directory = tempfile::tempdir().unwrap();
        let soul = format!(
            "# Fixture\n{}\nActual soul tail.",
            "Persona detail. ".repeat(1000)
        );
        std::fs::write(directory.path().join("SOUL.md"), &soul).unwrap();
        std::fs::write(
            directory.path().join("IDENTITY.md"),
            "# Identity\nActual identity.",
        )
        .unwrap();
        std::fs::write(
            directory.path().join("AGENTS.md"),
            "EXECUTION_ONLY ".repeat(5000),
        )
        .unwrap();
        std::fs::write(
            directory.path().join("TOOLS.md"),
            "UNAVAILABLE_EXECUTION_TOOLS",
        )
        .unwrap();
        let prompt = home_prompt(directory.path().to_owned()).unwrap();
        assert!(prompt.contains(&soul));
        assert!(prompt.contains("Actual identity."));
        assert!(!prompt.contains("EXECUTION_ONLY"));
        assert!(!prompt.contains("UNAVAILABLE_EXECUTION_TOOLS"));
        assert!(!prompt.contains("truncation warning"));
    }

    #[test]
    fn native_jobs_report_failures_without_a_model_or_network() {
        let id = submit(br#"{"operation":"chat","session":999999,"messages":[]}"#).unwrap()["job"]
            .as_u64()
            .unwrap();
        for _ in 0..1000 {
            let result = unsafe { take(aphrody_inference_poll(id)) };
            if result["pending"] != true {
                assert!(result["error"].as_str().unwrap().contains("messages"));
                return;
            }
            std::thread::sleep(std::time::Duration::from_millis(1));
        }
        panic!("native job did not complete");
    }
}
