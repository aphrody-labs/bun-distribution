// SPDX-License-Identifier: Apache-2.0
//! Low-level binding to the voidtools **Everything** SDK (`Everything64.dll`).
//!
//! This module only owns the FFI plumbing used by `aphrody-fsindex` (the single Everything
//! search owner): dynamic DLL loading, the raw SDK symbols, a process-wide
//! lock (the SDK keeps global query state) and a typed [`Query`] / [`Entry`]
//! pair. Result shaping and domain helpers live in the callers.
//!
//! The DLL is loaded at runtime, so a missing DLL, a stopped Everything service
//! or a non-Windows host is a typed [`EverythingError`], never a link failure.
//!
//! DLL resolution order ([`dll_candidates`]): `APHRODY_EVERYTHING_DLL`,
//! `EVERYTHING_DLL`, the standard DLL search path, then the
//! `%ProgramFiles%` / `%ProgramFiles(x86)%` `Everything` folders.

// Keep the complete private SDK binding even when the caller uses only a subset.
#![cfg_attr(
    windows,
    expect(
        dead_code,
        reason = "The private SDK binding retains supported request, sort and count declarations"
    )
)]
#![cfg_attr(not(windows), allow(dead_code))]

use std::{path::PathBuf, sync::OnceLock};

use thiserror::Error;

#[cfg(windows)]
mod win;
#[cfg(windows)]
pub use win::Library;

#[cfg(not(windows))]
mod unsupported;
#[cfg(not(windows))]
pub use unsupported::Library;

/// Environment variable overriding the SDK DLL location.
pub const DLL_ENV: &str = "APHRODY_EVERYTHING_DLL";
/// Legacy environment variable overriding the SDK DLL location.
pub const DLL_ENV_LEGACY: &str = "EVERYTHING_DLL";

/// Seconds between the Windows FILETIME epoch (1601) and the Unix epoch.
const FILETIME_UNIX_OFFSET_SECS: i64 = 11_644_473_600;

// Request flags (`EVERYTHING_REQUEST_*`).
pub const EVERYTHING_REQUEST_FILE_NAME: u32 = 0x0000_0001;
pub const EVERYTHING_REQUEST_PATH: u32 = 0x0000_0002;
pub const EVERYTHING_REQUEST_FULL_PATH_AND_FILE_NAME: u32 = 0x0000_0004;
pub const EVERYTHING_REQUEST_EXTENSION: u32 = 0x0000_0008;
pub const EVERYTHING_REQUEST_SIZE: u32 = 0x0000_0010;
pub const EVERYTHING_REQUEST_DATE_CREATED: u32 = 0x0000_0020;
pub const EVERYTHING_REQUEST_DATE_MODIFIED: u32 = 0x0000_0040;
pub const EVERYTHING_REQUEST_DATE_ACCESSED: u32 = 0x0000_0080;
pub const EVERYTHING_REQUEST_ATTRIBUTES: u32 = 0x0000_0100;

// Sort orders (`EVERYTHING_SORT_*`).
pub const EVERYTHING_SORT_NAME_ASCENDING: u32 = 1;
pub const EVERYTHING_SORT_NAME_DESCENDING: u32 = 2;
pub const EVERYTHING_SORT_PATH_ASCENDING: u32 = 3;
pub const EVERYTHING_SORT_PATH_DESCENDING: u32 = 4;
pub const EVERYTHING_SORT_SIZE_ASCENDING: u32 = 5;
pub const EVERYTHING_SORT_SIZE_DESCENDING: u32 = 6;
pub const EVERYTHING_SORT_EXTENSION_ASCENDING: u32 = 7;
pub const EVERYTHING_SORT_EXTENSION_DESCENDING: u32 = 8;
pub const EVERYTHING_SORT_DATE_MODIFIED_ASCENDING: u32 = 13;
pub const EVERYTHING_SORT_DATE_MODIFIED_DESCENDING: u32 = 14;

// Error codes (`EVERYTHING_ERROR_*`).
pub const EVERYTHING_OK: u32 = 0;
pub const EVERYTHING_ERROR_MEMORY: u32 = 1;
pub const EVERYTHING_ERROR_IPC: u32 = 2;
pub const EVERYTHING_ERROR_REGISTERCLASSEX: u32 = 3;
pub const EVERYTHING_ERROR_CREATEWINDOW: u32 = 4;
pub const EVERYTHING_ERROR_CREATETHREAD: u32 = 5;
pub const EVERYTHING_ERROR_INVALIDINDEX: u32 = 6;
pub const EVERYTHING_ERROR_INVALIDCALL: u32 = 7;

/// Errors from the Everything binding. All of them mean "Everything is not
/// usable right now".
#[derive(Debug, Error, Clone, PartialEq, Eq)]
pub enum EverythingError {
    /// Not a Windows host.
    #[error("Everything search is only available on Windows")]
    Unsupported,
    /// No candidate DLL could be loaded (comma-separated list of the paths tried).
    #[error("Everything SDK DLL not found: {0}")]
    LibraryNotFound(String),
    /// The DLL at `path` failed to load.
    #[error("Failed to load Everything DLL at {path}: {reason}")]
    DllLoad {
        /// Path handed to the loader.
        path: String,
        /// Loader error text.
        reason: String,
    },
    /// The DLL lacks an expected export.
    #[error("Everything SDK export missing: {0}")]
    MissingSymbol(&'static str),
    /// An SDK error code (`Everything_GetLastError`).
    #[error("Everything SDK error {code}: {}", describe_error(*code))]
    Sdk {
        /// Raw `EVERYTHING_ERROR_*` value.
        code: u32,
    },
}

/// Human-readable meaning of an `EVERYTHING_ERROR_*` code.
#[must_use]
pub fn describe_error(code: u32) -> &'static str {
    match code {
        EVERYTHING_OK => "ok",
        EVERYTHING_ERROR_MEMORY => "out of memory",
        EVERYTHING_ERROR_IPC => "IPC unavailable (is the Everything service running?)",
        EVERYTHING_ERROR_REGISTERCLASSEX => "RegisterClassEx failed",
        EVERYTHING_ERROR_CREATEWINDOW => "CreateWindow failed",
        EVERYTHING_ERROR_CREATETHREAD => "CreateThread failed",
        EVERYTHING_ERROR_INVALIDINDEX => "invalid result index",
        EVERYTHING_ERROR_INVALIDCALL => "invalid call",
        _ => "unknown error",
    }
}

/// Convert a Windows FILETIME (100 ns ticks since 1601) to Unix seconds.
#[must_use]
pub fn filetime_to_unix(filetime: i64) -> i64 {
    filetime.div_euclid(10_000_000) - FILETIME_UNIX_OFFSET_SECS
}

/// One SDK query. Optional fields are left at the SDK default when `None`.
#[derive(Debug, Clone, Copy)]
pub struct Query<'a> {
    /// Everything search syntax (`*.cpk`, `ext:rs foo`, ...).
    pub text: &'a str,
    /// Match against the full path instead of the name only.
    pub match_path: bool,
    /// Case-sensitive matching.
    pub match_case: bool,
    /// Whole-word matching.
    pub match_whole_word: bool,
    /// Interpret `text` as a regular expression.
    pub regex: bool,
    /// Maximum number of results (`None`: SDK default, unlimited).
    pub max_results: Option<u32>,
    /// Number of leading results to skip (`None`: none).
    pub offset: Option<u32>,
    /// `EVERYTHING_SORT_*` value (`None`: SDK default).
    pub sort: Option<u32>,
    /// `EVERYTHING_REQUEST_*` flags OR-ed together.
    pub request_flags: u32,
}

impl<'a> Query<'a> {
    /// A plain name query with every option left at its SDK default.
    #[must_use]
    pub const fn new(text: &'a str) -> Self {
        Self {
            text,
            match_path: false,
            match_case: false,
            match_whole_word: false,
            regex: false,
            max_results: None,
            offset: None,
            sort: None,
            request_flags: EVERYTHING_REQUEST_FILE_NAME
                | EVERYTHING_REQUEST_FULL_PATH_AND_FILE_NAME
                | EVERYTHING_REQUEST_SIZE
                | EVERYTHING_REQUEST_DATE_MODIFIED,
        }
    }
}

/// One raw result row.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Entry {
    /// Full path and file name.
    pub path: String,
    /// Whether the entry is a folder.
    pub is_dir: bool,
    /// Size in bytes, when the SDK reported one.
    pub size: Option<i64>,
    /// Last-modified FILETIME, when the SDK reported one.
    pub filetime: Option<i64>,
}

/// Candidate DLL locations, in resolution order.
#[must_use]
pub fn dll_candidates() -> Vec<PathBuf> {
    let mut out = Vec::new();
    for var in [DLL_ENV, DLL_ENV_LEGACY] {
        if let Ok(p) = std::env::var(var)
            && !p.trim().is_empty()
        {
            out.push(PathBuf::from(p));
        }
    }
    out.push(PathBuf::from("Everything64.dll"));
    out.push(PathBuf::from("Everything.dll"));
    for var in ["ProgramFiles", "ProgramFiles(x86)"] {
        if let Ok(pf) = std::env::var(var) {
            let dir = PathBuf::from(pf).join("Everything");
            out.push(dir.join("Everything64.dll"));
            out.push(dir.join("Everything.dll"));
        }
    }
    out
}

static GLOBAL: OnceLock<Result<Library, EverythingError>> = OnceLock::new();

/// Process-wide shared binding, loaded on first use and kept for the process
/// lifetime. A load failure is cached.
///
/// # Errors
///
/// Any [`EverythingError`] when the backend is unusable.
pub fn global() -> Result<&'static Library, EverythingError> {
    GLOBAL.get_or_init(Library::load).as_ref().map_err(Clone::clone)
}

/// True when the SDK DLL loads and the Everything service answers IPC.
#[must_use]
pub fn is_available() -> bool {
    version().is_ok()
}

/// `(major, minor, revision)` of the running Everything service.
///
/// # Errors
///
/// Any [`EverythingError`] when the backend is unusable.
pub fn version() -> Result<(u32, u32, u32), EverythingError> {
    global()?.version()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn filetime_epoch_maps_to_unix_epoch() {
        assert_eq!(filetime_to_unix(116_444_736_000_000_000), 0);
        assert_eq!(filetime_to_unix(116_444_736_000_000_000 + 10_000_000), 1);
    }

    #[test]
    fn error_codes_are_described() {
        assert!(describe_error(EVERYTHING_ERROR_IPC).contains("IPC"));
        assert!(EverythingError::Sdk { code: 2 }.to_string().contains("IPC"));
    }

    #[test]
    fn default_request_flags_match_sdk_values() {
        assert_eq!(Query::new("x").request_flags, 0x55);
    }

    #[test]
    fn candidates_end_with_standard_dll_names() {
        let c = dll_candidates();
        assert!(c.iter().any(|p| p.as_os_str() == "Everything64.dll"));
    }

    #[test]
    fn unusable_backend_is_a_typed_error() {
        match global() {
            Ok(lib) => assert!(lib.version().is_ok() || lib.version().is_err()),
            Err(e) => assert!(!e.to_string().is_empty()),
        }
        assert_eq!(is_available(), version().is_ok());
    }
}
