// SPDX-License-Identifier: Apache-2.0
//! `aphrody-compat`: cross-compatibility runtime layer for Proton, Wine, .NET, and PowerShell Core.

pub mod dotnet;
pub mod pwsh;
pub mod subsystem;
pub mod wine_proton;

pub use dotnet::{DotnetRuntimeInfo, detect_dotnet, execute_assembly};
pub use pwsh::{PwshRuntimeInfo, detect_pwsh, eval_script};
pub use subsystem::CompatSubsystem;
pub use wine_proton::{ExecResult, WineRuntimeInfo, detect_wine_runtime, execute_binary};

#[cfg(test)]
mod tests {
    use aphrody_subsystem::SystemSubsystem;
    use serde_json::json;

    use super::*;

    #[test]
    fn wine_proton_detection_is_valid() {
        let info = detect_wine_runtime();
        if cfg!(windows) {
            assert!(info.available);
            assert_eq!(info.kind, "native_windows");
        } else {
            assert!(info.kind == "wine" || info.kind == "proton" || info.kind == "none");
        }
    }

    #[tokio::test]
    async fn dotnet_detection_runs() {
        let info = detect_dotnet().await;
        // Either available on developer system or reports clean unavailable state
        if info.available {
            assert!(info.cli_path.is_some());
        }
    }

    #[tokio::test]
    async fn pwsh_detection_runs() {
        let info = detect_pwsh().await;
        if info.available {
            assert!(info.path.is_some());
            assert!(info.kind == "pwsh_core" || info.kind == "windows_powershell");
        }
    }

    #[tokio::test]
    async fn subsystem_dispatch() {
        let sub = CompatSubsystem::new();
        assert_eq!(sub.name(), "compat");

        let status = sub
            .call("compat_runtimes_status", json!({}))
            .await
            .expect("status");
        assert!(status.get("wine_proton").is_some());
        assert!(status.get("dotnet").is_some());
        assert!(status.get("pwsh").is_some());
    }
}
