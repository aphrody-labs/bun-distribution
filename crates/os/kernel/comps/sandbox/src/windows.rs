// SPDX-License-Identifier: Apache-2.0
//! Windows sandbox backend: Job Object confinement, Low-IL token configuration, and ACL helpers.

use std::{io, process::Command};

#[cfg(windows)]
use windows::Win32::{
    Foundation::HANDLE,
    System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
        JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JobObjectExtendedLimitInformation,
        SetInformationJobObject,
    },
};

use crate::policy::SandboxPolicy;

/// Configure a Windows command process according to the given [`SandboxPolicy`].
pub fn configure_command(command: &mut Command, policy: &SandboxPolicy) -> io::Result<()> {
    if !policy.mode.allows_workspace_writes() && !policy.mode.is_read_only() {
        return Ok(());
    }

    // Set creation flags to create a new process group and isolate console input
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;
        command.creation_flags(CREATE_NEW_PROCESS_GROUP);
    }

    Ok(())
}

/// A handle to a Windows Job Object configured for sandboxed process trees.
#[derive(Debug)]
pub struct SandboxJob {
    #[cfg(windows)]
    handle: HANDLE,
}

impl SandboxJob {
    /// Create a new job object with `KILL_ON_JOB_CLOSE` semantics.
    pub fn new() -> io::Result<Self> {
        #[cfg(windows)]
        {
            let handle = unsafe { CreateJobObjectW(None, None) }
                .map_err(|e| io::Error::other(format!("CreateJobObjectW failed: {e}")))?;

            let mut info = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
            info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;

            unsafe {
                SetInformationJobObject(
                    handle,
                    JobObjectExtendedLimitInformation,
                    &info as *const _ as *const _,
                    std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
                )
            }
            .map_err(|e| io::Error::other(format!("SetInformationJobObject failed: {e}")))?;

            Ok(Self { handle })
        }

        #[cfg(not(windows))]
        {
            Ok(Self {})
        }
    }

    /// Assign a process handle to this job object.
    #[cfg(windows)]
    pub fn assign_process(&self, process: HANDLE) -> io::Result<()> {
        unsafe { AssignProcessToJobObject(self.handle, process) }
            .map_err(|e| io::Error::other(format!("AssignProcessToJobObject failed: {e}")))
    }
}

#[cfg(windows)]
impl Drop for SandboxJob {
    fn drop(&mut self) {
        use windows::Win32::Foundation::CloseHandle;
        unsafe {
            let _ = CloseHandle(self.handle);
        }
    }
}

// SAFETY: Windows job handles can be safely moved and shared across threads.
unsafe impl Send for SandboxJob {}
unsafe impl Sync for SandboxJob {}
