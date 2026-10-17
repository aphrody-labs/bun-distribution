// SPDX-License-Identifier: Apache-2.0
//! TCP connection table without `netstat`/`ss`: `GetExtendedTcpTable`
//! (`TCP_TABLE_OWNER_PID_ALL`, IPv4 and IPv6) on Windows, `/proc/net/tcp{,6}` plus the
//! `/proc/<pid>/fd` socket-inode map on Linux. State names follow .NET `TcpState`
//! (`Listen`, `Established`, `CloseWait`, …), the vocabulary of the WinClean contract.

use std::io;

use crate::system::TcpConnection;

/// Every TCP endpoint of the host (IPv4 first, then IPv6).
pub(crate) fn connections() -> io::Result<Vec<TcpConnection>> {
    imp::connections()
}

/// `MIB_TCP_STATE` (1..=12) to its `TcpState` name.
#[cfg(any(windows, test))]
fn windows_state_name(state: u32) -> &'static str {
    match state {
        1 => "Closed",
        2 => "Listen",
        3 => "SynSent",
        4 => "SynReceived",
        5 => "Established",
        6 => "FinWait1",
        7 => "FinWait2",
        8 => "CloseWait",
        9 => "Closing",
        10 => "LastAck",
        11 => "TimeWait",
        12 => "DeleteTcb",
        _ => "Unknown",
    }
}

/// Linux `tcp_states.h` code (the `st` column) to its `TcpState` name.
#[cfg(any(target_os = "linux", test))]
fn linux_state_name(state: u8) -> &'static str {
    match state {
        0x01 => "Established",
        0x02 => "SynSent",
        0x03 | 0x0C => "SynReceived",
        0x04 => "FinWait1",
        0x05 => "FinWait2",
        0x06 => "TimeWait",
        0x07 => "Closed",
        0x08 => "CloseWait",
        0x09 => "LastAck",
        0x0A => "Listen",
        0x0B => "Closing",
        _ => "Unknown",
    }
}

/// One parsed row of `/proc/net/tcp` or `/proc/net/tcp6`.
#[cfg(any(target_os = "linux", test))]
#[derive(Debug, Clone, PartialEq, Eq)]
struct ProcTcpRow {
    local: (std::net::IpAddr, u16),
    remote: (std::net::IpAddr, u16),
    state: u8,
    inode: u64,
}

/// Decode a `/proc/net/tcp*` address: the kernel prints each 32-bit word of the network-order
/// address with `%08X` in host byte order, so every word is read back with native endianness.
#[cfg(any(target_os = "linux", test))]
fn parse_proc_address(hex: &str) -> Option<std::net::IpAddr> {
    let word = |chunk: &str| u32::from_str_radix(chunk, 16).ok().map(u32::to_ne_bytes);
    match hex.len() {
        8 => Some(std::net::IpAddr::from(word(hex)?)),
        32 => {
            let mut bytes = [0u8; 16];
            for (index, target) in bytes.as_chunks_mut::<4>().0.iter_mut().enumerate() {
                target.copy_from_slice(&word(hex.get(index * 8..index * 8 + 8)?)?);
            }
            Some(std::net::IpAddr::from(bytes))
        }
        _ => None,
    }
}

#[cfg(any(target_os = "linux", test))]
fn parse_proc_endpoint(value: &str) -> Option<(std::net::IpAddr, u16)> {
    let (address, port) = value.split_once(':')?;
    Some((
        parse_proc_address(address)?,
        u16::from_str_radix(port, 16).ok()?,
    ))
}

/// Parse the body of `/proc/net/tcp` or `/proc/net/tcp6` (the header line is skipped).
#[cfg(any(target_os = "linux", test))]
fn parse_proc_net_tcp(contents: &str) -> Vec<ProcTcpRow> {
    contents
        .lines()
        .skip(1)
        .filter_map(|line| {
            let fields: Vec<&str> = line.split_whitespace().collect();
            Some(ProcTcpRow {
                local: parse_proc_endpoint(fields.get(1)?)?,
                remote: parse_proc_endpoint(fields.get(2)?)?,
                state: u8::from_str_radix(fields.get(3)?, 16).ok()?,
                inode: fields.get(9)?.parse().ok()?,
            })
        })
        .collect()
}

/// The inode of a `/proc/<pid>/fd/<n>` link target such as `socket:[12345]`.
#[cfg(any(target_os = "linux", test))]
fn socket_inode(link: &str) -> Option<u64> {
    link.strip_prefix("socket:[")?
        .strip_suffix(']')?
        .parse()
        .ok()
}

#[cfg(windows)]
mod imp {
    use std::{
        io,
        net::{IpAddr, Ipv4Addr, Ipv6Addr},
    };

    use windows::Win32::{
        Foundation::{ERROR_INSUFFICIENT_BUFFER, NO_ERROR, WIN32_ERROR},
        NetworkManagement::IpHelper::{
            GetExtendedTcpTable, MIB_TCP6ROW_OWNER_PID, MIB_TCP6TABLE_OWNER_PID,
            MIB_TCPROW_OWNER_PID, MIB_TCPTABLE_OWNER_PID, TCP_TABLE_OWNER_PID_ALL,
        },
    };

    use super::windows_state_name;
    use crate::{system::TcpConnection, win32::win32_error};

    /// `AF_INET` / `AF_INET6` (`ws2def.h`).
    const AF_INET: u32 = 2;
    const AF_INET6: u32 = 23;

    /// Fetch one `TCP_TABLE_OWNER_PID_ALL` table into a 4-byte aligned buffer.
    fn table(family: u32) -> io::Result<Vec<u32>> {
        let mut size = 0u32;
        let mut buffer: Vec<u32> = Vec::new();
        loop {
            // SAFETY: `buffer` holds at least `size` writable bytes (or none on the first call).
            let status = unsafe {
                GetExtendedTcpTable(
                    (!buffer.is_empty()).then(|| buffer.as_mut_ptr().cast()),
                    &mut size,
                    true,
                    family,
                    TCP_TABLE_OWNER_PID_ALL,
                    0,
                )
            };
            match WIN32_ERROR(status) {
                NO_ERROR if !buffer.is_empty() => return Ok(buffer),
                NO_ERROR | ERROR_INSUFFICIENT_BUFFER => {
                    // Leave headroom: connections may appear between the two calls.
                    buffer = vec![0u32; (size as usize).div_ceil(4) + 64];
                    size = u32::try_from(buffer.len() * 4).unwrap_or(u32::MAX);
                }
                other => return Err(win32_error(other, "GetExtendedTcpTable")),
            }
        }
    }

    /// Rows of a table whose header is `dwNumEntries` followed by the row array at `offset`.
    ///
    /// # Safety
    /// `buffer` must hold a table written by `GetExtendedTcpTable` for rows of type `Row`.
    unsafe fn rows<Row: Copy>(buffer: &[u32], offset: usize) -> Vec<Row> {
        let declared = buffer.first().copied().unwrap_or(0) as usize;
        let capacity = (buffer.len() * 4).saturating_sub(offset) / std::mem::size_of::<Row>();
        let count = declared.min(capacity);
        // SAFETY: `offset` is the row array offset of the table type, the buffer is 4-byte
        // aligned like the rows, and `count` rows fit in the buffer.
        unsafe {
            let first = buffer.as_ptr().cast::<u8>().add(offset).cast::<Row>();
            std::slice::from_raw_parts(first, count).to_vec()
        }
    }

    fn port(raw: u32) -> u16 {
        // The port is stored in network byte order in the low 16 bits.
        u16::from_be(raw as u16)
    }

    fn connection(
        local: IpAddr,
        local_port: u32,
        remote: IpAddr,
        remote_port: u32,
        state: u32,
        pid: u32,
    ) -> TcpConnection {
        TcpConnection {
            local_address: local.to_string(),
            local_port: port(local_port),
            remote_address: remote.to_string(),
            remote_port: port(remote_port),
            state: windows_state_name(state).to_owned(),
            owning_pid: pid,
        }
    }

    pub(super) fn connections() -> io::Result<Vec<TcpConnection>> {
        let ipv4 = table(AF_INET)?;
        // SAFETY: the buffer holds an IPv4 owner-PID table.
        let ipv4_rows: Vec<MIB_TCPROW_OWNER_PID> =
            unsafe { rows(&ipv4, std::mem::offset_of!(MIB_TCPTABLE_OWNER_PID, table)) };
        let ipv6 = table(AF_INET6)?;
        // SAFETY: the buffer holds an IPv6 owner-PID table.
        let ipv6_rows: Vec<MIB_TCP6ROW_OWNER_PID> =
            unsafe { rows(&ipv6, std::mem::offset_of!(MIB_TCP6TABLE_OWNER_PID, table)) };
        let mut result = Vec::with_capacity(ipv4_rows.len() + ipv6_rows.len());
        result.extend(ipv4_rows.iter().map(|row| {
            connection(
                // The address is in network byte order: its in-memory bytes are the octets.
                IpAddr::V4(Ipv4Addr::from(row.dwLocalAddr.to_ne_bytes())),
                row.dwLocalPort,
                IpAddr::V4(Ipv4Addr::from(row.dwRemoteAddr.to_ne_bytes())),
                row.dwRemotePort,
                row.dwState,
                row.dwOwningPid,
            )
        }));
        result.extend(ipv6_rows.iter().map(|row| {
            connection(
                IpAddr::V6(Ipv6Addr::from(row.ucLocalAddr)),
                row.dwLocalPort,
                IpAddr::V6(Ipv6Addr::from(row.ucRemoteAddr)),
                row.dwRemotePort,
                row.dwState,
                row.dwOwningPid,
            )
        }));
        Ok(result)
    }
}

#[cfg(target_os = "linux")]
mod imp {
    use std::{collections::HashMap, io};

    use super::{linux_state_name, parse_proc_net_tcp, socket_inode};
    use crate::system::TcpConnection;

    /// Socket inode to owning PID, from the `/proc/<pid>/fd` links this user may read.
    fn socket_owners() -> HashMap<u64, u32> {
        let mut owners = HashMap::new();
        let Ok(processes) = std::fs::read_dir("/proc") else {
            return owners;
        };
        for process in processes.flatten() {
            let Some(pid) = process
                .file_name()
                .to_str()
                .and_then(|name| name.parse::<u32>().ok())
            else {
                continue;
            };
            let Ok(descriptors) = std::fs::read_dir(process.path().join("fd")) else {
                continue;
            };
            for descriptor in descriptors.flatten() {
                if let Some(inode) = std::fs::read_link(descriptor.path())
                    .ok()
                    .and_then(|target| socket_inode(&target.to_string_lossy()))
                {
                    owners.entry(inode).or_insert(pid);
                }
            }
        }
        owners
    }

    pub(super) fn connections() -> io::Result<Vec<TcpConnection>> {
        let mut rows = parse_proc_net_tcp(&std::fs::read_to_string("/proc/net/tcp")?);
        match std::fs::read_to_string("/proc/net/tcp6") {
            Ok(contents) => rows.extend(parse_proc_net_tcp(&contents)),
            // Kernels built without IPv6 have no tcp6 table.
            Err(error) if error.kind() == io::ErrorKind::NotFound => {}
            Err(error) => return Err(error),
        }
        let owners = socket_owners();
        Ok(rows
            .into_iter()
            .map(|row| TcpConnection {
                local_address: row.local.0.to_string(),
                local_port: row.local.1,
                remote_address: row.remote.0.to_string(),
                remote_port: row.remote.1,
                state: linux_state_name(row.state).to_owned(),
                owning_pid: owners.get(&row.inode).copied().unwrap_or(0),
            })
            .collect())
    }
}

#[cfg(not(any(windows, target_os = "linux")))]
mod imp {
    use std::io;

    use crate::system::TcpConnection;

    pub(super) fn connections() -> io::Result<Vec<TcpConnection>> {
        Err(io::Error::new(
            io::ErrorKind::Unsupported,
            "TCP connection listing is implemented for Windows and Linux",
        ))
    }
}

#[cfg(test)]
mod tests {
    use std::net::{IpAddr, Ipv4Addr, Ipv6Addr};

    use super::{
        ProcTcpRow, linux_state_name, parse_proc_address, parse_proc_net_tcp, socket_inode,
        windows_state_name,
    };

    /// `/proc/net/tcp` as written by a little-endian kernel: a DNS listener on 127.0.0.53:53
    /// and an established HTTPS connection from 192.168.1.10:51234 to 93.184.216.34:443.
    const PROC_NET_TCP: &str = "  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode
   0: 3500007F:0035 00000000:0000 0A 00000000:00000000 00:00000000 00000000   101        0 23456 1 0000000000000000 100 0 0 10 0
   1: 0A01A8C0:C822 22D8B85D:01BB 01 00000000:00000000 02:000A7B6D 00000000  1000        0 98765 2 0000000000000000 20 4 30 10 -1
   2: garbage line
";

    /// `/proc/net/tcp6`: a listener on [::]:22 and one on [::1]:631.
    const PROC_NET_TCP6: &str = "  sl  local_address                         remote_address                        st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode
   0: 00000000000000000000000000000000:0016 00000000000000000000000000000000:0000 0A 00000000:00000000 00:00000000 00000000     0        0 11111 1 0000000000000000 100 0 0 10 0
   1: 00000000000000000000000001000000:0277 00000000000000000000000000000000:0000 0A 00000000:00000000 00:00000000 00000000     0        0 22222 1 0000000000000000 100 0 0 10 0
";

    #[cfg(target_endian = "little")]
    #[test]
    fn proc_net_tcp_fixture_parses_ipv4_rows() {
        let rows = parse_proc_net_tcp(PROC_NET_TCP);
        assert_eq!(
            rows,
            vec![
                ProcTcpRow {
                    local: (IpAddr::V4(Ipv4Addr::new(127, 0, 0, 53)), 53),
                    remote: (IpAddr::V4(Ipv4Addr::UNSPECIFIED), 0),
                    state: 0x0A,
                    inode: 23456,
                },
                ProcTcpRow {
                    local: (IpAddr::V4(Ipv4Addr::new(192, 168, 1, 10)), 51234),
                    remote: (IpAddr::V4(Ipv4Addr::new(93, 184, 216, 34)), 443),
                    state: 0x01,
                    inode: 98765,
                },
            ]
        );
        assert_eq!(linux_state_name(rows[0].state), "Listen");
        assert_eq!(linux_state_name(rows[1].state), "Established");
    }

    #[cfg(target_endian = "little")]
    #[test]
    fn proc_net_tcp6_fixture_parses_ipv6_rows() {
        let rows = parse_proc_net_tcp(PROC_NET_TCP6);
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0].local, (IpAddr::V6(Ipv6Addr::UNSPECIFIED), 22));
        assert_eq!(rows[1].local, (IpAddr::V6(Ipv6Addr::LOCALHOST), 631));
        assert_eq!(rows[1].inode, 22222);
    }

    #[test]
    fn malformed_addresses_are_rejected() {
        assert_eq!(parse_proc_address("XYZ"), None);
        assert_eq!(parse_proc_address("0100007"), None);
        assert_eq!(parse_proc_address("GGGGGGGG"), None);
    }

    #[test]
    fn socket_links_resolve_to_inodes() {
        assert_eq!(socket_inode("socket:[12345]"), Some(12345));
        assert_eq!(socket_inode("pipe:[12345]"), None);
        assert_eq!(socket_inode("/dev/null"), None);
    }

    #[test]
    fn state_names_follow_the_tcpstate_vocabulary() {
        assert_eq!(windows_state_name(2), "Listen");
        assert_eq!(windows_state_name(5), "Established");
        assert_eq!(windows_state_name(8), "CloseWait");
        assert_eq!(windows_state_name(99), "Unknown");
        assert_eq!(linux_state_name(0x0A), "Listen");
        assert_eq!(linux_state_name(0x06), "TimeWait");
        assert_eq!(linux_state_name(0x0C), "SynReceived");
    }

    #[cfg(any(windows, target_os = "linux"))]
    #[test]
    fn live_table_lists_a_bound_listener() {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").expect("bind a listener");
        let port = listener.local_addr().expect("local address").port();
        let rows = super::connections().expect("read the TCP table");
        let row = rows
            .iter()
            .find(|row| row.local_port == port && row.local_address == "127.0.0.1")
            .expect("the bound listener is listed");
        assert_eq!(row.state, "Listen");
        assert_eq!(row.owning_pid, std::process::id());
    }
}
