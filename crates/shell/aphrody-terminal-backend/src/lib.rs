// SPDX-License-Identifier: Apache-2.0
//! Native PTY driver and WebSocket server.
//!
//! Uses [`portable_pty`] to open a pseudo-terminal on both Windows (ConPTY)
//! and Unix (POSIX openpty), then bridges it to a WebSocket connection so a
//! browser-based renderer can communicate with a real shell.
//!
//! # Wire protocol
//!
//! Each WebSocket message from **client to server** is one of:
//!
//! - **Binary frame** — raw bytes forwarded verbatim to the pty master writer.
//! - **Text frame** — a JSON control message:
//!   - `{"type":"resize","cols":N,"rows":N}` — resize the pty.
//!   - `{"type":"data","bytes":[...]}` — byte array forwarded to the pty.
//!
//! Each WebSocket message from **server to client** is:
//!
//! - **Binary frame** — raw bytes read from the pty master (shell output).
//!
//! The server closes the WebSocket once the shell has exited and its output is flushed; a
//! client that disconnects ends the session and stops its shell.

#![deny(unsafe_code)]

pub mod coord;
mod session;
mod terminal;
use std::{net::SocketAddr, path::PathBuf};

use anyhow::{Context as _, Result};
pub use coord::{
    CoordError, CoordProxy, CoordResponseKind, HttpResponse as CoordHttpResponse,
    NDJSON_CONTENT_TYPE, SSE_CONTENT_TYPE,
};
use futures_util::{SinkExt, stream::StreamExt};
use serde::Deserialize;
pub use session::{PtyEvent, PtySession, TEARDOWN_TIMEOUT};
pub use terminal::{
    DEFAULT_SCROLLBACK_LINES, StyledTerminalSnapshot, TerminalCell, TerminalSnapshot, TerminalState,
};
use tokio::{
    net::{TcpListener, TcpStream},
    sync::mpsc,
};
use tokio_tungstenite::tungstenite::Message;
use tracing::{debug, info, warn};

// ── Configuration ─────────────────────────────────────────────────────────────

/// Configuration for a pty session.
#[derive(Debug, Clone)]
pub struct PtyConfig {
    /// Terminal width in columns.
    pub cols: u16,
    /// Terminal height in rows.
    pub rows: u16,
    /// Shell command to launch.  Defaults to the platform default shell when
    /// [`None`].
    pub shell: Option<String>,
    /// Working directory for the shell process.  Defaults to the current
    /// working directory when [`None`].
    pub cwd: Option<PathBuf>,
    /// Arguments passed to the shell.
    pub args: Vec<String>,
    /// Extra environment variables for the shell, on top of the inherited environment.
    pub env: Vec<(String, String)>,
}

impl Default for PtyConfig {
    fn default() -> Self {
        Self { cols: 80, rows: 24, shell: None, cwd: None, args: Vec::new(), env: Vec::new() }
    }
}

/// Resolve the default shell for the current platform.
///
/// On Windows: tries `pwsh` first, falls back to `cmd`.
/// On Unix: uses `$SHELL` env var, falls back to `/bin/bash`.
pub fn default_shell() -> String {
    #[cfg(target_os = "windows")]
    {
        if which_shell("pwsh") {
            return "pwsh".to_owned();
        }
        "cmd".to_owned()
    }
    #[cfg(not(target_os = "windows"))]
    {
        if let Ok(shell) = std::env::var("SHELL")
            && !shell.is_empty()
        {
            return shell;
        }
        "/bin/bash".to_owned()
    }
}

/// Whether `name` resolves to an executable on `PATH` (extensions from `PATHEXT`).
///
/// Resolved in-process with the [`which`] crate: no `where.exe` child process, and — unlike
/// `where` — the current directory is only searched when `PATH` itself lists it, so a stray
/// `pwsh.exe` in the working directory does not count as an installed shell.
#[cfg(target_os = "windows")]
fn which_shell(name: &str) -> bool {
    which::which(name).is_ok()
}

// ── Control message ───────────────────────────────────────────────────────────

/// Structured control messages sent as JSON text frames from the client.
#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "lowercase")]
enum ControlMsg {
    /// Resize the pty to new dimensions.
    Resize { cols: u16, rows: u16 },
    /// Send raw bytes to the pty (alternative to binary frames).
    Data { bytes: Vec<u8> },
}

// ── Server entry point ────────────────────────────────────────────────────────

/// Bind a TCP listener on `addr`, accept WebSocket connections, and spawn one
/// [`PtySession`] per connection.
///
/// This function runs indefinitely.  Cancel the surrounding task to shut down
/// the server.
pub async fn serve(addr: SocketAddr, cfg: PtyConfig) -> Result<()> {
    let listener = TcpListener::bind(addr).await.with_context(|| format!("bind {addr}"))?;
    info!("aphrody-terminal-backend listening on {addr}");

    // Send READY=1 to systemd (Type=notify)
    let _ = sd_notify("READY=1\nSTATUS=Ready to accept WebSocket terminal connections\n");
    // Start watchdog petting loop if watchdog health check is configured
    let _watchdog = start_watchdog_loop();

    loop {
        let (stream, peer) = listener.accept().await.context("accept")?;
        info!("new connection from {peer}");
        let cfg = cfg.clone();
        tokio::spawn(async move {
            if let Err(e) = handle_conn(stream, cfg).await {
                warn!("session error: {e:#}");
            }
        });
    }
}

// ── Per-connection handler ────────────────────────────────────────────────────

/// Upgrade a raw TCP stream to WebSocket, open a [`PtySession`], and bridge them.
///
/// The session lasts until the client leaves or the shell exits. When the client leaves, the
/// shell is stopped (`TerminateProcess` on Windows, `SIGHUP` on Unix) and the pty is closed;
/// when the shell exits, the remaining output is flushed and the WebSocket is closed.
async fn handle_conn(stream: TcpStream, cfg: PtyConfig) -> Result<()> {
    let ws_stream = tokio_tungstenite::accept_async(stream).await.context("WebSocket handshake")?;
    let (mut ws_sink, mut ws_source) = ws_stream.split();

    let (events_tx, mut events_rx) = mpsc::channel::<PtyEvent>(256);
    let session = PtySession::spawn(&cfg, events_tx)?;

    // Forward pty output to the client, then close the WebSocket once the shell has exited.
    let mut forward_task = tokio::spawn(async move {
        while let Some(event) = events_rx.recv().await {
            match event {
                PtyEvent::Output(data) => {
                    if ws_sink.send(Message::Binary(data)).await.is_err() {
                        break;
                    }
                },
                PtyEvent::Exit { code } => {
                    debug!("shell exited: {code:?}");
                    break;
                },
            }
        }
        let _ = ws_sink.close().await;
    });

    // Read incoming WebSocket messages until the client leaves or the shell exits.
    let mut forward_done = false;
    loop {
        let msg = tokio::select! {
            msg = ws_source.next() => msg,
            _ = &mut forward_task => {
                forward_done = true;
                break;
            },
        };
        let msg = match msg {
            Some(Ok(m)) => m,
            Some(Err(e)) => {
                debug!("ws recv error: {e}");
                break;
            },
            None => break,
        };

        match msg {
            Message::Binary(bytes) => {
                if session.write(bytes).await.is_err() {
                    break;
                }
            },
            Message::Text(text) => match serde_json::from_str::<ControlMsg>(&text) {
                Ok(ControlMsg::Resize { cols, rows }) => {
                    // Applied right away so the shell sees the new size during the session.
                    if let Err(e) = session.resize(cols, rows) {
                        debug!("{e:#}");
                    }
                },
                Ok(ControlMsg::Data { bytes }) => {
                    if session.write(bytes).await.is_err() {
                        break;
                    }
                },
                Err(e) => {
                    debug!("unrecognised control msg: {e}");
                },
            },
            Message::Close(_) => break,
            // Ping/Pong are handled by tungstenite automatically.
            _ => {},
        }
    }

    session.close().await;
    if !forward_done && tokio::time::timeout(TEARDOWN_TIMEOUT, &mut forward_task).await.is_err() {
        warn!("session teardown timed out: a process still holds the pty open");
        forward_task.abort();
    }

    Ok(())
}

// ── systemd Notifications ───────────────────────────────────────────────────

/// Notify systemd of state changes (Type=notify). No-op on non-Unix platforms.
pub fn sd_notify(message: &str) -> std::io::Result<bool> {
    #[cfg(target_family = "unix")]
    {
        use std::{
            env,
            ffi::OsString,
            os::unix::{ffi::OsStringExt, net::UnixDatagram},
        };

        let socket_path = match env::var_os("NOTIFY_SOCKET") {
            Some(path) => path,
            None => return Ok(false),
        };

        let mut bytes = socket_path.into_vec();
        if !bytes.is_empty() && bytes[0] == b'@' {
            bytes[0] = b'\0';
        }
        let path = OsString::from_vec(bytes);

        let socket = UnixDatagram::unbound()?;
        socket.connect(path)?;
        socket.send(message.as_bytes())?;
        Ok(true)
    }
    #[cfg(not(target_family = "unix"))]
    {
        let _ = message;
        Ok(false)
    }
}

/// Spawns a background watchdog petting task if configured by systemd (WatchdogSec=...).
pub fn start_watchdog_loop() -> Option<tokio::task::JoinHandle<()>> {
    #[cfg(target_family = "unix")]
    {
        use std::env;

        use tracing::{error, trace};

        let watchdog_usec = match env::var("WATCHDOG_USEC") {
            Ok(val) => match val.parse::<u64>() {
                Ok(usec) => usec,
                Err(_) => return None,
            },
            Err(_) => return None,
        };

        if watchdog_usec == 0 {
            return None;
        }

        // Pet the watchdog at half the timeout interval
        let interval = std::time::Duration::from_micros(watchdog_usec / 2);
        info!("systemd watchdog enabled, petting every {}ms", interval.as_millis());

        Some(tokio::spawn(async move {
            let mut ticker = tokio::time::interval(interval);
            // First tick fires immediately, skip it
            ticker.tick().await;

            loop {
                ticker.tick().await;
                trace!("petting systemd watchdog");
                if let Err(e) = sd_notify("WATCHDOG=1\n") {
                    error!("failed to pet systemd watchdog: {e}");
                }
            }
        }))
    }
    #[cfg(not(target_family = "unix"))]
    {
        None
    }
}

#[cfg(test)]
#[allow(unsafe_code)]
mod tests {
    use std::{
        sync::{Mutex, MutexGuard},
        time::Duration,
    };

    use super::*;

    /// Serializes the tests that mutate `NOTIFY_SOCKET`: the test harness runs
    /// tests on parallel threads and the process environment is shared.
    static NOTIFY_ENV: Mutex<()> = Mutex::new(());

    fn lock_notify_env() -> MutexGuard<'static, ()> {
        NOTIFY_ENV.lock().unwrap_or_else(std::sync::PoisonError::into_inner)
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn which_shell_resolves_cmd_through_pathext() {
        // `cmd.exe` lives in System32, which is always on PATH; the bare name only
        // resolves if PATHEXT expansion works.
        assert!(which_shell("cmd"));
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn which_shell_rejects_missing_program() {
        assert!(!which_shell("aphrody-terminal-backend-no-such-shell-8f3c1d"));
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn default_shell_prefers_pwsh_and_falls_back_to_cmd() {
        let shell = default_shell();
        let expected = if which_shell("pwsh") { "pwsh" } else { "cmd" };
        assert_eq!(shell, expected);
        assert!(which::which(&shell).is_ok(), "default shell {shell} must be on PATH");
    }

    #[test]
    fn test_sd_notify_noop_when_no_env() {
        let _env = lock_notify_env();
        unsafe {
            std::env::remove_var("NOTIFY_SOCKET");
        }
        let res = sd_notify("READY=1");
        assert!(res.is_ok());
        assert!(!res.unwrap());
    }

    #[cfg(target_family = "unix")]
    #[test]
    fn test_sd_notify_sends_datagram() {
        use std::os::unix::net::UnixDatagram;

        let _env = lock_notify_env();
        // Create a temporary socket to receive the notification
        let temp_dir = tempfile::tempdir().unwrap();
        let socket_path = temp_dir.path().join("notify.sock");
        let receiver = UnixDatagram::bind(&socket_path).unwrap();

        unsafe {
            std::env::set_var("NOTIFY_SOCKET", &socket_path);
        }
        let res = sd_notify("READY=1\n");
        assert!(res.is_ok());
        assert!(res.unwrap());

        let mut buf = [0u8; 100];
        let (len, _) = receiver.recv_from(&mut buf).unwrap();
        assert_eq!(&buf[..len], b"READY=1\n");

        unsafe {
            std::env::remove_var("NOTIFY_SOCKET");
        }
    }

    // ── WebSocket session (`handle_conn`) ─────────────────────────────────────

    use tokio_tungstenite::{MaybeTlsStream, WebSocketStream, connect_async};

    type Client = WebSocketStream<MaybeTlsStream<TcpStream>>;

    /// Upper bound for every wait in the session tests (shell start-up included).
    const SESSION_TIMEOUT: Duration = Duration::from_secs(30);
    // Running multiple ConPTY/WebSocket handshakes at once is unreliable on Windows CI.
    static SESSION_TEST_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

    /// A shell present on every CI image that loads no user profile.
    fn test_shell() -> String {
        if cfg!(target_os = "windows") { "cmd".to_owned() } else { "/bin/sh".to_owned() }
    }

    /// Accepts one connection on a loopback port and runs `handle_conn` on it.
    async fn start_session() -> (Client, tokio::task::JoinHandle<Result<()>>) {
        let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind");
        let addr = listener.local_addr().expect("local addr");
        let cfg = PtyConfig { shell: Some(test_shell()), ..PtyConfig::default() };
        let server = tokio::spawn(async move {
            let (stream, _) = listener.accept().await.expect("accept");
            handle_conn(stream, cfg).await
        });
        let (client, _) = connect_async(format!("ws://{addr}")).await.expect("connect");
        (client, server)
    }

    /// Drops CSI and OSC escape sequences: ConPTY repaints the screen with them, and it may
    /// replace runs of spaces with cursor movements.
    fn strip_ansi(text: &str) -> String {
        let mut out = String::with_capacity(text.len());
        let mut chars = text.chars();
        while let Some(c) = chars.next() {
            if c != '\u{1b}' {
                out.push(c);
                continue;
            }
            match chars.next() {
                // CSI: parameter and intermediate bytes up to a final byte in `@..=~`.
                Some('[') => {
                    for c in chars.by_ref() {
                        if ('@'..='~').contains(&c) {
                            break;
                        }
                    }
                },
                // OSC: up to BEL or ST (`ESC \`).
                Some(']') => {
                    while let Some(c) = chars.next() {
                        if c == '\u{7}' {
                            break;
                        }
                        if c == '\u{1b}' {
                            chars.next();
                            break;
                        }
                    }
                },
                _ => {},
            }
        }
        out
    }

    /// Reads server frames until `done` accepts the escape-stripped output so far.
    async fn read_until(client: &mut Client, done: impl Fn(&str) -> bool) -> String {
        let deadline = tokio::time::Instant::now() + SESSION_TIMEOUT;
        let mut raw = Vec::new();
        loop {
            let text = strip_ansi(&String::from_utf8_lossy(&raw));
            if done(&text) {
                return text;
            }
            match tokio::time::timeout_at(deadline, client.next()).await {
                Ok(Some(Ok(Message::Binary(bytes)))) => raw.extend_from_slice(&bytes),
                Ok(Some(Ok(_))) => {},
                Ok(Some(Err(e))) => panic!("websocket error: {e}; output so far: {text:?}"),
                Ok(None) => panic!("session closed early; output so far: {text:?}"),
                Err(_) => panic!("timed out; output so far: {text:?}"),
            }
        }
    }

    /// Reads until the server closes the WebSocket (Close frame or end of stream).
    async fn read_until_closed(client: &mut Client) {
        let closed = tokio::time::timeout(SESSION_TIMEOUT, async {
            while let Some(msg) = client.next().await {
                if matches!(msg, Ok(Message::Close(_)) | Err(_)) {
                    break;
                }
            }
        })
        .await;
        assert!(closed.is_ok(), "the server did not close the WebSocket");
    }

    /// Waits for `handle_conn` to return and checks that it ended cleanly.
    async fn assert_session_ended(server: tokio::task::JoinHandle<Result<()>>) {
        let joined = tokio::time::timeout(SESSION_TIMEOUT, server)
            .await
            .expect("handle_conn did not return: the session was not torn down");
        joined.expect("handle_conn panicked").expect("handle_conn failed");
    }

    /// Every decimal number after the last occurrence of `marker` in `text`, in order.
    #[cfg(target_os = "windows")]
    fn numbers_after(text: &str, marker: &str) -> Vec<u32> {
        let Some(pos) = text.rfind(marker) else { return Vec::new() };
        text[pos + marker.len()..]
            .split(|c: char| !c.is_ascii_digit())
            .filter_map(|n| n.parse().ok())
            .collect()
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn resize_control_message_applies_during_the_session() {
        let _guard = SESSION_TEST_LOCK.lock().await;
        let (mut client, server) = start_session().await;
        let resize = r#"{"type":"resize","cols":137,"rows":43}"#;
        client.send(Message::Text(resize.to_owned())).await.expect("send resize");

        // Ask the shell for the terminal size it sees now, while the session is live.
        #[cfg(target_os = "windows")]
        {
            // `mode con` prints the line count, then the column count; the labels are localized,
            // so match on the numbers that follow the command echo.
            client.send(Message::Binary(b"mode con\r".to_vec())).await.expect("send command");
            read_until(&mut client, |out| numbers_after(out, "mode con").starts_with(&[43, 137]))
                .await;
        }
        #[cfg(not(target_os = "windows"))]
        {
            client.send(Message::Binary(b"stty size\r".to_vec())).await.expect("send command");
            read_until(&mut client, |out| out.contains("43 137")).await;
        }

        client.close(None).await.expect("close");
        assert_session_ended(server).await;
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn session_ends_when_the_client_disconnects() {
        let _guard = SESSION_TEST_LOCK.lock().await;
        let (mut client, server) = start_session().await;
        // Wait for the shell to be up so the teardown has a live child to stop.
        read_until(&mut client, |out| !out.trim().is_empty()).await;

        client.close(None).await.expect("close");
        drop(client);
        assert_session_ended(server).await;
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn websocket_closes_when_the_shell_exits() {
        let _guard = SESSION_TEST_LOCK.lock().await;
        let (mut client, server) = start_session().await;
        read_until(&mut client, |out| !out.trim().is_empty()).await;

        // Sent as a JSON `data` control message to cover that path as well.
        let exit = serde_json::json!({ "type": "data", "bytes": b"exit\r" }).to_string();
        client.send(Message::Text(exit)).await.expect("send exit");

        read_until_closed(&mut client).await;
        assert_session_ended(server).await;
    }
}
