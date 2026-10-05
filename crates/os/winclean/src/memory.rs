// SPDX-License-Identifier: Apache-2.0
//! Bounded remote-process memory primitives for the compatibility catalog.

use std::io;

fn invalid(message: &str) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidInput, message)
}

#[cfg(windows)]
fn open(pid: u32, write: bool) -> io::Result<windows::Win32::Foundation::HANDLE> {
    use windows::Win32::System::Threading::{
        OpenProcess, PROCESS_QUERY_INFORMATION, PROCESS_VM_OPERATION, PROCESS_VM_READ,
        PROCESS_VM_WRITE,
    };
    let access = if write {
        PROCESS_QUERY_INFORMATION | PROCESS_VM_OPERATION | PROCESS_VM_WRITE | PROCESS_VM_READ
    } else {
        PROCESS_QUERY_INFORMATION | PROCESS_VM_READ
    };
    unsafe { OpenProcess(access, false, pid) }
        .map_err(|e| io::Error::new(io::ErrorKind::PermissionDenied, e.to_string()))
}

#[cfg(windows)]
fn close(handle: windows::Win32::Foundation::HANDLE) {
    let _ = unsafe { windows::Win32::Foundation::CloseHandle(handle) };
}

#[cfg(windows)]
pub fn read_bytes(pid: u32, address: u64, length: usize) -> io::Result<Vec<u8>> {
    if length == 0 || length > 65_536 {
        return Err(invalid("length must be between 1 and 65536"));
    }
    let handle = open(pid, false)?;
    let mut data = vec![0u8; length];
    let mut read = 0usize;
    let result = unsafe {
        windows::Win32::System::Diagnostics::Debug::ReadProcessMemory(
            handle,
            address as *const _,
            data.as_mut_ptr() as *mut _,
            length,
            Some(&mut read),
        )
    };
    close(handle);
    result.map_err(|e| io::Error::other(e.to_string()))?;
    data.truncate(read);
    Ok(data)
}

#[cfg(not(windows))]
pub fn read_bytes(_pid: u32, _address: u64, _length: usize) -> io::Result<Vec<u8>> {
    Err(io::Error::new(io::ErrorKind::Unsupported, "remote memory is Windows-only"))
}

#[cfg(windows)]
pub fn write_bytes(pid: u32, address: u64, data: &[u8]) -> io::Result<usize> {
    if data.is_empty() || data.len() > 65_536 {
        return Err(invalid("data length must be between 1 and 65536"));
    }
    let handle = open(pid, true)?;
    let mut written = 0usize;
    let result = unsafe {
        windows::Win32::System::Diagnostics::Debug::WriteProcessMemory(
            handle,
            address as *const _,
            data.as_ptr() as *const _,
            data.len(),
            Some(&mut written),
        )
    };
    close(handle);
    result.map_err(|e| io::Error::other(e.to_string()))?;
    Ok(written)
}

#[cfg(not(windows))]
pub fn write_bytes(_pid: u32, _address: u64, _data: &[u8]) -> io::Result<usize> {
    Err(io::Error::new(io::ErrorKind::Unsupported, "remote memory is Windows-only"))
}

#[cfg(windows)]
fn protection(value: &str) -> io::Result<windows::Win32::System::Memory::PAGE_PROTECTION_FLAGS> {
    use windows::Win32::System::Memory::{
        PAGE_EXECUTE_READ, PAGE_EXECUTE_READWRITE, PAGE_NOACCESS, PAGE_READONLY, PAGE_READWRITE,
    };
    match value.to_ascii_lowercase().as_str() {
        "rw" => Ok(PAGE_READWRITE),
        "rwx" => Ok(PAGE_EXECUTE_READWRITE),
        "rx" => Ok(PAGE_EXECUTE_READ),
        "ro" => Ok(PAGE_READONLY),
        "noaccess" => Ok(PAGE_NOACCESS),
        _ => Err(invalid("protect must be rw, rwx, rx, ro or noaccess")),
    }
}

#[cfg(windows)]
pub fn allocate(pid: u32, size: usize, protect_value: &str) -> io::Result<u64> {
    use windows::Win32::System::Memory::{MEM_COMMIT, MEM_RESERVE, VirtualAllocEx};
    if size == 0 || size > 1024 * 1024 * 1024 {
        return Err(invalid("allocation size out of bounds"));
    }
    let h = open(pid, true)?;
    let address = unsafe {
        VirtualAllocEx(h, None, size, MEM_COMMIT | MEM_RESERVE, protection(protect_value)?)
    };
    close(h);
    if address.is_null() { Err(io::Error::last_os_error()) } else { Ok(address as u64) }
}
#[cfg(not(windows))]
pub fn allocate(_pid: u32, _size: usize, _protect: &str) -> io::Result<u64> {
    Err(io::Error::new(io::ErrorKind::Unsupported, "remote memory is Windows-only"))
}

#[cfg(windows)]
pub fn free(pid: u32, address: u64) -> io::Result<()> {
    use windows::Win32::System::Memory::{MEM_RELEASE, VirtualFreeEx};
    let h = open(pid, true)?;
    let r = unsafe { VirtualFreeEx(h, address as *mut _, 0, MEM_RELEASE) };
    close(h);
    r.map_err(|e| io::Error::other(e.to_string()))
}
#[cfg(not(windows))]
pub fn free(_pid: u32, _address: u64) -> io::Result<()> {
    Err(io::Error::new(io::ErrorKind::Unsupported, "remote memory is Windows-only"))
}

#[cfg(windows)]
pub fn protect(pid: u32, address: u64, size: usize, value: &str) -> io::Result<u32> {
    use windows::Win32::System::Memory::{PAGE_PROTECTION_FLAGS, VirtualProtectEx};
    let h = open(pid, true)?;
    let mut old = PAGE_PROTECTION_FLAGS(0);
    let r = unsafe { VirtualProtectEx(h, address as *const _, size, protection(value)?, &mut old) };
    close(h);
    r.map(|_| old.0).map_err(|e| io::Error::other(e.to_string()))
}
#[cfg(not(windows))]
pub fn protect(_pid: u32, _address: u64, _size: usize, _value: &str) -> io::Result<u32> {
    Err(io::Error::new(io::ErrorKind::Unsupported, "remote memory is Windows-only"))
}

#[cfg(windows)]
pub fn query(pid: u32, address: u64) -> io::Result<serde_json::Value> {
    use windows::Win32::System::Memory::{MEMORY_BASIC_INFORMATION, VirtualQueryEx};
    let h = open(pid, false)?;
    let mut info = MEMORY_BASIC_INFORMATION::default();
    let n = unsafe {
        VirtualQueryEx(
            h,
            Some(address as *const _),
            &mut info,
            std::mem::size_of::<MEMORY_BASIC_INFORMATION>(),
        )
    };
    close(h);
    if n == 0 {
        return Err(io::Error::last_os_error());
    };
    Ok(
        serde_json::json!({"BaseAddress":info.BaseAddress as usize,"AllocationBase":info.AllocationBase as usize,"RegionSize":info.RegionSize,"State":info.State.0,"Protect":info.Protect.0,"Type":info.Type.0}),
    )
}
#[cfg(not(windows))]
pub fn query(_pid: u32, _address: u64) -> io::Result<serde_json::Value> {
    Err(io::Error::new(io::ErrorKind::Unsupported, "remote memory is Windows-only"))
}

pub fn parse_address(value: &serde_json::Value) -> io::Result<u64> {
    if let Some(number) = value.as_u64() {
        return Ok(number);
    }
    let text =
        value.as_str().ok_or_else(|| invalid("address must be integer or hexadecimal string"))?;
    let text = text.trim();
    if let Some(hex) = text.strip_prefix("0x").or_else(|| text.strip_prefix("0X")) {
        u64::from_str_radix(hex, 16).map_err(|_| invalid("invalid hexadecimal address"))
    } else {
        text.parse().map_err(|_| invalid("invalid address"))
    }
}

pub fn parse_hex(value: &str) -> io::Result<Vec<u8>> {
    let compact: String = value.chars().filter(|c| !c.is_ascii_whitespace()).collect();
    if compact.is_empty() || !compact.len().is_multiple_of(2) {
        return Err(invalid("hex must contain an even number of digits"));
    }
    (0..compact.len())
        .step_by(2)
        .map(|i| {
            u8::from_str_radix(&compact[i..i + 2], 16)
                .map_err(|_| invalid("invalid hexadecimal bytes"))
        })
        .collect()
}

#[cfg(windows)]
pub fn suspend_resume(pid: u32, resume: bool) -> io::Result<serde_json::Value> {
    use windows::Win32::System::{
        Diagnostics::ToolHelp::{
            CreateToolhelp32Snapshot, TH32CS_SNAPTHREAD, THREADENTRY32, Thread32First, Thread32Next,
        },
        Threading::{OpenThread, ResumeThread, SuspendThread, THREAD_SUSPEND_RESUME},
    };
    let snapshot = unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPTHREAD, 0) }
        .map_err(|e| io::Error::other(e.to_string()))?;
    let mut entry =
        THREADENTRY32 { dwSize: std::mem::size_of::<THREADENTRY32>() as u32, ..Default::default() };
    let mut count = 0u32;
    let mut ok = unsafe { Thread32First(snapshot, &mut entry) }.is_ok();
    while ok {
        if entry.th32OwnerProcessID == pid
            && let Ok(thread) =
                unsafe { OpenThread(THREAD_SUSPEND_RESUME, false, entry.th32ThreadID) }
        {
            if resume {
                unsafe {
                    ResumeThread(thread);
                }
            } else {
                unsafe {
                    SuspendThread(thread);
                }
            }
            let _ = unsafe { windows::Win32::Foundation::CloseHandle(thread) };
            count += 1;
        }
        ok = unsafe { Thread32Next(snapshot, &mut entry) }.is_ok();
    }
    let _ = unsafe { windows::Win32::Foundation::CloseHandle(snapshot) };
    Ok(serde_json::json!({"success":true,"pid":pid,"threads":count,"resumed":resume}))
}
#[cfg(not(windows))]
pub fn suspend_resume(_pid: u32, _resume: bool) -> io::Result<serde_json::Value> {
    Err(io::Error::new(io::ErrorKind::Unsupported, "process suspension is Windows-only"))
}

#[cfg(windows)]
pub fn enable_debug_privilege() -> io::Result<serde_json::Value> {
    enable_privilege(windows::Win32::Security::SE_DEBUG_NAME)
        .map(|()| serde_json::json!({"success":true,"privilege":"SeDebugPrivilege"}))
}

/// Enables one privilege on the current process token. Fails when the token
/// does not hold it (non-elevated process) instead of reporting a silent no-op.
#[cfg(windows)]
pub(crate) fn enable_privilege(name: windows::core::PCWSTR) -> io::Result<()> {
    use windows::Win32::{
        Foundation::{ERROR_NOT_ALL_ASSIGNED, GetLastError},
        Security::{
            AdjustTokenPrivileges, LUID_AND_ATTRIBUTES, LookupPrivilegeValueW,
            SE_PRIVILEGE_ENABLED, TOKEN_ADJUST_PRIVILEGES, TOKEN_PRIVILEGES,
        },
        System::Threading::{GetCurrentProcess, OpenProcessToken},
    };
    let mut token = windows::Win32::Foundation::HANDLE::default();
    unsafe { OpenProcessToken(GetCurrentProcess(), TOKEN_ADJUST_PRIVILEGES, &mut token) }
        .map_err(|e| io::Error::new(io::ErrorKind::PermissionDenied, e.to_string()))?;
    let mut privilege =
        TOKEN_PRIVILEGES { PrivilegeCount: 1, Privileges: [LUID_AND_ATTRIBUTES::default()] };
    if let Err(e) = unsafe { LookupPrivilegeValueW(None, name, &mut privilege.Privileges[0].Luid) }
    {
        let _ = unsafe { windows::Win32::Foundation::CloseHandle(token) };
        return Err(io::Error::new(io::ErrorKind::NotFound, e.to_string()));
    }
    privilege.Privileges[0].Attributes = SE_PRIVILEGE_ENABLED;
    let r = unsafe { AdjustTokenPrivileges(token, false, Some(&privilege), 0, None, None) };
    let not_assigned = r.is_ok() && unsafe { GetLastError() } == ERROR_NOT_ALL_ASSIGNED;
    let _ = unsafe { windows::Win32::Foundation::CloseHandle(token) };
    r.map_err(|e| io::Error::new(io::ErrorKind::PermissionDenied, e.to_string()))?;
    if not_assigned {
        let name = unsafe { name.to_string() }.unwrap_or_default();
        return Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            format!("{name} is not held by this token; run the kernel elevated"),
        ));
    }
    Ok(())
}
#[cfg(not(windows))]
pub fn enable_debug_privilege() -> io::Result<serde_json::Value> {
    Err(io::Error::new(io::ErrorKind::Unsupported, "debug privilege is Windows-only"))
}

#[cfg(windows)]
pub fn list_modules(pid: u32) -> io::Result<Vec<serde_json::Value>> {
    use windows::Win32::System::Diagnostics::ToolHelp::{
        CreateToolhelp32Snapshot, MODULEENTRY32, Module32First, Module32Next, TH32CS_SNAPMODULE,
        TH32CS_SNAPMODULE32,
    };
    let snapshot =
        unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPMODULE | TH32CS_SNAPMODULE32, pid) }
            .map_err(|e| io::Error::other(e.to_string()))?;
    let mut entry =
        MODULEENTRY32 { dwSize: std::mem::size_of::<MODULEENTRY32>() as u32, ..Default::default() };
    let mut rows = Vec::new();
    let mut ok = unsafe { Module32First(snapshot, &mut entry) }.is_ok();
    while ok {
        let name_end = entry.szModule.iter().position(|v| *v == 0).unwrap_or(entry.szModule.len());
        let path_end =
            entry.szExePath.iter().position(|v| *v == 0).unwrap_or(entry.szExePath.len());
        let name = String::from_utf8_lossy(
            &entry.szModule[..name_end].iter().map(|v| *v as u8).collect::<Vec<_>>(),
        )
        .into_owned();
        let path = String::from_utf8_lossy(
            &entry.szExePath[..path_end].iter().map(|v| *v as u8).collect::<Vec<_>>(),
        )
        .into_owned();
        rows.push(serde_json::json!({
            "name": name,
            "path": path,
            "baseAddress": entry.modBaseAddr as usize,
            "sizeOfImage": entry.modBaseSize,
        }));
        ok = unsafe { Module32Next(snapshot, &mut entry) }.is_ok();
    }
    let _ = unsafe { windows::Win32::Foundation::CloseHandle(snapshot) };
    Ok(rows)
}
#[cfg(not(windows))]
pub fn list_modules(_pid: u32) -> io::Result<Vec<serde_json::Value>> {
    Err(io::Error::new(io::ErrorKind::Unsupported, "module enumeration is Windows-only"))
}

pub fn get_module_base(pid: u32, module_name: &str) -> io::Result<serde_json::Value> {
    let wanted = module_name.trim();
    if wanted.is_empty() {
        return Err(invalid("moduleName must not be empty"));
    }
    let rows = list_modules(pid)?;
    rows.into_iter()
        .find(|row| {
            row.get("name")
                .and_then(serde_json::Value::as_str)
                .is_some_and(|name| name.eq_ignore_ascii_case(wanted))
        })
        .ok_or_else(|| {
            io::Error::new(io::ErrorKind::NotFound, format!("module not found: {wanted}"))
        })
}

/// Scan committed writable pages for a little-endian `i32` value.
///
/// The scan follows the catalog contract: inaccessible regions are skipped,
/// reads are bounded to 256 KiB, and returned addresses are absolute process
/// addresses.  The process is opened once for the complete scan so a large
/// address space does not cause a handle storm.
#[cfg(windows)]
pub fn scan_value_int32(pid: u32, value: i32, max_hits: usize) -> io::Result<Vec<u64>> {
    use windows::Win32::System::{
        Diagnostics::Debug::ReadProcessMemory,
        Memory::{
            MEM_COMMIT, MEMORY_BASIC_INFORMATION, PAGE_EXECUTE_READWRITE, PAGE_EXECUTE_WRITECOPY,
            PAGE_READWRITE, PAGE_WRITECOPY, VirtualQueryEx,
        },
    };

    let limit = max_hits.clamp(1, 5_000);
    let handle = open(pid, false)?;
    let mut hits = Vec::with_capacity(limit.min(64));
    let mut address = 0usize;
    let max_address = usize::MAX;
    let needle = value.to_le_bytes();
    let mut info = MEMORY_BASIC_INFORMATION::default();

    while address < max_address && hits.len() < limit {
        let queried = unsafe {
            VirtualQueryEx(
                handle,
                Some(address as *const _),
                &mut info,
                std::mem::size_of::<MEMORY_BASIC_INFORMATION>(),
            )
        };
        if queried == 0 {
            break;
        }

        let base = info.BaseAddress as usize;
        let size = info.RegionSize;
        let next = base.saturating_add(size);
        if next <= address {
            break;
        }
        let protection = info.Protect.0;
        let writable = protection == PAGE_READWRITE.0
            || protection == PAGE_WRITECOPY.0
            || protection == PAGE_EXECUTE_READWRITE.0
            || protection == PAGE_EXECUTE_WRITECOPY.0;
        if info.State == MEM_COMMIT && writable && size >= needle.len() {
            let mut region_offset = 0usize;
            let mut carry = Vec::<u8>::new();
            while region_offset < size && hits.len() < limit {
                let chunk_len = (size - region_offset).min(256 * 1024);
                let mut chunk = vec![0u8; chunk_len];
                let mut read = 0usize;
                let chunk_address = base.saturating_add(region_offset);
                let result = unsafe {
                    ReadProcessMemory(
                        handle,
                        chunk_address as *const _,
                        chunk.as_mut_ptr() as *mut _,
                        chunk_len,
                        Some(&mut read),
                    )
                };
                if result.is_err() || read == 0 {
                    break;
                }
                chunk.truncate(read);
                let carry_len = carry.len();
                let mut scan = Vec::with_capacity(carry_len + chunk.len());
                scan.extend_from_slice(&carry);
                scan.extend_from_slice(&chunk);
                for index in 0..=scan.len().saturating_sub(needle.len()) {
                    if scan[index..index + needle.len()] == needle {
                        let absolute = (chunk_address as u64)
                            .saturating_sub(carry_len as u64)
                            .saturating_add(index as u64);
                        if absolute >= base as u64 && !hits.contains(&absolute) {
                            hits.push(absolute);
                            if hits.len() >= limit {
                                break;
                            }
                        }
                    }
                }
                carry.clear();
                let keep = needle.len().saturating_sub(1).min(scan.len());
                carry.extend_from_slice(&scan[scan.len() - keep..]);
                region_offset = region_offset.saturating_add(read);
                if read < chunk_len {
                    break;
                }
            }
        }
        address = next;
    }
    close(handle);
    Ok(hits)
}

#[cfg(not(windows))]
pub fn scan_value_int32(_pid: u32, _value: i32, _max_hits: usize) -> io::Result<Vec<u64>> {
    Err(io::Error::new(io::ErrorKind::Unsupported, "remote memory is Windows-only"))
}

#[cfg(windows)]
fn parse_aob_pattern(pattern: &str) -> io::Result<Vec<Option<u8>>> {
    let parsed = pattern
        .split_whitespace()
        .map(|token| {
            if token == "?" || token == "??" {
                Ok(None)
            } else if token.len() == 2 {
                u8::from_str_radix(token, 16).map(Some).map_err(|_| invalid("invalid AOB byte"))
            } else {
                Err(invalid("AOB bytes must be two hex digits or ??"))
            }
        })
        .collect::<io::Result<Vec<_>>>()?;
    if parsed.is_empty() { Err(invalid("AOB pattern must not be empty")) } else { Ok(parsed) }
}

/// Scan one loaded module for an IDA-style byte pattern.
#[cfg(windows)]
pub fn scan_module_aob(
    pid: u32,
    module_name: &str,
    pattern: &str,
    max_hits: usize,
) -> io::Result<Vec<u64>> {
    use windows::Win32::System::Diagnostics::Debug::ReadProcessMemory;

    let wanted = module_name.trim();
    if wanted.is_empty() {
        return Err(invalid("moduleName must not be empty"));
    }
    let needle = parse_aob_pattern(pattern)?;
    let limit = max_hits.clamp(1, 100);
    let module = list_modules(pid)?
        .into_iter()
        .find(|row| {
            row.get("name")
                .and_then(serde_json::Value::as_str)
                .is_some_and(|name| name.eq_ignore_ascii_case(wanted))
        })
        .ok_or_else(|| {
            io::Error::new(io::ErrorKind::NotFound, format!("module not found: {wanted}"))
        })?;
    let base = module
        .get("baseAddress")
        .and_then(serde_json::Value::as_u64)
        .ok_or_else(|| invalid("module has no base address"))?;
    let size = module
        .get("sizeOfImage")
        .and_then(serde_json::Value::as_u64)
        .ok_or_else(|| invalid("module has no image size"))? as usize;
    if size < needle.len() {
        return Ok(Vec::new());
    }

    let handle = open(pid, false)?;
    let mut hits = Vec::with_capacity(limit.min(16));
    let mut offset = 0usize;
    let mut carry = Vec::new();
    while offset < size && hits.len() < limit {
        let chunk_len = (size - offset).min(256 * 1024);
        let address = base.saturating_add(offset as u64);
        let mut chunk = vec![0u8; chunk_len];
        let mut read = 0usize;
        let result = unsafe {
            ReadProcessMemory(
                handle,
                address as *const _,
                chunk.as_mut_ptr() as *mut _,
                chunk_len,
                Some(&mut read),
            )
        };
        if result.is_err() || read == 0 {
            close(handle);
            return Err(io::Error::other("module memory read failed"));
        }
        chunk.truncate(read);
        let carry_len = carry.len();
        let mut scan = Vec::with_capacity(carry_len + chunk.len());
        scan.extend_from_slice(&carry);
        scan.extend_from_slice(&chunk);
        for index in 0..=scan.len().saturating_sub(needle.len()) {
            let matches = needle
                .iter()
                .enumerate()
                .all(|(i, expected)| expected.is_none_or(|byte| scan[index + i] == byte));
            if !matches {
                continue;
            }
            let absolute = address.saturating_sub(carry_len as u64).saturating_add(index as u64);
            if absolute >= base && absolute < base.saturating_add(size as u64) {
                hits.push(absolute);
                if hits.len() >= limit {
                    break;
                }
            }
        }
        let keep = needle.len().saturating_sub(1).min(scan.len());
        carry.clear();
        carry.extend_from_slice(&scan[scan.len() - keep..]);
        offset = offset.saturating_add(read);
        if read < chunk_len {
            break;
        }
    }
    close(handle);
    Ok(hits)
}

#[cfg(not(windows))]
pub fn scan_module_aob(
    _pid: u32,
    _module_name: &str,
    _pattern: &str,
    _max_hits: usize,
) -> io::Result<Vec<u64>> {
    Err(io::Error::new(io::ErrorKind::Unsupported, "remote memory is Windows-only"))
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::{parse_address, parse_hex};

    #[test]
    fn parses_decimal_and_hex_addresses() {
        assert_eq!(parse_address(&json!(4096)).unwrap(), 4096);
        assert_eq!(parse_address(&json!("0x1000")).unwrap(), 4096);
    }

    #[test]
    fn parses_spaced_hex_without_accepting_invalid_input() {
        assert_eq!(parse_hex("48 8B 05").unwrap(), [0x48, 0x8B, 0x05]);
        assert!(parse_hex("abc").is_err());
    }
}
