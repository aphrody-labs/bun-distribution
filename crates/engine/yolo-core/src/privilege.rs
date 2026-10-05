// SPDX-License-Identifier: Apache-2.0
//! Native privilege detection, token verification, and non-interactive elevation
//! layer for YOLO (WSL, Linux, Windows 11).
//!
//! Provides NHITL (No-Human-In-The-Loop) execution helpers ensuring processes
//! can query privilege status and wrap commands with `sudo -n` without blocking
//! on user prompts.

use serde::{Deserialize, Serialize};
use std::process::{Command, Stdio};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ElevationInfo {
  pub is_elevated: bool,
  pub can_sudo: bool,
  pub effective_uid: Option<u32>,
  pub real_uid: Option<u32>,
  pub platform: String,
}

/// Checks whether the calling process currently runs with elevated privileges (root / Administrator).
pub fn is_elevated() -> bool {
  #[cfg(unix)]
  {
    // SAFETY: geteuid is a POSIX libc function that takes no arguments and has no side effects.
    unsafe { libc::geteuid() == 0 }
  }
  #[cfg(windows)]
  {
    windows_is_elevated()
  }
}

/// Probes whether passwordless, non-interactive `sudo` is available (`sudo -n true`).
/// Essential for autonomous agent execution where terminal prompts must never hang.
pub fn can_sudo_non_interactive() -> bool {
  if is_elevated() {
    return true;
  }
  #[cfg(unix)]
  {
    Command::new("sudo")
      .args(["-n", "true"])
      .stdin(Stdio::null())
      .stdout(Stdio::null())
      .stderr(Stdio::null())
      .status()
      .map(|s| s.success())
      .unwrap_or(false)
  }
  #[cfg(windows)]
  {
    false
  }
}

/// Returns detailed information about the current privilege and elevation state.
pub fn get_elevation_info() -> ElevationInfo {
  #[cfg(unix)]
  {
    let euid = unsafe { libc::geteuid() };
    let ruid = unsafe { libc::getuid() };
    let elevated = euid == 0;
    let can_sudo = elevated || can_sudo_non_interactive();
    ElevationInfo {
      is_elevated: elevated,
      can_sudo,
      effective_uid: Some(euid),
      real_uid: Some(ruid),
      platform: std::env::consts::OS.to_string(),
    }
  }
  #[cfg(windows)]
  {
    let elevated = windows_is_elevated();
    ElevationInfo {
      is_elevated: elevated,
      can_sudo: elevated,
      effective_uid: None,
      real_uid: None,
      platform: "windows".to_string(),
    }
  }
}

/// Wraps a command and its arguments to run with elevated privileges without interactive prompting.
///
/// If already elevated, returns the command and arguments unmodified.
/// On Unix, if not elevated, prepends `sudo` and `-n`.
pub fn wrap_elevated_command(program: &str, args: &[String]) -> (String, Vec<String>) {
  if is_elevated() {
    return (program.to_string(), args.to_vec());
  }

  #[cfg(unix)]
  {
    let mut elevated_args = Vec::with_capacity(args.len() + 2);
    elevated_args.push("-n".to_string());
    elevated_args.push(program.to_string());
    elevated_args.extend(args.iter().cloned());
    ("sudo".to_string(), elevated_args)
  }

  #[cfg(windows)]
  {
    (program.to_string(), args.to_vec())
  }
}

#[cfg(windows)]
fn windows_is_elevated() -> bool {
  // Use a lightweight probe or token check on Windows.
  // In non-interactive contexts, net session returns 0 if elevated (Administrator).
  Command::new("net")
    .args(["session"])
    .stdin(Stdio::null())
    .stdout(Stdio::null())
    .stderr(Stdio::null())
    .status()
    .map(|s| s.success())
    .unwrap_or(false)
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn test_privilege_detection() {
    let info = get_elevation_info();
    assert_eq!(info.platform, std::env::consts::OS);
    #[cfg(unix)]
    {
      assert!(info.effective_uid.is_some());
      assert!(info.real_uid.is_some());
      assert_eq!(info.is_elevated, info.effective_uid == Some(0));
    }
  }

  #[test]
  fn test_wrap_elevated_command() {
    let args = vec!["arg1".to_string(), "arg2".to_string()];
    let (prog, wrapped_args) = wrap_elevated_command("testcmd", &args);
    if is_elevated() {
      assert_eq!(prog, "testcmd");
      assert_eq!(wrapped_args, args);
    } else {
      #[cfg(unix)]
      {
        assert_eq!(prog, "sudo");
        assert_eq!(wrapped_args[0], "-n");
        assert_eq!(wrapped_args[1], "testcmd");
      }
    }
  }
}
