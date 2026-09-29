// SPDX-License-Identifier: Apache-2.0
//! Unix backend: a new session per child, the whole group signalled at once.

use std::{
    io,
    os::unix::process::CommandExt as _,
    process::{Child, Command},
};

use rustix::process::{Pid, Signal};

use crate::group::SpawnOptions;

/// Make `command` start in its own session (hence its own process group),
/// optionally bound to the life of the spawning thread.
pub(crate) fn configure_owned(command: &mut Command, options: SpawnOptions) {
    let die_with_parent_thread = options.die_with_parent_thread;
    // SAFETY: the closure runs between `fork` and `exec` and only performs raw
    // syscalls through rustix (`setsid`, `prctl`), which are async-signal-safe;
    // it allocates nothing and touches no shared state.
    unsafe {
        command.pre_exec(move || {
            rustix::process::setsid()?;
            #[cfg(target_os = "linux")]
            if die_with_parent_thread {
                rustix::process::set_parent_process_death_signal(Some(Signal::KILL))?;
            }
            #[cfg(not(target_os = "linux"))]
            let _ = die_with_parent_thread;
            Ok(())
        });
    }
}

/// Start `command` as a daemon: a new session, never tied to the parent.
pub(crate) fn spawn_detached(command: &mut Command) -> io::Result<Child> {
    // SAFETY: as in `configure_owned` — a single async-signal-safe syscall.
    unsafe {
        command.pre_exec(|| {
            rustix::process::setsid()?;
            Ok(())
        });
    }
    command.spawn()
}

/// Let go of a daemon without leaving a zombie behind.
///
/// A daemon that outlives us is re-parented to init, which reaps it. One that
/// exits *before* us would stay a zombie for as long as we run — and a zombie
/// still answers the signal-0 probe, so [`process_alive`] would report a dead
/// daemon as alive. A parked thread waits on it instead; it costs nothing while
/// the daemon runs and ends with our process otherwise.
pub(crate) fn release_detached(mut child: Child) {
    let pid = child.id();
    let spawned =
        std::thread::Builder::new().name(format!("aphrody-reap-{pid}")).spawn(move || {
            let _ = child.wait();
        });
    if let Err(error) = spawned {
        tracing::warn!(pid, %error, "could not start the reaper thread for a detached daemon");
    }
}

/// The process group led by an owned child.
#[derive(Debug)]
pub(crate) struct Group {
    leader: Pid,
}

impl Group {
    /// The child called `setsid`, so its pid is also its process-group id.
    pub(crate) fn adopt(child: &Child) -> io::Result<Self> {
        let raw = i32::try_from(child.id())
            .map_err(|_| io::Error::new(io::ErrorKind::InvalidData, "pid out of range"))?;
        let leader = Pid::from_raw(raw)
            .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidData, "child has pid 0"))?;
        Ok(Self { leader })
    }

    /// `SIGKILL` every process of the group. A group that no longer exists is
    /// the desired end state, not an error.
    pub(crate) fn kill(&self, _leader: &mut Child) -> io::Result<()> {
        match rustix::process::kill_process_group(self.leader, Signal::KILL) {
            Ok(()) => Ok(()),
            Err(rustix::io::Errno::SRCH) => Ok(()),
            Err(errno) => Err(errno.into()),
        }
    }
}

/// `SIGKILL` one process; `ESRCH` means it is already gone.
pub(crate) fn terminate_process(pid: u32) -> io::Result<()> {
    let Some(pid) = i32::try_from(pid).ok().and_then(Pid::from_raw) else {
        return Ok(());
    };
    match rustix::process::kill_process(pid, Signal::KILL) {
        Ok(()) | Err(rustix::io::Errno::SRCH) => Ok(()),
        Err(errno) => Err(errno.into()),
    }
}

/// Whether a process with this pid exists (signal 0 probe). `EPERM` still
/// means the process exists, it simply belongs to someone else.
pub(crate) fn process_alive(pid: u32) -> bool {
    let Some(pid) = i32::try_from(pid).ok().and_then(Pid::from_raw) else {
        return false;
    };
    match rustix::process::test_kill_process(pid) {
        Ok(()) | Err(rustix::io::Errno::PERM) => true,
        Err(_) => false,
    }
}
