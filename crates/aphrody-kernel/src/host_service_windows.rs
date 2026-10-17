// SPDX-License-Identifier: Apache-2.0
//! Native SCM entry point; no service wrapper or managed runtime.

use super::Config;
use std::{
    ffi::c_void,
    io,
    sync::{
        OnceLock,
        atomic::{AtomicUsize, Ordering},
    },
    time::Duration,
};
use windows_sys::Win32::System::Services::*;

static CONFIG: OnceLock<Config> = OnceLock::new();
static HANDLE: AtomicUsize = AtomicUsize::new(0);
static STOP: tokio::sync::Notify = tokio::sync::Notify::const_new();

fn status(state: u32, exit_code: u32) {
    let handle = HANDLE.load(Ordering::Acquire) as SERVICE_STATUS_HANDLE;
    if handle.is_null() {
        return;
    }
    let status = SERVICE_STATUS {
        dwServiceType: SERVICE_WIN32_OWN_PROCESS,
        dwCurrentState: state,
        dwControlsAccepted: if state == SERVICE_RUNNING {
            SERVICE_ACCEPT_STOP | SERVICE_ACCEPT_SHUTDOWN
        } else {
            0
        },
        dwWin32ExitCode: exit_code,
        dwServiceSpecificExitCode: 0,
        dwCheckPoint: u32::from(state == SERVICE_START_PENDING || state == SERVICE_STOP_PENDING),
        dwWaitHint: if state == SERVICE_START_PENDING || state == SERVICE_STOP_PENDING {
            10_000
        } else {
            0
        },
    };
    // SAFETY: SCM issued this handle; status has the native SERVICE_STATUS ABI.
    unsafe {
        SetServiceStatus(handle, &status);
    }
}

pub(super) fn ready() {
    status(SERVICE_RUNNING, 0);
}

unsafe extern "system" fn control(
    code: u32,
    _event: u32,
    _data: *mut c_void,
    _context: *mut c_void,
) -> u32 {
    match code {
        SERVICE_CONTROL_STOP | SERVICE_CONTROL_SHUTDOWN => {
            status(SERVICE_STOP_PENDING, 0);
            STOP.notify_one();
            0
        }
        SERVICE_CONTROL_INTERROGATE => 0,
        _ => 120,
    }
}

unsafe extern "system" fn service_main(_count: u32, _args: *mut *mut u16) {
    let name: Vec<_> = "AphrodyHost".encode_utf16().chain(Some(0)).collect();
    // SAFETY: the callback remains valid for the service lifetime; no context pointer.
    let handle =
        unsafe { RegisterServiceCtrlHandlerExW(name.as_ptr(), Some(control), std::ptr::null()) };
    if handle.is_null() {
        return;
    }
    HANDLE.store(handle as usize, Ordering::Release);
    status(SERVICE_START_PENDING, 0);
    let outcome = std::panic::catch_unwind(|| {
        let config = CONFIG.get().expect("SCM config initialized").clone();
        let runtime = tokio::runtime::Builder::new_multi_thread()
            .enable_all()
            .build()?;
        let result = runtime.block_on(async {
            tokio::select! {
                result = super::run(config.clone()) => result,
                () = STOP.notified() => Ok(()),
            }
        });
        if let Err(error) = &result {
            super::log(&config, &format!("service failed: {error}"));
        }
        runtime.shutdown_timeout(Duration::from_secs(5));
        result.map_err(|error| io::Error::other(error.to_string()))
    });
    let exit_code = if matches!(outcome, Ok(Ok(()))) { 0 } else { 1 };
    status(SERVICE_STOPPED, exit_code);
    HANDLE.store(0, Ordering::Release);
}

pub(super) fn dispatch(config: Config) -> io::Result<()> {
    CONFIG
        .set(config)
        .map_err(|_| io::Error::other("SCM dispatcher already initialized"))?;
    let mut name: Vec<_> = "AphrodyHost".encode_utf16().chain(Some(0)).collect();
    let entries = [
        SERVICE_TABLE_ENTRYW {
            lpServiceName: name.as_mut_ptr(),
            lpServiceProc: Some(service_main),
        },
        SERVICE_TABLE_ENTRYW {
            lpServiceName: std::ptr::null_mut(),
            lpServiceProc: None,
        },
    ];
    // SAFETY: the terminated table and name buffers live until dispatch returns.
    if unsafe { StartServiceCtrlDispatcherW(entries.as_ptr()) } == 0 {
        return Err(io::Error::last_os_error());
    }
    Ok(())
}
