//! `cargo xtask` commands shared by the Craft apps: `stats` (tests and lines of Rust per crate)
//! and `version` (the workspace version in the root `Cargo.toml`).

use std::path::{Path, PathBuf};
use std::process::Command;

pub mod stats;
pub mod version;

/// The workspace root: this crate lives in `crates/craft-xtask`.
pub fn root() -> PathBuf {
    let dir = Path::new(env!("CARGO_MANIFEST_DIR"));
    dir.ancestors().nth(2).unwrap_or(dir).to_path_buf()
}

/// `cargo` (the one running the xtask, if any) in the workspace root.
pub fn cargo() -> Command {
    let mut c = Command::new(std::env::var("CARGO").unwrap_or_else(|_| "cargo".into()));
    c.current_dir(root());
    c
}

/// Runs `cmd`, echoing `what`; a non-zero exit is an error.
pub fn run(mut cmd: Command, what: &str) -> Result<(), String> {
    eprintln!("$ {what}");
    let status = cmd.status().map_err(|e| format!("{what}: failed to spawn: {e}"))?;
    if status.success() { Ok(()) } else { Err(format!("{what}: exited with {status}")) }
}

/// `cargo metadata --no-deps` of the workspace.
pub fn metadata() -> Result<serde_json::Value, String> {
    let out = cargo()
        .args(["metadata", "--format-version", "1", "--no-deps"])
        .output()
        .map_err(|e| format!("cargo metadata: {e}"))?;
    if !out.status.success() {
        return Err(format!("cargo metadata failed:\n{}", String::from_utf8_lossy(&out.stderr)));
    }
    serde_json::from_slice(&out.stdout).map_err(|e| format!("cargo metadata: bad JSON: {e}"))
}
