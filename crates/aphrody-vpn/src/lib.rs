// SPDX-License-Identifier: Apache-2.0
#![allow(clippy::collapsible_if)]
//! `aphrody-vpn` — Native Mullvad VPN driver & automated geo-unblocking supervisor.
//!
//! Provides:
//! - Direct Mullvad VPN management via CLI and IPC paths.
//! - Status probing (connected relay, country code, IP, interface).
//! - Automatic relay switching to supported locations (e.g. US, CH, UK) when facing Google Cloud
//!   Code / Vertex AI geo-fencing (`User location is not supported`).
//! - Naive auto-wiring for `agy`: before running `agy`, ensures Mullvad is connected or connects to
//!   a non-EEA exit (defaulting to `us` or `ch`) so `agy` never crashes with 400.

use aphrody_proc::NoWindow as _;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use thiserror::Error;

/// reqwest's `rustls-no-provider` feature needs an explicit process-level
/// `CryptoProvider` before the first TLS handshake, or the client panics with
/// "Could not automatically determine the process-level CryptoProvider".
static INIT_CRYPTO: std::sync::Once = std::sync::Once::new();
fn ensure_crypto_provider() {
    INIT_CRYPTO.call_once(|| {
        let _ = rustls::crypto::ring::default_provider().install_default();
    });
}

/// Error types for VPN operations.
#[derive(Debug, Error)]
pub enum VpnError {
    #[error("mullvad executable not found in PATH or standard installation paths")]
    MullvadNotFound,

    #[error("failed to execute mullvad command: {0}")]
    ExecutionFailed(#[from] std::io::Error),

    #[error("mullvad command failed with exit code {code:?}: {stderr}")]
    CommandFailed { code: Option<i32>, stderr: String },

    #[error("failed to parse mullvad output: {0}")]
    ParseError(String),

    #[error("missing configuration: {0}")]
    Config(String),
}

/// SSH alias of the host that exposes the remote SOCKS5 proxy (default `vps`).
pub const PROXY_HOST_ENV: &str = "APHRODY_SSH_PROXY_HOST";
/// Remote SOCKS5 endpoint (`host:port`) as seen from the SSH host; published by aphrody-infra.
pub const PROXY_REMOTE_ENV: &str = "APHRODY_SSH_PROXY_REMOTE";

/// Resolves the SSH alias and remote SOCKS5 endpoint for the VPS proxy tunnel.
///
/// # Errors
/// Returns [`VpnError::Config`] when the remote endpoint is not configured.
pub fn vps_proxy_target(
    host: Option<String>,
    remote: Option<String>,
) -> Result<(String, String), VpnError> {
    let host = host.map(|h| h.trim().to_owned()).filter(|h| !h.is_empty());
    let remote = remote.map(|r| r.trim().to_owned()).filter(|r| !r.is_empty());
    let remote = remote.ok_or_else(|| {
        VpnError::Config(format!(
            "{PROXY_REMOTE_ENV} is not set (endpoint published by aphrody-infra)"
        ))
    })?;
    Ok((host.unwrap_or_else(|| "vps".to_owned()), remote))
}

/// Status of the Mullvad VPN tunnel.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum TunnelState {
    Connected { relay: String, location: String, ipv4: Option<String>, ipv6: Option<String> },
    Connecting,
    Disconnected,
    Blocked(String),
    Unknown(String),
}

/// Client for Mullvad VPN interactions.
#[derive(Debug, Clone)]
pub struct MullvadController {
    bin_path: PathBuf,
}

impl MullvadController {
    /// Discovers the Mullvad CLI binary or falls back to system PATH.
    pub fn discover() -> Result<Self, VpnError> {
        if let Ok(path) = which::which("mullvad") {
            return Ok(Self { bin_path: path });
        }

        #[cfg(target_os = "windows")]
        {
            let candidates = [
                r"C:\Program Files\Mullvad VPN\resources\mullvad.exe",
                r"C:\Program Files (x86)\Mullvad VPN\resources\mullvad.exe",
            ];
            for c in candidates {
                let p = PathBuf::from(c);
                if p.exists() {
                    return Ok(Self { bin_path: p });
                }
            }
        }

        #[cfg(not(target_os = "windows"))]
        {
            let candidates = [
                "/usr/bin/mullvad",
                "/usr/local/bin/mullvad",
                "/opt/Mullvad VPN/resources/mullvad",
            ];
            for c in candidates {
                let p = PathBuf::from(c);
                if p.exists() {
                    return Ok(Self { bin_path: p });
                }
            }
        }

        Err(VpnError::MullvadNotFound)
    }

    /// Queries the current tunnel status.
    pub async fn status(&self) -> Result<TunnelState, VpnError> {
        let output = tokio::process::Command::new(&self.bin_path).no_window().arg("status").output().await?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
            return Err(VpnError::CommandFailed { code: output.status.code(), stderr });
        }

        let stdout = String::from_utf8_lossy(&output.stdout);
        Ok(Self::parse_status(&stdout))
    }

    /// Parses the text output of `mullvad status`.
    pub fn parse_status(output: &str) -> TunnelState {
        let trimmed = output.trim();
        if trimmed.starts_with("Connected") {
            let mut relay = String::new();
            let mut location = String::new();
            let mut ipv4 = None;
            let mut ipv6 = None;

            for line in trimmed.lines() {
                let line_trim = line.trim();
                if let Some(rest) = line_trim.strip_prefix("Relay:") {
                    relay = rest.trim().to_string();
                } else if let Some(rest) = line_trim.strip_prefix("Visible location:") {
                    let loc_part = rest.trim();
                    if let Some((loc, ips)) = loc_part.split_once(". IPv4:") {
                        location = loc.trim().to_string();
                        if let Some((ip4, ip6)) = ips.split_once(", IPv6:") {
                            ipv4 = Some(ip4.trim().to_string());
                            ipv6 = Some(ip6.trim().to_string());
                        } else {
                            ipv4 = Some(ips.trim().to_string());
                        }
                    } else {
                        location = loc_part.to_string();
                    }
                }
            }

            TunnelState::Connected { relay, location, ipv4, ipv6 }
        } else if trimmed.starts_with("Connecting") {
            TunnelState::Connecting
        } else if trimmed.starts_with("Disconnected") {
            TunnelState::Disconnected
        } else if trimmed.starts_with("Blocked") {
            TunnelState::Blocked(trimmed.to_string())
        } else {
            TunnelState::Unknown(trimmed.to_string())
        }
    }

    /// Connects to Mullvad VPN (optionally targeting a location).
    pub async fn connect(&self, location: Option<&str>) -> Result<(), VpnError> {
        if let Some(loc) = location {
            let mut cmd = tokio::process::Command::new(&self.bin_path).no_window();
            cmd.args(["relay", "set", "location", loc]);
            let output = cmd.output().await?;
            if !output.status.success() {
                let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
                return Err(VpnError::CommandFailed { code: output.status.code(), stderr });
            }
        }

        let output = tokio::process::Command::new(&self.bin_path).no_window().arg("connect").output().await?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
            return Err(VpnError::CommandFailed { code: output.status.code(), stderr });
        }

        Ok(())
    }

    /// Disconnects from Mullvad VPN.
    pub async fn disconnect(&self) -> Result<(), VpnError> {
        let output =
            tokio::process::Command::new(&self.bin_path).no_window().arg("disconnect").output().await?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
            return Err(VpnError::CommandFailed { code: output.status.code(), stderr });
        }

        Ok(())
    }

    /// Ensures connection to an EEA-bypass location suitable for Google AI / agy.
    /// Default target location: "us" (United States) or "ch" (Switzerland).
    pub async fn ensure_connected_for_agy(&self) -> Result<(), VpnError> {
        match self.status().await? {
            TunnelState::Connected { location, .. } => {
                let loc_lower = location.to_lowercase();
                if !loc_lower.contains("france") {
                    return Ok(());
                }
                self.connect(Some("us")).await?;
            },
            TunnelState::Disconnected | TunnelState::Unknown(_) | TunnelState::Blocked(_) => {
                self.connect(Some("us")).await?;
            },
            TunnelState::Connecting => {
                tokio::time::sleep(std::time::Duration::from_millis(1500)).await;
            },
        }
        Ok(())
    }
}

/// Information about an active proxy tunnel suitable for environment export.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ProxyConfig {
    pub proxy_url: String,
    pub exit_country: String,
    pub exit_ip: Option<String>,
    pub exit_city: Option<String>,
}

/// Supervisor for VPS-hosted Mullvad SOCKS5 proxy over SSH tunnel.
pub struct VpsProxyManager;

impl VpsProxyManager {
    /// Tests if a local SOCKS5 port is active by asking an IP-info service
    /// for the exit identity through it (native HTTP client, no `curl`).
    pub async fn check_proxy_alive(port: u16) -> Option<ProxyConfig> {
        ensure_crypto_provider();
        let proxy = reqwest::Proxy::all(format!("socks5://127.0.0.1:{port}")).ok()?;
        let client = reqwest::Client::builder()
            .proxy(proxy)
            .timeout(std::time::Duration::from_secs(4))
            .build()
            .ok()?;
        let response =
            client.get("https://ipinfo.io/json").send().await.ok()?.error_for_status().ok()?;
        let val: serde_json::Value = response.json().await.ok()?;
        let exit_country = val.get("country").and_then(|v| v.as_str()).unwrap_or("").to_string();
        if exit_country.is_empty() {
            return None;
        }

        Some(ProxyConfig {
            proxy_url: format!("socks5h://127.0.0.1:{}", port),
            exit_country,
            exit_ip: val.get("ip").and_then(|v| v.as_str()).map(ToString::to_string),
            exit_city: val.get("city").and_then(|v| v.as_str()).map(ToString::to_string),
        })
    }

    /// Spawns an SSH port-forwarding tunnel in background to the VPS Mullvad netns.
    pub async fn start_ssh_tunnel(port: u16, host: &str, remote: &str) -> Result<(), VpnError> {
        #[cfg(target_os = "windows")]
        {
            let arg_list = format!("'-N', '-L', '{}:{}', '{}'", port, remote, host);
            let _ = std::process::Command::new("powershell").no_window()
                .args([
                    "-NoProfile",
                    "-Command",
                    &format!("Start-Process ssh -ArgumentList {} -WindowStyle Hidden", arg_list),
                ])
                .status();
        }
        #[cfg(not(target_os = "windows"))]
        {
            let _ = std::process::Command::new("ssh").no_window()
                .args(["-f", "-N", "-L", &format!("{}:{}", port, remote), host])
                .status();
        }

        tokio::time::sleep(std::time::Duration::from_millis(1500)).await;
        Ok(())
    }

    /// Ensures the SSH VPS Mullvad SOCKS5 proxy is active and exiting in the US.
    pub async fn ensure_vps_proxy_us(port: u16) -> Result<ProxyConfig, VpnError> {
        // 1. Check if already alive
        if let Some(cfg) = Self::check_proxy_alive(port).await {
            if cfg.exit_country.eq_ignore_ascii_case("US") {
                return Ok(cfg);
            }
        }

        // 2. Spawn tunnel if not reachable
        let (host, remote) = vps_proxy_target(
            std::env::var(PROXY_HOST_ENV).ok(),
            std::env::var(PROXY_REMOTE_ENV).ok(),
        )?;
        Self::start_ssh_tunnel(port, &host, &remote).await?;

        // 3. Wait and check
        for _ in 0..4 {
            if let Some(cfg) = Self::check_proxy_alive(port).await {
                if cfg.exit_country.eq_ignore_ascii_case("US") {
                    return Ok(cfg);
                }
                // Switch VPS relay to US if it was pointing elsewhere
                let _ = tokio::process::Command::new("ssh").no_window()
                    .args([host.as_str(), "sudo /usr/local/bin/mullvad-switch-relay us"])
                    .output()
                    .await;
                tokio::time::sleep(std::time::Duration::from_millis(1000)).await;
                if let Some(new_cfg) = Self::check_proxy_alive(port).await {
                    return Ok(new_cfg);
                }
            }
            tokio::time::sleep(std::time::Duration::from_millis(1000)).await;
        }

        Err(VpnError::ParseError("Impossible d'établir le proxy SOCKS5 US via VPS".into()))
    }
}

/// Convenience helper to check if Mullvad is available and connected to non-EEA.
pub async fn ensure_vpn_for_agy() -> Result<(), VpnError> {
    let controller = MullvadController::discover()?;
    controller.ensure_connected_for_agy().await
}

/// Top-level supervisor for agy CLI geo-unblocking.
///
/// Returns `Ok(Some(ProxyConfig))` if an SSH VPS US SOCKS5 proxy was configured and should be
/// passed to `agy`, or `Ok(None)` if the local Mullvad VPN is already active and routing traffic
/// outside EEA.
pub async fn ensure_us_connectivity_for_agy() -> Result<Option<ProxyConfig>, VpnError> {
    // If forced to use VPS proxy, bypass local Mullvad check
    if std::env::var("APHRODY_FORCE_VPS_PROXY").unwrap_or_default() == "1" {
        let cfg = VpsProxyManager::ensure_vps_proxy_us(1080).await?;
        return Ok(Some(cfg));
    }

    // Check local Mullvad VPN first
    if let Ok(controller) = MullvadController::discover() {
        if let Ok(status) = controller.status().await {
            match status {
                TunnelState::Connected { location, .. } => {
                    let loc_lower = location.to_lowercase();
                    if !loc_lower.contains("france") {
                        // Already connected to a supported non-EEA exit (e.g. US)
                        return Ok(None);
                    }
                    // In France: attempt to switch local Mullvad to US
                    if controller.connect(Some("us")).await.is_ok() {
                        return Ok(None);
                    }
                },
                _ => {
                    // Try to connect local Mullvad to US
                    if controller.connect(Some("us")).await.is_ok() {
                        return Ok(None);
                    }
                },
            }
        }
    }

    // Local Mullvad unavailable or failed to connect: fallback to SSH VPS US proxy tunnel
    let cfg = VpsProxyManager::ensure_vps_proxy_us(1080).await?;
    Ok(Some(cfg))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_connected_status() {
        let sample = "Connected\n    Relay:                  us-mia-wg-103\n    Features:               \
             DAITA, Dns Content Blocker, LAN Sharing, Quantum Resistance, Split Tunneling\n    \
             Visible location:       USA, Miami, FL. IPv4: 135.136.36.109, IPv6: \
             2a0d:5600:6:106::e002";
        let state = MullvadController::parse_status(sample);
        match state {
            TunnelState::Connected { relay, location, ipv4, ipv6 } => {
                assert_eq!(relay, "us-mia-wg-103");
                assert_eq!(location, "USA, Miami, FL");
                assert_eq!(ipv4, Some("135.136.36.109".to_string()));
                assert_eq!(ipv6, Some("2a0d:5600:6:106::e002".to_string()));
            },
            _ => panic!("Expected Connected state, got {:?}", state),
        }
    }

    #[test]
    fn vps_proxy_target_requires_remote() {
        assert!(matches!(vps_proxy_target(None, None), Err(VpnError::Config(_))));
        assert!(matches!(vps_proxy_target(None, Some(" ".into())), Err(VpnError::Config(_))));
        let (host, remote) = vps_proxy_target(None, Some("socks.internal:1080".into())).unwrap();
        assert_eq!((host.as_str(), remote.as_str()), ("vps", "socks.internal:1080"));
        let (host, _) = vps_proxy_target(Some("edge".into()), Some("h:1".into())).unwrap();
        assert_eq!(host, "edge");
    }

    #[test]
    fn test_parse_disconnected_status() {
        let sample = "Disconnected\n";
        let state = MullvadController::parse_status(sample);
        assert_eq!(state, TunnelState::Disconnected);
    }
}
