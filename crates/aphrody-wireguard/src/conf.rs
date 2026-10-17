// SPDX-License-Identifier: Apache-2.0
//! The `wg-quick` / WireGuard for Windows configuration format, every key included.
//!
//! `[Interface]`: PrivateKey, ListenPort, FwMark, Address, DNS, MTU, Table, PreUp, PostUp, PreDown,
//! PostDown, SaveConfig. `[Peer]`: PublicKey, PresharedKey, AllowedIPs, Endpoint,
//! PersistentKeepalive. Unknown keys are rejected like `wg-quick` does, comments are dropped.

use std::fmt::Write as _;
use std::net::{IpAddr, SocketAddr, ToSocketAddrs};

use ipnet::IpNet;
use serde::{Deserialize, Serialize};

use crate::{Error, Key, Result};

/// Routing table selection of `wg-quick` (`Table =`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Table {
    /// Add routes for the allowed IPs to the main table (default).
    #[default]
    Auto,
    /// Do not add any route.
    Off,
    /// Add routes to this numbered table.
    Id(u32),
}

/// `[Interface]` section.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Interface {
    #[serde(skip)]
    pub private_key: Option<Key>,
    pub listen_port: Option<u16>,
    pub fwmark: Option<u32>,
    pub addresses: Vec<IpNet>,
    pub dns: Vec<IpAddr>,
    pub dns_search: Vec<String>,
    pub mtu: Option<u32>,
    pub table: Table,
    pub pre_up: Vec<String>,
    pub post_up: Vec<String>,
    pub pre_down: Vec<String>,
    pub post_down: Vec<String>,
    pub save_config: bool,
}

/// `[Peer]` section.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Peer {
    pub public_key: Key,
    #[serde(skip)]
    pub preshared_key: Option<Key>,
    pub allowed_ips: Vec<IpNet>,
    /// `host:port` as written; resolved at apply time ([`Peer::resolve_endpoint`]).
    pub endpoint: Option<String>,
    pub persistent_keepalive: Option<u16>,
}

/// A partial `wg set peer` update. Omitted fields retain their live values.
///
/// `Some(Vec::new())` explicitly clears AllowedIPs; `Some(0)` disables keepalive.
/// A preshared key is carried only in memory and uses the redacted [`Key`] debug format.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PeerPatch {
    pub public_key: Key,
    pub preshared_key: Option<Key>,
    pub allowed_ips: Option<Vec<IpNet>>,
    pub endpoint: Option<String>,
    pub persistent_keepalive: Option<u16>,
}

impl PeerPatch {
    #[must_use]
    pub fn new(public_key: Key) -> Self {
        Self {
            public_key,
            preshared_key: None,
            allowed_ips: None,
            endpoint: None,
            persistent_keepalive: None,
        }
    }

    /// Merge into the same live peer, or create a new peer without inferred settings.
    pub fn merge(&self, current: Option<&Peer>) -> Result<Peer> {
        if current.is_some_and(|peer| peer.public_key != self.public_key) {
            return Err(Error::Config(
                "peer patch PublicKey differs from the live peer".into(),
            ));
        }
        let mut peer = current
            .cloned()
            .unwrap_or_else(|| Peer::new(self.public_key));
        if let Some(key) = self.preshared_key {
            peer.preshared_key = Some(key);
        }
        if let Some(allowed_ips) = &self.allowed_ips {
            peer.allowed_ips.clone_from(allowed_ips);
        }
        if let Some(endpoint) = &self.endpoint {
            peer.endpoint = Some(endpoint.clone());
        }
        if let Some(keepalive) = self.persistent_keepalive {
            peer.persistent_keepalive = Some(keepalive);
        }
        Ok(peer)
    }
}

impl Serialize for Key {
    fn serialize<S: serde::Serializer>(&self, s: S) -> std::result::Result<S::Ok, S::Error> {
        s.serialize_str(&self.to_base64())
    }
}

impl<'de> Deserialize<'de> for Key {
    fn deserialize<D: serde::Deserializer<'de>>(d: D) -> std::result::Result<Self, D::Error> {
        let s = String::deserialize(d)?;
        s.parse().map_err(serde::de::Error::custom)
    }
}

impl Peer {
    #[must_use]
    pub fn new(public_key: Key) -> Self {
        Self {
            public_key,
            preshared_key: None,
            allowed_ips: Vec::new(),
            endpoint: None,
            persistent_keepalive: None,
        }
    }

    /// Resolve `Endpoint` (IPv4, `[IPv6]:port` or DNS name) to a socket address.
    pub fn resolve_endpoint(&self) -> Result<Option<SocketAddr>> {
        let Some(ep) = &self.endpoint else {
            return Ok(None);
        };
        if let Ok(addr) = ep.parse::<SocketAddr>() {
            return Ok(Some(addr));
        }
        ep.to_socket_addrs()
            .map_err(|e| Error::Config(format!("endpoint {ep}: {e}")))?
            .next()
            .map(Some)
            .ok_or_else(|| Error::Config(format!("endpoint {ep}: aucune adresse")))
    }
}

/// A complete tunnel configuration.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Config {
    pub interface: Interface,
    pub peers: Vec<Peer>,
}

fn split_list(v: &str) -> impl Iterator<Item = &str> {
    v.split(',').map(str::trim).filter(|s| !s.is_empty())
}

fn parse_net(s: &str) -> Result<IpNet> {
    if let Ok(n) = s.parse::<IpNet>() {
        return Ok(n);
    }
    let ip: IpAddr = s
        .parse()
        .map_err(|_| Error::Config(format!("adresse invalide: {s}")))?;
    Ok(IpNet::from(ip))
}

fn parse_num<T: std::str::FromStr>(key: &str, v: &str) -> Result<T> {
    v.parse()
        .map_err(|_| Error::Config(format!("{key}: valeur invalide `{v}`")))
}

impl Config {
    /// Parse a `wg-quick` file.
    pub fn parse(text: &str) -> Result<Self> {
        enum Section {
            None,
            Interface,
            Peer,
        }
        let mut cfg = Config::default();
        let mut section = Section::None;
        let mut seen_interface = false;
        for (lineno, raw) in text.lines().enumerate() {
            let line = raw.split('#').next().unwrap_or("").trim();
            if line.is_empty() {
                continue;
            }
            let at = |m: String| Error::Config(format!("ligne {}: {m}", lineno + 1));
            if line.starts_with('[') {
                section = match line.to_ascii_lowercase().as_str() {
                    "[interface]" => {
                        if seen_interface {
                            return Err(at("section [Interface] répétée".into()));
                        }
                        seen_interface = true;
                        Section::Interface
                    }
                    "[peer]" => {
                        cfg.peers.push(Peer::new(Key([0; 32])));
                        Section::Peer
                    }
                    other => return Err(at(format!("section inconnue {other}"))),
                };
                continue;
            }
            let (k, v) = line
                .split_once('=')
                .ok_or_else(|| at("`clé = valeur` attendu".into()))?;
            let (k, v) = (k.trim().to_ascii_lowercase(), v.trim());
            match section {
                Section::None => return Err(at("clé hors section".into())),
                Section::Interface => {
                    let i = &mut cfg.interface;
                    match k.as_str() {
                        "privatekey" => i.private_key = Some(v.parse()?),
                        "listenport" => i.listen_port = Some(parse_num(&k, v)?),
                        "fwmark" => {
                            i.fwmark = if v.eq_ignore_ascii_case("off") {
                                None
                            } else if let Some(h) = v.strip_prefix("0x") {
                                Some(u32::from_str_radix(h, 16).map_err(|_| at("FwMark".into()))?)
                            } else {
                                Some(parse_num(&k, v)?)
                            }
                        }
                        "address" => {
                            for a in split_list(v) {
                                i.addresses.push(parse_net(a)?);
                            }
                        }
                        "dns" => {
                            for d in split_list(v) {
                                match d.parse::<IpAddr>() {
                                    Ok(ip) => i.dns.push(ip),
                                    Err(_) => i.dns_search.push(d.to_string()),
                                }
                            }
                        }
                        "mtu" => i.mtu = Some(parse_num(&k, v)?),
                        "table" => {
                            i.table = match v.to_ascii_lowercase().as_str() {
                                "auto" => Table::Auto,
                                "off" => Table::Off,
                                n => Table::Id(parse_num("Table", n)?),
                            }
                        }
                        "preup" => i.pre_up.push(v.to_string()),
                        "postup" => i.post_up.push(v.to_string()),
                        "predown" => i.pre_down.push(v.to_string()),
                        "postdown" => i.post_down.push(v.to_string()),
                        "saveconfig" => i.save_config = v.eq_ignore_ascii_case("true"),
                        other => return Err(at(format!("clé [Interface] inconnue: {other}"))),
                    }
                }
                Section::Peer => {
                    let p = cfg
                        .peers
                        .last_mut()
                        .ok_or_else(|| at("[Peer] absent".into()))?;
                    match k.as_str() {
                        "publickey" => p.public_key = v.parse()?,
                        "presharedkey" => p.preshared_key = Some(v.parse()?),
                        "allowedips" => {
                            for a in split_list(v) {
                                p.allowed_ips.push(parse_net(a)?);
                            }
                        }
                        "endpoint" => p.endpoint = Some(v.to_string()),
                        "persistentkeepalive" => {
                            p.persistent_keepalive = if v.eq_ignore_ascii_case("off") {
                                None
                            } else {
                                Some(parse_num(&k, v)?)
                            }
                        }
                        other => return Err(at(format!("clé [Peer] inconnue: {other}"))),
                    }
                }
            }
        }
        if let Some(p) = cfg.peers.iter().find(|p| p.public_key.is_zero()) {
            return Err(Error::Config(format!(
                "[Peer] sans PublicKey ({:?})",
                p.endpoint
            )));
        }
        Ok(cfg)
    }

    /// Render the full `wg-quick` file.
    #[must_use]
    pub fn render(&self) -> String {
        self.render_inner(false)
    }

    /// Render only the keys understood by `wg setconf` (`wg-quick strip`).
    #[must_use]
    pub fn strip(&self) -> String {
        self.render_inner(true)
    }

    fn render_inner(&self, stripped: bool) -> String {
        let i = &self.interface;
        let mut s = String::from("[Interface]\n");
        let join = |v: &[IpNet]| {
            v.iter()
                .map(ToString::to_string)
                .collect::<Vec<_>>()
                .join(", ")
        };
        if let Some(k) = &i.private_key {
            let _ = writeln!(s, "PrivateKey = {k}");
        }
        if let Some(p) = i.listen_port {
            let _ = writeln!(s, "ListenPort = {p}");
        }
        if let Some(m) = i.fwmark {
            let _ = writeln!(s, "FwMark = {m}");
        }
        if !stripped {
            if !i.addresses.is_empty() {
                let _ = writeln!(s, "Address = {}", join(&i.addresses));
            }
            let dns: Vec<String> = i
                .dns
                .iter()
                .map(ToString::to_string)
                .chain(i.dns_search.iter().cloned())
                .collect();
            if !dns.is_empty() {
                let _ = writeln!(s, "DNS = {}", dns.join(", "));
            }
            if let Some(m) = i.mtu {
                let _ = writeln!(s, "MTU = {m}");
            }
            match i.table {
                Table::Auto => {}
                Table::Off => s.push_str("Table = off\n"),
                Table::Id(n) => {
                    let _ = writeln!(s, "Table = {n}");
                }
            }
            for (key, cmds) in [
                ("PreUp", &i.pre_up),
                ("PostUp", &i.post_up),
                ("PreDown", &i.pre_down),
                ("PostDown", &i.post_down),
            ] {
                for c in cmds {
                    let _ = writeln!(s, "{key} = {c}");
                }
            }
            if i.save_config {
                s.push_str("SaveConfig = true\n");
            }
        }
        for p in &self.peers {
            let _ = writeln!(s, "\n[Peer]\nPublicKey = {}", p.public_key);
            if let Some(k) = &p.preshared_key {
                let _ = writeln!(s, "PresharedKey = {k}");
            }
            if !p.allowed_ips.is_empty() {
                let _ = writeln!(s, "AllowedIPs = {}", join(&p.allowed_ips));
            }
            if let Some(e) = &p.endpoint {
                let _ = writeln!(s, "Endpoint = {e}");
            }
            if let Some(k) = p.persistent_keepalive {
                let _ = writeln!(s, "PersistentKeepalive = {k}");
            }
        }
        s
    }

    /// The interface public key, when the private key is present.
    #[must_use]
    pub fn public_key(&self) -> Option<Key> {
        self.interface.private_key.map(|k| k.public())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE: &str = "\
[Interface]
PrivateKey = yAnz5TF+lXXJte14tji3zlMNq+hd2rYUIgJBgB3fBmk= # comment
ListenPort = 51820
Address = 10.200.77.4/24, fd00::4/64
DNS = 1.1.1.1, aphrody.internal
MTU = 1420
Table = off
FwMark = 0x10
PostUp = echo up
SaveConfig = true

[Peer]
PublicKey = xTIBA5rboUvnH4htodjb6e697QjLERt1NAB4mZqp8Dg=
PresharedKey = /UwcSPg38hW/D9Y3tcS1FOV0K1wuURMbS0sesJEP5ak=
AllowedIPs = 10.200.77.0/24, 10.9.0.1
Endpoint = 51.77.147.152:51821
PersistentKeepalive = 25
";

    #[test]
    fn parse_render_roundtrip() {
        let cfg = Config::parse(SAMPLE).unwrap();
        assert_eq!(cfg.interface.listen_port, Some(51820));
        assert_eq!(cfg.interface.fwmark, Some(16));
        assert_eq!(cfg.interface.addresses.len(), 2);
        assert_eq!(cfg.interface.dns_search, vec!["aphrody.internal"]);
        assert_eq!(cfg.interface.table, Table::Off);
        assert_eq!(cfg.peers[0].allowed_ips[1].to_string(), "10.9.0.1/32");
        assert_eq!(
            cfg.peers[0].resolve_endpoint().unwrap().unwrap().port(),
            51821
        );
        let again = Config::parse(&cfg.render()).unwrap();
        assert_eq!(again, cfg);
        let stripped = cfg.strip();
        assert!(!stripped.contains("Address") && !stripped.contains("PostUp"));
        assert!(stripped.contains("PresharedKey"));
    }

    #[test]
    fn rejects_unknown_and_missing_key() {
        assert!(Config::parse("[Interface]\nBogus = 1\n").is_err());
        assert!(Config::parse("[Peer]\nAllowedIPs = 10.0.0.0/8\n").is_err());
        assert!(Config::parse("PrivateKey = x\n").is_err());
    }

    #[test]
    fn keepalive_patch_preserves_live_routes_endpoint_and_psk() {
        let cfg = Config::parse(SAMPLE).unwrap();
        let current = &cfg.peers[0];
        let mut patch = PeerPatch::new(current.public_key);
        patch.persistent_keepalive = Some(31);
        let merged = patch.merge(Some(current)).unwrap();
        assert_eq!(merged.allowed_ips, current.allowed_ips);
        assert_eq!(merged.endpoint, current.endpoint);
        assert_eq!(merged.preshared_key, current.preshared_key);
        assert_eq!(merged.persistent_keepalive, Some(31));
        assert_eq!(cfg.peers[0].persistent_keepalive, Some(25));
    }

    #[test]
    fn endpoint_patch_preserves_routes_keepalive_and_psk() {
        let cfg = Config::parse(SAMPLE).unwrap();
        let current = &cfg.peers[0];
        let mut patch = PeerPatch::new(current.public_key);
        patch.endpoint = Some("192.0.2.10:51820".into());
        let merged = patch.merge(Some(current)).unwrap();
        assert_eq!(merged.endpoint.as_deref(), Some("192.0.2.10:51820"));
        assert_eq!(merged.allowed_ips, current.allowed_ips);
        assert_eq!(merged.persistent_keepalive, current.persistent_keepalive);
        assert_eq!(merged.preshared_key, current.preshared_key);
    }

    #[test]
    fn explicit_patch_values_replace_routes_and_can_disable_keepalive() {
        let cfg = Config::parse(SAMPLE).unwrap();
        let current = &cfg.peers[0];
        let mut patch = PeerPatch::new(current.public_key);
        patch.allowed_ips = Some(vec!["10.200.77.10/32".parse().unwrap()]);
        patch.persistent_keepalive = Some(0);
        let merged = patch.merge(Some(current)).unwrap();
        assert_eq!(merged.allowed_ips.len(), 1);
        assert_eq!(merged.allowed_ips[0].to_string(), "10.200.77.10/32");
        assert_eq!(merged.persistent_keepalive, Some(0));
        assert_eq!(merged.endpoint, current.endpoint);
        assert_eq!(merged.preshared_key, current.preshared_key);
        patch.allowed_ips = Some(Vec::new());
        assert!(patch.merge(Some(current)).unwrap().allowed_ips.is_empty());
    }

    #[test]
    fn new_peer_patch_has_only_declared_settings_and_rejects_a_foreign_peer() {
        let mut patch = PeerPatch::new(Key([1; 32]));
        patch.allowed_ips = Some(vec!["2001:db8::10/128".parse().unwrap()]);
        let added = patch.merge(None).unwrap();
        assert_eq!(added.public_key, patch.public_key);
        assert_eq!(added.allowed_ips, patch.allowed_ips.clone().unwrap());
        assert_eq!(added.endpoint, None);
        assert_eq!(added.persistent_keepalive, None);
        assert_eq!(added.preshared_key, None);
        assert!(patch.merge(Some(&Peer::new(Key([2; 32])))).is_err());
    }

    #[test]
    fn explicit_psk_patch_preserves_nonsecret_settings_and_redacts_debug() {
        let cfg = Config::parse(SAMPLE).unwrap();
        let current = &cfg.peers[0];
        let mut patch = PeerPatch::new(current.public_key);
        let psk = Key([9; 32]);
        patch.preshared_key = Some(psk);
        let merged = patch.merge(Some(current)).unwrap();
        assert_eq!(merged.preshared_key, Some(psk));
        assert_eq!(merged.allowed_ips, current.allowed_ips);
        assert_eq!(merged.endpoint, current.endpoint);
        assert_eq!(merged.persistent_keepalive, current.persistent_keepalive);
        assert!(!format!("{patch:?}").contains(&psk.to_base64()));
        assert!(
            !serde_json::to_string(&merged)
                .unwrap()
                .contains(&psk.to_base64())
        );
    }
}
