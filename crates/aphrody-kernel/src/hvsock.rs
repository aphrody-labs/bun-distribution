// SPDX-License-Identifier: Apache-2.0
//! Hyper-V byte streams: AF_HYPERV host, AF_VSOCK guest, no IP listener.

#[cfg(target_os = "linux")]
pub async fn connect_guest(port: u32) -> std::io::Result<crate::transport::ClientStream> {
    use std::os::fd::{FromRawFd, OwnedFd};
    let address = libc::sockaddr_vm {
        svm_family: libc::AF_VSOCK as _,
        svm_reserved1: 0,
        svm_port: port,
        svm_cid: libc::VMADDR_CID_HOST,
        svm_zero: [0; 4],
    };
    // SAFETY: the descriptor is adopted immediately and the address has the ABI
    // required by AF_VSOCK. All error paths close the owned descriptor.
    let fd = unsafe {
        libc::socket(
            libc::AF_VSOCK,
            libc::SOCK_STREAM | libc::SOCK_NONBLOCK | libc::SOCK_CLOEXEC,
            0,
        )
    };
    if fd < 0 {
        return Err(std::io::Error::last_os_error());
    }
    let owned = unsafe { OwnedFd::from_raw_fd(fd) };
    let result = unsafe {
        libc::connect(
            fd,
            std::ptr::from_ref(&address).cast(),
            size_of::<libc::sockaddr_vm>() as _,
        )
    };
    if result < 0 && std::io::Error::last_os_error().raw_os_error() != Some(libc::EINPROGRESS) {
        return Err(std::io::Error::last_os_error());
    }
    // UnixStream supplies generic read/write epoll readiness; no Unix address
    // operations are used on this AF_VSOCK descriptor.
    let stream = tokio::net::UnixStream::from_std(std::os::unix::net::UnixStream::from(owned))?;
    tokio::time::timeout(std::time::Duration::from_secs(5), stream.writable())
        .await
        .map_err(|_| {
            std::io::Error::new(
                std::io::ErrorKind::TimedOut,
                "Hyper-V host connect timed out",
            )
        })??;
    if let Some(error) = stream.take_error()? {
        return Err(error);
    }
    Ok(Box::new(stream))
}

#[cfg(windows)]
mod host {
    use std::{io, os::windows::io::FromRawSocket, sync::OnceLock};
    use windows_sys::{Win32::Networking::WinSock::*, core::GUID};

    #[repr(C)]
    struct Address {
        family: u16,
        reserved: u16,
        vm: GUID,
        service: GUID,
    }

    pub struct HostListener(SOCKET);
    impl Drop for HostListener {
        fn drop(&mut self) {
            unsafe {
                closesocket(self.0);
            }
        }
    }

    fn error() -> io::Error {
        io::Error::from_raw_os_error(unsafe { WSAGetLastError() })
    }

    impl HostListener {
        pub fn bind(port: u32, vm: windows_sys::core::GUID) -> io::Result<Self> {
            static STARTUP: OnceLock<i32> = OnceLock::new();
            let code = *STARTUP.get_or_init(|| {
                let mut data = WSADATA::default();
                unsafe { WSAStartup(0x0202, &mut data) }
            });
            if code != 0 {
                return Err(io::Error::from_raw_os_error(code));
            }
            // HV_PROTOCOL_RAW = 1, per hvsocket.h. Winsock socket() returns
            // overlapped sockets, required by Tokio's IOCP registration.
            let socket = unsafe { socket(AF_HYPERV as _, SOCK_STREAM, 1) };
            if socket == INVALID_SOCKET {
                return Err(error());
            }
            let listener = Self(socket);
            let address = Address {
                family: AF_HYPERV,
                reserved: 0,
                vm,
                service: GUID {
                    data1: port,
                    data2: 0xfacb,
                    data3: 0x11e6,
                    data4: [0xbd, 0x58, 0x64, 0, 0x6a, 0x79, 0x86, 0xd3],
                },
            };
            if unsafe {
                bind(
                    socket,
                    std::ptr::from_ref(&address).cast(),
                    size_of::<Address>() as _,
                )
            } == SOCKET_ERROR
                || unsafe { listen(socket, 16) } == SOCKET_ERROR
            {
                return Err(error());
            }
            let mut nonblocking = 1;
            if unsafe { ioctlsocket(socket, FIONBIO, &mut nonblocking) } == SOCKET_ERROR {
                return Err(error());
            }
            Ok(listener)
        }

        pub async fn accept(&self) -> io::Result<crate::transport::ClientStream> {
            loop {
                // No sockaddr_in conversion: the peer address is SOCKADDR_HV.
                let socket = unsafe { accept(self.0, std::ptr::null_mut(), std::ptr::null_mut()) };
                if socket != INVALID_SOCKET {
                    // Adopt only the byte stream; never call TCP-specific options.
                    let stream = unsafe { std::net::TcpStream::from_raw_socket(socket as _) };
                    stream.set_nonblocking(true)?;
                    return Ok(Box::new(tokio::net::TcpStream::from_std(stream)?));
                }
                let cause = error();
                if cause.raw_os_error() != Some(WSAEWOULDBLOCK) {
                    return Err(cause);
                }
                // Poll only while accepting a new connection; established I/O
                // uses IOCP directly and has no polling timer.
                tokio::time::sleep(std::time::Duration::from_millis(10)).await;
            }
        }
    }
}

#[cfg(windows)]
pub use host::HostListener;

/// Resolve the current WSL utility VM through the native Host Compute Service.
/// WSL requires its exact VM ID; the Hyper-V wildcard listener is insufficient.
#[cfg(windows)]
pub fn wsl_vm_id() -> std::io::Result<Option<(String, windows_sys::core::GUID)>> {
    use windows_sys::Win32::{Foundation::LocalFree, System::HostComputeSystem::*};
    struct Operation(HCS_OPERATION);
    impl Drop for Operation {
        fn drop(&mut self) {
            unsafe {
                HcsCloseOperation(self.0);
            }
        }
    }
    let operation = Operation(unsafe { HcsCreateOperation(std::ptr::null(), None) });
    if operation.0.is_null() {
        return Err(std::io::Error::last_os_error());
    }
    let code = unsafe { HcsEnumerateComputeSystems(std::ptr::null(), operation.0) };
    if code < 0 {
        return Err(std::io::Error::other(format!("HCS enumerate: {code:#x}")));
    }
    let mut document = std::ptr::null_mut();
    let code = unsafe { HcsWaitForOperationResult(operation.0, 5000, &mut document) };
    let text = if document.is_null() {
        String::new()
    } else {
        let mut len = 0;
        // HCS owns a terminated UTF-16 allocation; release it on every outcome.
        while len < 524288 && unsafe { *document.add(len) } != 0 {
            len += 1;
        }
        let text = unsafe { String::from_utf16_lossy(std::slice::from_raw_parts(document, len)) };
        unsafe {
            LocalFree(document.cast());
        }
        text
    };
    if code < 0 {
        return Err(std::io::Error::other(format!("HCS result: {code:#x}")));
    }
    let systems: serde_json::Value = serde_json::from_str(&text).map_err(std::io::Error::other)?;
    for system in systems.as_array().into_iter().flatten() {
        if system["Owner"].as_str() != Some("WSL") {
            continue;
        }
        let Some(id) = system["Id"].as_str() else {
            continue;
        };
        let compact = id.replace('-', "");
        if let Ok(value) = u128::from_str_radix(&compact, 16) {
            return Ok(Some((
                id.to_owned(),
                windows_sys::core::GUID::from_u128(value),
            )));
        }
    }
    Ok(None)
}
