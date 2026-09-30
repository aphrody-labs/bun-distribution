//! Model installation: download, sha256 verification and atomic placement.
//!
//! Files are streamed into a unique temporary file next to their destination, hashed
//! on the fly, checked against the manifest, flushed to disk and then renamed into
//! place. A file present at its final path has therefore always been verified (or was
//! placed there manually, which [`verify_model`] can re-check).

use std::{
    fs::{self, File},
    io::{BufWriter, Read, Write},
    path::{Path, PathBuf},
    sync::Mutex,
    time::Duration,
};

use sha2::{Digest, Sha256};

use super::{
    error::{Error, Result},
    manifest::{FileSpec, ModelFiles},
};

const DOWNLOAD_ATTEMPTS: usize = 3;
const COPY_BUFFER: usize = 1 << 20;

/// `true` when `APHRODY_OFFLINE` is set to a truthy value (`1`, `true`, `yes`).
pub fn is_offline() -> bool {
    std::env::var("APHRODY_OFFLINE")
        .map(|v| matches!(v.trim().to_ascii_lowercase().as_str(), "1" | "true" | "yes"))
        .unwrap_or(false)
}

/// Make sure every file of `spec` exists in `dir`, downloading missing ones.
///
/// Existing files are accepted when their size matches the manifest (downloads are
/// only renamed into place after a successful sha256 check). Returns `dir`.
/// Honours `APHRODY_OFFLINE=1` by failing instead of downloading.
pub fn ensure_model<S: ModelFiles + ?Sized>(spec: &S, dir: &Path) -> Result<PathBuf> {
    // Serialise installs inside the process so concurrent callers (e.g. parallel tests or
    // FFI threads) wait for one download instead of each fetching the same files.
    static INSTALL_LOCK: Mutex<()> = Mutex::new(());
    let missing = |file: &FileSpec| file_size(&dir.join(&file.name)) != Some(file.size);
    if !spec.files().iter().any(missing) {
        return Ok(dir.to_path_buf());
    }
    let _guard = INSTALL_LOCK.lock().unwrap_or_else(|p| p.into_inner());
    for file in spec.files().iter().filter(|f| missing(f)) {
        let dest = dir.join(&file.name);
        if is_offline() {
            return Err(Error::Offline(dest));
        }
        fs::create_dir_all(dir).map_err(|e| Error::io(dir, e))?;
        download_with_retries(file, &dest)?;
    }
    Ok(dir.to_path_buf())
}

/// `true` when every file of `spec` is present in `dir` with the manifest size.
/// Never touches the network.
pub fn is_installed<S: ModelFiles + ?Sized>(spec: &S, dir: &Path) -> bool {
    spec.files().iter().all(|f| file_size(&dir.join(&f.name)) == Some(f.size))
}

/// Return `dir` if `spec` is installed there, else [`Error::NotInstalled`]. No network I/O;
/// use this on load paths and keep [`ensure_model`] for explicit installation.
pub fn require_installed<S: ModelFiles + ?Sized>(spec: &S, dir: &Path) -> Result<PathBuf> {
    if is_installed(spec, dir) {
        Ok(dir.to_path_buf())
    } else {
        Err(Error::NotInstalled { model: spec.versioned_id(), dir: dir.to_path_buf() })
    }
}

/// Hash every file of `spec` in `dir` and compare with the manifest.
pub fn verify_model<S: ModelFiles + ?Sized>(spec: &S, dir: &Path) -> Result<()> {
    for file in spec.files() {
        let path = dir.join(&file.name);
        let mut reader = File::open(&path).map_err(|e| Error::io(&path, e))?;
        let mut hasher = Sha256::new();
        let mut buf = vec![0u8; COPY_BUFFER];
        let mut size = 0u64;
        loop {
            let n = reader.read(&mut buf).map_err(|e| Error::io(&path, e))?;
            if n == 0 {
                break;
            }
            hasher.update(&buf[..n]);
            size += n as u64;
        }
        check_integrity(file, &hex(&hasher.finalize()), size)?;
    }
    Ok(())
}

fn file_size(path: &Path) -> Option<u64> {
    fs::metadata(path).ok().filter(|m| m.is_file()).map(|m| m.len())
}

fn download_with_retries(file: &FileSpec, dest: &Path) -> Result<()> {
    let mut last_err = None;
    for attempt in 1..=DOWNLOAD_ATTEMPTS {
        match download_once(file, dest) {
            Ok(()) => return Ok(()),
            // A hash mismatch will not fix itself by retrying.
            Err(err @ Error::Integrity { .. }) => return Err(err),
            Err(err) => {
                last_err = Some(err);
                if attempt < DOWNLOAD_ATTEMPTS {
                    std::thread::sleep(Duration::from_millis(500 * attempt as u64));
                }
            },
        }
    }
    Err(last_err.expect("at least one attempt"))
}

fn download_once(file: &FileSpec, dest: &Path) -> Result<()> {
    let dir = dest.parent().unwrap_or_else(|| Path::new("."));
    static COUNTER: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    let unique = COUNTER.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let tmp = dir.join(format!(".{}.{}-{}.partial", file.name, std::process::id(), unique));
    let result =
        stream_to(file, &tmp).and_then(|()| fs::rename(&tmp, dest).map_err(|e| Error::io(dest, e)));
    if result.is_err() {
        let _ = fs::remove_file(&tmp);
    }
    result
}

fn stream_to(file: &FileSpec, tmp: &Path) -> Result<()> {
    let download_err = |message: String| Error::Download { url: file.url.clone(), message };
    let agent: ureq::Agent = ureq::Agent::config_builder()
        .timeout_connect(Some(Duration::from_secs(30)))
        .timeout_recv_response(Some(Duration::from_secs(60)))
        .user_agent(concat!("aphrody-embed/", env!("CARGO_PKG_VERSION")))
        .build()
        .into();
    let response = agent.get(&file.url).call().map_err(|e| download_err(e.to_string()))?;
    let mut reader = response.into_body().into_reader();

    let out = File::create(tmp).map_err(|e| Error::io(tmp, e))?;
    let mut writer = BufWriter::with_capacity(COPY_BUFFER, out);
    let mut hasher = Sha256::new();
    let mut buf = vec![0u8; COPY_BUFFER];
    let mut size = 0u64;
    loop {
        let n = reader.read(&mut buf).map_err(|e| download_err(e.to_string()))?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
        writer.write_all(&buf[..n]).map_err(|e| Error::io(tmp, e))?;
        size += n as u64;
        if size > file.size {
            break; // Oversized: fail the integrity check without reading further.
        }
    }
    let out = writer.into_inner().map_err(|e| Error::io(tmp, e.into_error()))?;
    check_integrity(file, &hex(&hasher.finalize()), size)?;
    out.sync_all().map_err(|e| Error::io(tmp, e))?;
    Ok(())
}

fn check_integrity(file: &FileSpec, actual: &str, actual_size: u64) -> Result<()> {
    if actual_size == file.size && actual.eq_ignore_ascii_case(&file.sha256) {
        return Ok(());
    }
    Err(Error::Integrity {
        name: file.name.clone(),
        expected: file.sha256.clone(),
        actual: actual.to_string(),
        expected_size: file.size,
        actual_size,
    })
}

fn hex(bytes: &[u8]) -> String {
    use std::fmt::Write as _;
    bytes.iter().fold(String::with_capacity(64), |mut s, b| {
        let _ = write!(s, "{b:02x}");
        s
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hex_encoding_matches_known_digest() {
        let digest = Sha256::digest(b"abc");
        assert_eq!(
            hex(&digest),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
    }

    #[test]
    fn integrity_check_rejects_size_and_hash_mismatch() {
        let file = FileSpec {
            name: "x".into(),
            url: "https://example.invalid/x".into(),
            sha256: "ab".repeat(32),
            size: 3,
        };
        assert!(check_integrity(&file, &"ab".repeat(32), 3).is_ok());
        assert!(check_integrity(&file, &"AB".repeat(32), 3).is_ok());
        assert!(check_integrity(&file, &"cd".repeat(32), 3).is_err());
        assert!(check_integrity(&file, &"ab".repeat(32), 4).is_err());
    }
}
