// SPDX-License-Identifier: Apache-2.0
//! Integration test against the build host's real libpython (skipped, with the reason printed,
//! when none is installed).

use aphrody_ffi::*;
use std::ffi::{CStr, CString, c_char};

fn take(p: *mut c_char) -> String {
    assert!(!p.is_null());
    // SAFETY: owned string from the crate.
    let s = unsafe { CStr::from_ptr(p) }.to_string_lossy().into_owned();
    // SAFETY: released once.
    unsafe { aphrody_py_string_free(p) };
    s
}

fn find() -> Option<String> {
    if let Ok(p) = std::env::var("APHRODY_LIBPYTHON") {
        return Some(p);
    }
    let out = std::process::Command::new("python3")
        .args(["-c", "import sysconfig,os;d=sysconfig.get_config_var('LIBDIR') or '';n=sysconfig.get_config_var('LDLIBRARY') or '';p=os.path.join(d,n);print(p if os.path.exists(p) else '')"])
        .output()
        .ok()?;
    let p = String::from_utf8(out.stdout).ok()?.trim().to_owned();
    (!p.is_empty() && (p.ends_with(".so") || p.ends_with(".dylib"))).then_some(p)
}

#[test]
fn load_missing_reports_error() {
    let bad = CString::new("/nonexistent/libpython-none.so").unwrap();
    // SAFETY: valid C string.
    assert_eq!(unsafe { aphrody_py_load(bad.as_ptr()) }, APHRODY_PY_ERR_LOAD);
    assert!(take(aphrody_py_last_error()).contains("libpython"));
    // Not initialised: state error rather than a crash.
    let code = CString::new("1").unwrap();
    // SAFETY: valid C string.
    assert_eq!(unsafe { aphrody_py_run(code.as_ptr()) }, APHRODY_PY_ERR_STATE);
}

#[test]
fn host_runs_code_and_calls_module() {
    let Some(lib) = find() else {
        eprintln!("SKIPPED: no shared libpython found on the build host (set APHRODY_LIBPYTHON)");
        return;
    };
    let lib = CString::new(lib).unwrap();
    // SAFETY: valid C string.
    assert_eq!(unsafe { aphrody_py_load(lib.as_ptr()) }, APHRODY_PY_OK);
    assert_eq!(aphrody_py_init(), 1);
    assert_eq!(aphrody_py_init(), 0);

    let mut out = std::ptr::null_mut();
    // SAFETY: valid pointer.
    assert_eq!(unsafe { aphrody_py_version(&mut out) }, APHRODY_PY_OK);
    assert!(take(out).starts_with('3'));

    let run = CString::new("import math\nvalue = 6 * 7").unwrap();
    // SAFETY: valid C string.
    assert_eq!(unsafe { aphrody_py_run(run.as_ptr()) }, APHRODY_PY_OK);
    let expr = CString::new("value").unwrap();
    // SAFETY: valid pointers.
    assert_eq!(unsafe { aphrody_py_eval(expr.as_ptr(), &mut out) }, APHRODY_PY_OK);
    assert_eq!(take(out), "42");

    let (m, f, a) = (c"os.path", c"basename", c"/a/b/file.txt");
    // SAFETY: valid pointers.
    assert_eq!(
        unsafe { aphrody_py_call(m.as_ptr(), f.as_ptr(), a.as_ptr(), &mut out) },
        APHRODY_PY_OK
    );
    assert_eq!(take(out), "file.txt");

    // Calls from another thread attach through the GIL state API.
    std::thread::spawn(|| {
        let mut o = std::ptr::null_mut();
        let e = CString::new("'ab' * 2").unwrap();
        // SAFETY: valid pointers.
        assert_eq!(unsafe { aphrody_py_eval(e.as_ptr(), &mut o) }, APHRODY_PY_OK);
        assert_eq!(take(o), "abab");
    })
    .join()
    .unwrap();

    let bad = CString::new("1/0").unwrap();
    // SAFETY: valid pointers.
    assert_eq!(unsafe { aphrody_py_eval(bad.as_ptr(), &mut out) }, APHRODY_PY_ERR_PYTHON);
    assert!(take(aphrody_py_last_error()).contains("division"));

    assert_eq!(aphrody_py_finalize(), APHRODY_PY_OK);
}
