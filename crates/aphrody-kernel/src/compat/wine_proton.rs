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

    // Proton tools of every local Steam install and library (bun-steam discovery).
    let roots: Vec<PathBuf> =
        bun_steam::find_steam_installations().into_iter().map(|i| i.root_path).collect();
    let mut libraries = roots.clone();
    for root in &roots {
        if let Ok(found) = bun_steam::scan_steam_libraries(root) {
            libraries.extend(found.into_iter().map(|library| library.path));
        }
    }
    let tool_dirs: Vec<PathBuf> =
        roots.iter().flat_map(|root| bun_steam::proton::compat_tool_dirs(root)).collect();
    if let Some(tool) = bun_steam::proton::discover_compat_tools(&tool_dirs, &libraries)
        .into_iter()
        .find(|tool| tool.path.join("proton").is_file())
    {
        return WineRuntimeInfo {
            available: true,
            kind: "proton".to_owned(),
            path: Some(tool.path.join("proton").to_string_lossy().to_string()),
            prefix: env::var("STEAM_COMPAT_DATA_PATH").ok(),
            proton_version: Some(tool.display_name.unwrap_or(tool.name)),
        };
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
