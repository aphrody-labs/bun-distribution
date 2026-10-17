// SPDX-License-Identifier: FSL-1.1-ALv2
// Derived from Spacedrive (drive/apps/tauri/src-tauri/src/drag/events.rs), adopted as the Aphrody
// Drive file explorer.
//! Payloads of the `drag:*` events.

use serde::{Deserialize, Serialize};

use super::{DragItem, DragOperation};

/// `drag:began`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DragBeganEvent {
    pub session_id: String,
    pub source_window: String,
    pub items: Vec<DragItem>,
}

/// `drag:moved`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DragMoveEvent {
    pub session_id: String,
    pub x: f64,
    pub y: f64,
}

/// `drag:entered` / `drag:left`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DragWindowEvent {
    pub session_id: String,
    pub window_label: String,
}

/// `drag:ended`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DragEndEvent {
    pub session_id: String,
    pub result: DragResult,
}

/// How a drag session ended.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum DragResult {
    Dropped {
        operation: DragOperation,
        target: Option<String>,
    },
    Cancelled,
    Failed {
        error: String,
    },
}

/// A drop onto a window.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DropEvent {
    pub window_label: String,
    pub items: Vec<DragItem>,
    pub position: (f64, f64),
}
