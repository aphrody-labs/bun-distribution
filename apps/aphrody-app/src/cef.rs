// SPDX-License-Identifier: Apache-2.0
//! The one desktop runtime: Chromium Embedded Framework through `tauri-runtime-cef`
//! (CEF + `tauri-winit` + GTK4 on Linux).
//!
//! Every CEF application is one executable that is also its own renderer, GPU, network and
//! utility process: `main` carries `#[tauri_runtime_cef::cef_entry_point]`, which hands those
//! processes to CEF before the application exists. This module builds the browser-process
//! profile ([`Cef`]) for the desktop and for the isolated runtime host.
//!
//! The profile follows the runtime's own advice:
//!
//! - sandbox `Auto`: kept wherever the runtime can keep it; [`NO_SANDBOX_ENV`] drops it for CI
//!   images that cannot provide one (a Windows build has none whatever the policy says);
//! - DevTools protocol server `Disabled`; [`REMOTE_DEBUGGING_ENV`] opens a loopback port for
//!   end-to-end runs and the debug bridge, nothing else does;
//! - component updates, Safe Browsing and spell checking stay on (the runtime documents why);
//! - no `locale` (only the `en-US` paks ship) but a French first `Accept-Language` list;
//! - no raw Chromium switch: features and JavaScript flags go through their setters.

use std::path::{Path, PathBuf};

use tauri_runtime_cef::{Cef, RemoteDebugging, SandboxPolicy, SecretStorage};

/// Loopback port (1024..=65535) of Chromium's DevTools protocol server. Unset: no server.
///
/// The server has no authentication and every local process can reach it, so it is an opt-in
/// of the process that launches the app (a test harness, the debug bridge), never a default.
pub const REMOTE_DEBUGGING_ENV: &str = "APHRODY_CEF_REMOTE_DEBUGGING_PORT";

/// Set to `1` to run without Chromium's sandbox. Only for containers and CI images that cannot
/// provide one: every renderer then runs with the full privileges of the user.
pub const NO_SANDBOX_ENV: &str = "APHRODY_CEF_UNSAFE_NO_SANDBOX";

/// `Accept-Language` and `navigator.languages`: independent of Chromium's own UI locale.
const ACCEPT_LANGUAGES: &str = "fr-FR,fr,en-US,en";

/// The DevTools server setting for the value of [`REMOTE_DEBUGGING_ENV`].
///
/// Anything that is not a port Chromium accepts (1024..=65535) leaves the server off.
#[must_use]
pub fn remote_debugging(value: Option<&str>) -> RemoteDebugging {
    match value
        .map(str::trim)
        .and_then(|port| port.parse::<u16>().ok())
    {
        Some(port) if port >= 1024 => RemoteDebugging::Port {
            port,
            allowed_origins: Vec::new(),
        },
        _ => RemoteDebugging::Disabled,
    }
}

/// The sandbox policy for the value of [`NO_SANDBOX_ENV`].
#[must_use]
pub fn sandbox(value: Option<&str>) -> SandboxPolicy {
    if value.map(str::trim) == Some("1") {
        SandboxPolicy::Disabled
    } else {
        SandboxPolicy::Auto
    }
}

fn profile(remote_debugging_value: Option<&str>, no_sandbox_value: Option<&str>) -> Cef {
    let sandbox = sandbox(no_sandbox_value);
    if sandbox == SandboxPolicy::Disabled {
        log::warn!("{NO_SANDBOX_ENV}=1: Chromium runs without its sandbox");
    }
    Cef::default()
        .sandbox(sandbox)
        .remote_debugging(remote_debugging(remote_debugging_value))
        .accept_language_list(ACCEPT_LANGUAGES)
}

/// The profile of the desktop: the runtime's default cache directory
/// (`{user cache}/dev.aphrody.desktop/cef`) and the OS secret store in release builds.
#[must_use]
pub fn runtime() -> Cef {
    profile(
        std::env::var(REMOTE_DEBUGGING_ENV).ok().as_deref(),
        std::env::var(NO_SANDBOX_ENV).ok().as_deref(),
    )
}

/// The profile of the isolated runtime host (`--runtime-host`): one throwaway profile directory
/// per session, so pages loaded for an SDK client share no cookie, storage or cache with the
/// desktop or with another session. Nothing persists, so the mock key store costs nothing and the
/// host runs where no secret store exists (a headless session, a container).
///
/// # Errors
///
/// Fails when the profile directory cannot be created.
pub fn runtime_host(session: &Path) -> std::io::Result<Cef> {
    create_private_dir(session)?;
    Ok(profile(
        std::env::var(REMOTE_DEBUGGING_ENV).ok().as_deref(),
        std::env::var(NO_SANDBOX_ENV).ok().as_deref(),
    )
    .root_cache_path(session)
    .secret_storage(SecretStorage::Mock)
    .persist_session_cookies(false))
}

/// The per-session profile directory of the runtime host.
#[must_use]
pub fn session_dir() -> PathBuf {
    std::env::temp_dir().join(format!("yolo-desktop-{}", std::process::id()))
}

fn create_private_dir(path: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(path)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt as _;
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o700))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_devtools_server_is_off_unless_a_valid_port_is_named() {
        assert_eq!(remote_debugging(None), RemoteDebugging::Disabled);
        for refused in ["", "0", "80", "1023", "65536", "abc", "9222x", "-1"] {
            assert_eq!(
                remote_debugging(Some(refused)),
                RemoteDebugging::Disabled,
                "{refused}"
            );
        }
        assert_eq!(
            remote_debugging(Some(" 9222 ")),
            RemoteDebugging::Port {
                port: 9222,
                allowed_origins: Vec::new()
            }
        );
        assert_eq!(
            remote_debugging(Some("65535")),
            RemoteDebugging::Port {
                port: 65535,
                allowed_origins: Vec::new()
            }
        );
    }

    #[test]
    fn the_sandbox_is_dropped_only_by_an_explicit_one() {
        assert_eq!(sandbox(None), SandboxPolicy::Auto);
        for kept in ["", "0", "true", "yes", "11"] {
            assert_eq!(sandbox(Some(kept)), SandboxPolicy::Auto, "{kept}");
        }
        assert_eq!(sandbox(Some("1")), SandboxPolicy::Disabled);
    }

    #[test]
    fn the_runtime_host_profile_is_a_private_throwaway_directory() {
        let dir = std::env::temp_dir().join(format!("aphrody-cef-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        runtime_host(&dir).expect("profile directory");
        assert!(dir.is_dir());
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt as _;
            assert_eq!(
                std::fs::metadata(&dir).unwrap().permissions().mode() & 0o777,
                0o700
            );
        }
        std::fs::remove_dir_all(&dir).expect("cleanup");
        assert!(session_dir().to_string_lossy().contains("yolo-desktop-"));
    }
}
