// SPDX-License-Identifier: Apache-2.0
//! Native PTY host, using the existing terminal backend without a second PTY driver.

use std::{
    cell::{Cell, RefCell},
    fs,
    path::{Path, PathBuf},
    rc::Rc,
    time::Instant,
};

use aphrody_shell_session::{SessionError, ShellSession, SpawnSpec, check_size};
use aphrody_shell_vfs::path;
use aphrody_terminal_backend::{PtyConfig, PtyEvent, PtySession};
use tokio::sync::mpsc::{self, error::TryRecvError};

use crate::{HostError, HostLimits, SandboxHost};

/// Native host backed by `aphrody-terminal-backend::PtySession`.
///
/// `transfer_root` contains files made available to the PTY. This adapter does
/// not confine the shell process: apply `aphrody-sandbox` or a provider isolation
/// boundary when running untrusted commands.
pub struct LocalPtyHost {
    root: PathBuf,
    config: PtyConfig,
    limits: HostLimits,
    active: Rc<Cell<usize>>,
}

impl LocalPtyHost {
    /// Use an existing directory as the transfer root. Must be called inside a
    /// Tokio runtime before spawning sessions.
    ///
    /// # Errors
    /// Returns a provider error if the directory cannot be canonicalized.
    pub fn new(
        root: impl AsRef<Path>,
        config: PtyConfig,
        limits: HostLimits,
    ) -> Result<Self, HostError> {
        let root = root.as_ref().canonicalize().map_err(|e| HostError::Provider(e.to_string()))?;
        if !root.is_dir() {
            return Err(HostError::Provider("transfer root is not a directory".into()));
        }
        Ok(Self { root, config, limits, active: Rc::new(Cell::new(0)) })
    }

    fn resolve(&self, path_bytes: &[u8], existing: bool) -> Result<PathBuf, HostError> {
        let normalized = path::normalize(path_bytes)?;
        let text = std::str::from_utf8(&normalized)
            .map_err(|_| HostError::Provider("native host path must be UTF-8".into()))?;
        let target = self.root.join(text.trim_start_matches('/'));
        let checked = if existing { &target } else { target.parent().unwrap_or(&self.root) };
        let canonical = checked.canonicalize().map_err(|e| HostError::Provider(e.to_string()))?;
        if !canonical.starts_with(&self.root) {
            return Err(HostError::Provider("path leaves transfer root".into()));
        }
        if !existing && target.is_symlink() {
            return Err(HostError::Provider("transfer target is a symlink".into()));
        }
        if existing { Ok(canonical) } else { Ok(target) }
    }
}

impl SandboxHost for LocalPtyHost {
    fn spawn(&mut self, spec: &SpawnSpec) -> Result<Box<dyn ShellSession>, HostError> {
        check_size(spec.columns, spec.rows)?;
        if self.active.get() >= self.limits.max_sessions {
            return Err(HostError::Limit("sessions"));
        }
        let runtime = tokio::runtime::Handle::try_current()
            .map_err(|_| HostError::Provider("Tokio runtime required".into()))?;
        let mut config = self.config.clone();
        config.cols = spec.columns;
        config.rows = spec.rows;
        config.cwd = Some(if let Some(cwd) = &spec.cwd {
            let path = self.resolve(cwd.as_bytes(), true)?;
            if !path.is_dir() {
                return Err(HostError::Provider("cwd is not a directory".into()));
            }
            path
        } else {
            self.root.clone()
        });
        config.env.extend(spec.env.iter().cloned());
        let (event_tx, event_rx) = mpsc::channel(64);
        let pty =
            PtySession::spawn(&config, event_tx).map_err(|e| HostError::Provider(e.to_string()))?;
        let (command_tx, mut command_rx) = mpsc::channel(64);
        runtime.spawn(async move {
            while let Some(command) = command_rx.recv().await {
                match command {
                    Control::Input(bytes) => {
                        if pty.write(bytes).await.is_err() {
                            break;
                        }
                    },
                    Control::Resize(cols, rows) => {
                        if pty.resize(cols, rows).is_err() {
                            break;
                        }
                    },
                }
            }
            pty.close().await;
        });
        self.active.set(self.active.get() + 1);
        Ok(Box::new(LocalPtySession {
            controls: Some(command_tx),
            events: RefCell::new(event_rx),
            pending: RefCell::new(Vec::new()),
            status: Cell::new(None),
            size: Cell::new((spec.columns, spec.rows)),
            last_activity: Cell::new(Instant::now()),
            output_bytes: 0,
            active: Rc::clone(&self.active),
            limits: self.limits,
        }))
    }

    fn upload(&mut self, path: &[u8], data: &[u8]) -> Result<(), HostError> {
        let target = self.resolve(path, false)?;
        fs::write(target, data).map_err(|e| HostError::Provider(e.to_string()))
    }

    fn download(&mut self, path: &[u8]) -> Result<Vec<u8>, HostError> {
        let target = self.resolve(path, true)?;
        fs::read(target).map_err(|e| HostError::Provider(e.to_string()))
    }

    fn limits(&self) -> HostLimits {
        self.limits
    }
}

enum Control {
    Input(Vec<u8>),
    Resize(u16, u16),
}

struct LocalPtySession {
    controls: Option<mpsc::Sender<Control>>,
    events: RefCell<mpsc::Receiver<PtyEvent>>,
    pending: RefCell<Vec<u8>>,
    status: Cell<Option<i32>>,
    size: Cell<(u16, u16)>,
    last_activity: Cell<Instant>,
    output_bytes: usize,
    active: Rc<Cell<usize>>,
    limits: HostLimits,
}

impl LocalPtySession {
    fn expired(&self) -> bool {
        self.last_activity.get().elapsed() >= self.limits.idle_ttl
    }

    fn drain(&self) {
        let mut events = self.events.borrow_mut();
        loop {
            match events.try_recv() {
                Ok(PtyEvent::Output(bytes)) => {
                    self.last_activity.set(Instant::now());
                    self.pending.borrow_mut().extend(bytes);
                },
                Ok(PtyEvent::Exit { code }) => {
                    self.status
                        .set(Some(code.and_then(|code| i32::try_from(code).ok()).unwrap_or(1)));
                },
                Err(TryRecvError::Empty) => break,
                Err(TryRecvError::Disconnected) => {
                    if self.status.get().is_none() {
                        self.status.set(Some(1));
                    }
                    break;
                },
            }
        }
    }
}

impl Drop for LocalPtySession {
    fn drop(&mut self) {
        self.controls = None;
        self.active.set(self.active.get().saturating_sub(1));
    }
}

impl ShellSession for LocalPtySession {
    fn write_input(&mut self, bytes: &[u8]) -> Result<(), SessionError> {
        if self.exited() || self.expired() {
            self.kill();
            return Err(SessionError::Exited);
        }
        if bytes.len() > self.limits.max_input_frame_bytes {
            return Err(SessionError::Engine("input frame limit exceeded".into()));
        }
        let controls = self.controls.as_ref().ok_or(SessionError::Exited)?;
        controls
            .try_send(Control::Input(bytes.to_vec()))
            .map_err(|e| SessionError::Engine(format!("pty input queue: {e}")))?;
        self.last_activity.set(Instant::now());
        Ok(())
    }

    fn resize(&mut self, columns: u16, rows: u16) -> Result<(), SessionError> {
        check_size(columns, rows)?;
        if self.exited() || self.expired() {
            self.kill();
            return Err(SessionError::Exited);
        }
        let controls = self.controls.as_ref().ok_or(SessionError::Exited)?;
        controls
            .try_send(Control::Resize(columns, rows))
            .map_err(|e| SessionError::Engine(format!("pty control queue: {e}")))?;
        self.size.set((columns, rows));
        self.last_activity.set(Instant::now());
        Ok(())
    }

    fn size(&self) -> (u16, u16) {
        self.size.get()
    }

    fn take_output(&mut self) -> Vec<u8> {
        if self.expired() {
            self.kill();
        }
        self.drain();
        let mut output = std::mem::take(&mut *self.pending.borrow_mut());
        let remaining = self.limits.max_output_bytes.saturating_sub(self.output_bytes);
        if output.len() > remaining {
            output.truncate(remaining);
            self.kill();
        }
        self.output_bytes += output.len();
        output
    }

    fn exit_status(&self) -> Option<i32> {
        self.drain();
        if self.expired() { Some(124) } else { self.status.get() }
    }

    fn kill(&mut self) {
        self.controls = None;
        if self.status.get().is_none() {
            self.status.set(Some(137));
        }
    }
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::os::unix::fs::symlink;

    #[tokio::test]
    async fn native_pty_round_trip_and_transfer() {
        let root = std::env::temp_dir().join(format!("aphrody-shell-host-{}", std::process::id()));
        fs::create_dir_all(&root).unwrap();
        let config = PtyConfig { shell: Some("/bin/sh".into()), ..PtyConfig::default() };
        let mut host = LocalPtyHost::new(&root, config, HostLimits::default()).unwrap();
        crate::verify_host_contract(&mut host).await.unwrap();
        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn transfer_rejects_symlink_escape() {
        let base =
            std::env::temp_dir().join(format!("aphrody-shell-host-links-{}", std::process::id()));
        let root = base.join("root");
        fs::create_dir_all(&root).unwrap();
        let outside = base.join("outside");
        fs::write(&outside, b"outside").unwrap();
        symlink(&outside, root.join("link")).unwrap();
        let mut host =
            LocalPtyHost::new(&root, PtyConfig::default(), HostLimits::default()).unwrap();
        assert!(host.upload(b"/link", b"changed").is_err());
        assert!(host.download(b"/link").is_err());
        assert_eq!(fs::read(&outside).unwrap(), b"outside");
        fs::remove_dir_all(base).unwrap();
    }
}
