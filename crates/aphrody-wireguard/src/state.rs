// SPDX-License-Identifier: Apache-2.0
//! Per-tunnel runtime state: the process that owns a non-persistent interface (WireGuardNT,
//! userspace) and the configuration it was brought up with.

use aphrody_proc::NoWindow as _;
use std::path::PathBuf;
use std::process::Command;

use crate::{Config, Error, Result, driver};

fn file(name: &str, ext: &str) -> PathBuf {
    driver::state_dir().join(format!("{name}.{ext}"))
}

/// Record the owner process and its configuration (private key excluded).
pub fn record(name: &str, cfg: &Config) -> Result<()> {
    let dir = driver::state_dir();
    std::fs::create_dir_all(&dir).map_err(|e| Error::Backend(format!("{}: {e}", dir.display())))?;
    let mut public = cfg.clone();
    public.interface.private_key = None;
    for (path, body) in [
        (file(name, "pid"), std::process::id().to_string()),
        (file(name, "conf"), public.render()),
    ] {
        std::fs::write(&path, body)
            .map_err(|e| Error::Backend(format!("{}: {e}", path.display())))?;
    }
    Ok(())
}

/// Configuration recorded by [`record`], when the tunnel was started by Aphrody.
#[must_use]
pub fn recorded(name: &str) -> Option<Config> {
    std::fs::read_to_string(file(name, "conf"))
        .ok()
        .and_then(|t| Config::parse(&t).ok())
}

/// Owner process id, when recorded.
#[must_use]
pub fn owner(name: &str) -> Option<u32> {
    std::fs::read_to_string(file(name, "pid"))
        .ok()?
        .trim()
        .parse()
        .ok()
}

/// Forget the state of `name`.
pub fn clear(name: &str) {
    for ext in ["pid", "conf"] {
        let _ = std::fs::remove_file(file(name, ext));
    }
}

/// Stop the owner process of `name` (its interface goes away with it).
pub fn stop_owner(name: &str) -> Result<Option<u32>> {
    let Some(pid) = owner(name) else {
        return Ok(None);
    };
    if pid == std::process::id() {
        return Ok(None);
    }
    let pid_s = pid.to_string();
    #[cfg(windows)]
    let out = Command::new("taskkill")
        .no_window()
        .args(["/PID", &pid_s, "/T", "/F"])
        .output();
    #[cfg(not(windows))]
    let out = Command::new("kill")
        .no_window()
        .args(["-TERM", &pid_s])
        .output();
    let out = out.map_err(|e| Error::Backend(format!("arrêt du processus {pid}: {e}")))?;
    clear(name);
    if out.status.success() {
        Ok(Some(pid))
    } else {
        Err(Error::Backend(format!(
            "arrêt du processus {pid}: {}",
            String::from_utf8_lossy(&out.stderr).trim()
        )))
    }
}
