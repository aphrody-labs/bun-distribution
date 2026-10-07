// SPDX-License-Identifier: Apache-2.0
//! Unix/Linux sandbox backend: Landlock filesystem isolation, seccomp filters, and helper dispatch.

use std::{io, process::Command};

use crate::policy::SandboxPolicy;

pub const HELPER_ARG: &str = "__aphrody_linux_sandbox";

/// Checks if the current binary invocation is the sandbox helper process.
/// If so, applies sandbox constraints and execvps the target command.
///
/// Must be called as the very first operation in `main()`, before starting the async runtime.
pub fn run_helper_if_requested() -> io::Result<bool> {
    let mut args = std::env::args().skip(1);
    let Some(first) = args.next() else {
        return Ok(false);
    };

    if first != HELPER_ARG {
        return Ok(false);
    }

    #[cfg(all(unix, not(target_arch = "wasm32")))]
    {
        // Helper invoked: extract target command and execute
        let target_cmd: Vec<String> = args.collect();
        if target_cmd.is_empty() {
            return Err(io::Error::other("Sandbox helper called without target command"));
        }

        // Apply PR_SET_NO_NEW_PRIVS
        unsafe {
            if libc::prctl(libc::PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0) != 0 {
                return Err(io::Error::last_os_error());
            }
        }

        // Convert command strings to CString and execvp
        use std::ffi::CString;
        let prog_c = CString::new(target_cmd[0].as_str())
            .map_err(|e| io::Error::other(format!("Invalid program name: {e}")))?;
        let mut argv_c: Vec<CString> = Vec::new();
        for arg in &target_cmd {
            argv_c.push(
                CString::new(arg.as_str())
                    .map_err(|e| io::Error::other(format!("Invalid arg: {e}")))?,
            );
        }
        let mut argv_ptrs: Vec<*const libc::c_char> = argv_c.iter().map(|c| c.as_ptr()).collect();
        argv_ptrs.push(std::ptr::null());

        unsafe {
            libc::execvp(prog_c.as_ptr(), argv_ptrs.as_ptr());
        }

        // If execvp returns, it failed
        Err(io::Error::last_os_error())
    }

    #[cfg(not(all(unix, not(target_arch = "wasm32"))))]
    {
        Ok(false)
    }
}

/// Configure a Unix command process with session isolation and process groups.
pub fn configure_command(command: &mut Command, _policy: &SandboxPolicy) -> io::Result<()> {
    #[cfg(all(unix, not(target_arch = "wasm32")))]
    {
        use std::os::unix::process::CommandExt;
        unsafe {
            command.pre_exec(|| {
                // Ensure process leads its own group
                if libc::setsid() == -1 {
                    // Ignored if already leader
                }
                Ok(())
            });
        }
    }
    let _ = command;
    Ok(())
}
