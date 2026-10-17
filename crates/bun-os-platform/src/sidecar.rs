//! Typed JSON-lines IPC to the Bun platform service (`packages/bun-os-platform/src/sidecar.ts`):
//! plugins, the file-type registry and the transfer service stay single-sourced in Bun; the
//! native shell calls them here.
//!
//! Wire format, one JSON object per line:
//! - request  `{"id": 1, "method": "files.detect", "params": {...}}`
//! - response `{"id": 1, "result": ...}` or `{"id": 1, "error": "..."}`
//! - event    `{"event": "transfer.progress", "data": {...}}`

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::path::Path;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::{self, Receiver, Sender};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde_json::{Value, json};

type Pending = Arc<Mutex<HashMap<u64, Sender<Result<Value, String>>>>>;

/// An event pushed by the service (`transfer.progress`, `plugins.changed`, ...).
#[derive(Clone, Debug)]
pub struct Event {
    pub name: String,
    pub data: Value,
}

pub struct Sidecar {
    child: Mutex<Child>,
    stdin: Mutex<ChildStdin>,
    next: AtomicU64,
    pending: Pending,
    events: Mutex<Receiver<Event>>,
}

fn bun() -> String {
    std::env::var("BUN_OS_BUN").unwrap_or_else(|_| "bun".into())
}

impl Sidecar {
    /// Starts `bun <repo>/packages/bun-os-platform/src/sidecar.ts`.
    pub fn spawn(repo: &Path) -> std::io::Result<Self> {
        let script = repo.join("packages").join("bun-os-platform").join("src").join("sidecar.ts");
        let mut command = Command::new(bun());
        command
            .arg(script)
            .current_dir(repo)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit());
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x0800_0000;
            command.creation_flags(CREATE_NO_WINDOW);
        }
        let mut child = command.spawn()?;
        let stdin = child.stdin.take().expect("piped stdin");
        let stdout = child.stdout.take().expect("piped stdout");
        let pending: Pending = Arc::default();
        let (tx, rx) = mpsc::channel();
        let reader_pending = pending.clone();
        std::thread::Builder::new()
            .name("bun-os-platform-sidecar".into())
            .spawn(move || {
                for line in BufReader::new(stdout).lines() {
                    let Ok(line) = line else { break };
                    let Ok(message) = serde_json::from_str::<Value>(&line) else { continue };
                    if let Some(name) = message.get("event").and_then(Value::as_str) {
                        let _ = tx.send(Event {
                            name: name.to_string(),
                            data: message.get("data").cloned().unwrap_or(Value::Null),
                        });
                    } else if let Some(id) = message.get("id").and_then(Value::as_u64) {
                        let reply = match message.get("error") {
                            Some(e) => Err(e.as_str().map_or_else(|| e.to_string(), str::to_string)),
                            None => Ok(message.get("result").cloned().unwrap_or(Value::Null)),
                        };
                        if let Some(sender) = reader_pending.lock().unwrap_or_else(|e| e.into_inner()).remove(&id) {
                            let _ = sender.send(reply);
                        }
                    }
                }
                for (_, sender) in reader_pending.lock().unwrap_or_else(|e| e.into_inner()).drain() {
                    let _ = sender.send(Err("platform sidecar exited".into()));
                }
            })?;
        Ok(Self {
            child: Mutex::new(child),
            stdin: Mutex::new(stdin),
            next: AtomicU64::new(1),
            pending,
            events: Mutex::new(rx),
        })
    }

    /// Sends a request; the reply arrives on the returned channel (poll it from a system).
    pub fn request(&self, method: &str, params: Value) -> Receiver<Result<Value, String>> {
        let id = self.next.fetch_add(1, Ordering::SeqCst);
        let (tx, rx) = mpsc::channel();
        self.pending.lock().unwrap_or_else(|e| e.into_inner()).insert(id, tx.clone());
        let line = json!({ "id": id, "method": method, "params": params }).to_string();
        let mut stdin = self.stdin.lock().unwrap_or_else(|e| e.into_inner());
        if writeln!(stdin, "{line}").and_then(|()| stdin.flush()).is_err() {
            self.pending.lock().unwrap_or_else(|e| e.into_inner()).remove(&id);
            let _ = tx.send(Err("platform sidecar is not running".into()));
        }
        rx
    }

    /// Blocking call with a timeout (startup, CLI, tests).
    pub fn call(&self, method: &str, params: Value, timeout: Duration) -> Result<Value, String> {
        self.request(method, params)
            .recv_timeout(timeout)
            .map_err(|_| format!("{method}: no reply within {timeout:?}"))?
    }

    /// Events received since the last drain.
    pub fn drain_events(&self) -> Vec<Event> {
        self.events.lock().unwrap_or_else(|e| e.into_inner()).try_iter().collect()
    }
}

impl Drop for Sidecar {
    fn drop(&mut self) {
        let _ = self.child.lock().unwrap_or_else(|e| e.into_inner()).kill();
    }
}
