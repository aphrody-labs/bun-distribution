// SPDX-License-Identifier: Apache-2.0
//! Windows implementation: dynamic loading of `Everything64.dll` and raw calls.
#![allow(unsafe_code)]

use std::{
    ffi::CString,
    os::windows::ffi::OsStrExt,
    path::Path,
    sync::{Mutex, MutexGuard, PoisonError},
};

use windows::{
    Win32::{
        Foundation::{FreeLibrary, HMODULE},
        System::LibraryLoader::{GetProcAddress, LoadLibraryW},
    },
    core::{PCSTR, PCWSTR},
};

use crate::everything_sdk::{Entry, EverythingError, Query, dll_candidates};

type Bool = i32;

/// Everything error code reported when a call fails without a recorded error.
const ERROR_INVALID_CALL: u32 = crate::everything_sdk::EVERYTHING_ERROR_INVALIDCALL;

/// The SDK keeps global query state, so every call in the process is serialised.
static LOCK: Mutex<()> = Mutex::new(());

fn lock() -> MutexGuard<'static, ()> {
    LOCK.lock().unwrap_or_else(PoisonError::into_inner)
}

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
    get_tot_results: unsafe extern "system" fn() -> u32,
    get_result_full_path_name_w: unsafe extern "system" fn(u32, *mut u16, u32) -> u32,
    get_result_size: unsafe extern "system" fn(u32, *mut i64) -> Bool,
    get_result_date_modified: unsafe extern "system" fn(u32, *mut i64) -> Bool,
    is_folder_result: unsafe extern "system" fn(u32) -> Bool,
    get_last_error: unsafe extern "system" fn() -> u32,
    reset: unsafe extern "system" fn(),
    clean_up: unsafe extern "system" fn(),
    get_major_version: unsafe extern "system" fn() -> u32,
    get_minor_version: unsafe extern "system" fn() -> u32,
    get_revision: unsafe extern "system" fn() -> u32,
}

/// A loaded Everything SDK. Dropping it calls `Everything_CleanUp` and releases
/// the module reference.
pub struct Library {
    module: HMODULE,
    api: Api,
}

impl std::fmt::Debug for Library {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Library").finish_non_exhaustive()
    }
}

// SAFETY: `HMODULE` is an opaque process-wide handle and the function pointers are
// plain code addresses; every SDK call is serialised through `LOCK`.
unsafe impl Send for Library {}
// SAFETY: see `Send`; shared access never calls the SDK without holding `LOCK`.
unsafe impl Sync for Library {}

fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

/// Resolve one export as a typed function pointer.
///
/// # Safety
///
/// `T` must be the `unsafe extern "system" fn` type matching the export's real
/// signature, and `module` must be a live module handle.
unsafe fn symbol<T: Copy>(module: HMODULE, name: &'static str) -> Result<T, EverythingError> {
    const { assert!(size_of::<T>() == size_of::<unsafe extern "system" fn() -> isize>()) };
    let cname = CString::new(name).map_err(|_| EverythingError::MissingSymbol(name))?;
    // SAFETY: `cname` is NUL-terminated and alive for the call.
    let proc = unsafe { GetProcAddress(module, PCSTR(cname.as_ptr().cast())) }
        .ok_or(EverythingError::MissingSymbol(name))?;
    // SAFETY: caller guarantees `T` matches the export; both are fn-pointer sized.
    Ok(unsafe { std::mem::transmute_copy::<_, T>(&proc) })
}

impl Library {
    /// Try every [`dll_candidates`] path in order.
    ///
    /// # Errors
    ///
    /// [`EverythingError::MissingSymbol`] when a DLL loaded but lacked an export,
    /// otherwise [`EverythingError::LibraryNotFound`] listing the paths tried.
    pub fn load() -> Result<Self, EverythingError> {
        let mut tried = Vec::new();
        let mut symbol_error = None;
        for candidate in dll_candidates() {
            match Self::load_from(&candidate) {
                Ok(lib) => return Ok(lib),
                Err(e @ EverythingError::MissingSymbol(_)) => symbol_error = Some(e),
                Err(_) => {},
            }
            tried.push(candidate.display().to_string());
        }
        Err(symbol_error.unwrap_or_else(|| EverythingError::LibraryNotFound(tried.join(", "))))
    }

    /// Load the SDK DLL from an explicit path.
    ///
    /// # Errors
    ///
    /// [`EverythingError::DllLoad`] or [`EverythingError::MissingSymbol`].
    pub fn load_from(path: &Path) -> Result<Self, EverythingError> {
        let name: Vec<u16> = path.as_os_str().encode_wide().chain(Some(0)).collect();
        // SAFETY: `name` is a NUL-terminated UTF-16 string alive for the call.
        let module = unsafe { LoadLibraryW(PCWSTR(name.as_ptr())) }.map_err(|e| {
            EverythingError::DllLoad { path: path.display().to_string(), reason: e.to_string() }
        })?;
        match Self::bind(module) {
            Ok(api) => Ok(Self { module, api }),
            Err(e) => {
                // SAFETY: `module` was returned by `LoadLibraryW` above and is not used again.
                // A failed release leaves nothing actionable beyond the error already returned.
                let _ = unsafe { FreeLibrary(module) };
                Err(e)
            },
        }
    }

    fn bind(m: HMODULE) -> Result<Api, EverythingError> {
        // SAFETY: every field type below is the documented Everything SDK signature of
        // the export it is resolved from.
        unsafe {
            Ok(Api {
                set_search_w: symbol(m, "Everything_SetSearchW")?,
                set_match_path: symbol(m, "Everything_SetMatchPath")?,
                set_match_case: symbol(m, "Everything_SetMatchCase")?,
                set_match_whole_word: symbol(m, "Everything_SetMatchWholeWord")?,
                set_regex: symbol(m, "Everything_SetRegex")?,
                set_max: symbol(m, "Everything_SetMax")?,
                set_offset: symbol(m, "Everything_SetOffset")?,
                set_sort: symbol(m, "Everything_SetSort")?,
                set_request_flags: symbol(m, "Everything_SetRequestFlags")?,
                query_w: symbol(m, "Everything_QueryW")?,
                get_num_results: symbol(m, "Everything_GetNumResults")?,
                get_tot_results: symbol(m, "Everything_GetTotResults")?,
                get_result_full_path_name_w: symbol(m, "Everything_GetResultFullPathNameW")?,
                get_result_size: symbol(m, "Everything_GetResultSize")?,
                get_result_date_modified: symbol(m, "Everything_GetResultDateModified")?,
                is_folder_result: symbol(m, "Everything_IsFolderResult")?,
                get_last_error: symbol(m, "Everything_GetLastError")?,
                reset: symbol(m, "Everything_Reset")?,
                clean_up: symbol(m, "Everything_CleanUp")?,
                get_major_version: symbol(m, "Everything_GetMajorVersion")?,
                get_minor_version: symbol(m, "Everything_GetMinorVersion")?,
                get_revision: symbol(m, "Everything_GetRevision")?,
            })
        }
    }

    fn last_error(&self) -> EverythingError {
        // SAFETY: no-argument SDK getter.
        let code = unsafe { (self.api.get_last_error)() };
        // A failed call with no recorded error is reported as "invalid call".
        EverythingError::Sdk { code: if code == 0 { ERROR_INVALID_CALL } else { code } }
    }

    /// `(major, minor, revision)` of the running Everything service. The call
    /// performs the IPC probe and reports major 0 when the service is silent.
    ///
    /// # Errors
    ///
    /// [`EverythingError::Sdk`] when the service does not answer.
    pub fn version(&self) -> Result<(u32, u32, u32), EverythingError> {
        let _guard = lock();
        // SAFETY: no-argument SDK getters.
        let major = unsafe { (self.api.get_major_version)() };
        if major == 0 {
            return Err(self.last_error());
        }
        // SAFETY: as above.
        let (minor, rev) = unsafe { ((self.api.get_minor_version)(), (self.api.get_revision)()) };
        Ok((major, minor, rev))
    }

    /// Reset, configure and run `q`; the caller holds `LOCK` and resets afterwards.
    fn execute(&self, q: &Query<'_>) -> Result<(), EverythingError> {
        let api = &self.api;
        let text = wide(q.text);
        // SAFETY: SDK setters take plain values; `text` outlives `Everything_QueryW`,
        // which copies the search string.
        let ok = unsafe {
            (api.reset)();
            (api.set_search_w)(text.as_ptr());
            (api.set_match_path)(Bool::from(q.match_path));
            (api.set_match_case)(Bool::from(q.match_case));
            (api.set_match_whole_word)(Bool::from(q.match_whole_word));
            (api.set_regex)(Bool::from(q.regex));
            if let Some(max) = q.max_results {
                (api.set_max)(max);
            }
            if let Some(offset) = q.offset {
                (api.set_offset)(offset);
            }
            if let Some(sort) = q.sort {
                (api.set_sort)(sort);
            }
            (api.set_request_flags)(q.request_flags);
            (api.query_w)(1)
        };
        if ok == 0 { Err(self.last_error()) } else { Ok(()) }
    }

    /// Run `q` and return every result row.
    ///
    /// # Errors
    ///
    /// [`EverythingError::Sdk`] when the query fails.
    pub fn search(&self, q: &Query<'_>) -> Result<Vec<Entry>, EverythingError> {
        let _guard = lock();
        let _reset = ResetGuard(&self.api);
        self.execute(q)?;
        let api = &self.api;
        // SAFETY: no-argument getter after a successful query.
        let count = unsafe { (api.get_num_results)() };
        let mut entries = Vec::with_capacity(count as usize);
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
            entries.push(Entry {
                path,
                is_dir,
                size: has_size.then_some(size),
                filetime: has_mtime.then_some(mtime),
            });
        }
        Ok(entries)
    }

    /// Run `q` and return the total number of matches (`Everything_GetTotResults`).
    /// Callers normally set `max_results` to `Some(0)` to avoid result transfer.
    ///
    /// # Errors
    ///
    /// [`EverythingError::Sdk`] when the query fails.
    pub fn count(&self, q: &Query<'_>) -> Result<u32, EverythingError> {
        let _guard = lock();
        let _reset = ResetGuard(&self.api);
        self.execute(q)?;
        // SAFETY: no-argument getter after a successful query.
        Ok(unsafe { (self.api.get_tot_results)() })
    }
}

/// Resets the SDK query state when a call finishes, on every path.
struct ResetGuard<'a>(&'a Api);

impl Drop for ResetGuard<'_> {
    fn drop(&mut self) {
        // SAFETY: no-argument SDK call; the module outlives the borrowed `Api`.
        unsafe { (self.0.reset)() };
    }
}

impl Drop for Library {
    fn drop(&mut self) {
        let _guard = lock();
        // SAFETY: the module is still mapped; it is released exactly once here and the
        // function pointers are never used afterwards. A failed release is not actionable.
        unsafe {
            (self.api.clean_up)();
            let _ = FreeLibrary(self.module);
        }
    }
}
