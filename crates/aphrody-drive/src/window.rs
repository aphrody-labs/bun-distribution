// SPDX-License-Identifier: FSL-1.1-ALv2
//! Auxiliary windows owned by the Drive plugin.

use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

/// The temporary overlay displayed while a native macOS file drag is active.
pub enum DriveWindow {
    DragOverlay { session_id: String },
}

impl DriveWindow {
    #[must_use]
    pub fn label(&self) -> String {
        match self {
            Self::DragOverlay { session_id } => format!("drive-drag-overlay-{session_id}"),
        }
    }

    /// Focus an existing overlay or create a transparent, initially hidden one.
    pub async fn show(
        &self,
        app: &AppHandle<tauri::DynRuntime>,
    ) -> Result<WebviewWindow<tauri::DynRuntime>, String> {
        let label = self.label();
        if let Some(window) = app.get_webview_window(&label) {
            window.set_focus().map_err(|error| error.to_string())?;
            return Ok(window);
        }
        let route = match self {
            Self::DragOverlay { session_id } => format!("/drive/drag-overlay?session={session_id}"),
        };
        WebviewWindowBuilder::new(app, label, WebviewUrl::App(route.into()))
            .title("")
            .inner_size(200.0, 150.0)
            .resizable(false)
            .decorations(false)
            .transparent(true)
            .always_on_top(true)
            .skip_taskbar(true)
            .visible(false)
            .build()
            .map_err(|error| error.to_string())
    }
}
