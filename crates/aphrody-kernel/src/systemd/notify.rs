// SPDX-License-Identifier: Apache-2.0
//! Zero-dependency systemd notify (`sd_notify`) and process watchdog implementation.
//!
//! Communicates with the service manager via the datagram socket specified in
//! the `NOTIFY_SOCKET` environment variable. Fully supports Linux abstract sockets
//! (paths beginning with `@` translated to a leading `\0` byte).

use std::time::Duration;
use tokio::task::JoinHandle;

/// Standard syslog priority prefixes for direct journald indexing on stdout/stderr.
pub mod priority {
    pub const EMERG: &str = "<0>";
    pub const ALERT: &str = "<1>";
    pub const CRIT: &str = "<2>";
    pub const ERR: &str = "<3>";
    pub const WARNING: &str = "<4>";
    pub const NOTICE: &str = "<5>";
    pub const INFO: &str = "<6>";
    pub const DEBUG: &str = "<7>";

    /// Prepend a standard syslog priority prefix to a log message.
    #[must_use]
    pub fn format(priority: &str, message: &str) -> String {
        format!("{priority}{message}")
    }
}

/// Send a raw state string to the service manager via `NOTIFY_SOCKET`.
///
/// Returns:
/// - `Ok(true)` if notification was successfully sent.
/// - `Ok(false)` if `NOTIFY_SOCKET` was not set (service not supervised by systemd).
/// - `Err(e)` if an I/O error occurred while transmitting the datagram.
pub fn notify(state: &str) -> std::io::Result<bool> {
    #[cfg(unix)]
    {
        use std::os::unix::net::UnixDatagram;

        let Some(socket_path) = std::env::var_os("NOTIFY_SOCKET") else {
            return Ok(false);
        };

        let socket = UnixDatagram::unbound()?;

        #[cfg(target_os = "linux")]
        {
            use std::os::unix::ffi::OsStrExt;
            let bytes = socket_path.as_bytes();
            if let Some(rest) = bytes.strip_prefix(b"@") {
                let mut abstract_path = Vec::with_capacity(rest.len() + 1);
                abstract_path.push(0);
                abstract_path.extend_from_slice(rest);
                let os_str = std::ffi::OsStr::from_bytes(&abstract_path);
                socket.send_to(state.as_bytes(), os_str)?;
                return Ok(true);
            }
        }

        socket.send_to(state.as_bytes(), socket_path)?;
        Ok(true)
    }

    #[cfg(not(unix))]
    {
        let _ = state;
        Ok(false)
    }
}

/// Send `READY=1` to indicate that service initialization is complete.
pub fn notify_ready() -> std::io::Result<bool> {
    notify("READY=1")
}

/// Send `STATUS=<text>` to update the service single-line status description.
pub fn notify_status(status: &str) -> std::io::Result<bool> {
    notify(&format!("STATUS={status}"))
}

/// Send `STOPPING=1` to indicate that service shutdown has begun.
pub fn notify_stopping() -> std::io::Result<bool> {
    notify("STOPPING=1")
}

/// Send `WATCHDOG=1` to refresh the watchdog keep-alive timer.
pub fn notify_watchdog() -> std::io::Result<bool> {
    notify("WATCHDOG=1")
}

/// Send `RELOADING=1` to indicate that service configuration reload has begun.
pub fn notify_reloading() -> std::io::Result<bool> {
    notify("RELOADING=1")
}

/// Read the configured watchdog timeout from `WATCHDOG_USEC` environment variable.
#[must_use]
pub fn watchdog_usec() -> Option<u64> {
    std::env::var("WATCHDOG_USEC").ok().and_then(|val| val.parse::<u64>().ok())
}

/// Spawns a background Tokio task to send periodic `WATCHDOG=1` heartbeats.
///
/// If `custom_interval` is `None`, the interval defaults to half of `WATCHDOG_USEC`.
/// Returns `None` if `WATCHDOG_USEC` is not set and no custom interval was provided.
pub fn spawn_watchdog_loop(custom_interval: Option<Duration>) -> Option<JoinHandle<()>> {
    let interval_duration =
        custom_interval.or_else(|| watchdog_usec().map(|usec| Duration::from_micros(usec / 2)))?;

    Some(tokio::spawn(async move {
        let mut ticker = tokio::time::interval(interval_duration);
        ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        loop {
            ticker.tick().await;
            if let Err(e) = notify_watchdog() {
                log::debug!("Failed to send systemd watchdog heartbeat: {e}");
            }
        }
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn priority_formatting() {
        assert_eq!(priority::format(priority::INFO, "service started"), "<6>service started");
        assert_eq!(priority::format(priority::ERR, "fatal failure"), "<3>fatal failure");
    }

    #[test]
    fn notify_returns_false_when_env_absent() {
        let prev = std::env::var_os("NOTIFY_SOCKET");
        unsafe { std::env::remove_var("NOTIFY_SOCKET") };
        assert!(!notify_ready().unwrap());
        assert!(!notify_status("testing").unwrap());
        assert!(!notify_watchdog().unwrap());
        if let Some(val) = prev {
            unsafe { std::env::set_var("NOTIFY_SOCKET", val) };
        }
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn notify_transmits_datagram_to_socket() {
        use std::os::unix::net::UnixDatagram;
        let temp = tempfile::tempdir().unwrap();
        let sock_path = temp.path().join("notify.sock");
        let listener = UnixDatagram::bind(&sock_path).unwrap();

        unsafe { std::env::set_var("NOTIFY_SOCKET", &sock_path) };
        let sent = notify_ready().unwrap();
        assert!(sent);

        let mut buf = [0u8; 64];
        let (bytes, _) = listener.recv_from(&mut buf).unwrap();
        assert_eq!(&buf[..bytes], b"READY=1");

        notify_status("running smoothly").unwrap();
        let (bytes, _) = listener.recv_from(&mut buf).unwrap();
        assert_eq!(&buf[..bytes], b"STATUS=running smoothly");

        unsafe { std::env::remove_var("NOTIFY_SOCKET") };
    }
}
