// SPDX-License-Identifier: Apache-2.0
//! Remote-capable shell host contract. Local confinement belongs to `aphrody-sandbox`;
//! this crate owns session lifecycle and file transfer across host boundaries.

#[cfg(not(target_arch = "wasm32"))]
pub mod e2b;
mod mock;
#[cfg(not(target_arch = "wasm32"))]
mod pty;
pub mod wasm_guest;

use std::{error::Error, fmt, time::Duration};

use aphrody_shell_session::{SessionError, ShellSession, SpawnSpec};
use aphrody_shell_vfs::VfsError;

pub use mock::MockHost;
#[cfg(not(target_arch = "wasm32"))]
pub use pty::LocalPtyHost;
pub use wasm_guest::{WasmGuestConfig, WasmGuestEngine, WasmGuestHost};

/// Quotas shared by mock, native and remote sandbox hosts.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct HostLimits {
    /// Maximum number of simultaneous sessions.
    pub max_sessions: usize,
    /// Maximum bytes in one input frame.
    pub max_input_frame_bytes: usize,
    /// Maximum output bytes in one session.
    pub max_output_bytes: usize,
    /// Maximum idle time before a session expires.
    pub idle_ttl: Duration,
}

impl Default for HostLimits {
    fn default() -> Self {
        Self {
            max_sessions: 8,
            max_input_frame_bytes: 1024 * 1024,
            max_output_bytes: 8 * 1024 * 1024,
            idle_ttl: Duration::from_secs(15 * 60),
        }
    }
}

/// Host operation failure.
#[derive(Debug)]
pub enum HostError {
    /// Host quota or frame size exceeded.
    Limit(&'static str),
    /// Shell session operation failed.
    Session(SessionError),
    /// Virtual filesystem operation failed.
    File(VfsError),
    /// Native or provider operation failed.
    Provider(String),
}

impl fmt::Display for HostError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Limit(message) => write!(f, "host limit: {message}"),
            Self::Session(error) => write!(f, "session: {error}"),
            Self::File(error) => write!(f, "file: {error}"),
            Self::Provider(message) => write!(f, "provider: {message}"),
        }
    }
}

impl Error for HostError {}
impl From<SessionError> for HostError {
    fn from(value: SessionError) -> Self {
        Self::Session(value)
    }
}
impl From<VfsError> for HostError {
    fn from(value: VfsError) -> Self {
        Self::File(value)
    }
}

/// One host able to start shell sessions and move files into/out of its filesystem.
///
/// Sessions exchange raw terminal bytes. Transports frame them with the existing
/// `aphrody-shell-web` `data_frame`/`resize_frame` wire format; this trait does not
/// parse VT output or introduce a second terminal protocol.
pub trait SandboxHost {
    /// Start a session with the requested terminal size, cwd and environment.
    ///
    /// # Errors
    /// Returns an error when a quota, configuration or provider operation fails.
    fn spawn(&mut self, spec: &SpawnSpec) -> Result<Box<dyn ShellSession>, HostError>;

    /// Upload whole-file bytes at an absolute path in the host filesystem.
    ///
    /// # Errors
    /// Returns a VFS, quota or provider error.
    fn upload(&mut self, path: &[u8], data: &[u8]) -> Result<(), HostError>;

    /// Download whole-file bytes from an absolute path.
    ///
    /// # Errors
    /// Returns a VFS or provider error.
    fn download(&mut self, path: &[u8]) -> Result<Vec<u8>, HostError>;

    /// Kill a session. Idempotent.
    fn kill(&mut self, session: &mut dyn ShellSession) {
        session.kill();
    }

    /// Active limits for this host.
    fn limits(&self) -> HostLimits;
}

/// Run the common file-transfer and raw-byte session contract against a host.
/// Cloud providers can gate this live check behind their credential flag.
///
/// # Errors
/// Returns the first host, session or output mismatch.
#[cfg(not(target_arch = "wasm32"))]
pub async fn verify_host_contract(host: &mut dyn SandboxHost) -> Result<(), HostError> {
    use std::time::{Duration, Instant};

    const MARKER: &[u8] = b"aphrody-host-contract-marker";
    host.upload(b"/contract-input", MARKER)?;
    if host.download(b"/contract-input")? != MARKER {
        return Err(HostError::Provider("download differs from uploaded bytes".into()));
    }
    let mut session = host.spawn(&SpawnSpec::default())?;
    session.resize(90, 30)?;
    if session.size() != (90, 30) {
        return Err(HostError::Provider("resize did not update session size".into()));
    }
    session.write_input(b"cat contract-input\n")?;
    let deadline = Instant::now() + Duration::from_secs(5);
    let mut output = Vec::new();
    while Instant::now() < deadline {
        output.extend(session.take_output());
        if output.windows(MARKER.len()).any(|part| part == MARKER) {
            break;
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    if !output.windows(MARKER.len()).any(|part| part == MARKER) {
        return Err(HostError::Provider("session did not return uploaded file bytes".into()));
    }
    host.kill(session.as_mut());
    if !session.exited() {
        return Err(HostError::Provider("kill did not exit session".into()));
    }
    Ok(())
}
