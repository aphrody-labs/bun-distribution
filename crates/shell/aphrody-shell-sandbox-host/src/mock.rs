// SPDX-License-Identifier: Apache-2.0
//! In-process host for contract tests and serverless development.

use std::{
    cell::{Cell, RefCell},
    rc::Rc,
    time::Instant,
};

use aphrody_shell_session::{SessionError, ShellSession, SpawnSpec};
use aphrody_shell_vfs::{DirEntry, MemVfs, Stat, Vfs, VfsResult};
use aphrody_shell_web::local::LocalShell;

use crate::{HostError, HostLimits, SandboxHost};

/// A host with a shared `MemVfs`. Uploaded files are visible to its sessions.
pub struct MockHost {
    fs: Rc<RefCell<MemVfs>>,
    active: Rc<Cell<usize>>,
    limits: HostLimits,
}

impl Default for MockHost {
    fn default() -> Self {
        Self::new(HostLimits::default())
    }
}

impl MockHost {
    /// Create a mock host with explicit limits.
    #[must_use]
    pub fn new(limits: HostLimits) -> Self {
        Self { fs: Rc::new(RefCell::new(MemVfs::new())), active: Rc::new(Cell::new(0)), limits }
    }
}

impl SandboxHost for MockHost {
    fn spawn(&mut self, spec: &SpawnSpec) -> Result<Box<dyn ShellSession>, HostError> {
        if self.active.get() >= self.limits.max_sessions {
            return Err(HostError::Limit("sessions"));
        }
        let shared = SharedMemVfs(Rc::clone(&self.fs));
        let (shell, greeting) = LocalShell::with_spec_and_vfs(spec, Box::new(shared))?;
        self.active.set(self.active.get() + 1);
        Ok(Box::new(MockSession {
            shell,
            greeting,
            active: Rc::clone(&self.active),
            limits: self.limits,
            last_activity: Instant::now(),
            output_bytes: 0,
        }))
    }

    fn upload(&mut self, path: &[u8], data: &[u8]) -> Result<(), HostError> {
        self.fs.borrow_mut().write(path, data).map_err(Into::into)
    }

    fn download(&mut self, path: &[u8]) -> Result<Vec<u8>, HostError> {
        self.fs.borrow_mut().read(path).map_err(Into::into)
    }

    fn limits(&self) -> HostLimits {
        self.limits
    }
}

struct MockSession {
    shell: LocalShell,
    greeting: Vec<u8>,
    active: Rc<Cell<usize>>,
    limits: HostLimits,
    last_activity: Instant,
    output_bytes: usize,
}

impl Drop for MockSession {
    fn drop(&mut self) {
        self.active.set(self.active.get().saturating_sub(1));
    }
}

impl MockSession {
    fn expired(&self) -> bool {
        self.last_activity.elapsed() >= self.limits.idle_ttl
    }
}

impl ShellSession for MockSession {
    fn write_input(&mut self, bytes: &[u8]) -> Result<(), SessionError> {
        if self.expired() {
            self.shell.kill();
            return Err(SessionError::Exited);
        }
        if bytes.len() > self.limits.max_input_frame_bytes {
            return Err(SessionError::Engine("input frame limit exceeded".into()));
        }
        self.last_activity = Instant::now();
        self.shell.write_input(bytes)
    }

    fn resize(&mut self, columns: u16, rows: u16) -> Result<(), SessionError> {
        if self.expired() {
            self.shell.kill();
            return Err(SessionError::Exited);
        }
        self.last_activity = Instant::now();
        self.shell.resize(columns, rows)
    }

    fn size(&self) -> (u16, u16) {
        self.shell.size()
    }

    fn take_output(&mut self) -> Vec<u8> {
        if self.expired() {
            self.shell.kill();
        }
        let mut output = std::mem::take(&mut self.greeting);
        output.extend(self.shell.take_output());
        let remaining = self.limits.max_output_bytes.saturating_sub(self.output_bytes);
        if output.len() > remaining {
            output.truncate(remaining);
            self.shell.kill();
        }
        self.output_bytes += output.len();
        if !output.is_empty() {
            self.last_activity = Instant::now();
        }
        output
    }

    fn exit_status(&self) -> Option<i32> {
        if self.expired() { Some(124) } else { self.shell.exit_status() }
    }

    fn kill(&mut self) {
        self.shell.kill();
    }
}

#[derive(Clone)]
struct SharedMemVfs(Rc<RefCell<MemVfs>>);

impl Vfs for SharedMemVfs {
    fn read(&mut self, path: &[u8]) -> VfsResult<Vec<u8>> {
        self.0.borrow_mut().read(path)
    }
    fn write(&mut self, path: &[u8], data: &[u8]) -> VfsResult<()> {
        self.0.borrow_mut().write(path, data)
    }
    fn stat(&mut self, path: &[u8]) -> VfsResult<Stat> {
        self.0.borrow_mut().stat(path)
    }
    fn read_dir(&mut self, path: &[u8]) -> VfsResult<Vec<DirEntry>> {
        self.0.borrow_mut().read_dir(path)
    }
    fn mkdir(&mut self, path: &[u8]) -> VfsResult<()> {
        self.0.borrow_mut().mkdir(path)
    }
    fn remove(&mut self, path: &[u8]) -> VfsResult<()> {
        self.0.borrow_mut().remove(path)
    }
    fn rename(&mut self, from: &[u8], to: &[u8]) -> VfsResult<()> {
        self.0.borrow_mut().rename(from, to)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(not(target_arch = "wasm32"))]
    #[tokio::test]
    async fn shared_host_contract() {
        crate::verify_host_contract(&mut MockHost::default()).await.unwrap();
    }
    use aphrody_shell_session::SpawnSpec;
    use std::time::Duration;

    #[test]
    fn upload_is_visible_to_session_and_download() {
        let mut host = MockHost::default();
        host.upload(b"/input", b"hello\n").unwrap();
        let mut session = host.spawn(&SpawnSpec::default()).unwrap();
        session.write_input(b"cat input\r").unwrap();
        let output = String::from_utf8(session.take_output()).unwrap();
        assert!(output.contains("hello\r\n"), "{output}");
        session.write_input(b"echo world > result\r").unwrap();
        assert_eq!(host.download(b"/result").unwrap(), b"world\n");
        host.kill(session.as_mut());
        assert!(session.exited());
    }

    #[test]
    fn limits_and_session_count_are_enforced() {
        let limits = HostLimits {
            max_sessions: 1,
            max_input_frame_bytes: 4,
            max_output_bytes: 100,
            idle_ttl: Duration::from_secs(60),
        };
        let mut host = MockHost::new(limits);
        let mut first = host.spawn(&SpawnSpec::default()).unwrap();
        assert!(matches!(host.spawn(&SpawnSpec::default()), Err(HostError::Limit("sessions"))));
        assert!(first.write_input(b"12345").is_err());
        drop(first);
        assert!(host.spawn(&SpawnSpec::default()).is_ok());
    }

    #[test]
    fn output_quota_and_idle_ttl_close_sessions() {
        let limits = HostLimits {
            max_output_bytes: 10,
            idle_ttl: Duration::from_secs(60),
            ..HostLimits::default()
        };
        let mut host = MockHost::new(limits);
        let mut session = host.spawn(&SpawnSpec::default()).unwrap();
        assert_eq!(session.take_output().len(), 10);
        assert!(session.exited());

        let mut expired =
            MockHost::new(HostLimits { idle_ttl: Duration::ZERO, ..HostLimits::default() });
        let mut session = expired.spawn(&SpawnSpec::default()).unwrap();
        assert_eq!(session.exit_status(), Some(124));
        assert!(session.write_input(b"echo no\r").is_err());
    }
}
