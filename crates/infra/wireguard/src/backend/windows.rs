// SPDX-License-Identifier: Apache-2.0
//! WireGuardNT (in-kernel WireGuard for Windows) through its documented `wireguard.h` API.
//!
//! An adapter created by this process is deleted when its handle is dropped, exactly like a
//! WireGuard for Windows tunnel service; other processes attach with [`Handle::open`].

use aphrody_proc::NoWindow as _;
use std::net::{Ipv4Addr, SocketAddr, SocketAddrV4};
use std::process::Command;

use wireguard_nt::{Adapter, SetInterface, SetPeer, Wireguard};

use super::{Backend, InterfaceStatus, PeerStatus, epoch};
use crate::conf::{Config, Peer, PeerPatch, Table};
use crate::{Error, Key, Result, driver};

/// Adapter pool shown in Windows network settings.
const POOL: &str = "Aphrody";

fn err(e: impl std::fmt::Display) -> Error {
    Error::Backend(e.to_string())
}

fn load() -> Result<Wireguard> {
    let path = driver::dll_path().ok_or_else(|| {
        Error::Driver(format!(
            "wireguard-{}.dll introuvable ({}); lancer `aphrody infra wg driver install`",
            driver::arch(),
            driver::dll_candidates()
                .iter()
                .map(|p| p.display().to_string())
                .collect::<Vec<_>>()
                .join(", ")
        ))
    })?;
    // Safety: the library is the SHA-256-pinned WireGuardNT DLL installed by `driver::install`
    // (or placed next to the executable by the operator); it is only used through wireguard.h.
    unsafe { wireguard_nt::load_from_path(&path) }
        .map_err(|e| Error::Driver(format!("{}: {e}", path.display())))
}

fn to_set_peer(p: &Peer) -> Result<SetPeer> {
    Ok(SetPeer {
        public_key: Some(p.public_key.0),
        preshared_key: p.preshared_key.map(|k| k.0),
        keep_alive: p.persistent_keepalive,
        endpoint: p
            .resolve_endpoint()?
            .unwrap_or(SocketAddr::V4(SocketAddrV4::new(Ipv4Addr::UNSPECIFIED, 0))),
        allowed_ips: p.allowed_ips.clone(),
    })
}

fn netsh(args: &[&str]) -> Result<()> {
    let out = Command::new("netsh").no_window().args(args).output().map_err(err)?;
    if out.status.success() {
        Ok(())
    } else {
        Err(Error::Backend(format!(
            "netsh {}: {}",
            args.join(" "),
            String::from_utf8_lossy(&out.stdout).trim()
        )))
    }
}

pub(super) struct Handle {
    name: String,
    adapter: Adapter,
    _wg: Wireguard,
}

impl Handle {
    pub(super) fn create(name: &str, cfg: &Config, backend: Backend) -> Result<Self> {
        if backend == Backend::Userspace {
            return Err(Error::Unsupported(
                "Windows: utiliser le backend noyau WireGuardNT".into(),
            ));
        }
        let wg = load()?;
        let adapter = match Adapter::open(&wg, name) {
            Ok(a) => a,
            Err(_) => Adapter::create(&wg, POOL, name, None).map_err(err)?,
        };
        let private_key = cfg
            .interface
            .private_key
            .ok_or_else(|| Error::Config("PrivateKey requis pour up".into()))?;
        let set = SetInterface {
            listen_port: cfg.interface.listen_port,
            public_key: None,
            private_key: Some(private_key.0),
            peers: cfg.peers.iter().map(to_set_peer).collect::<Result<_>>()?,
        };
        adapter.set_config(&set).map_err(err)?;
        // Addresses and, unless `Table = off`, one route per allowed IP (wg-quick semantics).
        let routes = if cfg.interface.table == Table::Off {
            SetInterface { peers: Vec::new(), ..set }
        } else {
            set
        };
        adapter.set_default_route(&cfg.interface.addresses, &routes).map_err(err)?;
        if let Some(mtu) = cfg.interface.mtu {
            for fam in ["ipv4", "ipv6"] {
                netsh(&[
                    "interface",
                    fam,
                    "set",
                    "subinterface",
                    name,
                    &format!("mtu={mtu}"),
                    "store=active",
                ])?;
            }
        }
        adapter.up().map_err(err)?;
        Ok(Self { name: name.to_owned(), adapter, _wg: wg })
    }

    pub(super) fn open(name: &str, _backend: Backend) -> Result<Self> {
        let wg = load()?;
        let adapter = Adapter::open(&wg, name).map_err(|e| {
            Error::Backend(format!("adaptateur {name} absent (tunnel arrêté?): {e}"))
        })?;
        Ok(Self { name: name.to_owned(), adapter, _wg: wg })
    }

    /// Routes are installed by [`Handle::create`] together with the addresses.
    pub(super) fn route(&self, _cfg: &Config) -> Result<()> {
        Ok(())
    }

    pub(super) fn dns(&self, cfg: &Config) -> Result<()> {
        for (i, ip) in cfg.interface.dns.iter().enumerate() {
            let fam = if ip.is_ipv4() { "ipv4" } else { "ipv6" };
            let ip = ip.to_string();
            let name = format!("name={}", self.name);
            if i == 0 {
                netsh(&[
                    "interface",
                    fam,
                    "set",
                    "dnsservers",
                    &name,
                    "static",
                    &ip,
                    "primary",
                    "validate=no",
                ])?;
            } else {
                netsh(&["interface", fam, "add", "dnsservers", &name, &ip, "validate=no"])?;
            }
        }
        Ok(())
    }

    pub(super) fn status(&self) -> Result<InterfaceStatus> {
        let c = self.adapter.get_config();
        Ok(InterfaceStatus {
            name: String::new(),
            backend: Backend::Kernel,
            public_key: Some(Key(c.public_key)).filter(|k| !k.is_zero()),
            listen_port: c.listen_port,
            fwmark: None,
            peers: c
                .peers
                .iter()
                .map(|p| PeerStatus {
                    public_key: Key(p.public_key),
                    endpoint: Some(p.endpoint).filter(|e| e.port() != 0),
                    allowed_ips: p.allowed_ips.clone(),
                    latest_handshake: epoch(p.last_handshake),
                    rx_bytes: p.rx_bytes,
                    tx_bytes: p.tx_bytes,
                    persistent_keepalive: Some(p.persistent_keepalive).filter(|k| *k != 0),
                })
                .collect(),
        })
    }

    /// WireGuardNT replaces the whole peer list on every set: rebuild it from the live state.
    fn replace_peers(&self, edit: impl FnOnce(&mut Vec<SetPeer>) -> Result<()>) -> Result<()> {
        let c = self.adapter.get_config();
        let mut peers: Vec<SetPeer> = c
            .peers
            .iter()
            .map(|p| SetPeer {
                public_key: Some(p.public_key),
                preshared_key: Some(p.preshared_key).filter(|k| k.iter().any(|b| *b != 0)),
                keep_alive: Some(p.persistent_keepalive).filter(|k| *k != 0),
                endpoint: p.endpoint,
                allowed_ips: p.allowed_ips.clone(),
            })
            .collect();
        edit(&mut peers)?;
        self.adapter
            .set_config(&SetInterface {
                listen_port: Some(c.listen_port),
                public_key: None,
                private_key: Some(c.private_key),
                peers,
            })
            .map_err(err)
    }

    pub(super) fn set_peer(&self, peer: &Peer) -> Result<()> {
        let new = to_set_peer(peer)?;
        self.replace_peers(|peers| {
            peers.retain(|p| p.public_key != new.public_key);
            peers.push(new);
            Ok(())
        })
    }

    pub(super) fn patch_peer(&self, patch: &PeerPatch) -> Result<()> {
        self.replace_peers(|peers| {
            let current = peers.iter().find(|p| p.public_key == Some(patch.public_key.0));
            let current = current.map(|p| Peer {
                public_key: patch.public_key,
                preshared_key: p.preshared_key.map(Key),
                allowed_ips: p.allowed_ips.clone(),
                endpoint: Some(p.endpoint).filter(|e| e.port() != 0).map(|e| e.to_string()),
                persistent_keepalive: p.keep_alive,
            });
            let new = to_set_peer(&patch.merge(current.as_ref())?)?;
            peers.retain(|p| p.public_key != new.public_key);
            peers.push(new);
            Ok(())
        })
    }

    pub(super) fn remove_peer(&self, key: &Key) -> Result<()> {
        self.replace_peers(|peers| {
            peers.retain(|p| p.public_key != Some(key.0));
            Ok(())
        })
    }

    pub(super) fn remove(self) -> Result<()> {
        self.adapter.down().map_err(err)
    }
}
