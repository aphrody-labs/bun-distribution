// SPDX-License-Identifier: Apache-2.0
//! Native WireGuard for Aphrody, one Rust owner for every host of the private tunnel.
//!
//! - [`Key`]: `wg genkey | pubkey | genpsk`.
//! - [`Config`]: the full `wg-quick` / WireGuard for Windows file format (`strip` included).
//! - [`Tunnel`]: `wg-quick up/down`, `wg show`, `wg set`, `wg syncconf` on the Linux kernel
//!   module (netlink), the boringtun userspace device (Linux, BSD, macOS) or the WireGuardNT
//!   kernel driver (Windows, [`driver`]).
//! - [`Inventory`]: the declared tunnel `tools/config/host/wireguard/aphrody-tunnel.json`.
//!
//! `aphrody infra wg set-peer` uses [`PeerPatch`]: omitted options preserve the live peer's
//! AllowedIPs, endpoint, keepalive and preshared key. An explicit empty `--allowed-ips` clears
//! its routes; `--keepalive 0` disables keepalive. [`Tunnel::set_peer`] and
//! [`Tunnel::sync`] still apply complete peer configurations. Private keys and PSKs remain
//! inside the backend; peer status and successful CLI receipts do not expose them.

pub mod backend;
pub mod conf;
pub mod driver;
pub mod inventory;
mod key;
pub mod state;

pub use backend::{Backend, InterfaceStatus, PeerStatus, SyncReport, Tunnel};
pub use conf::{Config, Interface, Peer, PeerPatch, Table};
pub use inventory::Inventory;
pub use key::Key;

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("clé WireGuard: {0}")]
    Key(String),
    #[error("configuration WireGuard: {0}")]
    Config(String),
    #[error("interface WireGuard: {0}")]
    Backend(String),
    #[error("pilote WireGuardNT: {0}")]
    Driver(String),
    #[error("non pris en charge: {0}")]
    Unsupported(String),
}

pub type Result<T, E = Error> = std::result::Result<T, E>;
