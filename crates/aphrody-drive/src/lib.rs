// SPDX-License-Identifier: FSL-1.1-ALv2
// The bridge retains platform-specific service and drag helpers which are invoked through Tauri
// commands or compiled on other desktop targets, rather than as a public Rust API.
#![allow(dead_code, unreachable_pub)]

//! Aphrody Drive Tauri plugin.
//!
//! The Spacedrive daemon remains in the separate `drive` Cargo workspace because its SQLite
//! graph conflicts with the OS workspace. This plugin owns only the desktop bridge and talks to
//! that daemon over its local socket.

mod daemon;
mod data_dir;
mod drag;
mod file_opening;
mod files;
mod keybinds;
#[cfg(target_os = "macos")]
mod macos;
mod rpc;
mod server;
mod service;
mod window;

use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::{
        Arc,
        atomic::{AtomicU64, Ordering},
    },
};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader},
    net::TcpStream,
    sync::{RwLock, oneshot},
};

use crate::{daemon::Supervisor, keybinds::KeybindState};

/// State shared by the commands registered by this plugin.
pub struct DriveState {
    supervisor: Arc<Supervisor>,
    data_dir: PathBuf,
    current_library_id: RwLock<Option<String>>,
    selected_file_ids: RwLock<Vec<String>>,
    sidecar_server: RwLock<Option<(String, tokio::sync::mpsc::Sender<()>)>>,
    next_subscription_id: AtomicU64,
    subscriptions: Arc<RwLock<HashMap<u64, oneshot::Sender<()>>>>,
}

impl DriveState {
    fn new(app: AppHandle<tauri::DynRuntime>, data_dir: PathBuf) -> Self {
        Self {
            supervisor: Supervisor::new(
                app,
                rpc::DEFAULT_SOCKET_ADDR.to_string(),
                data_dir.clone(),
            ),
            data_dir,
            current_library_id: RwLock::new(None),
            selected_file_ids: RwLock::new(Vec::new()),
            sidecar_server: RwLock::new(None),
            next_subscription_id: AtomicU64::new(1),
            subscriptions: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    /// The directory passed to `sd-daemon --data-dir`.
    #[must_use]
    pub fn data_dir(&self) -> &Path {
        &self.data_dir
    }

    async fn server_url(&self) -> Result<String, String> {
        if let Some((url, _)) = self.sidecar_server.read().await.as_ref() {
            return Ok(url.clone());
        }
        let mut server = self.sidecar_server.write().await;
        if let Some((url, _)) = server.as_ref() {
            return Ok(url.clone());
        }
        let (url, shutdown) = server::start_server(self.data_dir.clone()).await?;
        *server = Some((url.clone(), shutdown));
        Ok(url)
    }
}

#[derive(Serialize)]
struct DaemonStatusResponse {
    is_running: bool,
    socket_addr: String,
    server_url: Option<String>,
    started_by_us: bool,
}

#[tauri::command]
async fn app_ready(window: tauri::WebviewWindow<tauri::DynRuntime>) {
    let _ = window.show();
    let _ = window.set_focus();
}

#[tauri::command]
async fn open_drive(app: AppHandle<tauri::DynRuntime>) -> Result<String, String> {
    let window = app
        .get_webview_window("drive")
        .or_else(|| app.get_webview_window("main"))
        .ok_or_else(|| "No Aphrody desktop window is available".to_string())?;
    window.show().map_err(|error| error.to_string())?;
    window.set_focus().map_err(|error| error.to_string())?;
    Ok(window.label().to_string())
}

#[tauri::command]
async fn get_daemon_socket(state: State<'_, DriveState>) -> Result<String, String> {
    Ok(state.supervisor.socket_addr().to_string())
}

#[tauri::command]
async fn get_server_url(state: State<'_, DriveState>) -> Result<String, String> {
    state.server_url().await
}

#[tauri::command]
async fn daemon_request(
    request: serde_json::Value,
    state: State<'_, DriveState>,
) -> Result<serde_json::Value, String> {
    daemon::request(state.supervisor.socket_addr(), &request).await
}

/// Stream daemon events to this webview. Each subscription owns a socket and can be cancelled.
#[tauri::command]
async fn subscribe_to_events(
    app: AppHandle<tauri::DynRuntime>,
    event_types: Option<Vec<String>>,
    filter: Option<serde_json::Value>,
    state: State<'_, DriveState>,
) -> Result<u64, String> {
    let mut stream = TcpStream::connect(state.supervisor.socket_addr())
        .await
        .map_err(|error| format!("Failed to connect to daemon events: {error}"))?;
    let line = rpc::encode_line(&rpc::subscribe_request(event_types, filter))?;
    stream
        .write_all(line.as_bytes())
        .await
        .map_err(|error| error.to_string())?;
    let id = state.next_subscription_id.fetch_add(1, Ordering::Relaxed);
    let (cancel, mut cancelled) = oneshot::channel();
    state.subscriptions.write().await.insert(id, cancel);
    let subscriptions = Arc::clone(&state.subscriptions);
    tauri::async_runtime::spawn(async move {
        let (reader, mut writer) = stream.into_split();
        let mut reader = BufReader::new(reader);
        let mut line = String::new();
        loop {
            line.clear();
            tokio::select! {
                _ = &mut cancelled => break,
                result = reader.read_line(&mut line) => {
                    if !matches!(result, Ok(count) if count > 0) { break; }
                    if let Ok(message) = rpc::decode_line(&line)
                        && let Some(event) = rpc::event_payload(&message)
                    {
                        let _ = app.emit("aphrody-drive:core-event", serde_json::json!({
                            "subscription_id": id,
                            "event": event,
                        }));
                    }
                }
            }
        }
        if let Ok(line) = rpc::encode_line(&rpc::unsubscribe_request()) {
            let _ = writer.write_all(line.as_bytes()).await;
        }
        subscriptions.write().await.remove(&id);
    });
    Ok(id)
}

#[tauri::command]
async fn unsubscribe_from_events(
    subscription_id: u64,
    state: State<'_, DriveState>,
) -> Result<(), String> {
    if let Some(cancel) = state.subscriptions.write().await.remove(&subscription_id) {
        let _ = cancel.send(());
    }
    Ok(())
}

#[tauri::command]
async fn get_daemon_status(state: State<'_, DriveState>) -> Result<DaemonStatusResponse, String> {
    let status = state.supervisor.status();
    let server_url = state
        .sidecar_server
        .read()
        .await
        .as_ref()
        .map(|(url, _)| url.clone());
    Ok(DaemonStatusResponse {
        is_running: status.running,
        socket_addr: state.supervisor.socket_addr().to_string(),
        server_url,
        started_by_us: status.started_by_us,
    })
}

#[tauri::command]
async fn start_daemon_process(state: State<'_, DriveState>) -> Result<(), String> {
    state.supervisor.ensure_started();
    Ok(())
}

#[tauri::command]
async fn stop_daemon_process(state: State<'_, DriveState>) -> Result<(), String> {
    state.supervisor.stop()
}

#[tauri::command]
async fn check_daemon_installed() -> Result<bool, String> {
    service::is_installed()
}

#[tauri::command]
async fn install_daemon_service(state: State<'_, DriveState>) -> Result<(), String> {
    let daemon = daemon::find_daemon_binary()?;
    service::install(&daemon, state.data_dir())?;
    state.supervisor.release();
    Ok(())
}

#[tauri::command]
async fn uninstall_daemon_service() -> Result<(), String> {
    service::uninstall()
}

#[tauri::command]
async fn open_macos_settings() -> Result<(), String> {
    service::open_macos_settings()
}

#[tauri::command]
async fn get_current_library_id(state: State<'_, DriveState>) -> Result<String, String> {
    state
        .current_library_id
        .read()
        .await
        .clone()
        .ok_or_else(|| "No library selected".to_string())
}

#[tauri::command]
async fn set_current_library_id(
    app: AppHandle<tauri::DynRuntime>,
    library_id: String,
    state: State<'_, DriveState>,
) -> Result<(), String> {
    *state.current_library_id.write().await = Some(library_id.clone());
    app.emit("library-changed", library_id)
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn get_selected_file_ids(state: State<'_, DriveState>) -> Result<Vec<String>, String> {
    Ok(state.selected_file_ids.read().await.clone())
}

#[tauri::command]
async fn set_selected_file_ids(
    app: AppHandle<tauri::DynRuntime>,
    file_ids: Vec<String>,
    state: State<'_, DriveState>,
) -> Result<(), String> {
    *state.selected_file_ids.write().await = file_ids.clone();
    app.emit("selected-files-changed", file_ids)
        .map_err(|error| error.to_string())
}

/// Browse remote files and directories via the kernel's native SFTP subsystem for Drive
/// integration.
#[tauri::command]
async fn drive_list_remote(host: String, remote_path: String) -> Result<serde_json::Value, String> {
    use aphrody_subsystem::SystemSubsystem;
    let infra = aphrody_kernel::InfraSubsystem::new();
    infra
        .call(
            "infra_sftp_list",
            serde_json::json!({ "host": host, "path": remote_path }),
        )
        .await
        .map_err(|e| format!("kernel infra_sftp_list error: {e}"))
}

/// Read remote file content for Drive preview and indexing via the kernel's native SFTP.
#[tauri::command]
async fn drive_read_remote(host: String, remote_path: String) -> Result<serde_json::Value, String> {
    use aphrody_subsystem::SystemSubsystem;
    let infra = aphrody_kernel::InfraSubsystem::new();
    infra
        .call(
            "infra_sftp_read",
            serde_json::json!({ "host": host, "path": remote_path }),
        )
        .await
        .map_err(|e| format!("kernel infra_sftp_read error: {e}"))
}

/// Construct the desktop-only plugin. It intentionally does not link `sd-core`.
#[must_use]
pub fn init() -> tauri::plugin::TauriPlugin<tauri::DynRuntime> {
    tauri::plugin::Builder::new("aphrody-drive")
        .setup(|app, _api| {
            let data_dir = data_dir::default_data_dir().map_err(std::io::Error::other)?;
            std::fs::create_dir_all(&data_dir)?;
            let state = DriveState::new(app.clone(), data_dir);
            state.supervisor.ensure_started();
            app.manage(state);
            app.manage(KeybindState::new());
            app.manage(drag::DragCoordinator::new());
            app.manage(file_opening::FileOpeningService::new());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            app_ready,
            open_drive,
            get_daemon_socket,
            get_server_url,
            daemon_request,
            subscribe_to_events,
            unsubscribe_from_events,
            get_daemon_status,
            start_daemon_process,
            stop_daemon_process,
            check_daemon_installed,
            install_daemon_service,
            uninstall_daemon_service,
            open_macos_settings,
            get_current_library_id,
            set_current_library_id,
            get_selected_file_ids,
            set_selected_file_ids,
            files::reveal_file,
            files::share_files,
            files::get_sidecar_path,
            keybinds::register_keybind,
            keybinds::unregister_keybind,
            keybinds::get_registered_keybinds,
            drag::begin_drag,
            drag::end_drag,
            drag::get_drag_session,
            drag::force_clear_drag_state,
            file_opening::get_apps_for_paths,
            file_opening::open_path_default,
            file_opening::open_path_with_app,
            file_opening::open_paths_with_app,
            drive_list_remote,
            drive_read_remote,
        ])
        .build()
}
