// SPDX-License-Identifier: Apache-2.0
//! The daemon that owns one `llama-server` process.
//!
//! A model takes seconds to load, so the server has to outlive the `aphrody`
//! invocation that needed it — but it must not hold VRAM forever either. The
//! daemon is the long-lived owner: it holds the GPU lease, runs the server as a
//! kill-on-drop process group, publishes the [`RunState`], and shuts everything
//! down when a client asks, when the server dies, or when nobody has used the
//! instance for the keep-alive period.
//!
//! [`run`] is the daemon's whole life. It is hosted by the
//! `aphrody-llama-daemon` binary and by the CLI's hidden daemon subcommand;
//! both call it from their main thread, which the Linux parent-death signal
//! relies on (see [`aphrody_proc::SpawnOptions`]).

use aphrody_proc::NoWindow as _;
use std::{
    fs::OpenOptions,
    path::PathBuf,
    process::{Command, Stdio},
    time::{Duration, Instant},
};

use aphrody_proc::{
    GpuLease, GroupChild, LeaseError, LeaseKind, SpawnOptions, free_port, spawn_group,
};
use serde::{Deserialize, Serialize};

use crate::{
    caps::{CapabilityError, ServerCapabilities},
    client::{Health, ServerClient},
    spec::{LlamaServerSpec, Placement, Role},
    state::{
        RunState, StateDirs, last_touch, read_state, remove_if_present, unix_now, write_state,
    },
};

/// Loopback only: the server is a private backend of this machine's agent.
const HOST: &str = "127.0.0.1";
/// How often the daemon looks at its server and its control files.
const SUPERVISE_INTERVAL: Duration = Duration::from_millis(500);
/// How often `/health` is polled while the model loads.
const READY_POLL_INTERVAL: Duration = Duration::from_millis(250);
/// A port taken between allocation and bind is retried this many times.
const PORT_ATTEMPTS: u32 = 3;
/// Bytes of the server log quoted in an error.
const LOG_TAIL_BYTES: u64 = 4096;

/// What the supervisor hands to the daemon (the content of the spec file).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct DaemonRequest {
    /// The `llama-server` binary.
    pub binary: PathBuf,
    /// What to launch.
    pub spec: LlamaServerSpec,
    /// VRAM the instance declares on the GPU lease.
    pub estimated_vram_bytes: u64,
    /// Shut down after this many idle seconds; `None` = never.
    pub keep_alive_secs: Option<u64>,
    /// How long the model may take to load before the launch is abandoned.
    pub ready_timeout_secs: u64,
    /// How long to wait for the GPU lease (a training job holds it exclusively).
    pub lease_timeout_secs: u64,
}

/// Why a daemon ended normally.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ExitReason {
    /// A client asked for shutdown.
    Stopped,
    /// Nobody used the instance for the keep-alive period.
    Idle,
    /// The server process exited on its own.
    ServerExited(Option<i32>),
}

/// Why a daemon could not bring its server up.
#[derive(Debug, thiserror::Error)]
pub enum DaemonError {
    /// The spec file is missing or unreadable.
    #[error("cannot read the launch request {path}: {message}")]
    Request {
        /// The spec file.
        path: String,
        /// What went wrong.
        message: String,
    },
    /// The GPU is held by something incompatible (a training job).
    #[error(transparent)]
    Lease(#[from] LeaseError),
    /// The binary is not a usable llama-server.
    #[error(transparent)]
    Capabilities(#[from] CapabilityError),
    /// Filesystem or spawn error.
    #[error("llama-server daemon i/o error: {0}")]
    Io(#[from] std::io::Error),
    /// The server exited before becoming ready.
    #[error("llama-server exited during startup (status {status:?}). Log tail:\n{log_tail}")]
    StartupExit {
        /// Exit code, when there is one.
        status: Option<i32>,
        /// The end of the server log.
        log_tail: String,
    },
    /// The model did not finish loading in time.
    #[error("llama-server was not ready after {waited_secs}s. Log tail:\n{log_tail}")]
    StartupTimeout {
        /// How long the daemon waited.
        waited_secs: u64,
        /// The end of the server log.
        log_tail: String,
    },
}

/// The end of the server log, for error messages.
fn log_tail(dirs: &StateDirs, role: Role) -> String {
    use std::io::{Read as _, Seek as _, SeekFrom};
    let Ok(mut file) = std::fs::File::open(dirs.log_file(role)) else {
        return String::from("(no log)");
    };
    let len = file.metadata().map_or(0, |metadata| metadata.len());
    let _ = file.seek(SeekFrom::Start(len.saturating_sub(LOG_TAIL_BYTES)));
    let mut bytes = Vec::new();
    let _ = file.read_to_end(&mut bytes);
    String::from_utf8_lossy(&bytes).trim().to_string()
}

/// Whether the log says the server lost the race for its port.
fn port_was_taken(tail: &str) -> bool {
    let tail = tail.to_ascii_lowercase();
    tail.contains("address already in use")
        || tail.contains("couldn't bind")
        || tail.contains("failed to bind")
        || tail.contains("bind failed")
}

/// Start the server on a fresh port, its output appended to the role's log.
fn spawn_server(
    dirs: &StateDirs,
    request: &DaemonRequest,
    caps: &ServerCapabilities,
    port: u16,
) -> std::io::Result<GroupChild> {
    let log_path = dirs.log_file(request.spec.role);
    if let Some(parent) = log_path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let log = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_path)?;

    let mut command = Command::new(&request.binary).no_window();
    command
        .args(request.spec.to_args(caps, HOST, port))
        .stdin(Stdio::null())
        .stdout(Stdio::from(log.try_clone()?))
        .stderr(Stdio::from(log));
    spawn_group(
        &mut command,
        SpawnOptions {
            die_with_parent_thread: true,
            ..SpawnOptions::default()
        },
    )
}

/// Wait for `/health` to answer 200, watching for an early exit.
async fn wait_ready(
    dirs: &StateDirs,
    role: Role,
    child: &mut GroupChild,
    client: &ServerClient,
    timeout: Duration,
) -> Result<(), DaemonError> {
    let started = Instant::now();
    loop {
        if let Some(status) = child.try_wait()? {
            return Err(DaemonError::StartupExit {
                status: status.code(),
                log_tail: log_tail(dirs, role),
            });
        }
        if client.health().await == Health::Ready {
            return Ok(());
        }
        if started.elapsed() >= timeout {
            return Err(DaemonError::StartupTimeout {
                waited_secs: started.elapsed().as_secs(),
                log_tail: log_tail(dirs, role),
            });
        }
        tokio::time::sleep(READY_POLL_INTERVAL).await;
    }
}

/// Remove everything this daemon published for `role` — unless another daemon
/// has taken the role over in the meantime, whose files these now are.
fn unpublish(dirs: &StateDirs, role: Role) {
    let replaced =
        read_state(dirs, role).is_some_and(|current| current.daemon_pid != std::process::id());
    if replaced {
        return;
    }
    for path in [
        dirs.state_file(role),
        dirs.stop_file(role),
        dirs.touch_file(role),
    ] {
        if let Err(error) = remove_if_present(&path) {
            tracing::warn!(path = %path.display(), %error, "failed to remove daemon state file");
        }
    }
}

/// Run the daemon for `role` until its server ends, and return why.
///
/// Reads the [`DaemonRequest`] the supervisor wrote for `role`, takes the GPU
/// lease, starts the server, publishes the [`RunState`] (first with
/// `ready = false`, then `true`), applies the LoRA scales, and supervises.
/// Whatever the outcome, the server tree is killed and the published state is
/// removed before returning.
///
/// # Errors
///
/// See [`DaemonError`]: the server could not be brought up.
pub async fn run(dirs: &StateDirs, role: Role) -> Result<ExitReason, DaemonError> {
    let _ = remove_if_present(&dirs.error_file(role));
    let outcome = launch_and_supervise(dirs, role).await;
    if let Err(error) = &outcome {
        // The client that spawned us is polling for a state file that will
        // never come; tell it why.
        if let Err(write_error) =
            crate::state::write_atomic(&dirs.error_file(role), error.to_string().as_bytes())
        {
            tracing::warn!(%write_error, "failed to publish the launch error");
        }
    }
    outcome
}

async fn launch_and_supervise(dirs: &StateDirs, role: Role) -> Result<ExitReason, DaemonError> {
    let spec_path = dirs.spec_file(role);
    let request_error = |message: String| DaemonError::Request {
        path: spec_path.display().to_string(),
        message,
    };
    let bytes = std::fs::read(&spec_path).map_err(|error| request_error(error.to_string()))?;
    let request: DaemonRequest =
        serde_json::from_slice(&bytes).map_err(|error| request_error(error.to_string()))?;
    if request.spec.role != role {
        return Err(request_error(format!(
            "the request is for role `{}`, the daemon was started for `{}`",
            request.spec.role.as_str(),
            role.as_str()
        )));
    }

    let caps = ServerCapabilities::probe(&request.binary)?;
    request
        .spec
        .validate_capabilities(&caps)
        .map_err(|message| request_error(message.into()))?;

    // A CPU-only instance occupies no VRAM and needs no lease.
    let _lease = if request.spec.placement == Placement::Cpu {
        None
    } else {
        Some(GpuLease::acquire(
            dirs.locks(),
            &format!("llama-{}", role.as_str()),
            LeaseKind::Inference,
            request.estimated_vram_bytes,
            Duration::from_secs(request.lease_timeout_secs),
        )?)
    };

    let outcome = serve(dirs, &request, &caps).await;
    unpublish(dirs, role);
    outcome
}

/// Bring the server up (retrying a lost port race) and supervise it.
async fn serve(
    dirs: &StateDirs,
    request: &DaemonRequest,
    caps: &ServerCapabilities,
) -> Result<ExitReason, DaemonError> {
    let role = request.spec.role;
    let ready_timeout = Duration::from_secs(request.ready_timeout_secs.max(1));

    let mut attempt = 0;
    let (mut child, state, client) = loop {
        attempt += 1;
        let port = free_port()?;
        let mut child = spawn_server(dirs, request, caps, port)?;
        let mut state = RunState {
            role,
            daemon_pid: std::process::id(),
            server_pid: child.id(),
            port,
            fingerprint: request.spec.fingerprint(),
            alias: request.spec.alias.clone(),
            model: request.spec.model.clone(),
            binary: request.binary.clone(),
            started_unix: unix_now(),
            ready: false,
        };
        write_state(dirs, &state)?;

        let client = ServerClient::new(state.server_url());
        match wait_ready(dirs, role, &mut child, &client, ready_timeout).await {
            Ok(()) => {
                state.ready = true;
                break (child, state, client);
            }
            Err(DaemonError::StartupExit { ref log_tail, .. })
                if attempt < PORT_ATTEMPTS && port_was_taken(log_tail) =>
            {
                tracing::warn!(
                    port,
                    attempt,
                    "llama-server lost the race for its port, retrying"
                );
            }
            Err(error) => return Err(error),
        }
    };

    // Adapters were loaded inactive; give them their scales now.
    if caps.lora_init_without_apply && !request.spec.lora.is_empty() {
        let scales: Vec<(u32, f32)> = request
            .spec
            .lora
            .iter()
            .enumerate()
            .map(|(index, adapter)| (u32::try_from(index).unwrap_or(u32::MAX), adapter.scale))
            .collect();
        if let Err(error) = client.set_lora_scales(&scales).await {
            tracing::warn!(%error, "failed to apply LoRA scales; adapters stay inactive");
        }
    }

    write_state(dirs, &state)?;
    tracing::info!(
        role = role.as_str(),
        port = state.port,
        pid = state.server_pid,
        "llama-server ready"
    );

    let reason = supervise(dirs, request, &mut child, &state).await?;
    child.kill_tree()?;
    Ok(reason)
}

/// Watch the server until something ends it.
async fn supervise(
    dirs: &StateDirs,
    request: &DaemonRequest,
    child: &mut GroupChild,
    state: &RunState,
) -> Result<ExitReason, DaemonError> {
    let role = request.spec.role;
    loop {
        tokio::time::sleep(SUPERVISE_INTERVAL).await;

        if let Some(status) = child.try_wait()? {
            return Ok(ExitReason::ServerExited(status.code()));
        }
        if dirs.stop_file(role).exists() {
            return Ok(ExitReason::Stopped);
        }
        // Another daemon replaced us (a client re-spawned after deciding this
        // instance was gone): step aside rather than fight over the role.
        if read_state(dirs, role).is_some_and(|current| current.daemon_pid != state.daemon_pid) {
            return Ok(ExitReason::Stopped);
        }
        if let Some(keep_alive) = request.keep_alive_secs {
            let last_used = last_touch(dirs, role).unwrap_or(0).max(state.started_unix);
            if unix_now().saturating_sub(last_used) >= keep_alive {
                return Ok(ExitReason::Idle);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn port_race_is_recognised_in_the_log() {
        assert!(port_was_taken(
            "main: couldn't bind HTTP server socket, hostname: 127.0.0.1"
        ));
        assert!(port_was_taken("bind: Address already in use"));
        assert!(!port_was_taken("error loading model: unknown architecture"));
    }
}
