// SPDX-License-Identifier: Apache-2.0
//! Transport-neutral shell session seam (layer L2): input bytes in, output bytes out, resize, exit.
//!
//! Engines (in-wasm `LocalShell`, native PTY, remote sandbox host) implement [`ShellEngine`] and
//! hand out [`ShellSession`]s; transports (WebSocket, Tauri channel, in-worker) drive sessions
//! without knowing the engine. The crate is `std`-only, free of async runtimes and wasm-clean.
//! The VT state is never parsed here: output is the raw terminal byte stream.

mod scripted;

use std::{error::Error, fmt};

pub use scripted::{ScriptedEngine, ScriptedSession};

/// Default terminal width in columns.
pub const DEFAULT_COLUMNS: u16 = 80;
/// Default terminal height in rows.
pub const DEFAULT_ROWS: u16 = 24;

/// Failure of a session or engine operation.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SessionError {
    /// The session already exited; no further input is accepted.
    Exited,
    /// A size was rejected (zero columns or rows).
    InvalidSize {
        /// Requested columns.
        columns: u16,
        /// Requested rows.
        rows: u16,
    },
    /// The engine failed to start or run the shell.
    Engine(String),
}

impl fmt::Display for SessionError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Exited => f.write_str("session already exited"),
            Self::InvalidSize { columns, rows } => {
                write!(f, "invalid terminal size {columns}x{rows}")
            }
            Self::Engine(message) => write!(f, "engine error: {message}"),
        }
    }
}

impl Error for SessionError {}

/// Parameters for starting a session.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SpawnSpec {
    /// Initial terminal width in columns.
    pub columns: u16,
    /// Initial terminal height in rows.
    pub rows: u16,
    /// Initial working directory, when the engine supports one.
    pub cwd: Option<String>,
    /// Extra environment variables as `(name, value)` pairs.
    pub env: Vec<(String, String)>,
}

impl Default for SpawnSpec {
    fn default() -> Self {
        Self {
            columns: DEFAULT_COLUMNS,
            rows: DEFAULT_ROWS,
            cwd: None,
            env: Vec::new(),
        }
    }
}

/// One live shell, driven by a transport.
///
/// Methods are non-blocking: output is buffered by the session and drained with
/// [`ShellSession::take_output`].
pub trait ShellSession {
    /// Feed raw terminal input (keystrokes, pasted text) to the shell.
    ///
    /// # Errors
    /// [`SessionError::Exited`] once the shell has exited.
    fn write_input(&mut self, bytes: &[u8]) -> Result<(), SessionError>;

    /// Change the terminal size.
    ///
    /// # Errors
    /// [`SessionError::InvalidSize`] for a zero dimension, [`SessionError::Exited`] after exit.
    fn resize(&mut self, columns: u16, rows: u16) -> Result<(), SessionError>;

    /// Current terminal size as `(columns, rows)`.
    fn size(&self) -> (u16, u16);

    /// Drain and return all output produced since the previous call (may be empty).
    ///
    /// Output produced before exit stays readable after exit.
    fn take_output(&mut self) -> Vec<u8>;

    /// Exit code once the shell has exited, `None` while it is running.
    fn exit_status(&self) -> Option<i32>;

    /// Terminate the session. Idempotent; sets a status when none is set yet.
    fn kill(&mut self);

    /// Whether the shell has exited.
    fn exited(&self) -> bool {
        self.exit_status().is_some()
    }
}

/// Factory for sessions of one engine kind.
pub trait ShellEngine {
    /// Stable engine identifier (for example `local`, `pty`, `sandbox`).
    fn name(&self) -> &str;

    /// Start a new session.
    ///
    /// # Errors
    /// [`SessionError::InvalidSize`] for a zero dimension, [`SessionError::Engine`] otherwise.
    fn spawn(&self, spec: &SpawnSpec) -> Result<Box<dyn ShellSession>, SessionError>;
}

/// Validate a terminal size.
///
/// # Errors
/// [`SessionError::InvalidSize`] when either dimension is zero.
pub const fn check_size(columns: u16, rows: u16) -> Result<(), SessionError> {
    if columns == 0 || rows == 0 {
        Err(SessionError::InvalidSize { columns, rows })
    } else {
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn spec_default_is_80x24() {
        let spec = SpawnSpec::default();
        assert_eq!((spec.columns, spec.rows), (80, 24));
        assert!(spec.cwd.is_none() && spec.env.is_empty());
    }

    #[test]
    fn check_size_rejects_zero() {
        assert!(check_size(1, 1).is_ok());
        assert_eq!(
            check_size(0, 5),
            Err(SessionError::InvalidSize {
                columns: 0,
                rows: 5
            })
        );
        assert_eq!(
            check_size(5, 0),
            Err(SessionError::InvalidSize {
                columns: 5,
                rows: 0
            })
        );
    }

    #[test]
    fn errors_display() {
        assert_eq!(SessionError::Exited.to_string(), "session already exited");
        assert_eq!(
            SessionError::InvalidSize {
                columns: 0,
                rows: 3
            }
            .to_string(),
            "invalid terminal size 0x3"
        );
        assert_eq!(
            SessionError::Engine("boom".into()).to_string(),
            "engine error: boom"
        );
    }
}
