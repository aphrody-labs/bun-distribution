// SPDX-License-Identifier: Apache-2.0
//! Process groups that die with their owner, and daemons that do not.

use std::{
    io,
    process::{Child, ChildStderr, ChildStdin, ChildStdout, Command, ExitStatus},
};

#[cfg(unix)]
use crate::unix as platform;
#[cfg(windows)]
use crate::windows as platform;

/// How [`spawn_group`] ties the child to its owner.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct SpawnOptions {
    /// Linux only: ask the kernel to `SIGKILL` the child when the *thread* that
    /// spawned it exits (`PR_SET_PDEATHSIG`), covering an owner killed without
    /// running destructors.
    ///
    /// The signal is bound to the spawning **thread**, not the process: enable
    /// it only when spawning from a thread that lives as long as the owner (a
    /// daemon's main thread). Spawning from a pooled worker — a tokio blocking
    /// thread is reaped after a few idle seconds — would kill the child as soon
    /// as that worker retires. Windows needs no such switch: the Job Object
    /// already closes with the owning process.
    pub die_with_parent_thread: bool,
    /// Windows only: start the child without a console window
    /// (`CREATE_NO_WINDOW`). A GUI owner spawning a console program needs it,
    /// or every spawn flashes a console. Ignored on Unix.
    pub hide_window: bool,
}

/// A child process that leads its own process group and takes the whole group
/// down with it.
///
/// Dropping the value kills the tree. Call [`GroupChild::wait`] first to let
/// the leader finish on its own; descendants it left behind are swept as soon
/// as its exit is observed.
#[derive(Debug)]
pub struct GroupChild {
    child: Child,
    group: platform::Group,
    /// Set once the group has been killed. On Unix the group id is the leader's
    /// pid, which the OS may hand to an unrelated process once the group is
    /// empty and the leader reaped: the group is therefore signalled exactly
    /// once, right when the leader's exit is observed, never later.
    swept: bool,
}

/// Spawn `command` as the leader of a new process group owned by the returned
/// [`GroupChild`].
///
/// Stdio is whatever the caller configured on `command`.
///
/// # Errors
///
/// Propagates the spawn error, or the error of attaching the child to its
/// group (in which case the child has already been killed).
pub fn spawn_group(command: &mut Command, options: SpawnOptions) -> io::Result<GroupChild> {
    platform::configure_owned(command, options);
    let mut child = command.spawn()?;
    match platform::Group::adopt(&child) {
        Ok(group) => Ok(GroupChild { child, group, swept: false }),
        Err(error) => {
            // Never leak a process we could not take ownership of.
            let _ = child.kill();
            let _ = child.wait();
            Err(error)
        },
    }
}

/// Spawn `command` as a daemon: its own session / process group, no console
/// window, outside the parent's Job Object, and **not** killed when the parent
/// exits. Returns the daemon's pid; the caller tracks it through a state file
/// and [`process_alive`].
///
/// The caller is expected to point stdio at files or [`std::process::Stdio::null`]:
/// an inherited pipe would keep the daemon tied to the parent's terminal.
///
/// # Errors
///
/// Propagates the spawn error.
pub fn spawn_detached(command: &mut Command) -> io::Result<u32> {
    let child = platform::spawn_detached(command)?;
    let pid = child.id();
    platform::release_detached(child);
    Ok(pid)
}

/// Whether a process with this pid currently exists.
///
/// A pid can be recycled by the OS: pair this with a second fact (the daemon
/// answering on the port recorded next to its pid) before trusting it.
#[must_use]
pub fn process_alive(pid: u32) -> bool {
    platform::process_alive(pid)
}

/// Forcefully end the process with this pid (`SIGKILL` / `TerminateProcess`).
///
/// The last resort for a process this one does not own — a daemon that ignores
/// its stop request. A pid that no longer exists is success: the goal state is
/// reached. Only the process itself is ended, not its descendants; a supervised
/// tree is torn down by its owner's [`GroupChild`].
///
/// # Errors
///
/// Propagates the OS error (typically: not permitted).
pub fn terminate_process(pid: u32) -> io::Result<()> {
    platform::terminate_process(pid)
}

impl GroupChild {
    /// The pid of the group leader.
    #[must_use]
    pub fn id(&self) -> u32 {
        self.child.id()
    }

    /// Take the child's stdin pipe, when it was configured as piped.
    pub fn take_stdin(&mut self) -> Option<ChildStdin> {
        self.child.stdin.take()
    }

    /// Take the child's stdout pipe, when it was configured as piped.
    pub fn take_stdout(&mut self) -> Option<ChildStdout> {
        self.child.stdout.take()
    }

    /// Take the child's stderr pipe, when it was configured as piped.
    pub fn take_stderr(&mut self) -> Option<ChildStderr> {
        self.child.stderr.take()
    }

    /// The leader's exit status if it has already exited, without blocking.
    ///
    /// # Errors
    ///
    /// Propagates the OS error of querying the child.
    pub fn try_wait(&mut self) -> io::Result<Option<ExitStatus>> {
        let status = self.child.try_wait()?;
        if status.is_some() {
            self.sweep()?;
        }
        Ok(status)
    }

    /// Block until the leader exits.
    ///
    /// # Errors
    ///
    /// Propagates the OS error of waiting on the child.
    pub fn wait(&mut self) -> io::Result<ExitStatus> {
        let status = self.child.wait()?;
        self.sweep()?;
        Ok(status)
    }

    /// Kill every process of the group, then reap the leader.
    ///
    /// Idempotent: killing a group that is already gone is not an error.
    ///
    /// # Errors
    ///
    /// Propagates an OS error other than "no such process".
    pub fn kill_tree(&mut self) -> io::Result<()> {
        let killed = self.sweep();
        // Reap regardless, so the leader never lingers as a zombie.
        let _ = self.child.wait();
        killed
    }

    /// Kill the group once; later calls are no-ops.
    fn sweep(&mut self) -> io::Result<()> {
        if self.swept {
            return Ok(());
        }
        self.swept = true;
        self.group.kill(&mut self.child)
    }
}

impl Drop for GroupChild {
    fn drop(&mut self) {
        // Descendants can outlive a leader that exited on its own, so the group
        // is always swept; `kill_tree` tolerates an already-empty group.
        if let Err(error) = self.kill_tree() {
            tracing::warn!(pid = self.child.id(), %error, "failed to kill process group on drop");
        }
    }
}
