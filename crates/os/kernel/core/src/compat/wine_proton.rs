// SPDX-License-Identifier: Apache-2.0
//! Proton and Wine runtime detection and execution layer for Windows binary compatibility.

use aphrody_proc::NoWindow as _;
use std::{
    collections::HashMap,
    env,
    path::{Path, PathBuf},
};

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WineRuntimeInfo {
    pub available: bool,
    pub kind: String,
    pub path: Option<String>,
    pub prefix: Option<String>,
    pub proton_version: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExecResult {
    pub exit_code: i32,
    pub stdout: String,
    pub stderr: String,
}

pub fn detect_wine_runtime() -> WineRuntimeInfo {
    if cfg!(windows) {
        return WineRuntimeInfo {
            available: true,
            kind: "native_windows".to_owned(),
            path: env::var("ComSpec").ok(),
            prefix: None,
            proton_version: None,
        };
    }

    // Check Wine in PATH
    if let Ok(wine_path) = which("wine") {
        return WineRuntimeInfo {
            available: true,
            kind: "wine".to_owned(),
            path: Some(wine_path.to_string_lossy().to_string()),
            prefix: env::var("WINEPREFIX").ok(),
            proton_version: None,
        };
    }

    // Check common Proton paths
    if let Ok(home) = env::var("HOME") {
        let steam_proton = Path::new(&home).join(".local/share/Steam/steamapps/common");
        if steam_proton.exists()
            && let Ok(entries) = std::fs::read_dir(&steam_proton)
        {
            for entry in entries.flatten() {
                let name = entry.file_name().to_string_lossy().to_string();
                if name.starts_with("Proton") {
                    let proton_bin = entry.path().join("proton");
                    return WineRuntimeInfo {
                        available: true,
                        kind: "proton".to_owned(),
                        path: Some(proton_bin.to_string_lossy().to_string()),
                        prefix: env::var("STEAM_COMPAT_DATA_PATH").ok(),
                        proton_version: Some(name),
                    };
                }
            }
        }
    }

    WineRuntimeInfo {
        available: false,
        kind: "none".to_owned(),
        path: None,
        prefix: None,
        proton_version: None,
    }
}

pub async fn execute_binary(
    executable: &str,
    args: &[String],
    prefix: Option<&str>,
    custom_env: &HashMap<String, String>,
) -> Result<ExecResult, String> {
    let runtime = detect_wine_runtime();

    let mut cmd = if cfg!(windows) {
        tokio::process::Command::new(executable).no_window()
    } else if runtime.kind == "proton" {
        let proton_path = runtime.path.ok_or_else(|| "Proton path not available".to_owned())?;
        let mut c = tokio::process::Command::new(proton_path).no_window();
        c.arg("run").arg(executable);
        c
    } else if runtime.kind == "wine" {
        let mut c = tokio::process::Command::new("wine").no_window();
        c.arg(executable);
        c
    } else {
        return Err(
            "Neither native Windows nor Wine/Proton runtime is available on this host".to_owned()
        );
    };

    if cfg!(windows) {
        cmd.args(args);
    } else {
        cmd.args(args);
        if let Some(p) = prefix {
            cmd.env("WINEPREFIX", p);
        }
    }

    for (k, v) in custom_env {
        cmd.env(k, v);
    }

    let output =
        cmd.output().await.map_err(|e| format!("execution error for `{executable}`: {e}"))?;

    Ok(ExecResult {
        exit_code: output.status.code().unwrap_or(-1),
        stdout: String::from_utf8_lossy(&output.stdout).to_string(),
        stderr: String::from_utf8_lossy(&output.stderr).to_string(),
    })
}

fn which(program: &str) -> Result<PathBuf, ()> {
    if let Ok(path_var) = env::var("PATH") {
        let separator = if cfg!(windows) { ';' } else { ':' };
        for part in path_var.split(separator) {
            let candidate = Path::new(part).join(program);
            if candidate.is_file() {
                return Ok(candidate);
            }
            if cfg!(windows) {
                let candidate_exe = Path::new(part).join(format!("{program}.exe"));
                if candidate_exe.is_file() {
                    return Ok(candidate_exe);
                }
            }
        }
    }
    Err(())
}
