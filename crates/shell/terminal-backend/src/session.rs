// SPDX-License-Identifier: Apache-2.0
//! Transport-free pty session.
//!
//! [`PtySession`] owns one shell running in a pseudo-terminal. Output and the final exit are
//! delivered as [`PtyEvent`]s on a caller-supplied bounded channel; input and resizes go through
//! methods. The WebSocket server and in-process hosts (the desktop app) are both clients of it.

use std::{
    io::{Read as _, Write as _},
    sync::{
        Arc, Mutex, MutexGuard, PoisonError,
        atomic::{AtomicBool, Ordering},
    },
    time::Duration,
};

use anyhow::{Context as _, Result, anyhow};
use portable_pty::{ChildKiller, CommandBuilder, MasterPty, PtySize, native_pty_system};
use tokio::{sync::mpsc, task::JoinHandle};
use tracing::{debug, warn};

use crate::{PtyConfig, TerminalState, default_shell};

/// How long the teardown of a session waits for the shell to exit and its output to drain.
///
/// A process that outlives the shell (for example a background job) can keep the pty open, so
/// the wait is bounded instead of pinning the session forever.
pub const TEARDOWN_TIMEOUT: Duration = Duration::from_secs(5);

/// Something the session reports to its host.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PtyEvent {
    /// Raw bytes read from the pty, never re-encoded.
    Output(Vec<u8>),
    /// The shell exited and its output was drained. Sent once, after every `Output`.
    Exit {
        /// Exit code, when the platform reported one.
        code: Option<u32>,
    },
}

type SharedMaster = Arc<Mutex<Option<Box<dyn MasterPty + Send>>>>;

/// One shell running in a pseudo-terminal.
///
/// Dropping the session stops a still-running shell; [`PtySession::close`] does the same and
/// also waits (bounded by [`TEARDOWN_TIMEOUT`]) for the output to drain.
pub struct PtySession {
    master: SharedMaster,
    input: Option<mpsc::Sender<Vec<u8>>>,
    killer: Box<dyn ChildKiller + Send + Sync>,
    exited: Arc<AtomicBool>,
    supervisor: Option<JoinHandle<()>>,
    writer_task: Option<JoinHandle<()>>,
    terminal_state: Option<Arc<Mutex<TerminalState>>>,
}

impl std::fmt::Debug for PtySession {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("PtySession").field("exited", &self.has_exited()).finish_non_exhaustive()
    }
}

fn lock(master: &SharedMaster) -> MutexGuard<'_, Option<Box<dyn MasterPty + Send>>> {
    master.lock().unwrap_or_else(PoisonError::into_inner)
}

impl PtySession {
    /// Opens a pty sized from `cfg`, starts the shell in it and begins streaming to `events`.
    ///
    /// Must be called inside a Tokio runtime. When `events` is full the reader waits, so no
    /// output is ever dropped; once the receiver is gone the output is drained and discarded.
    pub fn spawn(cfg: &PtyConfig, events: mpsc::Sender<PtyEvent>) -> Result<Self> {
        Self::spawn_impl(cfg, events, false)
    }

    /// Opens a PTY with Rio VT state attached for native hosts.
    ///
    /// Hosts that already run a VT engine (such as the desktop webview) must use [`Self::spawn`]
    /// instead, so terminal queries are answered by exactly one emulator.
    pub fn spawn_with_terminal_state(
        cfg: &PtyConfig,
        events: mpsc::Sender<PtyEvent>,
    ) -> Result<Self> {
        Self::spawn_impl(cfg, events, true)
    }

    fn spawn_impl(
        cfg: &PtyConfig,
        events: mpsc::Sender<PtyEvent>,
        with_terminal_state: bool,
    ) -> Result<Self> {
        let pair = native_pty_system()
            .openpty(PtySize { rows: cfg.rows, cols: cfg.cols, pixel_width: 0, pixel_height: 0 })
            .context("openpty")?;

        let shell = cfg.shell.clone().unwrap_or_else(default_shell);
        let mut cmd = CommandBuilder::new(&shell);
        cmd.args(&cfg.args);
        for (key, value) in &cfg.env {
            cmd.env(key, value);
        }
        if let Some(cwd) = &cfg.cwd {
            cmd.cwd(cwd);
        }

        let mut child = pair.slave.spawn_command(cmd).with_context(|| format!("spawn {shell}"))?;
        // The slave is owned by the child now; the master carries I/O and resizes.
        drop(pair.slave);
        let killer = child.clone_killer();
        let mut reader = pair.master.try_clone_reader().context("clone pty reader")?;
        let writer = pair.master.take_writer().context("take pty writer")?;
        let master: SharedMaster = Arc::new(Mutex::new(Some(pair.master)));
        let terminal_state = with_terminal_state
            .then(|| Arc::new(Mutex::new(TerminalState::new(cfg.cols, cfg.rows))));

        let (input, mut input_rx) = mpsc::channel::<Vec<u8>>(256);
        let writer_task = tokio::task::spawn_blocking(move || {
            let mut writer = writer;
            while let Some(data) = input_rx.blocking_recv() {
                if writer.write_all(&data).and_then(|()| writer.flush()).is_err() {
                    break;
                }
            }
        });

        // portable_pty I/O is synchronous, so each direction runs on a blocking thread.
        let output = events.clone();
        let terminal = terminal_state.clone();
        let replies = input.clone();
        let reader_task = tokio::task::spawn_blocking(move || {
            let mut buf = [0u8; 4096];
            let mut forwarding = true;
            loop {
                match reader.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => {
                        if let Some(terminal) = &terminal {
                            let responses = {
                                let mut state =
                                    terminal.lock().unwrap_or_else(PoisonError::into_inner);
                                state.ingest(&buf[..n]);
                                state.take_replies()
                            };
                            for response in responses {
                                if replies.blocking_send(response.into_bytes()).is_err() {
                                    break;
                                }
                            }
                        }
                        // Keep draining after the host leaves: on Windows, closing the
                        // pseudoconsole can wait until its last frame has been read.
                        if forwarding
                            && output.blocking_send(PtyEvent::Output(buf[..n].to_vec())).is_err()
                        {
                            forwarding = false;
                        }
                    },
                    Err(e) => {
                        debug!("pty read error: {e}");
                        break;
                    },
                }
            }
        });

        let exited = Arc::new(AtomicBool::new(false));
        let waiter = {
            let exited = Arc::clone(&exited);
            tokio::task::spawn_blocking(move || {
                let code = match child.wait() {
                    Ok(status) => Some(status.exit_code()),
                    Err(e) => {
                        debug!("wait for shell: {e}");
                        None
                    },
                };
                exited.store(true, Ordering::SeqCst);
                code
            })
        };

        // Once the shell is gone, close the master (ClosePseudoConsole on Windows) so the reader
        // reaches EOF, then report the exit after the last output.
        let supervisor = {
            let master = Arc::clone(&master);
            tokio::spawn(async move {
                let code = waiter.await.ok().flatten();
                let taken = lock(&master).take();
                let close = tokio::task::spawn_blocking(move || drop(taken));
                let drained = tokio::time::timeout(TEARDOWN_TIMEOUT, async {
                    let _ = close.await;
                    let _ = reader_task.await;
                })
                .await;
                if drained.is_err() {
                    warn!("pty teardown timed out: a process still holds the pty open");
                }
                let _ = events.send(PtyEvent::Exit { code }).await;
            })
        };

        Ok(Self {
            master,
            input: Some(input),
            killer,
            exited,
            supervisor: Some(supervisor),
            writer_task: Some(writer_task),
            terminal_state,
        })
    }

    /// Whether the shell process has exited.
    #[must_use]
    pub fn has_exited(&self) -> bool {
        self.exited.load(Ordering::SeqCst)
    }

    /// Queues `bytes` for the shell's input, waiting while the input queue is full.
    pub async fn write(&self, bytes: Vec<u8>) -> Result<()> {
        let input = self.input.as_ref().ok_or_else(|| anyhow!("pty session is closed"))?;
        input.send(bytes).await.map_err(|_| anyhow!("pty input is closed"))
    }

    /// Resizes the pty; the shell receives the new size right away.
    pub fn resize(&self, cols: u16, rows: u16) -> Result<()> {
        let guard = lock(&self.master);
        let master = guard.as_ref().ok_or_else(|| anyhow!("pty session has ended"))?;
        master
            .resize(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
            .map_err(|e| anyhow!("resize pty: {e}"))?;
        if let Some(terminal) = &self.terminal_state {
            terminal.lock().unwrap_or_else(PoisonError::into_inner).resize(cols, rows);
        }
        Ok(())
    }

    /// Returns the native VT model when this session was opened with Rio state attached.
    #[must_use]
    pub fn terminal_state(&self) -> Option<Arc<Mutex<TerminalState>>> {
        self.terminal_state.clone()
    }

    /// Stops the shell if it still runs (`TerminateProcess` on Windows, `SIGHUP` on Unix) and
    /// waits, at most [`TEARDOWN_TIMEOUT`] plus a margin, for the session to drain.
    ///
    /// The [`PtyEvent::Exit`] event is still delivered when the host keeps its receiver.
    pub async fn close(mut self) {
        self.input = None;
        self.stop();
        let tasks = (self.supervisor.take(), self.writer_task.take());
        let joined = tokio::time::timeout(TEARDOWN_TIMEOUT + Duration::from_secs(1), async {
            if let Some(task) = tasks.0 {
                let _ = task.await;
            }
            if let Some(task) = tasks.1 {
                let _ = task.await;
            }
        })
        .await;
        if joined.is_err() {
            warn!("pty session did not finish closing in time");
        }
    }

    fn stop(&mut self) {
        if !self.has_exited()
            && let Err(e) = self.killer.kill()
        {
            debug!("stop shell: {e}");
        }
    }
}

impl Drop for PtySession {
    fn drop(&mut self) {
        self.input = None;
        self.stop();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Upper bound for every wait in these tests (shell start-up included).
    const TIMEOUT: Duration = Duration::from_secs(30);

    /// A shell present on every CI image that loads no user profile, run with `script`.
    fn run(script: &str) -> PtyConfig {
        let (shell, flag) = if cfg!(windows) { ("cmd", "/c") } else { ("/bin/sh", "-c") };
        PtyConfig {
            shell: Some(shell.to_owned()),
            args: vec![flag.to_owned(), script.to_owned()],
            ..PtyConfig::default()
        }
    }

    /// Collects output until the exit event; panics on timeout or on a channel without `Exit`.
    async fn collect(rx: &mut mpsc::Receiver<PtyEvent>) -> (Vec<u8>, Option<u32>) {
        let mut out = Vec::new();
        let deadline = tokio::time::Instant::now() + TIMEOUT;
        loop {
            match tokio::time::timeout_at(deadline, rx.recv()).await {
                Ok(Some(PtyEvent::Output(bytes))) => out.extend_from_slice(&bytes),
                Ok(Some(PtyEvent::Exit { code })) => return (out, code),
                Ok(None) => panic!("channel closed without an exit event"),
                Err(_) => panic!("timed out; output so far: {:?}", String::from_utf8_lossy(&out)),
            }
        }
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn streams_output_then_reports_the_exit_code() {
        let (tx, mut rx) = mpsc::channel(16);
        let session = PtySession::spawn(&run("echo aphrody-pty-ok"), tx).expect("spawn");
        let (out, code) = collect(&mut rx).await;
        assert!(String::from_utf8_lossy(&out).contains("aphrody-pty-ok"));
        assert_eq!(code, Some(0));
        assert!(session.has_exited());
        assert!(session.terminal_state().is_none());
        session.close().await;
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn opt_in_native_state_tracks_real_pty_output() {
        let (tx, mut rx) = mpsc::channel(16);
        let session =
            PtySession::spawn_with_terminal_state(&run("echo aphrody-rio-vt"), tx).expect("spawn");
        let (out, code) = collect(&mut rx).await;
        assert_eq!(code, Some(0));
        assert!(String::from_utf8_lossy(&out).contains("aphrody-rio-vt"));
        let snapshot = session
            .terminal_state()
            .expect("native state")
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .snapshot();
        assert!(snapshot.lines.iter().any(|line| line.contains("aphrody-rio-vt")));
        session.close().await;
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn reports_a_nonzero_exit_code() {
        let (tx, mut rx) = mpsc::channel(16);
        let session = PtySession::spawn(&run("exit 3"), tx).expect("spawn");
        assert_eq!(collect(&mut rx).await.1, Some(3));
        session.close().await;
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn a_slow_host_loses_no_output() {
        // 2000 numbered lines through a channel of capacity 1: the reader must wait, not drop.
        let script = if cfg!(windows) {
            "for /L %i in (1,1,2000) do @echo line-%i"
        } else {
            "i=1; while [ $i -le 2000 ]; do echo line-$i; i=$((i+1)); done"
        };
        let (tx, mut rx) = mpsc::channel(1);
        let session = PtySession::spawn(&run(script), tx).expect("spawn");
        let (out, code) = collect(&mut rx).await;
        let text = String::from_utf8_lossy(&out);
        assert_eq!(code, Some(0));
        // Match up to the carriage return only: ConPTY may put mode resets before the line feed.
        for n in [1, 999, 2000] {
            assert!(text.contains(&format!("line-{n}\r")), "line-{n} missing");
        }
        session.close().await;
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn close_stops_a_running_shell_in_bounded_time() {
        let (tx, mut rx) = mpsc::channel(64);
        let cfg = PtyConfig {
            shell: Some(if cfg!(windows) { "cmd" } else { "/bin/sh" }.to_owned()),
            ..PtyConfig::default()
        };
        let session = PtySession::spawn(&cfg, tx).expect("spawn");
        session.write(b"echo ready\r".to_vec()).await.expect("write");
        let started = tokio::time::Instant::now();
        session.close().await;
        assert!(started.elapsed() < TEARDOWN_TIMEOUT + Duration::from_secs(2));
        // The exit is still reported to a host that kept its receiver.
        let (_, _code) = collect(&mut rx).await;
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn writes_after_the_shell_exit_fail_cleanly() {
        let (tx, mut rx) = mpsc::channel(16);
        let session = PtySession::spawn(&run("exit 0"), tx).expect("spawn");
        collect(&mut rx).await;
        assert!(session.resize(100, 30).is_err(), "the master is closed once the shell exits");
        session.close().await;
    }
}
