// SPDX-License-Identifier: Apache-2.0
//! Sandbox capability probing and OS support detection.

use serde::{Deserialize, Serialize};

/// Level of security isolation supported and actively enforced by the host OS.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum SandboxCapability {
    /// Kernel-level isolation is fully supported and enforced (e.g. Linux Landlock + seccomp,
    /// Windows AppContainer W2).
    Enforced,
    /// Partial or defense-in-depth enforcement (e.g. Windows W1 Restricted Token / Low IL / Job
    /// Objects, macOS sandbox-exec seatbelt).
    BestEffort,
    /// Sandboxing primitives are not available in this environment (e.g. wasm, restricted
    /// container).
    Unavailable,
}

impl SandboxCapability {
    /// True if the capability provides at least best-effort isolation.
    #[must_use]
    pub const fn is_available(self) -> bool {
        matches!(self, Self::Enforced | Self::BestEffort)
    }

    /// True if kernel enforcement guarantees complete isolation.
    #[must_use]
    pub const fn is_enforced(self) -> bool {
        matches!(self, Self::Enforced)
    }
}

/// Detailed capability report returned by [`probe`].
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct CapabilityReport {
    /// Overall filesystem isolation capability.
    pub filesystem: SandboxCapability,
    /// Overall network isolation capability.
    pub network: SandboxCapability,
    /// Human-readable diagnostic description of the detected platform sandbox.
    pub details: String,
}

/// Probe the host operating system to assess available sandboxing capabilities.
///
/// Deterministic and safe to call concurrently.
#[must_use]
pub fn probe() -> CapabilityReport {
    #[cfg(target_arch = "wasm32")]
    {
        CapabilityReport {
            filesystem: SandboxCapability::Unavailable,
            network: SandboxCapability::Unavailable,
            details: "WASM target: process execution and OS sandboxing unavailable".to_string(),
        }
    }

    #[cfg(windows)]
    {
        probe_windows()
    }

    #[cfg(all(unix, not(target_os = "macos"), not(target_arch = "wasm32")))]
    {
        probe_linux()
    }

    #[cfg(target_os = "macos")]
    {
        CapabilityReport {
            filesystem: SandboxCapability::BestEffort,
            network: SandboxCapability::BestEffort,
            details: "macOS seatbelt (sandbox-exec) supported".to_string(),
        }
    }

    #[cfg(not(any(windows, unix, target_arch = "wasm32")))]
    {
        CapabilityReport {
            filesystem: SandboxCapability::Unavailable,
            network: SandboxCapability::Unavailable,
            details: "Unsupported target OS".to_string(),
        }
    }
}

#[cfg(windows)]
fn probe_windows() -> CapabilityReport {
    // Windows W1 uses Restricted Tokens (Safer API) + Low Integrity Level + Job Objects
    // with KILL_ON_JOB_CLOSE. Network isolation is unavailable at the token level without
    // AppContainer, so network rules are policy-compensated (execpolicy/guard without prompt).
    CapabilityReport {
        filesystem: SandboxCapability::BestEffort,
        network: SandboxCapability::Unavailable,
        details: "Windows W1: Restricted Token + Low-IL + Job Object (network policy-compensated)"
            .to_string(),
    }
}

#[cfg(all(unix, not(target_os = "macos"), not(target_arch = "wasm32")))]
fn probe_linux() -> CapabilityReport {
    // Under YOLO OS doctrine, the host executes directly with full agent authority.
    // The Unix helper applies PR_SET_NO_NEW_PRIVS and session isolation, but does not
    // enforce restrictive Landlock or seccomp rules. We honestly report BestEffort.
    CapabilityReport {
        filesystem: SandboxCapability::BestEffort,
        network: SandboxCapability::BestEffort,
        details: "Linux: PR_SET_NO_NEW_PRIVS and session isolation (YOLO host authority; Landlock/seccomp not enforced)"
            .to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_probe_returns_valid_report() {
        let report = probe();
        assert!(!report.details.is_empty());
        #[cfg(windows)]
        {
            assert_eq!(report.filesystem, SandboxCapability::BestEffort);
            assert_eq!(report.network, SandboxCapability::Unavailable);
            assert!(report.details.contains("Windows W1"));
        }
    }
}
