// SPDX-License-Identifier: Apache-2.0

//! File and PATH helpers shared by the scaffolding subcommands (`app`, `linux`,
//! `wasm`, `win32`). Each command kept an identical private copy until
//! 2026-10-02; only the log tag differed.

use std::path::PathBuf;

use anyhow::{Context, Result, anyhow};

/// Writes `content` to `path`, creating parent directories, and logs
/// `[<tag>]   + <path>` on stderr unless `quiet`.
pub(crate) fn write_tagged(tag: &str, path: PathBuf, content: &str, quiet: bool) -> Result<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).with_context(|| format!("mkdir {}", parent.display()))?;
    }
    std::fs::write(&path, content).with_context(|| format!("write {}", path.display()))?;
    if !quiet {
        eprintln!("[{tag}]   + {}", path.display());
    }
    Ok(())
}

/// Finds `name` as a regular file in one of the `PATH` directories.
pub(crate) fn which(name: &str) -> Result<PathBuf> {
    let path = std::env::var_os("PATH").ok_or_else(|| anyhow!("PATH non défini"))?;
    for dir in std::env::split_paths(&path) {
        let p = dir.join(name);
        if p.is_file() {
            return Ok(p);
        }
    }
    Err(anyhow!("binaire `{name}` introuvable dans PATH"))
}
