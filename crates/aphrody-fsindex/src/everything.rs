// SPDX-License-Identifier: Apache-2.0
//! Instant whole-disk search through the voidtools **Everything** SDK
//! (`Everything64.dll`), ported from iecode's `EverythingSearchProvider.cs`.
//!
//! The SDK talks over IPC to a running Everything service, which keeps an
//! NTFS-journal index of every volume (~50 ms queries over millions of paths).
//! The DLL is loaded dynamically at first use, so a missing DLL, a stopped
//! Everything service or a non-Windows host is a graceful
//! [`EverythingError`], never a link or load failure. [`search_with_fallback`]
//! turns that into a transparent fallback onto the SQLite [`FsIndex`].
//!
//! DLL resolution order: `APHRODY_EVERYTHING_DLL` (explicit path), the
//! standard DLL search path (`Everything64.dll`), then
//! `%ProgramFiles%\Everything\Everything64.dll`.

use crate::everything_sdk::{
    self as sdk, EVERYTHING_REQUEST_DATE_MODIFIED, EVERYTHING_REQUEST_FILE_NAME,
    EVERYTHING_REQUEST_FULL_PATH_AND_FILE_NAME, EVERYTHING_REQUEST_SIZE, Query,
};
use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::{FileHit, FsIndex, FsIndexError};

pub use crate::everything_sdk::{DLL_ENV, describe_error, filetime_to_unix};

/// Result ordering, with the SDK's `EVERYTHING_SORT_*` values.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
pub enum Sort {
    /// File name, A to Z.
    #[default]
    NameAscending = 1,
    /// File name, Z to A.
    NameDescending = 2,
    /// Full path, A to Z.
    PathAscending = 3,
    /// Full path, Z to A.
    PathDescending = 4,
    /// Smallest first.
    SizeAscending = 5,
    /// Largest first.
    SizeDescending = 6,
    /// Oldest first.
    DateModifiedAscending = 13,
    /// Newest first.
    DateModifiedDescending = 14,
}

/// One Everything query.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct EverythingQuery {
    /// Everything search syntax (`*.cpk`, `ext:rs foo`, ...).
    pub query: String,
    /// Maximum number of results.
    pub max_results: u32,
    /// Number of leading results to skip.
    pub offset: u32,
    /// Match against the full path instead of the name only.
    pub match_path: bool,
    /// Case-sensitive matching.
    pub match_case: bool,
    /// Whole-word matching.
    pub match_whole_word: bool,
    /// Interpret `query` as a regular expression.
    pub regex: bool,
    /// Result ordering.
    pub sort: Sort,
}

impl EverythingQuery {
    /// A plain name query returning at most `max_results` hits.
    #[must_use]
    pub fn new(query: impl Into<String>, max_results: u32) -> Self {
        Self {
            query: query.into(),
            max_results,
            offset: 0,
            match_path: false,
            match_case: false,
            match_whole_word: false,
            regex: false,
            sort: Sort::default(),
        }
    }
}

/// Errors from the Everything backend. All of them mean "Everything is not
/// usable right now"; callers are expected to fall back.
#[derive(Debug, Error, Clone, PartialEq, Eq)]
pub enum EverythingError {
    /// Not a Windows host.
    #[error("Everything search is only available on Windows")]
    Unsupported,
    /// The query is empty after trimming.
    #[error("empty query")]
    EmptyQuery,
    /// `Everything64.dll` could not be loaded.
    #[error("Everything SDK DLL not found: {0}")]
    LibraryNotFound(String),
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
/// Request flags sent with every query: name, full path, size and mtime.
#[must_use]
pub const fn request_flags() -> u32 {
    EVERYTHING_REQUEST_FILE_NAME
        | EVERYTHING_REQUEST_FULL_PATH_AND_FILE_NAME
        | EVERYTHING_REQUEST_SIZE
        | EVERYTHING_REQUEST_DATE_MODIFIED
}
/// Build a [`FileHit`] from raw SDK fields.
#[must_use]
pub fn hit_from_parts(
    path: String,
    is_dir: bool,
    size: Option<i64>,
    filetime: Option<i64>,
) -> FileHit {
    // Everything returns Windows paths; split on both separators so the
    // helper behaves identically on every host.
    let name = path.rsplit(['\\', '/']).find(|s| !s.is_empty()).unwrap_or(&path).to_owned();
    let extension = if is_dir {
        String::new()
    } else {
        name.rsplit_once('.')
            .filter(|(stem, _)| !stem.is_empty())
            .map(|(_, ext)| ext.to_lowercase())
            .unwrap_or_default()
    };
    FileHit {
        path,
        name,
        extension,
        size: if is_dir { 0 } else { size.map_or(0, |s| u64::try_from(s).unwrap_or(0)) },
        mtime_unix: filetime.map_or(0, filetime_to_unix),
        is_dir,
    }
}
impl From<sdk::EverythingError> for EverythingError {
    fn from(e: sdk::EverythingError) -> Self {
        match e {
            sdk::EverythingError::Unsupported => Self::Unsupported,
            sdk::EverythingError::LibraryNotFound(tried) => Self::LibraryNotFound(tried),
            sdk::EverythingError::DllLoad { path, reason } => {
                Self::LibraryNotFound(format!("{path} ({reason})"))
            },
            sdk::EverythingError::MissingSymbol(name) => Self::MissingSymbol(name),
            sdk::EverythingError::Sdk { code } => Self::Sdk { code },
        }
    }
}

/// True when the SDK DLL loads and the Everything service answers IPC.
#[must_use]
pub fn is_available() -> bool {
    sdk::is_available()
}

/// `(major, minor, revision)` of the running Everything service.
///
/// # Errors
///
/// Any [`EverythingError`] when the backend is unusable.
pub fn version() -> Result<(u32, u32, u32), EverythingError> {
    sdk::version().map_err(EverythingError::from)
}

/// Run `query` against the running Everything service.
///
/// # Errors
///
/// [`EverythingError`] when the query is empty or the backend is unusable.
pub fn search(query: &EverythingQuery) -> Result<Vec<FileHit>, EverythingError> {
    if query.query.trim().is_empty() {
        return Err(EverythingError::EmptyQuery);
    }
    let lib = sdk::global()?;
    let raw = Query {
        match_path: query.match_path,
        match_case: query.match_case,
        match_whole_word: query.match_whole_word,
        regex: query.regex,
        max_results: Some(query.max_results),
        offset: Some(query.offset),
        sort: Some(query.sort as u32),
        request_flags: request_flags(),
        ..Query::new(&query.query)
    };
    Ok(lib
        .search(&raw)?
        .into_iter()
        .map(|e| hit_from_parts(e.path, e.is_dir, e.size, e.filetime))
        .collect())
}

/// Which backend answered a [`search_with_fallback`] call.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Backend {
    /// The voidtools Everything service.
    Everything,
    /// The local SQLite FTS5 index.
    FsIndex,
}

/// Search with Everything first, falling back to `index` when Everything is
/// unavailable (non-Windows, DLL missing, service stopped).
///
/// # Errors
///
/// Only errors from the fallback index propagate.
pub fn search_with_fallback(
    index: &FsIndex,
    query: &str,
    limit: usize,
) -> Result<(Backend, Vec<FileHit>), FsIndexError> {
    let max = u32::try_from(limit).unwrap_or(u32::MAX);
    match search(&EverythingQuery::new(query, max)) {
        Ok(hits) => Ok((Backend::Everything, hits)),
        Err(_) => index.search(query, limit).map(|hits| (Backend::FsIndex, hits)),
    }
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
    fn request_flags_match_sdk_values() {
        assert_eq!(request_flags(), 0x55);
        assert_eq!(Sort::DateModifiedDescending as u32, 14);
    }

    #[test]
    fn hit_from_parts_derives_name_and_extension() {
        let hit = hit_from_parts(r"C:\data\Model.GLB".into(), false, Some(42), None);
        assert_eq!(hit.name, "Model.GLB");
        assert_eq!(hit.extension, "glb");
        assert_eq!(hit.size, 42);
        assert_eq!(hit.mtime_unix, 0);
        let dir = hit_from_parts("/tmp/dir.d".into(), true, Some(4096), None);
        assert_eq!(dir.name, "dir.d");
        assert!(dir.extension.is_empty());
        assert_eq!(dir.size, 0);
        let dotfile = hit_from_parts(r"C:\u\.gitconfig".into(), false, None, None);
        assert!(dotfile.extension.is_empty());
    }

    #[test]
    fn empty_query_is_rejected_before_ffi() {
        assert_eq!(search(&EverythingQuery::new("  ", 5)), Err(EverythingError::EmptyQuery));
    }

    #[test]
    fn error_codes_are_described() {
        assert!(describe_error(2).contains("IPC"));
        assert!(EverythingError::Sdk { code: 2 }.to_string().contains("IPC"));
    }

    #[test]
    fn live_search_is_ok_or_graceful() {
        // Passes on every host: real hits when Everything runs, a typed error otherwise.
        match search(&EverythingQuery::new("Cargo.toml", 3)) {
            Ok(hits) => assert!(hits.len() <= 3),
            Err(e) => assert!(!e.to_string().is_empty()),
        }
        assert_eq!(is_available(), version().is_ok());
    }

    #[test]
    fn fallback_uses_fsindex_when_everything_is_unusable() {
        let dir = tempfile::tempdir().expect("tempdir");
        std::fs::write(dir.path().join("zqxfallbackprobe.txt"), b"x").expect("write");
        let mut idx = FsIndex::open_in_memory().expect("index");
        idx.build(dir.path()).expect("build");
        let (backend, hits) = search_with_fallback(&idx, "zqxfallbackprobe", 10).expect("search");
        if is_available() {
            assert_eq!(backend, Backend::Everything);
        } else {
            assert_eq!(backend, Backend::FsIndex);
            assert!(hits.iter().any(|h| h.name == "zqxfallbackprobe.txt"));
        }
    }
}
