// SPDX-License-Identifier: FSL-1.1-ALv2
// Derived from Spacedrive (drive/apps/tauri/src-tauri/src/main.rs), adopted as the Aphrody Drive
// file explorer.
//! Locate, start, probe and supervise `sd-daemon`, the explorer core.
//!
//! The binary is looked up like the desktop's agent broker: `$APHRODY_DRIVE_DAEMON`, then next
//! to the current executable (plain name, or the Tauri `externalBin` name with the target
//! triple), then `PATH`. The supervisor starts it with `--data-dir <data dir>`, restarts it with
//! a backoff when it exits, adopts a daemon that already serves the socket (a service install
//! or another desktop), and kills the child it owns when the application exits.

use aphrody_proc::NoWindow as _;
use std::{
    ffi::OsStr,
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
    time::{Duration, Instant},
};

use parking_lot::Mutex;
use serde_json::Value;
use tauri::{AppHandle, Emitter};
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader},
    net::TcpStream,
    sync::{Notify, watch},
};

use crate::rpc;

/// Environment override for the daemon binary.
pub const DAEMON_ENV: &str = "APHRODY_DRIVE_DAEMON";

/// The daemon binary name, without extension.
pub const DAEMON_NAME: &str = "sd-daemon";

/// The target triple this crate was built for (exported by `build.rs`).
const TARGET_TRIPLE: Option<&str> = option_env!("APHRODY_DRIVE_TARGET");

/// Candidate file names next to the executable: the plain name, then the Tauri `externalBin`
/// name suffixed with the target triple.
#[must_use]
pub fn daemon_file_names(exe_suffix: &str, target_triple: Option<&str>) -> Vec<String> {
    let mut names = vec![format!("{DAEMON_NAME}{exe_suffix}")];
    if let Some(triple) = target_triple {
        names.push(format!("{DAEMON_NAME}-{triple}{exe_suffix}"));
    }
    names
}

/// Pure lookup: the override, then the first existing candidate in `exe_dir`, then the first
/// existing candidate on the `PATH` list, and `None` when nothing exists.
#[must_use]
pub fn lookup_daemon(
    override_path: Option<&OsStr>,
    exe_dir: Option<&Path>,
    path_var: Option<&OsStr>,
    names: &[String],
) -> Option<PathBuf> {
    if let Some(path) = override_path.filter(|value| !value.is_empty()) {
        return Some(PathBuf::from(path));
    }
    let beside = exe_dir
        .into_iter()
        .flat_map(|dir| names.iter().map(move |name| dir.join(name)));
    let on_path = path_var
        .into_iter()
        .flat_map(std::env::split_paths)
        .flat_map(|dir| {
            names
                .iter()
                .map(move |name| dir.join(name))
                .collect::<Vec<_>>()
        });
    beside.chain(on_path).find(|candidate| candidate.is_file())
}

/// Locate `sd-daemon` for this process.
///
/// # Errors
/// When no candidate exists; the message lists where it looked.
pub fn find_daemon_binary() -> Result<PathBuf, String> {
    let names = daemon_file_names(std::env::consts::EXE_SUFFIX, TARGET_TRIPLE);
    let exe_dir = std::env::current_exe()
        .ok()
        .and_then(|exe| exe.parent().map(Path::to_path_buf));
    let override_path = std::env::var_os(DAEMON_ENV);
    let path_var = std::env::var_os("PATH");
    lookup_daemon(override_path.as_deref(), exe_dir.as_deref(), path_var.as_deref(), &names)
        .ok_or_else(|| {
            format!(
                "Daemon binary not found: set ${DAEMON_ENV}, or place one of {names:?} next to {} \
                 or on PATH (build it with `cargo build --manifest-path crates/os/kernel/comps/drive/Cargo.toml -p \
                 sd-core --bin sd-daemon`)",
                exe_dir
                    .as_deref()
                    .map_or_else(|| "the executable".into(), |dir| dir.display().to_string()),
            )
        })
}

/// Send one request line and read one response line.
///
/// # Errors
/// On connection, I/O or JSON failure.
pub async fn request(socket_addr: &str, request: &Value) -> Result<Value, String> {
    let stream = TcpStream::connect(socket_addr)
        .await
        .map_err(|error| format!("Failed to connect to daemon: {error}"))?;
    let (reader, mut writer) = stream.into_split();
    writer
        .write_all(rpc::encode_line(request)?.as_bytes())
        .await
        .map_err(|error| format!("Failed to write request: {error}"))?;
    let mut reader = BufReader::new(reader);
    let mut line = String::new();
    reader
        .read_line(&mut line)
        .await
        .map_err(|error| format!("Failed to read response: {error}"))?;
    rpc::decode_line(&line)
}

/// Whether a daemon answers a `Ping` on `socket_addr` within 500 ms.
pub async fn is_daemon_running(socket_addr: &str) -> bool {
    matches!(
        tokio::time::timeout(
            Duration::from_millis(500),
            request(socket_addr, &rpc::ping_request())
        )
        .await,
        Ok(Ok(_))
    )
}

/// Build the command that starts the daemon on `data_dir`, logging to `data_dir/logs`.
fn daemon_command(binary: &Path, data_dir: &Path) -> Command {
    let mut command = Command::new(binary).no_window();
    command.arg("--data-dir").arg(data_dir).stdin(Stdio::null());
    let logs = data_dir.join("logs");
    let log_file = std::fs::create_dir_all(&logs).and_then(|()| {
        std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(logs.join("daemon.log"))
    });
    match log_file.and_then(|file| file.try_clone().map(|clone| (file, clone))) {
        Ok((out, err)) => {
            command.stdout(out).stderr(err);
        }
        Err(_) => {
            command.stdout(Stdio::null()).stderr(Stdio::null());
        }
    }
    command
}

/// Restart delay after an exit: doubles while the daemon keeps dying young, resets once it
/// stayed up for a minute.
#[must_use]
pub fn next_backoff(previous: Duration, uptime: Duration) -> Duration {
    const MIN: Duration = Duration::from_secs(1);
    const MAX: Duration = Duration::from_secs(30);
    if uptime >= Duration::from_secs(60) {
        MIN
    } else {
        (previous * 2).clamp(MIN, MAX)
    }
}

/// Snapshot of the daemon for the frontend.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct DaemonStatus {
    pub running: bool,
    pub started_by_us: bool,
}

/// Owns the daemon child process and the supervision task.
pub struct Supervisor {
    app: AppHandle<tauri::DynRuntime>,
    socket_addr: String,
    data_dir: PathBuf,
    /// Whether the daemon should be kept running (false after stop / service install).
    desired: AtomicBool,
    /// Whether the supervision task was spawned.
    spawned: AtomicBool,
    /// Set once the application exits: the task ends and never restarts the daemon.
    exiting: AtomicBool,
    wake: Notify,
    child: Mutex<Option<Child>>,
    status: watch::Sender<DaemonStatus>,
}

impl Supervisor {
    #[must_use]
    pub fn new(
        app: AppHandle<tauri::DynRuntime>,
        socket_addr: String,
        data_dir: PathBuf,
    ) -> Arc<Self> {
        Arc::new(Self {
            app,
            socket_addr,
            data_dir,
            desired: AtomicBool::new(true),
            spawned: AtomicBool::new(false),
            exiting: AtomicBool::new(false),
            wake: Notify::new(),
            child: Mutex::new(None),
            status: watch::Sender::new(DaemonStatus::default()),
        })
    }

    #[must_use]
    pub fn socket_addr(&self) -> &str {
        &self.socket_addr
    }

    #[must_use]
    pub fn data_dir(&self) -> &Path {
        &self.data_dir
    }

    #[must_use]
    pub fn status(&self) -> DaemonStatus {
        self.status.borrow().clone()
    }

    /// Start supervising (idempotent): the daemon is started or adopted in the background.
    pub fn ensure_started(self: &Arc<Self>) {
        self.desired.store(true, Ordering::SeqCst);
        if !self.spawned.swap(true, Ordering::SeqCst) {
            let this = Arc::clone(self);
            tauri::async_runtime::spawn(async move { this.run().await });
        }
        self.wake.notify_one();
    }

    /// Start supervising and wait until a daemon answers, at most `timeout`.
    ///
    /// # Errors
    /// When no daemon answered in time.
    pub async fn wait_ready(self: &Arc<Self>, timeout: Duration) -> Result<(), String> {
        self.ensure_started();
        let mut status = self.status.subscribe();
        match tokio::time::timeout(timeout, status.wait_for(|status| status.running)).await {
            Ok(Ok(_)) => Ok(()),
            _ => Err(format!(
                "Daemon not available at {} after {timeout:?}",
                self.socket_addr
            )),
        }
    }

    /// Stop the daemon this supervisor started and stop restarting it.
    ///
    /// # Errors
    /// When the running daemon was not started by this supervisor.
    pub fn stop(&self) -> Result<(), String> {
        if !self.status().started_by_us {
            return Err("Cannot stop daemon we didn't start".to_string());
        }
        self.release();
        Ok(())
    }

    /// Stop restarting the daemon and kill the child this supervisor owns, if any.
    pub fn release(&self) {
        self.desired.store(false, Ordering::SeqCst);
        self.kill_child();
        self.wake.notify_one();
    }

    /// Application exit: never restart again, kill the child we own.
    pub fn shutdown(&self) {
        self.exiting.store(true, Ordering::SeqCst);
        self.release();
    }

    fn kill_child(&self) {
        if let Some(mut child) = self.child.lock().take() {
            log::info!("stopping sd-daemon (pid {})", child.id());
            let _ = child.kill();
            let _ = child.wait();
            self.set_status(false, false);
        }
    }

    fn set_status(&self, running: bool, started_by_us: bool) {
        let previous = self.status.send_replace(DaemonStatus {
            running,
            started_by_us,
        });
        if previous.running != running {
            let event = if running {
                "daemon-connected"
            } else {
                "daemon-disconnected"
            };
            let _ = self.app.emit(event, ());
        }
    }

    /// Spawn the daemon and wait (3 s) until it answers.
    async fn spawn_daemon(&self) -> Result<(), String> {
        let binary = find_daemon_binary()?;
        log::info!(
            "starting {} --data-dir {}",
            binary.display(),
            self.data_dir.display()
        );
        let _ = self.app.emit("daemon-starting", ());
        let child = daemon_command(&binary, &self.data_dir)
            .spawn()
            .map_err(|error| format!("Failed to start daemon {}: {error}", binary.display()))?;
        *self.child.lock() = Some(child);
        for attempt in 0..30 {
            tokio::time::sleep(Duration::from_millis(100)).await;
            if let Some(status) = self.child_exit() {
                return Err(format!("Daemon exited during startup: {status}"));
            }
            if is_daemon_running(&self.socket_addr).await {
                log::info!("sd-daemon ready at {}", self.socket_addr);
                return Ok(());
            }
            if attempt == 10 {
                log::warn!("sd-daemon is taking longer than expected to start");
            }
        }
        // Leave the child running: a slow first start (database migration) is still supervised.
        Err("Daemon failed to start (connection not available after 3 seconds)".to_string())
    }

    /// The exit status of the owned child, if it exited; clears it.
    fn child_exit(&self) -> Option<std::process::ExitStatus> {
        let mut guard = self.child.lock();
        let status = guard
            .as_mut()
            .and_then(|child| child.try_wait().ok().flatten());
        if status.is_some() {
            *guard = None;
        }
        status
    }

    async fn run(self: Arc<Self>) {
        let mut backoff = Duration::from_secs(1);
        loop {
            if self.exiting.load(Ordering::SeqCst) {
                return;
            }
            if !self.desired.load(Ordering::SeqCst) {
                // Stopped or handed over to a service: keep reporting liveness, spawn nothing.
                let running = is_daemon_running(&self.socket_addr).await;
                self.set_status(running, false);
                let _ = tokio::time::timeout(Duration::from_secs(2), self.wake.notified()).await;
                continue;
            }
            if self.child.lock().is_none() && is_daemon_running(&self.socket_addr).await {
                // Adopt a daemon someone else started (service, CLI, another desktop).
                self.set_status(true, false);
                let _ = tokio::time::timeout(Duration::from_secs(2), self.wake.notified()).await;
                continue;
            }
            let started = Instant::now();
            match self.spawn_daemon().await {
                Ok(()) => self.set_status(true, true),
                Err(error) => log::error!("sd-daemon: {error}"),
            }
            // Watch the child until it exits, or until we are asked to stop.
            while self.child.lock().is_some() && self.desired.load(Ordering::SeqCst) {
                if let Some(status) = self.child_exit() {
                    log::warn!("sd-daemon exited: {status}");
                    break;
                }
                if !self.status().running && is_daemon_running(&self.socket_addr).await {
                    self.set_status(true, true);
                }
                let _ =
                    tokio::time::timeout(Duration::from_millis(500), self.wake.notified()).await;
            }
            if self.exiting.load(Ordering::SeqCst) {
                return;
            }
            self.set_status(false, false);
            if !self.desired.load(Ordering::SeqCst) {
                continue;
            }
            backoff = next_backoff(backoff, started.elapsed());
            log::info!("restarting sd-daemon in {backoff:?}");
            let _ = tokio::time::timeout(backoff, self.wake.notified()).await;
        }
    }
}

impl Drop for Supervisor {
    fn drop(&mut self) {
        if let Some(mut child) = self.child.get_mut().take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn touch(path: &Path) {
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, b"").unwrap();
    }

    #[test]
    fn file_names_include_the_external_bin_triple() {
        assert_eq!(daemon_file_names("", None), vec!["sd-daemon"]);
        assert_eq!(
            daemon_file_names(".exe", Some("x86_64-pc-windows-msvc")),
            vec!["sd-daemon.exe", "sd-daemon-x86_64-pc-windows-msvc.exe"]
        );
    }

    #[test]
    fn override_is_returned_even_if_missing() {
        let names = daemon_file_names("", None);
        let found = lookup_daemon(Some(OsStr::new("/opt/sd-daemon")), None, None, &names);
        assert_eq!(found, Some(PathBuf::from("/opt/sd-daemon")));
    }

    #[test]
    fn lookup_order_is_override_then_beside_exe_then_path() {
        let root = tempfile::tempdir().unwrap();
        let exe_dir = root.path().join("bin");
        let path_a = root.path().join("path-a");
        let path_b = root.path().join("path-b");
        let names = daemon_file_names("", Some("triple"));
        let path_var = std::env::join_paths([&path_a, &path_b]).unwrap();

        // Nothing anywhere.
        assert_eq!(
            lookup_daemon(None, Some(&exe_dir), Some(&path_var), &names),
            None
        );

        // Only on the second PATH entry, under the triple name.
        touch(&path_b.join("sd-daemon-triple"));
        assert_eq!(
            lookup_daemon(None, Some(&exe_dir), Some(&path_var), &names),
            Some(path_b.join("sd-daemon-triple"))
        );

        // The first PATH entry wins over the second.
        touch(&path_a.join("sd-daemon"));
        assert_eq!(
            lookup_daemon(None, Some(&exe_dir), Some(&path_var), &names),
            Some(path_a.join("sd-daemon"))
        );

        // Beside the executable wins over PATH; the plain name wins over the triple name.
        touch(&exe_dir.join("sd-daemon-triple"));
        assert_eq!(
            lookup_daemon(None, Some(&exe_dir), Some(&path_var), &names),
            Some(exe_dir.join("sd-daemon-triple"))
        );
        touch(&exe_dir.join("sd-daemon"));
        assert_eq!(
            lookup_daemon(None, Some(&exe_dir), Some(&path_var), &names),
            Some(exe_dir.join("sd-daemon"))
        );

        // The override wins over everything; an empty override is ignored.
        assert_eq!(
            lookup_daemon(
                Some(OsStr::new("/x/sd")),
                Some(&exe_dir),
                Some(&path_var),
                &names
            ),
            Some(PathBuf::from("/x/sd"))
        );
        assert_eq!(
            lookup_daemon(
                Some(OsStr::new("")),
                Some(&exe_dir),
                Some(&path_var),
                &names
            ),
            Some(exe_dir.join("sd-daemon"))
        );
    }

    #[test]
    fn directories_are_not_binaries() {
        let root = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(root.path().join("sd-daemon")).unwrap();
        let names = daemon_file_names("", None);
        assert_eq!(lookup_daemon(None, Some(root.path()), None, &names), None);
    }

    #[test]
    fn backoff_doubles_then_resets() {
        let second = Duration::from_secs(1);
        assert_eq!(next_backoff(second, Duration::ZERO), Duration::from_secs(2));
        assert_eq!(
            next_backoff(Duration::from_secs(20), Duration::ZERO),
            Duration::from_secs(30)
        );
        assert_eq!(
            next_backoff(Duration::from_secs(20), Duration::from_secs(61)),
            second
        );
        assert_eq!(next_backoff(Duration::ZERO, Duration::ZERO), second);
    }

    #[tokio::test]
    async fn request_round_trips_one_line_and_ping_probes() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap().to_string();
        let server = tokio::spawn(async move {
            for _ in 0..2 {
                let (stream, _) = listener.accept().await.unwrap();
                let (reader, mut writer) = stream.into_split();
                let mut line = String::new();
                BufReader::new(reader).read_line(&mut line).await.unwrap();
                let request: Value = serde_json::from_str(&line).unwrap();
                let reply = serde_json::json!({ "JsonOk": request });
                writer
                    .write_all(format!("{reply}\n").as_bytes())
                    .await
                    .unwrap();
            }
        });
        let reply = request(&addr, &serde_json::json!({"Query": {"method": "m"}}))
            .await
            .unwrap();
        assert_eq!(
            reply,
            serde_json::json!({"JsonOk": {"Query": {"method": "m"}}})
        );
        assert!(is_daemon_running(&addr).await);
        server.await.unwrap();
        // Nothing listens there any more.
        assert!(!is_daemon_running(&addr).await);
    }
}
