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
use tokio_tungstenite::tungstenite::{
    Message,
    handshake::server::{ErrorResponse, Request, Response},
    http::StatusCode,
};
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
    /// Authentication token required to connect to the WebSocket terminal.
    /// If [`None`], the backend falls back to the `APHRODY_OS_AUTH_TOKEN` environment variable.
    pub auth_token: Option<String>,
}

impl Default for PtyConfig {
    fn default() -> Self {
        Self {
            cols: 80,
            rows: 24,
            shell: None,
            cwd: None,
            args: Vec::new(),
            env: Vec::new(),
            auth_token: None,
        }
    }
}

impl PtyConfig {
    /// Return the explicit auth token if configured, or fall back to `APHRODY_OS_AUTH_TOKEN` from env.
    pub fn effective_auth_token(&self) -> Option<String> {
        self.auth_token.clone().or_else(|| {
            std::env::var("APHRODY_OS_AUTH_TOKEN")
                .ok()
                .filter(|s| !s.is_empty())
        })
    }
}

/// Generate a cryptographically random 32-character hexadecimal token.
pub fn generate_token() -> String {
    let mut bytes = [0u8; 16];
    if getrandom::getrandom(&mut bytes).is_err() {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        return format!("{nanos:032x}");
    }
    let mut s = String::with_capacity(32);
    for b in bytes {
        use std::fmt::Write as _;
        let _ = write!(s, "{b:02x}");
    }
    s
}

/// Constant-time string equality check to prevent timing attacks.
fn constant_time_eq(left: &str, right: &str) -> bool {
    if left.len() != right.len() {
        return false;
    }
    left.bytes()
        .zip(right.bytes())
        .fold(0u8, |diff, (l, r)| diff | (l ^ r))
        == 0
}

/// Validate whether an `Origin` header is allowed to connect.
///
/// Returns `true` if `origin` is `"null"` (local file/sandboxed iframe) or a local/loopback origin
/// or matches the bound host IP. Untrusted external web browser origins are rejected (CSRF defense).
pub fn is_origin_allowed(origin: &str, bound_addr: Option<SocketAddr>) -> bool {
    let trimmed = origin.trim();
    if trimmed.eq_ignore_ascii_case("null") {
        return true;
    }
    let Ok(url) = url::Url::parse(trimmed) else {
        return false;
    };
    match url.scheme() {
        "http" | "https" | "tauri" | "app" | "vscode-webview" => {},
        _ => return false,
    }
    match url.host() {
        Some(url::Host::Domain(domain)) => {
            domain.eq_ignore_ascii_case("localhost") || domain.ends_with(".localhost")
        },
        Some(url::Host::Ipv4(ip)) => {
            if ip.is_loopback() {
                return true;
            }
            if let Some(bound) = bound_addr {
                if let std::net::IpAddr::V4(bip) = bound.ip() {
                    if !bip.is_unspecified() && ip == bip {
                        return true;
                    }
                }
            }
            false
        },
        Some(url::Host::Ipv6(ip)) => {
            if ip.is_loopback() {
                return true;
            }
            if let Some(bound) = bound_addr {
                if let std::net::IpAddr::V6(bip) = bound.ip() {
                    if !bip.is_unspecified() && ip == bip {
                        return true;
                    }
                }
            }
            false
        },
        None => false,
    }
}

/// Validate whether a `Host` header is acceptable (prevents DNS rebinding).
///
/// Returns `true` if the host header matches loopback, localhost, or the bound address/port.
pub fn is_host_allowed(host_header: &str, bound_addr: Option<SocketAddr>) -> bool {
    let trimmed = host_header.trim();
    if trimmed.is_empty() {
        return false;
    }
    let Ok(url) = url::Url::parse(&format!("http://{trimmed}/")) else {
        return false;
    };

    // If port is specified in Host header and bound_addr has a known port, check port match.
    if let (Some(bound), Some(header_port)) = (bound_addr, url.port()) {
        if bound.port() != 0 && header_port != bound.port() {
            return false;
        }
    }

    match url.host() {
        Some(url::Host::Domain(domain)) => {
            domain.eq_ignore_ascii_case("localhost") || domain.ends_with(".localhost")
        },
        Some(url::Host::Ipv4(ip)) => {
            if ip.is_loopback() {
                return true;
            }
            if let Some(bound) = bound_addr {
                match bound.ip() {
                    std::net::IpAddr::V4(bip) => bip.is_unspecified() || bip == ip,
                    std::net::IpAddr::V6(bip) => bip.is_unspecified(),
                }
            } else {
                false
            }
        },
        Some(url::Host::Ipv6(ip)) => {
            if ip.is_loopback() {
                return true;
            }
            if let Some(bound) = bound_addr {
                match bound.ip() {
                    std::net::IpAddr::V6(bip) => bip.is_unspecified() || bip == ip,
                    std::net::IpAddr::V4(bip) => bip.is_unspecified(),
                }
            } else {
                false
            }
        },
        None => false,
    }
}

/// Validate request authentication against expected token.
///
/// Supports `Authorization: Bearer <token>` and `?token=<token>`.
fn is_authenticated(req: &Request, expected_token: &str) -> bool {
    // 1. Authorization header: "Bearer <token>"
    if let Some(auth_val) = req.headers().get("authorization").and_then(|v| v.to_str().ok()) {
        let auth_val = auth_val.trim();
        if let Some(token) = auth_val.strip_prefix("Bearer ") {
            if constant_time_eq(token.trim(), expected_token) {
                return true;
            }
        }
    }

    // 2. Query parameter: ?token=<token>
    if let Some(query) = req.uri().query() {
        for (key, val) in url::form_urlencoded::parse(query.as_bytes()) {
            if key == "token" && constant_time_eq(&val, expected_token) {
                return true;
            }
        }
    }

    false
}

fn forbidden_response(reason: &str) -> ErrorResponse {
    let body = format!("{{\"error\":\"{reason}\"}}");
    tokio_tungstenite::tungstenite::http::Response::builder()
        .status(StatusCode::FORBIDDEN)
        .header("Content-Type", "application/json")
        .header("Connection", "close")
        .body(Some(body))
        .unwrap_or_else(|_| tokio_tungstenite::tungstenite::http::Response::new(None))
}

fn unauthorized_response(reason: &str) -> ErrorResponse {
    let body = format!("{{\"error\":\"{reason}\"}}");
    tokio_tungstenite::tungstenite::http::Response::builder()
        .status(StatusCode::UNAUTHORIZED)
        .header("Content-Type", "application/json")
        .header("WWW-Authenticate", "Bearer")
        .header("Connection", "close")
        .body(Some(body))
        .unwrap_or_else(|_| tokio_tungstenite::tungstenite::http::Response::new(None))
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
pub async fn serve(addr: SocketAddr, mut cfg: PtyConfig) -> Result<()> {
    let token = cfg.effective_auth_token();
    if !addr.ip().is_loopback() && token.is_none() {
        anyhow::bail!(
            "refusing to bind terminal backend to non-loopback address {addr} without authentication; set auth_token in PtyConfig or APHRODY_OS_AUTH_TOKEN"
        );
    }

    if cfg.auth_token.is_none() {
        if let Some(tok) = token {
            cfg.auth_token = Some(tok);
        } else {
            let generated = generate_token();
            eprintln!("aphrody-terminal-backend: generated auth token: {generated}");
            cfg.auth_token = Some(generated);
        }
    }

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
    let bound_addr = stream.local_addr().ok();
    let auth_token = cfg.effective_auth_token();

    let callback = move |req: &Request, resp: Response| -> Result<Response, ErrorResponse> {
        // 1. Check Origin: if Origin header is present and is not null / local allowed origin, reject.
        if let Some(origin) = req.headers().get("origin").and_then(|v| v.to_str().ok()) {
            if !is_origin_allowed(origin, bound_addr) {
                warn!("rejected websocket connection with forbidden origin: {origin}");
                return Err(forbidden_response("forbidden origin"));
            }
        }

        // 2. Check Host: ensure host matches loopback/localhost or the bound host.
        match req.headers().get("host").and_then(|v| v.to_str().ok()) {
            Some(host) if is_host_allowed(host, bound_addr) => {},
            Some(host) => {
                warn!("rejected websocket connection with foreign host: {host}");
                return Err(forbidden_response("forbidden host"));
            },
            None => {
                warn!("rejected websocket connection missing host header");
                return Err(forbidden_response("missing host header"));
            },
        }

        // 3. Check Authentication Token (if configured or present in environment)
        if let Some(ref expected) = auth_token {
            if !is_authenticated(req, expected) {
                warn!("rejected unauthenticated websocket connection");
                return Err(unauthorized_response("authentication required"));
            }
        }

        Ok(resp)
    };

    let ws_stream = tokio_tungstenite::accept_hdr_async(stream, callback)
        .await
        .context("WebSocket handshake")?;
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

    // ── Security & Hardening Tests (T-01) ──────────────────────────────────────

    #[test]
    fn origin_validation_rules() {
        let bound: SocketAddr = "127.0.0.1:8788".parse().unwrap();

        // Null origin (local files / sandboxed iframes) is allowed
        assert!(is_origin_allowed("null", Some(bound)));
        assert!(is_origin_allowed("NULL", Some(bound)));

        // Localhost and loopback origins are allowed
        assert!(is_origin_allowed("http://localhost", Some(bound)));
        assert!(is_origin_allowed("http://localhost:8788", Some(bound)));
        assert!(is_origin_allowed("http://localhost:5173", Some(bound)));
        assert!(is_origin_allowed("http://127.0.0.1", Some(bound)));
        assert!(is_origin_allowed("http://127.0.0.1:8788", Some(bound)));
        assert!(is_origin_allowed("http://[::1]:8788", Some(bound)));
        assert!(is_origin_allowed("https://localhost:8788", Some(bound)));
        assert!(is_origin_allowed("tauri://localhost", Some(bound)));

        // Foreign / untrusted browser origins MUST be rejected
        assert!(!is_origin_allowed("http://evil.com", Some(bound)));
        assert!(!is_origin_allowed("https://attacker.site:8788", Some(bound)));
        assert!(!is_origin_allowed("http://localhost.evil.com", Some(bound)));
        assert!(!is_origin_allowed("javascript:alert(1)", Some(bound)));
        assert!(!is_origin_allowed("invalid-url", Some(bound)));

        // Bound host matching
        let lan_bound: SocketAddr = "192.168.1.50:8788".parse().unwrap();
        assert!(is_origin_allowed("http://192.168.1.50:8788", Some(lan_bound)));
        assert!(!is_origin_allowed("http://192.168.1.99:8788", Some(lan_bound)));
    }

    #[test]
    fn host_validation_rules() {
        let bound: SocketAddr = "127.0.0.1:8788".parse().unwrap();

        // Valid host headers
        assert!(is_host_allowed("localhost:8788", Some(bound)));
        assert!(is_host_allowed("127.0.0.1:8788", Some(bound)));
        assert!(is_host_allowed("[::1]:8788", Some(bound)));
        assert!(is_host_allowed("localhost", Some(bound)));

        // DNS rebinding domains MUST be rejected
        assert!(!is_host_allowed("evil.com:8788", Some(bound)));
        assert!(!is_host_allowed("attacker.site", Some(bound)));
        assert!(!is_host_allowed("localhost.evil.com:8788", Some(bound)));

        // Mismatched port MUST be rejected
        assert!(!is_host_allowed("127.0.0.1:9999", Some(bound)));

        // Non-loopback bound matching
        let wildcard_bound: SocketAddr = "0.0.0.0:8788".parse().unwrap();
        assert!(is_host_allowed("192.168.1.50:8788", Some(wildcard_bound)));
        assert!(is_host_allowed("127.0.0.1:8788", Some(wildcard_bound)));
        // Even with 0.0.0.0, external domains are blocked to prevent DNS rebinding
        assert!(!is_host_allowed("evil.com:8788", Some(wildcard_bound)));

        // Empty host header
        assert!(!is_host_allowed("", Some(bound)));
    }

    #[test]
    fn token_generation_and_constant_time_equality() {
        let tok1 = generate_token();
        let tok2 = generate_token();
        assert_eq!(tok1.len(), 32);
        assert_eq!(tok2.len(), 32);
        assert_ne!(tok1, tok2);
        assert!(tok1.chars().all(|c| c.is_ascii_hexdigit()));

        assert!(constant_time_eq("abcdef", "abcdef"));
        assert!(!constant_time_eq("abcdef", "abcdeg"));
        assert!(!constant_time_eq("abcdef", "abcde"));
    }

    #[tokio::test]
    async fn serve_rejects_non_loopback_without_auth() {
        let addr: SocketAddr = "0.0.0.0:8788".parse().unwrap();
        let cfg = PtyConfig {
            auth_token: None,
            ..PtyConfig::default()
        };
        // Unset env var if set
        let _env = lock_notify_env();
        unsafe { std::env::remove_var("APHRODY_OS_AUTH_TOKEN"); }
        let res = serve(addr, cfg).await;
        assert!(res.is_err());
        let err_msg = res.unwrap_err().to_string();
        assert!(err_msg.contains("non-loopback"), "error was: {err_msg}");
    }

    use tokio_tungstenite::tungstenite::client::IntoClientRequest;

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn authenticated_session_accepts_valid_tokens_and_rejects_invalid() {
        let _guard = SESSION_TEST_LOCK.lock().await;
        let token = "test-token-123456789012345678901234";

        let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind");
        let addr = listener.local_addr().expect("local addr");
        let cfg = PtyConfig {
            shell: Some(test_shell()),
            auth_token: Some(token.to_string()),
            ..PtyConfig::default()
        };

        let server = tokio::spawn(async move {
            let (stream, _) = listener.accept().await.expect("accept");
            handle_conn(stream, cfg).await
        });

        // 1. Missing token -> rejected (401)
        let res_missing = connect_async(format!("ws://{addr}")).await;
        assert!(res_missing.is_err(), "missing token should fail handshake");

        // Server exits on rejected connection, wait for it
        let _ = server.await;

        // 2. Query param token -> accepted
        let listener2 = TcpListener::bind("127.0.0.1:0").await.expect("bind");
        let addr2 = listener2.local_addr().expect("local addr");
        let cfg2 = PtyConfig {
            shell: Some(test_shell()),
            auth_token: Some(token.to_string()),
            ..PtyConfig::default()
        };
        let server2 = tokio::spawn(async move {
            let (stream, _) = listener2.accept().await.expect("accept");
            handle_conn(stream, cfg2).await
        });
        let (mut client2, _) = connect_async(format!("ws://{addr2}?token={token}")).await.expect("connect with query token");
        client2.close(None).await.expect("close");
        let _ = server2.await;

        // 3. Authorization Bearer header -> accepted
        let listener3 = TcpListener::bind("127.0.0.1:0").await.expect("bind");
        let addr3 = listener3.local_addr().expect("local addr");
        let cfg3 = PtyConfig {
            shell: Some(test_shell()),
            auth_token: Some(token.to_string()),
            ..PtyConfig::default()
        };
        let server3 = tokio::spawn(async move {
            let (stream, _) = listener3.accept().await.expect("accept");
            handle_conn(stream, cfg3).await
        });
        let mut req = format!("ws://{addr3}").into_client_request().expect("request");
        req.headers_mut().insert("Authorization", format!("Bearer {token}").parse().unwrap());
        let (mut client3, _) = connect_async(req).await.expect("connect with Bearer header");
        client3.close(None).await.expect("close");
        let _ = server3.await;
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn origin_and_host_checks_in_handshake() {
        let _guard = SESSION_TEST_LOCK.lock().await;

        let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind");
        let addr = listener.local_addr().expect("local addr");
        let cfg = PtyConfig {
            shell: Some(test_shell()),
            ..PtyConfig::default()
        };

        let server = tokio::spawn(async move {
            let (stream, _) = listener.accept().await.expect("accept");
            handle_conn(stream, cfg).await
        });

        // Connect with forbidden origin
        let mut req = format!("ws://{addr}").into_client_request().expect("request");
        req.headers_mut().insert("Origin", "http://evil.com".parse().unwrap());
        let res = connect_async(req).await;
        assert!(res.is_err(), "evil.com Origin must be rejected");

        let _ = server.await;

        // Connect with allowed origin
        let listener2 = TcpListener::bind("127.0.0.1:0").await.expect("bind");
        let addr2 = listener2.local_addr().expect("local addr");
        let cfg2 = PtyConfig {
            shell: Some(test_shell()),
            ..PtyConfig::default()
        };
        let server2 = tokio::spawn(async move {
            let (stream, _) = listener2.accept().await.expect("accept");
            handle_conn(stream, cfg2).await
        });
        let mut req2 = format!("ws://{addr2}").into_client_request().expect("request");
        req2.headers_mut().insert("Origin", "http://localhost:8788".parse().unwrap());
        let (mut client2, _) = connect_async(req2).await.expect("localhost Origin must be accepted");
        client2.close(None).await.expect("close");
        let _ = server2.await;
    }
}
