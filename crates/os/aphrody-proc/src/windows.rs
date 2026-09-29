// SPDX-License-Identifier: Apache-2.0
//! Windows backend: a Job Object per owned child.
//!
//! A job created with `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` terminates every
//! process assigned to it when its last handle closes. The owner holds that
//! only handle, so the tree dies on [`Group::kill`], on drop, and also when the
//! owning process is terminated without unwinding — the OS closes the handle.

use std::{
    io,
    os::windows::{io::AsRawHandle as _, process::CommandExt as _},
    process::{Child, Command},
};

use windows::Win32::{
    Foundation::{CloseHandle, HANDLE, STILL_ACTIVE},
    System::{
        JobObjects::{
            AssignProcessToJobObject, CreateJobObjectW, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
            JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JobObjectExtendedLimitInformation,
            SetInformationJobObject, TerminateJobObject,
        },
        Threading::{
            CREATE_BREAKAWAY_FROM_JOB, CREATE_NEW_PROCESS_GROUP, CREATE_NO_WINDOW,
            GetExitCodeProcess, OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION, PROCESS_TERMINATE,
            TerminateProcess,
        },
    },
};

use crate::group::SpawnOptions;

/// Exit code reported for processes killed through their job.
const KILLED_EXIT_CODE: u32 = 1;

fn os_error(error: windows::core::Error) -> io::Error {
    io::Error::other(error)
}

/// An owned child gets its own console process group, so a Ctrl+C aimed at the
/// owner's console does not reach it behind the supervisor's back.
pub(crate) fn configure_owned(command: &mut Command, options: SpawnOptions) {
    let hidden = if options.hide_window { CREATE_NO_WINDOW.0 } else { 0 };
    command.creation_flags(CREATE_NEW_PROCESS_GROUP.0 | hidden);
}

/// Start `command` as a daemon: no console window, its own process group, and
/// outside the parent's job so that closing the parent's job does not take it
/// down. A parent whose job forbids breakaway refuses that flag with access
/// denied; the daemon is then started inside the job, which is the most the OS
/// allows.
pub(crate) fn spawn_detached(command: &mut Command) -> io::Result<Child> {
    let base = CREATE_NEW_PROCESS_GROUP.0 | CREATE_NO_WINDOW.0;
    command.creation_flags(base | CREATE_BREAKAWAY_FROM_JOB.0);
    match command.spawn() {
        Err(error) if error.kind() == io::ErrorKind::PermissionDenied => {
            command.creation_flags(base);
            command.spawn()
        },
        result => result,
    }
}

/// Let go of a daemon: closing our handle leaves the process running, and
/// Windows keeps no zombie for an exited process nobody holds a handle to.
pub(crate) fn release_detached(child: Child) {
    drop(child);
}

/// The Job Object holding an owned child and everything it spawns.
#[derive(Debug)]
pub(crate) struct Group {
    job: HANDLE,
}

// SAFETY: a job handle is a process-wide kernel object reference; the Win32 job
// functions used here are thread-safe, and `Group` exposes no interior aliasing.
unsafe impl Send for Group {}
// SAFETY: see `Send`.
unsafe impl Sync for Group {}

impl Group {
    /// Create a kill-on-close job and assign `child` to it.
    ///
    /// The child runs for an instant before the assignment; a grandchild
    /// started in that window would escape the job. The programs supervised
    /// here (llama-server, a Python worker, a sandboxed command) start no
    /// process that early, and `std::process` offers no suspended spawn to
    /// close the window entirely.
    pub(crate) fn adopt(child: &Child) -> io::Result<Self> {
        // SAFETY: no security attributes, anonymous job; the returned handle is
        // owned by `Group` and closed exactly once in `Drop`.
        let job =
            unsafe { CreateJobObjectW(None, windows::core::PCWSTR::null()) }.map_err(os_error)?;
        let group = Self { job };

        let mut limits = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
        limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        let size = u32::try_from(size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>())
            .map_err(|_| io::Error::other("job limit structure too large"))?;
        // SAFETY: `limits` is a live, correctly-sized structure of the class
        // announced by `JobObjectExtendedLimitInformation`.
        unsafe {
            SetInformationJobObject(
                group.job,
                JobObjectExtendedLimitInformation,
                (&raw const limits).cast(),
                size,
            )
        }
        .map_err(os_error)?;

        // SAFETY: the child's handle is valid for as long as `child` lives,
        // which outlasts this call.
        unsafe { AssignProcessToJobObject(group.job, HANDLE(child.as_raw_handle())) }
            .map_err(os_error)?;
        Ok(group)
    }

    /// Terminate every process of the job.
    pub(crate) fn kill(&self, leader: &mut Child) -> io::Result<()> {
        // SAFETY: `self.job` is the live handle created in `adopt`.
        let terminated = unsafe { TerminateJobObject(self.job, KILLED_EXIT_CODE) };
        match terminated {
            Ok(()) => Ok(()),
            // The leader may have exited on its own with nothing left in the job.
            Err(_) if leader.try_wait()?.is_some() => Ok(()),
            Err(error) => Err(os_error(error)),
        }
    }
}

impl Drop for Group {
    fn drop(&mut self) {
        // SAFETY: closes the handle created in `adopt`, once. With
        // KILL_ON_JOB_CLOSE this also ends any process still in the job.
        if let Err(error) = unsafe { CloseHandle(self.job) } {
            tracing::warn!(%error, "failed to close job object handle");
        }
    }
}

/// `TerminateProcess` one process; a pid that cannot be opened because it no
/// longer exists is success.
pub(crate) fn terminate_process(pid: u32) -> io::Result<()> {
    if !process_alive(pid) {
        return Ok(());
    }
    // SAFETY: plain Win32 calls on a handle opened and closed right here.
    unsafe {
        let process = OpenProcess(PROCESS_TERMINATE, false, pid).map_err(os_error)?;
        let terminated = TerminateProcess(process, KILLED_EXIT_CODE);
        let _ = CloseHandle(process);
        terminated.map_err(os_error)
    }
}

/// Whether a process with this pid exists and has not exited.
pub(crate) fn process_alive(pid: u32) -> bool {
    // SAFETY: plain Win32 calls on a handle opened and closed right here.
    unsafe {
        let Ok(process) = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) else {
            return false;
        };
        let mut code = 0u32;
        let queried = GetExitCodeProcess(process, &raw mut code);
        let _ = CloseHandle(process);
        // STILL_ACTIVE is an NTSTATUS (0x103); exit codes are the same bits as u32.
        queried.is_ok() && code == STILL_ACTIVE.0 as u32
    }
}
