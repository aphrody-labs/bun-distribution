// SPDX-License-Identifier: Apache-2.0
//! Thin, safe wrappers over the Win32 Registry API (`RegOpenKeyExW`, `RegQueryValueExW`,
//! `RegSetValueExW`, `RegDeleteValueW`, `RegDeleteTreeW`, `RegEnumKeyExW`, `RegEnumValueW`).
//! Values travel as raw `(type, bytes)` pairs; decoding and encoding live in
//! [`crate::registry`], which is platform independent and unit-tested everywhere.

use std::io;

use windows::Win32::{
    Foundation::{ERROR_MORE_DATA, ERROR_NO_MORE_ITEMS, ERROR_SUCCESS, WIN32_ERROR},
    System::Registry::{
        HKEY, HKEY_CLASSES_ROOT, HKEY_CURRENT_CONFIG, HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE,
        HKEY_USERS, KEY_READ, KEY_SET_VALUE, KEY_WRITE, REG_OPTION_NON_VOLATILE, REG_SAM_FLAGS,
        REG_VALUE_TYPE, RegCloseKey, RegCreateKeyExW, RegDeleteTreeW, RegDeleteValueW,
        RegEnumKeyExW, RegEnumValueW, RegOpenKeyExW, RegQueryInfoKeyW, RegQueryValueExW,
        RegSetValueExW,
    },
};

use crate::{
    registry::Hive,
    win32::{from_wide, pcwstr, wide, win32_error},
};

fn root(hive: Hive) -> HKEY {
    match hive {
        Hive::CurrentUser => HKEY_CURRENT_USER,
        Hive::LocalMachine => HKEY_LOCAL_MACHINE,
        Hive::ClassesRoot => HKEY_CLASSES_ROOT,
        Hive::Users => HKEY_USERS,
        Hive::CurrentConfig => HKEY_CURRENT_CONFIG,
    }
}

fn check(status: WIN32_ERROR, context: impl FnOnce() -> String) -> io::Result<()> {
    if status == ERROR_SUCCESS { Ok(()) } else { Err(win32_error(status, &context())) }
}

/// An open registry key, closed on drop.
pub(crate) struct Key(HKEY);

impl Drop for Key {
    fn drop(&mut self) {
        // SAFETY: the handle was returned by RegOpenKeyExW/RegCreateKeyExW and is closed once.
        let _ = unsafe { RegCloseKey(self.0) };
    }
}

/// A raw registry value: its name, `REG_*` type and data bytes.
pub(crate) struct RawValue {
    pub(crate) name: String,
    pub(crate) kind: u32,
    pub(crate) data: Vec<u8>,
}

/// Open `hive\subkey` for reading.
pub(crate) fn open_read(hive: Hive, subkey: &str) -> io::Result<Key> {
    open(hive, subkey, KEY_READ)
}

/// Open `hive\subkey` for writing values (the key must exist).
pub(crate) fn open_write(hive: Hive, subkey: &str) -> io::Result<Key> {
    open(hive, subkey, KEY_SET_VALUE)
}

fn open(hive: Hive, subkey: &str, access: REG_SAM_FLAGS) -> io::Result<Key> {
    let name = wide(subkey);
    let mut handle = HKEY::default();
    // SAFETY: `name` is NUL-terminated and `handle` receives the opened key.
    let status = unsafe { RegOpenKeyExW(root(hive), pcwstr(&name), None, access, &mut handle) };
    check(status, || format!("open registry key {}\\{subkey}", hive.long_name()))?;
    Ok(Key(handle))
}

/// Open `hive\subkey` for writing, creating the key (and missing parents) when needed.
pub(crate) fn create(hive: Hive, subkey: &str) -> io::Result<Key> {
    let name = wide(subkey);
    let mut handle = HKEY::default();
    // SAFETY: `name` is NUL-terminated and `handle` receives the created or opened key.
    let status = unsafe {
        RegCreateKeyExW(
            root(hive),
            pcwstr(&name),
            None,
            None,
            REG_OPTION_NON_VOLATILE,
            KEY_WRITE,
            None,
            &mut handle,
            None,
        )
    };
    check(status, || format!("create registry key {}\\{subkey}", hive.long_name()))?;
    Ok(Key(handle))
}

/// Whether `hive\subkey` exists and can be opened for reading.
pub(crate) fn key_exists(hive: Hive, subkey: &str) -> bool {
    open_read(hive, subkey).is_ok()
}

/// Read one value (`""` is the default value).
pub(crate) fn query_value(key: &Key, name: &str) -> io::Result<RawValue> {
    let wide_name = wide(name);
    let mut buffer = vec![0u8; 256];
    loop {
        let mut kind = REG_VALUE_TYPE::default();
        let mut size = u32::try_from(buffer.len()).unwrap_or(u32::MAX);
        // SAFETY: `buffer` holds `size` writable bytes; the API updates `size`.
        let status = unsafe {
            RegQueryValueExW(
                key.0,
                pcwstr(&wide_name),
                None,
                Some(&mut kind),
                Some(buffer.as_mut_ptr()),
                Some(&mut size),
            )
        };
        if status == ERROR_MORE_DATA {
            buffer.resize((size as usize).max(buffer.len() * 2), 0);
            continue;
        }
        check(status, || format!("read registry value '{name}'"))?;
        buffer.truncate(size as usize);
        return Ok(RawValue { name: name.to_owned(), kind: kind.0, data: buffer });
    }
}

/// Maximum sub-key name length and value name / data sizes, used to size enumeration buffers.
fn key_info(key: &Key) -> io::Result<(u32, u32, u32)> {
    let mut max_subkey = 0u32;
    let mut max_value_name = 0u32;
    let mut max_value_data = 0u32;
    // SAFETY: only the requested out-pointers are written.
    let status = unsafe {
        RegQueryInfoKeyW(
            key.0,
            None,
            None,
            None,
            None,
            Some(&mut max_subkey),
            None,
            None,
            Some(&mut max_value_name),
            Some(&mut max_value_data),
            None,
            None,
        )
    };
    check(status, || "query registry key information".to_owned())?;
    Ok((max_subkey, max_value_name, max_value_data))
}

/// Names of the direct sub-keys.
pub(crate) fn subkeys(key: &Key) -> io::Result<Vec<String>> {
    let (max_subkey, _, _) = key_info(key)?;
    let mut name = vec![0u16; max_subkey as usize + 1];
    let mut names = Vec::new();
    for index in 0.. {
        let mut length = u32::try_from(name.len()).unwrap_or(u32::MAX);
        // SAFETY: `name` holds `length` UTF-16 units; the API writes the name and its length.
        let status = unsafe {
            RegEnumKeyExW(
                key.0,
                index,
                Some(windows::core::PWSTR(name.as_mut_ptr())),
                &mut length,
                None,
                None,
                None,
                None,
            )
        };
        if status == ERROR_NO_MORE_ITEMS {
            break;
        }
        if status == ERROR_MORE_DATA {
            // A longer sub-key was created during the enumeration: grow and retry this index.
            name.resize(name.len() * 2, 0);
            continue;
        }
        check(status, || "enumerate registry sub-keys".to_owned())?;
        names.push(from_wide(&name[..length as usize]));
    }
    Ok(names)
}

/// Every value of the key, in enumeration order.
pub(crate) fn values(key: &Key) -> io::Result<Vec<RawValue>> {
    let (_, max_name, max_data) = key_info(key)?;
    let mut name = vec![0u16; max_name as usize + 1];
    let mut data = vec![0u8; max_data as usize];
    let mut values = Vec::new();
    let mut index = 0u32;
    loop {
        let mut name_length = u32::try_from(name.len()).unwrap_or(u32::MAX);
        let mut data_length = u32::try_from(data.len()).unwrap_or(u32::MAX);
        let mut kind = 0u32;
        // SAFETY: both buffers hold the advertised capacities; the API writes within them.
        let status = unsafe {
            RegEnumValueW(
                key.0,
                index,
                Some(windows::core::PWSTR(name.as_mut_ptr())),
                &mut name_length,
                None,
                Some(&mut kind),
                Some(data.as_mut_ptr()),
                Some(&mut data_length),
            )
        };
        if status == ERROR_NO_MORE_ITEMS {
            break;
        }
        if status == ERROR_MORE_DATA {
            // Grown concurrently: enlarge both buffers and retry the same index.
            name.resize(name.len() * 2, 0);
            data.resize((data_length as usize).max(data.len() * 2).max(64), 0);
            continue;
        }
        check(status, || "enumerate registry values".to_owned())?;
        values.push(RawValue {
            name: from_wide(&name[..name_length as usize]),
            kind,
            data: data[..data_length as usize].to_vec(),
        });
        index += 1;
    }
    Ok(values)
}

/// Write one value (`""` is the default value).
pub(crate) fn set_value(key: &Key, name: &str, kind: u32, data: &[u8]) -> io::Result<()> {
    let wide_name = wide(name);
    // SAFETY: `wide_name` is NUL-terminated and `data` is a valid byte slice.
    let status = unsafe {
        RegSetValueExW(key.0, pcwstr(&wide_name), None, REG_VALUE_TYPE(kind), Some(data))
    };
    check(status, || format!("write registry value '{name}'"))
}

/// Delete one value (`""` is the default value).
pub(crate) fn delete_value(key: &Key, name: &str) -> io::Result<()> {
    let wide_name = wide(name);
    // SAFETY: `wide_name` is NUL-terminated.
    let status = unsafe { RegDeleteValueW(key.0, pcwstr(&wide_name)) };
    check(status, || format!("delete registry value '{name}'"))
}

/// Delete `hive\subkey` with all of its sub-keys and values. `subkey` must not be empty.
pub(crate) fn delete_tree(hive: Hive, subkey: &str) -> io::Result<()> {
    if subkey.is_empty() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "refusing to delete a registry hive root",
        ));
    }
    let name = wide(subkey);
    // SAFETY: `name` is NUL-terminated and names a sub-key of a predefined root.
    let status = unsafe { RegDeleteTreeW(root(hive), pcwstr(&name)) };
    check(status, || format!("delete registry key {}\\{subkey}", hive.long_name()))
}
