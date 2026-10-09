// SPDX-License-Identifier: Apache-2.0
//! .NET runtime and SDK detection and execution.

use aphrody_proc::NoWindow as _;
use std::{env, path::Path};

use serde::{Deserialize, Serialize};

use crate::compat::wine_proton::ExecResult;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DotnetRuntimeInfo {
    pub available: bool,
    pub cli_path: Option<String>,
    pub version: Option<String>,
    pub sdks: Vec<String>,
    pub runtimes: Vec<String>,
}

pub async fn detect_dotnet() -> DotnetRuntimeInfo {
    let cli = if cfg!(windows) {
        if Path::new(r"C:\Program Files\dotnet\dotnet.exe").exists() {
            Some(r"C:\Program Files\dotnet\dotnet.exe".to_owned())
        } else {
            None
        }
    } else if Path::new("/usr/bin/dotnet").exists() {
        Some("/usr/bin/dotnet".to_owned())
    } else if Path::new("/usr/share/dotnet/dotnet").exists() {
        Some("/usr/share/dotnet/dotnet".to_owned())
    } else {
        None
    };

    let cli_path = cli.or_else(|| which_dotnet().map(|p| p.to_string_lossy().to_string()));

    let Some(bin) = &cli_path else {
        return DotnetRuntimeInfo {
            available: false,
            cli_path: None,
            version: None,
            sdks: Vec::new(),
            runtimes: Vec::new(),
        };
    };

    let version_out = tokio::process::Command::new(bin).no_window().arg("--version").output().await.ok();

    let version = version_out.map(|o| String::from_utf8_lossy(&o.stdout).trim().to_owned());

    let sdks_out = tokio::process::Command::new(bin).no_window().arg("--list-sdks").output().await.ok();

    let sdks = sdks_out
        .map(|o| String::from_utf8_lossy(&o.stdout).lines().map(ToString::to_string).collect())
        .unwrap_or_default();

    let runtimes_out = tokio::process::Command::new(bin).no_window().arg("--list-runtimes").output().await.ok();

    let runtimes = runtimes_out
        .map(|o| String::from_utf8_lossy(&o.stdout).lines().map(ToString::to_string).collect())
        .unwrap_or_default();

    DotnetRuntimeInfo { available: true, cli_path: Some(bin.clone()), version, sdks, runtimes }
}

pub async fn execute_assembly(assembly_path: &str, args: &[String]) -> Result<ExecResult, String> {
    let dotnet = detect_dotnet().await;
    let Some(bin) = dotnet.cli_path else {
        return Err("dotnet CLI not found on system".to_owned());
    };

    let mut cmd = tokio::process::Command::new(bin).no_window();
    cmd.arg("exec").arg(assembly_path).args(args);

    let output = cmd.output().await.map_err(|e| format!("dotnet exec error: {e}"))?;

    Ok(ExecResult {
        exit_code: output.status.code().unwrap_or(-1),
        stdout: String::from_utf8_lossy(&output.stdout).to_string(),
        stderr: String::from_utf8_lossy(&output.stderr).to_string(),
    })
}

fn which_dotnet() -> Option<std::path::PathBuf> {
    let path_var = env::var("PATH").ok()?;
    let separator = if cfg!(windows) { ';' } else { ':' };
    for part in path_var.split(separator) {
        let name = if cfg!(windows) { "dotnet.exe" } else { "dotnet" };
        let candidate = Path::new(part).join(name);
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    None
}
