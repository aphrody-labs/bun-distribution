// SPDX-License-Identifier: FSL-1.1-ALv2
// Derived from Spacedrive (drive/apps/tauri/src-tauri/src/drag/session.rs), adopted as the Aphrody
// Drive file explorer.
//! One drag session.

use serde::{Deserialize, Serialize};

use super::{DragBeganEvent, DragConfig};

/// An active drag session.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DragSession {
    pub id: String,
    pub config: DragConfig,
    pub source_window: String,
    /// Start time, milliseconds since the Unix epoch.
    pub started_at: u64,
}

impl DragSession {
    /// A new session with a random ID.
    #[must_use]
    pub fn new(config: DragConfig, source_window: String) -> Self {
        Self::with_id(uuid::Uuid::new_v4().to_string(), config, source_window)
    }

    /// A new session with a given ID (the ID the native drag and the overlay share).
    #[must_use]
    pub fn with_id(id: String, config: DragConfig, source_window: String) -> Self {
        let started_at = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_or(0, |elapsed| u64::try_from(elapsed.as_millis()).unwrap_or(u64::MAX));
        Self { id, config, source_window, started_at }
    }

    /// The `drag:began` payload.
    #[must_use]
    pub fn to_event(&self) -> DragBeganEvent {
        DragBeganEvent {
            session_id: self.id.clone(),
            source_window: self.source_window.clone(),
            items: self.config.items.clone(),
        }
    }
}
