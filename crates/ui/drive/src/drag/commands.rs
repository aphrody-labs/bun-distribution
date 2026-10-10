// SPDX-License-Identifier: FSL-1.1-ALv2
// Derived from Spacedrive (drive/apps/tauri/src-tauri/src/drag/commands.rs), adopted as the Aphrody
// Drive file explorer.
//! Drag commands. The native drag session (files leaving the app, the cursor overlay window)
//! needs the macOS Swift bridge; elsewhere `begin_drag` reports that native drags are
//! unsupported and the webview keeps its in-page drag and drop.

use tauri::{AppHandle, Manager};

use super::{DragConfig, DragCoordinator, DragResult, DragSession};
#[cfg(target_os = "macos")]
use crate::window::DriveWindow;

/// Start a drag session from `source_window_label`; returns the session ID.
#[tauri::command]
pub async fn begin_drag(
    app: AppHandle<tauri::DynRuntime>,
    config: DragConfig,
    source_window_label: String,
) -> Result<String, String> {
    log::info!("begin_drag from {source_window_label}");
    #[cfg(target_os = "macos")]
    {
        let coordinator = app.state::<DragCoordinator>();
        let session_id = uuid::Uuid::new_v4().to_string();
        let items_json = serde_json::to_string(&config.items)
            .map_err(|error| format!("Failed to serialize items: {error}"))?;
        coordinator.begin_drag(&app, session_id.clone(), config, source_window_label.clone())?;

        let overlay = DriveWindow::DragOverlay { session_id: session_id.clone() };
        let overlay_label = overlay.label();
        if let Err(error) = overlay.show(&app).await {
            coordinator.force_clear_state(&app);
            return Err(error);
        }

        // AppKit calls must run on the main thread.
        let (tx, rx) = std::sync::mpsc::channel();
        let main_app = app.clone();
        let main_session = session_id.clone();
        let main_overlay = overlay_label.clone();
        app.run_on_main_thread(move || {
            let result = (|| -> Result<bool, String> {
                let source = main_app
                    .get_webview_window(&source_window_label)
                    .ok_or("Source window not found on main thread")?;
                let overlay = main_app
                    .get_webview_window(&main_overlay)
                    .ok_or("Overlay window not found on main thread")?;
                let source_ns = source
                    .ns_window()
                    .map_err(|error| format!("Failed to get source NSWindow: {error}"))?;
                let overlay_ns = overlay
                    .ns_window()
                    .map_err(|error| format!("Failed to get overlay NSWindow: {error}"))?;
                // SAFETY: both NSWindow pointers are live for the call, on the main thread.
                let started = unsafe {
                    crate::macos::begin_native_drag(
                        &source_ns,
                        &items_json.as_str().into(),
                        &overlay_ns,
                        &main_session.as_str().into(),
                    )
                };
                let _ = overlay.show();
                Ok(started)
            })();
            let _ = tx.send(result);
        })
        .map_err(|error| format!("Failed to run on main thread: {error}"))?;

        let started = rx.recv().map_err(|error| format!("Failed to receive result: {error}"))??;
        if !started {
            coordinator.force_clear_state(&app);
            if let Some(overlay) = app.get_webview_window(&overlay_label) {
                let _ = overlay.close();
            }
            return Err("Failed to begin native drag".to_string());
        }
        Ok(session_id)
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (app, config);
        Err("Drag and drop is only supported on macOS currently".to_string())
    }
}

/// End the drag session `session_id` with `result`.
#[tauri::command]
pub async fn end_drag(
    app: AppHandle<tauri::DynRuntime>,
    session_id: String,
    result: DragResult,
) -> Result<(), String> {
    log::info!("end_drag {session_id}: {result:?}");
    app.state::<DragCoordinator>().end_drag(&app, result);
    #[cfg(target_os = "macos")]
    {
        // SAFETY: the Swift bridge copies the ID.
        unsafe { crate::macos::end_native_drag(&session_id.as_str().into()) };
        let overlay_label = DriveWindow::DragOverlay { session_id }.label();
        if let Some(overlay) = app.get_webview_window(&overlay_label) {
            let _ = overlay.close();
        }
    }
    #[cfg(not(target_os = "macos"))]
    let _ = session_id;
    Ok(())
}

/// The active drag session, if any.
#[tauri::command]
pub async fn get_drag_session(
    app: AppHandle<tauri::DynRuntime>,
) -> Result<Option<DragSession>, String> {
    Ok(app.state::<DragCoordinator>().current_session())
}

/// Cancel the active drag session (debugging).
#[tauri::command]
pub async fn force_clear_drag_state(app: AppHandle<tauri::DynRuntime>) -> Result<(), String> {
    log::warn!("force_clear_drag_state called");
    app.state::<DragCoordinator>().force_clear_state(&app);
    Ok(())
}
