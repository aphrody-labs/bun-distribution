// SPDX-License-Identifier: Apache-2.0
//! One remote-target model for every remote-control channel.
//!
//! A target is `local`, a URI (`vnc://`, `http(s)://` for MCP, `ws(s)://` for the remote
//! desktop, `shell://`) or a bare `host[:port]` whose channel is given by the caller. Hosts
//! that are member ids of the declared tunnel (`omar`, `aphro-pc`, `vps`...) resolve to their
//! WireGuard (`wg1`) address and to the port the inventory declares for the channel;
//! `<id>-forward` / `<id>-tunnel` resolve to a loopback SSH forward on `port + 10000`.
//! Credentials come from [`crate::tokens`], scoped by the member id.

use std::fmt;
use std::net::IpAddr;
use std::path::{Path, PathBuf};

use anyhow::{Context, Result, bail};
use aphrody_wireguard::Inventory;
use aphrody_wireguard::inventory::INVENTORY_PATH;

use crate::tokens::{self, Secret, TokenKind};

/// Offset of the loopback SSH forward of a tunnel port (`8793` is forwarded on `18793`).
pub const FORWARD_OFFSET: u16 = 10_000;

/// Remote-control channel of a target.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TargetKind {
    /// This machine (local capture/input backend).
    Local,
    /// `aphrody-mcp http` exposing the `computer_*` tools.
    McpHttp,
    /// RFB server (`aphrody infra remote serve --vnc`, or any VNC server).
    Vnc,
    /// WebSocket remote desktop (`aphrody infra remote serve`).
    Ws,
    /// PTY WebSocket of `aphrody shell serve`.
    Shell,
}

impl TargetKind {
    pub const REMOTE: [Self; 4] = [Self::McpHttp, Self::Vnc, Self::Ws, Self::Shell];

    #[must_use]
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Local => "local",
            Self::McpHttp => "mcp-http",
            Self::Vnc => "vnc",
            Self::Ws => "ws",
            Self::Shell => "shell",
        }
    }

    /// Parse `local` / `mcp-http` (`mcp`) / `vnc` / `ws` (`remote-desktop`) / `shell`.
    pub fn parse(s: &str) -> Result<Self> {
        Ok(match s.to_ascii_lowercase().as_str() {
            "local" => Self::Local,
            "mcp" | "mcp-http" | "http" => Self::McpHttp,
            "vnc" | "rfb" => Self::Vnc,
            "ws" | "remote" | "remote-desktop" => Self::Ws,
            "shell" => Self::Shell,
            other => bail!("unknown target kind {other} (local, mcp-http, vnc, ws, shell)"),
        })
    }

    /// Port used when neither the spec nor the inventory names one.
    #[must_use]
    pub fn default_port(self) -> u16 {
        match self {
            Self::Local => 0,
            Self::McpHttp => 8793,
            Self::Vnc => 5900,
            Self::Ws => 8795,
            Self::Shell => 8790,
        }
    }

    /// Prefix of the inventory service ids of this channel (`vnc-omar`, `mcp-http-omar`...).
    fn service_prefix(self) -> Option<&'static str> {
        match self {
            Self::Local => None,
            Self::McpHttp => Some("mcp-http"),
            Self::Vnc => Some("vnc"),
            Self::Ws => Some("remote-desktop"),
            Self::Shell => Some("shell"),
        }
    }

    /// Credential of this channel.
    #[must_use]
    pub fn token_kind(self) -> Option<TokenKind> {
        match self {
            Self::Local => None,
            Self::McpHttp => Some(TokenKind::Mcp),
            Self::Vnc => Some(TokenKind::Vnc),
            Self::Ws => Some(TokenKind::Remote),
            Self::Shell => Some(TokenKind::Shell),
        }
    }

    fn from_scheme(scheme: &str) -> Option<(Self, bool)> {
        Some(match scheme.to_ascii_lowercase().as_str() {
            "vnc" | "rfb" => (Self::Vnc, false),
            "http" | "mcp" => (Self::McpHttp, false),
            "https" => (Self::McpHttp, true),
            "ws" => (Self::Ws, false),
            "wss" => (Self::Ws, true),
            "shell" => (Self::Shell, false),
            _ => return None,
        })
    }
}

/// A resolved remote-control endpoint.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RemoteTarget {
    pub kind: TargetKind,
    /// Tunnel member id when the host belongs to the declared tunnel.
    pub id: Option<String>,
    pub host: String,
    pub port: u16,
    /// HTTP path (MCP endpoint, `/mcp` by default).
    pub path: String,
    /// TLS (`https`, `wss`).
    pub secure: bool,
    /// Reached through a loopback SSH forward (`<id>-forward`).
    pub forwarded: bool,
}

impl fmt::Display for RemoteTarget {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.url())
    }
}

/// Legacy names of tunnel members.
fn alias(host: &str) -> &str {
    match host {
        "owner" => "aphro-pc",
        "hub" => "vps",
        other => other,
    }
}

fn split_host_port(authority: &str) -> Result<(String, Option<u16>)> {
    let parse_port = |p: &str| -> Result<u16> {
        p.parse::<u16>()
            .with_context(|| format!("invalid port {p} in {authority}"))
    };
    if let Some(rest) = authority.strip_prefix('[') {
        let (host, tail) = rest
            .split_once(']')
            .with_context(|| format!("unterminated [ in {authority}"))?;
        let port = match tail.strip_prefix(':') {
            Some(p) => Some(parse_port(p)?),
            None if tail.is_empty() => None,
            None => bail!("unexpected {tail} after ] in {authority}"),
        };
        return Ok((host.to_owned(), port));
    }
    match authority.rsplit_once(':') {
        // A bare IPv6 literal has several colons and no port.
        Some((h, _)) if h.contains(':') => Ok((authority.to_owned(), None)),
        Some((h, p)) => Ok((h.to_owned(), Some(parse_port(p)?))),
        None => Ok((authority.to_owned(), None)),
    }
}

impl RemoteTarget {
    /// This machine.
    #[must_use]
    pub fn local() -> Self {
        Self {
            kind: TargetKind::Local,
            id: None,
            host: "127.0.0.1".into(),
            port: 0,
            path: String::new(),
            secure: false,
            forwarded: false,
        }
    }

    /// Resolve `spec` against the declared tunnel. A URI scheme overrides `kind`.
    pub fn resolve(spec: &str, kind: TargetKind, inventory: &Inventory) -> Result<Self> {
        let spec = spec.trim();
        if spec.is_empty() {
            bail!("empty remote target");
        }
        if spec.eq_ignore_ascii_case("local") || kind == TargetKind::Local {
            return Ok(Self::local());
        }
        let (kind, secure, rest) = match spec.split_once("://") {
            Some((scheme, rest)) => {
                let (k, s) = TargetKind::from_scheme(scheme)
                    .with_context(|| format!("unsupported scheme {scheme}:// in {spec}"))?;
                (k, s, rest)
            }
            None => (kind, false, spec),
        };
        let (authority, path) = match rest.find('/') {
            Some(i) => (&rest[..i], rest[i..].to_owned()),
            None => (rest, String::new()),
        };
        let (host, explicit_port) = split_host_port(authority)?;
        if host.is_empty() {
            bail!("missing host in {spec}");
        }
        let forward_base = host
            .strip_suffix("-forward")
            .or_else(|| host.strip_suffix("-tunnel"))
            .map(alias);
        let (id, address, forwarded) = match forward_base {
            Some(base) if inventory.address_of(base).is_some() => {
                (Some(base.to_owned()), "127.0.0.1".to_owned(), true)
            }
            _ => {
                let name = alias(&host);
                match inventory.address_of(name) {
                    Some(addr) => (Some(name.to_owned()), addr.to_owned(), false),
                    None => (
                        inventory.id_of_address(&host).map(str::to_owned),
                        host.clone(),
                        false,
                    ),
                }
            }
        };
        let declared = id
            .as_deref()
            .and_then(|id| declared_port(inventory, id, kind));
        let port = match explicit_port {
            Some(p) => p,
            None => {
                let base = declared.unwrap_or_else(|| kind.default_port());
                if forwarded {
                    base.saturating_add(FORWARD_OFFSET)
                } else {
                    base
                }
            }
        };
        let path = match (kind, path.as_str()) {
            (TargetKind::McpHttp, "" | "/") => "/mcp".to_owned(),
            _ => path,
        };
        Ok(Self {
            kind,
            id,
            host: address,
            port,
            path,
            secure,
            forwarded,
        })
    }

    /// `host:port` (IPv6 bracketed).
    #[must_use]
    pub fn addr(&self) -> String {
        if self.host.parse::<IpAddr>().is_ok_and(|ip| ip.is_ipv6()) {
            format!("[{}]:{}", self.host, self.port)
        } else {
            format!("{}:{}", self.host, self.port)
        }
    }

    /// Canonical URL of the endpoint.
    #[must_use]
    pub fn url(&self) -> String {
        let scheme = match (self.kind, self.secure) {
            (TargetKind::Local, _) => return "local".into(),
            (TargetKind::McpHttp, false) => "http",
            (TargetKind::McpHttp, true) => "https",
            (TargetKind::Vnc, _) => "vnc",
            (TargetKind::Ws, false) => "ws",
            (TargetKind::Ws, true) => "wss",
            (TargetKind::Shell, _) => "shell",
        };
        format!("{scheme}://{}{}", self.addr(), self.path)
    }

    /// Credential of the channel, scoped by the member id.
    #[must_use]
    pub fn credential(&self) -> Option<Secret> {
        tokens::resolve(self.kind.token_kind()?, self.id.as_deref())
    }

    /// Like [`Self::credential`] but an error explaining where to put it.
    pub fn require_credential(&self) -> Result<Secret> {
        let kind = self
            .kind
            .token_kind()
            .context("local target needs no credential")?;
        tokens::require(kind, self.id.as_deref())
    }
}

fn declared_port(inventory: &Inventory, id: &str, kind: TargetKind) -> Option<u16> {
    let prefix = kind.service_prefix()?;
    inventory
        .services_of(id)
        .into_iter()
        .filter(|s| s.id == prefix || s.id.starts_with(&format!("{prefix}-")))
        .find_map(|s| s.port)
}

/// Checkout holding the declared tunnel: `root`, else `APHRODY_ROOT`, else an ancestor of the
/// current directory.
#[must_use]
pub fn find_root(root: Option<&Path>) -> Option<PathBuf> {
    let has = |p: &Path| p.join(INVENTORY_PATH).is_file();
    if let Some(r) = root.filter(|r| has(r)) {
        return Some(r.to_path_buf());
    }
    if let Some(r) = std::env::var_os("APHRODY_ROOT")
        .map(PathBuf::from)
        .filter(|r| has(r))
    {
        return Some(r);
    }
    let cwd = std::env::current_dir().ok()?;
    cwd.ancestors().find(|p| has(p)).map(Path::to_path_buf)
}

/// The declared tunnel of the checkout found by [`find_root`], else the compiled-in copy.
pub fn inventory(root: Option<&Path>) -> Result<Inventory> {
    Inventory::discover(find_root(root).as_deref()).map_err(|e| anyhow::anyhow!("{e}"))
}

/// Resolve `spec` against [`inventory`] of `root`.
pub fn resolve(spec: &str, kind: TargetKind, root: Option<&Path>) -> Result<RemoteTarget> {
    RemoteTarget::resolve(spec, kind, &inventory(root)?)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn inv() -> Inventory {
        Inventory::embedded().unwrap()
    }

    #[test]
    fn inventory_members_resolve_to_tunnel_addresses_and_declared_ports() {
        let inv = inv();
        let t = RemoteTarget::resolve("omar", TargetKind::McpHttp, &inv).unwrap();
        assert_eq!(t.url(), "http://10.200.77.10:8793/mcp");
        assert_eq!(t.id.as_deref(), Some("omar"));
        let v = RemoteTarget::resolve("vnc://omar", TargetKind::McpHttp, &inv).unwrap();
        assert_eq!(
            (v.kind, v.addr()),
            (TargetKind::Vnc, "10.200.77.10:5900".into())
        );
        let w = RemoteTarget::resolve("omar", TargetKind::Ws, &inv).unwrap();
        assert_eq!(w.url(), "ws://10.200.77.10:8795");
        let o = RemoteTarget::resolve("owner", TargetKind::McpHttp, &inv).unwrap();
        assert_eq!(
            (o.id.as_deref(), o.host.as_str()),
            (Some("aphro-pc"), "10.200.77.4")
        );
        let h = RemoteTarget::resolve("vps", TargetKind::Shell, &inv).unwrap();
        assert_eq!(h.addr(), "10.200.77.1:8790");
    }

    #[test]
    fn forwards_literals_and_uris() {
        let inv = inv();
        let f = RemoteTarget::resolve("omar-tunnel", TargetKind::McpHttp, &inv).unwrap();
        assert_eq!(
            (f.addr(), f.forwarded, f.id.as_deref()),
            ("127.0.0.1:18793".into(), true, Some("omar"))
        );
        let ip = RemoteTarget::resolve("10.200.77.10:5901", TargetKind::Vnc, &inv).unwrap();
        assert_eq!((ip.id.as_deref(), ip.port), (Some("omar"), 5901));
        let lan = RemoteTarget::resolve("192.168.1.50:9000", TargetKind::McpHttp, &inv).unwrap();
        assert_eq!(
            (lan.id.clone(), lan.url()),
            (None, "http://192.168.1.50:9000/mcp".into())
        );
        let https =
            RemoteTarget::resolve("https://pc.example/custom", TargetKind::Vnc, &inv).unwrap();
        assert_eq!(https.url(), "https://pc.example:8793/custom");
        let v6 = RemoteTarget::resolve("vnc://[::1]:5901", TargetKind::Vnc, &inv).unwrap();
        assert_eq!(v6.addr(), "[::1]:5901");
        assert_eq!(
            RemoteTarget::resolve("local", TargetKind::Vnc, &inv)
                .unwrap()
                .kind,
            TargetKind::Local
        );
        assert!(RemoteTarget::resolve("ftp://x", TargetKind::Vnc, &inv).is_err());
        assert!(RemoteTarget::resolve("omar:notaport", TargetKind::Vnc, &inv).is_err());
        assert!(RemoteTarget::resolve("  ", TargetKind::Vnc, &inv).is_err());
    }

    #[test]
    fn kinds_parse_and_map_credentials() {
        for k in TargetKind::REMOTE {
            assert_eq!(TargetKind::parse(k.as_str()).unwrap(), k);
            assert!(k.token_kind().is_some());
        }
        assert_eq!(TargetKind::parse("remote-desktop").unwrap(), TargetKind::Ws);
        assert!(TargetKind::Local.token_kind().is_none());
    }
}
