// SPDX-License-Identifier: Apache-2.0
//! Tauri 3 plugin bridging `@aphrody/shell-web` to native PTY sessions.
//!
//! The webview owns the VT parser (WASM `WebTerminal`), so sessions are opened with
//! [`PtySession::spawn`] (no native VT state): terminal queries are answered by one emulator.
//! Output reaches the webview as `aphrody-shell-output` events `{session, bytes}`.

use std::{collections::HashMap, sync::Arc};

use aphrody_terminal_backend::{PtyConfig, PtyEvent, PtySession};
use serde::Serialize;
use tauri::{Emitter, Manager, Runtime, State};
use tokio::sync::{Mutex, mpsc};

/// Event carrying shell output (and, with `exit`, termination) to the webview.
pub const OUTPUT_EVENT: &str = "aphrody-shell-output";

#[derive(Clone, Serialize)]
struct Output {
    session: String,
    bytes: Vec<u8>,
    exit: Option<Option<u32>>,
}

#[derive(Default)]
struct Sessions(Arc<Mutex<HashMap<String, PtySession>>>);

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
                }
            };
            if app.emit(OUTPUT_EVENT, payload).is_err() {
                break;
            }
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
        .invoke_handler(tauri::generate_handler![
            aphrody_shell_open,
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
}
