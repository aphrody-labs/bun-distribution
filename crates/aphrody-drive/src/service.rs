// SPDX-License-Identifier: FSL-1.1-ALv2
// Derived from Spacedrive (drive/apps/tauri/src-tauri/src/main.rs), adopted as the Aphrody Drive
// file explorer.
//! Install `sd-daemon` as a per-user background service: a launchd agent on macOS, a systemd
//! user unit on Linux, a logon scheduled task on Windows. Once installed, the service owns the
//! daemon and the supervisor only adopts it.

use std::path::Path;
#[cfg(any(target_os = "macos", target_os = "linux", windows))]
use std::process::Command;

/// launchd label (macOS).
pub const LAUNCHD_LABEL: &str = "dev.aphrody.drive.daemon";
/// systemd user unit (Linux).
pub const SYSTEMD_UNIT: &str = "aphrody-drive-daemon.service";
/// Scheduled task name (Windows).
pub const WINDOWS_TASK: &str = "AphrodyDriveDaemon";

/// Escape text for an XML element body.
#[must_use]
pub fn xml_escape(text: &str) -> String {
    let mut escaped = String::with_capacity(text.len());
    for character in text.chars() {
        match character {
            '&' => escaped.push_str("&amp;"),
            '<' => escaped.push_str("&lt;"),
            '>' => escaped.push_str("&gt;"),
            '"' => escaped.push_str("&quot;"),
            '\'' => escaped.push_str("&apos;"),
            other => escaped.push(other),
        }
    }
    escaped
}

/// The launchd agent definition.
#[must_use]
pub fn launchd_plist(daemon: &Path, data_dir: &Path, log_dir: &Path) -> String {
    format!(
        r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>Label</key>
	<string>{LAUNCHD_LABEL}</string>
	<key>ProgramArguments</key>
	<array>
		<string>{}</string>
		<string>--data-dir</string>
		<string>{}</string>
	</array>
	<key>RunAtLoad</key>
	<true/>
	<key>KeepAlive</key>
	<dict>
		<key>SuccessfulExit</key>
		<false/>
	</dict>
	<key>StandardOutPath</key>
	<string>{}</string>
	<key>StandardErrorPath</key>
	<string>{}</string>
</dict>
</plist>
"#,
        xml_escape(&daemon.display().to_string()),
        xml_escape(&data_dir.display().to_string()),
        xml_escape(&log_dir.join("daemon.out.log").display().to_string()),
        xml_escape(&log_dir.join("daemon.err.log").display().to_string()),
    )
}

/// Quote one argument for a systemd `ExecStart=` line.
fn systemd_quote(argument: &str) -> String {
    format!(
        "\"{}\"",
        argument.replace('\\', "\\\\").replace('"', "\\\"")
    )
}

/// The systemd user unit.
#[must_use]
pub fn systemd_unit(daemon: &Path, data_dir: &Path) -> String {
    format!(
        "[Unit]\nDescription=Aphrody Drive \
         daemon\nAfter=network.target\n\n[Service]\nType=simple\nExecStart={} --data-dir \
         {}\nRestart=on-failure\nRestartSec=5s\n\n[Install]\nWantedBy=default.target\n",
        systemd_quote(&daemon.display().to_string()),
        systemd_quote(&data_dir.display().to_string()),
    )
}

/// The Task Scheduler definition (logon trigger, least privilege, no time limit, hidden). The daemon runs behind
/// `conhost.exe --headless`: the interactive session never gets a console window.
#[must_use]
pub fn windows_task_xml(daemon: &Path, data_dir: &Path) -> String {
    format!(
        r#"<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Description>Aphrody Drive daemon</Description>
  </RegistrationInfo>
  <Triggers>
    <LogonTrigger>
      <Enabled>true</Enabled>
    </LogonTrigger>
  </Triggers>
  <Principals>
    <Principal>
      <LogonType>InteractiveToken</LogonType>
      <RunLevel>LeastPrivilege</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <AllowHardTerminate>true</AllowHardTerminate>
    <StartWhenAvailable>true</StartWhenAvailable>
    <RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>
    <AllowStartOnDemand>true</AllowStartOnDemand>
    <Enabled>true</Enabled>
    <Hidden>true</Hidden>
    <RunOnlyIfIdle>false</RunOnlyIfIdle>
    <WakeToRun>false</WakeToRun>
    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>
    <Priority>7</Priority>
  </Settings>
  <Actions>
    <Exec>
      <Command>conhost.exe</Command>
      <Arguments>--headless "{}" --data-dir "{}"</Arguments>
    </Exec>
  </Actions>
</Task>
"#,
        xml_escape(&daemon.display().to_string()),
        xml_escape(&data_dir.display().to_string()),
    )
}

/// UTF-16LE with a byte order mark, the encoding the task XML declares.
#[must_use]
pub fn utf16le_with_bom(text: &str) -> Vec<u8> {
    let mut bytes = vec![0xFF, 0xFE];
    for unit in text.encode_utf16() {
        bytes.extend_from_slice(&unit.to_le_bytes());
    }
    bytes
}

#[cfg(any(target_os = "macos", target_os = "linux", windows))]
fn quiet(program: &str) -> Command {
    #[allow(unused_mut)]
    let mut command = Command::new(program);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    command
}

#[cfg(any(target_os = "macos", target_os = "linux", windows))]
fn run(command: &mut Command, what: &str) -> Result<(), String> {
    let output = command
        .output()
        .map_err(|error| format!("Failed to {what}: {error}"))?;
    if output.status.success() {
        Ok(())
    } else {
        Err(format!(
            "Failed to {what}: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ))
    }
}

#[cfg(any(target_os = "macos", target_os = "linux"))]
fn home() -> Result<std::path::PathBuf, String> {
    dirs::home_dir().ok_or_else(|| "Could not determine home directory".to_string())
}

#[cfg(target_os = "macos")]
fn plist_path() -> Result<std::path::PathBuf, String> {
    Ok(home()?
        .join("Library/LaunchAgents")
        .join(format!("{LAUNCHD_LABEL}.plist")))
}

#[cfg(target_os = "linux")]
fn unit_path() -> Result<std::path::PathBuf, String> {
    Ok(home()?.join(".config/systemd/user").join(SYSTEMD_UNIT))
}

/// Whether the service is installed.
///
/// # Errors
/// When the platform query fails.
pub fn is_installed() -> Result<bool, String> {
    #[cfg(target_os = "macos")]
    {
        Ok(plist_path()?.exists())
    }
    #[cfg(target_os = "linux")]
    {
        Ok(unit_path()?.exists())
    }
    #[cfg(windows)]
    {
        let output = quiet("schtasks")
            .args(["/Query", "/TN", WINDOWS_TASK, "/FO", "LIST"])
            .output()
            .map_err(|error| format!("Failed to query scheduled task: {error}"))?;
        Ok(output.status.success())
    }
    #[cfg(not(any(target_os = "macos", target_os = "linux", windows)))]
    {
        Ok(false)
    }
}

/// Install and start the service for `daemon` on `data_dir`.
///
/// # Errors
/// When a file cannot be written or the service manager refuses the definition.
pub fn install(daemon: &Path, data_dir: &Path) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let plist = plist_path()?;
        if let Some(parent) = plist.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|error| format!("Failed to create LaunchAgents directory: {error}"))?;
        }
        let log_dir = data_dir.join("logs");
        std::fs::create_dir_all(&log_dir)
            .map_err(|error| format!("Failed to create logs directory: {error}"))?;
        std::fs::write(&plist, launchd_plist(daemon, data_dir, &log_dir))
            .map_err(|error| format!("Failed to write plist file: {error}"))?;
        let _ = quiet("launchctl").arg("unload").arg(&plist).output();
        run(
            quiet("launchctl").arg("load").arg(&plist),
            "load daemon service",
        )
    }
    #[cfg(target_os = "linux")]
    {
        let unit = unit_path()?;
        if let Some(parent) = unit.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|error| format!("Failed to create systemd directory: {error}"))?;
        }
        std::fs::write(&unit, systemd_unit(daemon, data_dir))
            .map_err(|error| format!("Failed to write service file: {error}"))?;
        run(
            quiet("systemctl").args(["--user", "daemon-reload"]),
            "reload systemd",
        )?;
        run(
            quiet("systemctl").args(["--user", "enable", SYSTEMD_UNIT]),
            "enable service",
        )?;
        run(
            quiet("systemctl").args(["--user", "start", SYSTEMD_UNIT]),
            "start daemon service",
        )
    }
    #[cfg(windows)]
    {
        let _ = quiet("schtasks")
            .args(["/Delete", "/TN", WINDOWS_TASK, "/F"])
            .output();
        let xml_path =
            std::env::temp_dir().join(format!("aphrody-drive-task-{}.xml", std::process::id()));
        std::fs::write(
            &xml_path,
            utf16le_with_bom(&windows_task_xml(daemon, data_dir)),
        )
        .map_err(|error| format!("Failed to write task XML: {error}"))?;
        let created = run(
            quiet("schtasks")
                .args(["/Create", "/TN", WINDOWS_TASK, "/XML"])
                .arg(&xml_path),
            "create scheduled task",
        );
        let _ = std::fs::remove_file(&xml_path);
        created?;
        run(
            quiet("schtasks").args(["/Run", "/TN", WINDOWS_TASK]),
            "start daemon task",
        )
    }
    #[cfg(not(any(target_os = "macos", target_os = "linux", windows)))]
    {
        let _ = (daemon, data_dir);
        Err("Service installation not supported on this platform".to_string())
    }
}

/// Stop and remove the service. Removing a service that is not installed succeeds.
///
/// # Errors
/// When the definition file cannot be removed.
pub fn uninstall() -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let plist = plist_path()?;
        if plist.exists() {
            let _ = quiet("launchctl").arg("unload").arg(&plist).output();
            std::fs::remove_file(&plist)
                .map_err(|error| format!("Failed to remove plist file: {error}"))?;
        }
        Ok(())
    }
    #[cfg(target_os = "linux")]
    {
        let unit = unit_path()?;
        if unit.exists() {
            let _ = quiet("systemctl")
                .args(["--user", "stop", SYSTEMD_UNIT])
                .output();
            let _ = quiet("systemctl")
                .args(["--user", "disable", SYSTEMD_UNIT])
                .output();
            std::fs::remove_file(&unit)
                .map_err(|error| format!("Failed to remove service file: {error}"))?;
            let _ = quiet("systemctl")
                .args(["--user", "daemon-reload"])
                .output();
        }
        Ok(())
    }
    #[cfg(windows)]
    {
        let _ = quiet("schtasks")
            .args(["/End", "/TN", WINDOWS_TASK])
            .output();
        let output = quiet("schtasks")
            .args(["/Delete", "/TN", WINDOWS_TASK, "/F"])
            .output()
            .map_err(|error| format!("Failed to delete scheduled task: {error}"))?;
        if !output.status.success() {
            // A missing task is fine; anything else is only worth a warning.
            log::warn!(
                "schtasks /Delete: {}",
                String::from_utf8_lossy(&output.stderr).trim()
            );
        }
        Ok(())
    }
    #[cfg(not(any(target_os = "macos", target_os = "linux", windows)))]
    {
        Err("Service installation not supported on this platform".to_string())
    }
}

/// Open the macOS Login Items settings (background items approval).
///
/// # Errors
/// Off macOS, or when `open` cannot run.
pub fn open_macos_settings() -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg("x-apple.systempreferences:com.apple.LoginItems-Settings.extension")
            .spawn()
            .map(drop)
            .map_err(|error| format!("Failed to open settings: {error}"))
    }
    #[cfg(not(target_os = "macos"))]
    {
        Err("Not supported on this platform".to_string())
    }
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use super::*;

    #[test]
    fn xml_is_escaped() {
        assert_eq!(xml_escape(r#"a&b<c>"d'"#), "a&amp;b&lt;c&gt;&quot;d&apos;");
        let xml = windows_task_xml(Path::new(r"C:\A&B\sd-daemon.exe"), Path::new(r"C:\data"));
        assert!(xml.contains("<Command>conhost.exe</Command>"));
        assert!(xml.contains(
            r#"<Arguments>--headless "C:\A&amp;B\sd-daemon.exe" --data-dir "C:\data"</Arguments>"#
        ));
        assert!(xml.contains("<Hidden>true</Hidden>"));
    }

    #[test]
    fn task_xml_is_encoded_as_declared() {
        let bytes = utf16le_with_bom("<a/>");
        assert_eq!(bytes, vec![0xFF, 0xFE, b'<', 0, b'a', 0, b'/', 0, b'>', 0]);
    }

    #[test]
    fn unit_quotes_paths_with_spaces() {
        let unit = systemd_unit(
            Path::new("/opt/my apps/sd-daemon"),
            Path::new("/home/u/.aphrody/drive"),
        );
        assert!(unit.contains(
            "ExecStart=\"/opt/my apps/sd-daemon\" --data-dir \"/home/u/.aphrody/drive\"\n"
        ));
        assert!(unit.contains("Restart=on-failure"));
    }

    #[test]
    fn plist_names_the_agent_and_logs() {
        let plist = launchd_plist(
            Path::new("/Applications/aphrody.app/Contents/MacOS/sd-daemon"),
            Path::new("/Users/u/.aphrody/drive"),
            &PathBuf::from("/Users/u/.aphrody/drive/logs"),
        );
        assert!(plist.contains(&format!("<string>{LAUNCHD_LABEL}</string>")));
        assert!(plist.contains("<string>/Users/u/.aphrody/drive/logs"));
        assert!(plist.contains("daemon.err.log</string>"));
        assert!(
            plist.contains(
                "<string>--data-dir</string>\n\t\t<string>/Users/u/.aphrody/drive</string>"
            )
        );
    }
}
