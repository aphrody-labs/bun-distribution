// SPDX-License-Identifier: Apache-2.0
//! WireGuardNT driver library (`wireguard.dll`) for Windows.
//!
//! Its prebuilt-binaries licence forbids redistribution outside software that uses it through
//! `wireguard.h`, and Aphrody is such software, but the DLL is still fetched on the host from
//! download.wireguard.com and pinned by SHA-256 rather than committed or bundled.

use std::io::Read as _;
use std::path::PathBuf;

use serde::Serialize;
use sha2::{Digest, Sha256};

use crate::{Error, Result};

/// Pinned WireGuardNT release.
pub const NT_VERSION: &str = "1.1";
/// Official archive URL.
pub const NT_URL: &str = "https://download.wireguard.com/wireguard-nt/wireguard-nt-1.1.zip";
/// SHA-256 of the archive above, verified on 2026-10-08.
pub const NT_SHA256: &str = "dceb30a9bc4be48cce0f74160fc88a585a2c2627366e8f846fc6658f9038dace";

/// `amd64`, `arm64` or `x86`, as named inside the archive.
#[must_use]
pub fn arch() -> &'static str {
    if cfg!(target_arch = "aarch64") {
        "arm64"
    } else if cfg!(target_arch = "x86") {
        "x86"
    } else {
        "amd64"
    }
}

/// Aphrody home (`APHRODY_HOME`, else `~/.aphrody`).
#[must_use]
pub fn aphrody_home() -> PathBuf {
    if let Some(h) = std::env::var_os("APHRODY_HOME") {
        return PathBuf::from(h);
    }
    let home =
        std::env::var_os("USERPROFILE").or_else(|| std::env::var_os("HOME")).unwrap_or_default();
    PathBuf::from(home).join(".aphrody")
}

/// Directory holding the driver library and tunnel state.
#[must_use]
pub fn state_dir() -> PathBuf {
    aphrody_home().join("wireguard")
}

/// Where the DLL is looked up: next to the executable first, then the state directory.
#[must_use]
pub fn dll_candidates() -> Vec<PathBuf> {
    let name = format!("wireguard-{}.dll", arch());
    let mut v = Vec::new();
    if let Some(dir) = std::env::current_exe().ok().and_then(|p| p.parent().map(PathBuf::from)) {
        v.push(dir.join(&name));
        v.push(dir.join("wireguard.dll"));
    }
    v.push(state_dir().join(name));
    v
}

/// First existing DLL.
#[must_use]
pub fn dll_path() -> Option<PathBuf> {
    dll_candidates().into_iter().find(|p| p.is_file())
}

#[derive(Debug, Serialize)]
pub struct DriverStatus {
    pub version: &'static str,
    pub arch: &'static str,
    pub dll: Option<PathBuf>,
    pub searched: Vec<PathBuf>,
}

#[must_use]
pub fn status() -> DriverStatus {
    DriverStatus { version: NT_VERSION, arch: arch(), dll: dll_path(), searched: dll_candidates() }
}

/// Download, verify and extract the DLL (plus its licence) into [`state_dir`].
pub fn install() -> Result<PathBuf> {
    let bytes = reqwest::blocking::get(NT_URL)
        .and_then(reqwest::blocking::Response::error_for_status)
        .and_then(|r| r.bytes())
        .map_err(|e| Error::Driver(format!("téléchargement {NT_URL}: {e}")))?;
    install_from_archive(&bytes)
}

/// Verify and extract an already downloaded archive.
pub fn install_from_archive(bytes: &[u8]) -> Result<PathBuf> {
    let digest: String = Sha256::digest(bytes).iter().map(|b| format!("{b:02x}")).collect();
    if digest != NT_SHA256 {
        return Err(Error::Driver(format!("sha256 {digest} ≠ attendu {NT_SHA256}")));
    }
    let mut zip = zip::ZipArchive::new(std::io::Cursor::new(bytes))
        .map_err(|e| Error::Driver(format!("archive: {e}")))?;
    let dir = state_dir();
    std::fs::create_dir_all(&dir).map_err(|e| Error::Driver(format!("{}: {e}", dir.display())))?;
    let target = dir.join(format!("wireguard-{}.dll", arch()));
    for (entry, out) in [
        (format!("wireguard-nt/bin/{}/wireguard.dll", arch()), target.clone()),
        ("wireguard-nt/LICENSE.txt".to_owned(), dir.join("wireguard-nt-LICENSE.txt")),
    ] {
        let mut f = zip.by_name(&entry).map_err(|e| Error::Driver(format!("{entry}: {e}")))?;
        let mut buf = Vec::new();
        f.read_to_end(&mut buf).map_err(|e| Error::Driver(format!("{entry}: {e}")))?;
        std::fs::write(&out, buf).map_err(|e| Error::Driver(format!("{}: {e}", out.display())))?;
    }
    Ok(target)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_unpinned_archive() {
        assert!(install_from_archive(b"not a zip").is_err());
        assert!(status().searched.iter().any(|p| p.ends_with(format!("wireguard-{}.dll", arch()))));
    }
}
