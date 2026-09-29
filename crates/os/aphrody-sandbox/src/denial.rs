// SPDX-License-Identifier: Apache-2.0
//! Structured classification and reporting of sandbox denial events.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

/// Categories of sandbox denials.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum SandboxDenialKind {
    /// Attempted to write to a path outside the designated workspace roots.
    WriteOutsideWorkspace,
    /// Attempted to write to a protected subpath (e.g. `.git` or `.aphrody`).
    ReadOnlyProtectedSubpath,
    /// Attempted an outbound network connection while network egress is denied.
    NetworkBlocked,
    /// Process execution blocked by security policy or lack of privileges.
    RestrictedExecution,
    /// Explicit policy denial (e.g. forbidden destructive command).
    PolicyForbidden,
}

/// A structured denial event ready to be reported back to the agent or calling engine.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct SandboxDenial {
    /// The classification of this denial.
    pub kind: SandboxDenialKind,
    /// Path involved in the violation, if applicable.
    pub path: Option<PathBuf>,
    /// Exact error or descriptive message.
    pub message: String,
    /// Recommended corrective action for the LLM to re-plan autonomously.
    pub remedy: Option<String>,
}

impl SandboxDenial {
    /// Create a denial for an unauthorized path write outside the workspace.
    #[must_use]
    pub fn write_outside_workspace(path: impl AsRef<Path>) -> Self {
        let p = path.as_ref().to_path_buf();
        Self {
            kind: SandboxDenialKind::WriteOutsideWorkspace,
            path: Some(p.clone()),
            message: format!(
                "Write denied: `{}` is outside the authorized workspace roots",
                p.display()
            ),
            remedy: Some(
                "Confine all file creation and modifications strictly to the repository workspace."
                    .to_string(),
            ),
        }
    }

    /// Create a denial for an attempt to mutate a protected internal subpath.
    #[must_use]
    pub fn protected_subpath(path: impl AsRef<Path>) -> Self {
        let p = path.as_ref().to_path_buf();
        Self {
            kind: SandboxDenialKind::ReadOnlyProtectedSubpath,
            path: Some(p.clone()),
            message: format!(
                "Write denied: `{}` is inside a protected read-only directory (.git/.aphrody)",
                p.display()
            ),
            remedy: Some(
                "Do not modify repository metadata or agent internal stores directly.".to_string(),
            ),
        }
    }

    /// Create a denial for network egress in a sandboxed command.
    #[must_use]
    pub fn network_blocked(detail: impl Into<String>) -> Self {
        Self {
            kind: SandboxDenialKind::NetworkBlocked,
            path: None,
            message: format!("Network egress denied by sandbox policy: {}", detail.into()),
            remedy: Some(
                "Use native tools (e.g. aphrody-web web_search/web_fetch) for internet access \
                 instead of direct shell network calls."
                    .to_string(),
            ),
        }
    }

    /// Format this denial as structured guidance for an LLM turn context.
    #[must_use]
    pub fn to_structured_feedback(&self) -> String {
        let mut out = format!("[SANDBOX DENIAL - {:?}]\nError: {}", self.kind, self.message);
        if let Some(path) = &self.path {
            out.push_str(&format!("\nTarget Path: {}", path.display()));
        }
        if let Some(remedy) = &self.remedy {
            out.push_str(&format!("\nAutonomous Remedy: {remedy}"));
        }
        out
    }
}

/// Inspect exit code and standard error output to detect and classify a sandbox or permission
/// denial.
#[must_use]
pub fn classify_denial(exit_code: i32, stderr: &str) -> Option<SandboxDenial> {
    let lower = stderr.to_ascii_lowercase();

    // 1. Filesystem permission errors
    if lower.contains("access is denied")
        || lower.contains("permission denied")
        || lower.contains("operation not permitted")
        || lower.contains("read-only file system")
        || exit_code == 126
        || exit_code as u32 == 0xC0000022
    // STATUS_ACCESS_DENIED
    {
        return Some(SandboxDenial {
            kind: SandboxDenialKind::RestrictedExecution,
            path: None,
            message: "Execution or filesystem access blocked by sandbox permissions".to_string(),
            remedy: Some(
                "Verify that write operations are scoped to the workspace and required tools are \
                 accessible."
                    .to_string(),
            ),
        });
    }

    // 2. Network blockages
    if lower.contains("network is unreachable")
        || lower.contains("connection refused")
        || lower.contains("could not resolve host")
        || lower.contains("wsaeacces")
        || lower.contains("eacces") && lower.contains("socket")
    {
        return Some(SandboxDenial::network_blocked(
            "Outbound socket connection rejected by sandbox",
        ));
    }

    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_classify_access_denied() {
        let denial =
            classify_denial(1, "Error: Access is denied when opening file").expect("must classify");
        assert_eq!(denial.kind, SandboxDenialKind::RestrictedExecution);
        assert!(denial.to_structured_feedback().contains("SANDBOX DENIAL"));
    }

    #[test]
    fn test_classify_network_denied() {
        let denial = classify_denial(1, "curl: (6) Could not resolve host: example.com")
            .expect("must classify");
        assert_eq!(denial.kind, SandboxDenialKind::NetworkBlocked);
        assert!(denial.to_structured_feedback().contains("aphrody-web web_search"));
    }

    #[test]
    fn test_unrelated_error_returns_none() {
        assert!(classify_denial(1, "SyntaxError: unexpected token").is_none());
    }
}
