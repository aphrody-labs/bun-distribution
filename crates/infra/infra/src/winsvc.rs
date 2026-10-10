// SPDX-License-Identifier: Apache-2.0
//! Windows services through the Service Control Manager (no PowerShell, no `sc.exe`).

/// Start type, state and failure policy of an installed service.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ServiceState {
    /// `Boot`, `System`, `Auto`, `Manual` or `Disabled` (the `Win32_Service.StartMode` names).
    pub start_mode: String,
    /// `Stopped`, `StartPending`, `StopPending`, `Running`, `ContinuePending`, `PausePending`,
    /// `Paused` or `Unknown`.
    pub state: String,
    /// At least one failure action restarts the service.
    pub failure_restart: bool,
}

/// Failure actions written by [`ensure`]: restart after 5 s, 5 s, then 60 s; counter reset daily.
pub const FAILURE_RESET_SECONDS: u32 = 86_400;
pub const FAILURE_RESTART_DELAYS_MS: [u32; 3] = [5_000, 5_000, 60_000];

#[must_use]
pub const fn start_mode_label(start_type: u32) -> &'static str {
    match start_type {
        0 => "Boot",
        1 => "System",
        2 => "Auto",
        3 => "Manual",
        4 => "Disabled",
        _ => "Unknown",
    }
}

#[must_use]
pub const fn state_label(state: u32) -> &'static str {
    match state {
        1 => "Stopped",
        2 => "StartPending",
        3 => "StopPending",
        4 => "Running",
        5 => "ContinuePending",
        6 => "PausePending",
        7 => "Paused",
        _ => "Unknown",
    }
}

#[cfg(windows)]
mod scm {
    use super::{
        FAILURE_RESET_SECONDS, FAILURE_RESTART_DELAYS_MS, ServiceState, start_mode_label,
        state_label,
    };
    use anyhow::{Result, bail};
    use std::io;
    use windows_sys::Win32::Foundation::{
        ERROR_INSUFFICIENT_BUFFER, ERROR_SERVICE_ALREADY_RUNNING, ERROR_SERVICE_DOES_NOT_EXIST,
    };
    use windows_sys::Win32::System::Services::{
        ChangeServiceConfig2W, ChangeServiceConfigW, CloseServiceHandle, ControlService,
        OpenSCManagerW, OpenServiceW, QUERY_SERVICE_CONFIGW, QueryServiceConfig2W,
        QueryServiceConfigW, QueryServiceStatusEx, SC_ACTION, SC_ACTION_RESTART, SC_HANDLE,
        SC_MANAGER_CONNECT, SC_STATUS_PROCESS_INFO, SERVICE_AUTO_START, SERVICE_CHANGE_CONFIG,
        SERVICE_CONFIG_FAILURE_ACTIONS, SERVICE_CONTROL_STOP, SERVICE_FAILURE_ACTIONSW,
        SERVICE_NO_CHANGE, SERVICE_QUERY_CONFIG, SERVICE_QUERY_STATUS, SERVICE_RUNNING,
        SERVICE_START, SERVICE_STATUS, SERVICE_STATUS_PROCESS, SERVICE_STOP, SERVICE_STOPPED,
        StartServiceW,
    };

    struct Handle(SC_HANDLE);

    impl Drop for Handle {
        fn drop(&mut self) {
            // SAFETY: the handle was returned by OpenSCManagerW/OpenServiceW and is closed once.
            unsafe { CloseServiceHandle(self.0) };
        }
    }

    fn wide(text: &str) -> Vec<u16> {
        text.encode_utf16().chain(std::iter::once(0)).collect()
    }

    /// Opens `name`; `None` when the service is not installed.
    fn open(name: &str, access: u32) -> Result<Option<(Handle, Handle)>> {
        // SAFETY: null machine and database names select the local active database.
        let manager =
            unsafe { OpenSCManagerW(std::ptr::null(), std::ptr::null(), SC_MANAGER_CONNECT) };
        if manager.is_null() {
            bail!("OpenSCManagerW: {}", io::Error::last_os_error());
        }
        let manager = Handle(manager);
        let wide_name = wide(name);
        // SAFETY: `manager` is open and `wide_name` is NUL-terminated.
        let service = unsafe { OpenServiceW(manager.0, wide_name.as_ptr(), access) };
        if service.is_null() {
            let error = io::Error::last_os_error();
            if error.raw_os_error() == Some(ERROR_SERVICE_DOES_NOT_EXIST as i32) {
                return Ok(None);
            }
            bail!("OpenServiceW({name}): {error}");
        }
        Ok(Some((manager, Handle(service))))
    }

    /// Calls a sized query twice: once for the size, once into a buffer of that size.
    fn sized(mut query: impl FnMut(*mut u8, u32, *mut u32) -> i32, what: &str) -> Result<Vec<u64>> {
        let mut needed = 0u32;
        if query(std::ptr::null_mut(), 0, &raw mut needed) == 0 {
            let error = io::Error::last_os_error();
            if error.raw_os_error() != Some(ERROR_INSUFFICIENT_BUFFER as i32) {
                bail!("{what}: {error}");
            }
        }
        // u64 storage keeps the pointer-bearing structures aligned.
        let mut buffer = vec![0u64; (needed as usize).div_ceil(8).max(1)];
        let size = u32::try_from(buffer.len() * 8).unwrap_or(u32::MAX);
        if query(buffer.as_mut_ptr().cast(), size, &raw mut needed) == 0 {
            bail!("{what}: {}", io::Error::last_os_error());
        }
        Ok(buffer)
    }

    fn read(service: SC_HANDLE, name: &str) -> Result<ServiceState> {
        let config = sized(
            // SAFETY: the buffer pointer and size describe a live allocation (or are null/0).
            |buffer, size, needed| unsafe {
                QueryServiceConfigW(service, buffer.cast(), size, needed)
            },
            &format!("QueryServiceConfigW({name})"),
        )?;
        // SAFETY: the SCM filled the buffer with a QUERY_SERVICE_CONFIGW header.
        let start_type = unsafe { (*config.as_ptr().cast::<QUERY_SERVICE_CONFIGW>()).dwStartType };
        let mut status = SERVICE_STATUS_PROCESS::default();
        let mut needed = 0u32;
        // SAFETY: `status` is a SERVICE_STATUS_PROCESS of the size passed.
        let ok = unsafe {
            QueryServiceStatusEx(
                service,
                SC_STATUS_PROCESS_INFO,
                (&raw mut status).cast(),
                u32::try_from(size_of::<SERVICE_STATUS_PROCESS>()).unwrap_or(u32::MAX),
                &raw mut needed,
            )
        };
        if ok == 0 {
            bail!("QueryServiceStatusEx({name}): {}", io::Error::last_os_error());
        }
        let failure = sized(
            // SAFETY: the buffer pointer and size describe a live allocation (or are null/0).
            |buffer, size, needed| unsafe {
                QueryServiceConfig2W(service, SERVICE_CONFIG_FAILURE_ACTIONS, buffer, size, needed)
            },
            &format!("QueryServiceConfig2W({name})"),
        )?;
        // SAFETY: the SCM filled the buffer with a SERVICE_FAILURE_ACTIONSW whose action array, when
        // present, lives inside the same buffer.
        let failure_restart = unsafe {
            let actions = &*failure.as_ptr().cast::<SERVICE_FAILURE_ACTIONSW>();
            !actions.lpsaActions.is_null()
                && std::slice::from_raw_parts(actions.lpsaActions, actions.cActions as usize)
                    .iter()
                    .any(|a| a.Type == SC_ACTION_RESTART)
        };
        Ok(ServiceState {
            start_mode: start_mode_label(start_type).to_owned(),
            state: state_label(status.dwCurrentState).to_owned(),
            failure_restart,
        })
    }

    /// Reads a service; `None` when it is not installed.
    pub fn query(name: &str) -> Result<Option<ServiceState>> {
        match open(name, SERVICE_QUERY_CONFIG | SERVICE_QUERY_STATUS)? {
            Some((_manager, service)) => read(service.0, name).map(Some),
            None => Ok(None),
        }
    }

    /// The installed service's executable command, for capability owners resolving its real config.
    /// This value is never logged by the SCM owner.
    pub fn image_command(name: &str) -> Result<Option<String>> {
        let Some((_manager, service)) = open(name, SERVICE_QUERY_CONFIG)? else {
            return Ok(None);
        };
        let config = sized(
            // SAFETY: sized supplies a live, aligned buffer of the declared size.
            |buffer, size, needed| unsafe {
                QueryServiceConfigW(service.0, buffer.cast(), size, needed)
            },
            &format!("QueryServiceConfigW({name})"),
        )?;
        // SAFETY: the SCM returned a pointer to a NUL-terminated string inside config.
        let command = unsafe {
            let pointer = (*config.as_ptr().cast::<QUERY_SERVICE_CONFIGW>()).lpBinaryPathName;
            if pointer.is_null() {
                bail!("service {name}: commande absente");
            }
            let mut length = 0;
            while *pointer.add(length) != 0 {
                length += 1;
            }
            String::from_utf16(std::slice::from_raw_parts(pointer, length))?
        };
        Ok(Some(command))
    }

    fn wait_state(service: SC_HANDLE, name: &str, wanted: u32) -> Result<()> {
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(30);
        loop {
            let mut status = SERVICE_STATUS_PROCESS::default();
            let mut needed = 0;
            // SAFETY: status is a live buffer of the declared SERVICE_STATUS_PROCESS size.
            let ok = unsafe {
                QueryServiceStatusEx(
                    service,
                    SC_STATUS_PROCESS_INFO,
                    (&raw mut status).cast(),
                    u32::try_from(size_of::<SERVICE_STATUS_PROCESS>()).unwrap_or(u32::MAX),
                    &raw mut needed,
                )
            };
            if ok == 0 {
                bail!("QueryServiceStatusEx({name}): {}", io::Error::last_os_error());
            }
            if status.dwCurrentState == wanted {
                return Ok(());
            }
            if std::time::Instant::now() >= deadline {
                bail!("service {name}: délai de transition dépassé");
            }
            std::thread::sleep(std::time::Duration::from_millis(100));
        }
    }

    /// Reloads an installed service and waits for its listener process to reach Running.
    pub fn restart(name: &str) -> Result<()> {
        let access = SERVICE_QUERY_CONFIG | SERVICE_QUERY_STATUS | SERVICE_STOP | SERVICE_START;
        let Some((_manager, service)) = open(name, access)? else {
            bail!("service {name} absent");
        };
        let before = read(service.0, name)?;
        if matches!(before.state.as_str(), "StartPending" | "ContinuePending") {
            // ensure() may just have started this service; a pending service cannot accept Stop yet.
            wait_state(service.0, name, SERVICE_RUNNING)?;
        }
        if before.state != "Stopped" {
            if before.state != "StopPending" {
                let mut status = SERVICE_STATUS::default();
                // SAFETY: service has SERVICE_STOP access and status is a live output buffer.
                if unsafe { ControlService(service.0, SERVICE_CONTROL_STOP, &raw mut status) } == 0
                {
                    bail!("ControlService({name}): {}", io::Error::last_os_error());
                }
            }
            wait_state(service.0, name, SERVICE_STOPPED)?;
        }
        // SAFETY: no additional service arguments; the installed command remains unchanged.
        if unsafe { StartServiceW(service.0, 0, std::ptr::null()) } == 0 {
            let error = io::Error::last_os_error();
            if error.raw_os_error() != Some(ERROR_SERVICE_ALREADY_RUNNING as i32) {
                bail!("StartServiceW({name}): {error}");
            }
        }
        wait_state(service.0, name, SERVICE_RUNNING)
    }

    /// Start type Automatic, restart failure actions when asked, then started. Returns the changes.
    pub fn ensure(name: &str, restart_on_failure: bool) -> Result<Vec<String>> {
        let access =
            SERVICE_QUERY_CONFIG | SERVICE_QUERY_STATUS | SERVICE_CHANGE_CONFIG | SERVICE_START;
        let Some((_manager, service)) = open(name, access)? else {
            bail!("service {name} absent");
        };
        let before = read(service.0, name)?;
        let mut done = Vec::new();
        if before.start_mode != "Auto" {
            // SAFETY: SERVICE_NO_CHANGE everywhere except the start type; null strings keep values.
            let ok = unsafe {
                ChangeServiceConfigW(
                    service.0,
                    SERVICE_NO_CHANGE,
                    SERVICE_AUTO_START,
                    SERVICE_NO_CHANGE,
                    std::ptr::null(),
                    std::ptr::null(),
                    std::ptr::null_mut(),
                    std::ptr::null(),
                    std::ptr::null(),
                    std::ptr::null(),
                    std::ptr::null(),
                )
            };
            if ok == 0 {
                bail!("ChangeServiceConfigW({name}): {}", io::Error::last_os_error());
            }
            done.push(format!("démarrage {} -> Auto", before.start_mode));
        }
        if restart_on_failure && !before.failure_restart {
            let mut actions = FAILURE_RESTART_DELAYS_MS
                .map(|delay| SC_ACTION { Type: SC_ACTION_RESTART, Delay: delay });
            let info = SERVICE_FAILURE_ACTIONSW {
                dwResetPeriod: FAILURE_RESET_SECONDS,
                lpRebootMsg: std::ptr::null_mut(),
                lpCommand: std::ptr::null_mut(),
                cActions: u32::try_from(actions.len()).unwrap_or(0),
                lpsaActions: actions.as_mut_ptr(),
            };
            // SAFETY: `info` and its action array outlive the call; the handle has SERVICE_START.
            let ok = unsafe {
                ChangeServiceConfig2W(
                    service.0,
                    SERVICE_CONFIG_FAILURE_ACTIONS,
                    (&raw const info).cast(),
                )
            };
            if ok == 0 {
                bail!("ChangeServiceConfig2W({name}): {}", io::Error::last_os_error());
            }
            done.push("actions d'échec: redémarrage 5 s/5 s/60 s".to_owned());
        }
        if before.state != "Running" {
            // SAFETY: no service arguments.
            let ok = unsafe { StartServiceW(service.0, 0, std::ptr::null()) };
            if ok == 0 {
                let error = io::Error::last_os_error();
                if error.raw_os_error() != Some(ERROR_SERVICE_ALREADY_RUNNING as i32) {
                    bail!("StartServiceW({name}): {error}");
                }
            }
            done.push(format!("démarré (était {})", before.state));
        }
        Ok(done)
    }
}

#[cfg(windows)]
pub use scm::{ensure, image_command, query, restart};

/// # Errors
/// Always: the Service Control Manager exists only on Windows.
#[cfg(not(windows))]
pub fn image_command(_name: &str) -> anyhow::Result<Option<String>> {
    anyhow::bail!("le gestionnaire de services n'existe que sous Windows")
}

/// # Errors
/// Always: the Service Control Manager exists only on Windows.
#[cfg(not(windows))]
pub fn restart(_name: &str) -> anyhow::Result<()> {
    anyhow::bail!("le gestionnaire de services n'existe que sous Windows")
}

/// # Errors
/// Always: the Service Control Manager exists only on Windows.
#[cfg(not(windows))]
pub fn query(_name: &str) -> anyhow::Result<Option<ServiceState>> {
    anyhow::bail!("le gestionnaire de services n'existe que sous Windows")
}

/// # Errors
/// Always: the Service Control Manager exists only on Windows.
#[cfg(not(windows))]
pub fn ensure(_name: &str, _restart_on_failure: bool) -> anyhow::Result<Vec<String>> {
    anyhow::bail!("le gestionnaire de services n'existe que sous Windows")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn labels_follow_win32_service_names() {
        assert_eq!(start_mode_label(2), "Auto");
        assert_eq!(start_mode_label(3), "Manual");
        assert_eq!(state_label(4), "Running");
        assert_eq!(state_label(1), "Stopped");
    }

    /// Read-only: the RPC endpoint mapper exists on every Windows install.
    #[cfg(windows)]
    #[test]
    fn reads_a_system_service_and_reports_absent_ones() {
        let rpc = query("RpcSs").unwrap().unwrap();
        assert_eq!(rpc.state, "Running");
        assert_eq!(rpc.start_mode, "Auto");
        assert!(query("AphrodyNoSuchService0").unwrap().is_none());
    }
}
