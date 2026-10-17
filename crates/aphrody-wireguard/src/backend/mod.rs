// SPDX-License-Identifier: Apache-2.0
//! Live WireGuard interfaces: Linux kernel (netlink), userspace (boringtun, Linux/BSD/macOS) and
//! WireGuardNT (Windows kernel driver).

use aphrody_proc::NoWindow as _;
use std::net::SocketAddr;
use std::time::SystemTime;

use ipnet::IpNet;
use serde::Serialize;

use crate::conf::{Config, Peer, PeerPatch, Table};
use crate::{Key, Result};

#[cfg(unix)]
mod unix;
#[cfg(unix)]
use unix as platform;
#[cfg(windows)]
mod windows;
#[cfg(windows)]
use windows as platform;

/// Which WireGuard implementation drives the interface.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Backend {
    /// In-kernel WireGuard: Linux netlink or WireGuardNT on Windows.
    Kernel,
    /// In-process boringtun device (lives as long as the process).
    Userspace,
}

impl Backend {
    /// The preferred backend of this platform.
    #[must_use]
    pub fn native() -> Self {
        if cfg!(any(target_os = "linux", windows)) {
            Self::Kernel
        } else {
            Self::Userspace
        }
    }

    /// Whether the interface outlives the process that created it.
    #[must_use]
    pub fn persistent(self) -> bool {
        matches!(self, Self::Kernel) && cfg!(target_os = "linux")
    }
}

/// Runtime state of one peer (`wg show`).
#[derive(Debug, Clone, Serialize)]
pub struct PeerStatus {
    pub public_key: Key,
    pub endpoint: Option<SocketAddr>,
    pub allowed_ips: Vec<IpNet>,
    /// Seconds since the Unix epoch of the latest handshake.
    pub latest_handshake: Option<u64>,
    pub rx_bytes: u64,
    pub tx_bytes: u64,
    pub persistent_keepalive: Option<u16>,
}

/// Runtime state of an interface (`wg show <iface>`).
#[derive(Debug, Clone, Serialize)]
pub struct InterfaceStatus {
    pub name: String,
    pub backend: Backend,
    pub public_key: Option<Key>,
    pub listen_port: u16,
    pub fwmark: Option<u32>,
    pub peers: Vec<PeerStatus>,
}

pub(crate) fn epoch(t: Option<SystemTime>) -> Option<u64> {
    t.and_then(|t| t.duration_since(SystemTime::UNIX_EPOCH).ok())
        .map(|d| d.as_secs())
        .filter(|s| *s > 0)
}

/// A live interface. On Windows and for userspace devices the interface is removed when this
/// handle is dropped, like `wireguard.exe` tunnel services and `wireguard-go`.
pub struct Tunnel {
    name: String,
    backend: Backend,
    inner: platform::Handle,
}

impl Tunnel {
    /// `wg-quick up`: create the interface, apply keys, peers, addresses, MTU, routes and DNS,
    /// running PreUp/PostUp around it.
    pub fn up(name: &str, cfg: &Config, backend: Backend) -> Result<Self> {
        hooks(&cfg.interface.pre_up, name)?;
        let inner = platform::Handle::create(name, cfg, backend)?;
        if cfg.interface.table != Table::Off {
            inner.route(cfg)?;
        }
        if !cfg.interface.dns.is_empty() {
            inner.dns(cfg)?;
        }
        hooks(&cfg.interface.post_up, name)?;
        Ok(Self {
            name: name.to_owned(),
            backend,
            inner,
        })
    }

    /// Attach to an interface that already exists.
    pub fn open(name: &str, backend: Backend) -> Result<Self> {
        Ok(Self {
            name: name.to_owned(),
            backend,
            inner: platform::Handle::open(name, backend)?,
        })
    }

    #[must_use]
    pub fn name(&self) -> &str {
        &self.name
    }

    /// `wg show`.
    pub fn status(&self) -> Result<InterfaceStatus> {
        let mut st = self.inner.status()?;
        st.name.clone_from(&self.name);
        st.backend = self.backend;
        Ok(st)
    }

    /// `wg set <iface> peer ...` (add or update).
    pub fn set_peer(&self, peer: &Peer) -> Result<()> {
        self.inner.set_peer(peer)
    }

    /// Update only explicitly supplied peer fields, preserving live routes and secret PSKs.
    pub fn patch_peer(&self, patch: &PeerPatch) -> Result<()> {
        self.inner.patch_peer(patch)
    }

    /// `wg set <iface> peer <key> remove`.
    pub fn remove_peer(&self, key: &Key) -> Result<()> {
        self.inner.remove_peer(key)
    }

    /// `wg syncconf`: converge peers on `cfg` without disturbing unchanged sessions.
    pub fn sync(&self, cfg: &Config) -> Result<SyncReport> {
        let current = self.status()?;
        let mut report = SyncReport::default();
        for live in &current.peers {
            if !cfg.peers.iter().any(|p| p.public_key == live.public_key) {
                self.remove_peer(&live.public_key)?;
                report.removed.push(live.public_key);
            }
        }
        for p in &cfg.peers {
            self.set_peer(p)?;
            report.configured.push(p.public_key);
        }
        Ok(report)
    }

    /// `wg-quick down`: PreDown, remove the interface, PostDown.
    pub fn down(self, cfg: Option<&Config>) -> Result<()> {
        if let Some(c) = cfg {
            hooks(&c.interface.pre_down, &self.name)?;
        }
        self.inner.remove()?;
        if let Some(c) = cfg {
            hooks(&c.interface.post_down, &self.name)?;
        }
        Ok(())
    }
}

/// Outcome of [`Tunnel::sync`].
#[derive(Debug, Default, Serialize)]
pub struct SyncReport {
    pub configured: Vec<Key>,
    pub removed: Vec<Key>,
}

/// Run `wg-quick` hook commands with `%i` replaced by the interface name.
fn hooks(cmds: &[String], name: &str) -> Result<()> {
    for c in cmds {
        let line = c.replace("%i", name);
        #[cfg(windows)]
        let status = std::process::Command::new("cmd")
            .no_window()
            .args(["/C", &line])
            .status();
        #[cfg(not(windows))]
        let status = std::process::Command::new("sh")
            .no_window()
            .args(["-c", &line])
            .status();
        let status = status.map_err(|e| crate::Error::Backend(format!("hook `{line}`: {e}")))?;
        if !status.success() {
            return Err(crate::Error::Backend(format!(
                "hook `{line}` a échoué ({status})"
            )));
        }
    }
    Ok(())
}
