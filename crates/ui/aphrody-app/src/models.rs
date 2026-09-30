// SPDX-License-Identifier: Apache-2.0
//! Local model lifecycle and hardware telemetry behind the desktop's Models hub.
//!
//! Every model operation goes through the `aphrody model …` CLI, which owns the curated
//! catalog, the resumable SHA-256-checked downloader (`.part` files, HTTP `Range` resume)
//! and the on-disk store. The desktop reaches it over a process boundary, never by linking
//! the AI layer. `pull` streams the CLI's machine progress (one JSON object per stderr line
//! under `--json`) to the webviews as [`PULL_EVENT`]; stopping a pull kills the child, and
//! the next pull of the same id resumes from the `.part` file.
//!
//! Hardware facts come from the `aphrody-native` topology probe (RAM, AVX2, CUDA VRAM) and
//! from `aphrody model accel` for GPU names. A value that cannot be probed is `null`, never
//! a guessed default.

use std::{collections::HashMap, path::PathBuf, process::Stdio};

use serde_json::{Value, json};
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::{
    io::{AsyncBufReadExt, AsyncReadExt, BufReader},
    process::Command,
    sync::oneshot,
};

use crate::broker::{aphrody_command, resolve_aphrody_bin};

/// Event carrying `{ id, role, downloaded, total }` for every progress step of a pull.
pub const PULL_EVENT: &str = "aphrody://model-pull";

/// Environment variable read by `aphrody-models` to relocate the store.
pub(crate) const MODELS_DIR_ENV: &str = "APHRODY_MODELS_DIR";

/// Pulls in flight, keyed by catalog id; sending on the channel stops the pull.
#[derive(Default)]
pub struct Pulls(std::sync::Mutex<HashMap<String, oneshot::Sender<()>>>);

impl Pulls {
    fn lock(&self) -> std::sync::MutexGuard<'_, HashMap<String, oneshot::Sender<()>>> {
        self.0.lock().unwrap_or_else(std::sync::PoisonError::into_inner)
    }
}

/// File of the vendored store plugin holding the UI preferences (packages/app-ui/src/preferences.ts).
const PREFERENCES_STORE: &str = "preferences.json";

/// The models folder chosen in onboarding (`preferences.modelsDir`), when one is set.
///
/// Every `aphrody` child the desktop starts (model commands and the app-server) receives it as
/// `APHRODY_MODELS_DIR`, so the hub and the agent always see the same store.
#[must_use]
pub fn stored_models_dir(app: &AppHandle) -> Option<String> {
    use tauri_plugin_store::StoreExt as _;
    let preferences = app.store(PREFERENCES_STORE).ok()?.get("preferences")?;
    let dir = preferences.get("modelsDir")?.as_str()?.trim();
    (!dir.is_empty()).then(|| dir.to_owned())
}

/// `aphrody model` with the store root the user picked, no stdin and no orphan on drop.
fn model_command(app: &AppHandle) -> Command {
    let mut command = aphrody_command();
    command.arg("model").stdin(Stdio::null()).kill_on_drop(true);
    if let Some(dir) = stored_models_dir(app) {
        command.env(MODELS_DIR_ENV, dir);
    }
    command
}

fn spawn_error(error: &std::io::Error) -> String {
    format!("cannot run `{} model`: {error}", resolve_aphrody_bin().display())
}

/// A progress record written by `aphrody model pull --json` on stderr.
fn progress_record(line: &str) -> Option<Value> {
    let value = serde_json::from_str::<Value>(line).ok()?;
    (value.get("event").and_then(Value::as_str) == Some("progress")).then_some(value)
}

/// The human part of the CLI's stderr (progress records removed), as an error message.
fn cli_error(what: &str, stderr: &[u8]) -> String {
    let text = String::from_utf8_lossy(stderr);
    let message = text
        .lines()
        .filter(|line| !line.trim().is_empty() && progress_record(line).is_none())
        .collect::<Vec<_>>()
        .join("\n");
    if message.is_empty() {
        format!("`aphrody model {what}` failed")
    } else {
        format!("`aphrody model {what}` failed: {message}")
    }
}

/// Parse the JSON report of a finished `aphrody model <what> --json`.
///
/// `verify` exits non-zero on a digest mismatch after printing its report, so a report on
/// stdout wins over the exit status when `report_on_failure` is set.
fn parse_report(
    what: &str,
    success: bool,
    stdout: &[u8],
    stderr: &[u8],
    report_on_failure: bool,
) -> Result<Value, String> {
    let report = serde_json::from_slice::<Value>(stdout);
    match (success, report) {
        (true, Ok(value)) => Ok(value),
        (true, Err(error)) => Err(format!("`aphrody model {what}` returned invalid JSON: {error}")),
        (false, Ok(value)) if report_on_failure && value.is_object() => Ok(value),
        (false, _) => Err(cli_error(what, stderr)),
    }
}

async fn run_report(app: &AppHandle, args: &[&str]) -> Result<Value, String> {
    let what = args.first().copied().unwrap_or_default();
    let output = model_command(app)
        .args(args)
        .arg("--json")
        .output()
        .await
        .map_err(|error| spawn_error(&error))?;
    parse_report(what, output.status.success(), &output.stdout, &output.stderr, what == "verify")
}

/// The curated catalog (`aphrody model catalog --json`).
#[tauri::command]
pub async fn aphrody_model_catalog(app: AppHandle) -> Result<Value, String> {
    run_report(&app, &["catalog"]).await
}

/// Installed artefacts (`aphrody model list --json`).
#[tauri::command]
pub async fn aphrody_model_list(app: AppHandle) -> Result<Value, String> {
    run_report(&app, &["list"]).await
}

/// Catalog ranked for this machine (`aphrody model recommend --json`).
#[tauri::command]
pub async fn aphrody_model_recommend(
    app: AppHandle,
    task: String,
    prefer: String,
) -> Result<Value, String> {
    run_report(&app, &["recommend", "--task", &task, "--prefer", &prefer]).await
}

/// Re-hash the installed bytes of `id` against the recorded SHA-256.
#[tauri::command]
pub async fn aphrody_model_verify(app: AppHandle, id: String) -> Result<Value, String> {
    run_report(&app, &["verify", &id]).await
}

/// Delete `id` from the store (`aphrody model rm --json`).
#[tauri::command]
pub async fn aphrody_model_remove(app: AppHandle, id: String) -> Result<Value, String> {
    run_report(&app, &["rm", &id]).await
}

/// The store root the CLI resolves (`aphrody model path`).
#[tauri::command]
pub async fn aphrody_model_store_root(app: AppHandle) -> Result<String, String> {
    let output =
        model_command(&app).arg("path").output().await.map_err(|error| spawn_error(&error))?;
    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).trim().to_owned())
    } else {
        Err(cli_error("path", &output.stderr))
    }
}

/// Download `id` with `aphrody model pull --json`, streaming progress as [`PULL_EVENT`].
///
/// Resolves with the pull report once every artefact is on disk and digest-checked.
#[tauri::command]
pub async fn aphrody_model_pull(
    app: AppHandle,
    pulls: State<'_, Pulls>,
    id: String,
    force: Option<bool>,
) -> Result<Value, String> {
    let mut command = model_command(&app);
    command.args(["pull", &id, "--json"]).stdout(Stdio::piped()).stderr(Stdio::piped());
    if force.unwrap_or(false) {
        command.arg("--force");
    }

    let (cancel, cancelled) = oneshot::channel();
    {
        let mut running = pulls.lock();
        if running.contains_key(&id) {
            return Err(format!("{id} is already downloading"));
        }
        running.insert(id.clone(), cancel);
    }
    let spawned = command.spawn().map_err(|error| spawn_error(&error)).and_then(|mut child| {
        let stdout = child.stdout.take().ok_or("pull stdout unavailable")?;
        let stderr = child.stderr.take().ok_or("pull stderr unavailable")?;
        Ok((child, stdout, stderr))
    });
    let (mut child, mut stdout, stderr) = match spawned {
        Ok(parts) => parts,
        Err(error) => {
            pulls.lock().remove(&id);
            return Err(error);
        },
    };
    let stdout_task = tauri::async_runtime::spawn(async move {
        let mut bytes = Vec::new();
        stdout.read_to_end(&mut bytes).await.map(|_| bytes)
    });
    let events = app.clone();
    let event_id = id.clone();
    let stderr_task = tauri::async_runtime::spawn(async move {
        let mut lines = BufReader::new(stderr).lines();
        let mut human = Vec::new();
        while let Ok(Some(line)) = lines.next_line().await {
            if let Some(record) = progress_record(&line) {
                let _ = events.emit(
                    PULL_EVENT,
                    json!({
                        "id": event_id,
                        "role": record.get("role"),
                        "downloaded": record.get("downloaded"),
                        "total": record.get("total"),
                    }),
                );
            } else {
                human.extend_from_slice(line.as_bytes());
                human.push(b'\n');
            }
        }
        human
    });

    let status = tokio::select! {
        status = child.wait() => status.map_err(|error| format!("pull {id}: {error}")),
        _ = cancelled => {
            let _ = child.kill().await;
            Err(format!("download of {id} stopped; pulling it again resumes from the partial file"))
        },
    };
    pulls.lock().remove(&id);
    let status = status?;

    let stdout = stdout_task
        .await
        .map_err(|error| format!("pull {id}: {error}"))?
        .map_err(|error| format!("pull {id}: {error}"))?;
    let stderr = stderr_task.await.map_err(|error| format!("pull {id}: {error}"))?;
    parse_report("pull", status.success(), &stdout, &stderr, false)
}

/// Stop the pull of `id`. Returns whether one was running.
#[tauri::command]
pub fn aphrody_model_cancel(pulls: State<'_, Pulls>, id: String) -> bool {
    pulls.lock().remove(&id).is_some_and(|cancel| cancel.send(()).is_ok())
}

/// A probed figure, `null` when the platform reported nothing (the probe's `0`).
fn known(value: u32) -> Value {
    if value == 0 { Value::Null } else { json!(value) }
}

/// Host hardware for the Models hub: RAM, AVX2 and CUDA VRAM from the `aphrody-native`
/// topology probe, GPU names and VRAM from `aphrody model accel`.
#[tauri::command]
pub async fn aphrody_hardware_telemetry(app: AppHandle) -> Result<Value, String> {
    let topology = tauri::async_runtime::spawn_blocking(aphrody_native::NativeLibc::get_topology)
        .await
        .map_err(|error| format!("hardware probe: {error}"))?;
    let avx2 = if cfg!(any(target_arch = "x86", target_arch = "x86_64")) {
        json!(topology.has_avx2)
    } else {
        Value::Null
    };
    let (gpus, gpu_error) = match run_report(&app, &["accel"]).await {
        Ok(profile) => (profile.get("gpus").cloned().unwrap_or_else(|| json!([])), Value::Null),
        Err(error) => (Value::Null, json!(error)),
    };
    Ok(json!({
        "cpuThreads": known(topology.cpu_count),
        "memoryTotalMb": known(topology.memory_total_mb),
        "memoryAvailableMb": known(topology.memory_available_mb),
        "avx2": avx2,
        "cudaVramTotalMb": if topology.has_cuda { known(topology.cuda_vram_total_mb) } else { Value::Null },
        "gpus": gpus,
        "gpuError": gpu_error,
    }))
}

/// External model store candidate and detected status.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ExternalStoreStatus {
    pub id: String,
    pub name: String,
    pub path: String,
    pub exists: bool,
    pub model_count: Option<usize>,
}

fn resolve_user_home(app: &AppHandle) -> Option<PathBuf> {
    app.path()
        .home_dir()
        .ok()
        .or_else(|| std::env::var_os("USERPROFILE").map(PathBuf::from))
        .or_else(|| std::env::var_os("HOME").map(PathBuf::from))
}

/// Scan standard external model store directories (Ollama, LM Studio, HuggingFace)
/// without assumptions or mock data.
#[tauri::command]
pub async fn aphrody_model_scan_external(
    app: AppHandle,
) -> Result<Vec<ExternalStoreStatus>, String> {
    let home = resolve_user_home(&app);
    let mut results = Vec::new();

    let candidates = [
        (
            "ollama",
            "Ollama",
            std::env::var("OLLAMA_MODELS").ok().map(PathBuf::from),
            vec![".ollama", "models"],
        ),
        ("lm-studio", "LM Studio", None, vec![".cache", "lm-studio", "models"]),
        (
            "huggingface",
            "HuggingFace",
            std::env::var("HF_HOME").ok().map(|p| PathBuf::from(p).join("hub")),
            vec![".cache", "huggingface", "hub"],
        ),
    ];

    for (id, name, env_override, subpath_parts) in candidates {
        let path = if let Some(override_path) = env_override {
            override_path
        } else if let Some(ref h) = home {
            let mut p = h.clone();
            for part in subpath_parts {
                p.push(part);
            }
            p
        } else {
            continue;
        };

        let exists = path.is_dir();
        let model_count = if exists {
            std::fs::read_dir(&path).ok().map(|entries| {
                entries
                    .flatten()
                    .filter(|entry| {
                        let file_name = entry.file_name();
                        let name_str = file_name.to_string_lossy();
                        !name_str.starts_with('.') && !name_str.ends_with(".TAG")
                    })
                    .count()
            })
        } else {
            None
        };

        results.push(ExternalStoreStatus {
            id: id.to_string(),
            name: name.to_string(),
            path: path.to_string_lossy().to_string(),
            exists,
            model_count,
        });
    }

    Ok(results)
}

#[cfg(test)]
mod tests {
    use super::{cli_error, parse_report, progress_record};

    #[test]
    fn only_progress_events_are_progress_records() {
        let line = r#"{"event":"progress","spec":"x","role":"weights","downloaded":5,"total":10}"#;
        assert!(progress_record(line).is_some());
        assert!(progress_record(r#"{"event":"other"}"#).is_none());
        assert!(progress_record("pulling x into /models").is_none());
    }

    #[test]
    fn cli_errors_drop_progress_records() {
        let stderr =
            b"{\"event\":\"progress\",\"downloaded\":1}\nError: pull `x`: digest mismatch\n";
        assert_eq!(
            cli_error("pull", stderr),
            "`aphrody model pull` failed: Error: pull `x`: digest mismatch"
        );
        assert_eq!(cli_error("rm", b""), "`aphrody model rm` failed");
    }

    #[test]
    fn a_failed_verify_still_returns_its_report() {
        let report = br#"{"spec":"x","intact":false,"artifacts":[]}"#;
        let value = parse_report("verify", false, report, b"mismatch", true).unwrap();
        assert_eq!(value["intact"], false);
        assert!(parse_report("rm", false, report, b"boom", false).is_err());
        assert!(parse_report("list", true, b"not json", b"", false).is_err());
    }
}
