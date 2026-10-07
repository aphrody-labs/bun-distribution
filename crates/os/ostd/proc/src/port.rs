// SPDX-License-Identifier: Apache-2.0
//! Ephemeral loopback port allocation.

use std::{
    io,
    net::{Ipv4Addr, SocketAddrV4, TcpListener},
};

/// A TCP port that was free on the loopback interface a moment ago.
///
/// The OS picks it (bind to port 0), the listener is closed, and the number is
/// returned for a child process to bind. Another process can take the port in
/// between; callers that spawn a server on it must treat "address in use" as
/// "ask again", which is why the supervisor retries its spawn with a fresh port.
///
/// # Errors
///
/// Propagates the bind error (no loopback interface, ephemeral range exhausted).
pub fn free_port() -> io::Result<u16> {
    let listener = TcpListener::bind(SocketAddrV4::new(Ipv4Addr::LOCALHOST, 0))?;
    Ok(listener.local_addr()?.port())
}
