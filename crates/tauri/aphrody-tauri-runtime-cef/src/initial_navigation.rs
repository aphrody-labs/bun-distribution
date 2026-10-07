// Copyright 2019-2024 Tauri Programme within The Commons Conservancy
// SPDX-License-Identifier: Apache-2.0
// SPDX-License-Identifier: MIT

use std::sync::Mutex;

/// Coalesces navigation until the document-start scripts are registered and the UI task runs.
pub(crate) struct InitialNavigation {
    pending_url: Mutex<Option<String>>,
}

impl InitialNavigation {
    pub(crate) fn new(url: String) -> Self {
        Self { pending_url: Mutex::new(Some(url)) }
    }

    /// Returns true while the pending initial load owns this navigation.
    pub(crate) fn defer(&self, url: &str) -> bool {
        let mut pending =
            self.pending_url.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
        if let Some(target) = pending.as_mut() {
            *target = url.to_owned();
            true
        } else {
            false
        }
    }

    /// Consumes the latest URL exactly once, releasing the lock before calling CEF.
    pub(crate) fn take_url(&self) -> Option<String> {
        self.pending_url.lock().unwrap_or_else(std::sync::PoisonError::into_inner).take()
    }
}

#[cfg(test)]
mod tests {
    use super::InitialNavigation;

    #[test]
    fn navigation_before_script_acknowledgment_replaces_the_splash() {
        let pending = InitialNavigation::new("app://localhost/index.html".into());
        assert!(pending.defer("http://127.0.0.1:43100/"));
        assert_eq!(pending.take_url().as_deref(), Some("http://127.0.0.1:43100/"));
    }

    #[test]
    fn navigation_after_acknowledgment_before_the_ui_task_keeps_the_latest_url() {
        let pending = InitialNavigation::new("app://localhost/index.html".into());
        assert!(pending.defer("http://127.0.0.1:43100/desktop"));
        assert!(pending.defer("http://127.0.0.1:43100/studio"));
        assert_eq!(pending.take_url().as_deref(), Some("http://127.0.0.1:43100/studio"));
        assert!(pending.take_url().is_none());
    }

    #[test]
    fn navigation_after_the_initial_load_is_not_deferred() {
        let pending = InitialNavigation::new("app://localhost/index.html".into());
        assert!(pending.take_url().is_some());
        assert!(!pending.defer("http://127.0.0.1:43100/"));
        assert!(pending.take_url().is_none());
    }
}
