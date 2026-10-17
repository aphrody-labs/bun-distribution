// SPDX-License-Identifier: Apache-2.0
//! PowerShell Core (pwsh) and Windows PowerShell compatibility runner.

use aphrody_proc::NoWindow as _;
use std::{env, path::Path};

use serde::{Deserialize, Serialize};

use crate::compat::wine_proton::ExecResult;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PwshRuntimeInfo {
    pub available: bool,
    pub kind: String,
    pub path: Option<String>,
    pub version: Option<String>,
}

pub async fn detect_pwsh() -> PwshRuntimeInfo {
    // Priority 1: pwsh (PowerShell 7+ Core, cross-platform)
    let pwsh_bin = which("pwsh").or_else(|| which("pwsh.exe"));
    if let Some(bin) = pwsh_bin {
        let version_out = tokio::process::Command::new(&bin)
            .no_window()
            .arg("-Version")
            .output()
            .await
            .ok();
        let version = version_out.map(|o| String::from_utf8_lossy(&o.stdout).trim().to_owned());
        return PwshRuntimeInfo {
            available: true,
            kind: "pwsh_core".to_owned(),
            path: Some(bin.to_string_lossy().to_string()),
            version,
        };
    }

    // Priority 2: Windows PowerShell 5.1 (Windows only)
    if cfg!(windows)
        && let Some(bin) = which("powershell.exe")
    {
        return PwshRuntimeInfo {
            available: true,
            kind: "windows_powershell".to_owned(),
            path: Some(bin.to_string_lossy().to_string()),
            version: Some("5.1".to_owned()),
        };
    }

    PwshRuntimeInfo {
        available: false,
        kind: "none".to_owned(),
        path: None,
        version: None,
    }
}

pub async fn eval_script(script: &str, cwd: Option<&str>) -> Result<ExecResult, String> {
    let runtime = detect_pwsh().await;
    let Some(bin) = runtime.path else {
        return Err("No PowerShell runtime (pwsh or powershell.exe) detected on system".to_owned());
    };

    let mut cmd = tokio::process::Command::new(bin).no_window();
    cmd.arg("-NoProfile")
        .arg("-NonInteractive")
        .arg("-Command")
        .arg(script);

    if let Some(dir) = cwd {
        cmd.current_dir(dir);
    }

    let output = cmd
        .output()
        .await
        .map_err(|e| format!("powershell execution error: {e}"))?;

    Ok(ExecResult {
        exit_code: output.status.code().unwrap_or(-1),
        stdout: String::from_utf8_lossy(&output.stdout).to_string(),
        stderr: String::from_utf8_lossy(&output.stderr).to_string(),
    })
}

fn which(program: &str) -> Option<std::path::PathBuf> {
    let path_var = env::var("PATH").ok()?;
    let separator = if cfg!(windows) { ';' } else { ':' };
    for part in path_var.split(separator) {
        let candidate = Path::new(part).join(program);
        if candidate.is_file() {
            return Some(candidate);
        }
        if cfg!(windows) && !program.ends_with(".exe") {
            let candidate_exe = Path::new(part).join(format!("{program}.exe"));
            if candidate_exe.is_file() {
                return Some(candidate_exe);
            }
        }
    }
    None
}
