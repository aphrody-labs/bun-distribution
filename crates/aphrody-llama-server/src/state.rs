// SPDX-License-Identifier: Apache-2.0
//! The on-disk rendezvous between supervisor clients and the daemon.
//!
//! Everything lives under the aphrody state directory, one set of files per
//! [`Role`]:
//!
//! - `run/llama-server-<role>.json` — the [`RunState`] of the live instance;
//! - `run/llama-server-<role>.spec.json` — the spec handed to the daemon;
//! - `run/llama-server-<role>.touch` — last-use time, bumped by clients;
//! - `run/llama-server-<role>.stop` — a client's request to shut down;
//! - `run/llama-server-<role>.error` — why the last launch failed;
//! - `logs/llama-server-<role>.log` — the server's own output;
//! - `locks/llama-server-<role>.lock` — serializes attach-or-spawn;
//! - `locks/gpu.lock` (+ `gpu.d/`) — the GPU lease.

use std::{
    io,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

use aphrody_proc::process_alive;
use serde::{Deserialize, Serialize};

use crate::spec::Role;

/// The directories the supervisor and the daemon share.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StateDirs {
    root: PathBuf,
}

impl StateDirs {
    /// Directories under the aphrody state root (`~/.aphrody` or `$APHRODY_HOME`).
    #[must_use]
    pub fn new(root: impl Into<PathBuf>) -> Self {
        Self { root: root.into() }
    }

    /// The state root.
    #[must_use]
    pub fn root(&self) -> &Path {
        &self.root
    }

    /// `locks/`, shared with the GPU lease.
    #[must_use]
    pub fn locks(&self) -> PathBuf {
        self.root.join("locks")
    }

    fn run_file(&self, role: Role, suffix: &str) -> PathBuf {
        self.root
            .join("run")
            .join(format!("llama-server-{}{suffix}", role.as_str()))
    }

    /// The [`RunState`] file.
    #[must_use]
    pub fn state_file(&self, role: Role) -> PathBuf {
        self.run_file(role, ".json")
    }

    /// The spec file handed to the daemon.
    #[must_use]
    pub fn spec_file(&self, role: Role) -> PathBuf {
        self.run_file(role, ".spec.json")
    }

    /// The last-use marker.
    #[must_use]
    pub fn touch_file(&self, role: Role) -> PathBuf {
        self.run_file(role, ".touch")
    }

    /// The stop request marker.
    #[must_use]
    pub fn stop_file(&self, role: Role) -> PathBuf {
        self.run_file(role, ".stop")
    }

    /// Why the last launch failed, written by a daemon that could not bring
    /// its server up and read by the client that was waiting for it.
    #[must_use]
    pub fn error_file(&self, role: Role) -> PathBuf {
        self.run_file(role, ".error")
    }

    /// The server log.
    #[must_use]
    pub fn log_file(&self, role: Role) -> PathBuf {
        self.root
            .join("logs")
            .join(format!("llama-server-{}.log", role.as_str()))
    }

    /// The lock serializing attach-or-spawn for `role`.
    #[must_use]
    pub fn role_lock(&self, role: Role) -> PathBuf {
        self.locks()
            .join(format!("llama-server-{}.lock", role.as_str()))
    }
}

/// A running instance, as published by its daemon.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RunState {
    /// What the instance serves.
    pub role: Role,
    /// The supervising daemon.
    pub daemon_pid: u32,
    /// The `llama-server` process.
    pub server_pid: u32,
    /// The loopback port the server listens on.
    pub port: u16,
    /// [`LlamaServerSpec::fingerprint`](crate::LlamaServerSpec::fingerprint) of
    /// the spec it was started with.
    pub fingerprint: String,
    /// Model name the API reports.
    pub alias: String,
    /// The GGUF being served.
    pub model: PathBuf,
    /// The server binary.
    pub binary: PathBuf,
    /// Start time, seconds since the Unix epoch.
    pub started_unix: u64,
    /// Whether `/health` has answered 200 yet. The file is published as soon as
    /// the port is known so a waiting client can follow a slow model load.
    pub ready: bool,
}

impl RunState {
    /// The OpenAI-compatible API root of the instance.
    #[must_use]
    pub fn base_url(&self) -> String {
        format!("http://127.0.0.1:{}/v1", self.port)
    }

    /// The server root (for `/health`, `/tokenize`, `/lora-adapters`, `/props`).
    #[must_use]
    pub fn server_url(&self) -> String {
        format!("http://127.0.0.1:{}", self.port)
    }
}

/// Seconds since the Unix epoch.
#[must_use]
pub(crate) fn unix_now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |elapsed| elapsed.as_secs())
}

/// Write `bytes` to `path` atomically (temp file + rename), creating the
/// parent directory. A reader never observes a half-written file.
///
/// # Errors
///
/// Propagates filesystem errors.
pub(crate) fn write_atomic(path: &Path, bytes: &[u8]) -> io::Result<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let mut temp = path.as_os_str().to_owned();
    temp.push(format!(".{}.tmp", std::process::id()));
    let temp = PathBuf::from(temp);
    std::fs::write(&temp, bytes)?;
    std::fs::rename(&temp, path).inspect_err(|_| {
        let _ = std::fs::remove_file(&temp);
    })
}

/// Publish `state` for its role.
///
/// # Errors
///
/// Propagates filesystem / encoding errors.
pub(crate) fn write_state(dirs: &StateDirs, state: &RunState) -> io::Result<()> {
    let bytes = serde_json::to_vec_pretty(state).map_err(io::Error::other)?;
    write_atomic(&dirs.state_file(state.role), &bytes)
}

/// The published state of `role`, if any. An unreadable file counts as absent:
/// the caller then starts a fresh instance, which rewrites it.
#[must_use]
pub(crate) fn read_state(dirs: &StateDirs, role: Role) -> Option<RunState> {
    let bytes = std::fs::read(dirs.state_file(role)).ok()?;
    serde_json::from_slice(&bytes).ok()
}

/// Remove a file, treating "already gone" as success.
///
/// # Errors
///
/// Propagates any other filesystem error.
pub(crate) fn remove_if_present(path: &Path) -> io::Result<()> {
    match std::fs::remove_file(path) {
        Err(error) if error.kind() != io::ErrorKind::NotFound => Err(error),
        _ => Ok(()),
    }
}

/// Record that `role` was used just now.
///
/// # Errors
///
/// Propagates filesystem errors.
pub(crate) fn touch(dirs: &StateDirs, role: Role) -> io::Result<()> {
    write_atomic(&dirs.touch_file(role), unix_now().to_string().as_bytes())
}

/// When `role` was last used, in seconds since the Unix epoch.
#[must_use]
pub(crate) fn last_touch(dirs: &StateDirs, role: Role) -> Option<u64> {
    std::fs::read_to_string(dirs.touch_file(role))
        .ok()?
        .trim()
        .parse()
        .ok()
}

/// Best-effort discovery of a currently running managed instance of `role`,
/// on the default aphrody state directory (`$APHRODY_HOME`, else
/// `~/.aphrody`; see [`aphrody_models::paths::state_dir`]).
///
/// This never spawns anything and never blocks on a model load: it reads the
/// [`RunState`] a live daemon already published and checks the daemon is
/// still alive, exactly what [`crate::Supervisor::status`] does for a caller
/// that already holds a `Supervisor`. Callers that only need "is a `role`
/// endpoint already up, and if so, where" — the one fallback CLAUDE.md's AI
/// environment contract allows in place of a hardcoded port — use this
/// directly instead of hardcoding a literal or standing up a `Supervisor`.
///
/// Returns `None` when the state directory cannot be resolved, no instance
/// has published state for `role`, or its daemon process is gone.
#[must_use]
pub fn discover_running(role: Role) -> Option<RunState> {
    let root = aphrody_models::paths::state_dir().ok()?;
    let dirs = StateDirs::new(root);
    read_state(&dirs, role).filter(|state| process_alive(state.daemon_pid))
}

#[cfg(test)]
mod tests {
    use pretty_assertions::assert_eq;

    use super::*;

    #[test]
    fn state_round_trips_and_garbage_reads_as_absent() {
        let dir = tempfile::tempdir().expect("tempdir");
        let dirs = StateDirs::new(dir.path());
        assert_eq!(read_state(&dirs, Role::Chat), None);

        let state = RunState {
            role: Role::Chat,
            daemon_pid: 10,
            server_pid: 11,
            port: 4242,
            fingerprint: "abc".into(),
            alias: "m".into(),
            model: PathBuf::from("m.gguf"),
            binary: PathBuf::from("llama-server"),
            started_unix: 1,
            ready: true,
        };
        write_state(&dirs, &state).expect("write");
        assert_eq!(read_state(&dirs, Role::Chat), Some(state.clone()));
        assert_eq!(
            read_state(&dirs, Role::Embed),
            None,
            "roles do not share state"
        );
        assert_eq!(state.base_url(), "http://127.0.0.1:4242/v1");

        std::fs::write(dirs.state_file(Role::Chat), "{ truncated").expect("write");
        assert_eq!(read_state(&dirs, Role::Chat), None);
    }

    #[test]
    fn touch_is_readable_and_removal_is_idempotent() {
        let dir = tempfile::tempdir().expect("tempdir");
        let dirs = StateDirs::new(dir.path());
        assert_eq!(last_touch(&dirs, Role::Chat), None);
        touch(&dirs, Role::Chat).expect("touch");
        let at = last_touch(&dirs, Role::Chat).expect("touched");
        assert!(unix_now() - at < 5);

        remove_if_present(&dirs.touch_file(Role::Chat)).expect("remove");
        remove_if_present(&dirs.touch_file(Role::Chat)).expect("remove again");
    }

    /// The only test in this binary touching `$APHRODY_HOME`.
    #[test]
    fn discover_running_reads_the_default_state_dir_and_ignores_a_dead_daemon() {
        let dir = tempfile::tempdir().expect("tempdir");
        // SAFETY: single-threaded within this test, and the only test in this
        // crate's suite reading or writing `APHRODY_HOME`.
        unsafe { std::env::set_var("APHRODY_HOME", dir.path()) };

        assert_eq!(discover_running(Role::Embed), None, "nothing published yet");

        let dirs = StateDirs::new(dir.path());
        let state = RunState {
            role: Role::Embed,
            daemon_pid: std::process::id(),
            server_pid: std::process::id(),
            port: 4343,
            fingerprint: "abc".into(),
            alias: "e5".into(),
            model: PathBuf::from("e5.gguf"),
            binary: PathBuf::from("llama-server"),
            started_unix: unix_now(),
            ready: true,
        };
        write_state(&dirs, &state).expect("write");
        assert_eq!(
            discover_running(Role::Embed),
            Some(state),
            "this process is alive"
        );
        assert_eq!(
            discover_running(Role::Chat),
            None,
            "roles do not share state"
        );

        let mut dead = read_state(&dirs, Role::Embed).expect("state").clone();
        dead.daemon_pid = 0;
        write_state(&dirs, &dead).expect("write");
        assert_eq!(
            discover_running(Role::Embed),
            None,
            "pid 0 never counts as alive"
        );

        // SAFETY: see above.
        unsafe { std::env::remove_var("APHRODY_HOME") };
    }
}
