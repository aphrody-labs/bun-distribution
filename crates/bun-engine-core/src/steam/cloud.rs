//! Steam Cloud saves through `ISteamRemoteStorage`. Every emulator save (battery RAM `.sav`,
//! save states `.state*`, memory cards) lives in a per-ROM directory keyed by the ROM's SHA-256;
//! the cloud mirrors it under `bun-engine/<rom-sha256>/<file>` with one JSON manifest
//! (`bun-engine/manifest.json`) recording each file's hash, size and modification time.
//!
//! Sync rule: identical hashes do nothing; otherwise the newer modification time wins (local mtime
//! against the manifest's recorded mtime). Writes check the cloud quota first.

use std::{
    collections::{BTreeMap, BTreeSet},
    ffi::CString,
    path::{Path, PathBuf},
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};
use steamworks::sys;

use super::sha256_hex;

pub const MANIFEST: &str = "bun-engine/manifest.json";
/// Headroom kept free in the quota (manifest growth, concurrent writes).
const QUOTA_MARGIN: u64 = 64 * 1024;
/// Steam Cloud rejects single files above 100 MiB.
const MAX_FILE: u64 = 100 * 1024 * 1024;

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct FileEntry {
    pub sha256: String,
    pub size: u64,
    /// Modification time of the uploaded file, Unix seconds.
    pub modified: i64,
    /// Upload time, Unix seconds.
    pub uploaded: i64,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct RomEntry {
    pub title: String,
    pub system: String,
    pub files: BTreeMap<String, FileEntry>,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct Manifest {
    pub version: u32,
    pub roms: BTreeMap<String, RomEntry>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Direction {
    /// Newer side wins per file.
    Sync,
    /// Upload every differing local file.
    Push,
    /// Download every differing cloud file.
    Pull,
}

#[derive(Debug, Default, Serialize)]
pub struct SyncReport {
    pub rom: String,
    pub dir: PathBuf,
    pub uploaded: Vec<String>,
    pub downloaded: Vec<String>,
    pub unchanged: Vec<String>,
    pub skipped: Vec<String>,
}

fn rs() -> *mut sys::ISteamRemoteStorage {
    // SAFETY: valid once the Steam API is initialized; callers hold a `Steam`.
    unsafe { sys::SteamAPI_SteamRemoteStorage_v016() }
}

fn cname(name: &str) -> Result<CString, String> {
    CString::new(name).map_err(|_| format!("invalid cloud file name {name:?}"))
}

fn now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_secs() as i64)
}

fn mtime(path: &Path) -> i64 {
    std::fs::metadata(path)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map_or(0, |d| d.as_secs() as i64)
}

/// `(total, available)` bytes of the app's Steam Cloud quota.
pub fn quota() -> (u64, u64) {
    let (mut total, mut available) = (0u64, 0u64);
    // SAFETY: out pointers are valid for the call.
    unsafe { sys::SteamAPI_ISteamRemoteStorage_GetQuota(rs(), &mut total, &mut available) };
    (total, available)
}

pub fn exists(name: &str) -> bool {
    cname(name)
        .is_ok_and(|n| unsafe { sys::SteamAPI_ISteamRemoteStorage_FileExists(rs(), n.as_ptr()) })
}

/// Cloud timestamp of `name` (Unix seconds), 0 when absent.
pub fn timestamp(name: &str) -> i64 {
    cname(name).map_or(0, |n| unsafe {
        sys::SteamAPI_ISteamRemoteStorage_GetFileTimestamp(rs(), n.as_ptr())
    })
}

/// Reads a whole cloud file.
pub fn read(name: &str) -> Result<Vec<u8>, String> {
    let n = cname(name)?;
    // SAFETY: `n` is NUL-terminated; the buffer holds `size` bytes.
    unsafe {
        if !sys::SteamAPI_ISteamRemoteStorage_FileExists(rs(), n.as_ptr()) {
            return Err(format!("{name}: not in Steam Cloud"));
        }
        let size = sys::SteamAPI_ISteamRemoteStorage_GetFileSize(rs(), n.as_ptr()).max(0) as usize;
        let mut data = vec![0u8; size];
        let read = sys::SteamAPI_ISteamRemoteStorage_FileRead(
            rs(),
            n.as_ptr(),
            data.as_mut_ptr().cast(),
            size as i32,
        );
        if read as usize != size {
            return Err(format!("{name}: read {read} of {size} bytes"));
        }
        Ok(data)
    }
}

/// Writes a whole cloud file after checking the per-file limit and the remaining quota.
pub fn write(name: &str, data: &[u8]) -> Result<(), String> {
    let n = cname(name)?;
    let size = data.len() as u64;
    if size > MAX_FILE {
        return Err(format!(
            "{name}: {size} bytes exceeds the 100 MiB Steam Cloud file limit"
        ));
    }
    let (total, available) = quota();
    // SAFETY: `n` is NUL-terminated.
    let replaced = if exists(name) {
        unsafe { sys::SteamAPI_ISteamRemoteStorage_GetFileSize(rs(), n.as_ptr()).max(0) as u64 }
    } else {
        0
    };
    // AppID 480 (Spacewar) has a 4 KiB quota: scale the headroom down with it.
    if size + QUOTA_MARGIN.min(total / 8) > available + replaced {
        return Err(format!(
            "{name}: {size} bytes does not fit the Steam Cloud quota ({available} of {total} bytes free)"
        ));
    }
    // SAFETY: `data` is valid for `size` bytes.
    let ok = unsafe {
        sys::SteamAPI_ISteamRemoteStorage_FileWrite(
            rs(),
            n.as_ptr(),
            data.as_ptr().cast(),
            size as i32,
        )
    };
    if ok {
        Ok(())
    } else {
        Err(format!("{name}: ISteamRemoteStorage::FileWrite failed"))
    }
}

pub fn delete(name: &str) -> bool {
    cname(name)
        .is_ok_and(|n| unsafe { sys::SteamAPI_ISteamRemoteStorage_FileDelete(rs(), n.as_ptr()) })
}

/// Every cloud file of the app: `(name, size)`.
pub fn list() -> Vec<(String, u64)> {
    let mut files = Vec::new();
    // SAFETY: index-based enumeration of the app's cloud files.
    unsafe {
        let count = sys::SteamAPI_ISteamRemoteStorage_GetFileCount(rs());
        for index in 0..count.max(0) {
            let mut size = 0i32;
            let name = sys::SteamAPI_ISteamRemoteStorage_GetFileNameAndSize(rs(), index, &mut size);
            files.push((super::sdk_string(name), size.max(0) as u64));
        }
    }
    files
}

pub fn load_manifest() -> Result<Manifest, String> {
    if !exists(MANIFEST) {
        return Ok(Manifest {
            version: 1,
            ..Manifest::default()
        });
    }
    serde_json::from_slice(&read(MANIFEST)?).map_err(|e| format!("{MANIFEST}: {e}"))
}

pub fn store_manifest(manifest: &Manifest) -> Result<(), String> {
    write(
        MANIFEST,
        &serde_json::to_vec_pretty(manifest).map_err(|e| e.to_string())?,
    )
}

/// Local save directory of a ROM: `BUN_ENGINE_SAVES/<sha256>`, else the per-user Aphrody data
/// directory (`%LOCALAPPDATA%\Aphrody\bun-engine\saves`, `$XDG_DATA_HOME/aphrody/bun-engine/saves`).
pub fn save_dir(rom_sha256: &str) -> PathBuf {
    let base = std::env::var_os("BUN_ENGINE_SAVES")
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            let data = if cfg!(windows) {
                std::env::var_os("LOCALAPPDATA").map(|p| PathBuf::from(p).join("Aphrody"))
            } else {
                std::env::var_os("XDG_DATA_HOME")
                    .map(|p| PathBuf::from(p).join("aphrody"))
                    .or_else(|| {
                        std::env::var_os("HOME")
                            .map(|h| PathBuf::from(h).join(".local/share/aphrody"))
                    })
            };
            data.unwrap_or_else(|| PathBuf::from("."))
                .join("bun-engine")
                .join("saves")
        });
    base.join(rom_sha256)
}

fn remote_name(rom: &str, file: &str) -> String {
    format!("bun-engine/{rom}/{file}")
}

fn local_files(dir: &Path) -> BTreeSet<String> {
    std::fs::read_dir(dir)
        .into_iter()
        .flatten()
        .flatten()
        .filter(|e| e.file_type().is_ok_and(|t| t.is_file()))
        .filter_map(|e| e.file_name().into_string().ok())
        .filter(|name| !name.starts_with('.') && !name.ends_with(".tmp"))
        .collect()
}

/// Writes `data` to `path` atomically and stamps its modification time.
fn write_local(path: &Path, data: &[u8], modified: i64) -> Result<(), String> {
    let tmp = path.with_extension(format!(
        "{}.tmp",
        path.extension().and_then(|e| e.to_str()).unwrap_or("save")
    ));
    std::fs::write(&tmp, data).map_err(|e| format!("{}: {e}", tmp.display()))?;
    if modified > 0
        && let Ok(file) = std::fs::File::options().write(true).open(&tmp)
    {
        let _ = file.set_modified(UNIX_EPOCH + Duration::from_secs(modified as u64));
    }
    std::fs::rename(&tmp, path).map_err(|e| format!("{}: {e}", path.display()))
}

/// Synchronizes one ROM's save directory with Steam Cloud.
pub fn sync(
    rom_sha256: &str,
    title: &str,
    system: &str,
    dir: &Path,
    direction: Direction,
) -> Result<SyncReport, String> {
    std::fs::create_dir_all(dir).map_err(|e| format!("{}: {e}", dir.display()))?;
    let mut manifest = load_manifest()?;
    manifest.version = 1;
    let entry = manifest.roms.entry(rom_sha256.to_string()).or_default();
    entry.title = title.to_string();
    entry.system = system.to_string();
    let mut report = SyncReport {
        rom: rom_sha256.to_string(),
        dir: dir.to_path_buf(),
        ..SyncReport::default()
    };
    let names: BTreeSet<String> = local_files(dir)
        .into_iter()
        .chain(entry.files.keys().cloned())
        .collect();
    let mut dirty = false;
    for name in names {
        let path = dir.join(&name);
        let remote = remote_name(rom_sha256, &name);
        let local = std::fs::read(&path).ok();
        let cloud = entry.files.get(&name).cloned().filter(|_| exists(&remote));
        let local_hash = local.as_deref().map(sha256_hex);
        let push = match (&local, &cloud) {
            (Some(_), None) => direction != Direction::Pull,
            (None, Some(_)) => false,
            (Some(_), Some(c)) if local_hash.as_deref() == Some(c.sha256.as_str()) => {
                report.unchanged.push(name);
                continue;
            }
            (Some(_), Some(c)) => match direction {
                Direction::Push => true,
                Direction::Pull => false,
                Direction::Sync => mtime(&path) >= c.modified,
            },
            (None, None) => {
                entry.files.remove(&name);
                dirty = true;
                continue;
            }
        };
        if push {
            let data = local.unwrap_or_default();
            write(&remote, &data)?;
            let back = read(&remote)?;
            if sha256_hex(&back) != local_hash.clone().unwrap_or_default() {
                return Err(format!("{remote}: read-back hash mismatch"));
            }
            entry.files.insert(
                name.clone(),
                FileEntry {
                    sha256: sha256_hex(&data),
                    size: data.len() as u64,
                    modified: mtime(&path),
                    uploaded: now(),
                },
            );
            dirty = true;
            report.uploaded.push(name);
        } else if let Some(c) = cloud {
            if direction == Direction::Push {
                report.skipped.push(name);
                continue;
            }
            let data = read(&remote)?;
            if sha256_hex(&data) != c.sha256 {
                return Err(format!(
                    "{remote}: cloud data does not match the manifest hash"
                ));
            }
            write_local(&path, &data, c.modified)?;
            report.downloaded.push(name);
        } else {
            report.skipped.push(name);
        }
    }
    if dirty {
        store_manifest(&manifest)?;
    }
    Ok(report)
}

/// Writes `size` deterministic bytes to `bun-engine/roundtrip.bin`, reads them back, compares the
/// SHA-256 and deletes the file. Returns `(written hash, read hash)`.
pub fn roundtrip(size: usize) -> Result<(String, String), String> {
    let mut state = now() as u64 | 1;
    let data: Vec<u8> = (0..size)
        .map(|_| {
            state ^= state << 13;
            state ^= state >> 7;
            state ^= state << 17;
            state as u8
        })
        .collect();
    let name = "bun-engine/roundtrip.bin";
    write(name, &data)?;
    let back = read(name)?;
    let hashes = (sha256_hex(&data), sha256_hex(&back));
    delete(name);
    Ok(hashes)
}
