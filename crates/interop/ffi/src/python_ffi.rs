// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 aphrody contributors

//! C ABI that hosts the shared CPython inside `libaphrody`.
//!
//! The libpython is the one of the `vu` artifact, shared with the Bun fork (`yolo`): it is opened
//! `RTLD_GLOBAL` at run time (`LoadLibraryW`, process-wide by construction, on Windows) and its C API is bound by `dlsym`; it is never linked. Nothing is
//! cached beyond the process-wide host: strings returned to the caller are owned by this crate
//! and released with [`aphrody_py_string_free`]. Every export catches panics and answers an
//! error code; the detail of the last failure is read with [`aphrody_py_last_error`].
//!
//! Lifecycle: [`aphrody_py_load`] (explicit path, `APHRODY_LIBPYTHON`, an already global
//! libpython, then versioned names), [`aphrody_py_init`] (initialises once, or attaches through
//! the GIL when the host already did), then [`aphrody_py_run`], [`aphrody_py_eval`] and
//! [`aphrody_py_call`]; [`aphrody_py_finalize`] only finalises an interpreter this crate started.

#![allow(unsafe_code)]

use std::ffi::{CStr, CString, c_char, c_int, c_void};
use std::panic::{AssertUnwindSafe, catch_unwind};
use std::sync::Mutex;

/// Success.
pub const APHRODY_PY_OK: i32 = 0;
/// A required pointer argument was null or not UTF-8.
pub const APHRODY_PY_ERR_ARG: i32 = -1;
/// No libpython could be opened or a required symbol is missing.
pub const APHRODY_PY_ERR_LOAD: i32 = -2;
/// The libpython is not loaded or the interpreter is not initialised.
pub const APHRODY_PY_ERR_STATE: i32 = -3;
/// The Python code raised an exception (see [`aphrody_py_last_error`]).
pub const APHRODY_PY_ERR_PYTHON: i32 = -4;
/// A panic was caught at the boundary.
pub const APHRODY_PY_ERR_PANIC: i32 = -5;
/// Unsupported platform.
pub const APHRODY_PY_ERR_UNSUPPORTED: i32 = -6;

type PyObj = *mut c_void;
const PY_EVAL_INPUT: c_int = 258;

#[derive(Clone, Copy)]
struct Api {
    is_initialized: unsafe extern "C" fn() -> c_int,
    initialize_ex: unsafe extern "C" fn(c_int),
    finalize_ex: unsafe extern "C" fn() -> c_int,
    save_thread: unsafe extern "C" fn() -> *mut c_void,
    restore_thread: unsafe extern "C" fn(*mut c_void),
    gil_ensure: unsafe extern "C" fn() -> c_int,
    gil_release: unsafe extern "C" fn(c_int),
    run_simple: unsafe extern "C" fn(*const c_char) -> c_int,
    run_string: unsafe extern "C" fn(*const c_char, c_int, PyObj, PyObj) -> PyObj,
    import_module: unsafe extern "C" fn(*const c_char) -> PyObj,
    get_attr: unsafe extern "C" fn(PyObj, *const c_char) -> PyObj,
    call_object: unsafe extern "C" fn(PyObj, PyObj) -> PyObj,
    tuple_new: unsafe extern "C" fn(isize) -> PyObj,
    tuple_set: unsafe extern "C" fn(PyObj, isize, PyObj) -> c_int,
    unicode_from: unsafe extern "C" fn(*const c_char) -> PyObj,
    object_str: unsafe extern "C" fn(PyObj) -> PyObj,
    as_utf8: unsafe extern "C" fn(PyObj) -> *const c_char,
    decref: unsafe extern "C" fn(PyObj),
    add_module: unsafe extern "C" fn(*const c_char) -> PyObj,
    module_dict: unsafe extern "C" fn(PyObj) -> PyObj,
    err_fetch: unsafe extern "C" fn(*mut PyObj, *mut PyObj, *mut PyObj),
    err_clear: unsafe extern "C" fn(),
    get_version: unsafe extern "C" fn() -> *const c_char,
}

struct Host {
    api: Api,
    initialized: bool,
    /// True when this crate called `Py_InitializeEx` (and so may finalise).
    owned: bool,
    /// Thread state saved after initialisation so any thread can attach with the GIL state API.
    saved: *mut c_void,
}

// SAFETY: the raw pointers are opaque handles only used under the mutex or the GIL.
unsafe impl Send for Host {}

static HOST: Mutex<Option<Host>> = Mutex::new(None);
static LAST_ERROR: Mutex<String> = Mutex::new(String::new());

fn set_error(message: impl Into<String>) {
    if let Ok(mut slot) = LAST_ERROR.lock() {
        *slot = message.into();
    }
}

fn guard<T>(fallback: T, body: impl FnOnce() -> T) -> T {
    catch_unwind(AssertUnwindSafe(body)).unwrap_or_else(|_| {
        set_error("panic caught at the FFI boundary");
        fallback
    })
}

fn host() -> std::sync::MutexGuard<'static, Option<Host>> {
    HOST.lock().unwrap_or_else(std::sync::PoisonError::into_inner)
}

/// Binds the CPython C API from a resolved symbol table (shared by every platform).
fn bind_with(sym: impl Fn(&CStr) -> *mut c_void) -> Result<Api, String> {
    /// # Safety
    /// `T` is a function pointer type matching the symbol.
    unsafe fn cast<T: Copy>(p: *mut c_void) -> T {
        // SAFETY: caller contract; function pointers and data pointers have the same size here.
        unsafe { std::mem::transmute_copy::<*mut c_void, T>(&p) }
    }
    macro_rules! f {
        ($name:literal) => {{
            let p = sym($name);
            if p.is_null() {
                return Err(format!("missing symbol {}", $name.to_string_lossy()));
            }
            // SAFETY: the symbol is the documented CPython C API function of that name.
            unsafe { cast(p) }
        }};
    }
    Ok(Api {
        is_initialized: f!(c"Py_IsInitialized"),
        initialize_ex: f!(c"Py_InitializeEx"),
        finalize_ex: f!(c"Py_FinalizeEx"),
        save_thread: f!(c"PyEval_SaveThread"),
        restore_thread: f!(c"PyEval_RestoreThread"),
        gil_ensure: f!(c"PyGILState_Ensure"),
        gil_release: f!(c"PyGILState_Release"),
        run_simple: f!(c"PyRun_SimpleString"),
        run_string: f!(c"PyRun_String"),
        import_module: f!(c"PyImport_ImportModule"),
        get_attr: f!(c"PyObject_GetAttrString"),
        call_object: f!(c"PyObject_CallObject"),
        tuple_new: f!(c"PyTuple_New"),
        tuple_set: f!(c"PyTuple_SetItem"),
        unicode_from: f!(c"PyUnicode_FromString"),
        object_str: f!(c"PyObject_Str"),
        as_utf8: f!(c"PyUnicode_AsUTF8"),
        decref: f!(c"Py_DecRef"),
        add_module: f!(c"PyImport_AddModule"),
        module_dict: f!(c"PyModule_GetDict"),
        err_fetch: f!(c"PyErr_Fetch"),
        err_clear: f!(c"PyErr_Clear"),
        get_version: f!(c"Py_GetVersion"),
    })
}

#[cfg(unix)]
mod sys {
    use super::{Api, c_void};
    use std::ffi::{CStr, CString};

    pub fn open(path: &str) -> *mut c_void {
        let Ok(c) = CString::new(path) else { return std::ptr::null_mut() };
        // SAFETY: valid NUL-terminated path.
        unsafe { libc::dlopen(c.as_ptr(), libc::RTLD_NOW | libc::RTLD_GLOBAL) }
    }

    /// The global scope of the process, when it already exports the CPython C API (the Bun
    /// fork opens the libpython `RTLD_GLOBAL`).
    pub fn already_loaded() -> *mut c_void {
        if has(libc::RTLD_DEFAULT, c"Py_IsInitialized") {
            libc::RTLD_DEFAULT
        } else {
            std::ptr::null_mut()
        }
    }

    fn sym(handle: *mut c_void, name: &CStr) -> *mut c_void {
        // SAFETY: valid handle and NUL-terminated name.
        unsafe { libc::dlsym(handle, name.as_ptr()) }
    }

    fn has(handle: *mut c_void, name: &CStr) -> bool {
        !sym(handle, name).is_null()
    }

    pub fn bind(handle: *mut c_void) -> Result<Api, String> {
        super::bind_with(|name| sym(handle, name))
    }
}

#[cfg(windows)]
mod sys {
    use super::{Api, c_void, library_candidates};
    use std::ffi::CStr;
    use windows_sys::Win32::System::LibraryLoader::{
        GetModuleHandleW, GetProcAddress, LoadLibraryW,
    };

    fn wide(s: &str) -> Vec<u16> {
        s.encode_utf16().chain(std::iter::once(0)).collect()
    }

    /// Windows has no global symbol scope: a module loaded once is shared by every caller of the
    /// process, which gives the same single-libpython guarantee as `RTLD_GLOBAL`.
    pub fn open(path: &str) -> *mut c_void {
        let w = wide(path);
        // SAFETY: valid NUL-terminated UTF-16 path.
        unsafe { LoadLibraryW(w.as_ptr()) }
    }

    /// A `python3XY.dll` already mapped by the host (the Bun fork or an embedding process).
    pub fn already_loaded() -> *mut c_void {
        for name in library_candidates() {
            let w = wide(&name);
            // SAFETY: valid NUL-terminated UTF-16 name; no reference count is taken.
            let h = unsafe { GetModuleHandleW(w.as_ptr()) };
            if !h.is_null() {
                return h;
            }
        }
        std::ptr::null_mut()
    }

    fn sym(handle: *mut c_void, name: &CStr) -> *mut c_void {
        // SAFETY: valid module handle and NUL-terminated name.
        unsafe { GetProcAddress(handle, name.as_ptr().cast()) }
            .map_or(std::ptr::null_mut(), |f| f as *mut c_void)
    }

    pub fn bind(handle: *mut c_void) -> Result<Api, String> {
        super::bind_with(|name| sym(handle, name))
    }
}

#[cfg(not(any(unix, windows)))]
mod sys {
    use super::{Api, c_void};
    pub fn open(_: &str) -> *mut c_void {
        std::ptr::null_mut()
    }
    pub fn already_loaded() -> *mut c_void {
        std::ptr::null_mut()
    }
    pub fn bind(_: *mut c_void) -> Result<Api, String> {
        Err("hosting libpython is not supported on this platform".into())
    }
}

fn library_candidates() -> Vec<String> {
    let mut names = Vec::new();
    for minor in (11..=14).rev() {
        #[cfg(windows)]
        names.push(format!("python3{minor}.dll"));
        #[cfg(target_os = "macos")]
        names.push(format!("libpython3.{minor}.dylib"));
        #[cfg(all(unix, not(target_os = "macos")))]
        {
            names.push(format!("libpython3.{minor}.so.1.0"));
            names.push(format!("libpython3.{minor}.so"));
        }
    }
    names
}

fn load_inner(path: Option<&str>) -> i32 {
    let mut slot = host();
    if slot.is_some() {
        return APHRODY_PY_OK;
    }
    if !cfg!(any(unix, windows)) {
        set_error("hosting libpython is not supported on this platform");
        return APHRODY_PY_ERR_UNSUPPORTED;
    }
    let env = std::env::var("APHRODY_LIBPYTHON").ok().filter(|v| !v.is_empty());
    let mut handle = std::ptr::null_mut();
    let mut tried = Vec::new();
    let explicit = path.filter(|p| !p.is_empty()).map(str::to_owned).or(env);
    if let Some(p) = explicit {
        handle = sys::open(&p);
        tried.push(p);
    }
    if handle.is_null() && tried.is_empty() {
        // The Bun fork (or the embedding host) may already have mapped it globally.
        handle = sys::already_loaded();
        if !handle.is_null() {
            tried.push("<already loaded>".into());
        }
    }
    if handle.is_null() && tried.is_empty() {
        for name in library_candidates() {
            handle = sys::open(&name);
            tried.push(name);
            if !handle.is_null() {
                break;
            }
        }
    }
    if handle.is_null() {
        set_error(format!("libpython not found (tried: {})", tried.join(", ")));
        return APHRODY_PY_ERR_LOAD;
    }
    match sys::bind(handle) {
        Ok(api) => {
            *slot =
                Some(Host { api, initialized: false, owned: false, saved: std::ptr::null_mut() });
            APHRODY_PY_OK
        },
        Err(e) => {
            set_error(e);
            APHRODY_PY_ERR_LOAD
        },
    }
}

/// Opens the shared libpython `RTLD_GLOBAL` and binds the C API. `path` may be null (then
/// `APHRODY_LIBPYTHON`, an already global libpython and versioned names are tried).
///
/// # Safety
/// `path` is null or a valid NUL-terminated string.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn aphrody_py_load(path: *const c_char) -> i32 {
    guard(APHRODY_PY_ERR_PANIC, || {
        let path = if path.is_null() {
            None
        } else {
            // SAFETY: caller contract.
            match unsafe { CStr::from_ptr(path) }.to_str() {
                Ok(p) => Some(p),
                Err(_) => {
                    set_error("path is not UTF-8");
                    return APHRODY_PY_ERR_ARG;
                },
            }
        };
        load_inner(path)
    })
}

/// Initialises the interpreter once, or attaches when the host already did. Returns 1 when this
/// call started the interpreter, 0 when it attached, a negative code on failure.
#[unsafe(no_mangle)]
pub extern "C" fn aphrody_py_init() -> i32 {
    guard(APHRODY_PY_ERR_PANIC, || {
        let mut slot = host();
        let Some(h) = slot.as_mut() else {
            set_error("libpython not loaded (call aphrody_py_load)");
            return APHRODY_PY_ERR_STATE;
        };
        if h.initialized {
            return 0;
        }
        // SAFETY: bound CPython entry points, called on the initialising thread.
        unsafe {
            if (h.api.is_initialized)() != 0 {
                h.initialized = true;
                return 0;
            }
            (h.api.initialize_ex)(0);
            // Release the GIL so every thread attaches through PyGILState_Ensure.
            h.saved = (h.api.save_thread)();
        }
        h.initialized = true;
        h.owned = true;
        1
    })
}

fn api_ready() -> Result<Api, i32> {
    match host().as_ref() {
        Some(h) if h.initialized => Ok(h.api),
        _ => {
            set_error("interpreter not initialised (call aphrody_py_init)");
            Err(APHRODY_PY_ERR_STATE)
        },
    }
}

/// Records and clears the pending Python exception. GIL held.
unsafe fn take_exception(api: &Api) {
    // SAFETY: GIL held by the caller; all objects are released.
    unsafe {
        let (mut t, mut v, mut tb) =
            (std::ptr::null_mut(), std::ptr::null_mut(), std::ptr::null_mut());
        (api.err_fetch)(&mut t, &mut v, &mut tb);
        let mut text = String::from("Python exception");
        let subject = if v.is_null() { t } else { v };
        if !subject.is_null() {
            let s = (api.object_str)(subject);
            if !s.is_null() {
                let p = (api.as_utf8)(s);
                if !p.is_null() {
                    text = CStr::from_ptr(p).to_string_lossy().into_owned();
                }
                (api.decref)(s);
            } else {
                (api.err_clear)();
            }
        }
        for o in [t, v, tb] {
            if !o.is_null() {
                (api.decref)(o);
            }
        }
        set_error(text);
    }
}

/// Converts `obj` with `str()` into an owned C string, consuming the reference.
unsafe fn object_to_owned(api: &Api, obj: PyObj, out: *mut *mut c_char) -> i32 {
    // SAFETY: GIL held; `obj` is a new reference.
    unsafe {
        if obj.is_null() {
            take_exception(api);
            return APHRODY_PY_ERR_PYTHON;
        }
        let s = (api.object_str)(obj);
        (api.decref)(obj);
        if s.is_null() {
            take_exception(api);
            return APHRODY_PY_ERR_PYTHON;
        }
        let p = (api.as_utf8)(s);
        let code = if p.is_null() {
            take_exception(api);
            APHRODY_PY_ERR_PYTHON
        } else {
            match CString::new(CStr::from_ptr(p).to_bytes()) {
                Ok(c) => {
                    if !out.is_null() {
                        *out = c.into_raw();
                    }
                    APHRODY_PY_OK
                },
                Err(_) => {
                    set_error("result contains NUL");
                    APHRODY_PY_ERR_PYTHON
                },
            }
        };
        (api.decref)(s);
        code
    }
}

fn with_gil(body: impl FnOnce(&Api) -> i32) -> i32 {
    guard(APHRODY_PY_ERR_PANIC, || match api_ready() {
        Err(code) => code,
        Ok(api) => {
            // SAFETY: bound entry points; the GIL is held between ensure and release.
            let state = unsafe { (api.gil_ensure)() };
            let code = catch_unwind(AssertUnwindSafe(|| body(&api))).unwrap_or_else(|_| {
                set_error("panic caught at the FFI boundary");
                APHRODY_PY_ERR_PANIC
            });
            // SAFETY: matches the ensure above.
            unsafe { (api.gil_release)(state) };
            code
        },
    })
}

unsafe fn cstr_arg<'a>(p: *const c_char) -> Option<&'a CStr> {
    // SAFETY: caller contract (null or NUL-terminated).
    if p.is_null() { None } else { Some(unsafe { CStr::from_ptr(p) }) }
}

/// Runs statements in `__main__`. Returns 0 or a negative code.
///
/// # Safety
/// `code` is a valid NUL-terminated string.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn aphrody_py_run(code: *const c_char) -> i32 {
    // SAFETY: caller contract.
    let Some(code) = (unsafe { cstr_arg(code) }) else {
        set_error("code is null");
        return APHRODY_PY_ERR_ARG;
    };
    with_gil(|api| {
        // SAFETY: GIL held.
        if unsafe { (api.run_simple)(code.as_ptr()) } == 0 {
            APHRODY_PY_OK
        } else {
            set_error("statement raised (traceback printed by the interpreter)");
            APHRODY_PY_ERR_PYTHON
        }
    })
}

/// Evaluates an expression in `__main__` and stores `str(result)` in `*out` (owned; release
/// with [`aphrody_py_string_free`]).
///
/// # Safety
/// `expr` is a valid NUL-terminated string; `out` is a valid pointer or null.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn aphrody_py_eval(expr: *const c_char, out: *mut *mut c_char) -> i32 {
    // SAFETY: caller contract.
    let Some(expr) = (unsafe { cstr_arg(expr) }) else {
        set_error("expression is null");
        return APHRODY_PY_ERR_ARG;
    };
    with_gil(|api| {
        // SAFETY: GIL held.
        unsafe {
            let main = (api.add_module)(c"__main__".as_ptr());
            if main.is_null() {
                take_exception(api);
                return APHRODY_PY_ERR_PYTHON;
            }
            let dict = (api.module_dict)(main);
            let result = (api.run_string)(expr.as_ptr(), PY_EVAL_INPUT, dict, dict);
            object_to_owned(api, result, out)
        }
    })
}

/// Imports `module`, calls `function` with `arg` as its single string argument (no argument
/// when `arg` is null) and stores `str(result)` in `*out` (owned).
///
/// # Safety
/// `module` and `function` are valid NUL-terminated strings; `arg` is null or valid; `out` is
/// a valid pointer or null.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn aphrody_py_call(
    module: *const c_char,
    function: *const c_char,
    arg: *const c_char,
    out: *mut *mut c_char,
) -> i32 {
    // SAFETY: caller contract.
    let (Some(module), Some(function)) =
        (unsafe { cstr_arg(module) }, unsafe { cstr_arg(function) })
    else {
        set_error("module or function is null");
        return APHRODY_PY_ERR_ARG;
    };
    // SAFETY: caller contract.
    let arg = unsafe { cstr_arg(arg) };
    with_gil(|api| {
        // SAFETY: GIL held; every new reference is released on all paths.
        unsafe {
            let m = (api.import_module)(module.as_ptr());
            if m.is_null() {
                take_exception(api);
                return APHRODY_PY_ERR_PYTHON;
            }
            let f = (api.get_attr)(m, function.as_ptr());
            (api.decref)(m);
            if f.is_null() {
                take_exception(api);
                return APHRODY_PY_ERR_PYTHON;
            }
            let count = isize::from(arg.is_some());
            let args = (api.tuple_new)(count);
            if args.is_null() {
                (api.decref)(f);
                take_exception(api);
                return APHRODY_PY_ERR_PYTHON;
            }
            if let Some(a) = arg {
                let s = (api.unicode_from)(a.as_ptr());
                if s.is_null() {
                    (api.decref)(args);
                    (api.decref)(f);
                    take_exception(api);
                    return APHRODY_PY_ERR_PYTHON;
                }
                (api.tuple_set)(args, 0, s); // steals `s`
            }
            let result = (api.call_object)(f, args);
            (api.decref)(args);
            (api.decref)(f);
            object_to_owned(api, result, out)
        }
    })
}

/// Stores the interpreter version string in `*out` (owned).
///
/// # Safety
/// `out` is a valid pointer.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn aphrody_py_version(out: *mut *mut c_char) -> i32 {
    guard(APHRODY_PY_ERR_PANIC, || {
        if out.is_null() {
            return APHRODY_PY_ERR_ARG;
        }
        let slot = host();
        let Some(h) = slot.as_ref() else {
            set_error("libpython not loaded");
            return APHRODY_PY_ERR_STATE;
        };
        // SAFETY: Py_GetVersion needs no GIL and returns a static string.
        let text = unsafe { CStr::from_ptr((h.api.get_version)()) }.to_owned();
        // SAFETY: caller contract.
        unsafe { *out = text.into_raw() };
        APHRODY_PY_OK
    })
}

/// Finalises the interpreter when this crate started it; a no-op (0) when it only attached.
#[unsafe(no_mangle)]
pub extern "C" fn aphrody_py_finalize() -> i32 {
    guard(APHRODY_PY_ERR_PANIC, || {
        let mut slot = host();
        let Some(h) = slot.as_mut() else { return APHRODY_PY_OK };
        if !h.owned || !h.initialized {
            return APHRODY_PY_OK;
        }
        // SAFETY: re-acquire the thread state saved at init, then finalise.
        let code = unsafe {
            (h.api.restore_thread)(h.saved);
            (h.api.finalize_ex)()
        };
        h.saved = std::ptr::null_mut();
        h.initialized = false;
        h.owned = false;
        if code == 0 { APHRODY_PY_OK } else { APHRODY_PY_ERR_PYTHON }
    })
}

/// Copies the last error message into an owned string (release with
/// [`aphrody_py_string_free`]); empty when none.
#[unsafe(no_mangle)]
pub extern "C" fn aphrody_py_last_error() -> *mut c_char {
    guard(std::ptr::null_mut(), || {
        let text = LAST_ERROR.lock().map(|s| s.clone()).unwrap_or_default();
        CString::new(text.replace('\0', " ")).map_or(std::ptr::null_mut(), CString::into_raw)
    })
}

/// Releases a string returned by this crate. Null is a no-op.
///
/// # Safety
/// `s` comes from this crate and is not used afterwards.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn aphrody_py_string_free(s: *mut c_char) {
    if !s.is_null() {
        // SAFETY: caller contract; allocated by CString::into_raw in this crate.
        drop(unsafe { CString::from_raw(s) });
    }
}
