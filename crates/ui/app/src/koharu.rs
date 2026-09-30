// SPDX-License-Identifier: Apache-2.0
//! Koharu's native SDK runs outside the desktop process and owns project state.

use std::{
    collections::HashMap,
    path::PathBuf,
    process::Stdio,
    sync::{
        Arc,
        atomic::{AtomicU64, Ordering},
    },
    time::Duration,
};

use serde_json::{Value, json};
use tauri::{AppHandle, Emitter};
use tokio::{
    io::{AsyncBufReadExt as _, AsyncWriteExt as _, BufReader},
    process::{ChildStderr, ChildStdin, ChildStdout},
    sync::{Mutex, oneshot},
};

pub const EVENT: &str = "koharu://event";
pub const BACKEND_EVENT: &str = "koharu://backend";
const REQUEST_TIMEOUT: Duration = Duration::from_secs(600);

type Pending = Arc<std::sync::Mutex<HashMap<u64, oneshot::Sender<Value>>>>;

struct Connection {
    stdin: ChildStdin,
    child: aphrody_proc::GroupChild,
    pending: Pending,
}

pub struct KoharuBroker {
    app: AppHandle,
    connection: Mutex<Option<Connection>>,
    next_id: AtomicU64,
}

impl KoharuBroker {
    pub fn new(app: AppHandle) -> Self {
        Self { app, connection: Mutex::new(None), next_id: AtomicU64::new(1) }
    }

    pub async fn call(&self, method: String, params: Value) -> Result<Value, String> {
        if method.trim().is_empty() {
            return Err("Koharu method must not be empty".into());
        }
        if !params.is_object() {
            return Err("Koharu params must be an object".into());
        }

        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        let (sender, receiver) = oneshot::channel();
        {
            let mut slot = self.connection.lock().await;
            let exited = match slot.as_mut() {
                Some(connection) => {
                    connection.child.try_wait().map_err(|error| error.to_string())?.is_some()
                },
                None => false,
            };
            if exited {
                *slot = None;
            }
            if slot.is_none() {
                *slot = Some(self.spawn()?);
            }
            let connection = slot.as_mut().expect("Koharu SDK connection was created");
            connection
                .pending
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner)
                .insert(id, sender);
            let mut line =
                serde_json::to_vec(&json!({ "id": id, "method": method, "params": params }))
                    .map_err(|error| error.to_string())?;
            line.push(b'\n');
            if let Err(error) = connection.stdin.write_all(&line).await {
                *slot = None;
                return Err(format!("Koharu SDK write failed: {error}"));
            }
            if let Err(error) = connection.stdin.flush().await {
                *slot = None;
                return Err(format!("Koharu SDK flush failed: {error}"));
            }
        }

        let response = tokio::time::timeout(REQUEST_TIMEOUT, receiver)
            .await
            .map_err(|_| "Koharu SDK request timed out".to_owned())?
            .map_err(|_| "Koharu SDK exited before responding".to_owned())?;
        if let Some(error) = response.get("error") {
            return Err(error.as_str().unwrap_or("Koharu SDK returned an error").to_owned());
        }
        response.get("result").cloned().ok_or_else(|| "Koharu SDK response has no result".into())
    }

    fn spawn(&self) -> Result<Connection, String> {
        let bin = resolve_binary();
        let mut command = std::process::Command::new(&bin);
        command.stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped());
        let mut child = aphrody_proc::spawn_group(
            &mut command,
            aphrody_proc::SpawnOptions { hide_window: true, ..Default::default() },
        )
        .map_err(|error| format!("cannot start Koharu SDK at {}: {error}", bin.display()))?;
        let stdin = ChildStdin::from_std(child.take_stdin().ok_or("Koharu SDK stdin unavailable")?)
            .map_err(|error| error.to_string())?;
        let stdout =
            ChildStdout::from_std(child.take_stdout().ok_or("Koharu SDK stdout unavailable")?)
                .map_err(|error| error.to_string())?;
        let stderr =
            ChildStderr::from_std(child.take_stderr().ok_or("Koharu SDK stderr unavailable")?)
                .map_err(|error| error.to_string())?;
        let pending: Pending = Arc::default();
        let reader_pending = Arc::clone(&pending);
        let app = self.app.clone();
        tauri::async_runtime::spawn(async move {
            let _ = app.emit_to("main", BACKEND_EVENT, json!({ "state": "started" }));
            let mut lines = BufReader::new(stdout).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                let Ok(message) = serde_json::from_str::<Value>(&line) else {
                    log::warn!("Koharu SDK wrote a non-JSON line ({} bytes)", line.len());
                    continue;
                };
                if let Some(id) = message.get("id").and_then(Value::as_u64) {
                    if let Some(sender) = reader_pending
                        .lock()
                        .unwrap_or_else(std::sync::PoisonError::into_inner)
                        .remove(&id)
                    {
                        let _ = sender.send(message);
                    }
                } else {
                    let _ = app.emit_to("main", EVENT, message);
                }
            }
            reader_pending.lock().unwrap_or_else(std::sync::PoisonError::into_inner).clear();
            let _ = app.emit_to("main", BACKEND_EVENT, json!({ "state": "exited" }));
        });
        tauri::async_runtime::spawn(async move {
            // Drain diagnostics without forwarding project text or login data to desktop logs.
            let mut lines = BufReader::new(stderr).lines();
            while let Ok(Some(_)) = lines.next_line().await {}
        });
        Ok(Connection { stdin, child, pending })
    }
}

fn resolve_binary() -> PathBuf {
    if let Some(path) = std::env::var_os("KOHARU_SDK_BIN").filter(|value| !value.is_empty()) {
        return PathBuf::from(path);
    }
    let file = format!("koharu-sdk{}", std::env::consts::EXE_SUFFIX);
    if let Some(sidecar) = std::env::current_exe()
        .ok()
        .and_then(|exe| exe.parent().map(|dir| dir.join(&file)))
        .filter(|candidate| candidate.is_file())
    {
        return sidecar;
    }
    PathBuf::from(file)
}

#[tauri::command]
pub async fn koharu_rpc(
    window: tauri::WebviewWindow,
    broker: tauri::State<'_, KoharuBroker>,
    method: String,
    params: Value,
) -> Result<Value, String> {
    if window.label() != "main" {
        return Err("Koharu commands are only available from the main window".into());
    }
    broker.call(method, params).await
}
