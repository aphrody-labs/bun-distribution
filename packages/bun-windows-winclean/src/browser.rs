// SPDX-License-Identifier: Apache-2.0
//! Native Chrome inventory and isolated automation setup. Profile contents are never read.
use aphrody_proc::NoWindow as _;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{
    fs, io,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    time::{Duration, Instant},
};
use sysinfo::{ProcessesToUpdate, System};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BrowserProcess {
    pub pid: u32,
    pub binary: PathBuf,
    pub user_data: Option<PathBuf>,
    pub profile: Option<String>,
    pub windows: Vec<usize>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BrowserRoot {
    pub path: PathBuf,
    pub profiles: Vec<PathBuf>,
    pub local_state: PathBuf,
    pub devtools_port_file: PathBuf,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BrowserMap {
    pub binary: Option<PathBuf>,
    pub processes: Vec<BrowserProcess>,
    pub user_data: Vec<BrowserRoot>,
    pub automation_root: PathBuf,
    pub native_messaging: Vec<Value>,
}
fn invalid(message: &str) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidInput, message)
}
fn absolute(path: PathBuf) -> io::Result<PathBuf> {
    if path.is_absolute() {
        Ok(path)
    } else {
        Err(invalid("browser paths must be absolute"))
    }
}
fn flag(args: &[String], name: &str) -> Option<String> {
    args.iter().enumerate().find_map(|(index, arg)| {
        arg.strip_prefix(&format!("{name}="))
            .map(str::to_owned)
            .or_else(|| {
                (arg == name)
                    .then(|| args.get(index + 1).cloned())
                    .flatten()
            })
    })
}
fn push_unique(paths: &mut Vec<PathBuf>, path: PathBuf) {
    if path.is_absolute() && !paths.contains(&path) {
        paths.push(path);
    }
}
pub fn inspect_root(path: PathBuf) -> io::Result<BrowserRoot> {
    let mut profiles = Vec::new();
    for entry in fs::read_dir(&path)? {
        let entry = entry?;
        if entry.file_type()?.is_dir() && entry.path().join("Preferences").is_file() {
            profiles.push(entry.path());
        }
    }
    profiles.sort();
    Ok(BrowserRoot {
        local_state: path.join("Local State"),
        devtools_port_file: path.join("DevToolsActivePort"),
        path,
        profiles,
    })
}
/// Resolve platform roots, running browser flags and Windows App Paths. No secret values.
pub fn discover(binary: Option<PathBuf>, user_data: Option<PathBuf>) -> io::Result<BrowserMap> {
    let home = std::env::var_os("APHRODY_HOME")
        .map(PathBuf::from)
        .or_else(|| {
            std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" })
                .map(|p| PathBuf::from(p).join(".aphrody"))
        })
        .ok_or_else(|| invalid("configure APHRODY_HOME"))?;
    let automation_root = absolute(
        std::env::var_os("APHRODY_CHROME_AUTOMATION_ROOT")
            .map(PathBuf::from)
            .unwrap_or_else(|| home.join("profiles/chromium-automation")),
    )?;
    let configured_binary = binary.or_else(|| {
        std::env::var_os("APHRODY_WEB_CHROME_BIN")
            .or_else(|| std::env::var_os("CHROME_PATH"))
            .map(PathBuf::from)
    });
    let mut binaries = Vec::new();
    if let Some(path) = configured_binary {
        let path = absolute(path)?;
        if !path.is_file() {
            return Err(invalid("configured Chrome binary does not exist"));
        }
        binaries.push(path);
    }
    let mut roots = Vec::new();
    if let Some(path) =
        user_data.or_else(|| std::env::var_os("APHRODY_CHROME_USER_DATA_DIR").map(PathBuf::from))
    {
        push_unique(&mut roots, absolute(path)?);
    }
    let windows = aphrody_capture::list_detailed_windows();
    let mut system = System::new();
    system.refresh_processes(ProcessesToUpdate::All, true);
    let mut processes = Vec::new();
    for (pid, process) in system.processes() {
        let Some(exe) = process.exe() else {
            continue;
        };
        let name = exe
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .to_ascii_lowercase();
        if !matches!(
            name.as_str(),
            "chrome.exe" | "chrome" | "chromium" | "chromium-browser" | "google chrome"
        ) {
            continue;
        }
        push_unique(&mut binaries, exe.to_path_buf());
        let args: Vec<_> = process
            .cmd()
            .iter()
            .map(|s| s.to_string_lossy().into_owned())
            .collect();
        let root = flag(&args, "--user-data-dir").map(PathBuf::from);
        if let Some(root) = &root {
            push_unique(&mut roots, root.clone());
        }
        processes.push(BrowserProcess {
            pid: pid.as_u32(),
            binary: exe.to_path_buf(),
            user_data: root,
            profile: flag(&args, "--profile-directory"),
            windows: windows
                .iter()
                .filter(|w| w.process_id == pid.as_u32())
                .map(|w| w.handle)
                .collect(),
        });
    }
    let native_messaging = Vec::new();
    #[cfg(windows)]
    let mut native_messaging = native_messaging;
    #[cfg(windows)]
    {
        for hive in ["HKCU", "HKLM"] {
            if let Ok(value) = crate::registry::get_value(
                &format!(r"{hive}\Software\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe"),
                "(default)",
            ) && let Some(path) = value["Value"].as_str()
            {
                push_unique(&mut binaries, PathBuf::from(path.trim_matches('"')));
            }
            if let Ok(value) = crate::registry::list_key(&format!(
                r"{hive}\Software\Google\Chrome\NativeMessagingHosts"
            )) {
                native_messaging.push(json!({"hive":hive,"hosts":value["SubKeys"]}));
            }
        }
        if let Some(base) = std::env::var_os("LOCALAPPDATA") {
            for relative in [
                "Google/Chrome/User Data",
                "Google/Chrome Beta/User Data",
                "Google/Chrome SxS/User Data",
                "Chromium/User Data",
            ] {
                push_unique(&mut roots, PathBuf::from(&base).join(relative));
            }
        }
    }
    #[cfg(not(windows))]
    {
        let base = if cfg!(target_os = "macos") {
            std::env::var_os("HOME").map(|p| PathBuf::from(p).join("Library/Application Support"))
        } else {
            std::env::var_os("XDG_CONFIG_HOME")
                .map(PathBuf::from)
                .or_else(|| std::env::var_os("HOME").map(|p| PathBuf::from(p).join(".config")))
        };
        if let Some(base) = base {
            for relative in ["google-chrome", "chromium", "Google/Chrome"] {
                push_unique(&mut roots, base.join(relative));
            }
        }
        if let Some(path) = std::env::var_os("PATH") {
            for base in std::env::split_paths(&path) {
                for name in ["google-chrome", "chromium", "chromium-browser"] {
                    let file = base.join(name);
                    if file.is_file() {
                        push_unique(&mut binaries, file);
                    }
                }
            }
        }
    }
    push_unique(&mut roots, automation_root.clone());
    let user_data = roots
        .into_iter()
        .filter(|p| p.is_dir())
        .map(inspect_root)
        .collect::<io::Result<Vec<_>>>()?;
    processes.sort_by_key(|p| p.pid);
    Ok(BrowserMap {
        binary: binaries.into_iter().find(|p| p.is_file()),
        processes,
        user_data,
        automation_root,
        native_messaging,
    })
}
fn active_port(root: &Path) -> io::Result<u16> {
    let text = fs::read_to_string(root.join("DevToolsActivePort"))?;
    text.lines()
        .next()
        .and_then(|s| s.parse::<u16>().ok())
        .filter(|p| *p != 0)
        .ok_or_else(|| invalid("invalid DevToolsActivePort"))
}
fn endpoint(root: &Path) -> io::Result<Value> {
    let port = active_port(root)?;
    let _ = rustls::crypto::ring::default_provider().install_default();
    let client = reqwest::blocking::Client::builder()
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(2))
        .build()
        .map_err(io::Error::other)?;
    let version: Value = client
        .get(format!("http://127.0.0.1:{port}/json/version"))
        .send()
        .and_then(reqwest::blocking::Response::error_for_status)
        .map_err(io::Error::other)?
        .json()
        .map_err(io::Error::other)?;
    let ws = version["webSocketDebuggerUrl"]
        .as_str()
        .ok_or_else(|| invalid("Chrome did not return a CDP websocket"))?;
    if !ws.starts_with(&format!("ws://127.0.0.1:{port}/devtools/browser/")) {
        return Err(invalid(
            "Chrome CDP endpoint is not the selected loopback port",
        ));
    }
    Ok(
        json!({"http":format!("http://127.0.0.1:{port}"),"websocket":ws,"browser":version["Browser"],"protocol":version["Protocol-Version"]}),
    )
}
/// Start/reuse only the dedicated Aphrody profile, preserving all personal Chrome processes.
pub fn setup(map: &BrowserMap) -> io::Result<Value> {
    let binary = map
        .binary
        .as_ref()
        .ok_or_else(|| invalid("Chrome not found; configure APHRODY_WEB_CHROME_BIN"))?;
    // Refuse to expose CDP on any discovered personal profile root.
    for root in &map.user_data {
        if root.path != map.automation_root
            && (map.automation_root.starts_with(&root.path)
                || root.path.starts_with(&map.automation_root))
        {
            return Err(invalid("automation root overlaps a personal Chrome root"));
        }
    }
    fs::create_dir_all(&map.automation_root)?;
    let running = map
        .processes
        .iter()
        .any(|p| p.user_data.as_ref() == Some(&map.automation_root));
    if running {
        return Ok(
            json!({"reused":true,"profile":map.automation_root,"cdp":endpoint(&map.automation_root)?}),
        );
    }
    // An old port file must never connect setup to an unrelated previous session.
    let port_file = map.automation_root.join("DevToolsActivePort");
    if port_file.is_file() {
        fs::remove_file(port_file)?;
    }
    let mut child = Command::new(binary)
        .no_window()
        .arg(format!("--user-data-dir={}", map.automation_root.display()))
        .args([
            "--remote-debugging-address=127.0.0.1",
            "--remote-debugging-port=0",
            "--no-first-run",
            "--no-default-browser-check",
            "about:blank",
        ])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()?;
    let started = Instant::now();
    loop {
        if let Ok(cdp) = endpoint(&map.automation_root) {
            return Ok(
                json!({"reused":false,"pid":child.id(),"profile":map.automation_root,"cdp":cdp}),
            );
        }
        if let Some(status) = child.try_wait()? {
            return Err(io::Error::other(format!(
                "Chrome exited before CDP became ready: {status}"
            )));
        }
        if started.elapsed() > Duration::from_secs(15) {
            return Err(io::Error::new(
                io::ErrorKind::TimedOut,
                "Chrome CDP readiness timed out",
            ));
        }
        std::thread::sleep(Duration::from_millis(150));
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn flags_support_equals_and_separate_values() {
        let args = vec![
            "--user-data-dir=C:/Browser Data".into(),
            "--profile-directory".into(),
            "Profile 2".into(),
            "--password=secret".into(),
        ];
        assert_eq!(
            flag(&args, "--user-data-dir"),
            Some("C:/Browser Data".into())
        );
        assert_eq!(flag(&args, "--profile-directory"), Some("Profile 2".into()));
    }
    #[test]
    fn discovers_custom_profiles_without_reading_preferences() {
        let root = tempfile::tempdir().unwrap();
        let custom = root.path().join("My Custom Profile");
        fs::create_dir(&custom).unwrap();
        fs::write(custom.join("Preferences"), "not JSON and never parsed").unwrap();
        fs::create_dir(root.path().join("Cache")).unwrap();
        assert_eq!(
            inspect_root(root.path().into()).unwrap().profiles,
            vec![custom]
        );
    }
    #[test]
    fn rejects_zero_port() {
        let root = tempfile::tempdir().unwrap();
        fs::write(root.path().join("DevToolsActivePort"), "0\n/x").unwrap();
        assert!(active_port(root.path()).is_err());
    }
}
