// SPDX-License-Identifier: Apache-2.0
//! Everything (Voidtools) search provider interop.
//!
//! Provides dynamic loading and query execution for `Everything64.dll`,
//! matching the P/Invoke contract from `IECODE.Core.Search.EverythingSearchProvider`.
//! Allows sub-millisecond querying over millions of NTFS-indexed files on Windows.

use serde::{Deserialize, Serialize};
use thiserror::Error;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/// Request flags for Everything search results.
pub const EVERYTHING_REQUEST_FILE_NAME: u32 = 0x0000_0001;
pub const EVERYTHING_REQUEST_PATH: u32 = 0x0000_0002;
pub const EVERYTHING_REQUEST_FULL_PATH_AND_FILE_NAME: u32 = 0x0000_0004;
pub const EVERYTHING_REQUEST_EXTENSION: u32 = 0x0000_0008;
pub const EVERYTHING_REQUEST_SIZE: u32 = 0x0000_0010;
pub const EVERYTHING_REQUEST_DATE_CREATED: u32 = 0x0000_0020;
pub const EVERYTHING_REQUEST_DATE_MODIFIED: u32 = 0x0000_0040;
pub const EVERYTHING_REQUEST_DATE_ACCESSED: u32 = 0x0000_0080;
pub const EVERYTHING_REQUEST_ATTRIBUTES: u32 = 0x0000_0100;

/// Sort orders supported by Everything API.
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

/// Everything API error codes.
pub const EVERYTHING_OK: u32 = 0;
pub const EVERYTHING_ERROR_MEMORY: u32 = 1;
pub const EVERYTHING_ERROR_IPC: u32 = 2;
pub const EVERYTHING_ERROR_REGISTERCLASSEX: u32 = 3;
pub const EVERYTHING_ERROR_CREATEWINDOW: u32 = 4;
pub const EVERYTHING_ERROR_CREATETHREAD: u32 = 5;
pub const EVERYTHING_ERROR_INVALIDINDEX: u32 = 6;
pub const EVERYTHING_ERROR_INVALIDCALL: u32 = 7;

/// Convert an Everything error code to a human-readable description.
#[must_use]
pub fn error_code_to_str(code: u32) -> &'static str {
    match code {
        EVERYTHING_OK => "Operation successful",
        EVERYTHING_ERROR_MEMORY => "Memory allocation error",
        EVERYTHING_ERROR_IPC => "IPC communication error (Everything service or GUI not running)",
        EVERYTHING_ERROR_REGISTERCLASSEX => "RegisterClassEx failed",
        EVERYTHING_ERROR_CREATEWINDOW => "CreateWindow failed",
        EVERYTHING_ERROR_CREATETHREAD => "CreateThread failed",
        EVERYTHING_ERROR_INVALIDINDEX => "Invalid result index requested",
        EVERYTHING_ERROR_INVALIDCALL => "Invalid call",
        _ => "Unknown Everything error",
    }
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/// Errors encountered while initializing or interacting with Everything.
#[derive(Debug, Error)]
pub enum EverythingError {
    /// Everything64.dll was not found or is unavailable on this platform.
    #[error("Everything is unavailable: {0}")]
    Unavailable(String),
    /// Failed to load the DLL at the specified path.
    #[error("Failed to load Everything DLL at {0}: {1}")]
    DllLoad(String, String),
    /// A required export symbol was missing from the loaded DLL.
    #[error("Missing export symbol {0} in Everything DLL")]
    MissingSymbol(String),
    /// Everything API returned an error code.
    #[error("Everything query failed with error {0}: {1}")]
    QueryFailed(u32, &'static str),
    /// Mutex synchronization error.
    #[error("Internal synchronization lock poisoned")]
    LockPoisoned,
}

// ---------------------------------------------------------------------------
// Search Types & Options
// ---------------------------------------------------------------------------

/// Field to sort search results by.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
pub enum EverythingSort {
    #[default]
    Path,
    Name,
    Size,
    DateModified,
}

impl EverythingSort {
    /// Map sort criteria and direction to an Everything API sort type constant.
    #[must_use]
    pub fn to_api_sort(self, ascending: bool) -> u32 {
        match self {
            Self::Name => {
                if ascending {
                    EVERYTHING_SORT_NAME_ASCENDING
                } else {
                    EVERYTHING_SORT_NAME_DESCENDING
                }
            },
            Self::Path => {
                if ascending {
                    EVERYTHING_SORT_PATH_ASCENDING
                } else {
                    EVERYTHING_SORT_PATH_DESCENDING
                }
            },
            Self::Size => {
                if ascending {
                    EVERYTHING_SORT_SIZE_ASCENDING
                } else {
                    EVERYTHING_SORT_SIZE_DESCENDING
                }
            },
            Self::DateModified => {
                if ascending {
                    EVERYTHING_SORT_DATE_MODIFIED_ASCENDING
                } else {
                    EVERYTHING_SORT_DATE_MODIFIED_DESCENDING
                }
            },
        }
    }
}

/// Options configuring an Everything file search query.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EverythingSearchOptions {
    /// Base folder to scope the search (`path:"<base_path>"`).
    pub base_path: Option<String>,
    /// Extension filters (e.g. `["cpk", "bin"]` or `[".cfg.bin"]`).
    pub extensions: Vec<String>,
    /// Offset into the result set for pagination (default 0).
    pub offset: usize,
    /// Maximum number of results to return (0 = count only or unlimited if query requires).
    pub max_results: usize,
    /// Case-sensitive matching.
    pub match_case: bool,
    /// Full path matching.
    pub match_path: bool,
    /// Whole word matching.
    pub match_whole_word: bool,
    /// Enable regular expression search.
    pub regex: bool,
    /// Sort attribute.
    pub sort_by: EverythingSort,
    /// Ascending sort direction.
    pub ascending: bool,
    /// Include folders in results (defaults to false, files only).
    pub include_directories: bool,
}

impl Default for EverythingSearchOptions {
    fn default() -> Self {
        Self {
            base_path: None,
            extensions: Vec::new(),
            offset: 0,
            max_results: 100,
            match_case: false,
            match_path: false,
            match_whole_word: false,
            regex: false,
            sort_by: EverythingSort::Path,
            ascending: true,
            include_directories: false,
        }
    }
}

/// A single matched entry returned by Everything.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct EverythingHit {
    /// Full normalized absolute path.
    pub full_path: String,
    /// File or directory name.
    pub file_name: String,
    /// Size in bytes (0 for directories).
    pub size: u64,
    /// Last modified time in seconds since Unix epoch (0 if unavailable).
    pub date_modified_unix: i64,
    /// Whether this hit is a folder.
    pub is_dir: bool,
}

/// Build an Everything syntax query string combining base path, extensions and raw query text.
#[must_use]
pub fn build_query(query: &str, options: &EverythingSearchOptions) -> String {
    let mut parts = Vec::new();

    if let Some(base_path) = &options.base_path {
        let trimmed = base_path.trim();
        if !trimmed.is_empty() {
            parts.push(format!("path:\"{trimmed}\""));
        }
    }

    if !options.extensions.is_empty() {
        let ext_filters: Vec<String> = options
            .extensions
            .iter()
            .map(|ext| {
                let trimmed = ext.trim();
                if trimmed.starts_with('.') {
                    format!("*{trimmed}")
                } else {
                    format!("*.{trimmed}")
                }
            })
            .collect();
        parts.push(format!("({})", ext_filters.join("|")));
    }

    let trimmed_query = query.trim();
    if !trimmed_query.is_empty() {
        parts.push(trimmed_query.to_string());
    }

    parts.join(" ")
}

/// Convert a Windows `FILETIME` (100-nanosecond intervals since Jan 1, 1601 UTC)
/// to seconds since Unix epoch (Jan 1, 1970 UTC).
#[must_use]
pub fn filetime_to_unix_secs(filetime: i64) -> i64 {
    if filetime <= 0 {
        return 0;
    }
    // Number of 100-nanosecond intervals between 1601-01-01 and 1970-01-01.
    const EPOCH_DIFFERENCE: i64 = 116_444_736_000_000_000;
    let adjusted = filetime.saturating_sub(EPOCH_DIFFERENCE);
    adjusted / 10_000_000
}

// ---------------------------------------------------------------------------
// Windows Implementation
// ---------------------------------------------------------------------------

#[cfg(windows)]
mod imp {
    use std::{
        ffi::CString,
        path::{Path, PathBuf},
        sync::Mutex,
    };

    use windows::{
        Win32::{
            Foundation::HMODULE,
            System::LibraryLoader::{GetProcAddress, LoadLibraryW},
        },
        core::{PCSTR, PCWSTR},
    };

    unsafe extern "system" {
        fn FreeLibrary(h_module: *mut core::ffi::c_void) -> i32;
    }

    use super::*;

    type FnSetSearchW = unsafe extern "system" fn(*const u16);
    type FnSetMatchPath = unsafe extern "system" fn(i32);
    type FnSetMatchCase = unsafe extern "system" fn(i32);
    type FnSetMatchWholeWord = unsafe extern "system" fn(i32);
    type FnSetRegex = unsafe extern "system" fn(i32);
    type FnSetMax = unsafe extern "system" fn(u32);
    type FnSetOffset = unsafe extern "system" fn(u32);
    type FnSetSort = unsafe extern "system" fn(u32);
    type FnSetRequestFlags = unsafe extern "system" fn(u32);
    type FnQueryW = unsafe extern "system" fn(i32) -> i32;
    type FnGetNumResults = unsafe extern "system" fn() -> u32;
    type FnGetTotResults = unsafe extern "system" fn() -> u32;
    type FnGetResultFullPathNameW = unsafe extern "system" fn(u32, *mut u16, u32);
    type FnGetResultFileNameW = unsafe extern "system" fn(u32) -> *const u16;
    type FnGetResultSize = unsafe extern "system" fn(u32, *mut i64) -> i32;
    type FnGetResultDateModified = unsafe extern "system" fn(u32, *mut i64) -> i32;
    type FnIsResultFolder = unsafe extern "system" fn(u32) -> i32;
    type FnGetLastError = unsafe extern "system" fn() -> u32;
    type FnReset = unsafe extern "system" fn();
    type FnCleanUp = unsafe extern "system" fn();
    type FnGetMajorVersion = unsafe extern "system" fn() -> u32;
    type FnGetMinorVersion = unsafe extern "system" fn() -> u32;

    struct Bindings {
        module: HMODULE,
        set_search_w: FnSetSearchW,
        set_match_path: FnSetMatchPath,
        set_match_case: FnSetMatchCase,
        set_match_whole_word: FnSetMatchWholeWord,
        set_regex: FnSetRegex,
        set_max: FnSetMax,
        set_offset: FnSetOffset,
        set_sort: FnSetSort,
        set_request_flags: FnSetRequestFlags,
        query_w: FnQueryW,
        get_num_results: FnGetNumResults,
        get_tot_results: FnGetTotResults,
        get_result_full_path_name_w: FnGetResultFullPathNameW,
        #[allow(dead_code)]
        get_result_file_name_w: FnGetResultFileNameW,
        get_result_size: FnGetResultSize,
        get_result_date_modified: FnGetResultDateModified,
        is_result_folder: FnIsResultFolder,
        get_last_error: FnGetLastError,
        reset: FnReset,
        clean_up: FnCleanUp,
        get_major_version: FnGetMajorVersion,
        get_minor_version: FnGetMinorVersion,
    }

    impl Drop for Bindings {
        fn drop(&mut self) {
            unsafe {
                (self.clean_up)();
                let _ = FreeLibrary(self.module.0);
            }
        }
    }

    unsafe fn load_symbol<T: Copy>(
        module: HMODULE,
        name: &'static str,
    ) -> Result<T, EverythingError> {
        let cname =
            CString::new(name).map_err(|_| EverythingError::MissingSymbol(name.to_string()))?;
        let proc = unsafe { GetProcAddress(module, PCSTR(cname.as_ptr().cast())) }
            .ok_or_else(|| EverythingError::MissingSymbol(name.to_string()))?;
        // SAFETY: The caller ensures the symbol signature matches the loaded export.
        Ok(unsafe { std::mem::transmute_copy(&proc) })
    }

    impl Bindings {
        fn load_from(path: &Path) -> Result<Self, EverythingError> {
            let path_u16: Vec<u16> = path.as_os_str().encode_wide().chain(Some(0)).collect();
            let module = unsafe { LoadLibraryW(PCWSTR(path_u16.as_ptr())) }
                .map_err(|e| EverythingError::DllLoad(path.display().to_string(), e.to_string()))?;

            let bindings = (|| -> Result<Self, EverythingError> {
                Ok(Self {
                    module,
                    set_search_w: unsafe { load_symbol(module, "Everything_SetSearchW")? },
                    set_match_path: unsafe { load_symbol(module, "Everything_SetMatchPath")? },
                    set_match_case: unsafe { load_symbol(module, "Everything_SetMatchCase")? },
                    set_match_whole_word: unsafe {
                        load_symbol(module, "Everything_SetMatchWholeWord")?
                    },
                    set_regex: unsafe { load_symbol(module, "Everything_SetRegex")? },
                    set_max: unsafe { load_symbol(module, "Everything_SetMax")? },
                    set_offset: unsafe { load_symbol(module, "Everything_SetOffset")? },
                    set_sort: unsafe { load_symbol(module, "Everything_SetSort")? },
                    set_request_flags: unsafe {
                        load_symbol(module, "Everything_SetRequestFlags")?
                    },
                    query_w: unsafe { load_symbol(module, "Everything_QueryW")? },
                    get_num_results: unsafe { load_symbol(module, "Everything_GetNumResults")? },
                    get_tot_results: unsafe { load_symbol(module, "Everything_GetTotResults")? },
                    get_result_full_path_name_w: unsafe {
                        load_symbol(module, "Everything_GetResultFullPathNameW")?
                    },
                    get_result_file_name_w: unsafe {
                        load_symbol(module, "Everything_GetResultFileNameW")?
                    },
                    get_result_size: unsafe { load_symbol(module, "Everything_GetResultSize")? },
                    get_result_date_modified: unsafe {
                        load_symbol(module, "Everything_GetResultDateModified")?
                    },
                    is_result_folder: unsafe { load_symbol(module, "Everything_IsResultFolder")? },
                    get_last_error: unsafe { load_symbol(module, "Everything_GetLastError")? },
                    reset: unsafe { load_symbol(module, "Everything_Reset")? },
                    clean_up: unsafe { load_symbol(module, "Everything_CleanUp")? },
                    get_major_version: unsafe {
                        load_symbol(module, "Everything_GetMajorVersion")?
                    },
                    get_minor_version: unsafe {
                        load_symbol(module, "Everything_GetMinorVersion")?
                    },
                })
            })();

            match bindings {
                Ok(b) => Ok(b),
                Err(err) => {
                    unsafe {
                        let _ = FreeLibrary(module.0);
                    }
                    Err(err)
                },
            }
        }
    }

    use std::os::windows::ffi::OsStrExt;

    /// Thread-safe client providing Everything search operations.
    pub struct EverythingClient {
        bindings: Mutex<Bindings>,
    }

    impl EverythingClient {
        /// Try loading Everything64.dll from the environment, standard paths, or PATH.
        pub fn load() -> Result<Self, EverythingError> {
            let candidates = get_dll_candidates();
            let mut last_err = None;

            for candidate in candidates {
                match Bindings::load_from(&candidate) {
                    Ok(bindings) => {
                        return Ok(Self { bindings: Mutex::new(bindings) });
                    },
                    Err(e) => {
                        last_err = Some(e);
                    },
                }
            }

            Err(last_err.unwrap_or_else(|| {
                EverythingError::Unavailable(
                    "Everything64.dll not found in search paths or PATH".to_string(),
                )
            }))
        }

        /// Load Everything DLL directly from a specific file path.
        pub fn load_from(path: &Path) -> Result<Self, EverythingError> {
            let bindings = Bindings::load_from(path)?;
            Ok(Self { bindings: Mutex::new(bindings) })
        }

        /// Return `true` if Everything DLL is loaded and reports a valid major version (> 0).
        #[must_use]
        pub fn is_available(&self) -> bool {
            let Ok(b) = self.bindings.lock() else {
                return false;
            };
            let major = unsafe { (b.get_major_version)() };
            major > 0
        }

        /// Returns `(major, minor)` version of Everything API.
        pub fn version(&self) -> Result<(u32, u32), EverythingError> {
            let b = self.bindings.lock().map_err(|_| EverythingError::LockPoisoned)?;
            let major = unsafe { (b.get_major_version)() };
            let minor = unsafe { (b.get_minor_version)() };
            Ok((major, minor))
        }

        /// Execute a search query and return matching entries.
        pub fn search(
            &self,
            query: &str,
            options: &EverythingSearchOptions,
        ) -> Result<Vec<EverythingHit>, EverythingError> {
            let b = self.bindings.lock().map_err(|_| EverythingError::LockPoisoned)?;

            let search_query = build_query(query, options);
            let query_u16: Vec<u16> = search_query.encode_utf16().chain(Some(0)).collect();

            struct ResetGuard<'a>(&'a Bindings);
            impl<'a> Drop for ResetGuard<'a> {
                fn drop(&mut self) {
                    unsafe { (self.0.reset)() };
                }
            }
            let _guard = ResetGuard(&b);

            unsafe {
                (b.set_search_w)(query_u16.as_ptr());
                (b.set_match_case)(i32::from(options.match_case));
                (b.set_match_path)(i32::from(options.match_path));
                (b.set_match_whole_word)(i32::from(options.match_whole_word));
                (b.set_regex)(i32::from(options.regex));
                (b.set_request_flags)(
                    EVERYTHING_REQUEST_FULL_PATH_AND_FILE_NAME
                        | EVERYTHING_REQUEST_SIZE
                        | EVERYTHING_REQUEST_DATE_MODIFIED,
                );
                (b.set_sort)(options.sort_by.to_api_sort(options.ascending));

                if options.max_results > 0 {
                    (b.set_max)(options.max_results as u32);
                }

                if options.offset > 0 {
                    (b.set_offset)(options.offset as u32);
                }

                if (b.query_w)(1) == 0 {
                    let err = (b.get_last_error)();
                    return Err(EverythingError::QueryFailed(err, error_code_to_str(err)));
                }

                let count = (b.get_num_results)();
                let mut results = Vec::with_capacity(count as usize);

                const BUFFER_SIZE: usize = 1024;
                let mut buffer = [0u16; BUFFER_SIZE];

                for i in 0..count {
                    let is_folder = (b.is_result_folder)(i) != 0;
                    if is_folder && !options.include_directories {
                        continue;
                    }

                    buffer.fill(0);
                    (b.get_result_full_path_name_w)(i, buffer.as_mut_ptr(), BUFFER_SIZE as u32);

                    let end = buffer.iter().position(|&c| c == 0).unwrap_or(BUFFER_SIZE);
                    let full_path = String::from_utf16_lossy(&buffer[..end]);
                    let file_name = Path::new(&full_path)
                        .file_name()
                        .map(|n| n.to_string_lossy().to_string())
                        .unwrap_or_default();

                    let mut size: i64 = 0;
                    let _ = (b.get_result_size)(i, &mut size);
                    let size_u64 = if size >= 0 { size as u64 } else { 0 };

                    let mut date_time: i64 = 0;
                    let _ = (b.get_result_date_modified)(i, &mut date_time);
                    let date_modified = filetime_to_unix_secs(date_time);

                    results.push(EverythingHit {
                        full_path,
                        file_name,
                        size: size_u64,
                        date_modified_unix: date_modified,
                        is_dir: is_folder,
                    });
                }

                Ok(results)
            }
        }

        /// Count the total number of matches for a query without allocating result rows.
        pub fn count(
            &self,
            query: &str,
            options: &EverythingSearchOptions,
        ) -> Result<usize, EverythingError> {
            let b = self.bindings.lock().map_err(|_| EverythingError::LockPoisoned)?;

            let search_query = build_query(query, options);
            let query_u16: Vec<u16> = search_query.encode_utf16().chain(Some(0)).collect();

            struct ResetGuard<'a>(&'a Bindings);
            impl<'a> Drop for ResetGuard<'a> {
                fn drop(&mut self) {
                    unsafe { (self.0.reset)() };
                }
            }
            let _guard = ResetGuard(&b);

            unsafe {
                (b.set_search_w)(query_u16.as_ptr());
                (b.set_max)(0);

                if (b.query_w)(1) == 0 {
                    let err = (b.get_last_error)();
                    return Err(EverythingError::QueryFailed(err, error_code_to_str(err)));
                }

                let total = (b.get_tot_results)();
                Ok(total as usize)
            }
        }

        /// Search specifically for `*.cfg.bin` game config assets (mirrors IECODE `SearchCfgBinAsync`).
        pub fn search_cfg_bin(
            &self,
            base_path: Option<&str>,
        ) -> Result<Vec<EverythingHit>, EverythingError> {
            self.search(
                "*.cfg.bin",
                &EverythingSearchOptions {
                    base_path: base_path.map(str::to_string),
                    ..EverythingSearchOptions::default()
                },
            )
        }

        /// Search specifically for `*.cpk` Criware archives (mirrors IECODE `SearchCpkAsync`).
        pub fn search_cpk(
            &self,
            base_path: Option<&str>,
        ) -> Result<Vec<EverythingHit>, EverythingError> {
            self.search(
                "*.cpk",
                &EverythingSearchOptions {
                    base_path: base_path.map(str::to_string),
                    ..EverythingSearchOptions::default()
                },
            )
        }

        /// Search for character asset files by ID (mirrors IECODE `SearchCharacterAssetsAsync`).
        pub fn search_character_assets(
            &self,
            character_id: &str,
            base_path: Option<&str>,
        ) -> Result<Vec<EverythingHit>, EverythingError> {
            let base = base_path.map(str::to_string).or_else(|| {
                std::env::var("NIE_GAME_DIR").ok().map(|d| format!("{d}\\data\\common\\chr"))
            });
            self.search(
                character_id,
                &EverythingSearchOptions { base_path: base, ..EverythingSearchOptions::default() },
            )
        }

        /// Search specifically for `*.g4tx` textures (mirrors IECODE `SearchTexturesAsync`).
        pub fn search_textures(
            &self,
            base_path: Option<&str>,
        ) -> Result<Vec<EverythingHit>, EverythingError> {
            self.search(
                "*.g4tx",
                &EverythingSearchOptions {
                    base_path: base_path.map(str::to_string),
                    ..EverythingSearchOptions::default()
                },
            )
        }
    }

    fn get_dll_candidates() -> Vec<PathBuf> {
        let mut candidates = Vec::new();

        if let Ok(env_path) = std::env::var("EVERYTHING_DLL") {
            candidates.push(PathBuf::from(env_path));
        }

        candidates.push(PathBuf::from("Everything64.dll"));
        candidates.push(PathBuf::from("Everything.dll"));

        if let Ok(program_files) = std::env::var("ProgramFiles") {
            candidates
                .push(PathBuf::from(&program_files).join("Everything").join("Everything64.dll"));
            candidates
                .push(PathBuf::from(&program_files).join("Everything").join("Everything.dll"));
        }

        if let Ok(program_files_x86) = std::env::var("ProgramFiles(x86)") {
            candidates
                .push(PathBuf::from(&program_files_x86).join("Everything").join("Everything.dll"));
        }

        candidates
    }
}

// ---------------------------------------------------------------------------
// Non-Windows Stub Implementation
// ---------------------------------------------------------------------------

#[cfg(not(windows))]
mod imp {
    use super::*;
    use std::path::Path;

    /// Non-Windows stub for EverythingClient.
    pub struct EverythingClient;

    impl EverythingClient {
        pub fn load() -> Result<Self, EverythingError> {
            Err(EverythingError::Unavailable(
                "Everything search is only available on Windows".to_string(),
            ))
        }

        pub fn load_from(_path: &Path) -> Result<Self, EverythingError> {
            Err(EverythingError::Unavailable(
                "Everything search is only available on Windows".to_string(),
            ))
        }

        #[must_use]
        pub fn is_available(&self) -> bool {
            false
        }

        pub fn version(&self) -> Result<(u32, u32), EverythingError> {
            Err(EverythingError::Unavailable(
                "Everything search is only available on Windows".to_string(),
            ))
        }

        pub fn search(
            &self,
            _query: &str,
            _options: &EverythingSearchOptions,
        ) -> Result<Vec<EverythingHit>, EverythingError> {
            Err(EverythingError::Unavailable(
                "Everything search is only available on Windows".to_string(),
            ))
        }

        pub fn count(
            &self,
            _query: &str,
            _options: &EverythingSearchOptions,
        ) -> Result<usize, EverythingError> {
            Err(EverythingError::Unavailable(
                "Everything search is only available on Windows".to_string(),
            ))
        }

        pub fn search_cfg_bin(
            &self,
            _base_path: Option<&str>,
        ) -> Result<Vec<EverythingHit>, EverythingError> {
            Err(EverythingError::Unavailable(
                "Everything search is only available on Windows".to_string(),
            ))
        }

        pub fn search_cpk(
            &self,
            _base_path: Option<&str>,
        ) -> Result<Vec<EverythingHit>, EverythingError> {
            Err(EverythingError::Unavailable(
                "Everything search is only available on Windows".to_string(),
            ))
        }

        pub fn search_character_assets(
            &self,
            _character_id: &str,
            _base_path: Option<&str>,
        ) -> Result<Vec<EverythingHit>, EverythingError> {
            Err(EverythingError::Unavailable(
                "Everything search is only available on Windows".to_string(),
            ))
        }

        pub fn search_textures(
            &self,
            _base_path: Option<&str>,
        ) -> Result<Vec<EverythingHit>, EverythingError> {
            Err(EverythingError::Unavailable(
                "Everything search is only available on Windows".to_string(),
            ))
        }
    }
}

pub use imp::EverythingClient;

// ---------------------------------------------------------------------------
// Unit tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use std::path::Path;

    use super::*;

    #[test]
    fn test_error_code_descriptions() {
        assert_eq!(error_code_to_str(EVERYTHING_OK), "Operation successful");
        assert_eq!(
            error_code_to_str(EVERYTHING_ERROR_IPC),
            "IPC communication error (Everything service or GUI not running)"
        );
        assert_eq!(error_code_to_str(999), "Unknown Everything error");
    }

    #[test]
    fn test_sort_type_mapping() {
        assert_eq!(EverythingSort::Name.to_api_sort(true), EVERYTHING_SORT_NAME_ASCENDING);
        assert_eq!(EverythingSort::Name.to_api_sort(false), EVERYTHING_SORT_NAME_DESCENDING);
        assert_eq!(EverythingSort::Path.to_api_sort(true), EVERYTHING_SORT_PATH_ASCENDING);
        assert_eq!(EverythingSort::Path.to_api_sort(false), EVERYTHING_SORT_PATH_DESCENDING);
        assert_eq!(EverythingSort::Size.to_api_sort(true), EVERYTHING_SORT_SIZE_ASCENDING);
        assert_eq!(EverythingSort::Size.to_api_sort(false), EVERYTHING_SORT_SIZE_DESCENDING);
        assert_eq!(
            EverythingSort::DateModified.to_api_sort(true),
            EVERYTHING_SORT_DATE_MODIFIED_ASCENDING
        );
        assert_eq!(
            EverythingSort::DateModified.to_api_sort(false),
            EVERYTHING_SORT_DATE_MODIFIED_DESCENDING
        );
    }

    #[test]
    fn test_build_query_formatting() {
        let options = EverythingSearchOptions {
            base_path: Some("C:\\Games\\Inazuma".to_string()),
            extensions: vec!["cpk".into(), ".cfg.bin".into()],
            ..Default::default()
        };

        let q = build_query("player_001", &options);
        assert_eq!(q, "path:\"C:\\Games\\Inazuma\" (*.cpk|*.cfg.bin) player_001");
    }

    #[test]
    fn test_build_query_empty_options() {
        let options = EverythingSearchOptions::default();
        let q = build_query("simple_search", &options);
        assert_eq!(q, "simple_search");
    }

    #[test]
    fn test_filetime_to_unix_secs() {
        assert_eq!(filetime_to_unix_secs(0), 0);
        assert_eq!(filetime_to_unix_secs(-100), 0);
        let ft = 133_806_992_000_000_000i64;
        let unix = filetime_to_unix_secs(ft);
        assert_eq!(unix, 1_736_225_600);
    }

    #[test]
    fn test_client_graceful_missing_dll() {
        // Attempting to load from an invalid path returns a clean error, does not panic
        let res = EverythingClient::load_from(Path::new("C:\\NonExistent_Path_To_Everything.dll"));
        assert!(res.is_err());
    }
}
