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

use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::{FileHit, FsIndex, FsIndexError};

/// Environment variable overriding the SDK DLL location.
pub const DLL_ENV: &str = "APHRODY_EVERYTHING_DLL";

/// Seconds between the Windows FILETIME epoch (1601) and the Unix epoch.
const FILETIME_UNIX_OFFSET_SECS: i64 = 11_644_473_600;

// Request flags (Everything SDK).
const REQUEST_FILE_NAME: u32 = 0x0000_0001;
const REQUEST_FULL_PATH_AND_FILE_NAME: u32 = 0x0000_0004;
const REQUEST_SIZE: u32 = 0x0000_0010;
const REQUEST_DATE_MODIFIED: u32 = 0x0000_0040;

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

/// Human-readable meaning of an `EVERYTHING_ERROR_*` code.
#[must_use]
pub fn describe_error(code: u32) -> &'static str {
    match code {
        0 => "ok",
        1 => "out of memory",
        2 => "IPC unavailable (is the Everything service running?)",
        3 => "RegisterClassEx failed",
        4 => "CreateWindow failed",
        5 => "CreateThread failed",
        6 => "invalid result index",
        7 => "invalid call",
        _ => "unknown error",
    }
}

/// Convert a Windows FILETIME (100 ns ticks since 1601) to Unix seconds.
#[must_use]
pub fn filetime_to_unix(filetime: i64) -> i64 {
    filetime.div_euclid(10_000_000) - FILETIME_UNIX_OFFSET_SECS
}

/// Request flags sent with every query: name, full path, size and mtime.
#[must_use]
pub const fn request_flags() -> u32 {
    REQUEST_FILE_NAME | REQUEST_FULL_PATH_AND_FILE_NAME | REQUEST_SIZE | REQUEST_DATE_MODIFIED
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
    imp::version()
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
    imp::search(query)
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

#[cfg(not(windows))]
mod imp {
    use super::{EverythingError, EverythingQuery, FileHit};

    pub(super) fn version() -> Result<(u32, u32, u32), EverythingError> {
        Err(EverythingError::Unsupported)
    }

    pub(super) fn search(_query: &EverythingQuery) -> Result<Vec<FileHit>, EverythingError> {
        Err(EverythingError::Unsupported)
    }
}

#[cfg(windows)]
#[allow(unsafe_code)]
mod imp {
    use std::{
        ffi::CString,
        sync::{Mutex, OnceLock, PoisonError},
    };

    use windows::{
        Win32::{
            Foundation::HMODULE,
            System::LibraryLoader::{GetProcAddress, LoadLibraryW},
        },
        core::{PCSTR, PCWSTR},
    };

    use super::{
        DLL_ENV, EverythingError, EverythingQuery, FileHit, hit_from_parts, request_flags,
    };

    type Bool = i32;

    struct Api {
        set_search_w: unsafe extern "system" fn(*const u16),
        set_match_path: unsafe extern "system" fn(Bool),
        set_match_case: unsafe extern "system" fn(Bool),
        set_match_whole_word: unsafe extern "system" fn(Bool),
        set_regex: unsafe extern "system" fn(Bool),
        set_max: unsafe extern "system" fn(u32),
        set_offset: unsafe extern "system" fn(u32),
        set_sort: unsafe extern "system" fn(u32),
        set_request_flags: unsafe extern "system" fn(u32),
        query_w: unsafe extern "system" fn(Bool) -> Bool,
        get_num_results: unsafe extern "system" fn() -> u32,
        get_result_full_path_name_w: unsafe extern "system" fn(u32, *mut u16, u32) -> u32,
        get_result_size: unsafe extern "system" fn(u32, *mut i64) -> Bool,
        get_result_date_modified: unsafe extern "system" fn(u32, *mut i64) -> Bool,
        is_folder_result: unsafe extern "system" fn(u32) -> Bool,
        get_last_error: unsafe extern "system" fn() -> u32,
        reset: unsafe extern "system" fn(),
        get_major_version: unsafe extern "system" fn() -> u32,
        get_minor_version: unsafe extern "system" fn() -> u32,
        get_revision: unsafe extern "system" fn() -> u32,
    }

    /// The SDK keeps global query state, so every call is serialised.
    static LOCK: Mutex<()> = Mutex::new(());
    static API: OnceLock<Result<Api, EverythingError>> = OnceLock::new();

    fn wide(s: &str) -> Vec<u16> {
        s.encode_utf16().chain(std::iter::once(0)).collect()
    }

    fn candidates() -> Vec<String> {
        let mut out = Vec::new();
        if let Ok(p) = std::env::var(DLL_ENV)
            && !p.trim().is_empty()
        {
            out.push(p);
        }
        out.push("Everything64.dll".to_owned());
        if let Ok(pf) = std::env::var("ProgramFiles") {
            out.push(format!("{pf}\\Everything\\Everything64.dll"));
        }
        out
    }

    fn load_library() -> Result<HMODULE, EverythingError> {
        let mut tried = Vec::new();
        for candidate in candidates() {
            let name = wide(&candidate);
            // SAFETY: `name` is a NUL-terminated UTF-16 string alive for the call.
            if let Ok(module) = unsafe { LoadLibraryW(PCWSTR(name.as_ptr())) } {
                return Ok(module);
            }
            tried.push(candidate);
        }
        Err(EverythingError::LibraryNotFound(tried.join(", ")))
    }

    macro_rules! sym {
        ($module:expr, $name:literal) => {{
            let symbol = CString::new($name).expect("static symbol");
            // SAFETY: `symbol` is NUL-terminated; `$module` is a loaded module that
            // is never freed (the SDK stays mapped for the process lifetime).
            let f = unsafe { GetProcAddress($module, PCSTR(symbol.as_ptr().cast())) }
                .ok_or(EverythingError::MissingSymbol($name))?;
            // SAFETY: the export has the documented Everything SDK signature of the
            // destination field; `transmute` only changes the fn-pointer type.
            // The destination is the field type, which the macro cannot name.
            #[allow(clippy::missing_transmute_annotations)]
            let f = unsafe { std::mem::transmute::<unsafe extern "system" fn() -> isize, _>(f) };
            f
        }};
    }

    fn load() -> Result<Api, EverythingError> {
        let m = load_library()?;
        Ok(Api {
            set_search_w: sym!(m, "Everything_SetSearchW"),
            set_match_path: sym!(m, "Everything_SetMatchPath"),
            set_match_case: sym!(m, "Everything_SetMatchCase"),
            set_match_whole_word: sym!(m, "Everything_SetMatchWholeWord"),
            set_regex: sym!(m, "Everything_SetRegex"),
            set_max: sym!(m, "Everything_SetMax"),
            set_offset: sym!(m, "Everything_SetOffset"),
            set_sort: sym!(m, "Everything_SetSort"),
            set_request_flags: sym!(m, "Everything_SetRequestFlags"),
            query_w: sym!(m, "Everything_QueryW"),
            get_num_results: sym!(m, "Everything_GetNumResults"),
            get_result_full_path_name_w: sym!(m, "Everything_GetResultFullPathNameW"),
            get_result_size: sym!(m, "Everything_GetResultSize"),
            get_result_date_modified: sym!(m, "Everything_GetResultDateModified"),
            is_folder_result: sym!(m, "Everything_IsFolderResult"),
            get_last_error: sym!(m, "Everything_GetLastError"),
            reset: sym!(m, "Everything_Reset"),
            get_major_version: sym!(m, "Everything_GetMajorVersion"),
            get_minor_version: sym!(m, "Everything_GetMinorVersion"),
            get_revision: sym!(m, "Everything_GetRevision"),
        })
    }

    fn api() -> Result<&'static Api, EverythingError> {
        API.get_or_init(load).as_ref().map_err(Clone::clone)
    }

    fn last_error(api: &Api) -> EverythingError {
        // SAFETY: no-argument SDK getter.
        let code = unsafe { (api.get_last_error)() };
        // A failed call with no recorded error is reported as "invalid call".
        EverythingError::Sdk { code: if code == 0 { 7 } else { code } }
    }

    pub(super) fn version() -> Result<(u32, u32, u32), EverythingError> {
        let api = api()?;
        let _guard = LOCK.lock().unwrap_or_else(PoisonError::into_inner);
        // SAFETY: no-argument SDK getters; the version call performs the IPC probe
        // and returns 0 when the service does not answer.
        let major = unsafe { (api.get_major_version)() };
        if major == 0 {
            return Err(last_error(api));
        }
        // SAFETY: as above.
        let (minor, rev) = unsafe { ((api.get_minor_version)(), (api.get_revision)()) };
        Ok((major, minor, rev))
    }

    pub(super) fn search(q: &EverythingQuery) -> Result<Vec<FileHit>, EverythingError> {
        let api = api()?;
        let _guard = LOCK.lock().unwrap_or_else(PoisonError::into_inner);
        let text = wide(&q.query);
        // SAFETY: SDK setters take plain values; `text` outlives `Everything_QueryW`,
        // which copies the search string.
        let ok = unsafe {
            (api.reset)();
            (api.set_search_w)(text.as_ptr());
            (api.set_match_path)(Bool::from(q.match_path));
            (api.set_match_case)(Bool::from(q.match_case));
            (api.set_match_whole_word)(Bool::from(q.match_whole_word));
            (api.set_regex)(Bool::from(q.regex));
            (api.set_max)(q.max_results);
            (api.set_offset)(q.offset);
            (api.set_sort)(q.sort as u32);
            (api.set_request_flags)(request_flags());
            (api.query_w)(1)
        };
        if ok == 0 {
            return Err(last_error(api));
        }
        // SAFETY: no-argument getter after a successful query.
        let count = unsafe { (api.get_num_results)() };
        let mut hits = Vec::with_capacity(count as usize);
        let mut buf = vec![0u16; 1024];
        for i in 0..count {
            let path = loop {
                let cap = u32::try_from(buf.len()).unwrap_or(u32::MAX);
                // SAFETY: `buf` holds `cap` u16s; the SDK writes at most `cap` including
                // NUL and returns the number of characters copied (excluding NUL).
                let len = unsafe { (api.get_result_full_path_name_w)(i, buf.as_mut_ptr(), cap) };
                if (len as usize) + 1 < buf.len() || buf.len() >= 1 << 16 {
                    let end = (len as usize).min(buf.len());
                    break String::from_utf16_lossy(&buf[..end]);
                }
                buf.resize(buf.len() * 2, 0);
            };
            let (mut size, mut mtime) = (0i64, 0i64);
            // SAFETY: valid index in `0..count`; out-pointers reference live locals.
            let (has_size, has_mtime, is_dir) = unsafe {
                (
                    (api.get_result_size)(i, &raw mut size) != 0,
                    (api.get_result_date_modified)(i, &raw mut mtime) != 0,
                    (api.is_folder_result)(i) != 0,
                )
            };
            hits.push(hit_from_parts(
                path,
                is_dir,
                has_size.then_some(size),
                has_mtime.then_some(mtime),
            ));
        }
        Ok(hits)
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
