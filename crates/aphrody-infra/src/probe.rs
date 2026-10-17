// SPDX-License-Identifier: Apache-2.0
//! Multi-protocol health probing engine for Aphrody infrastructure.
//!
//! Supports:
//! - Direct TCP socket handshake with bounded timeout
//! - HTTP status probing via loopback or target interface
//! - Systemd active/state inspection

use anyhow::{Result, bail};
use aphrody_proc::NoWindow as _;
use serde::{Deserialize, Serialize};
use std::net::{SocketAddr, TcpStream, ToSocketAddrs};
use std::process::Command;
use std::sync::Once;
use std::time::{Duration, Instant};

/// reqwest's `rustls-no-provider` feature needs an explicit process-level
/// `CryptoProvider` before the first TLS handshake, or the client panics with
/// "Could not automatically determine the process-level CryptoProvider".
static INIT_CRYPTO: Once = Once::new();
pub(crate) fn ensure_crypto_provider() {
    INIT_CRYPTO.call_once(|| {
        let _ = rustls::crypto::ring::default_provider().install_default();
    });
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProbeResult {
    pub url: String,
    pub ok: bool,
    pub status: u16,
    pub duration_ms: u64,
    pub error: Option<String>,
}

/// Probe a TCP endpoint by opening and immediately closing a socket.
pub fn probe_tcp(address: &str, timeout: Duration) -> ProbeResult {
    let start = Instant::now();
    let addr_clean = address.strip_prefix("tcp://").unwrap_or(address);

    let socket_addrs: Result<Vec<SocketAddr>, _> =
        addr_clean.to_socket_addrs().map(|iter| iter.collect());
    let socket_addr = match socket_addrs {
        Ok(addrs) if !addrs.is_empty() => addrs[0],
        Ok(_) => {
            return ProbeResult {
                url: address.to_string(),
                ok: false,
                status: 0,
                duration_ms: start.elapsed().as_millis() as u64,
                error: Some("aucune adresse résolue".to_string()),
            };
        }
        Err(e) => {
            return ProbeResult {
                url: address.to_string(),
                ok: false,
                status: 0,
                duration_ms: start.elapsed().as_millis() as u64,
                error: Some(e.to_string()),
            };
        }
    };

    match TcpStream::connect_timeout(&socket_addr, timeout) {
        Ok(_) => ProbeResult {
            url: address.to_string(),
            ok: true,
            status: 200,
            duration_ms: start.elapsed().as_millis() as u64,
            error: None,
        },
        Err(e) => ProbeResult {
            url: address.to_string(),
            ok: false,
            status: 0,
            duration_ms: start.elapsed().as_millis() as u64,
            error: Some(e.to_string()),
        },
    }
}

/// Probe a generic service health URL (supports http:// and tcp://).
pub fn probe_url(url: &str, timeout: Duration) -> ProbeResult {
    if url.starts_with("tcp://") {
        return probe_tcp(url, timeout);
    }

    // HTTP/HTTPS probing goes through a native blocking client; redirects
    // are not followed so a 3xx counts as reachable, matching the 200..400
    // acceptance window.
    ensure_crypto_provider();
    let start = Instant::now();
    let timeout = timeout.max(Duration::from_secs(1));
    let response = reqwest::blocking::Client::builder()
        .timeout(timeout)
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .and_then(|client| client.get(url).send());
    let duration_ms = start.elapsed().as_millis() as u64;

    match response {
        Ok(resp) => {
            let status = resp.status().as_u16();
            let ok = (200..400).contains(&status);
            ProbeResult {
                url: url.to_string(),
                ok,
                status,
                duration_ms,
                error: if ok {
                    None
                } else {
                    Some(format!("HTTP code {}", status))
                },
            }
        }
        Err(e) => ProbeResult {
            url: url.to_string(),
            ok: false,
            status: 0,
            duration_ms,
            error: Some(e.to_string()),
        },
    }
}

/// Remote probe execution over SSH on target host.
pub fn probe_remote(target: &str, url: &str, timeout_secs: u32) -> Result<ProbeResult> {
    if target.is_empty()
        || target.starts_with('-')
        || !target
            .bytes()
            .all(|ch| ch.is_ascii_alphanumeric() || b"._-@:".contains(&ch))
    {
        bail!("invalid SSH target");
    }
    if timeout_secs == 0 {
        bail!("probe timeout must be positive");
    }
    let start = Instant::now();
    let script = remote_probe_script(url, timeout_secs);

    let output = Command::new("ssh")
        .no_window()
        .args([
            "-o",
            "BatchMode=yes",
            "-o",
            "ConnectTimeout=10",
            "-o",
            "ServerAliveInterval=5",
            "-o",
            "ServerAliveCountMax=2",
            target,
            "bash",
            "-s",
        ])
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .and_then(|mut child| {
            use std::io::Write;
            if let Some(mut stdin) = child.stdin.take() {
                stdin.write_all(script.as_bytes())?;
            }
            child.wait_with_output()
        })?;

    let status_str = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let status: u16 = status_str.parse().unwrap_or(0);
    let ok = output.status.success() && (200..400).contains(&status);
    let error = if !output.status.success() {
        Some(format!(
            "SSH probe failed (exit {:?}): {}",
            output.status.code(),
            String::from_utf8_lossy(&output.stderr).trim()
        ))
    } else if !ok {
        Some(format!("statut {status}"))
    } else {
        None
    };

    Ok(ProbeResult {
        url: url.to_string(),
        ok,
        status,
        duration_ms: start.elapsed().as_millis() as u64,
        error,
    })
}

fn remote_probe_script(url: &str, timeout_secs: u32) -> String {
    let quoted_url = format!("'{}'", url.replace('\'', "'\\''"));
    format!(
        r#"url={quoted_url}
if [[ "$url" =~ ^tcp://([^:]+):([0-9]+)$ ]]; then
    if nc -z -w {timeout_secs} "${{BASH_REMATCH[1]}}" "${{BASH_REMATCH[2]}}" >/dev/null 2>&1; then echo 200; else echo 000; fi
else
    code=$(curl -s -o /dev/null -w "%{{http_code}}" --max-time {timeout_secs} -- "$url")
    printf '%s\n' "${{code:-000}}"
fi
"#
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::TcpListener;

    #[test]
    fn remote_probe_quotes_url_data() {
        let script = remote_probe_script("http://localhost/health?x='$(touch /tmp/no)'", 5);
        let expected = format!(
            "url='{}'",
            "http://localhost/health?x='$(touch /tmp/no)'".replace('\'', "'\\''")
        );
        assert!(script.starts_with(&expected));
        assert!(script.contains("-- \"$url\""));
    }

    #[test]
    fn probe_tcp_detects_open_and_closed_ports() {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind listener");
        let port = listener.local_addr().unwrap().port();
        let target_open = format!("tcp://127.0.0.1:{port}");

        let res_open = probe_tcp(&target_open, Duration::from_millis(2000));
        assert!(
            res_open.ok,
            "le port ouvert doit être probe avec succès: {:?}",
            res_open.error
        );
        assert_eq!(res_open.status, 200);

        drop(listener);

        // A freed ephemeral port can be re-picked as the connect source port and self-connect;
        // port 1 (tcpmux) sits outside the ephemeral range and is closed on build hosts.
        let res_closed = probe_tcp("tcp://127.0.0.1:1", Duration::from_millis(2000));
        assert!(!res_closed.ok, "le port fermé doit renvoyer ok == false");
        assert_ne!(res_closed.status, 200);
    }

    #[test]
    fn probe_url_reads_http_status_natively() {
        use std::io::{Read, Write};
        let listener = std::net::TcpListener::bind("127.0.0.1:0").expect("bind");
        let addr = listener.local_addr().expect("addr");
        let server = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().expect("accept");
            let mut buf = [0_u8; 1024];
            let _ = stream.read(&mut buf);
            stream
                .write_all(b"HTTP/1.1 503 Service Unavailable\r\ncontent-length: 0\r\nconnection: close\r\n\r\n")
                .expect("write");
        });
        let res = probe_url(&format!("http://{addr}/health"), Duration::from_secs(3));
        server.join().expect("server thread");
        assert_eq!(res.status, 503);
        assert!(!res.ok);
    }
}
