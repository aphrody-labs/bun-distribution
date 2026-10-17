// SPDX-License-Identifier: Apache-2.0
//! Attach-or-spawn access to a managed `llama-server`.

use aphrody_proc::NoWindow as _;
use std::{
    fs::OpenOptions,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    time::{Duration, Instant},
};

use aphrody_proc::{FileLock, LockKind, process_alive, spawn_detached, terminate_process};

use crate::{
    client::{Health, ServerClient},
    daemon::DaemonRequest,
    plan::Plan,
    spec::Role,
    state::{RunState, StateDirs, read_state, remove_if_present, touch, unix_now, write_atomic},
};

/// Default idle period after which an instance shuts itself down.
pub const DEFAULT_KEEP_ALIVE: Duration = Duration::from_secs(15 * 60);
/// Default time a model may take to load.
pub const DEFAULT_READY_TIMEOUT: Duration = Duration::from_secs(180);
/// Default wait for the GPU lease.
pub const DEFAULT_LEASE_TIMEOUT: Duration = Duration::from_secs(30);
/// How long a graceful stop may take before the processes are killed.
const STOP_GRACE: Duration = Duration::from_secs(10);
/// How often a waiting client looks at the daemon's files.
const POLL_INTERVAL: Duration = Duration::from_millis(200);
/// How long a client waits for another client's launch of the same role.
const ROLE_LOCK_TIMEOUT: Duration = Duration::from_secs(300);

/// How to start the daemon process.
///
/// The daemon is either the standalone `aphrody-llama-daemon` binary or the
/// `aphrody` CLI re-invoked with a hidden subcommand; both end up in
/// [`crate::daemon::run`]. Whatever `args` are given, the supervisor appends
/// `--state-root <dir> --role <role>`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DaemonCommand {
    /// The executable.
    pub program: PathBuf,
    /// Leading arguments (for a multi-command binary).
    pub args: Vec<String>,
}

impl DaemonCommand {
    /// The `aphrody-llama-daemon` binary installed next to the current
    /// executable.
    ///
    /// # Errors
    ///
    /// Fails when the current executable cannot be located or no daemon binary
    /// sits beside it.
    pub fn sibling_binary() -> std::io::Result<Self> {
        let current = std::env::current_exe()?;
        let name = format!("aphrody-llama-daemon{}", std::env::consts::EXE_SUFFIX);
        let program = current.with_file_name(name);
        if !program.is_file() {
            return Err(std::io::Error::new(
                std::io::ErrorKind::NotFound,
                format!("{} not found", program.display()),
            ));
        }
        Ok(Self {
            program,
            args: Vec::new(),
        })
    }
}

/// Launch knobs that are not part of the server spec.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct EnsureOptions {
    /// Idle period before the instance shuts down; `None` keeps it forever.
    pub keep_alive: Option<Duration>,
    /// How long the model may take to load.
    pub ready_timeout: Duration,
    /// How long to wait for the GPU when something incompatible holds it.
    pub lease_timeout: Duration,
}

impl Default for EnsureOptions {
    fn default() -> Self {
        Self {
            keep_alive: Some(DEFAULT_KEEP_ALIVE),
            ready_timeout: DEFAULT_READY_TIMEOUT,
            lease_timeout: DEFAULT_LEASE_TIMEOUT,
        }
    }
}

/// A ready instance.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Endpoint {
    /// The published state of the instance.
    pub state: RunState,
    /// Whether an already-running instance was reused (no model load).
    pub attached: bool,
}

impl Endpoint {
    /// The OpenAI-compatible API root (`http://127.0.0.1:PORT/v1`).
    #[must_use]
    pub fn base_url(&self) -> String {
        self.state.base_url()
    }

    /// A client for the instance's side channels.
    #[must_use]
    pub fn client(&self) -> ServerClient {
        ServerClient::new(self.state.server_url())
    }
}

/// A supervisor operation that failed.
#[derive(Debug, thiserror::Error)]
pub enum SupervisorError {
    /// Filesystem or spawn error.
    #[error("llama-server supervisor i/o error: {0}")]
    Io(#[from] std::io::Error),
    /// Another client held the role for too long.
    #[error("another process has been starting the `{role}` server for over {waited_secs}s")]
    RoleBusy {
        /// The contended role.
        role: &'static str,
        /// How long this client waited.
        waited_secs: u64,
    },
    /// The daemon reported why it could not bring the server up.
    #[error("llama-server failed to start: {0}")]
    Launch(String),
    /// The daemon died, or the deadline passed, without a ready server.
    #[error("llama-server did not become ready within {waited_secs}s. Log tail:\n{log_tail}")]
    NotReady {
        /// How long this client waited.
        waited_secs: u64,
        /// The end of the server log.
        log_tail: String,
    },
    /// The blocking helper task failed.
    #[error("supervisor task failed: {0}")]
    Task(String),
}

/// Client-side handle on the managed `llama-server` instances of one state dir.
#[derive(Debug, Clone)]
pub struct Supervisor {
    dirs: StateDirs,
    daemon: DaemonCommand,
}

impl Supervisor {
    /// A supervisor over the state directory `dirs`, starting daemons with
    /// `daemon`.
    #[must_use]
    pub fn new(dirs: StateDirs, daemon: DaemonCommand) -> Self {
        Self { dirs, daemon }
    }

    /// The shared directories.
    #[must_use]
    pub fn dirs(&self) -> &StateDirs {
        &self.dirs
    }

    /// The live instance of `role`, if its daemon is still running. A state
    /// file left by a killed daemon is ignored (and cleaned up by the next
    /// [`Supervisor::ensure`]).
    #[must_use]
    pub fn status(&self, role: Role) -> Option<RunState> {
        read_state(&self.dirs, role).filter(|state| process_alive(state.daemon_pid))
    }

    /// Note that `role` is in use, postponing its idle shutdown. Clients call
    /// this around each request batch.
    ///
    /// # Errors
    ///
    /// Propagates filesystem errors.
    pub fn touch(&self, role: Role) -> std::io::Result<()> {
        touch(&self.dirs, role)
    }

    /// Make sure an instance matching `plan` is up, and return it.
    ///
    /// A running instance with the same spec fingerprint is reused; one with a
    /// different spec (another model, another context size) is stopped first.
    /// Concurrent callers for the same role are serialized, so two `aphrody`
    /// processes starting together load the model once.
    ///
    /// # Errors
    ///
    /// See [`SupervisorError`].
    pub async fn ensure(
        &self,
        binary: &Path,
        plan: &Plan,
        options: EnsureOptions,
    ) -> Result<Endpoint, SupervisorError> {
        let role = plan.spec.role;
        let lock_path = self.dirs.role_lock(role);
        let lock = tokio::task::spawn_blocking(move || {
            FileLock::acquire(lock_path, LockKind::Exclusive, ROLE_LOCK_TIMEOUT)
        })
        .await
        .map_err(|error| SupervisorError::Task(error.to_string()))??;
        let Some(_lock) = lock else {
            return Err(SupervisorError::RoleBusy {
                role: role.as_str(),
                waited_secs: ROLE_LOCK_TIMEOUT.as_secs(),
            });
        };

        let fingerprint = plan.spec.fingerprint();
        if let Some(state) = self.status(role) {
            if state.fingerprint == fingerprint {
                // Ready or still loading: either way it is the instance we want.
                let client = ServerClient::new(state.server_url());
                if !matches!(client.health().await, Health::Down(_)) {
                    let state = self
                        .wait_ready(role, state.daemon_pid, options.ready_timeout)
                        .await?;
                    self.touch(role)?;
                    return Ok(Endpoint {
                        state,
                        attached: true,
                    });
                }
            }
            // Wrong model, or a daemon whose server no longer answers.
            self.stop_locked(role).await?;
        }

        self.clear_stale_files(role)?;
        let request = DaemonRequest {
            binary: binary.to_path_buf(),
            spec: plan.spec.clone(),
            estimated_vram_bytes: plan.estimated_vram_bytes,
            keep_alive_secs: options
                .keep_alive
                .map(|keep_alive| keep_alive.as_secs().max(1)),
            ready_timeout_secs: options.ready_timeout.as_secs().max(1),
            lease_timeout_secs: options.lease_timeout.as_secs(),
        };
        write_atomic(
            &self.dirs.spec_file(role),
            &serde_json::to_vec_pretty(&request).map_err(std::io::Error::other)?,
        )?;
        // Count the launch itself as a use, so a short keep-alive cannot expire
        // while the model is still loading.
        self.touch(role)?;

        let daemon_pid = self.spawn_daemon(role)?;
        let patience = options.ready_timeout + options.lease_timeout;
        let state = self.wait_ready(role, daemon_pid, patience).await?;
        Ok(Endpoint {
            state,
            attached: false,
        })
    }

    /// Start the daemon process for `role`, detached from this process.
    fn spawn_daemon(&self, role: Role) -> std::io::Result<u32> {
        let log_path = self.dirs.log_file(role);
        if let Some(parent) = log_path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let log = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&log_path)?;

        let mut command = Command::new(&self.daemon.program).no_window();
        command
            .args(&self.daemon.args)
            .arg("--state-root")
            .arg(self.dirs.root())
            .args(["--role", role.as_str()])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            // The daemon's own diagnostics land next to the server's.
            .stderr(Stdio::from(log));
        spawn_detached(&mut command)
    }

    /// Wait until the daemon `daemon_pid` publishes a ready state for `role`.
    async fn wait_ready(
        &self,
        role: Role,
        daemon_pid: u32,
        timeout: Duration,
    ) -> Result<RunState, SupervisorError> {
        let started = Instant::now();
        // The daemon enforces the load timeout itself; allow it a little longer
        // so its precise error wins over this generic one.
        let deadline = timeout + Duration::from_secs(10);
        loop {
            if let Some(state) = read_state(&self.dirs, role)
                && state.ready
                && state.daemon_pid == daemon_pid
            {
                return Ok(state);
            }
            if let Ok(message) = std::fs::read_to_string(self.dirs.error_file(role)) {
                return Err(SupervisorError::Launch(message));
            }
            let gave_up = started.elapsed() >= deadline;
            if gave_up || !process_alive(daemon_pid) {
                // One last look: the daemon may have published and exited
                // (or failed) between the checks above and its death.
                if let Ok(message) = std::fs::read_to_string(self.dirs.error_file(role)) {
                    return Err(SupervisorError::Launch(message));
                }
                return Err(SupervisorError::NotReady {
                    waited_secs: started.elapsed().as_secs(),
                    log_tail: self.log_tail(role),
                });
            }
            tokio::time::sleep(POLL_INTERVAL).await;
        }
    }

    /// Stop the instance of `role`. Returns whether one was running.
    ///
    /// # Errors
    ///
    /// See [`SupervisorError`].
    pub async fn stop(&self, role: Role) -> Result<bool, SupervisorError> {
        let lock_path = self.dirs.role_lock(role);
        let lock = tokio::task::spawn_blocking(move || {
            FileLock::acquire(lock_path, LockKind::Exclusive, ROLE_LOCK_TIMEOUT)
        })
        .await
        .map_err(|error| SupervisorError::Task(error.to_string()))??;
        if lock.is_none() {
            return Err(SupervisorError::RoleBusy {
                role: role.as_str(),
                waited_secs: ROLE_LOCK_TIMEOUT.as_secs(),
            });
        }
        self.stop_locked(role).await
    }

    /// Stop every role (what a training job does before taking the GPU).
    ///
    /// # Errors
    ///
    /// See [`SupervisorError`].
    pub async fn stop_all(&self) -> Result<Vec<Role>, SupervisorError> {
        let mut stopped = Vec::new();
        for role in [Role::Chat, Role::Embed, Role::Rerank] {
            if self.stop(role).await? {
                stopped.push(role);
            }
        }
        Ok(stopped)
    }

    /// [`Supervisor::stop`] with the role lock already held.
    async fn stop_locked(&self, role: Role) -> Result<bool, SupervisorError> {
        let Some(state) = read_state(&self.dirs, role) else {
            return Ok(false);
        };
        let was_running = process_alive(state.daemon_pid) || process_alive(state.server_pid);

        if process_alive(state.daemon_pid) {
            write_atomic(
                &self.dirs.stop_file(role),
                unix_now().to_string().as_bytes(),
            )?;
            let started = Instant::now();
            while process_alive(state.daemon_pid) && started.elapsed() < STOP_GRACE {
                tokio::time::sleep(POLL_INTERVAL).await;
            }
        }
        // A daemon that ignored the request, or a server orphaned by a killed
        // daemon: end them directly. Daemon first, so it cannot restart anything.
        for pid in [state.daemon_pid, state.server_pid] {
            if process_alive(pid) {
                terminate_process(pid)?;
            }
        }
        self.clear_stale_files(role)?;
        Ok(was_running)
    }

    /// Remove the files of an instance that is no longer running.
    fn clear_stale_files(&self, role: Role) -> std::io::Result<()> {
        for path in [
            self.dirs.state_file(role),
            self.dirs.stop_file(role),
            self.dirs.error_file(role),
        ] {
            remove_if_present(&path)?;
        }
        Ok(())
    }

    /// The end of the role's log, for error messages.
    fn log_tail(&self, role: Role) -> String {
        let Ok(text) = std::fs::read(self.dirs.log_file(role)) else {
            return String::from("(no log)");
        };
        let start = text.len().saturating_sub(4096);
        String::from_utf8_lossy(&text[start..]).trim().to_string()
    }
}
