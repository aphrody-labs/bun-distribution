// SPDX-License-Identifier: Apache-2.0
//! Everything (Voidtools) search provider interop.
//!
//! Provides dynamic loading and query execution for `Everything64.dll`,
//! matching the P/Invoke contract from `IECODE.Core.Search.EverythingSearchProvider`.
//! Allows sub-millisecond querying over millions of NTFS-indexed files on Windows.

use std::path::Path;

use aphrody_everything_sdk::{self as sdk, Entry, Library, Query};
use serde::{Deserialize, Serialize};
use thiserror::Error;

// ---------------------------------------------------------------------------
// Constants (shared SDK values)
// ---------------------------------------------------------------------------

pub use aphrody_everything_sdk::{
    EVERYTHING_ERROR_CREATETHREAD, EVERYTHING_ERROR_CREATEWINDOW, EVERYTHING_ERROR_INVALIDCALL,
    EVERYTHING_ERROR_INVALIDINDEX, EVERYTHING_ERROR_IPC, EVERYTHING_ERROR_MEMORY,
    EVERYTHING_ERROR_REGISTERCLASSEX, EVERYTHING_OK, EVERYTHING_REQUEST_ATTRIBUTES,
    EVERYTHING_REQUEST_DATE_ACCESSED, EVERYTHING_REQUEST_DATE_CREATED,
    EVERYTHING_REQUEST_DATE_MODIFIED, EVERYTHING_REQUEST_EXTENSION, EVERYTHING_REQUEST_FILE_NAME,
    EVERYTHING_REQUEST_FULL_PATH_AND_FILE_NAME, EVERYTHING_REQUEST_PATH, EVERYTHING_REQUEST_SIZE,
    EVERYTHING_SORT_DATE_MODIFIED_ASCENDING, EVERYTHING_SORT_DATE_MODIFIED_DESCENDING,
    EVERYTHING_SORT_EXTENSION_ASCENDING, EVERYTHING_SORT_EXTENSION_DESCENDING,
    EVERYTHING_SORT_NAME_ASCENDING, EVERYTHING_SORT_NAME_DESCENDING,
    EVERYTHING_SORT_PATH_ASCENDING, EVERYTHING_SORT_PATH_DESCENDING,
    EVERYTHING_SORT_SIZE_ASCENDING, EVERYTHING_SORT_SIZE_DESCENDING,
};

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

impl From<sdk::EverythingError> for EverythingError {
    fn from(e: sdk::EverythingError) -> Self {
        match e {
            sdk::EverythingError::Unsupported => {
                Self::Unavailable("Everything search is only available on Windows".to_string())
            },
            sdk::EverythingError::LibraryNotFound(tried) => Self::Unavailable(format!(
                "Everything64.dll not found in search paths or PATH (tried: {tried})"
            )),
            sdk::EverythingError::DllLoad { path, reason } => Self::DllLoad(path, reason),
            sdk::EverythingError::MissingSymbol(name) => Self::MissingSymbol(name.to_string()),
            sdk::EverythingError::Sdk { code } => Self::QueryFailed(code, error_code_to_str(code)),
        }
    }
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
    sdk::filetime_to_unix(filetime)
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

/// Request flags sent with every search: full path, size and modification time.
const SEARCH_REQUEST_FLAGS: u32 = EVERYTHING_REQUEST_FULL_PATH_AND_FILE_NAME
    | EVERYTHING_REQUEST_SIZE
    | EVERYTHING_REQUEST_DATE_MODIFIED;

/// Thread-safe client providing Everything search operations. The low-level
/// FFI lives in `aphrody-everything-sdk`; on non-Windows hosts loading always
/// fails with [`EverythingError::Unavailable`].
#[derive(Debug)]
pub struct EverythingClient {
    lib: Library,
}

impl EverythingClient {
    /// Try loading Everything64.dll from the environment, standard paths, or PATH.
    ///
    /// # Errors
    ///
    /// [`EverythingError`] when no usable DLL is found or the platform is unsupported.
    pub fn load() -> Result<Self, EverythingError> {
        Ok(Self { lib: Library::load()? })
    }

    /// Load Everything DLL directly from a specific file path.
    ///
    /// # Errors
    ///
    /// [`EverythingError`] when the DLL cannot be loaded or lacks an export.
    pub fn load_from(path: &Path) -> Result<Self, EverythingError> {
        Ok(Self { lib: Library::load_from(path)? })
    }

    /// Return `true` if Everything DLL is loaded and reports a valid major version (> 0).
    #[must_use]
    pub fn is_available(&self) -> bool {
        self.lib.version().is_ok()
    }

    /// Returns `(major, minor)` version of Everything API.
    ///
    /// # Errors
    ///
    /// [`EverythingError`] when the Everything service does not answer.
    pub fn version(&self) -> Result<(u32, u32), EverythingError> {
        let (major, minor, _revision) = self.lib.version()?;
        Ok((major, minor))
    }

    /// Execute a search query and return matching entries.
    ///
    /// # Errors
    ///
    /// [`EverythingError`] when the query fails.
    pub fn search(
        &self,
        query: &str,
        options: &EverythingSearchOptions,
    ) -> Result<Vec<EverythingHit>, EverythingError> {
        let search_query = build_query(query, options);
        let raw = Query {
            match_path: options.match_path,
            match_case: options.match_case,
            match_whole_word: options.match_whole_word,
            regex: options.regex,
            max_results: positive_u32(options.max_results),
            offset: positive_u32(options.offset),
            sort: Some(options.sort_by.to_api_sort(options.ascending)),
            request_flags: SEARCH_REQUEST_FLAGS,
            ..Query::new(&search_query)
        };
        Ok(self
            .lib
            .search(&raw)?
            .into_iter()
            .filter(|e| options.include_directories || !e.is_dir)
            .map(hit_from_entry)
            .collect())
    }

    /// Count the total number of matches for a query without allocating result rows.
    ///
    /// # Errors
    ///
    /// [`EverythingError`] when the query fails.
    pub fn count(
        &self,
        query: &str,
        options: &EverythingSearchOptions,
    ) -> Result<usize, EverythingError> {
        let search_query = build_query(query, options);
        let raw = Query { max_results: Some(0), ..Query::new(&search_query) };
        Ok(self.lib.count(&raw)? as usize)
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

/// `Some(value)` as a SDK u32 when non-zero (zero means "leave the SDK default").
fn positive_u32(value: usize) -> Option<u32> {
    (value > 0).then(|| u32::try_from(value).unwrap_or(u32::MAX))
}

/// Shape one raw SDK row into an [`EverythingHit`].
fn hit_from_entry(entry: Entry) -> EverythingHit {
    let file_name = Path::new(&entry.path)
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();
    EverythingHit {
        file_name,
        size: entry.size.and_then(|s| u64::try_from(s).ok()).unwrap_or(0),
        date_modified_unix: entry.filetime.map_or(0, filetime_to_unix_secs),
        is_dir: entry.is_dir,
        full_path: entry.path,
    }
}

// ---------------------------------------------------------------------------
// Unit tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
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
