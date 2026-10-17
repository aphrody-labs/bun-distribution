// SPDX-License-Identifier: Apache-2.0
//! Process, path and hashing helpers shared by the pipeline stages.

use super::contract::Artifact;
use sha2::{Digest, Sha256};
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

/// Captured process result.
#[derive(Debug, Clone)]
pub struct RunResult {
    /// Exit code (`None` when killed by timeout or signal).
    pub code: Option<i32>,
    /// Captured stdout (lossy UTF-8).
    pub stdout: String,
    /// Captured stderr (lossy UTF-8).
    pub stderr: String,
    /// True when the timeout elapsed and the process was killed.
    pub timed_out: bool,
}

impl RunResult {
    /// Exit code zero.
    #[must_use]
    pub fn ok(&self) -> bool {
        self.code == Some(0)
    }
}

/// Run a program with a hard timeout; stdout/stderr are drained concurrently.
///
/// # Errors
/// Returns the spawn error text.
pub fn run_cmd(
    program: &Path,
    args: &[String],
    cwd: Option<&Path>,
    env: &[(String, String)],
    timeout: Duration,
) -> Result<RunResult, String> {
    let mut cmd = Command::new(program);
    cmd.args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if let Some(d) = cwd {
        cmd.current_dir(d);
    }
    for (k, v) in env {
        cmd.env(k, v);
    }
    let mut child = cmd
        .spawn()
        .map_err(|e| format!("{}: {e}", program.display()))?;
    let mut out = child.stdout.take();
    let mut err = child.stderr.take();
    let t_out = std::thread::spawn(move || {
        let mut s = Vec::new();
        if let Some(o) = out.as_mut() {
            let _ = o.read_to_end(&mut s);
        }
        s
    });
    let t_err = std::thread::spawn(move || {
        let mut s = Vec::new();
        if let Some(o) = err.as_mut() {
            let _ = o.read_to_end(&mut s);
        }
        s
    });
    let start = Instant::now();
    let mut timed_out = false;
    let status = loop {
        match child.try_wait() {
            Ok(Some(st)) => break Some(st),
            Ok(None) => {
                if start.elapsed() >= timeout {
                    let _ = child.kill();
                    let _ = child.wait();
                    timed_out = true;
                    break None;
                }
                std::thread::sleep(Duration::from_millis(20));
            }
            Err(e) => return Err(e.to_string()),
        }
    };
    let stdout = String::from_utf8_lossy(&t_out.join().unwrap_or_default()).into_owned();
    let stderr = String::from_utf8_lossy(&t_err.join().unwrap_or_default()).into_owned();
    Ok(RunResult {
        code: status.and_then(|s| s.code()),
        stdout,
        stderr,
        timed_out,
    })
}

/// Locate an executable on `PATH` (tries `.exe`, `.cmd`, `.bat` on Windows).
#[must_use]
pub fn which(name: &str) -> Option<PathBuf> {
    let p = Path::new(name);
    if p.is_absolute() && p.is_file() {
        return Some(p.to_path_buf());
    }
    let path = std::env::var_os("PATH")?;
    let exts: &[&str] = if cfg!(windows) {
        &["", ".exe", ".cmd", ".bat"]
    } else {
        &[""]
    };
    for dir in std::env::split_paths(&path) {
        for e in exts {
            let cand = dir.join(format!("{name}{e}"));
            if cand.is_file() {
                return Some(cand);
            }
        }
    }
    None
}

/// Locate the Bun OS checkout root: `BUN_OS_ROOT`, else the nearest ancestor of the working directory
/// containing `AGENTS.md` and `crates/`.
#[must_use]
pub fn find_root() -> Option<PathBuf> {
    if let Some(r) = std::env::var_os("BUN_OS_ROOT") {
        let p = PathBuf::from(r);
        if p.is_dir() {
            return Some(p);
        }
    }
    let mut cur = std::env::current_dir().ok()?;
    loop {
        if cur.join("AGENTS.md").is_file() && cur.join("crates").is_dir() {
            return Some(cur);
        }
        if !cur.pop() {
            return None;
        }
    }
}

/// SHA-256 hex digest.
#[must_use]
pub fn sha256_hex(bytes: &[u8]) -> String {
    hex::encode(Sha256::digest(bytes))
}

/// Describe a written file as an artifact.
#[must_use]
pub fn artifact(kind: &str, path: &Path) -> Artifact {
    let bytes = std::fs::metadata(path).map_or(0, |m| m.len());
    Artifact {
        kind: kind.to_string(),
        path: path.display().to_string(),
        bytes,
    }
}

/// Last `n` characters of `s` on a char boundary, for log excerpts.
#[must_use]
pub fn tail(s: &str, n: usize) -> String {
    let t = s.trim();
    if t.len() <= n {
        return t.to_string();
    }
    let mut i = t.len() - n;
    while !t.is_char_boundary(i) {
        i += 1;
    }
    format!("...{}", &t[i..])
}

/// Environment needed by a C compiler targeting the MSVC ABI when the process was not started from a
/// developer prompt: runs `vcvars64.bat` once and returns the variables it sets. Empty elsewhere or
/// when `INCLUDE` is already present.
#[must_use]
pub fn toolchain_env() -> Vec<(String, String)> {
    if !cfg!(windows) || std::env::var_os("INCLUDE").is_some() {
        return Vec::new();
    }
    let mut roots = Vec::new();
    for var in ["ProgramFiles(x86)", "ProgramFiles"] {
        if let Some(p) = std::env::var_os(var) {
            roots.push(PathBuf::from(p).join("Microsoft Visual Studio"));
        }
    }
    for root in roots {
        let Ok(years) = std::fs::read_dir(&root) else {
            continue;
        };
        for year in years.flatten() {
            let Ok(eds) = std::fs::read_dir(year.path()) else {
                continue;
            };
            for ed in eds.flatten() {
                let bat = ed
                    .path()
                    .join("VC")
                    .join("Auxiliary")
                    .join("Build")
                    .join("vcvars64.bat");
                if !bat.is_file() {
                    continue;
                }
                let wrapper =
                    std::env::temp_dir().join(format!("bunre-vcvars-{}.cmd", std::process::id()));
                let body = format!(
                    "@echo off
call \"{}\" >nul
set
",
                    bat.display()
                );
                if std::fs::write(&wrapper, body).is_err() {
                    continue;
                }
                let res = run_cmd(
                    Path::new("cmd.exe"),
                    &["/c".into(), wrapper.display().to_string()],
                    None,
                    &[],
                    Duration::from_secs(60),
                );
                let _ = std::fs::remove_file(&wrapper);
                let Ok(r) = res else { continue };
                if !r.ok() {
                    continue;
                }
                let vars: Vec<(String, String)> = r
                    .stdout
                    .lines()
                    .filter_map(|l| {
                        l.split_once('=')
                            .map(|(k, v)| (k.to_string(), v.trim_end().to_string()))
                    })
                    .filter(|(k, _)| {
                        ["INCLUDE", "LIB", "LIBPATH", "PATH", "Path"].contains(&k.as_str())
                    })
                    .collect();
                if !vars.is_empty() {
                    return vars;
                }
            }
        }
    }
    Vec::new()
}
