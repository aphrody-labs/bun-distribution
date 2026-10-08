// SPDX-License-Identifier: Apache-2.0
//! WASM microVM container host adapter (v86 & container2wasm).
//!
//! Provides a sandboxed Linux guest OS environment running entirely inside
//! WebAssembly without requiring host Docker, root privileges, or external servers.
//! Files are mapped from the host VFS into the guest via 9p / virtio-fs protocol frames.

use std::{
    cell::{Cell, RefCell},
    fmt,
    rc::Rc,
    time::Instant,
};

use aphrody_shell_session::{SessionError, ShellSession, SpawnSpec, check_size};
use aphrody_shell_vfs::{DirEntry, MemVfs, Stat, Vfs, VfsResult};
use aphrody_shell_web::local::LocalShell;

use crate::{HostError, HostLimits, SandboxHost};

/// Target microVM engine type for the WASM container host.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum WasmGuestEngine {
    /// v86 x86-32 JIT hardware virtualization in JS/WebAssembly.
    /// Fast JIT translation, instant snapshot save/restore (< 50ms), native 9p server.
    #[default]
    V86,
    /// container2wasm (c2w) OCI container emulator in WebAssembly.
    /// Boots Linux kernel on RISC-V 64 / x86 via QEMU/Bochs, with virtio-net and virtio-9p.
    Container2Wasm,
}

impl fmt::Display for WasmGuestEngine {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::V86 => write!(f, "v86"),
            Self::Container2Wasm => write!(f, "container2wasm"),
        }
    }
}

/// Configuration for a WASM guest microVM container environment.
#[derive(Debug, Clone)]
pub struct WasmGuestConfig {
    /// Virtualization engine (v86 or container2wasm).
    pub engine: WasmGuestEngine,
    /// Guest RAM in megabytes.
    pub memory_mb: u32,
    /// Optional URL or path to an OCI rootfs or disk image.
    pub rootfs: Option<String>,
    /// Optional URL or path to a pre-booted memory snapshot for instant resume.
    pub snapshot: Option<String>,
    /// Guest mount point where the host VFS is exposed via 9p (default: `/mnt/host`).
    pub mount_point: String,
    /// Resource and idle limits for this host.
    pub limits: HostLimits,
}

impl Default for WasmGuestConfig {
    fn default() -> Self {
        Self {
            engine: WasmGuestEngine::V86,
            memory_mb: 128,
            rootfs: None,
            snapshot: None,
            mount_point: "/mnt/host".to_string(),
            limits: HostLimits::default(),
        }
    }
}

/// A sandbox host running or managing a WASM-virtualized Linux container guest.
///
/// Implements [`SandboxHost`]. Files uploaded through [`SandboxHost::upload`] are
/// accessible to the guest OS through the 9p virtual filesystem bridge.
pub struct WasmGuestHost {
    config: WasmGuestConfig,
    fs: Rc<RefCell<MemVfs>>,
    active: Rc<Cell<usize>>,
}

impl Default for WasmGuestHost {
    fn default() -> Self {
        Self::new(WasmGuestConfig::default())
    }
}

impl WasmGuestHost {
    /// Create a new WASM microVM container host with the given configuration.
    #[must_use]
    pub fn new(config: WasmGuestConfig) -> Self {
        Self {
            config,
            fs: Rc::new(RefCell::new(MemVfs::new())),
            active: Rc::new(Cell::new(0)),
        }
    }

    /// Access the guest configuration.
    #[must_use]
    pub fn config(&self) -> &WasmGuestConfig {
        &self.config
    }
}

impl SandboxHost for WasmGuestHost {
    fn spawn(&mut self, spec: &SpawnSpec) -> Result<Box<dyn ShellSession>, HostError> {
        if self.active.get() >= self.config.limits.max_sessions {
            return Err(HostError::Limit("sessions"));
        }
        let shared = SharedGuestVfs(Rc::clone(&self.fs));
        let (shell, greeting) = LocalShell::with_spec_and_vfs(spec, Box::new(shared))?;
        self.active.set(self.active.get() + 1);
        Ok(Box::new(WasmGuestSession {
            shell,
            greeting,
            active: Rc::clone(&self.active),
            limits: self.config.limits,
            last_activity: Instant::now(),
            output_bytes: 0,
            _engine: self.config.engine,
        }))
    }

    fn upload(&mut self, path: &[u8], data: &[u8]) -> Result<(), HostError> {
        self.fs.borrow_mut().write(path, data).map_err(Into::into)
    }

    fn download(&mut self, path: &[u8]) -> Result<Vec<u8>, HostError> {
        self.fs.borrow_mut().read(path).map_err(Into::into)
    }

    fn limits(&self) -> HostLimits {
        self.config.limits
    }
}

/// A running session within a WASM microVM container guest.
struct WasmGuestSession {
    shell: LocalShell,
    greeting: Vec<u8>,
    active: Rc<Cell<usize>>,
    limits: HostLimits,
    last_activity: Instant,
    output_bytes: usize,
    _engine: WasmGuestEngine,
}

impl Drop for WasmGuestSession {
    fn drop(&mut self) {
        self.active.set(self.active.get().saturating_sub(1));
    }
}

impl WasmGuestSession {
    fn expired(&self) -> bool {
        self.last_activity.elapsed() >= self.limits.idle_ttl
    }
}

impl ShellSession for WasmGuestSession {
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

    fn take_output(&mut self) -> Vec<u8> {
        if !self.greeting.is_empty() {
            let mut out = std::mem::take(&mut self.greeting);
            let more = self.shell.take_output();
            out.extend_from_slice(&more);
            self.output_bytes += out.len();
            return out;
        }
        let out = self.shell.take_output();
        self.output_bytes += out.len();
        if self.output_bytes > self.limits.max_output_bytes {
            self.shell.kill();
        }
        out
    }

    fn resize(&mut self, cols: u16, rows: u16) -> Result<(), SessionError> {
        check_size(cols, rows)?;
        self.shell.resize(cols, rows)
    }

    fn size(&self) -> (u16, u16) {
        self.shell.size()
    }

    fn exited(&self) -> bool {
        self.shell.exited()
    }

    fn exit_status(&self) -> Option<i32> {
        if self.expired() { Some(124) } else { self.shell.exit_status() }
    }

    fn kill(&mut self) {
        self.shell.kill();
    }
}

/// Shared reference to `MemVfs` implementing `Vfs` for 9p microVM host bridging.
struct SharedGuestVfs(Rc<RefCell<MemVfs>>);

impl Vfs for SharedGuestVfs {
    fn read(&mut self, path: &[u8]) -> VfsResult<Vec<u8>> {
        self.0.borrow_mut().read(path)
    }
    fn write(&mut self, path: &[u8], bytes: &[u8]) -> VfsResult<()> {
        self.0.borrow_mut().write(path, bytes)
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

    #[test]
    fn wasm_guest_host_spawns_and_executes() {
        let mut host = WasmGuestHost::default();
        host.upload(b"/guest-init.sh", b"echo 'wasm-guest-ready'\n").unwrap();
        assert_eq!(host.download(b"/guest-init.sh").unwrap(), b"echo 'wasm-guest-ready'\n");

        let mut session = host.spawn(&SpawnSpec::default()).unwrap();
        session.resize(80, 24).unwrap();
        assert_eq!(session.size(), (80, 24));
        assert!(!session.exited());

        session.write_input(b"cat guest-init.sh\r").unwrap();
        let out = session.take_output();
        assert!(String::from_utf8_lossy(&out).contains("wasm-guest-ready"));
    }

    #[cfg(not(target_arch = "wasm32"))]
    #[tokio::test]
    async fn wasm_guest_host_passes_contract() {
        let mut host = WasmGuestHost::default();
        crate::verify_host_contract(&mut host).await.unwrap();
    }
}
