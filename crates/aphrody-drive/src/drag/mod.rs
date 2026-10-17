// SPDX-License-Identifier: FSL-1.1-ALv2
// Derived from Spacedrive (drive/apps/tauri/src-tauri/src/drag/mod.rs), adopted as the Aphrody
// Drive file explorer.
//! Cross-window drag and drop: one session at a time, announced to every window through the
//! `drag:began` / `drag:moved` / `drag:entered` / `drag:left` / `drag:ended` events. The native
//! drag (files leaving the app, cursor overlay window) is driven by the macOS Swift bridge.

pub mod commands;
mod events;
mod session;

use std::time::{Duration, Instant};

pub use commands::*;
pub use events::*;
use parking_lot::RwLock;
use serde::{Deserialize, Serialize};
pub use session::*;
use tauri::{AppHandle, Emitter};

/// One dragged item.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DragItem {
    pub kind: DragItemKind,
    pub id: String,
}

/// What an item carries.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum DragItemKind {
    File {
        path: String,
    },
    FilePromise {
        name: String,
        /// Older webview payloads did not include this optional metadata.
        #[serde(default)]
        mime_type: String,
    },
    Text {
        content: String,
    },
}

/// A drag request from the webview.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DragConfig {
    pub items: Vec<DragItem>,
    pub overlay_url: String,
    pub overlay_size: (f64, f64),
    pub allowed_operations: Vec<DragOperation>,
}

/// Drop effect.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DragOperation {
    Copy,
    Move,
    Link,
}

/// A session older than this is considered stale and replaced by a new drag.
pub const STALE_AFTER: Duration = Duration::from_secs(30);

/// The single active drag session.
pub struct DragCoordinator {
    state: RwLock<Option<(DragSession, Instant)>>,
    stale_after: Duration,
}

impl Default for DragCoordinator {
    fn default() -> Self {
        Self::new()
    }
}

impl DragCoordinator {
    #[must_use]
    pub fn new() -> Self {
        Self::with_stale_after(STALE_AFTER)
    }

    #[must_use]
    pub fn with_stale_after(stale_after: Duration) -> Self {
        Self {
            state: RwLock::new(None),
            stale_after,
        }
    }

    /// Open a session; a stale one is dropped, a live one is an error.
    ///
    /// # Errors
    /// When a live session is in progress.
    pub fn open(
        &self,
        session_id: String,
        config: DragConfig,
        source_window: String,
    ) -> Result<DragBeganEvent, String> {
        let mut state = self.state.write();
        if let Some((session, started)) = state.as_ref() {
            let elapsed = started.elapsed();
            if elapsed < self.stale_after {
                log::error!("drag already in progress: {} ({elapsed:?})", session.id);
                return Err("A drag operation is already in progress".to_string());
            }
            log::warn!(
                "dropping stale drag session {} started {elapsed:?} ago",
                session.id
            );
        }
        let session = DragSession::with_id(session_id, config, source_window);
        let event = session.to_event();
        *state = Some((session, Instant::now()));
        Ok(event)
    }

    /// Close the session with `result`; `None` when no session was active.
    pub fn close(&self, result: DragResult) -> Option<DragEndEvent> {
        let (session, started) = self.state.write().take()?;
        log::info!(
            "drag session {} ended after {:?}: {result:?}",
            session.id,
            started.elapsed()
        );
        Some(DragEndEvent {
            session_id: session.id,
            result,
        })
    }

    #[must_use]
    pub fn current_session(&self) -> Option<DragSession> {
        self.state
            .read()
            .as_ref()
            .map(|(session, _)| session.clone())
    }

    fn current_id(&self) -> Option<String> {
        self.state
            .read()
            .as_ref()
            .map(|(session, _)| session.id.clone())
    }

    /// Begin a session and announce it.
    ///
    /// # Errors
    /// When a live session is in progress.
    pub fn begin_drag(
        &self,
        app: &AppHandle<tauri::DynRuntime>,
        session_id: String,
        config: DragConfig,
        source_window: String,
    ) -> Result<(), String> {
        let event = self.open(session_id, config, source_window)?;
        let _ = app.emit("drag:began", event);
        Ok(())
    }

    /// Announce the cursor position of the active session.
    pub fn update_position(&self, app: &AppHandle<tauri::DynRuntime>, x: f64, y: f64) {
        if let Some(session_id) = self.current_id() {
            let _ = app.emit("drag:moved", DragMoveEvent { session_id, x, y });
        }
    }

    /// Announce that the drag entered a window.
    pub fn enter_window(&self, app: &AppHandle<tauri::DynRuntime>, window_label: String) {
        if let Some(session_id) = self.current_id() {
            let _ = app.emit(
                "drag:entered",
                DragWindowEvent {
                    session_id,
                    window_label,
                },
            );
        }
    }

    /// Announce that the drag left a window.
    pub fn leave_window(&self, app: &AppHandle<tauri::DynRuntime>, window_label: String) {
        if let Some(session_id) = self.current_id() {
            let _ = app.emit(
                "drag:left",
                DragWindowEvent {
                    session_id,
                    window_label,
                },
            );
        }
    }

    /// End the active session and announce it.
    pub fn end_drag(&self, app: &AppHandle<tauri::DynRuntime>, result: DragResult) {
        match self.close(result) {
            Some(event) => {
                let _ = app.emit("drag:ended", event);
            }
            None => log::warn!("end_drag without an active session"),
        }
    }

    /// Cancel whatever session is active (debugging and failure cleanup).
    pub fn force_clear_state(&self, app: &AppHandle<tauri::DynRuntime>) {
        if let Some(event) = self.close(DragResult::Cancelled) {
            log::warn!("force-cleared drag session {}", event.session_id);
            let _ = app.emit("drag:ended", event);
        }
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    fn config() -> DragConfig {
        DragConfig {
            items: vec![DragItem {
                kind: DragItemKind::File { path: "/a".into() },
                id: "1".into(),
            }],
            overlay_url: "/drag-overlay".into(),
            overlay_size: (200.0, 150.0),
            allowed_operations: vec![DragOperation::Copy, DragOperation::Move],
        }
    }

    #[test]
    fn config_matches_the_webview_shape() {
        let value = json!({
            "items": [{"kind": {"type": "file", "path": "/a"}, "id": "1"}],
            "overlayUrl": "/drag-overlay",
            "overlaySize": [200.0, 150.0],
            "allowedOperations": ["copy", "move"]
        });
        assert_eq!(
            serde_json::from_value::<DragConfig>(value.clone()).unwrap(),
            config()
        );
        assert_eq!(serde_json::to_value(config()).unwrap(), value);
        let promise = json!({"type": "filePromise", "name": "n", "mimeType": "text/plain"});
        assert!(matches!(
            serde_json::from_value(promise).unwrap(),
            DragItemKind::FilePromise { .. }
        ));
        let dropped = DragResult::Dropped {
            operation: DragOperation::Link,
            target: None,
        };
        assert_eq!(
            serde_json::to_value(dropped).unwrap(),
            json!({"type": "dropped", "operation": "link", "target": null})
        );
    }

    #[test]
    fn one_live_session_at_a_time() {
        let coordinator = DragCoordinator::new();
        let began = coordinator
            .open("s1".into(), config(), "drive".into())
            .unwrap();
        assert_eq!(began.session_id, "s1");
        assert_eq!(began.source_window, "drive");
        assert!(
            coordinator
                .open("s2".into(), config(), "drive".into())
                .is_err()
        );
        assert_eq!(coordinator.current_session().unwrap().id, "s1");
        let ended = coordinator.close(DragResult::Cancelled).unwrap();
        assert_eq!(ended.session_id, "s1");
        assert!(coordinator.close(DragResult::Cancelled).is_none());
        assert!(coordinator.current_session().is_none());
    }

    #[test]
    fn stale_sessions_are_replaced() {
        let coordinator = DragCoordinator::with_stale_after(Duration::ZERO);
        coordinator
            .open("old".into(), config(), "drive".into())
            .unwrap();
        coordinator
            .open("new".into(), config(), "drive".into())
            .unwrap();
        assert_eq!(coordinator.current_session().unwrap().id, "new");
    }
}
