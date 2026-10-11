// SPDX-License-Identifier: Apache-2.0
//! `aphrody wsl wslg`: host-side WSLg inspection and launch, without PowerShell or a console.
//!
//! The WSL install (`%ProgramFiles%\WSL`: `system.vhd`, `msrdc.exe`, the RAIL and desktop RDP
//! profiles), the `msrdc`/`wslservice` processes and their windows come from the in-process
//! WinClean crate (sysinfo, window enumeration, registry); the guest half of the GPU report runs
//! `wslg-manager.sh gpu` inside the distribution through `wsl.exe`.

use aphrody_proc::NoWindow as _;
use clap::Subcommand;
use serde_json::{Value, json};
use std::{
    path::{Path, PathBuf},
    process::Command,
};

use crate::wsl::{Error, Result};

/// Display adapter device class (`Win32_VideoController` reads the same driver keys).
const DISPLAY_CLASS: &str =
    r"HKLM:\SYSTEM\CurrentControlSet\Control\Class\{4d36e968-e325-11ce-bfc1-08002be10318}";

#[derive(Debug, Clone, Subcommand)]
pub enum WslgAction {
    /// WSL install, msrdc and wslservice processes, RDP profiles and host display adapters.
    Status,
    /// Top-level windows owned by msrdc (the WSLg RAIL windows).
    Windows,
    /// Host display adapters, then the guest GPU report of `wslg-manager.sh gpu`.
    Gpu {
        /// Distribution; defaults to the first one that is not docker-desktop.
        #[arg(long)]
        distro: Option<String>,
        /// Guest script, as a Windows path.
        #[arg(long, default_value = "scripts/tools/os/scripts/wslg-manager.sh")]
        guest_script: PathBuf,
    },
    /// Open the full WSLg desktop session (`mstsc.exe wslg_desktop.rdp`).
    Desktop,
}

fn install_root() -> PathBuf {
    std::env::var_os("ProgramW6432")
        .or_else(|| std::env::var_os("ProgramFiles"))
        .map_or_else(|| PathBuf::from(r"C:\Program Files"), PathBuf::from)
        .join("WSL")
}

fn mib(bytes: u64) -> f64 {
    // Two decimals, as the former report printed.
    (bytes as f64 / 1_048_576.0 * 100.0).round() / 100.0
}

/// The process named `name` (exact, case-insensitive), largest working set first.
fn process(name: &str) -> Option<aphrody_winclean::system::ProcessInfo> {
    let stem = name.trim_end_matches(".exe");
    aphrody_winclean::system::list_processes(Some(stem), "memory", 1_000)
        .processes
        .into_iter()
        .find(|item| item.name.trim_end_matches(".exe").eq_ignore_ascii_case(stem))
}

fn processes(name: &str) -> Vec<u32> {
    let stem = name.trim_end_matches(".exe");
    aphrody_winclean::system::list_processes(Some(stem), "memory", 1_000)
        .processes
        .into_iter()
        .filter(|item| item.name.trim_end_matches(".exe").eq_ignore_ascii_case(stem))
        .map(|item| item.pid)
        .collect()
}

/// Display adapters from the driver class keys: name, provider, driver version, memory.
#[must_use]
pub fn display_adapters() -> Vec<Value> {
    let Ok(class) = aphrody_winclean::registry::list_key(DISPLAY_CLASS) else { return vec![] };
    let subkeys = class["SubKeys"].as_array().cloned().unwrap_or_default();
    subkeys
        .iter()
        .filter_map(Value::as_str)
        .filter(|path| {
            path.rsplit('\\').next().is_some_and(|leaf| leaf.chars().all(|c| c.is_ascii_digit()))
        })
        .filter_map(|path| aphrody_winclean::registry::list_key(path).ok())
        .filter_map(|key| adapter_from_values(key["Values"].as_array()?))
        .collect()
}

/// One adapter record from its driver key values; `None` without a `DriverDesc`.
#[must_use]
pub fn adapter_from_values(values: &[Value]) -> Option<Value> {
    let get = |name: &str| {
        values
            .iter()
            .find(|value| value["name"].as_str() == Some(name))
            .map(|value| &value["value"])
    };
    let name = get("DriverDesc")?.as_str()?.to_owned();
    Some(json!({
        "name": name,
        "provider": get("ProviderName").cloned().unwrap_or(Value::Null),
        "driverVersion": get("DriverVersion").cloned().unwrap_or(Value::Null),
        "deviceId": get("MatchingDeviceId").cloned().unwrap_or(Value::Null),
        "memoryMb": get("HardwareInformation.qwMemorySize").and_then(Value::as_u64).map(mib),
    }))
}

/// The former `Status`/`Json` report.
#[must_use]
pub fn host_info() -> Value {
    let root = install_root();
    let vhd = root.join("system.vhd");
    let msrdc = process("msrdc");
    let service = process("wslservice");
    json!({
        "installed": root.join("msrdc.exe").is_file(),
        "installPath": root,
        "systemVhdExists": vhd.is_file(),
        "systemVhdSizeMb": std::fs::metadata(&vhd).map_or(0.0, |meta| mib(meta.len())),
        "msrdcRunning": msrdc.is_some(),
        "msrdcPid": msrdc.as_ref().map(|item| item.pid),
        "msrdcWorkingSetMb": msrdc.as_ref().map_or(0.0, |item| mib(item.working_set_bytes)),
        "wslServiceRunning": service.is_some(),
        "wslServicePid": service.as_ref().map(|item| item.pid),
        "wslgRdpExists": root.join("wslg.rdp").is_file(),
        "desktopRdpExists": root.join("wslg_desktop.rdp").is_file(),
        "displayAdapters": display_adapters(),
    })
}

fn msrdc_windows() -> Result<Value> {
    let pids = processes("msrdc");
    if pids.is_empty() {
        return Ok(json!({"msrdcRunning": false, "windows": []}));
    }
    let listed = aphrody_winclean::dispatch::call_rust("list_windows", json!({}))
        .map_err(|error| Error::Invalid(format!("list_windows: {error}")))?;
    let windows: Vec<Value> = listed["Windows"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|window| {
            window["ProcessId"].as_u64().is_some_and(|pid| pids.iter().any(|p| u64::from(*p) == pid))
        })
        .map(|window| json!({"hwnd": window["Handle"], "title": window["Title"], "pid": window["ProcessId"]}))
        .collect();
    Ok(json!({"msrdcRunning": true, "msrdcPids": pids, "windows": windows}))
}

/// `wsl.exe` output is UTF-16LE on Windows; plain UTF-8 elsewhere.
#[must_use]
pub fn decode_wsl_output(bytes: &[u8]) -> String {
    if bytes.len() >= 2
        && bytes.len().is_multiple_of(2)
        && bytes.iter().skip(1).step_by(2).all(|b| *b == 0)
    {
        let units: Vec<u16> =
            bytes.as_chunks::<2>().0.iter().map(|pair| u16::from_le_bytes(*pair)).collect();
        String::from_utf16_lossy(&units)
    } else {
        String::from_utf8_lossy(bytes).into_owned()
    }
    .replace('\0', "")
}

/// First distribution in `wsl.exe --list --quiet` order that is not docker-desktop.
#[must_use]
pub fn pick_distro(listing: &str) -> Option<String> {
    listing
        .lines()
        .map(str::trim)
        .find(|name| !name.is_empty() && !name.starts_with("docker-desktop"))
        .map(str::to_owned)
}

fn wsl(args: &[&str]) -> Result<std::process::Output> {
    let mut command = Command::new("wsl.exe").no_window();
    Ok(command.args(args).output()?)
}

fn guest_gpu(distro: Option<String>, guest_script: &Path) -> Result<Value> {
    let distro = match distro {
        Some(name) => name,
        None => pick_distro(&decode_wsl_output(&wsl(&["--list", "--quiet"])?.stdout)).ok_or_else(
            || Error::Invalid("no WSL distribution other than docker-desktop".into()),
        )?,
    };
    let script = std::path::absolute(guest_script)?;
    if !script.is_file() {
        return Err(Error::Invalid(format!("guest script missing: {}", script.display())));
    }
    let windows_path = script.to_string_lossy().replace('\\', "/");
    let converted = wsl(&["-d", &distro, "-e", "wslpath", "-a", &windows_path])?;
    let guest_path = decode_wsl_output(&converted.stdout).trim().to_owned();
    if !converted.status.success() || guest_path.is_empty() {
        return Err(Error::Invalid(format!("wslpath failed in {distro}")));
    }
    let report = wsl(&["-d", &distro, "-e", "/bin/bash", &guest_path, "gpu"])?;
    Ok(json!({
        "distro": distro,
        "exitCode": report.status.code(),
        "stdout": decode_wsl_output(&report.stdout),
        "stderr": decode_wsl_output(&report.stderr),
    }))
}

fn open_desktop() -> Result<Value> {
    let profile = install_root().join("wslg_desktop.rdp");
    if !profile.is_file() {
        return Err(Error::Invalid(format!("{} not found", profile.display())));
    }
    let mut command = Command::new("mstsc.exe").detached();
    let child = command.arg(&profile).spawn()?;
    Ok(json!({"launched": "mstsc.exe", "profile": profile, "pid": child.id()}))
}

/// Run one WSLg action; the result is printed as JSON by the caller.
///
/// # Errors
/// Window enumeration, `wsl.exe` or `mstsc.exe` failures, a missing guest script or profile.
pub fn run(action: WslgAction) -> Result<Value> {
    match action {
        WslgAction::Status => Ok(host_info()),
        WslgAction::Windows => msrdc_windows(),
        WslgAction::Gpu { distro, guest_script } => Ok(json!({
            "host": display_adapters(),
            "guest": guest_gpu(distro, &guest_script)?,
        })),
        WslgAction::Desktop => open_desktop(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_utf16_wsl_listing_and_picks_distro() {
        let listing: Vec<u8> = "docker-desktop\r\nAphrodyAlpine\r\n"
            .encode_utf16()
            .flat_map(u16::to_le_bytes)
            .collect();
        let text = decode_wsl_output(&listing);
        assert_eq!(pick_distro(&text).as_deref(), Some("AphrodyAlpine"));
        assert_eq!(decode_wsl_output(b"Ubuntu\n"), "Ubuntu\n");
        assert_eq!(pick_distro("docker-desktop\n"), None);
    }

    #[test]
    fn adapter_record_from_driver_values() {
        let values = vec![
            json!({"name": "DriverDesc", "value": "NVIDIA GeForce RTX 4070"}),
            json!({"name": "DriverVersion", "value": "32.0.16.1692"}),
            json!({"name": "HardwareInformation.qwMemorySize", "value": 12_878_610_432_u64}),
        ];
        let adapter = adapter_from_values(&values).unwrap();
        assert_eq!(adapter["name"], "NVIDIA GeForce RTX 4070");
        assert_eq!(adapter["driverVersion"], "32.0.16.1692");
        assert_eq!(adapter["memoryMb"], 12_282.0);
        assert!(adapter_from_values(&[json!({"name": "Other", "value": 1})]).is_none());
    }

    #[test]
    fn host_info_reports_every_field() {
        let info = host_info();
        for field in
            ["installed", "installPath", "systemVhdSizeMb", "msrdcRunning", "displayAdapters"]
        {
            assert!(info.get(field).is_some(), "{field}");
        }
        // Every Windows host has at least one display driver key (the basic adapter otherwise).
        #[cfg(windows)]
        assert!(!display_adapters().is_empty(), "{info}");
    }

    #[test]
    fn lists_msrdc_windows_or_reports_it_stopped() {
        let windows = run(WslgAction::Windows).unwrap();
        assert!(windows["msrdcRunning"].is_boolean());
        assert!(windows["windows"].is_array());
    }
}
