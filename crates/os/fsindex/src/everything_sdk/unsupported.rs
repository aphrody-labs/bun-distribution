// SPDX-License-Identifier: Apache-2.0
//! Non-Windows stub: the same surface as the Windows binding, always unusable.

use std::path::Path;

use crate::everything_sdk::{Entry, EverythingError, Query};

/// Placeholder for the loaded SDK; cannot be constructed on this host.
#[derive(Debug)]
pub struct Library {
    _private: (),
}

impl Library {
    /// Always [`EverythingError::Unsupported`] on non-Windows hosts.
    ///
    /// # Errors
    ///
    /// Always.
    pub fn load() -> Result<Self, EverythingError> {
        Err(EverythingError::Unsupported)
    }

    /// Always [`EverythingError::Unsupported`] on non-Windows hosts.
    ///
    /// # Errors
    ///
    /// Always.
    pub fn load_from(_path: &Path) -> Result<Self, EverythingError> {
        Err(EverythingError::Unsupported)
    }

    /// Always [`EverythingError::Unsupported`] on non-Windows hosts.
    ///
    /// # Errors
    ///
    /// Always.
    pub fn version(&self) -> Result<(u32, u32, u32), EverythingError> {
        Err(EverythingError::Unsupported)
    }

    /// Always [`EverythingError::Unsupported`] on non-Windows hosts.
    ///
    /// # Errors
    ///
    /// Always.
    pub fn search(&self, _query: &Query<'_>) -> Result<Vec<Entry>, EverythingError> {
        Err(EverythingError::Unsupported)
    }

    /// Always [`EverythingError::Unsupported`] on non-Windows hosts.
    ///
    /// # Errors
    ///
    /// Always.
    pub fn count(&self, _query: &Query<'_>) -> Result<u32, EverythingError> {
        Err(EverythingError::Unsupported)
    }
}
