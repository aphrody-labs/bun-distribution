// SPDX-License-Identifier: Apache-2.0
//! Linux kernel (netlink) and boringtun userspace interfaces through `defguard_wireguard_rs`.

use defguard_wireguard_rs::dns::DnsConfig;
use defguard_wireguard_rs::key::Key as DgKey;
use defguard_wireguard_rs::net::IpAddrMask;
use defguard_wireguard_rs::peer::Peer as DgPeer;
use defguard_wireguard_rs::{InterfaceConfiguration, Userspace, WGApi, WireguardInterfaceApi};

use super::{Backend, InterfaceStatus, PeerStatus, epoch};
use crate::conf::{Config, Peer, PeerPatch};
use crate::{Error, Key, Result};

fn err(e: impl std::fmt::Display) -> Error {
    Error::Backend(e.to_string())
}

fn mask(n: &ipnet::IpNet) -> IpAddrMask {
    IpAddrMask::new(n.addr(), n.prefix_len())
}

fn to_dg(p: &Peer) -> Result<DgPeer> {
    let mut d = DgPeer::new(DgKey::new(p.public_key.0));
    d.preshared_key = p.preshared_key.map(|k| DgKey::new(k.0));
    d.endpoint = p.resolve_endpoint()?;
    d.persistent_keepalive_interval = p.persistent_keepalive;
    d.allowed_ips = p.allowed_ips.iter().map(mask).collect();
    Ok(d)
}

fn net(m: &IpAddrMask) -> Option<ipnet::IpNet> {
    ipnet::IpNet::new(m.address, m.cidr).ok()
}

enum Api {
    #[cfg(any(target_os = "linux", target_os = "freebsd", target_os = "netbsd"))]
    Kernel(WGApi),
    User(WGApi<Userspace>),
}

pub(super) struct Handle {
    api: Api,
}

macro_rules! with_api {
    ($self:expr, $a:ident => $body:expr) => {
        match &$self.api {
            #[cfg(any(target_os = "linux", target_os = "freebsd", target_os = "netbsd"))]
            Api::Kernel($a) => $body,
            Api::User($a) => $body,
        }
    };
}

impl Handle {
    fn new(name: &str, backend: Backend) -> Result<Self> {
        let api = match backend {
            #[cfg(any(target_os = "linux", target_os = "freebsd", target_os = "netbsd"))]
            Backend::Kernel => Api::Kernel(WGApi::new(name).map_err(err)?),
            #[cfg(not(any(target_os = "linux", target_os = "freebsd", target_os = "netbsd")))]
            Backend::Kernel => return Err(Error::Unsupported("WireGuard noyau sur cet OS".into())),
            Backend::Userspace => Api::User(WGApi::<Userspace>::new(name).map_err(err)?),
        };
        Ok(Self { api })
    }

    pub(super) fn create(name: &str, cfg: &Config, backend: Backend) -> Result<Self> {
        let mut h = Self::new(name, backend)?;
        match &mut h.api {
            #[cfg(any(target_os = "linux", target_os = "freebsd", target_os = "netbsd"))]
            Api::Kernel(a) => a.create_interface().map_err(err)?,
            Api::User(a) => a.create_interface().map_err(err)?,
        }
        let ic = InterfaceConfiguration {
            name: name.to_owned(),
            prvkey: cfg
                .interface
                .private_key
                .ok_or_else(|| Error::Config("PrivateKey requis pour up".into()))?
                .to_base64(),
            addresses: cfg.interface.addresses.iter().map(mask).collect(),
            port: cfg.interface.listen_port.unwrap_or(0),
            peers: cfg.peers.iter().map(to_dg).collect::<Result<_>>()?,
            mtu: cfg.interface.mtu,
            fwmark: cfg.interface.fwmark,
        };
        with_api!(h, a => a.configure_interface(&ic).map_err(err))?;
        Ok(h)
    }

    pub(super) fn open(name: &str, backend: Backend) -> Result<Self> {
        Self::new(name, backend)
    }

    pub(super) fn route(&self, cfg: &Config) -> Result<()> {
        let peers: Vec<DgPeer> = cfg.peers.iter().map(to_dg).collect::<Result<_>>()?;
        with_api!(self, a => a.configure_peer_routing(&peers).map_err(err))
    }

    pub(super) fn dns(&self, cfg: &Config) -> Result<()> {
        let search: Vec<&str> = cfg.interface.dns_search.iter().map(String::as_str).collect();
        let dns = DnsConfig {
            servers: &cfg.interface.dns,
            search_domains: &search,
            routing_domains: &[],
            default_route: search.is_empty(),
        };
        with_api!(self, a => a.set_dns(&dns).map_err(err))
    }

    pub(super) fn status(&self) -> Result<InterfaceStatus> {
        let host = with_api!(self, a => a.read_interface_data().map_err(err))?;
        let public_key = host.private_key.as_ref().map(|k| Key(k.as_array()).public());
        let peers = host
            .peers
            .values()
            .map(|p| PeerStatus {
                public_key: Key(p.public_key.as_array()),
                endpoint: p.endpoint,
                allowed_ips: p.allowed_ips.iter().filter_map(net).collect(),
                latest_handshake: epoch(p.last_handshake),
                rx_bytes: p.rx_bytes,
                tx_bytes: p.tx_bytes,
                persistent_keepalive: p.persistent_keepalive_interval,
            })
            .collect();
        Ok(InterfaceStatus {
            name: String::new(),
            backend: Backend::native(),
            public_key,
            listen_port: host.listen_port,
            fwmark: host.fwmark,
            peers,
        })
    }

    pub(super) fn set_peer(&self, peer: &Peer) -> Result<()> {
        let p = to_dg(peer)?;
        with_api!(self, a => a.configure_peer(&p).map_err(err))
    }

    pub(super) fn patch_peer(&self, patch: &PeerPatch) -> Result<()> {
        let host = with_api!(self, a => a.read_interface_data().map_err(err))?;
        let current = host.peers.values().find(|p| p.public_key.as_array() == patch.public_key.0);
        let current = current.map(|p| Peer {
            public_key: Key(p.public_key.as_array()),
            preshared_key: p.preshared_key.as_ref().map(|key| Key(key.as_array())),
            allowed_ips: p.allowed_ips.iter().filter_map(net).collect(),
            endpoint: p.endpoint.map(|endpoint| endpoint.to_string()),
            persistent_keepalive: p.persistent_keepalive_interval,
        });
        self.set_peer(&patch.merge(current.as_ref())?)
    }

    pub(super) fn remove_peer(&self, key: &Key) -> Result<()> {
        let k = DgKey::new(key.0);
        with_api!(self, a => a.remove_peer(&k).map_err(err))
    }

    pub(super) fn remove(self) -> Result<()> {
        with_api!(self, a => a.remove_interface().map_err(err))
    }
}
