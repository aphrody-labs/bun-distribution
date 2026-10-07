// SPDX-License-Identifier: Apache-2.0
//! Windows NTFS volume access: MFT enumeration and USN journal checkpoint.
//!
//! Uses the documented `FSCTL_QUERY_USN_JOURNAL`, `FSCTL_CREATE_USN_JOURNAL`
//! and `FSCTL_ENUM_USN_DATA` controls through the `windows` crate. Records are
//! decoded by the platform-independent [`crate::mft`] module.
//!
//! Opening `\\.\C:` for reading requires an elevated (administrator) token.
//! When it is missing, [`open_volume`] fails with `ERROR_ACCESS_DENIED`
//! (`io::ErrorKind::PermissionDenied`); no elevation or UAC bypass is attempted.
//! Only metadata is read, never file contents.

// Confined Win32 FFI: every `unsafe` block carries a SAFETY comment.
#![allow(unsafe_code)]

use std::ffi::c_void;
use std::io;
use std::mem::size_of;

use windows::Win32::Foundation::{CloseHandle, HANDLE};
use windows::Win32::Storage::FileSystem::{
    CreateFileW, FILE_FLAG_BACKUP_SEMANTICS, FILE_SHARE_READ, FILE_SHARE_WRITE, OPEN_EXISTING,
};
use windows::Win32::System::IO::DeviceIoControl;
use windows::Win32::System::Ioctl::{
    CREATE_USN_JOURNAL_DATA, FSCTL_CREATE_USN_JOURNAL, FSCTL_ENUM_USN_DATA,
    FSCTL_QUERY_USN_JOURNAL, MFT_ENUM_DATA_V1, USN_JOURNAL_DATA_V0,
};
use windows::core::PCWSTR;

use crate::mft::{MftTree, UsnEntry, parse_usn_record};

/// `GENERIC_READ` access right.
const GENERIC_READ: u32 = 0x8000_0000;
/// `ERROR_HANDLE_EOF`: end of the MFT enumeration.
const ERROR_HANDLE_EOF: i32 = 38;
/// `ERROR_JOURNAL_NOT_ACTIVE`: the volume has no USN journal yet.
const ERROR_JOURNAL_NOT_ACTIVE: i32 = 1179;
/// `ERROR_JOURNAL_DELETE_IN_PROGRESS`: a journal deletion is pending.
const ERROR_JOURNAL_DELETE_IN_PROGRESS: i32 = 1178;
/// Enumeration output buffer size (8-byte next-FRN prefix + packed records).
const ENUM_BUFFER_LEN: usize = 64 * 1024;
/// Size/allocation delta used when a journal has to be created (32 MiB / 4 MiB).
const JOURNAL_MAX_SIZE: u64 = 32 * 1024 * 1024;
const JOURNAL_ALLOCATION_DELTA: u64 = 4 * 1024 * 1024;

/// Owned volume handle, closed on drop.
#[derive(Debug)]
pub struct Handle(HANDLE);

impl Drop for Handle {
    fn drop(&mut self) {
        // SAFETY: the handle was returned by `CreateFileW` and is closed once.
        // A close failure cannot be acted on in `drop`.
        let _ = unsafe { CloseHandle(self.0) };
    }
}

/// USN journal identity and checkpoint of a volume.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct UsnJournalData {
    /// `UsnJournalID`; changes when the journal is deleted and recreated.
    pub journal_id: u64,
    /// `NextUsn`: the USN the next change will receive (real-time resume point).
    pub next_usn: i64,
}

/// Open `\\.\<drive>:` for reading (requires administrator privileges).
///
/// # Errors
///
/// `InvalidInput` for a non-ASCII-letter drive; otherwise the OS error
/// (`PermissionDenied` without elevation).
pub fn open_volume(drive: char) -> io::Result<Handle> {
    if !drive.is_ascii_alphabetic() {
        return Err(io::Error::new(io::ErrorKind::InvalidInput, "drive must be an ASCII letter"));
    }
    let path: Vec<u16> = format!(r"\\.\{}:", drive.to_ascii_uppercase())
        .encode_utf16()
        .chain(std::iter::once(0))
        .collect();
    // SAFETY: `path` is NUL-terminated and outlives the call; other arguments are plain values.
    let handle = unsafe {
        CreateFileW(
            PCWSTR(path.as_ptr()),
            GENERIC_READ,
            FILE_SHARE_READ | FILE_SHARE_WRITE,
            None,
            OPEN_EXISTING,
            FILE_FLAG_BACKUP_SEMANTICS,
            None,
        )
    }?;
    Ok(Handle(handle))
}

fn query_journal(handle: &Handle) -> io::Result<UsnJournalData> {
    let mut data = USN_JOURNAL_DATA_V0::default();
    let mut returned = 0u32;
    // SAFETY: the output pointer references a live `USN_JOURNAL_DATA_V0` of the stated size.
    unsafe {
        DeviceIoControl(
            handle.0,
            FSCTL_QUERY_USN_JOURNAL,
            None,
            0,
            Some(std::ptr::from_mut(&mut data).cast::<c_void>()),
            u32::try_from(size_of::<USN_JOURNAL_DATA_V0>()).unwrap_or(u32::MAX),
            Some(&mut returned),
            None,
        )
    }?;
    Ok(UsnJournalData { journal_id: data.UsnJournalID, next_usn: data.NextUsn })
}

fn create_journal(handle: &Handle) -> io::Result<()> {
    let input = CREATE_USN_JOURNAL_DATA {
        MaximumSize: JOURNAL_MAX_SIZE,
        AllocationDelta: JOURNAL_ALLOCATION_DELTA,
    };
    let mut returned = 0u32;
    // SAFETY: the input pointer references a live `CREATE_USN_JOURNAL_DATA` of the stated size.
    unsafe {
        DeviceIoControl(
            handle.0,
            FSCTL_CREATE_USN_JOURNAL,
            Some(std::ptr::from_ref(&input).cast::<c_void>()),
            u32::try_from(size_of::<CREATE_USN_JOURNAL_DATA>()).unwrap_or(u32::MAX),
            None,
            0,
            Some(&mut returned),
            None,
        )
    }?;
    Ok(())
}

/// Query the USN journal, creating it when the volume has none.
///
/// # Errors
///
/// The OS error of the failed control code.
pub fn query_or_create_journal(handle: &Handle) -> io::Result<UsnJournalData> {
    match query_journal(handle) {
        Err(e)
            if matches!(
                e.raw_os_error(),
                Some(ERROR_JOURNAL_NOT_ACTIVE | ERROR_JOURNAL_DELETE_IN_PROGRESS)
            ) =>
        {
            create_journal(handle)?;
            query_journal(handle)
        },
        other => other,
    }
}

/// Enumerate every MFT record (V2 and V3) of the volume, hidden and system
/// files included, calling `callback` once per entry.
///
/// # Errors
///
/// The OS error of `FSCTL_ENUM_USN_DATA`, or `InvalidData` when a returned
/// record cannot be decoded. `ERROR_HANDLE_EOF` ends the loop normally.
pub fn enumerate_mft(handle: &Handle, mut callback: impl FnMut(UsnEntry)) -> io::Result<()> {
    let mut buf = vec![0u8; ENUM_BUFFER_LEN];
    let mut input = MFT_ENUM_DATA_V1 {
        StartFileReferenceNumber: 0,
        LowUsn: 0,
        HighUsn: i64::MAX,
        MinMajorVersion: 2,
        MaxMajorVersion: 3,
    };
    loop {
        let mut returned = 0u32;
        // SAFETY: input/output pointers reference live buffers of the stated sizes.
        let res = unsafe {
            DeviceIoControl(
                handle.0,
                FSCTL_ENUM_USN_DATA,
                Some(std::ptr::from_ref(&input).cast::<c_void>()),
                u32::try_from(size_of::<MFT_ENUM_DATA_V1>()).unwrap_or(u32::MAX),
                Some(buf.as_mut_ptr().cast::<c_void>()),
                u32::try_from(buf.len()).unwrap_or(u32::MAX),
                Some(&mut returned),
                None,
            )
        };
        if let Err(e) = res {
            let e = io::Error::from(e);
            if e.raw_os_error() == Some(ERROR_HANDLE_EOF) {
                return Ok(());
            }
            return Err(e);
        }
        let returned = usize::try_from(returned).unwrap_or(0).min(buf.len());
        let Some(next) = buf.get(..8).filter(|_| returned >= 8) else {
            return Ok(());
        };
        input.StartFileReferenceNumber =
            u64::from_le_bytes(next.try_into().map_err(|_| {
                io::Error::new(io::ErrorKind::InvalidData, "short enumeration prefix")
            })?);
        let mut rest = &buf[8..returned];
        while !rest.is_empty() {
            let (entry, used) = parse_usn_record(rest).ok_or_else(|| {
                io::Error::new(io::ErrorKind::InvalidData, "undecodable USN record")
            })?;
            callback(entry);
            // `used` is the record length (>= header), so the slice always shrinks.
            rest = rest.get(used..).unwrap_or(&[]);
        }
    }
}

/// Scan a whole NTFS volume into an [`MftTree`] and return the USN checkpoint
/// `(tree, next_usn, journal_id)` for later real-time tracking.
///
/// The journal is queried before enumeration so changes made during the scan
/// are replayed rather than lost. Requires administrator privileges.
///
/// # Errors
///
/// Any error of [`open_volume`], [`query_or_create_journal`] or [`enumerate_mft`].
pub fn scan_volume_tree(drive: char) -> io::Result<(MftTree, u128, u64)> {
    let handle = open_volume(drive)?;
    let journal = query_or_create_journal(&handle)?;
    let mut tree = MftTree::new();
    enumerate_mft(&handle, |entry| tree.insert(entry))?;
    let next_usn = u128::from(u64::try_from(journal.next_usn).unwrap_or(0));
    Ok((tree, next_usn, journal.journal_id))
}
