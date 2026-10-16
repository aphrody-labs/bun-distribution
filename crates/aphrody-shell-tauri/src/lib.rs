// SPDX-License-Identifier: Apache-2.0
//! Tauri 3 plugin bridging `@aphrody/shell-web` to native PTY sessions.
//!
//! The webview owns the VT parser (WASM `WebTerminal`), so sessions are opened with
//! [`PtySession::spawn`] (no native VT state): terminal queries are answered by one emulator.
//! Output reaches the webview as `aphrody-shell-output` events `{session, bytes}`, or, for
//! sessions opened with `aphrody_shell_open_channel`, over a `tauri::ipc::Channel<Output>` with
//! bounded backpressure (the PTY reader blocks once the 256-event queue is full, and the forwarder
//! coalesces queued chunks into frames of at most [`MAX_FRAME`] bytes). Channel sessions are closed
//! when their window is destroyed or the channel stops accepting messages.

use std::{
    collections::HashMap,
    sync::{
        Arc, Mutex as StdMutex,
        atomic::{AtomicU64, Ordering},
    },
};

use aphrody_terminal_backend::{PtyConfig, PtyEvent, PtySession};
use serde::Serialize;
use tauri::{Emitter, Manager, Runtime, State, ipc::Channel};
use tokio::sync::{Mutex, mpsc};

/// Event carrying shell output (and, with `exit`, termination) to the webview.
pub const OUTPUT_EVENT: &str = "aphrody-shell-output";

/// Maximum bytes coalesced into one channel message.
pub const MAX_FRAME: usize = 64 * 1024;

/// Output frame sent to the webview (event payload and channel message share this shape).
#[derive(Clone, Serialize)]
pub struct Output {
    session: String,
    bytes: Vec<u8>,
    exit: Option<Option<u32>>,
}

/// Owner of a channel session: window label and a generation guarding against id reuse.
type Owner = (String, u64);

#[derive(Default)]
struct Sessions(
    Arc<Mutex<HashMap<String, PtySession>>>,
    Arc<StdMutex<HashMap<String, Owner>>>,
    AtomicU64,
);

impl Sessions {
    fn owners(&self) -> std::sync::MutexGuard<'_, HashMap<String, Owner>> {
        self.1.lock().unwrap_or_else(std::sync::PoisonError::into_inner)
    }

    /// Closes `session` only if it is still owned by generation `generation`.
    async fn close_owned(&self, session: &str, generation: u64) {
        {
            let mut owners = self.owners();
            if owners.get(session).is_none_or(|(_, g)| *g != generation) {
                return;
            }
            owners.remove(session);
        }
        if let Some(pty) = self.0.lock().await.remove(session) {
            pty.close().await;
        }
    }

    /// Closes every channel session owned by window `label`.
    async fn close_window(&self, label: &str) {
        let ids: Vec<String> = {
            let mut owners = self.owners();
            let ids: Vec<String> =
                owners.iter().filter(|(_, (l, _))| l == label).map(|(id, _)| id.clone()).collect();
            for id in &ids {
                owners.remove(id);
            }
            ids
        };
        for id in ids {
            if let Some(pty) = self.0.lock().await.remove(&id) {
                pty.close().await;
            }
        }
    }
}

#[tauri::command]
async fn aphrody_shell_open<R: Runtime>(
    app: tauri::AppHandle<R>,
    sessions: State<'_, Sessions>,
    session: String,
    cols: u16,
    rows: u16,
    shell: Option<String>,
) -> Result<(), String> {
    let cfg = PtyConfig { cols, rows, shell, ..PtyConfig::default() };
    let (tx, mut rx) = mpsc::channel(256);
    let pty = PtySession::spawn(&cfg, tx).map_err(|e| e.to_string())?;
    sessions.owners().remove(&session);
    if let Some(old) = sessions.0.lock().await.insert(session.clone(), pty) {
        old.close().await;
    }
    let id = session;
    tauri::async_runtime::spawn(async move {
        while let Some(event) = rx.recv().await {
            let payload = match event {
                PtyEvent::Output(bytes) => Output { session: id.clone(), bytes, exit: None },
                PtyEvent::Exit { code } => {
                    Output { session: id.clone(), bytes: Vec::new(), exit: Some(code) }
                },
            };
            if app.emit(OUTPUT_EVENT, payload).is_err() {
                break;
            }
        }
    });
    Ok(())
}

/// Opens a session whose output streams over `on_output` instead of events.
#[tauri::command]
async fn aphrody_shell_open_channel<R: Runtime>(
    webview: tauri::Webview<R>,
    sessions: State<'_, Sessions>,
    session: String,
    cols: u16,
    rows: u16,
    shell: Option<String>,
    on_output: Channel<Output>,
) -> Result<(), String> {
    open_channel(webview.label().to_owned(), &sessions, session, cols, rows, shell, move |o| {
        on_output.send(o).is_ok()
    })
    .await
}

/// Core of `aphrody_shell_open_channel`; `send` returns false once the receiver is gone.
async fn open_channel(
    owner: String,
    sessions: &Sessions,
    session: String,
    cols: u16,
    rows: u16,
    shell: Option<String>,
    send: impl Fn(Output) -> bool + Send + 'static,
) -> Result<(), String> {
    let cfg = PtyConfig { cols, rows, shell, ..PtyConfig::default() };
    let (tx, mut rx) = mpsc::channel(256);
    let pty = PtySession::spawn(&cfg, tx).map_err(|e| e.to_string())?;
    let generation = sessions.2.fetch_add(1, Ordering::Relaxed);
    sessions.owners().insert(session.clone(), (owner, generation));
    if let Some(old) = sessions.0.lock().await.insert(session.clone(), pty) {
        old.close().await;
    }
    let (map, owners) = (Arc::clone(&sessions.0), Arc::clone(&sessions.1));
    let id = session;
    tauri::async_runtime::spawn(async move {
        let mut exit = None;
        'outer: while exit.is_none() {
            let Some(first) = rx.recv().await else { break };
            let mut bytes = Vec::new();
            let mut event = Some(first);
            while let Some(ev) = event.take() {
                match ev {
                    PtyEvent::Output(b) => bytes.extend_from_slice(&b),
                    PtyEvent::Exit { code } => {
                        exit = Some(code);
                        break;
                    },
                }
                if bytes.len() < MAX_FRAME {
                    event = rx.try_recv().ok();
                }
            }
            if !bytes.is_empty() && !send(Output { session: id.clone(), bytes, exit: None }) {
                break 'outer;
            }
            // Yield so a fast producer cannot starve the IPC loop; the bounded queue stalls the PTY.
            tokio::task::yield_now().await;
        }
        let alive = exit.is_none();
        if let Some(code) = exit {
            send(Output { session: id.clone(), bytes: Vec::new(), exit: Some(code) });
        }
        if alive {
            // Receiver gone (webview closed or channel dropped): release the PTY.
            let s = Sessions(map, owners, AtomicU64::new(0));
            s.close_owned(&id, generation).await;
        }
    });
    Ok(())
}

#[tauri::command]
async fn aphrody_shell_write(
    sessions: State<'_, Sessions>,
    session: String,
    bytes: Vec<u8>,
) -> Result<(), String> {
    let map = sessions.0.lock().await;
    let pty = map.get(&session).ok_or("unknown shell session")?;
    pty.write(bytes).await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn aphrody_shell_resize(
    sessions: State<'_, Sessions>,
    session: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let map = sessions.0.lock().await;
    map.get(&session).ok_or("unknown shell session")?.resize(cols, rows).map_err(|e| e.to_string())
}

#[tauri::command]
async fn aphrody_shell_close(sessions: State<'_, Sessions>, session: String) -> Result<(), String> {
    sessions.owners().remove(&session);
    let pty = sessions.0.lock().await.remove(&session);
    if let Some(pty) = pty {
        pty.close().await;
    }
    Ok(())
}

/// Registers the shell commands; grant `aphrody-shell-tauri:default` in the app capability.
#[must_use]
pub fn init<R: Runtime>() -> tauri::plugin::TauriPlugin<R> {
    tauri::plugin::Builder::new("aphrody-shell-tauri")
        .setup(|app, _api| {
            app.manage(Sessions::default());
            Ok(())
        })
        .on_event(|app, event| {
            if let tauri::RunEvent::WindowEvent {
                label,
                event: tauri::WindowEvent::Destroyed,
                ..
            } = event
            {
                let sessions = app.state::<Sessions>();
                let (map, owners) = (Arc::clone(&sessions.0), Arc::clone(&sessions.1));
                let label = label.clone();
                tauri::async_runtime::spawn(async move {
                    Sessions(map, owners, AtomicU64::new(0)).close_window(&label).await;
                });
            }
        })
        .invoke_handler(tauri::generate_handler![
            aphrody_shell_open,
            aphrody_shell_open_channel,
            aphrody_shell_write,
            aphrody_shell_resize,
            aphrody_shell_close,
        ])
        .build()
}

#[cfg(test)]
mod tests {
    use std::{
        sync::{Arc, Mutex},
        time::Duration,
    };

    use tauri::{Listener, Manager, test::mock_app};

    use super::*;

    /// Real PTY through the plugin's command handlers on a mock Tauri app; output returns as
    /// `aphrody-shell-output` events, exactly what the webview transport listens to.
    #[tokio::test(flavor = "multi_thread")]
    #[cfg(unix)]
    async fn commands_drive_a_real_shell_and_emit_events() {
        let app = mock_app();
        app.handle().plugin(init()).expect("register plugin");
        let handle = app.handle().clone();

        let seen = Arc::new(Mutex::new(Vec::<u8>::new()));
        let sink = Arc::clone(&seen);
        app.listen(OUTPUT_EVENT, move |event| {
            let v: serde_json::Value = serde_json::from_str(event.payload()).unwrap();
            assert_eq!(v["session"], "t");
            let bytes = v["bytes"].as_array().unwrap().iter().map(|b| b.as_u64().unwrap() as u8);
            sink.lock().unwrap().extend(bytes);
        });

        let sessions = || app.state::<Sessions>();
        aphrody_shell_open(handle.clone(), sessions(), "t".into(), 80, 24, Some("/bin/sh".into()))
            .await
            .unwrap();
        aphrody_shell_resize(sessions(), "t".into(), 100, 30).await.unwrap();
        aphrody_shell_write(sessions(), "t".into(), b"echo tauri-$((40+2))\n".to_vec())
            .await
            .unwrap();

        let mut ok = false;
        for _ in 0..50 {
            tokio::time::sleep(Duration::from_millis(100)).await;
            if String::from_utf8_lossy(&seen.lock().unwrap()).contains("tauri-42") {
                ok = true;
                break;
            }
        }
        aphrody_shell_close(sessions(), "t".into()).await.unwrap();
        assert!(aphrody_shell_write(sessions(), "t".into(), vec![]).await.is_err());
        assert!(ok, "output: {:?}", String::from_utf8_lossy(&seen.lock().unwrap()));
    }

    /// Channel mode: coalesced frames arrive through the sink, the window-destroy sweep closes the
    /// session, and a dead receiver releases the PTY on its own.
    #[tokio::test(flavor = "multi_thread")]
    #[cfg(unix)]
    async fn channel_streams_output_and_cleans_up() {
        let app = mock_app();
        app.handle().plugin(init()).expect("register plugin");
        let sessions = || app.state::<Sessions>();

        let seen = Arc::new(Mutex::new(Vec::<u8>::new()));
        let alive = Arc::new(std::sync::atomic::AtomicBool::new(true));
        let (sink, flag) = (Arc::clone(&seen), Arc::clone(&alive));
        open_channel(
            "main".into(),
            &sessions(),
            "c".into(),
            80,
            24,
            Some("/bin/sh".into()),
            move |o| {
                assert_eq!(o.session, "c");
                assert!(o.bytes.len() <= MAX_FRAME || o.exit.is_some());
                sink.lock().unwrap().extend(o.bytes);
                flag.load(Ordering::Relaxed)
            },
        )
        .await
        .unwrap();
        aphrody_shell_write(sessions(), "c".into(), b"echo chan-$((40+2))\n".to_vec())
            .await
            .unwrap();
        let mut ok = false;
        for _ in 0..50 {
            tokio::time::sleep(Duration::from_millis(100)).await;
            if String::from_utf8_lossy(&seen.lock().unwrap()).contains("chan-42") {
                ok = true;
                break;
            }
        }
        assert!(ok, "output: {:?}", String::from_utf8_lossy(&seen.lock().unwrap()));

        // Window destroyed: owned sessions are closed.
        sessions().close_window("main").await;
        assert!(aphrody_shell_write(sessions(), "c".into(), vec![]).await.is_err());

        // Receiver gone: the forwarder releases the PTY by itself.
        open_channel("w2".into(), &sessions(), "d".into(), 80, 24, Some("/bin/sh".into()), {
            let flag = Arc::clone(&alive);
            move |_| flag.load(Ordering::Relaxed)
        })
        .await
        .unwrap();
        alive.store(false, Ordering::Relaxed);
        aphrody_shell_write(sessions(), "d".into(), b"echo x\n".to_vec()).await.unwrap();
        let mut gone = false;
        for _ in 0..50 {
            tokio::time::sleep(Duration::from_millis(100)).await;
            if aphrody_shell_write(sessions(), "d".into(), vec![]).await.is_err() {
                gone = true;
                break;
            }
        }
        assert!(gone, "session not released after receiver dropped");
    }
}
